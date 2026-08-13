"""Independencia efectiva de los votos técnicos (M10.5).

El ensemble agrega seis votos internos como si fueran seis evidencias. No lo son: EMA9/21, MACD y
Supertrend derivan todos de la misma serie de precio suavizada, y RSI14, Bollinger y Estocástico son
tres lecturas del mismo desplazamiento respecto a la media. Medido sobre los registros reales de
BTCUSDT (agosto de 2026), en 4h los seis votos equivalen a **1,41 votos independientes**: el 83 % de
la información que aportan cabe en un único factor.

La consecuencia es que la confianza del softmax está inflada, porque se calcula como si seis fuentes
independientes coincidieran. Este módulo mide cuántos votos hay *de verdad* y publica un factor de
desinflado que la API aplica a los logits.

Decisión de arquitectura: el cómputo vive aquí (offline, con la muestra completa) y se publica como
artefacto plano; la API solo lo evalúa. Es el mismo patrón que `ensemble.yaml`, `calibrators.json` y
`metamodel.json`. Lo que entra en la suite de paridad Node≡Python es únicamente la *aplicación* del
factor, no su cálculo.
"""

from __future__ import annotations

import json
import math
import time
from pathlib import Path
from typing import Any

import numpy as np

# Los seis votos direccionales del ensemble. ADX y ATR no votan (contexto y volatilidad).
VOTE_COLUMNS: tuple[str, ...] = (
    "ema_cross_score",
    "macd_score",
    "supertrend_score",
    "rsi14_score",
    "bbands_score",
    "stoch14_score",
)

# Muestra mínima para fiarse de una matriz de correlación de 6x6 (15 pares).
MIN_SAMPLES = 40
# Suelo del factor: por muy redundantes que sean los votos, no se anula la señal.
DEFAULT_FLOOR = 0.35


def effective_votes(corr: np.ndarray) -> float:
    """Número de votos efectivamente independientes: (Σλ)² / Σλ².

    Es la *participación* de los autovalores de la matriz de correlación. Con seis votos
    independientes todos los autovalores valen 1 y el resultado es 6. Si los seis son copias
    (o espejos) de un mismo factor, un autovalor se lleva todo y el resultado tiende a 1.

    Se usa la participación y no la suma de correlaciones porque los dos bloques del ensemble son
    *anti*correlacionados (EMA–RSI ≈ −0,94): sumar correlaciones con signo los cancelaría y daría
    una independencia altísima justo donde no la hay. Los autovalores no se dejan engañar por el
    signo, porque un espejo tampoco es evidencia nueva.
    """
    n = int(corr.shape[0])
    if n == 0:
        return 1.0
    valores = np.linalg.eigvalsh(np.asarray(corr, dtype=float))
    positivos = np.clip(valores, 0.0, None)
    suma = float(positivos.sum())
    cuadrados = float(np.square(positivos).sum())
    if suma <= 0.0 or cuadrados <= 0.0:
        return 1.0
    return max(1.0, min(float(n), (suma * suma) / cuadrados))


def deflation_factor(effective: float, n_votes: int, floor: float = DEFAULT_FLOOR) -> float:
    """Factor por el que se multiplican los logits del softmax.

    La media de N observaciones independientes tiene un error estándar de σ/√N. Con solo `effective`
    fuentes reales, la misma cifra `net` respalda menos evidencia, en proporción a √(efectivos/N).
    Ese es el factor: no cambia lo que el sistema cree (la dirección se conserva, porque escalar
    todos los logits por una constante positiva no altera el argmax), solo cuánta seguridad declara.
    """
    if n_votes <= 0:
        return 1.0
    k = math.sqrt(max(1.0, min(float(n_votes), effective)) / float(n_votes))
    return min(1.0, max(floor, k))


def correlation_matrix(rows: list[dict[str, Any]]) -> np.ndarray | None:
    """Matriz de correlación de los seis votos. None si no hay muestra suficiente."""
    if len(rows) < MIN_SAMPLES:
        return None
    columnas: list[list[float]] = []
    for col in VOTE_COLUMNS:
        serie = [r.get(col) for r in rows]
        if any(v is None for v in serie):
            return None
        columnas.append([float(v) for v in serie])  # type: ignore[arg-type]
    datos = np.asarray(columnas, dtype=float)
    # Un voto constante no tiene correlación definida; se trata como perfectamente redundante
    # (fila y columna a 1) para no inflar artificialmente la independencia.
    desv = datos.std(axis=1)
    if float(desv.max(initial=0.0)) <= 0.0:
        return np.ones((len(VOTE_COLUMNS), len(VOTE_COLUMNS)), dtype=float)
    constantes = desv <= 0.0
    if constantes.any():
        datos = datos.copy()
        datos[constantes, :] = np.linspace(0.0, 1.0, datos.shape[1])
    corr = np.corrcoef(datos)
    # Variable anotada en vez de `cast`: en numpy 1.x `nan_to_num` no está tipado y devuelve Any,
    # que mypy en modo estricto rechaza al salir de una función con tipo declarado; en numpy 2.x sí
    # lo está, y ahí un `cast` sería redundante —y `warn_redundant_casts` forma parte de `strict`—.
    # La anotación es correcta con ambas: absorbe el Any y no sobra cuando el tipo ya es bueno.
    limpia: np.ndarray = np.nan_to_num(np.asarray(corr, dtype=float), nan=1.0)
    return limpia


def analyze(rows: list[dict[str, Any]], floor: float = DEFAULT_FLOOR) -> dict[str, Any] | None:
    """Resumen de independencia de una muestra de decisiones (un símbolo y temporalidad)."""
    corr = correlation_matrix(rows)
    if corr is None:
        return None
    efectivos = effective_votes(corr)
    valores = np.clip(np.linalg.eigvalsh(corr), 0.0, None)
    primero = float(valores.max(initial=0.0)) / float(len(VOTE_COLUMNS))
    return {
        "n": len(rows),
        "votes": len(VOTE_COLUMNS),
        "effective": round(efectivos, 4),
        "first_factor": round(primero, 4),
        "factor": round(deflation_factor(efectivos, len(VOTE_COLUMNS), floor), 4),
    }


def _fetch(dsn: str) -> dict[str, list[dict[str, Any]]]:
    import psycopg

    columnas = ", ".join(VOTE_COLUMNS)
    agrupado: dict[str, list[dict[str, Any]]] = {}
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(f"""
            SELECT symbol, interval, {columnas}
              FROM snapshots
             WHERE {" AND ".join(f"{c} IS NOT NULL" for c in VOTE_COLUMNS)}
            """)  # noqa: S608 - nombres de columna fijos, no entrada de usuario
        for fila in cur.fetchall():
            clave = f"{fila[0]}:{fila[1]}"
            agrupado.setdefault(clave, []).append(
                dict(zip(VOTE_COLUMNS, (float(x) for x in fila[2:]), strict=True))
            )
    return agrupado


def publish(artifacts: Path, dsn: str, floor: float = DEFAULT_FLOOR) -> dict[str, Any]:
    """Mide la independencia por símbolo+temporalidad y publica `independence.json`.

    Degradación grácil: una clave sin muestra suficiente simplemente no aparece en el artefacto, y
    la API le aplica factor 1 (sin desinflar). Nunca se inventa un ajuste con cuatro datos.
    """
    entradas: dict[str, Any] = {}
    for clave, filas in _fetch(dsn).items():
        resumen = analyze(filas, floor)
        if resumen is not None:
            entradas[clave] = resumen
    datos: dict[str, Any] = {
        "version": time.strftime("ind-%Y-%m-%dT%H%M%SZ", time.gmtime()),
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "min_samples": MIN_SAMPLES,
        "floor": floor,
        "entries": entradas,
    }
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / "independence.json").write_text(
        json.dumps(datos, indent=2, ensure_ascii=False) + "\n", encoding="utf8"
    )
    return datos


def load_factor(artifacts: Path, symbol: str, interval: str) -> float:
    """Factor publicado para un símbolo+temporalidad; 1,0 si no hay medición (sin desinflar)."""
    ruta = artifacts / "independence.json"
    if not ruta.exists():
        return 1.0
    try:
        datos = json.loads(ruta.read_text(encoding="utf8"))
        entrada = datos.get("entries", {}).get(f"{symbol.upper()}:{interval}")
        return float(entrada["factor"]) if entrada else 1.0
    except Exception:  # noqa: BLE001 - artefacto ilegible: se decide sin desinflar
        return 1.0

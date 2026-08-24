"""Fundamental Score: el funding entra ASIMÉTRICO, penalizando solo los largos (M12).

Por qué asimétrico y no como el resto de la evidencia
-----------------------------------------------------
Cruzadas 728 decisiones evaluadas con el valor *as-of* del funding, de seis relaciones probadas
sobrevive una sola (t=2,95, por encima del umbral de Bonferroni 2,64), y solo en un lado:

    LARGOS   funding bajo  n=117  +0,200 R   |  CORTOS   sin patrón:
             funding medio n=117  -0,005 R   |           -0,111 / +0,131 / -0,004
             funding alto  n=117  -0,230 R   |

El `macro_bias` histórico se inyecta simétrico (`BUY += w*bias`, `SELL -= w*bias`). Cablear así un
efecto que solo existe en los largos no es «aprovecharlo también en los cortos»: es añadir ruido en
la mitad de las decisiones, con la seguridad aparente de una fórmula simétrica.

Por qué percentil y no el valor absoluto
----------------------------------------
El rango observado durante la medición fue 0,000003-0,0001. Un umbral fijo calibrado ahí describe
un régimen concreto, no una regla: al primer cambio de mercado dejaría de significar lo que
significaba. El percentil sobre ventana móvil de 90 días pregunta lo único que importa -«¿está caro
el apalancamiento *comparado con lo normal últimamente*?»- y sobrevive al cambio de régimen.

Reparto de trabajo
------------------
Aquí se calcula la **distribución de referencia** (los cortes de percentil de la ventana) y se
publica como artefacto. La api la lee y sitúa el funding del momento contra esos cortes. Es el mismo
reparto que el calibrador y el meta-modelo: Python mide, Node aplica. Las dos funciones puras de
abajo -`percentile_of` y `long_penalty`- tienen mirror exacto en
`apps/api/src/ensemble/fundamental.ts` y entran en la suite de paridad.
"""

from __future__ import annotations

import json
import math
from collections.abc import Sequence
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

#: Percentil por debajo del cual NO se penaliza. Es el tercil inferior de la medición, fijado
#: antes de ver ningún resultado: elegirlo después sería elegirlo mirando el desenlace.
DEFAULT_START = 1.0 / 3.0
#: Días de la ventana móvil que define «lo normal últimamente».
DEFAULT_WINDOW_DAYS = 90
#: Mínimo de observaciones para que la distribución signifique algo. Por debajo, el score se
#: declara `stale` y la penalización es 0: sin datos no se penaliza, no se adivina.
MIN_OBSERVACIONES = 30
#: Fracción de la ventana que debe estar realmente cubierta. Contar observaciones no basta: son
#: dos preguntas distintas y solo una estaba hecha. BTCUSDT llegó a publicar 120 observaciones
#: —muy por encima de las 30— repartidas por **40 de los 90 días**, porque nunca se le hizo el
#: backfill que sí recibieron los demás. Su distribución describía otro periodo, así que su tercil
#: bajo quedó en +5,0e-5 frente al +2,0e-5 de ETHUSDT: con el mismo funding real, uno penalizaba
#: el largo y el otro no. Un percentil solo compara si las ventanas comparan.
#:
#: El 0,8 se fija mirando lo que ya está dentro, no el resultado que interesa: los tres símbolos
#: con backfill cubren el 100 % de la ventana, así que el listón les deja 20 puntos de margen y
#: solo excluye al que de verdad está incompleto.
MIN_COBERTURA = 0.8
#: Número de cortes publicados (p0, p1, ... p100).
N_KNOTS = 101


# ---------------------------------------------------------------------------------------------
# Funciones puras - mirror exacto en apps/api/src/ensemble/fundamental.ts (suite de paridad).
# ---------------------------------------------------------------------------------------------
def percentile_of(knots: list[float], value: float) -> float:
    """Sitúa `value` en la distribución descrita por `knots` (p0..p100 ordenados) -> [0,1].

    Interpolación lineal entre cortes. Fuera de rango satura en 0 o 1: un funding nunca visto es
    «el más alto conocido», no un percentil 140.
    """
    n = len(knots)
    if n == 0:
        return 0.5  # sin distribución no hay percentil; el centro es la respuesta neutra
    if n == 1:
        return 0.0 if value <= knots[0] else 1.0
    if value <= knots[0]:
        return 0.0
    if value >= knots[n - 1]:
        return 1.0
    lo = 0
    hi = n - 1
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if knots[mid] <= value:
            lo = mid
        else:
            hi = mid
    tramo = knots[hi] - knots[lo]
    frac = 0.0 if tramo <= 0 else (value - knots[lo]) / tramo
    return (lo + frac) / (n - 1)


def long_penalty(pct: float, start: float = DEFAULT_START) -> float:
    """Penalización a los largos, en [0,1], a partir del percentil de funding.

    Cero hasta `start` (el tercil donde los largos ganaban +0,200 R) y creciente en línea recta
    hasta 1 en el percentil máximo. Sin parámetros de forma: una recta no se puede sobreajustar a
    posteriori, y la medición no distingue entre una recta y cualquier otra curva monótona.
    """
    if start >= 1.0:
        return 0.0
    if pct <= start:
        return 0.0
    return min(1.0, max(0.0, (pct - start) / (1.0 - start)))


# ---------------------------------------------------------------------------------------------
# Construcción del artefacto (solo Python: lee la DIL, que la api no toca).
# ---------------------------------------------------------------------------------------------
def quantiles(valores: list[float], n: int = N_KNOTS) -> list[float]:
    """Cortes de percentil equiespaciados, por interpolación lineal sobre la muestra ordenada."""
    if not valores:
        return []
    orden = sorted(valores)
    m = len(orden)
    if m == 1:
        return [orden[0]] * n
    out: list[float] = []
    for i in range(n):
        pos = (i / (n - 1)) * (m - 1)
        lo = math.floor(pos)
        hi = math.ceil(pos)
        frac = pos - lo
        out.append(orden[lo] * (1.0 - frac) + orden[hi] * frac)
    return out


def cobertura(fechas: Sequence[datetime], window_days: int = DEFAULT_WINDOW_DAYS) -> float:
    """Fracción de días de la ventana con al menos una observación.

    Se cuentan **días distintos**, no la distancia entre la primera y la última: así un hueco en
    mitad de la ventana también se nota, que es de donde vino el problema.
    """
    if not fechas or window_days <= 0:
        return 0.0
    dias = {f.date() for f in fechas}
    return min(1.0, len(dias) / float(window_days))


def funding_window(
    dsn: str, symbol: str, momento: datetime, window_days: int = DEFAULT_WINDOW_DAYS
) -> list[tuple[datetime, float]]:
    """Funding **conocido** en `momento` durante los `window_days` previos, con su fecha.

    Filtra por `published_at`, igual que `dil.store.as_of`. Con `observed_at` la ventana incluiría
    valores que en ese instante todavía no se habían publicado: look-ahead silencioso, del que no
    falla sino que mejora los resultados.

    Devuelve la fecha junto al valor porque sin ella no se puede saber si la ventana está cubierta,
    y esa pregunta —distinta de «¿hay bastantes observaciones?»— es la que faltaba.
    """
    import psycopg

    desde = momento - timedelta(days=window_days)
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT published_at, value FROM derivatives_metrics "
            "WHERE metric='funding_rate' AND symbol=%s "
            "AND published_at <= %s AND published_at > %s "
            "ORDER BY published_at",
            (symbol, momento, desde),
        )
        filas = cur.fetchall()
    return [(f[0], float(f[1])) for f in filas if f[1] is not None]


def build_artifact(
    symbol: str,
    muestras: Sequence[tuple[datetime, float]],
    momento: datetime,
    window_days: int = DEFAULT_WINDOW_DAYS,
    start: float = DEFAULT_START,
) -> dict[str, Any]:
    """Artefacto publicable: la distribución de referencia, no una decisión.

    `stale=True` cuando no hay muestra suficiente **o** la ventana no está cubierta. La api lo
    respeta poniendo la penalización a 0: una fuente muda no debe empujar la decisión en ninguna
    dirección, y menos disimuladamente.

    Son dos condiciones y no una porque miden cosas distintas: `n` dice cuántos datos hay y
    `cobertura` dice de cuándo son. Una muestra abundante pero concentrada en medio periodo
    describe un mercado que no es el de la ventana, y el percentil que sale de ahí no es comparable
    con el de otro símbolo — ver `MIN_COBERTURA`.
    """
    valores = [v for _, v in muestras]
    cob = cobertura([f for f, _ in muestras], window_days)
    suficiente = len(valores) >= MIN_OBSERVACIONES and cob >= MIN_COBERTURA
    return {
        "version": f"fund-{momento.strftime('%Y%m%dT%H%M%SZ')}",
        "symbol": symbol,
        "created_at": momento.isoformat(),
        "window_days": window_days,
        "n": len(valores),
        "min_observaciones": MIN_OBSERVACIONES,
        "cobertura": round(cob, 4),
        "min_cobertura": MIN_COBERTURA,
        "stale": not suficiente,
        "start": start,
        "knots": quantiles(valores) if suficiente else [],
    }


def write_artifact(artifact: dict[str, Any], base_dir: str | Path) -> Path:
    """Escribe `artifacts/fundamental/<SÍMBOLO>.json`. La api lo recoge con POST /reload."""
    destino = Path(base_dir) / "fundamental"
    destino.mkdir(parents=True, exist_ok=True)
    ruta = destino / f"{artifact['symbol']}.json"
    ruta.write_text(json.dumps(artifact, indent=2) + "\n", encoding="utf8")
    return ruta

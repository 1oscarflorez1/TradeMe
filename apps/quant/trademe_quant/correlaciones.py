"""Gestor de Correlaciones — cuántas observaciones independientes hay de verdad.

El problema, con números
------------------------
Medido el 21 de agosto de 2026 sobre 500 velas de 1h, los cuatro activos cripto de la plataforma
correlacionan entre 0,69 y 0,81 entre sí. Aplicando la misma medida que `independence.py` usa para
los votos —la participación de los autovalores— eso da:

    4 activos nominales  ->  **1,52 efectivos**

Es el mismo hallazgo que el de los seis votos que valían 1,41, en otro eje: cuatro activos cripto
en el mismo tramo de mercado no son cuatro observaciones, son casi una y media.

Y tiene consecuencia inmediata. El gobierno del Fundamental Score exige 100 decisiones LONG cerradas
antes de promocionarlo. Su primera medición real tenía 75, de las cuales **74 eran de ETH y SOL
dentro de las mismas 14 horas**: un `n` que parecía respetable y era, en información, poco más que
una apuesta observada muchas veces. Sin corregir eso, el veredicto sería ruido con apariencia de
rigor.

Por qué el descuento NO es `n * 0,38`
-------------------------------------
Aplicar el factor global sería excesivo. Dos decisiones de ETH separadas por una semana **sí** son
bastante independientes, aunque ETH y BTC se muevan juntos: la correlación entre activos solo resta
cuando las decisiones son **simultáneas**.

Por eso se agrupa por ventanas de tiempo. Dentro de una ventana, los activos presentes cuentan como
sus efectivos; entre ventanas distintas, cuentan aparte. Así el descuento castiga la concentración
—que es el problema real— y no la diversidad temporal, que es justo lo que se quiere premiar.

Lo que esto NO captura
----------------------
La correlación **entre temporalidades del mismo activo**. Una decisión de ETH en 15m y otra de ETH
en 1h a la misma hora son casi la misma observación, y aquí cuentan como dos. Ese solapamiento
probablemente también sea grande y queda pendiente.
"""

from __future__ import annotations

import json
import time
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np

from .independence import effective_votes

#: Temporalidad y profundidad con que se mide la correlación. 1h equilibra ruido de microestructura
#: y muestra suficiente; 500 velas son unas tres semanas.
INTERVALO = "1h"
LIMITE = 500
#: Velas mínimas por activo para fiarse de la correlación. Por debajo no se descuenta nada.
MIN_VELAS = 100
#: Suelo del factor, como el de `independence.py`: por muy correlacionados que estén los activos,
#: la muestra no se anula.
FLOOR = 0.35
#: Ventana de agrupación. Mayor que el horizonte de las temporalidades que más disparan (15m y 30m
#: cierran en horas), así que decisiones de días distintos cuentan como independientes.
VENTANA_H = 24


def _retornos(cierres: Sequence[float]) -> np.ndarray:
    """Retornos logarítmicos. Es la magnitud que se correlaciona, no el precio.

    Correlacionar precios daría casi 1 entre dos activos que suben, aunque se muevan por motivos
    distintos: dos series con tendencia siempre parecen ir juntas.
    """
    arr = np.asarray(cierres, dtype=float)
    arr = arr[arr > 0]
    if arr.size < 2:
        return np.zeros(0, dtype=float)
    return np.diff(np.log(arr))


def matriz(series: Mapping[str, Sequence[float]]) -> tuple[list[str], np.ndarray | None]:
    """Matriz de correlación de retornos. `None` si no hay muestra suficiente."""
    validos = {s: c for s, c in series.items() if len(c) >= MIN_VELAS}
    if len(validos) < 2:
        return list(validos), None
    simbolos = sorted(validos)
    n = min(len(_retornos(validos[s])) for s in simbolos)
    if n < MIN_VELAS - 1:
        return simbolos, None
    datos = np.asarray([_retornos(validos[s])[-n:] for s in simbolos], dtype=float)
    # Sin `initial`: con `min` ese argumento haría de techo y dejaría el resultado en 0 siempre,
    # haciendo pasar por plana cualquier serie. (Con `max`, como en independence.py, sí vale.)
    if datos.shape[1] == 0 or float(datos.std(axis=1).min()) <= 0.0:
        return simbolos, None  # un activo plano no tiene correlación definida
    corr: np.ndarray = np.nan_to_num(np.asarray(np.corrcoef(datos), dtype=float), nan=0.0)
    return simbolos, corr


def efectivos(corr: np.ndarray | None) -> float:
    """Activos efectivamente independientes. Misma medida que los votos efectivos."""
    if corr is None or corr.size == 0:
        return 1.0
    return float(effective_votes(corr))


def factor_para(presentes: Sequence[str], artefacto: dict[str, Any] | None) -> float:
    """Descuento aplicable a un grupo de decisiones simultáneas de estos activos.

    Sin medición devuelve 1: no se descuenta nada. Inventar un ajuste sin datos sería peor que no
    ajustar, igual que en `independence.py`.
    """
    unicos = sorted(set(presentes))
    if len(unicos) <= 1 or not artefacto:
        return 1.0
    simbolos = list(artefacto.get("symbols") or [])
    bruta = artefacto.get("matrix")
    if not simbolos or not bruta:
        return 1.0
    indices = [simbolos.index(s) for s in unicos if s in simbolos]
    if len(indices) <= 1:
        return 1.0
    completa = np.asarray(bruta, dtype=float)
    sub = completa[np.ix_(indices, indices)]
    return max(FLOOR, min(1.0, efectivos(sub) / len(indices)))


def observaciones_efectivas(
    filas: list[dict[str, Any]],
    artefacto: dict[str, Any] | None,
    ventana_h: int = VENTANA_H,
) -> float:
    """Cuántas observaciones independientes representan estas decisiones.

    Agrupa por ventanas de `ventana_h` horas: dentro de cada una, los activos presentes cuentan como
    sus efectivos; entre ventanas distintas, cuentan aparte.
    """
    if not filas:
        return 0.0
    if not artefacto:
        return float(len(filas))

    grupos: dict[int, list[str]] = {}
    for f in filas:
        ts = f.get("captured_at")
        if isinstance(ts, datetime):
            marca = int(ts.timestamp() // (ventana_h * 3600))
        else:
            marca = 0
        grupos.setdefault(marca, []).append(str(f.get("symbol") or ""))

    total = 0.0
    for simbolos in grupos.values():
        total += len(simbolos) * factor_para(simbolos, artefacto)
    return total


def publish(artifacts: Path, symbols: list[str]) -> dict[str, Any]:
    """Mide y publica `artifacts/correlaciones.json`."""
    from .market.binance import fetch_klines

    series: dict[str, Sequence[float]] = {}
    for s in symbols:
        try:
            filas = fetch_klines(s.upper(), INTERVALO, limit=LIMITE)
            series[s.upper()] = [float(k[4]) for k in filas]
        except Exception:  # noqa: BLE001 - un activo sin datos no impide medir los demás
            continue

    simbolos, corr = matriz(series)
    ef = efectivos(corr)
    data: dict[str, Any] = {
        "symbols": simbolos,
        "matrix": corr.tolist() if corr is not None else None,
        "efectivos": ef,
        "nominales": len(simbolos),
        "factor": max(FLOOR, min(1.0, ef / len(simbolos))) if simbolos else 1.0,
        "interval": INTERVALO,
        "velas": LIMITE,
        "ventana_h": VENTANA_H,
        "min_velas": MIN_VELAS,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    artifacts.mkdir(parents=True, exist_ok=True)
    (artifacts / "correlaciones.json").write_text(json.dumps(data, indent=2), encoding="utf8")
    return data


def load(artifacts: Path) -> dict[str, Any] | None:
    p = artifacts / "correlaciones.json"
    if not p.exists():
        return None
    try:
        data = json.loads(p.read_text(encoding="utf8"))
        return data if isinstance(data, dict) and data.get("matrix") else None
    except Exception:  # noqa: BLE001
        return None

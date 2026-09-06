"""Momentum del funding: el primer candidato a alfa ortogonal, y el único con histórico suficiente.

Por qué este y no otro
-----------------------
De los vectores planteados, la disponibilidad de datos descarta casi todos. Comprobado contra la
API de Binance el 6-sep-2026:

| fuente | histórico disponible |
|---|---|
| **funding rate** | **desde 2020**, paginando con `startTime` |
| open interest (`openInterestHist`) | **30 días** |
| long/short ratio | 30 días |
| taker buy/sell volume | 30 días |

Los deltas de interés abierto son una idea razonable y **no son medibles**: 30 días son unas 30
observaciones en 1d, la única temporalidad que queda operando. Cualquier veredicto sobre esa muestra
sería ruido, y este proyecto ya sabe lo que cuesta confundir las dos cosas.

DXY y VIX exigirían Twelve Data, que sigue sin clave configurada, y habría que comprobar su
histórico antes de contar con ellos.

Qué mide, y en qué se diferencia del Fundamental Score
-------------------------------------------------------
`fundamental.py` sitúa el **nivel** del funding por percentil sobre 90 días y penaliza los largos
cuando está caro. Este vector mide otra cosa: la **variación** del funding respecto a su media
reciente — si el apalancamiento se está cargando o descargando, no si está cargado.

Son preguntas distintas y pueden discrepar: un funding alto y estable describe un mercado
apalancado en equilibrio; uno bajo pero subiendo rápido describe uno que se está cargando. La
segunda es la que este vector intenta capturar.

Sin mirar al futuro
--------------------
El funding se publica cada 8 h y se conoce en el instante en que ocurre. Para la vela `t` se usa el
último valor con `funding_time <= apertura de t`, nunca el de después — que es el error fácil aquí,
porque la serie de funding es más gruesa que la de velas y la tentación es interpolar.
"""

from __future__ import annotations

import json
import urllib.request
from typing import Any

import numpy as np

BASE = "https://fapi.binance.com/fapi/v1/fundingRate"
#: Publicaciones de funding que forman la media de referencia. Ocho horas cada una, así que 21
#: cubren una semana: suficiente para que «lo normal últimamente» tenga sentido y corto para que el
#: momentum siga siendo momentum.
VENTANA_PUBLICACIONES = 21


def historico_funding(symbol: str, desde_ms: int, hasta_ms: int) -> list[tuple[int, float]]:
    """`(funding_time, rate)` entre dos instantes, paginando hacia delante.

    Mismo patrón que `dil.binance_derivs.backfill`: cursor, tope y corte si la API deja de avanzar.
    """
    fuera: list[tuple[int, float]] = []
    cursor = int(desde_ms)
    vistos: set[int] = set()
    while cursor < hasta_ms:
        url = f"{BASE}?symbol={symbol}&startTime={cursor}&endTime={int(hasta_ms)}&limit=1000"
        with urllib.request.urlopen(url, timeout=20) as r:  # noqa: S310 - host fijo
            datos = json.loads(r.read().decode("utf8"))
        if not datos:
            break
        for d in datos:
            ms = int(d["fundingTime"])
            if ms in vistos:
                continue
            vistos.add(ms)
            fuera.append((ms, float(d["fundingRate"])))
        ultimo = int(datos[-1]["fundingTime"])
        if ultimo <= cursor:
            break
        cursor = ultimo + 1
    return sorted(fuera)


def momentum(
    aperturas_ms: list[int],
    funding: list[tuple[int, float]],
    ventana: int = VENTANA_PUBLICACIONES,
) -> dict[int, float]:
    """Momentum del funding en cada vela: valor actual menos su media de las `ventana` anteriores.

    Devuelve `{índice de vela: momentum}`, y **omite** las velas para las que no hay historial
    suficiente en vez de rellenarlas con cero: un hueco no es una lectura neutra, y meterlo como
    tal ensuciaría el tercil que después decide qué se descarta.
    """
    if not funding or not aperturas_ms:
        return {}
    tiempos = np.asarray([t for t, _ in funding], dtype=np.int64)
    tasas = np.asarray([v for _, v in funding], dtype=float)

    fuera: dict[int, float] = {}
    for i, apertura in enumerate(aperturas_ms):
        # Última publicación conocida entonces: `searchsorted` da el primer índice > apertura.
        pos = int(np.searchsorted(tiempos, apertura, side="right")) - 1
        if pos < ventana:  # sin media de referencia todavía
            continue
        fuera[i] = float(tasas[pos] - tasas[pos - ventana : pos].mean())
    return fuera


def describir(valores: dict[int, float]) -> dict[str, Any]:
    """Cuatro cifras para saber si el vector tiene algo que decir antes de juzgarlo."""
    if not valores:
        return {"n": 0}
    v = np.asarray(list(valores.values()), dtype=float)
    return {
        "n": int(v.size),
        "media": float(v.mean()),
        "desviacion": float(v.std()),
        "p33": float(np.quantile(v, 1 / 3)),
        "p67": float(np.quantile(v, 2 / 3)),
    }

"""Flujo de agresores (CVD) — biblioteca de medición. Fase 0: NO vota (Hito B).

Qué es y por qué se busca
--------------------------
Los seis votos de la plataforma valen **1,41 efectivos**: derivan todos del precio, así que son
seis vistas de la misma cosa. El diagnóstico del meta-modelo (AUC 0,4967, dentro de la nula) apuntó
al mismo sitio: no hay señal que extraer porque no hay información nueva que meter. El CVD ataca ese
problema de fondo — **información ortogonal al precio**.

El *Cumulative Volume Delta* mide quién tiene la iniciativa: cuánto volumen se ejecuta contra la
oferta (comprador agresivo) menos cuánto se ejecuta contra la demanda (vendedor agresivo). Dos velas
con el mismo precio de cierre pueden tener flujos opuestos, y ahí está la información que el OHLCV
no contiene.

De dónde sale el dato, y por qué NO hacen falta `aggTrades`
------------------------------------------------------------
El plan original era reconstruir el flujo desde `aggTrades`, operación a operación: ~63 millones de
registros por activo para 90 días, unas 250.000 peticiones. Innecesario. **Las klines de Binance ya
traen el dato agregado** en el campo 9, `taker buy base asset volume`:

    delta = taker_buy − taker_sell = taker_buy − (volumen − taker_buy) = 2·taker_buy − volumen

Verificado el 22 de agosto de 2026 que el campo está presente en el histórico a 90 días vista.
Son ~520 peticiones para los cuatro activos en vez de 250.000.

Y hay una consecuencia que importa más que el ahorro: **es backtesteable**. El *order book
imbalance* se descartó precisamente porque el backtest solo consume `fetch_klines`/OHLCV; el CVD
llega por ese mismo camino, así que se puede medir en backtest sin tocar la infraestructura.

Lo que se pierde frente a `aggTrades` es la distribución dentro de la vela —tamaño de las órdenes,
ráfagas—. Para la pregunta de la Fase 0 eso no hace falta: el delta agregado por vela **es** la
definición canónica del CVD. Si demuestra algo, refinarlo con `aggTrades` sería un paso posterior.

Las dos métricas candidatas, declaradas ANTES de medir
-------------------------------------------------------
1. **`cvd_z`** — CVD acumulado en la ventana, estandarizado. Responde a *«¿cuánta presión compradora
   neta se ha acumulado?»*. Es la lectura directa del indicador.
2. **`divergencia`** — el z del CVD menos el z del retorno de precio en la misma ventana. Responde a
   *«¿el flujo dice algo que el precio no?»*, que es el uso clásico del CVD y, en teoría, lo más
   ortogonal a los seis votos que ya existen.

Son dos y no una porque el estudio necesita declarar sus comparaciones por adelantado, y son dos y
no cinco porque cada una añadida multiplica la corrección de Bonferroni.

Nada de este módulo se importa desde ningún camino de decisión. Igual que `levels.py`.
"""

from __future__ import annotations

from typing import NamedTuple

import numpy as np

#: Velas de la ventana sobre la que se acumula el CVD y se estandariza.
#:
#: 30 y no 200 como en `levels.py`: aquel busca pivotes estructurales, que necesitan historia; el
#: flujo describe la presión *reciente*, y acumularlo sobre cientos de velas lo convierte en una
#: medida de la tendencia de fondo — es decir, en otra copia de los votos de tendencia, que es justo
#: lo que se quiere evitar. Fijado antes de medir nada.
WINDOW = 30
#: Por debajo de esto la ventana no da para estandarizar.
MIN_CANDLES = 15


class Flujo(NamedTuple):
    """Las dos métricas candidatas, más el delta bruto de la última vela para poder auditarlas."""

    cvd_z: float
    divergencia: float
    delta_ratio: float


def delta_por_vela(volumen: float, taker_buy_base: float) -> float:
    """Volumen neto de agresores en una vela: comprador agresivo menos vendedor agresivo.

    `taker_buy_base` es el campo 9 de la kline de Binance. El vendedor agresivo es el resto del
    volumen, así que el neto sale `2·taker_buy − volumen` sin necesidad de más datos.
    """
    return 2.0 * taker_buy_base - volumen


def ratio_por_vela(volumen: float, taker_buy_base: float) -> float:
    """El delta como fracción del volumen, en [−1, 1]. Comparable entre activos y entre épocas.

    Sin normalizar, BTC y BNB no se pueden mirar con la misma vara, y una vela de pánico dominaría
    cualquier ventana solo por su tamaño.
    """
    if volumen <= 0:
        return 0.0
    return max(-1.0, min(1.0, delta_por_vela(volumen, taker_buy_base) / volumen))


def _z(serie: np.ndarray) -> float:
    """Z-score del último valor respecto de la ventana. 0 si no hay dispersión que medir."""
    if serie.size < 2:
        return 0.0
    desv = float(serie.std())
    if desv <= 1e-12:
        return 0.0
    return float((serie[-1] - serie.mean()) / desv)


def score_flujo(
    volumenes: list[float], taker_buys: list[float], closes: list[float]
) -> Flujo | None:
    """Calcula las dos métricas sobre las últimas `WINDOW` velas **ya cerradas**.

    Devuelve `None` si no hay velas suficientes. Quien llama es responsable de pasar solo velas
    cerradas antes del instante que se juzga: aquí no hay forma de saberlo y colar una vela en
    formación sería look-ahead.
    """
    n = min(len(volumenes), len(taker_buys), len(closes))
    if n < MIN_CANDLES:
        return None
    vol = np.asarray(volumenes[-WINDOW:], dtype=float)
    tbb = np.asarray(taker_buys[-WINDOW:], dtype=float)
    cls = np.asarray(closes[-WINDOW:], dtype=float)

    ratios = np.asarray(
        [ratio_por_vela(float(v), float(t)) for v, t in zip(vol, tbb, strict=True)], dtype=float
    )
    # CVD acumulado dentro de la ventana, sobre el ratio y no sobre el delta bruto: acumular
    # volumen sin normalizar haría que una sola vela enorme decidiera toda la ventana.
    cvd = np.cumsum(ratios)
    cvd_z = _z(cvd)

    # Retorno acumulado del precio en la misma ventana, estandarizado igual, para que la resta
    # compare dos cosas en la misma escala.
    base = float(cls[0])
    retornos = (cls / base - 1.0) if base > 0 else np.zeros_like(cls)
    divergencia = cvd_z - _z(np.asarray(retornos, dtype=float))

    return Flujo(cvd_z=cvd_z, divergencia=divergencia, delta_ratio=float(ratios[-1]))

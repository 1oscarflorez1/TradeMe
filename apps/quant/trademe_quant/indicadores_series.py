"""Los mismos indicadores, calculados **una vez para toda la serie** en lugar de una vez por vela.

Por qué existe
---------------
`run_backtest` llamaba a `decide(high[:t+1], …)` en cada vela, y `decide` a `compute_readings`, que
recorre la serie entera en cada uno de sus nueve indicadores. Coste O(N²), medido:

| velas | segundos | ×tiempo | ×velas |
|---|---|---|---|
| 250 | 0,024 | 1,0 | 1,0 |
| 500 | 0,107 | 4,4 | 2,0 |
| 1000 | 0,375 | 15,5 | 4,0 |

Al doblar las velas el tiempo se cuadruplica. Multiplicar por diez la ventana llevaría el piloto de
~9 minutos a más de 15 horas, y por cien a más de mil: alargar la ventana de optimización era
imposible sin esto.

Por qué el resultado es idéntico, no parecido
----------------------------------------------
Los ocho indicadores son **prefijo-calculables**: el valor en `t` depende solo de datos hasta `t`.
EMA, RSI, ATR y ADX son recursiones de Wilder sembradas con una media al principio de la serie;
Estocástico y Bollinger son ventanas de los últimos `period`; Supertrend arrastra un estado
(bandas + dirección) que se propaga hacia delante. Ninguno mira al futuro.

Por eso `serie(high, low, close)[t]` produce **el mismo número** que
`compute_readings(high[:t+1], …)`, no una aproximación. Hay un test que lo comprueba vela a vela
sobre datos reales y exige igualdad exacta.

Lo que NO se toca
------------------
Las funciones `*_last` de `indicators.py` se quedan como están: son el mirror de Node y las que
sostienen la suite de paridad. Este módulo es una vía rápida **para el backtest**, y su corrección
se define como «coincidir con ellas». Si alguna vez divergen, manda `indicators.py` y el test falla.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np
import numpy.typing as npt

from .indicators import _atr_series, _true_range, clamp

FloatArr = npt.NDArray[np.float64]

#: Barras necesarias antes de poder emitir la primera lectura completa. Manda el Supertrend, que
#: exige al menos 5 barras de ATR ya calentado sobre su periodo de 10.
CALENTAMIENTO = 40


def ema_series_alineada(values: FloatArr, period: int) -> FloatArr:
    """EMA en cada índice de `values`; `nan` mientras no hay semilla.

    `indicators._ema_series` devuelve un array comprimido cuyo elemento 0 corresponde a la vela
    `period-1`. Aquí se realinea a la serie original para poder indexar por vela sin restar nada.
    """
    n = len(values)
    out = np.full(n, np.nan)
    if n < period:
        return out
    k = 2.0 / (period + 1)
    out[period - 1] = float(values[:period].mean())
    for i in range(period, n):
        out[i] = values[i] * k + out[i - 1] * (1 - k)
    return out


def rsi_series(values: FloatArr, period: int = 14) -> FloatArr:
    """RSI de Wilder en cada índice. Misma semilla y misma recursión que `rsi_last`."""
    n = len(values)
    out = np.full(n, np.nan)
    if n <= period:
        return out
    ch = np.diff(values)
    gains = np.where(ch > 0, ch, 0.0)
    losses = np.where(ch < 0, -ch, 0.0)
    avg_gain = float(gains[:period].mean())
    avg_loss = float(losses[:period].mean())
    out[period] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    for i in range(period, len(ch)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        out[i + 1] = 100.0 if avg_loss == 0 else 100 - 100 / (1 + avg_gain / avg_loss)
    return out


def atr_series(high: FloatArr, low: FloatArr, close: FloatArr, period: int = 14) -> FloatArr:
    """ATR de Wilder en cada índice, con la alineación de `atr_last`."""
    n = len(high)
    out = np.full(n, np.nan)
    if n < period:
        return out
    tr = _true_range(high, low, close)
    atr = float(tr[:period].mean())
    out[period - 1] = atr
    for i in range(period, n):
        atr = (atr * (period - 1) + tr[i]) / period
        out[i] = atr
    return out


def stoch_k_series(high: FloatArr, low: FloatArr, close: FloatArr, period: int = 14) -> FloatArr:
    """%K en cada índice, sobre la ventana de las últimas `period` barras."""
    n = len(high)
    out = np.full(n, np.nan)
    for i in range(period - 1, n):
        hh = float(high[i - period + 1 : i + 1].max())
        ll = float(low[i - period + 1 : i + 1].min())
        out[i] = 50.0 if hh == ll else 100 * (close[i] - ll) / (hh - ll)
    return out


def bollinger_pb_series(values: FloatArr, period: int = 20, stddev: float = 2.0) -> FloatArr:
    """%B en cada índice. Desviación de **población** (ddof=0), como `bollinger_pb_last`."""
    n = len(values)
    out = np.full(n, np.nan)
    for i in range(period - 1, n):
        w = values[i - period + 1 : i + 1]
        mid = float(w.mean())
        sd = math.sqrt(float(((w - mid) ** 2).mean()))
        upper, lower = mid + stddev * sd, mid - stddev * sd
        out[i] = 0.5 if upper == lower else (float(values[i]) - lower) / (upper - lower)
    return out


def macd_hist_series(values: FloatArr, fast: int = 12, slow: int = 26, signal: int = 9) -> FloatArr:
    """Histograma MACD en cada índice, con las mismas EMAs encadenadas que `macd_hist_last`."""
    n = len(values)
    out = np.full(n, np.nan)
    ema_fast = ema_series_alineada(values, fast)
    ema_slow = ema_series_alineada(values, slow)
    macd_line = ema_fast - ema_slow  # nan mientras la lenta no tiene semilla
    inicio = slow - 1
    if n <= inicio:
        return out
    # La señal es una EMA sobre la línea MACD, que empieza en `slow - 1`. Se calcula sobre el tramo
    # válido y se vuelve a alinear: encadenar EMAs es justo donde es fácil desplazarse una barra.
    sig_tramo = ema_series_alineada(macd_line[inicio:], signal)
    out[inicio:] = macd_line[inicio:] - sig_tramo
    return out


def adx_series(high: FloatArr, low: FloatArr, close: FloatArr, period: int = 14) -> FloatArr:
    """ADX de Wilder en cada índice. Mismo suavizado acumulado y misma semilla que `adx_last`."""
    n = len(high)
    out = np.full(n, np.nan)
    if n < 2 * period:
        return out
    plus_dm = np.zeros(n)
    minus_dm = np.zeros(n)
    tr = np.zeros(n)
    tr[0] = high[0] - low[0]
    for i in range(1, n):
        up = high[i] - high[i - 1]
        down = low[i - 1] - low[i]
        plus_dm[i] = up if (up > down and up > 0) else 0.0
        minus_dm[i] = down if (down > up and down > 0) else 0.0
        tr[i] = max(high[i] - low[i], abs(high[i] - close[i - 1]), abs(low[i] - close[i - 1]))

    def wilder(x: FloatArr) -> FloatArr:
        sm = np.zeros(n)
        sm[period] = x[1 : period + 1].sum()
        for i in range(period + 1, n):
            sm[i] = sm[i - 1] - sm[i - 1] / period + x[i]
        return sm

    str_, pdm, mdm = wilder(tr), wilder(plus_dm), wilder(minus_dm)
    dx = np.zeros(n)
    for i in range(period, n):
        if str_[i] == 0:
            continue
        pdi = 100 * pdm[i] / str_[i]
        mdi = 100 * mdm[i] / str_[i]
        s = pdi + mdi
        dx[i] = 0.0 if s == 0 else 100 * abs(pdi - mdi) / s

    first = 2 * period
    adx = float(dx[period:first].mean())
    out[first - 1] = adx
    for i in range(first, n):
        adx = (adx * (period - 1) + dx[i]) / period
        out[i] = adx
    return out


def supertrend_series(
    high: FloatArr,
    low: FloatArr,
    close: FloatArr,
    period: int = 10,
    multiplier: float = 3.0,
) -> tuple[FloatArr, FloatArr, FloatArr]:
    """Línea, dirección y ATR del Supertrend en cada índice.

    El bucle es el mismo de `supertrend_last`; la única diferencia es que aquí se anota el estado
    en cada paso en vez de devolver solo el último. Como el estado solo depende del pasado, el
    valor anotado en `t` es idéntico al que devolvería `supertrend_last(serie[:t+1])`.
    """
    n = len(high)
    linea = np.full(n, np.nan)
    direccion = np.full(n, np.nan)
    atr_out = np.full(n, np.nan)
    # `_atr_series` declara `Sequence[float]`; un ndarray lo cumple en la práctica pero no
    # en la firma, así que se convierte explícitamente en vez de relajar el tipo de allí.
    serie_atr = _atr_series(high.tolist(), low.tolist(), close.tolist(), period)
    if len(serie_atr) < 5:
        return linea, direccion, atr_out

    final_upper = 0.0
    final_lower = 0.0
    trend = 1
    offset = period
    for i, atr in enumerate(serie_atr):
        ci = i + offset
        if ci >= n:
            break
        medio = (high[ci] + low[ci]) / 2
        basic_upper = medio + multiplier * atr
        basic_lower = medio - multiplier * atr
        if i == 0:
            final_upper, final_lower = basic_upper, basic_lower
            trend = -1 if close[ci] <= final_upper else 1
        else:
            prev_close = close[ci - 1]
            if basic_upper < final_upper or prev_close > final_upper:
                final_upper = basic_upper
            if basic_lower > final_lower or prev_close < final_lower:
                final_lower = basic_lower
            if trend == 1:
                trend = -1 if close[ci] < final_lower else 1
            else:
                trend = 1 if close[ci] > final_upper else -1
        # `supertrend_last` solo emite cuando hay al menos 5 barras de ATR calentado.
        if i >= 4:
            linea[ci] = final_lower if trend == 1 else final_upper
            direccion[ci] = trend
            atr_out[ci] = float(atr)
    return linea, direccion, atr_out


def readings_series(
    high: Sequence[float], low: Sequence[float], close: Sequence[float]
) -> list[dict[str, dict[str, float]] | None]:
    """Las lecturas de **cada** vela, en una sola pasada.

    Devuelve una lista alineada con la serie: `salida[t]` es lo que `compute_readings(high[:t+1],
    …)` habría devuelto, o `None` mientras no hay historial suficiente para todos los indicadores.
    """
    h = np.asarray(high, dtype=float)
    lo = np.asarray(low, dtype=float)
    c = np.asarray(close, dtype=float)
    n = len(c)

    atr = atr_series(h, lo, c)
    ema9 = ema_series_alineada(c, 9)
    ema21 = ema_series_alineada(c, 21)
    rsi = rsi_series(c)
    k = stoch_k_series(h, lo, c)
    pb = bollinger_pb_series(c)
    hist = macd_hist_series(c)
    adx = adx_series(h, lo, c)
    st_line, _st_dir, st_atr = supertrend_series(h, lo, c)

    salida: list[dict[str, dict[str, float]] | None] = []
    for t in range(n):
        valores = (atr[t], ema9[t], ema21[t], rsi[t], k[t], pb[t], hist[t], adx[t], st_line[t])
        if any(math.isnan(float(v)) for v in valores):
            salida.append(None)
            continue
        a = float(atr[t])
        ema_diff = float(ema9[t]) - float(ema21[t])
        ema_score = clamp(math.tanh(ema_diff / a)) if a else 0.0
        macd_score = clamp(math.tanh(float(hist[t]) / a)) if a else 0.0
        sa = float(st_atr[t])
        st_score = clamp(math.tanh((float(c[t]) - float(st_line[t])) / sa)) if sa else 0.0
        rsi_score = clamp((50 - float(rsi[t])) / 20)
        stoch_score = clamp((50 - float(k[t])) / 30)
        bb_score = clamp(1 - 2 * float(pb[t]))
        salida.append(
            {
                "ema_cross": {
                    "value": ema_diff,
                    "score": ema_score,
                    "confidence": abs(ema_score),
                },
                "macd": {
                    "value": float(hist[t]),
                    "score": macd_score,
                    "confidence": abs(macd_score),
                },
                "supertrend": {
                    "value": float(st_line[t]),
                    "score": st_score,
                    "confidence": abs(st_score),
                },
                "rsi14": {"value": float(rsi[t]), "score": rsi_score, "confidence": abs(rsi_score)},
                "bbands": {"value": float(pb[t]), "score": bb_score, "confidence": abs(bb_score)},
                "stoch14": {
                    "value": float(k[t]),
                    "score": stoch_score,
                    "confidence": abs(stoch_score),
                },
                "adx14": {
                    "value": float(adx[t]),
                    "score": 0.0,
                    "confidence": clamp(float(adx[t]) / 50, 0, 1),
                },
                "atr14": {"value": a, "score": 0.0, "confidence": 0.0},
            }
        )
    return salida

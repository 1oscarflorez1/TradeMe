"""Mirror de los indicadores base (paridad con apps/api / technicalindicators).

Se replican las convenciones de `technicalindicators` (semilla SMA + suavizado de
Wilder para RSI/ATR/ADX) para igualar los vectores dorados dentro de tolerancia.
La normalización a `score` en [-1,+1] es idéntica a la de Node.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

import numpy as np


def clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def _ema_series(values: np.ndarray, period: int) -> np.ndarray:
    k = 2.0 / (period + 1)
    out = np.empty(len(values) - period + 1)
    out[0] = float(values[:period].mean())
    for i in range(period, len(values)):
        out[i - period + 1] = values[i] * k + out[i - period] * (1 - k)
    return out


def ema_last(values: Sequence[float], period: int) -> float:
    return float(_ema_series(np.asarray(values, dtype=float), period)[-1])


def rsi_last(values: Sequence[float], period: int = 14) -> float:
    v = np.asarray(values, dtype=float)
    ch = np.diff(v)
    gains = np.where(ch > 0, ch, 0.0)
    losses = np.where(ch < 0, -ch, 0.0)
    avg_gain = float(gains[:period].mean())
    avg_loss = float(losses[:period].mean())
    for i in range(period, len(ch)):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - 100 / (1 + rs)


def _true_range(high: np.ndarray, low: np.ndarray, close: np.ndarray) -> np.ndarray:
    tr = np.empty(len(high))
    tr[0] = high[0] - low[0]
    for i in range(1, len(high)):
        tr[i] = max(
            high[i] - low[i],
            abs(high[i] - close[i - 1]),
            abs(low[i] - close[i - 1]),
        )
    return tr


def atr_last(
    high: Sequence[float], low: Sequence[float], close: Sequence[float], period: int = 14
) -> float:
    tr = _true_range(
        np.asarray(high, dtype=float),
        np.asarray(low, dtype=float),
        np.asarray(close, dtype=float),
    )
    atr = float(tr[:period].mean())
    for i in range(period, len(tr)):
        atr = (atr * (period - 1) + tr[i]) / period
    return atr


def stoch_k_last(
    high: Sequence[float], low: Sequence[float], close: Sequence[float], period: int = 14
) -> float:
    h = np.asarray(high, dtype=float)
    low_a = np.asarray(low, dtype=float)
    c = np.asarray(close, dtype=float)
    hh = float(h[-period:].max())
    ll = float(low_a[-period:].min())
    if hh == ll:
        return 50.0
    return 100 * (c[-1] - ll) / (hh - ll)


def macd_hist_last(
    values: Sequence[float], fast: int = 12, slow: int = 26, signal: int = 9
) -> float:
    v = np.asarray(values, dtype=float)
    ema_fast = _ema_series(v, fast)
    ema_slow = _ema_series(v, slow)
    offset = slow - fast
    macd_line = ema_fast[offset:] - ema_slow
    sig = _ema_series(macd_line, signal)
    return float(macd_line[-1] - sig[-1])


def bollinger_pb_last(values: Sequence[float], period: int = 20, stddev: float = 2.0) -> float:
    v = np.asarray(values, dtype=float)
    window = v[-period:]
    mid = float(window.mean())
    sd = math.sqrt(float(((window - mid) ** 2).mean()))  # población (ddof=0)
    upper = mid + stddev * sd
    lower = mid - stddev * sd
    if upper == lower:
        return 0.5
    return (float(v[-1]) - lower) / (upper - lower)


def adx_last(
    high: Sequence[float], low: Sequence[float], close: Sequence[float], period: int = 14
) -> float:
    h = np.asarray(high, dtype=float)
    low_a = np.asarray(low, dtype=float)
    c = np.asarray(close, dtype=float)
    n = len(h)
    plus_dm = np.zeros(n)
    minus_dm = np.zeros(n)
    tr = np.zeros(n)
    tr[0] = h[0] - low_a[0]
    for i in range(1, n):
        up = h[i] - h[i - 1]
        down = low_a[i - 1] - low_a[i]
        plus_dm[i] = up if (up > down and up > 0) else 0.0
        minus_dm[i] = down if (down > up and down > 0) else 0.0
        tr[i] = max(h[i] - low_a[i], abs(h[i] - c[i - 1]), abs(low_a[i] - c[i - 1]))

    def wilder(x: np.ndarray) -> np.ndarray:
        sm = np.zeros(n)
        sm[period] = x[1 : period + 1].sum()
        for i in range(period + 1, n):
            sm[i] = sm[i - 1] - sm[i - 1] / period + x[i]
        return sm

    str_ = wilder(tr)
    pdm = wilder(plus_dm)
    mdm = wilder(minus_dm)
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
    for i in range(first, n):
        adx = (adx * (period - 1) + dx[i]) / period
    return adx


# ---- normalización a voto (idéntica a Node) ----


def compute_readings(
    high: Sequence[float], low: Sequence[float], close: Sequence[float]
) -> dict[str, dict[str, float]]:
    atr = atr_last(high, low, close)
    ema9 = ema_last(close, 9)
    ema21 = ema_last(close, 21)
    rsi = rsi_last(close)
    k = stoch_k_last(high, low, close)
    pb = bollinger_pb_last(close)
    hist = macd_hist_last(close)
    adx = adx_last(high, low, close)

    ema_diff = ema9 - ema21
    ema_score = clamp(math.tanh(ema_diff / atr)) if atr else 0.0
    macd_score = clamp(math.tanh(hist / atr)) if atr else 0.0
    rsi_score = clamp((50 - rsi) / 20)
    stoch_score = clamp((50 - k) / 30)
    bb_score = clamp(1 - 2 * pb)

    return {
        "ema_cross": {"value": ema_diff, "score": ema_score, "confidence": abs(ema_score)},
        "macd": {"value": hist, "score": macd_score, "confidence": abs(macd_score)},
        "rsi14": {"value": rsi, "score": rsi_score, "confidence": abs(rsi_score)},
        "bbands": {"value": pb, "score": bb_score, "confidence": abs(bb_score)},
        "stoch14": {"value": k, "score": stoch_score, "confidence": abs(stoch_score)},
        "adx14": {"value": adx, "score": 0.0, "confidence": clamp(adx / 50, 0, 1)},
        "atr14": {"value": atr, "score": 0.0, "confidence": 0.0},
    }

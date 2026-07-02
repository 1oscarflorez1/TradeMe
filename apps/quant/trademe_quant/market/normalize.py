from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Sequence
from typing import Any

INTERVAL_MS: dict[str, int] = {"1m": 60_000, "1h": 3_600_000}


@dataclass(frozen=True)
class Candle:
    """Vela OHLCV normalizada (mismo esquema que apps/api)."""

    symbol: str
    interval: str
    open_time: int
    open: float
    high: float
    low: float
    close: float
    volume: float
    close_time: int
    closed: bool


def interval_ms(interval: str) -> int:
    try:
        return INTERVAL_MS[interval]
    except KeyError as exc:
        raise ValueError(f"intervalo no soportado: {interval}") from exc


def normalize_rest_kline(symbol: str, interval: str, row: Sequence[Any]) -> Candle:
    """Normaliza un kline REST de Binance ([openTime, o, h, l, c, v, closeTime, ...])."""
    return Candle(
        symbol=symbol.upper(),
        interval=interval,
        open_time=int(row[0]),
        open=float(row[1]),
        high=float(row[2]),
        low=float(row[3]),
        close=float(row[4]),
        volume=float(row[5]),
        close_time=int(row[6]),
        closed=True,
    )


def detect_gaps(candles: Sequence[Candle], interval: str) -> list[tuple[int, int]]:
    """Rangos (open_prev, open_sig) donde faltan velas según el paso del intervalo."""
    step = interval_ms(interval)
    ordered = sorted(candles, key=lambda c: c.open_time)
    gaps: list[tuple[int, int]] = []
    for prev, nxt in zip(ordered, ordered[1:], strict=False):
        if nxt.open_time - prev.open_time != step:
            gaps.append((prev.open_time, nxt.open_time))
    return gaps

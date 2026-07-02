from __future__ import annotations

from collections.abc import Callable, Sequence
from typing import Any, Protocol

from .market.normalize import Candle, normalize_rest_kline

FetchKlines = Callable[[str, str, int], Sequence[Sequence[Any]]]


class CandleSink(Protocol):
    def write(self, candle: Candle) -> None: ...


def seed_history(
    symbol: str,
    interval: str,
    limit: int,
    fetch: FetchKlines,
    sink: CandleSink,
) -> int:
    """Siembra el histórico en el sink. Idempotente por open_time dentro del lote.

    La idempotencia entre ejecuciones la garantiza el UPSERT del sink de DB.
    """
    rows = fetch(symbol, interval, limit)
    seen: set[int] = set()
    written = 0
    for row in rows:
        candle = normalize_rest_kline(symbol, interval, row)
        if candle.open_time in seen:
            continue
        seen.add(candle.open_time)
        sink.write(candle)
        written += 1
    return written


def seed_from_binance(symbol: str, interval: str, limit: int, dsn: str) -> int:
    """Siembra el histórico real de Binance en TimescaleDB. Requiere red y DB."""
    from .db import PgCandleSink
    from .market.binance import fetch_klines

    sink = PgCandleSink(dsn)
    try:
        return seed_history(symbol, interval, limit, fetch_klines, sink)
    finally:
        sink.close()

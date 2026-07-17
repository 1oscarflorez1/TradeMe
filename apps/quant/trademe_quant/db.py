from __future__ import annotations

from typing import Any

from .market.normalize import Candle

_UPSERT = """
INSERT INTO candles (symbol, interval, ts, open, high, low, close, volume)
VALUES (%s, %s, to_timestamp(%s / 1000.0), %s, %s, %s, %s, %s)
ON CONFLICT (symbol, interval, ts) DO UPDATE SET
  open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
  close = EXCLUDED.close, volume = EXCLUDED.volume
"""


class PgCandleSink:
    """Sink que persiste velas en TimescaleDB vía psycopg (import perezoso)."""

    def __init__(self, dsn: str) -> None:
        import psycopg

        self._conn: Any = psycopg.connect(dsn)

    def write(self, candle: Candle) -> None:
        with self._conn.cursor() as cur:
            cur.execute(
                _UPSERT,
                (
                    candle.symbol,
                    candle.interval,
                    candle.open_time,
                    candle.open,
                    candle.high,
                    candle.low,
                    candle.close,
                    candle.volume,
                ),
            )
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

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


def save_backtest(dsn: str, symbol: str, interval: str, result: dict[str, Any]) -> None:
    """Persiste el resultado de un backtest en la tabla backtests."""
    import json

    import psycopg

    m = result["metrics"]
    oos = result["oos_metrics"]
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO backtests
              (symbol, interval, n_trades, win_rate, expectancy, profit_factor,
               max_drawdown, sharpe, oos_win_rate, oos_expectancy, metrics, trades, equity_curve)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                symbol.upper(),
                interval,
                m["n_trades"],
                m["win_rate"],
                m["expectancy"],
                m["profit_factor"],
                m["max_drawdown"],
                m["sharpe"],
                oos["win_rate"],
                oos["expectancy"],
                json.dumps({"metrics": m, "oos_metrics": oos}),
                json.dumps(result["trades"]),
                json.dumps(m["equity_curve"]),
            ),
        )
        conn.commit()


def evaluate_snapshot_outcomes(dsn: str, horizon: int = 20) -> int:
    """Rellena outcome_* de los snapshots pendientes usando las velas posteriores."""
    import psycopg

    from .backtest import evaluate_trade

    updated = 0
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, symbol, interval, captured_at, direction,
                       plan_entry, plan_stop, plan_take_profit
                FROM snapshots
                WHERE outcome_result IS NULL AND plan_entry IS NOT NULL
                      AND direction IN ('LONG','SHORT')
                """)
            pending = cur.fetchall()
        for row in pending:
            sid, symbol, interval, captured_at, direction, entry, stop, tp = row
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT high, low, close FROM candles
                    WHERE symbol=%s AND interval=%s AND ts > %s
                    ORDER BY ts LIMIT %s
                    """,
                    (symbol, interval, captured_at, horizon),
                )
                future = cur.fetchall()
            if not future:
                continue
            res = evaluate_trade(
                direction,
                float(entry),
                float(stop),
                float(tp),
                [float(r[0]) for r in future],
                [float(r[1]) for r in future],
                [float(r[2]) for r in future],
            )
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE snapshots
                    SET outcome_result=%s, outcome_return_r=%s, evaluated_at=now()
                    WHERE id=%s
                    """,
                    (res["result"], res["r"], sid),
                )
            updated += 1
        conn.commit()
    return updated

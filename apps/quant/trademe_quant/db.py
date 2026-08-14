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


def evaluate_shadow_outcomes(
    dsn: str, horizon: int = 20, horizons: dict[str, int] | None = None
) -> int:
    """Puntúa las decisiones **sombra**: las que la cuarentena impidió emitir (M10.7).

    Una temporalidad en cuarentena no opera, así que no genera ninguna operación real que evaluar.
    Sin esto no podría acumular expediente y la cuarentena sería irreversible por construcción: la
    temporalidad quedaría vetada para siempre por no poder demostrar lo contrario.

    Mismas reglas de cierre que el desenlace real —primer toque, horizonte completo para declarar
    timeout— pero en `shadow_outcome_*`. **Estas cifras no son rendimiento**: nadie operó. Sirven
    para decidir si la cuarentena se levanta, y para nada más.
    """
    import psycopg

    from .backtest import evaluate_trade

    updated = 0
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, symbol, interval, captured_at, shadow_direction,
                       shadow_entry, shadow_stop, shadow_take_profit
                FROM snapshots
                WHERE shadow_outcome_result IS NULL AND shadow_entry IS NOT NULL
                      AND shadow_direction IN ('LONG','SHORT')
                """)
            pending = cur.fetchall()
        for row in pending:
            sid, symbol, interval, captured_at, direction, entry, stop, tp = row
            h = (horizons or {}).get(str(interval), horizon)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT high, low, close FROM candles
                    WHERE symbol=%s AND interval=%s AND ts > %s
                    ORDER BY ts LIMIT %s
                    """,
                    (symbol, interval, captured_at, h),
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
            if res["result"] == "timeout" and len(future) < h:
                continue
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE snapshots
                    SET shadow_outcome_result=%s, shadow_outcome_return_r=%s,
                        shadow_evaluated_at=now()
                    WHERE id=%s
                    """,
                    (res["result"], res["r"], sid),
                )
            updated += 1
        conn.commit()
    return updated


def evaluate_snapshot_outcomes(
    dsn: str, horizon: int = 20, horizons: dict[str, int] | None = None
) -> int:
    """Rellena outcome_* de los snapshots pendientes usando las velas posteriores.

    Regla de cierre, deliberadamente asimétrica:

    - Un toque de objetivo o de stop es DEFINITIVO aunque ocurra en la primera vela: el precio
      estuvo ahí y eso ya no cambia. Se cierra siempre.
    - Un «timeout» solo es válido si de verdad transcurrió el horizonte completo. Cerrar por tiempo
      con tres velas disponibles no significa que la operación no fuera a ninguna parte, significa
      que aún no le hemos dado tiempo. Antes se cerraban igual y, como el resultado dejaba de ser
      nulo, no se volvían a evaluar jamás: en 1d eso convertía el 100 % de los registros en timeouts
      artificiales.

    El horizonte es **por temporalidad** desde M10.5 (`horizons`). Las 20 velas fijas anteriores
    eran 20 minutos en 1m y 20 días en 1d: en las cortas cerraban por tiempo operaciones que aún
    tenían recorrido —el 31 % del total—, y en 1d, 1w y 1M exigían más histórico del que existe, de
    modo que esos registros no llegaban a evaluarse nunca. `horizon` queda como reserva para las
    temporalidades que no aparezcan en el mapa.
    """
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
            h = (horizons or {}).get(str(interval), horizon)
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT high, low, close FROM candles
                    WHERE symbol=%s AND interval=%s AND ts > %s
                    ORDER BY ts LIMIT %s
                    """,
                    (symbol, interval, captured_at, h),
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
            # Sin el horizonte completo, un «timeout» es prematuro: se deja pendiente.
            if res["result"] == "timeout" and len(future) < h:
                continue
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


def last_backtests(dsn: str, symbol: str, interval: str, limit: int = 2) -> list[dict[str, Any]]:
    """Últimas mediciones (más reciente primero) para decidir si hay degradación."""
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT expectancy, n_trades,
                      EXTRACT(EPOCH FROM (now() - created_at)) / 3600 AS hours_ago
               FROM backtests WHERE symbol = %s AND interval = %s
               ORDER BY created_at DESC LIMIT %s""",
            (symbol.upper(), interval, limit),
        )
        return [
            {
                "expectancy": float(r[0]) if r[0] is not None else 0.0,
                "n_trades": int(r[1] or 0),
                "hours_ago": float(r[2]),
            }
            for r in cur.fetchall()
        ]


def insert_alert(
    dsn: str,
    type_: str,
    severity: str,
    title: str,
    message: str,
    symbol: str | None = None,
    interval: str | None = None,
) -> None:
    """Crea una alerta (campana del portal) desde el worker de automatización."""
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO alerts (symbol, interval, type, severity, title, message)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (symbol, interval, type_, severity, title, message),
        )
        conn.commit()

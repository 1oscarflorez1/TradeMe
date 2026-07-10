"""Lectura y validación de alertas externas (TradingView / Reditum).

Semilla del replay de señales externas para el backtest (M6). En M5 solo se valida el
esquema y se ofrece un lector desde DB (import perezoso de psycopg).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

REQUIRED_FIELDS = ["source", "strategy", "symbol", "score", "ts"]


class ExternalSignalError(ValueError):
    """Una fila de external_signals no cumple el esquema esperado."""


@dataclass(frozen=True)
class ExternalSignal:
    source: str
    strategy: str
    symbol: str
    score: float
    ts: str
    signal: str | None = None
    tf: str | None = None


def normalize_external_row(row: dict[str, Any]) -> ExternalSignal:
    for field in REQUIRED_FIELDS:
        if row.get(field) is None:
            raise ExternalSignalError(f"falta el campo requerido: {field}")
    return ExternalSignal(
        source=str(row["source"]),
        strategy=str(row["strategy"]),
        symbol=str(row["symbol"]),
        score=float(row["score"]),
        ts=str(row["ts"]),
        signal=str(row["signal"]) if row.get("signal") is not None else None,
        tf=str(row["tf"]) if row.get("tf") is not None else None,
    )


def load_external_signals(dsn: str, symbol: str) -> list[ExternalSignal]:
    """Lee las alertas registradas para replay en backtest (M6). Requiere DB."""
    import psycopg

    out: list[ExternalSignal] = []
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT source, strategy, symbol, score, ts, signal, tf "
            "FROM external_signals WHERE symbol = %s ORDER BY ts",
            (symbol,),
        )
        for r in cur.fetchall():
            out.append(
                normalize_external_row(
                    {
                        "source": r[0],
                        "strategy": r[1],
                        "symbol": r[2],
                        "score": r[3],
                        "ts": r[4],
                        "signal": r[5],
                        "tf": r[6],
                    }
                )
            )
    return out

"""Harness de backtesting sin look-ahead (M6).

Recorre las velas usando solo datos hasta t, reproduce la decisión (mirror de Node) y
evalúa cada trade por primer toque (peor caso: si una vela toca SL y TP, gana el SL).
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from typing import Any

from .decision import decide

MIN_CANDLES = 50


def evaluate_trade(
    direction: str,
    entry: float,
    stop: float,
    take_profit: float,
    future_high: Sequence[float],
    future_low: Sequence[float],
    future_close: Sequence[float],
) -> dict[str, Any]:
    """Resultado de un trade sobre las velas futuras (primer toque, peor caso SL)."""
    risk = abs(entry - stop)
    for i in range(len(future_high)):
        high = future_high[i]
        low = future_low[i]
        if direction == "LONG":
            if low <= stop:  # peor caso: SL antes que TP
                return {"result": "sl", "r": -1.0, "bars": i + 1}
            if high >= take_profit:
                return {"result": "tp", "r": (take_profit - entry) / risk, "bars": i + 1}
        else:  # SHORT
            if high >= stop:
                return {"result": "sl", "r": -1.0, "bars": i + 1}
            if low <= take_profit:
                return {"result": "tp", "r": (entry - take_profit) / risk, "bars": i + 1}
    # timeout: cierre al final del horizonte
    if len(future_close) > 0 and risk > 0:
        last = future_close[-1]
        r = (last - entry) / risk if direction == "LONG" else (entry - last) / risk
        return {"result": "timeout", "r": r, "bars": len(future_close)}
    return {"result": "timeout", "r": 0.0, "bars": 0}


def compute_metrics(trades: Sequence[dict[str, Any]]) -> dict[str, Any]:
    rs = [float(t["r"]) for t in trades]
    n = len(rs)
    if n == 0:
        return {
            "n_trades": 0,
            "win_rate": 0.0,
            "expectancy": 0.0,
            "profit_factor": None,
            "max_drawdown": 0.0,
            "sharpe": 0.0,
            "equity_curve": [],
        }
    wins = [r for r in rs if r > 0]
    losses = [r for r in rs if r <= 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    equity: list[float] = []
    cum = 0.0
    peak = 0.0
    max_dd = 0.0
    for r in rs:
        cum += r
        equity.append(cum)
        peak = max(peak, cum)
        max_dd = max(max_dd, peak - cum)
    sharpe = 0.0
    if n > 1 and statistics.pstdev(rs) > 0:
        sharpe = statistics.mean(rs) / statistics.pstdev(rs)
    return {
        "n_trades": n,
        "win_rate": len(wins) / n,
        "expectancy": sum(rs) / n,
        "profit_factor": (gross_win / gross_loss) if gross_loss > 0 else None,
        "max_drawdown": max_dd,
        "sharpe": sharpe,
        "equity_curve": equity,
    }


def run_backtest(
    high: Sequence[float],
    low: Sequence[float],
    close: Sequence[float],
    config: dict[str, Any],
    horizon: int = 20,
    macro_bias: float | None = None,
    oos_split: float = 0.7,
) -> dict[str, Any]:
    """Ejecuta el backtest y devuelve trades, métricas globales y out-of-sample."""
    trades: list[dict[str, Any]] = []
    n = len(close)
    t = MIN_CANDLES
    while t < n - 1:
        d = decide(high[: t + 1], low[: t + 1], close[: t + 1], config, macro_bias)
        levels = d["levels"]
        if d["action"] in ("BUY", "SELL") and levels is not None:
            end = min(n, t + 1 + horizon)
            res = evaluate_trade(
                d["direction"],
                levels["entry"],
                levels["stop"],
                levels["take_profit"],
                high[t + 1 : end],
                low[t + 1 : end],
                close[t + 1 : end],
            )
            trades.append(
                {
                    "index": t,
                    "direction": d["direction"],
                    "entry": levels["entry"],
                    "stop": levels["stop"],
                    "take_profit": levels["take_profit"],
                    **res,
                }
            )
            t += res["bars"] + 1
        else:
            t += 1

    split = int(n * oos_split)
    oos = [tr for tr in trades if tr["index"] >= split]
    return {
        "trades": trades,
        "metrics": compute_metrics(trades),
        "oos_metrics": compute_metrics(oos),
        "oos_split_index": split,
    }

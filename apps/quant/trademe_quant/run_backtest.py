"""Backtest sobre histórico de Binance y evaluación de snapshots pendientes.

CLI:  python -m trademe_quant.run_backtest BTCUSDT 5m
También expone run_and_save() para el servicio HTTP.
"""

from __future__ import annotations

import os
import pathlib
import sys
from typing import Any

from .backtest import run_backtest
from .db import evaluate_snapshot_outcomes, save_backtest
from .ensemble import load_ensemble
from .market.binance import fetch_klines
from .market.normalize import normalize_rest_kline


def _dsn() -> str:
    return os.environ.get("DATABASE_URL", "postgresql://trademe:trademe@localhost:5432/trademe")


def _ensemble_path() -> str:
    return os.environ.get(
        "ENSEMBLE_CONFIG",
        str(pathlib.Path(__file__).resolve().parents[3] / "artifacts/ensemble.yaml"),
    )


def run_and_save(symbol: str, interval: str) -> dict[str, Any]:
    """Corre el backtest, lo guarda y evalúa snapshots. Devuelve métricas."""
    rows = fetch_klines(symbol, interval, limit=1000)
    candles = [normalize_rest_kline(symbol, interval, r) for r in rows]
    high = [c.high for c in candles]
    low = [c.low for c in candles]
    close = [c.close for c in candles]
    config = load_ensemble(_ensemble_path())
    result = run_backtest(high, low, close, config)
    save_backtest(_dsn(), symbol, interval, result)
    evaluated = 0
    try:
        evaluated = evaluate_snapshot_outcomes(_dsn())
    except Exception:  # noqa: BLE001 - paso secundario
        evaluated = 0
    return {
        "symbol": symbol,
        "interval": interval,
        "metrics": result["metrics"],
        "oos_metrics": result.get("oos_metrics"),
        "snapshots_evaluated": evaluated,
    }


def main() -> None:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
    interval = sys.argv[2] if len(sys.argv) > 2 else "5m"
    out = run_and_save(symbol, interval)
    m = out["metrics"]
    print(
        f"trades={m['n_trades']} win_rate={m['win_rate']:.2f} "
        f"expectancy={m['expectancy']:.3f}R; {out['snapshots_evaluated']} snapshots evaluados"
    )


if __name__ == "__main__":
    main()

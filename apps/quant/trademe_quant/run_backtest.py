"""CLI: corre el backtest sobre histórico de Binance y evalúa los snapshots pendientes.

Uso: python -m trademe_quant.run_backtest BTCUSDT 5m
"""

from __future__ import annotations

import os
import pathlib
import sys

from .backtest import run_backtest
from .db import evaluate_snapshot_outcomes, save_backtest
from .ensemble import load_ensemble
from .market.binance import fetch_klines
from .market.normalize import normalize_rest_kline


def main() -> None:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
    interval = sys.argv[2] if len(sys.argv) > 2 else "5m"
    dsn = os.environ.get("DATABASE_URL", "postgresql://trademe:trademe@localhost:5432/trademe")

    rows = fetch_klines(symbol, interval, limit=1000)
    candles = [normalize_rest_kline(symbol, interval, r) for r in rows]
    high = [c.high for c in candles]
    low = [c.low for c in candles]
    close = [c.close for c in candles]

    ensemble_path = os.environ.get(
        "ENSEMBLE_CONFIG",
        str(pathlib.Path(__file__).resolve().parents[3] / "artifacts/ensemble.yaml"),
    )
    config = load_ensemble(ensemble_path)
    result = run_backtest(high, low, close, config)
    print(
        f"trades={result['metrics']['n_trades']} "
        f"win_rate={result['metrics']['win_rate']:.2f} "
        f"expectancy={result['metrics']['expectancy']:.3f}R"
    )

    save_backtest(dsn, symbol, interval, result)
    n = evaluate_snapshot_outcomes(dsn)
    print(f"backtest guardado; {n} snapshots evaluados")


if __name__ == "__main__":
    main()

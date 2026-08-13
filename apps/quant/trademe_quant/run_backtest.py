"""Backtest sobre histórico de Binance y evaluación de snapshots pendientes.

CLI:  python -m trademe_quant.run_backtest BTCUSDT 5m
También expone run_and_save() para el servicio HTTP.
"""

from __future__ import annotations

import os
import sys
from typing import Any

from .backtest import run_backtest
from .db import evaluate_snapshot_outcomes, save_backtest
from .decision import horizon_for
from .ensemble import artifacts_dir, load_active_ensemble
from .independence import load_factor
from .market.binance import fetch_klines
from .market.normalize import normalize_rest_kline


def _dsn() -> str:
    return os.environ.get("DATABASE_URL", "postgresql://trademe:trademe@localhost:5432/trademe")


def run_and_save(symbol: str, interval: str) -> dict[str, Any]:
    """Corre el backtest, lo guarda y evalúa snapshots. Devuelve métricas."""
    rows = fetch_klines(symbol, interval, limit=1000)
    candles = [normalize_rest_kline(symbol, interval, r) for r in rows]
    high = [c.high for c in candles]
    low = [c.low for c in candles]
    close = [c.close for c in candles]
    config = load_active_ensemble(symbol, interval)
    # Mismo horizonte y mismo desinflado que en vivo: si el backtest midiera con otras reglas,
    # dejaría de ser comparable con lo que la plataforma decide de verdad.
    horizonte = horizon_for(config, interval)
    factor = load_factor(artifacts_dir(), symbol, interval)
    result = run_backtest(high, low, close, config, horizon=horizonte, independence=factor)
    save_backtest(_dsn(), symbol, interval, result)
    evaluated = 0
    try:
        horizontes = {
            iv: horizon_for(config, iv)
            for iv in config.get("evaluation", {}).get("horizon_by_tf", {})
        }
        evaluated = evaluate_snapshot_outcomes(_dsn(), horizonte, horizontes or None)
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

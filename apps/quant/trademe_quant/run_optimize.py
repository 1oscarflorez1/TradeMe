"""CLI: optimiza los pesos del ensemble con Optuna y publica el candidato si gana.

Uso: python -m trademe_quant.run_optimize BTCUSDT 5m

Escribe siempre artifacts/optimization_report.json (comparador base vs optimizado) y,
solo si el candidato supera al base en hold-out, artifacts/ensemble.optimized.yaml
(que la API cargará por delante del ensemble.yaml base).
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time

import yaml

from .ensemble import load_ensemble
from .market.binance import fetch_klines
from .market.normalize import normalize_rest_kline
from .optimize import optimize_weights


def _repo_artifact(name: str) -> str:
    return str(pathlib.Path(__file__).resolve().parents[3] / "artifacts" / name)


def main() -> None:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
    interval = sys.argv[2] if len(sys.argv) > 2 else "5m"
    n_trials = int(os.environ.get("OPTUNA_TRIALS", "60"))

    rows = fetch_klines(symbol, interval, limit=1000)
    candles = [normalize_rest_kline(symbol, interval, r) for r in rows]
    high = [c.high for c in candles]
    low = [c.low for c in candles]
    close = [c.close for c in candles]

    base_path = os.environ.get("ENSEMBLE_CONFIG", _repo_artifact("ensemble.yaml"))
    base = load_ensemble(base_path)

    result = optimize_weights(high, low, close, base, n_trials=n_trials)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    version = f"ens-opt-{symbol}-{interval}-{time.strftime('%Y%m%d', time.gmtime())}"

    report = {
        "version": version,
        "created_at": now,
        "symbol": symbol,
        "interval": interval,
        "promoted": result["promoted"],
        "validation_score": result["validation_score"],
        "holdout": result["holdout"],
        "best_params": result["best_params"],
        "n_trials": result["n_trials"],
    }
    report_path = os.environ.get("OPT_REPORT_PATH", _repo_artifact("optimization_report.json"))
    pathlib.Path(report_path).parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    ho = result["holdout"]
    print(
        f"trials={n_trials} val_score={result['validation_score']:.4f} | "
        f"hold-out base={ho['base_expectancy']:.4f}R ({ho['base_trades']}) "
        f"opt={ho['optimized_expectancy']:.4f}R ({ho['optimized_trades']})"
    )

    if result["promoted"]:
        opt_cfg = dict(result["best_config"])
        opt_cfg["version"] = version
        opt_path = os.environ.get("OPTIMIZED_ENSEMBLE", _repo_artifact("ensemble.optimized.yaml"))
        with open(opt_path, "w", encoding="utf-8") as fh:
            yaml.safe_dump(opt_cfg, fh, sort_keys=False, allow_unicode=True)
        print(f"PROMOVIDO: el candidato gana en hold-out -> {opt_path}")
    else:
        print("NO promovido: el base se mantiene (el candidato no supera el hold-out).")


if __name__ == "__main__":
    main()

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
from typing import Any

import yaml

from .ensemble import artifacts_dir, load_active_ensemble
from .market.binance import VELAS_POR_DEFECTO
from .optimize import optimize_weights
from .velas import series


def _repo_artifact(name: str) -> str:
    return str(pathlib.Path(__file__).resolve().parents[3] / "artifacts" / name)


def optimize_and_publish(
    symbol: str, interval: str, n_trials: int = 60, velas: int = VELAS_POR_DEFECTO
) -> dict[str, Any]:
    """Optimiza pesos con Optuna, escribe el informe y (si gana) el ensemble optimizado."""
    high, low, close = series(symbol, interval, velas)

    # La base a batir es la config ACTIVA de este símbolo+TF (mejora iterativa honesta).
    base = load_active_ensemble(symbol, interval)

    result = optimize_weights(high, low, close, base, n_trials=n_trials)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    version = f"ens-opt-{symbol}-{interval}-{time.strftime('%Y%m%d', time.gmtime())}"

    report = {
        "version": version,
        "created_at": now,
        "symbol": symbol,
        "interval": interval,
        "promoted": result["promoted"],
        # El motivo del veredicto. 0.54.0 lo prometió en su registro de cambios y no llegó a
        # escribirse: el optimizador rechazaba 20 de 20 promociones sin dejar rastro auditable de
        # por qué, que era justo lo que ese hito decía resolver.
        "promocion": result.get("promocion"),
        "validation_score": result["validation_score"],
        "holdout": result["holdout"],
        "best_params": result["best_params"],
        "n_trials": result["n_trials"],
    }
    out_dir = artifacts_dir() / "optimized"
    out_dir.mkdir(parents=True, exist_ok=True)
    report_path = out_dir / f"report.{symbol.upper()}.{interval}.json"
    with open(report_path, "w", encoding="utf-8") as fh:
        json.dump(report, fh, indent=2)

    if result["promoted"]:
        opt_cfg = dict(result["best_config"])
        opt_cfg["version"] = version
        opt_path = out_dir / f"ensemble.{symbol.upper()}.{interval}.yaml"
        with open(opt_path, "w", encoding="utf-8") as fh:
            yaml.safe_dump(opt_cfg, fh, sort_keys=False, allow_unicode=True)
        # La config viaja en el valor devuelto pero NO en el JSON de disco: el informe es un
        # resumen para consultar a mano y duplicar ahí la configuración entera solo la haría
        # envejecer en dos sitios. Quien la necesita es la auditoría de régimen del scheduler.
        report["config"] = opt_cfg
    return report


def main() -> None:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
    interval = sys.argv[2] if len(sys.argv) > 2 else "5m"
    n_trials = int(os.environ.get("OPTUNA_TRIALS", "60"))
    report = optimize_and_publish(symbol, interval, n_trials)
    ho = report["holdout"]
    print(
        f"trials={n_trials} val_score={report['validation_score']:.4f} | "
        f"hold-out base={ho['base_expectancy']:.4f}R ({ho['base_trades']}) "
        f"opt={ho['optimized_expectancy']:.4f}R ({ho['optimized_trades']})"
    )
    print("PROMOVIDO" if report["promoted"] else "NO promovido (se mantiene el base).")


if __name__ == "__main__":
    main()

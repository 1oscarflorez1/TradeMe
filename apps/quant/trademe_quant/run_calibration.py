"""CLI: entrena calibradores de probabilidad por régimen desde el backtest.

Uso: python -m trademe_quant.run_calibration BTCUSDT 5m

Reproduce el backtest (sin look-ahead), toma cada trade como un par
(confianza prevista, acierto real) segmentado por régimen, ajusta el calibrador
(isotónica o Platt, el de menor Brier) y exporta el artefacto que consume la API.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys

from .backtest import run_backtest
from .calibration import fit_calibrators
from .ensemble import load_active_ensemble
from .market.binance import fetch_klines
from .market.normalize import normalize_rest_kline


def _repo_artifact(name: str) -> str:
    return str(pathlib.Path(__file__).resolve().parents[3] / "artifacts" / name)


def calibrate_and_publish(symbol: str, interval: str) -> dict[str, object]:
    """Entrena calibradores por régimen desde el backtest del TF y publica el artefacto."""
    rows = fetch_klines(symbol, interval, limit=1000)
    candles = [normalize_rest_kline(symbol, interval, r) for r in rows]
    high = [c.high for c in candles]
    low = [c.low for c in candles]
    close = [c.close for c in candles]

    config = load_active_ensemble(symbol, interval)
    result = run_backtest(high, low, close, config)

    samples: list[tuple[str, float, float]] = [
        (str(t["regime"]), float(t["confidence"]), 1.0 if float(t["r"]) > 0 else 0.0)
        for t in result["trades"]
        if "regime" in t and "confidence" in t
    ]
    calibrators = fit_calibrators(samples, version=f"cal-{symbol}-{interval}")

    out_path = os.environ.get("CALIBRATORS_PATH", _repo_artifact("calibrators.json"))
    pathlib.Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(calibrators, fh, indent=2)

    return {"samples": len(samples), "version": calibrators["version"], "path": out_path}


def main() -> None:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
    interval = sys.argv[2] if len(sys.argv) > 2 else "5m"
    out = calibrate_and_publish(symbol, interval)
    print(f"calibradores entrenados desde {out['samples']} trades -> {out['path']}")


if __name__ == "__main__":
    main()

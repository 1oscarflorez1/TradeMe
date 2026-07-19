"""Tests de la optimización con Optuna (M7 Slice B) — rápidos, datos sintéticos."""

from __future__ import annotations

import math
from typing import Any

from trademe_quant.ensemble import load_ensemble
from trademe_quant.optimize import apply_params, optimize_weights, penalized_expectancy


def _series(n: int = 260) -> tuple[list[float], list[float], list[float]]:
    high: list[float] = []
    low: list[float] = []
    close: list[float] = []
    price = 100.0
    for i in range(n):
        drift = math.sin(i / 7) * 0.9 + (((i * 1103515245 + 12345) % 1000) / 1000 - 0.5) * 1.2
        c = max(1.0, price + drift)
        o = price
        high.append(max(o, c) + 0.5)
        low.append(min(o, c) - 0.5)
        close.append(c)
        price = c
    return high, low, close


def _base() -> dict[str, Any]:
    from pathlib import Path

    return load_ensemble(Path(__file__).parents[3] / "artifacts/ensemble.yaml")


def test_apply_params_no_muta_base() -> None:
    base = _base()
    before = base["weights"]["macd"]
    params = {f"w_{k}": 0.5 for k in ["ema_cross", "macd", "rsi14", "bbands", "stoch14"]}
    params.update(
        {f"r_{r}_{k}": 0.5 for r in ("trend", "range") for k in ("trend", "momentum", "reversion")}
    )
    cfg = apply_params(base, params)
    assert cfg["weights"]["macd"] == 0.5
    assert base["weights"]["macd"] == before  # el base no se toca


def test_penalized_expectancy_min_trades() -> None:
    trades = [{"r": 1.0}, {"r": -1.0}]
    params = {"w_macd": 1.0}
    assert penalized_expectancy(trades, params, min_trades=10, complexity_penalty=0.0) == -1.0


def test_optimize_devuelve_estructura_y_gating() -> None:
    high, low, close = _series()
    base = _base()
    res = optimize_weights(high, low, close, base, n_trials=5, k_folds=2, embargo=3, min_trades=3)
    assert isinstance(res["promoted"], bool)
    assert set(res["holdout"]) == {
        "base_expectancy",
        "base_trades",
        "optimized_expectancy",
        "optimized_trades",
    }
    # el config activo es dict válido con las claves del ensemble
    assert "weights" in res["best_config"] and "regime" in res["best_config"]
    # si se promociona, debe ganar (o empatar hacia arriba) en hold-out
    if res["promoted"]:
        assert res["holdout"]["optimized_expectancy"] > res["holdout"]["base_expectancy"]

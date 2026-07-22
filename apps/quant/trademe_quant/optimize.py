"""Optimización de pesos del ensemble con Optuna (M7 · Slice B).

Optuna (TPE) propone pesos de indicadores y multiplicadores de régimen; se evalúan
out-of-sample con walk-forward (purga+embargo) maximizando la **expectancy penalizada**
(complejidad + mínimo de trades, anti-overfit). El candidato ganador solo se promociona
si **supera al ensemble base en el tramo hold-out** reservado (nunca visto en la búsqueda).
"""

from __future__ import annotations

import copy
from typing import Any

import optuna

from .backtest import MIN_CANDLES, run_backtest
from .walkforward import in_test_folds, make_folds

WEIGHT_KEYS = ["ema_cross", "macd", "rsi14", "bbands", "stoch14"]
REGIME_KEYS = [
    ("trend", "trend"),
    ("trend", "momentum"),
    ("trend", "reversion"),
    ("range", "trend"),
    ("range", "momentum"),
    ("range", "reversion"),
]


def apply_params(base: dict[str, Any], params: dict[str, float]) -> dict[str, Any]:
    """Aplica los parámetros propuestos sobre una copia de la config base."""
    cfg = copy.deepcopy(base)
    for k in WEIGHT_KEYS:
        cfg["weights"][k] = params[f"w_{k}"]
    for reg, kind in REGIME_KEYS:
        cfg["regime"][reg][kind] = params[f"r_{reg}_{kind}"]
    if "hold_band" in params:
        cfg["hold_band"] = params["hold_band"]
    if "temperature" in params:
        cfg["temperature"] = params["temperature"]
    if "adx_threshold" in params:
        cfg["regime"]["adx_threshold"] = params["adx_threshold"]
    return cfg


def penalized_expectancy(
    trades: list[dict[str, Any]],
    params: dict[str, float],
    min_trades: int,
    complexity_penalty: float,
) -> float:
    """Expectancy media penalizada por complejidad (parsimonia) y mínimo de operaciones."""
    n = len(trades)
    if n < min_trades:
        return -1.0
    exp = sum(float(t["r"]) for t in trades) / n
    weightlike = [v for k, v in params.items() if k.startswith("w_") or k.startswith("r_")]
    complexity = sum(abs(v - 1.0) for v in weightlike) / max(1, len(weightlike))
    return exp - complexity_penalty * complexity


def _holdout_expectancy(
    high: list[float],
    low: list[float],
    close: list[float],
    config: dict[str, Any],
    split: int,
    horizon: int,
) -> tuple[float, int]:
    res = run_backtest(high, low, close, config, horizon=horizon)
    ho = [t for t in res["trades"] if int(t["index"]) >= split]
    if not ho:
        return 0.0, 0
    return sum(float(t["r"]) for t in ho) / len(ho), len(ho)


def optimize_weights(
    high: list[float],
    low: list[float],
    close: list[float],
    base_config: dict[str, Any],
    n_trials: int = 60,
    k_folds: int = 4,
    embargo: int = 10,
    horizon: int = 20,
    holdout: float = 0.3,
    min_trades: int = 10,
    complexity_penalty: float = 0.05,
    seed: int = 42,
) -> dict[str, Any]:
    """Busca pesos óptimos con Optuna y decide la promoción por hold-out."""
    n = len(close)
    split = int(n * (1.0 - holdout))
    folds = make_folds(MIN_CANDLES, split, k_folds, embargo)

    def objective(trial: optuna.Trial) -> float:
        params: dict[str, float] = {}
        for k in WEIGHT_KEYS:
            params[f"w_{k}"] = trial.suggest_float(f"w_{k}", 0.0, 2.0)
        for reg, kind in REGIME_KEYS:
            params[f"r_{reg}_{kind}"] = trial.suggest_float(f"r_{reg}_{kind}", 0.0, 2.0)
        params["hold_band"] = trial.suggest_float("hold_band", 0.0, 0.25)
        params["temperature"] = trial.suggest_float("temperature", 0.2, 1.5)
        params["adx_threshold"] = trial.suggest_float("adx_threshold", 15.0, 40.0)
        cfg = apply_params(base_config, params)
        res = run_backtest(high[:split], low[:split], close[:split], cfg, horizon=horizon)
        val = [t for t in res["trades"] if in_test_folds(int(t["index"]), horizon, folds)]
        return penalized_expectancy(val, params, min_trades, complexity_penalty)

    optuna.logging.set_verbosity(optuna.logging.WARNING)
    study = optuna.create_study(direction="maximize", sampler=optuna.samplers.TPESampler(seed=seed))
    study.optimize(objective, n_trials=n_trials, show_progress_bar=False)

    best_cfg = apply_params(base_config, study.best_params)
    base_exp, base_n = _holdout_expectancy(high, low, close, base_config, split, horizon)
    opt_exp, opt_n = _holdout_expectancy(high, low, close, best_cfg, split, horizon)
    promoted = opt_exp > base_exp

    return {
        "promoted": promoted,
        "best_params": study.best_params,
        "best_config": best_cfg if promoted else base_config,
        "validation_score": float(study.best_value),
        "holdout": {
            "base_expectancy": base_exp,
            "base_trades": base_n,
            "optimized_expectancy": opt_exp,
            "optimized_trades": opt_n,
        },
        "n_trials": n_trials,
    }

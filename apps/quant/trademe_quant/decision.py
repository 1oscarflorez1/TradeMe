"""Mirror de la decisión del ensemble (paridad con apps/api/src/ensemble).

Reproduce buildSignal: agrega los votos ponderados por régimen, aplica la inferencia
softmax con modulación macro, deriva la dirección y calcula los niveles del plan.
Lo usa el backtest para reproducir en Python lo que Node decide en vivo.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from .indicators import compute_readings
from .inference import infer_probs, pick_action

KINDS: dict[str, str] = {
    "ema_cross": "trend",
    "macd": "momentum",
    "rsi14": "reversion",
    "bbands": "reversion",
    "stoch14": "reversion",
    "adx14": "context",
    "atr14": "volatility",
}
VOTING = {"trend", "momentum", "reversion", "custom"}


def _regime_mult(kind: str, mult: dict[str, float]) -> float:
    if kind in ("trend", "momentum", "reversion"):
        return float(mult.get(kind, 1.0))
    return 1.0


def compute_plan_levels(
    action: str, price: float, atr: float, risk: dict[str, Any]
) -> dict[str, float] | None:
    if action == "HOLD" or atr <= 0 or price <= 0:
        return None
    d = 1.0 if action == "BUY" else -1.0
    stop_distance = atr * float(risk["atr_stop_mult"])
    entry = price
    stop = entry - d * stop_distance
    take_profit = entry + d * float(risk["tp_r_multiple"]) * stop_distance
    return {
        "entry": entry,
        "stop": stop,
        "take_profit": take_profit,
        "rr": float(risk["tp_r_multiple"]),
    }


def decide(
    high: Sequence[float],
    low: Sequence[float],
    close: Sequence[float],
    config: dict[str, Any],
    macro_bias: float | None = None,
    external_votes: Sequence[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    readings = compute_readings(high, low, close)
    adx = readings["adx14"]["value"]
    atr = readings["atr14"]["value"]
    label = "tendencia" if adx >= float(config["regime"]["adx_threshold"]) else "rango"
    adx_lo = float(config["regime"].get("adx_lo", 15.0))
    adx_hi = float(config["regime"].get("adx_hi", 35.0))
    if adx_hi > adx_lo:
        f = min(1.0, max(0.0, (adx - adx_lo) / (adx_hi - adx_lo)))
    else:
        f = 1.0 if adx >= adx_hi else 0.0
    range_mult = config["regime"]["range"]
    trend_mult = config["regime"]["trend"]

    def blend_mult(kind: str) -> float:
        return _regime_mult(kind, range_mult) * (1 - f) + _regime_mult(kind, trend_mult) * f

    weights = config["weights"]
    ext_weights = config["external_weights"]
    weighted_sum = 0.0
    weight_total = 0.0
    for key, r in readings.items():
        kind = KINDS[key]
        if kind not in VOTING:
            continue
        w = float(weights.get(key, 1.0)) * blend_mult(kind)
        weighted_sum += r["score"] * w
        weight_total += w
    for ev in external_votes or []:
        base = float(ext_weights.get(ev["source"], 1.0))
        weighted_sum += float(ev["score"]) * base
        weight_total += base

    net = weighted_sum / weight_total if weight_total > 0 else 0.0

    macro_cfg = config["macro"]
    use_macro = macro_bias is not None and macro_cfg.get("enabled", True)
    probs = infer_probs(
        net,
        float(config["temperature"]),
        float(config["hold_band"]),
        macro_bias if use_macro else None,
        float(macro_cfg["w_macro"]) if use_macro else 0.0,
    )
    action = pick_action(probs)

    confluence = "neutral"
    if use_macro and macro_bias is not None:
        if net != 0 and macro_bias != 0:
            confluence = "aligned" if (net > 0) == (macro_bias > 0) else "conflict"
        if (
            macro_cfg.get("conflict_downgrade", True)
            and confluence == "conflict"
            and abs(macro_bias) > float(macro_cfg["conflict_threshold"])
        ):
            action = "HOLD"

    direction = "LONG" if action == "BUY" else "SHORT" if action == "SELL" else "FLAT"
    price = float(close[-1])
    levels = compute_plan_levels(action, price, atr, config["risk"])
    return {
        "net": net,
        "regime": label,
        "adx": adx,
        "atr": atr,
        "probs": probs,
        "action": action,
        "direction": direction,
        "confluence": confluence,
        "price": price,
        "levels": levels,
        "confidence": probs[action],
    }

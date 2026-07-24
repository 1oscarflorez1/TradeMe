"""Mirror de la inferencia softmax con modulación macro (paridad con apps/api)."""

from __future__ import annotations

import math


def infer_probs(
    net: float,
    temperature: float,
    hold_band: float,
    macro_bias: float | None = None,
    w_macro: float = 0.0,
) -> dict[str, float]:
    t = temperature if temperature > 0 else 0.5
    macro_term = w_macro * macro_bias if macro_bias is not None else 0.0
    logits = {"BUY": net / t + macro_term, "SELL": -net / t - macro_term, "HOLD": hold_band / t}
    peak = max(logits.values())
    exp = {k: math.exp(v - peak) for k, v in logits.items()}
    total = sum(exp.values())
    return {k: v / total for k, v in exp.items()}


def pick_action(probs: dict[str, float]) -> str:
    return max(probs, key=lambda k: probs[k])


def scaled_w_macro(w_macro: float, interval: str, cfg: dict[str, object]) -> float:
    """Escalado de w_macro por temporalidad (M1, estructura preparada · DESACTIVADA por defecto).

    Si enable_scaling es False devuelve w_macro sin cambios. Mirror de apps/api inference.ts.
    """
    if not cfg.get("enable_scaling", False):
        return w_macro
    tf_scale = cfg.get("tf_scale", {})
    factor = float(tf_scale.get(interval, 1.0)) if isinstance(tf_scale, dict) else 1.0
    return w_macro * factor

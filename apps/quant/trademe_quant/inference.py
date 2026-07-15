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

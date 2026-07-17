"""Mirror del sesgo macro (paridad con apps/api/src/macro/bias.ts)."""

from __future__ import annotations

import math
from typing import Any


def compute_macro_bias(
    funding: float,
    price: float,
    weekly_ema: float,
    funding_weight: float,
    trend_weight: float,
    funding_scale: float,
    trend_scale: float,
) -> dict[str, Any]:
    funding_component = -math.tanh(funding / funding_scale)
    trend_component = (
        math.tanh((price - weekly_ema) / (weekly_ema * trend_scale)) if weekly_ema > 0 else 0.0
    )
    bias = max(-1.0, min(1.0, funding_weight * funding_component + trend_weight * trend_component))
    label = "alcista" if bias > 0.2 else "bajista" if bias < -0.2 else "neutral"
    return {"bias": bias, "weekly_trend": trend_component, "label": label}

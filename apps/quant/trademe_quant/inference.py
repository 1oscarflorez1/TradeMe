"""Mirror de la inferencia softmax con modulación macro (paridad con apps/api)."""

from __future__ import annotations

import math


def infer_probs(
    net: float,
    temperature: float,
    hold_band: float,
    macro_bias: float | None = None,
    w_macro: float = 0.0,
    independence: float = 1.0,
    fund_term: float = 0.0,
) -> dict[str, float]:
    """Softmax con modulación macro, penalización fundamental y desinflado por dependencia.

    `independence` escala los TRES logits por igual (ver trademe_quant.independence). Como escalar
    todos los logits por una constante positiva no altera cuál es el mayor, el ajuste **no cambia la
    dirección de la decisión**: solo aplana la distribución y baja la confianza declarada. Es una
    corrección de calibración, no de criterio.

    `fund_term` (M12) es lo contrario: **sí cambia el criterio, y solo en un lado**. Se resta al
    logit BUY y no toca el de SELL, porque el efecto medido del funding existe únicamente en los
    largos (ver trademe_quant.fundamental). Vale 0 mientras el score esté en sombra.
    """
    t = temperature if temperature > 0 else 0.5
    macro_term = w_macro * macro_bias if macro_bias is not None else 0.0
    k = independence if independence > 0 else 1.0
    logits = {
        "BUY": k * (net / t + macro_term - fund_term),
        "SELL": k * (-net / t - macro_term),  # asimetría: el funding no informa los cortos
        "HOLD": k * (hold_band / t),
    }
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

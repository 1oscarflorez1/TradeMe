"""Política automática del meta-modelo: de sombra → modular → veto, según evidencia real.

El meta-modelo empieza en **modo sombra** (predice pero no afecta). Este módulo mide, con las
decisiones reales ya cerradas, si sus predicciones habrían mejorado el resultado; y solo cuando la
evidencia es suficiente y sostenida, asciende el modo. Si el rendimiento se degrada, retrocede.

Es el mismo principio que el resto del sistema: nada gana poder sobre las decisiones sin
demostrarlo con datos que no controlaba.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

MODES = ["off", "shadow", "modulate", "veto"]

# Requisitos para ascender de modo (deliberadamente conservadores).
MIN_SAMPLES_MODULATE = 40
MIN_SAMPLES_VETO = 100
MIN_LIFT_R = 0.05  # mejora mínima de expectancy (en R) que debe aportar el filtro
MIN_AUC = 0.55


def evaluate_shadow(rows: list[dict[str, Any]], threshold: float) -> dict[str, Any]:
    """Compara lo que pasó con lo que habría pasado filtrando por el meta-modelo."""
    usable = [
        r
        for r in rows
        if r.get("meta_confidence") is not None and r.get("outcome_return_r") is not None
    ]
    n = len(usable)
    if n == 0:
        return {"n": 0, "baseline": 0.0, "filtered": 0.0, "lift": 0.0, "kept": 0, "auc": 0.5}

    rs = [float(r["outcome_return_r"]) for r in usable]
    probs = [float(r["meta_confidence"]) for r in usable]
    baseline = sum(rs) / n
    kept_rs = [r for r, p in zip(rs, probs, strict=False) if p >= threshold]
    filtered = (sum(kept_rs) / len(kept_rs)) if kept_rs else 0.0

    # AUC por conteo de pares (sin dependencias): ¿ordena bien ganadores sobre perdedores?
    wins = [p for p, r in zip(probs, rs, strict=False) if r > 0]
    losses = [p for p, r in zip(probs, rs, strict=False) if r <= 0]
    if wins and losses:
        better = sum(1 for w in wins for ls in losses if w > ls)
        ties = sum(1 for w in wins for ls in losses if w == ls)
        auc = (better + 0.5 * ties) / (len(wins) * len(losses))
    else:
        auc = 0.5

    return {
        "n": n,
        "baseline": baseline,
        "filtered": filtered,
        "lift": filtered - baseline,
        "kept": len(kept_rs),
        "auc": auc,
    }


def decide_mode(current: str, ev: dict[str, Any], max_mode: str = "veto") -> tuple[str, str]:
    """Decide el modo siguiente. Asciende de uno en uno; retrocede si el filtro perjudica."""
    cap = MODES.index(max_mode) if max_mode in MODES else len(MODES) - 1
    cur = MODES.index(current) if current in MODES else 1
    n, lift, auc, kept = ev["n"], ev["lift"], ev["auc"], ev["kept"]

    # Retroceso: con muestra suficiente, si el filtro empeora el resultado.
    if cur >= 2 and n >= MIN_SAMPLES_MODULATE and lift < -MIN_LIFT_R:
        return MODES[max(1, cur - 1)], (
            f"el filtro empeora el resultado ({lift:+.3f} R en {n} decisiones): se retrocede"
        )

    if n < MIN_SAMPLES_MODULATE:
        return current, f"evidencia insuficiente ({n}/{MIN_SAMPLES_MODULATE} decisiones evaluadas)"
    if lift < MIN_LIFT_R or auc < MIN_AUC:
        return current, (
            f"aún no demuestra ventaja (mejora {lift:+.3f} R, AUC {auc:.2f}; "
            f"se exige ≥{MIN_LIFT_R} R y AUC ≥{MIN_AUC})"
        )
    if kept < max(10, int(0.25 * n)):
        return current, "el filtro descartaría demasiadas señales para ser fiable"

    # Ascenso de un escalón.
    if cur < 2 <= cap:
        return "modulate", (
            f"demuestra ventaja ({lift:+.3f} R, AUC {auc:.2f} en {n} decisiones): "
            "pasa a modular la confianza"
        )
    if cur == 2 and cap >= 3:
        if n >= MIN_SAMPLES_VETO:
            return "veto", (
                f"ventaja sostenida ({lift:+.3f} R, AUC {auc:.2f} en {n} decisiones): "
                "pasa a filtrar señales poco fiables"
            )
        return current, f"ventaja confirmada; para vetar se exigen {MIN_SAMPLES_VETO} decisiones"
    return current, "sin cambios"


def load_policy(artifacts: Path) -> dict[str, Any]:
    p = artifacts / "meta_policy.json"
    if p.exists():
        try:
            return json.loads(p.read_text())  # type: ignore[no-any-return]
        except Exception:  # noqa: BLE001
            pass
    return {"mode": "shadow", "reason": "estado inicial", "updated_at": None}


def save_policy(artifacts: Path, mode: str, reason: str, ev: dict[str, Any]) -> dict[str, Any]:
    artifacts.mkdir(parents=True, exist_ok=True)
    data = {
        "mode": mode,
        "reason": reason,
        "evidence": ev,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (artifacts / "meta_policy.json").write_text(json.dumps(data, indent=2))
    return data

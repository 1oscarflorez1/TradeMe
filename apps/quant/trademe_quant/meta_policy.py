"""Política automática del meta-modelo: de sombra → modular → veto, según evidencia real.

El meta-modelo empieza en **modo sombra** (predice pero no afecta). Este módulo mide, con las
decisiones reales ya cerradas, si sus predicciones habrían mejorado el resultado; y solo cuando la
evidencia es suficiente y sostenida, asciende el modo. Si el rendimiento se degrada, retrocede.

Es el mismo principio que el resto del sistema: nada gana poder sobre las decisiones sin
demostrarlo con datos que no controlaba.

Hito A (22 ago 2026) — el lift se compara con el azar
------------------------------------------------------
El umbral de +0,05 R resultó no distinguir mérito de suerte: diagnosticando el meta-modelo se vio
que **un modelo entrenado con las etiquetas barajadas produce un lift medio de +0,083 R**, por
encima del listón que se le exigía para promocionar. El azar lo superaba de media.

Desde aquí se exige `max(0,05 R, P95 de la nula)`, con la nula calculada **sin reentrenar**: sobre
las probabilidades ya guardadas, permutando por bloques de 24 h cuántas se conservan en cada uno.
Es barata y responde a la pregunta que importa: *¿conservar ESTAS operaciones es mejor que conservar
otras tantas cualesquiera?*

Ojo con el estadístico, que aquí NO es el del Fundamental Score
---------------------------------------------------------------
Los dos módulos llaman «lift» a cosas con distinto denominador. El Fundamental Score reparte los
descartes sobre `n` (una operación evitada aporta 0 y sigue contando); el meta-modelo promedia
**solo las conservadas**. Reutilizar la nula ajena daría un listón que no mide lo que se compara.
Por eso `nula.p95_seleccion` recibe el estadístico desde fuera.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import numpy as np

from .nula import PERMUTACIONES_CICLO, marcas_de, p95_seleccion

MODES = ["off", "shadow", "modulate", "veto"]

# Requisitos para ascender de modo (deliberadamente conservadores).
MIN_SAMPLES_MODULATE = 40
MIN_SAMPLES_VETO = 100
MIN_LIFT_R = 0.05  # mejora mínima de expectancy (en R) que debe aportar el filtro
MIN_AUC = 0.55


def _lift_conservando(arr: np.ndarray[Any, Any], conservadas: np.ndarray[Any, Any]) -> float:
    """Lift de quedarse solo con ese conjunto: media de las conservadas menos la media de todas.

    Sin ninguna conservada el filtro no deja nada que promediar y el lift es `-baseline`, igual que
    en `evaluate_shadow`, donde `filtered` vale 0,0 en ese caso.
    """
    base = float(arr.mean())
    if not conservadas.any():
        return -base
    return float(arr[conservadas].mean()) - base


def lift_nulo_p95(
    rs: list[float],
    conservadas: list[bool],
    marcas: list[int],
    permutaciones: int = PERMUTACIONES_CICLO,
) -> float:
    """Lift que alcanza el AZAR en el percentil 95 conservando la misma cantidad de operaciones."""
    return p95_seleccion(rs, marcas, conservadas, _lift_conservando, permutaciones=permutaciones)


def evaluate_shadow(rows: list[dict[str, Any]], threshold: float) -> dict[str, Any]:
    """Compara lo que pasó con lo que habría pasado filtrando por el meta-modelo."""
    usable = [
        r
        for r in rows
        if r.get("meta_confidence") is not None and r.get("outcome_return_r") is not None
    ]
    n = len(usable)
    if n == 0:
        return {
            "n": 0,
            "baseline": 0.0,
            "filtered": 0.0,
            "lift": 0.0,
            "lift_nulo_p95": 0.0,
            "kept": 0,
            "auc": 0.5,
        }

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

    conservadas = [p >= threshold for p in probs]
    marcas = marcas_de([r.get("captured_at") for r in usable])

    return {
        "n": n,
        "baseline": baseline,
        "filtered": filtered,
        "lift": filtered - baseline,
        "lift_nulo_p95": lift_nulo_p95(rs, conservadas, marcas),
        "kept": len(kept_rs),
        "auc": auc,
    }


def decide_mode(current: str, ev: dict[str, Any], max_mode: str = "veto") -> tuple[str, str]:
    """Decide el modo siguiente. Asciende de uno en uno; retrocede si el filtro perjudica."""
    cap = MODES.index(max_mode) if max_mode in MODES else len(MODES) - 1
    cur = MODES.index(current) if current in MODES else 1
    n, lift, auc, kept = ev["n"], ev["lift"], ev["auc"], ev["kept"]
    # Umbral efectivo = el más exigente entre el fijo y lo que alcanza el azar. Solo endurece: sin
    # nula calculada vale 0,0 y manda `MIN_LIFT_R`, que es el comportamiento anterior al Hito A.
    exigido = max(MIN_LIFT_R, float(ev.get("lift_nulo_p95", 0.0)))

    # Permanencia simétrica: quien ya tiene poder debe seguir cumpliendo lo que se le exigió para
    # tenerlo. Antes el guardián de salida era más laxo que el de entrada —solo miraba el lift— y un
    # modelo degradado hasta AUC 0,43 (peor que una moneda) conservaba el modo `modulate` porque su
    # lift, aun siendo malo, no llegaba a −0,05 R. Un umbral que solo se comprueba al ascender no es
    # un umbral: es un peaje de entrada.
    if cur >= 2 and n >= MIN_SAMPLES_MODULATE:
        if lift < -MIN_LIFT_R:
            return MODES[max(1, cur - 1)], (
                f"el filtro empeora el resultado ({lift:+.3f} R en {n} decisiones): se retrocede"
            )
        if lift < exigido or auc < MIN_AUC:
            return MODES[max(1, cur - 1)], (
                f"deja de cumplir lo exigido para tener poder "
                f"(mejora {lift:+.3f} R, AUC {auc:.2f}; se exige ≥{exigido:+.3f} R "
                f"y AUC ≥{MIN_AUC} en {n} decisiones): se retrocede"
            )

    if n < MIN_SAMPLES_MODULATE:
        return current, f"evidencia insuficiente ({n}/{MIN_SAMPLES_MODULATE} decisiones evaluadas)"
    if lift < exigido or auc < MIN_AUC:
        detalle = f"se exige ≥{exigido:+.3f} R"
        if exigido > MIN_LIFT_R:
            detalle += (
                f" (el azar alcanza {exigido:+.3f} conservando otras tantas,"
                f" por encima del fijo {MIN_LIFT_R})"
            )
        return current, (
            f"aún no demuestra ventaja (mejora {lift:+.3f} R, AUC {auc:.2f}; "
            f"{detalle} y AUC ≥{MIN_AUC})"
        )
    if kept < max(10, int(0.25 * n)):
        return current, "el filtro descartaría demasiadas señales para ser fiable"

    # Ascenso de un escalón.
    if cur < 2 <= cap:
        return "modulate", (
            f"demuestra ventaja ({lift:+.3f} R sobre un azar de {exigido:+.3f}, AUC {auc:.2f} "
            f"en {n} decisiones): pasa a modular la confianza"
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

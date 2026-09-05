"""La conmutación por régimen tiene que significar lo que su nombre promete."""

from __future__ import annotations

import math
import pathlib
import random
from typing import Any

from trademe_quant.ensemble import load_ensemble
from trademe_quant.optimize import optimize_weights


def _serie(n: int, semilla: int = 3) -> tuple[list[float], list[float], list[float]]:
    rnd = random.Random(semilla)
    p = 100.0
    h: list[float] = []
    lo: list[float] = []
    c: list[float] = []
    for i in range(n):
        p = max(1.0, p + 0.2 * math.sin(i / 30.0) + rnd.uniform(-1.0, 1.0))
        r = abs(rnd.gauss(0.7, 0.3)) + 0.1
        c.append(p)
        h.append(p + r)
        lo.append(p - r)
    return h, lo, c


def _config() -> dict[str, Any]:
    return load_ensemble(pathlib.Path(__file__).parents[3] / "artifacts/ensemble.yaml")


def test_con_coherencia_la_tendencia_nunca_pesa_menos_que_la_reversion() -> None:
    """6 de las 15 publicadas lo invertían, y de ahí salían los cortos a contratendencia."""
    h, lo, c = _serie(900)
    r = optimize_weights(h, lo, c, _config(), n_trials=12, coherencia_regimen=True)
    reg = r["best_config"]["regime"]

    t = reg["trend"]
    assert (
        max(t["trend"], t["momentum"]) >= t["reversion"]
    ), f"en tendencia manda la familia direccional: {t}"
    rg = reg["range"]
    assert rg["reversion"] >= max(rg["trend"], rg["momentum"]), f"en rango manda la reversión: {rg}"


def test_sin_coherencia_el_espacio_sigue_siendo_el_de_antes() -> None:
    """La bandera existe para comparar A/B, no para tener dos comportamientos en producción."""
    h, lo, c = _serie(900, semilla=5)
    r = optimize_weights(h, lo, c, _config(), n_trials=8, coherencia_regimen=False)
    reg = r["best_config"]["regime"]
    # No se afirma que invierta —puede salir coherente por azar—, solo que no se fuerza nada.
    for bloque in ("trend", "range"):
        for kind in ("trend", "momentum", "reversion"):
            assert 0.0 <= reg[bloque][kind] <= 2.0


def test_la_coherencia_esta_activada_por_defecto() -> None:
    """Producción no debe poder publicar una configuración que se contradice a sí misma."""
    h, lo, c = _serie(900, semilla=9)
    r = optimize_weights(h, lo, c, _config(), n_trials=8)
    t = r["best_config"]["regime"]["trend"]
    assert max(t["trend"], t["momentum"]) >= t["reversion"]

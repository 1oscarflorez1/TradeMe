"""Gobierno del Fundamental Score: que solo ascienda con evidencia, y que baje al perderla."""

from __future__ import annotations

from typing import Any

from trademe_quant.fundamental_policy import (
    MIN_AUC,
    MIN_DISCREPANCIAS,
    MIN_LIFT_R,
    MIN_SAMPLES,
    decide_mode,
    evaluate_shadow,
)


def fila(r: float, discrepa: bool, penalty: float = 0.5) -> dict[str, Any]:
    return {
        "action": "BUY",
        "fund_shadow_action": "HOLD" if discrepa else "BUY",
        "fund_penalty": penalty,
        "outcome_return_r": r,
    }


def test_sin_datos_no_inventa_ventaja() -> None:
    ev = evaluate_shadow([])
    assert ev["n"] == 0
    assert ev["lift"] == 0.0
    assert ev["auc"] == 0.5


def test_el_lift_sale_de_las_discrepancias() -> None:
    """Donde el score discrepaba, la operación no se abre: su aportación es 0."""
    # Dos perdedoras que el score habría evitado y dos ganadoras que respetaba.
    filas = [fila(-1.0, True), fila(-1.0, True), fila(2.0, False), fila(2.0, False)]
    ev = evaluate_shadow(filas)
    assert ev["baseline"] == 0.5  # (-1 -1 +2 +2)/4
    assert ev["con_score"] == 1.0  # (0 0 +2 +2)/4
    assert abs(ev["lift"] - 0.5) < 1e-9
    assert ev["discrepancias"] == 2


def test_evitar_ganadoras_produce_lift_negativo() -> None:
    """El caso incómodo tiene que verse igual de claro que el favorable."""
    filas = [fila(2.0, True), fila(2.0, True), fila(-1.0, False)]
    ev = evaluate_shadow(filas)
    assert ev["lift"] < 0


def test_auc_alta_cuando_la_penalizacion_señala_a_las_perdedoras() -> None:
    filas = [fila(-1.0, True, penalty=0.9) for _ in range(10)]
    filas += [fila(2.0, False, penalty=0.1) for _ in range(10)]
    ev = evaluate_shadow(filas)
    assert ev["auc"] > 0.9


def test_auc_baja_cuando_penaliza_a_las_ganadoras() -> None:
    """Si el score está del revés, el AUC lo delata en vez de disimularlo."""
    filas = [fila(2.0, True, penalty=0.9) for _ in range(10)]
    filas += [fila(-1.0, False, penalty=0.1) for _ in range(10)]
    ev = evaluate_shadow(filas)
    assert ev["auc"] < 0.1


def test_no_asciende_sin_muestra() -> None:
    ev = {"n": 20, "lift": 0.5, "auc": 0.9, "discrepancias": 15}
    modo, razon = decide_mode("shadow", ev)
    assert modo == "shadow"
    assert "insuficiente" in razon


def test_no_asciende_si_nunca_cambia_nada() -> None:
    """Un lift de 0 por no haber discrepado nunca no es «inofensivo»: es «no ha opinado»."""
    ev = {"n": MIN_SAMPLES + 50, "lift": 0.0, "auc": 0.5, "discrepancias": 2}
    modo, razon = decide_mode("shadow", ev)
    assert modo == "shadow"
    assert "apenas cambia" in razon


def test_no_asciende_con_lift_bueno_pero_auc_mala() -> None:
    ev = {
        "n": MIN_SAMPLES + 10,
        "lift": MIN_LIFT_R + 0.2,
        "auc": MIN_AUC - 0.05,
        "discrepancias": MIN_DISCREPANCIAS + 10,
    }
    assert decide_mode("shadow", ev)[0] == "shadow"


def test_asciende_cuando_cumple_todo() -> None:
    ev = {
        "n": MIN_SAMPLES + 10,
        "lift": MIN_LIFT_R + 0.1,
        "auc": MIN_AUC + 0.05,
        "discrepancias": MIN_DISCREPANCIAS + 10,
    }
    modo, razon = decide_mode("shadow", ev)
    assert modo == "active"
    assert "demuestra ventaja" in razon


def test_permanencia_simetrica_vuelve_a_sombra() -> None:
    """Quien influye sigue cumpliendo lo que se le exigió para llegar ahí.

    El meta-modelo aprendió esta lección conservando poder con un AUC de 0,43: un umbral que solo
    se comprueba al ascender es un peaje de entrada, no un umbral.
    """
    ev = {
        "n": MIN_SAMPLES + 10,
        "lift": MIN_LIFT_R - 0.02,
        "auc": MIN_AUC + 0.1,
        "discrepancias": MIN_DISCREPANCIAS + 10,
    }
    modo, razon = decide_mode("active", ev)
    assert modo == "shadow"
    assert "deja de cumplir" in razon


def test_el_tope_impide_ascender() -> None:
    """El tope de configuración manda sobre la automatización."""
    ev = {
        "n": MIN_SAMPLES + 10,
        "lift": MIN_LIFT_R + 0.1,
        "auc": MIN_AUC + 0.05,
        "discrepancias": MIN_DISCREPANCIAS + 10,
    }
    assert decide_mode("shadow", ev, max_mode="shadow")[0] == "shadow"

"""Tests de la política automática del meta-modelo."""

from __future__ import annotations

from typing import Any

from trademe_quant.meta_policy import decide_mode, evaluate_shadow


def _rows(n: int, good_pred: bool) -> list[dict[str, Any]]:
    out = []
    for i in range(n):
        win = i % 2 == 0
        # si good_pred, la predicción acompaña al resultado; si no, es ruido
        conf = (0.8 if win else 0.2) if good_pred else 0.5
        out.append({"meta_confidence": conf, "outcome_return_r": 2.0 if win else -1.0})
    return out


def test_evaluate_detecta_filtro_util() -> None:
    ev = evaluate_shadow(_rows(100, True), 0.5)
    assert ev["n"] == 100
    assert ev["lift"] > 0  # filtrar mejora
    assert ev["auc"] > 0.9  # ordena perfecto


def test_evaluate_sin_datos() -> None:
    assert evaluate_shadow([], 0.5)["n"] == 0


def test_no_asciende_sin_evidencia() -> None:
    mode, reason = decide_mode("shadow", evaluate_shadow(_rows(10, True), 0.5))
    assert mode == "shadow" and "insuficiente" in reason


def test_no_asciende_si_no_aporta() -> None:
    mode, reason = decide_mode("shadow", evaluate_shadow(_rows(100, False), 0.5))
    assert mode == "shadow"
    assert "ventaja" in reason


def test_asciende_a_modulate_con_evidencia() -> None:
    mode, reason = decide_mode("shadow", evaluate_shadow(_rows(60, True), 0.5))
    assert mode == "modulate" and "modular" in reason


def test_veto_requiere_mas_muestra() -> None:
    mode, _ = decide_mode("modulate", evaluate_shadow(_rows(60, True), 0.5))
    assert mode == "modulate"  # aún no llega a 100
    mode2, reason2 = decide_mode("modulate", evaluate_shadow(_rows(140, True), 0.5))
    assert mode2 == "veto" and "sostenida" in reason2


def test_respeta_el_tope_configurado() -> None:
    mode, _ = decide_mode("modulate", evaluate_shadow(_rows(140, True), 0.5), max_mode="modulate")
    assert mode == "modulate"


def test_retrocede_si_perjudica() -> None:
    rows = [
        {"meta_confidence": 0.9 if i % 2 else 0.1, "outcome_return_r": -1.0 if i % 2 else 2.0}
        for i in range(80)
    ]
    mode, reason = decide_mode("veto", evaluate_shadow(rows, 0.5))
    assert mode == "modulate" and "retrocede" in reason


def test_retrocede_si_deja_de_cumplir_el_umbral() -> None:
    """El caso real de agosto de 2026: AUC 0,43 y lift −0,005 R conservaban el modo `modulate`.

    El lift no bajaba de −0,05 R, así que la regla antigua no retrocedía; y el AUC solo se
    comprobaba al ascender. Un modelo anti-predictivo seguía modulando la confianza en vivo.
    """
    ev = {
        "n": 244,
        "baseline": -0.324,
        "filtered": -0.329,
        "lift": -0.005,
        "kept": 228,
        "auc": 0.43,
    }
    mode, reason = decide_mode("modulate", ev)
    assert mode == "shadow"
    assert "deja de cumplir" in reason and "0.43" in reason


def test_permanencia_exige_auc_no_solo_lift() -> None:
    """Lift suficiente pero AUC por debajo del umbral: tampoco basta para conservar el poder."""
    ev = {"n": 150, "baseline": 0.0, "filtered": 0.2, "lift": 0.2, "kept": 100, "auc": 0.50}
    mode, _ = decide_mode("veto", ev)
    assert mode == "modulate"


def test_no_retrocede_por_debajo_de_sombra() -> None:
    ev = {"n": 200, "baseline": 0.0, "filtered": -0.5, "lift": -0.5, "kept": 100, "auc": 0.30}
    assert decide_mode("shadow", ev)[0] == "shadow"


def test_permanece_mientras_cumple() -> None:
    mode, _ = decide_mode("veto", evaluate_shadow(_rows(140, True), 0.5))
    assert mode == "veto"

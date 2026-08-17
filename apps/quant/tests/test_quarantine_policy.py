"""Tests del gobierno automático de la cuarentena (M10.7)."""

from __future__ import annotations

from typing import Any

from trademe_quant.quarantine_policy import (
    MAX_EXPECTANCY_ENTRADA,
    MIN_EXPECTANCY_SALIDA,
    MIN_SAMPLES_ENTRADA,
    MIN_SAMPLES_SALIDA,
    decide_quarantine,
    evaluate_real,
    evaluate_shadow,
)


def _sombra(n: int, r: float) -> list[dict[str, Any]]:
    return [{"shadow_outcome_return_r": r, "outcome_return_r": None} for _ in range(n)]


def _real(n: int, r: float) -> list[dict[str, Any]]:
    return [{"outcome_return_r": r, "shadow_outcome_return_r": None} for _ in range(n)]


# --- Resúmenes -------------------------------------------------------------------------------


def test_expedientes_no_se_mezclan() -> None:
    """El aislamiento es la razón de ser del diseño: una sombra no es rendimiento."""
    filas = _sombra(10, 1.0) + _real(5, -1.0)
    assert evaluate_shadow(filas)["n"] == 10
    assert evaluate_real(filas)["n"] == 5
    assert evaluate_shadow(filas)["expectancy"] == 1.0
    assert evaluate_real(filas)["expectancy"] == -1.0


def test_resumen_sin_datos() -> None:
    assert evaluate_shadow([])["n"] == 0
    assert evaluate_real([])["expectancy"] == 0.0


# --- Salir de cuarentena ---------------------------------------------------------------------


def test_no_sale_sin_muestra_aunque_gane() -> None:
    """La comprobación que importa: una racha buena y corta NO levanta la cuarentena.

    Es el modo natural de equivocarse aquí — ver tres días buenos y volver a operar algo que
    perdía dinero.
    """
    ev = evaluate_shadow(_sombra(MIN_SAMPLES_SALIDA - 1, 2.0))
    sigue, motivo = decide_quarantine(True, ev)
    assert sigue is True
    assert "decisiones sombra evaluadas" in motivo


def test_no_sale_con_muestra_pero_sin_ventaja() -> None:
    ev = evaluate_shadow(_sombra(80, 0.0))
    sigue, motivo = decide_quarantine(True, ev)
    assert sigue is True and "se exige" in motivo


def test_sale_con_muestra_y_ventaja() -> None:
    ev = evaluate_shadow(_sombra(60, 0.30))
    sigue, motivo = decide_quarantine(True, ev)
    assert sigue is False
    assert "sale de cuarentena" in motivo


def test_el_umbral_de_salida_es_estricto() -> None:
    """Justo por debajo no sale; justo por encima sí. Sin zona gris."""
    justo_debajo = evaluate_shadow(_sombra(60, MIN_EXPECTANCY_SALIDA - 0.01))
    justo_encima = evaluate_shadow(_sombra(60, MIN_EXPECTANCY_SALIDA + 0.01))
    assert decide_quarantine(True, justo_debajo)[0] is True
    assert decide_quarantine(True, justo_encima)[0] is False


# --- Entrar en cuarentena --------------------------------------------------------------------


def test_entra_si_pierde_de_forma_sostenida() -> None:
    ev = evaluate_real(_real(50, -0.5))
    entra, motivo = decide_quarantine(False, ev)
    assert entra is True and "entra en cuarentena" in motivo


def test_no_entra_con_muestra_insuficiente() -> None:
    ev = evaluate_real(_real(5, -0.9))
    entra, _ = decide_quarantine(False, ev)
    assert entra is False


def test_no_entra_si_solo_pierde_un_poco() -> None:
    ev = evaluate_real(_real(50, MAX_EXPECTANCY_ENTRADA + 0.01))
    assert decide_quarantine(False, ev)[0] is False


# --- Asimetría -------------------------------------------------------------------------------


def test_cuesta_mas_salir_que_entrar() -> None:
    """Deliberadamente asimétrico: dejar de operar es barato, volver a operar no.

    Con la MISMA muestra, una expectancy que basta para no entrar en cuarentena no basta para
    salir de ella.
    """
    n = MIN_SAMPLES_SALIDA
    exp = 0.0  # ni gana ni pierde
    assert decide_quarantine(False, evaluate_real(_real(n, exp)))[0] is False  # no entra
    assert decide_quarantine(True, evaluate_shadow(_sombra(n, exp)))[0] is True  # tampoco sale


def test_el_motivo_siempre_explica_la_decision() -> None:
    """Una decisión automática que no se puede explicar no es auditable."""
    for en_cuarentena in (True, False):
        for filas in ([], _sombra(60, 0.3), _real(50, -0.5)):
            ev = evaluate_shadow(filas) if en_cuarentena else evaluate_real(filas)
            _, motivo = decide_quarantine(en_cuarentena, ev)
            assert isinstance(motivo, str) and len(motivo) > 10


# --- El expediente mira lo reciente, no toda la historia (arreglo del 17/08/2026) ------------


def test_lo_antiguo_no_diluye_lo_reciente() -> None:
    """El caso real de 15m: 65 decisiones malas recientes tapadas por 155 buenas antiguas.

    Promediando todo salía −0,029 R y la temporalidad se libraba de la cuarentena por un pasado
    que ya no la describe. Cambiar la configuración cambia el sujeto medido.
    """
    recientes = _real(65, -0.26)
    antiguas = _real(155, 0.068)
    filas = recientes + antiguas  # ordenado de más reciente a más antigua, como llega de la BD

    todo = sum(float(r["outcome_return_r"]) for r in filas) / len(filas)
    assert -0.05 < todo < 0.0, todo  # promediando todo, no llega al umbral

    ev = evaluate_real(filas)
    assert ev["n"] == MIN_SAMPLES_ENTRADA
    assert ev["expectancy"] < MAX_EXPECTANCY_ENTRADA
    assert decide_quarantine(False, ev)[0] is True  # ahora sí entra


def test_la_ventana_es_el_minimo_de_muestra_ya_exigido() -> None:
    """La ventana no se eligió mirando el resultado: es el umbral que ya estaba escrito."""
    assert evaluate_real(_real(500, 1.0))["n"] == MIN_SAMPLES_ENTRADA
    assert evaluate_shadow(_sombra(500, 1.0))["n"] == MIN_SAMPLES_SALIDA


def test_con_menos_decisiones_que_la_ventana_se_usan_todas() -> None:
    ev = evaluate_real(_real(7, -0.5))
    assert ev["n"] == 7
    assert decide_quarantine(False, ev)[0] is False  # y sigue sin bastar para decidir


def test_se_respeta_el_orden_de_llegada() -> None:
    """Si la base devolviera lo antiguo primero, el arreglo no serviría de nada."""
    filas = _real(40, 1.0) + _real(40, -1.0)
    assert evaluate_real(filas)["expectancy"] == 1.0
    assert evaluate_real(list(reversed(filas)))["expectancy"] == -1.0

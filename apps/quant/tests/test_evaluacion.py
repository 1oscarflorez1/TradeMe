"""Un desenlace escrito con otra regla no es «antiguo»: es otra medición."""

from __future__ import annotations

from trademe_quant.evaluacion import Veredicto, _velas_en_ventana, juzgar, resumir

MIN = 60_000


def _quietas(n: int) -> list[tuple[float, float, float]]:
    """Velas que no tocan ni objetivo ni stop."""
    return [(101.0, 99.0, 100.0)] * n


def test_un_desenlace_que_coincide_es_reproducible() -> None:
    v = juzgar("LONG", 100.0, 95.0, 110.0, [(111.0, 99.0, 110.5)], 20, "tp", 2.0)
    assert v.reproducible is True


def test_un_timeout_sin_horizonte_completo_no_es_reproducible() -> None:
    """Es el caso que llenó el histórico: se cerró por tiempo sin haberle dado su tiempo."""
    v = juzgar("LONG", 100.0, 95.0, 110.0, _quietas(3), 20, "timeout", 0.0)
    assert v.reproducible is False
    assert "ventana incompleta" in v.motivo


def test_un_timeout_con_horizonte_completo_si_lo_es() -> None:
    v = juzgar("LONG", 100.0, 95.0, 110.0, _quietas(20), 20, "timeout", 0.0)
    assert v.reproducible is True


def test_un_desenlace_que_hoy_sale_distinto_se_descarta_y_dice_cual() -> None:
    """Guardado «tp» pero con estas velas toca el stop: alguna de las dos reglas no era esta."""
    v = juzgar("LONG", 100.0, 95.0, 110.0, [(101.0, 94.0, 96.0)], 20, "tp", 2.0)
    assert v.reproducible is False
    assert "«sl»" in v.motivo and "«tp»" in v.motivo
    assert v.r_reevaluado == -1.0


def test_sin_velas_no_se_puede_juzgar() -> None:
    v = juzgar("LONG", 100.0, 95.0, 110.0, [], 20, "tp", 2.0)
    assert v.reproducible is False
    assert v.r_reevaluado is None


def test_un_toque_en_la_primera_vela_vale_aunque_falten_las_demas() -> None:
    """Misma asimetría que la evaluación real: el precio estuvo ahí y eso ya no cambia."""
    v = juzgar("LONG", 100.0, 95.0, 110.0, [(101.0, 94.0, 96.0)], 20, "sl", -1.0)
    assert v.reproducible is True


def test_la_ventana_se_recorta_por_tiempo_no_por_numero_de_velas() -> None:
    """Con un hueco, las velas de después no entran: son de otro tramo de mercado."""
    tiempos = [MIN, 2 * MIN, 500 * MIN, 501 * MIN]
    velas = _quietas(4)
    dentro = _velas_en_ventana(tiempos, velas, 0, 20 * MIN)
    assert len(dentro) == 2, "las dos posteriores al hueco caen fuera del horizonte"


def test_el_resumen_separa_los_dos_motivos_de_descarte() -> None:
    """No es lo mismo «le faltan velas» que «con estas velas sale otra cosa»."""
    lista = [
        Veredicto(1, True, "coincide con la regla vigente", 2.0, 2.0),
        Veredicto(2, False, "ventana incompleta (3/20 velas)", 0.0, None),
        Veredicto(3, False, "reevaluado «sl» frente a «tp» guardado", 2.0, -1.0),
    ]
    r = resumir(lista)
    assert (r.total, r.reproducibles, r.sin_ventana, r.discrepantes) == (3, 1, 1, 1)
    assert abs(r.fraccion - 1 / 3) < 1e-9


def test_el_resumen_de_una_lista_vacia_no_divide_entre_cero() -> None:
    assert resumir([]).fraccion == 0.0

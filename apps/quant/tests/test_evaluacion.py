"""Un desenlace escrito con otra regla no es «antiguo»: es otra medición."""

from __future__ import annotations

from trademe_quant.evaluacion import Veredicto, juzgar, resumir
from trademe_quant.ventana import Trayectoria


def _tray(velas: list[tuple[float, float, float]], completa: bool = True) -> Trayectoria:
    return Trayectoria(velas, completa=completa, apertura_captura_ms=0, cierre_ms=1)


def _quietas(n: int) -> list[tuple[float, float, float]]:
    """Velas que no tocan ni objetivo ni stop."""
    return [(101.0, 99.0, 100.0)] * n


def test_un_desenlace_que_coincide_es_reproducible() -> None:
    v = juzgar("LONG", 100.0, 95.0, 110.0, _tray([(111.0, 99.0, 110.5)]), "tp", 2.0)
    assert v.reproducible is True


def test_un_timeout_sin_horizonte_completo_no_es_reproducible() -> None:
    """Es el caso que llenó el histórico: se cerró por tiempo sin haberle dado su tiempo."""
    v = juzgar("LONG", 100.0, 95.0, 110.0, _tray(_quietas(3), completa=False), "timeout", 0.0)
    assert v.reproducible is False
    assert "ventana incompleta" in v.motivo


def test_un_timeout_con_horizonte_completo_si_lo_es() -> None:
    v = juzgar("LONG", 100.0, 95.0, 110.0, _tray(_quietas(20)), "timeout", 0.0)
    assert v.reproducible is True


def test_un_desenlace_que_hoy_sale_distinto_se_descarta_y_dice_cual() -> None:
    """Guardado «tp» pero con estas velas toca el stop: alguna de las dos reglas no era esta."""
    v = juzgar("LONG", 100.0, 95.0, 110.0, _tray([(101.0, 94.0, 96.0)]), "tp", 2.0)
    assert v.reproducible is False
    assert "«sl»" in v.motivo and "«tp»" in v.motivo
    assert v.r_reevaluado == -1.0


def test_un_timeout_con_otro_r_tampoco_es_reproducible() -> None:
    """Lo que el filtro no veía hasta 0.72.0: misma clase de resultado, distinto R.

    Al corregir la ventana, en torno al 40 % de las operaciones de 1d cambiaban de R y casi todas
    seguían siendo timeouts. Comparando solo la clase, ninguna habría salido como discrepante: el
    verificador no podía fallar por el motivo que se buscaba.
    """
    guardado = 0.380  # timeout que cerró a otro precio con la ventana anterior
    v = juzgar("LONG", 100.0, 95.0, 110.0, _tray(_quietas(10)), "timeout", guardado)
    assert v.reproducible is False
    assert "reevaluado" in v.motivo
    assert v.r_reevaluado == 0.0


def test_diferencias_de_redondeo_no_descartan_nada() -> None:
    v = juzgar("LONG", 100.0, 95.0, 110.0, _tray(_quietas(10)), "timeout", 1e-9)
    assert v.reproducible is True


def test_sin_velas_no_se_puede_juzgar() -> None:
    assert juzgar("LONG", 100.0, 95.0, 110.0, _tray([]), "tp", 2.0).r_reevaluado is None
    v = juzgar("LONG", 100.0, 95.0, 110.0, None, "tp", 2.0)
    assert v.reproducible is False
    assert v.r_reevaluado is None


def test_un_toque_en_la_primera_vela_vale_aunque_falten_las_demas() -> None:
    """Misma asimetría que la evaluación real: el precio estuvo ahí y eso ya no cambia."""
    v = juzgar("LONG", 100.0, 95.0, 110.0, _tray([(101.0, 94.0, 96.0)], completa=False), "sl", -1.0)
    assert v.reproducible is True


def test_el_resumen_separa_los_dos_motivos_de_descarte() -> None:
    """No es lo mismo «le faltan velas» que «con estas velas sale otra cosa»."""
    lista = [
        Veredicto(1, True, "coincide con la regla vigente", 2.0, 2.0),
        Veredicto(2, False, "ventana incompleta", 0.0, None),
        Veredicto(3, False, "reevaluado «sl» frente a «tp» guardado", 2.0, -1.0),
        Veredicto(4, False, "reevaluado con R +0.0000 frente a +0.3800 guardado", 0.38, 0.0),
    ]
    r = resumir(lista)
    assert (r.total, r.reproducibles, r.sin_ventana, r.discrepantes) == (4, 1, 1, 2)
    assert abs(r.fraccion - 1 / 4) < 1e-9


def test_el_resumen_de_una_lista_vacia_no_divide_entre_cero() -> None:
    assert resumir([]).fraccion == 0.0

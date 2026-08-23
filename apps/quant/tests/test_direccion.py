"""Habilidad direccional: el plan espejo y la nula de la moneda.

Todo el veredicto cuelga de que el espejo sea de verdad la misma apuesta al revés. Si la reflexión
deformara el riesgo, las dos ramas no serían comparables y el contrafactual mediría otra cosa.
"""

from __future__ import annotations

import numpy as np

from trademe_quant.backtest import evaluate_trade
from trademe_quant.direccion import juzgar, nula_direccion, plan_espejo

# --- El plan espejo --------------------------------------------------------------------------


def test_invierte_la_direccion() -> None:
    assert plan_espejo("LONG", 100.0, 95.0, 110.0).direction == "SHORT"
    assert plan_espejo("SHORT", 100.0, 105.0, 80.0).direction == "LONG"


def test_refleja_los_niveles_sobre_la_entrada() -> None:
    e = plan_espejo("LONG", 100.0, 95.0, 110.0)
    assert e.entry == 100.0
    assert e.stop == 105.0  # el stop cruza al otro lado, a la misma distancia
    assert e.take_profit == 90.0


def test_conserva_exactamente_la_unidad_de_riesgo() -> None:
    """Si el riesgo cambiara, los R de las dos ramas no serían comparables y todo lo demás cae."""
    for entry, stop, tp in ((100.0, 95.0, 110.0), (7.5, 7.8, 6.9), (61234.5, 60000.0, 63703.5)):
        e = plan_espejo("LONG", entry, stop, tp)
        assert abs(abs(e.entry - e.stop) - abs(entry - stop)) < 1e-9


def test_el_espejo_del_espejo_es_el_original() -> None:
    """Una involución: si no lo fuera, la reflexión estaría metiendo algo por el camino."""
    e = plan_espejo("LONG", 100.0, 95.0, 110.0)
    v = plan_espejo(e.direction, e.entry, e.stop, e.take_profit)
    assert (v.direction, v.entry, v.stop, v.take_profit) == ("LONG", 100.0, 95.0, 110.0)


def test_una_vela_que_da_objetivo_al_largo_da_stop_al_espejo() -> None:
    """La comprobación de extremo a extremo, con el evaluador real del proyecto."""
    highs, lows, closes = [112.0], [99.0], [111.0]
    real = evaluate_trade("LONG", 100.0, 95.0, 110.0, highs, lows, closes)
    e = plan_espejo("LONG", 100.0, 95.0, 110.0)
    contra = evaluate_trade(e.direction, e.entry, e.stop, e.take_profit, highs, lows, closes)
    assert real["result"] == "tp"
    assert contra["result"] == "sl"


# --- La nula de la moneda --------------------------------------------------------------------


def test_si_las_dos_ramas_dan_lo_mismo_la_moneda_no_decide_nada() -> None:
    """Sin diferencia entre acertar y fallar, la nula tiene que ser una constante."""
    r = [1.0] * 40
    dist = nula_direccion(r, list(r), [i // 10 for i in range(40)], permutaciones=100)
    assert float(dist.std()) < 1e-12
    assert abs(float(dist.mean()) - 1.0) < 1e-12


def test_la_moneda_se_lanza_por_BLOQUE_y_no_por_decision() -> None:
    """La propiedad que evita una nula artificialmente estrecha.

    Con una tirada por decisión, la media de 40 sorteos independientes se pegaría a 0 y la nula
    sería un punto. Por bloques, la varianza sobrevive — que es como se pagan de verdad los aciertos
    y fallos de dirección: en rachas.
    """
    real = [2.0] * 40
    espejo = [-2.0] * 40
    pocos_bloques = nula_direccion(real, espejo, [0] * 20 + [1] * 20, permutaciones=2_000)
    muchos = nula_direccion(real, espejo, list(range(40)), permutaciones=2_000)
    assert float(pocos_bloques.std()) > float(muchos.std()) * 2


def test_es_determinista() -> None:
    real, espejo = [1.0, -1.0] * 20, [-1.0, 1.0] * 20
    marcas = [i // 8 for i in range(40)]
    a = nula_direccion(real, espejo, marcas, permutaciones=200)
    b = nula_direccion(real, espejo, marcas, permutaciones=200)
    assert np.array_equal(a, b)


# --- El veredicto ----------------------------------------------------------------------------


def test_acertar_siempre_la_direccion_supera_a_la_moneda() -> None:
    """Si el criterio no viera esto, no serviría para nada."""
    real = [2.0] * 60  # la plataforma siempre acierta
    espejo = [-1.0] * 60
    dirs = ["LONG" if i % 2 else "SHORT" for i in range(60)]
    v = juzgar(real, espejo, dirs, [i // 10 for i in range(60)], permutaciones=1_000)
    assert v.supera
    assert v.observada == 2.0


def test_fallar_siempre_no_supera_a_la_moneda() -> None:
    real = [-1.0] * 60
    espejo = [2.0] * 60
    dirs = ["LONG" if i % 2 else "SHORT" for i in range(60)]
    v = juzgar(real, espejo, dirs, [i // 10 for i in range(60)], permutaciones=1_000)
    assert not v.supera


def test_la_deriva_se_reporta_aparte_de_lo_elegido() -> None:
    """El número que impide confundir viento a favor con habilidad.

    Todas las decisiones son largas y ganan. `siempre_largo` tiene que dar lo mismo que lo
    observado: no se eligió nada, se estuvo en el lado que subía.
    """
    real = [1.5] * 40
    espejo = [-1.0] * 40
    v = juzgar(real, espejo, ["LONG"] * 40, [i // 10 for i in range(40)], permutaciones=500)
    assert abs(v.siempre_largo - v.observada) < 1e-12
    assert abs(v.siempre_corto - (-1.0)) < 1e-12


def test_sin_datos_no_inventa_veredicto() -> None:
    v = juzgar([], [], [], [], permutaciones=10)
    assert v.n == 0 and not v.supera

"""El sizing por volatilidad inversa, y la normalización sin la cual no se mide nada.

Sin normalizar los pesos a media 1, «arriesgar menos» baja el drawdown por definición y se leería
como una mejora. El test que lo fija es el que impide que este estudio se engañe solo.
"""

from __future__ import annotations

import pytest

from trademe_quant.sizing import (
    PESO_MAX,
    PESO_MIN,
    curva,
    pesos_por_volatilidad_inversa,
)


def test_los_pesos_tienen_media_uno() -> None:
    """La exposición media no cambia respecto al baseline: solo cambia su reparto.

    Es la condición que hace justa la comparación de drawdowns. Sin ella se estaría midiendo la
    escala y no el mecanismo.
    """
    for vols in ([0.01, 0.02, 0.04, 0.03], [0.005] * 10, [0.01, 0.10, 0.02, 0.05, 0.03]):
        w = pesos_por_volatilidad_inversa(vols)
        assert sum(w) / len(w) == pytest.approx(1.0)


def test_menos_volatilidad_pesa_mas() -> None:
    """La dirección del mecanismo, que es lo único que no puede estar del revés."""
    w = pesos_por_volatilidad_inversa([0.01, 0.02, 0.04])
    assert w[0] > w[1] > w[2]


def test_los_pesos_estan_recortados() -> None:
    """Sin recorte, una operación en un mercado plano decidiría la curva ella sola.

    Se comprueba sobre la **razón** entre el mayor y el menor, que es lo que el recorte acota de
    verdad: la normalización posterior reescala todo, así que comparar cada peso contra la constante
    daría una aserción que parece estricta y no lo es.
    """
    w = pesos_por_volatilidad_inversa([0.0001, 0.5, 0.5, 0.5, 0.5])
    assert max(w) / min(w) <= PESO_MAX / PESO_MIN + 1e-9
    # Y sin recorte la razón sería el cociente de volatilidades: 5.000 a 1.
    assert max(w) / min(w) < 100


def test_volatilidad_nula_no_recibe_peso_infinito() -> None:
    """Un dato que falta no es un dato de volatilidad cero."""
    w = pesos_por_volatilidad_inversa([0.0, 0.02, 0.02, 0.02])
    assert all(x > 0 for x in w)
    assert max(w) < 100


def test_sin_volatilidades_utiles_todos_pesan_igual() -> None:
    assert pesos_por_volatilidad_inversa([0.0, 0.0, 0.0]) == [1.0, 1.0, 1.0]


def test_curva_sin_pesos_es_la_de_siempre() -> None:
    rs = [1.0, -1.0, 2.0, -1.0]
    assert curva(rs) == curva(rs, [1.0, 1.0, 1.0, 1.0])


def test_el_drawdown_se_mide_desde_el_pico() -> None:
    m = curva([1.0, 1.0, -3.0, 1.0])
    assert m["total"] == pytest.approx(0.0)
    assert m["max_dd"] == pytest.approx(3.0)


def test_el_drawdown_cuenta_una_caida_desde_el_inicio() -> None:
    """El pico de partida es 0: una serie que solo pierde tiene drawdown, no cero."""
    assert curva([-1.0, -1.0])["max_dd"] == pytest.approx(2.0)


def test_retorno_por_dd_es_invariante_a_la_escala() -> None:
    """La razón de mirarlo a él y no al drawdown a secas: arriesgar la mitad no es una mejora."""
    rs = [1.0, -1.0, 2.0, -1.0, 1.5]
    completo = curva(rs)
    mitad = curva(rs, [0.5] * len(rs))
    assert mitad["max_dd"] < completo["max_dd"]  # el drawdown sí baja...
    assert mitad["retorno_por_dd"] == pytest.approx(completo["retorno_por_dd"])  # ...y no es mejora
    assert mitad["sharpe"] == pytest.approx(completo["sharpe"])


def test_curva_vacia_no_revienta() -> None:
    assert curva([])["max_dd"] == 0.0

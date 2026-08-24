"""Gobierno de la promoción: que una configuración tenga que demostrar algo para operar.

Lo que se vigila: que las tres condiciones se exijan de verdad y que el criterio **solo endurezca**
— cualquier configuración que pase el guardia nuevo habría pasado también el viejo.
"""

from __future__ import annotations

from trademe_quant.promocion import (
    MIN_EXPECTANCY,
    MIN_TRADES_HOLDOUT,
    decidir,
    marcas_de_indices,
    mejora_nula_p95,
)

# --- Los tres casos reales que el criterio viejo dejaba pasar ----------------------------------


def test_no_promociona_lo_que_promete_perder() -> None:
    """Aunque la base fuera aún peor y la muestra sobre: perder menos no es ganar."""
    v = decidir(base_expectancy=-0.768, optimized_expectancy=-0.579, n_holdout=40)
    assert not v.promover
    assert "no promete ganar" in v.motivo


def test_el_caso_real_de_BTCUSDT_15m_falla_por_las_dos_cosas() -> None:
    """Se promocionó con -0,579 R y 21 operaciones. Se informa del primer motivo, la muestra."""
    v = decidir(base_expectancy=-0.768, optimized_expectancy=-0.579, n_holdout=21)
    assert not v.promover
    assert "muestra insuficiente" in v.motivo


def test_no_promociona_con_once_operaciones() -> None:
    """BNBUSDT:30m se promocionó con 11 operaciones en hold-out."""
    v = decidir(base_expectancy=-0.583, optimized_expectancy=-0.274, n_holdout=11)
    assert not v.promover
    assert "muestra insuficiente" in v.motivo


def test_no_promociona_una_mejora_que_alcanza_el_azar() -> None:
    v = decidir(base_expectancy=0.10, optimized_expectancy=0.30, n_holdout=30, nula_p95=0.35)
    assert not v.promover
    assert "no supera al azar" in v.motivo


def test_promociona_lo_que_cumple_las_tres() -> None:
    v = decidir(base_expectancy=0.10, optimized_expectancy=0.45, n_holdout=30, nula_p95=0.20)
    assert v.promover
    assert "promete" in v.motivo


# --- Solo endurece -----------------------------------------------------------------------------


def test_todo_lo_que_pasa_el_guardia_nuevo_pasaba_el_viejo() -> None:
    """La garantía: `mejora > nula >= 0` implica `optimizada > base`. Nunca relaja.

    Se barre en vez de fiarse de un ejemplo favorable, que es como se comprueban las garantías en
    este proyecto.
    """
    for base in (-1.0, -0.3, 0.0, 0.2, 0.9):
        for opt in (-1.0, -0.2, 0.0, 0.06, 0.5, 1.5):
            for n in (5, 24, 25, 80):
                for nula in (0.0, 0.15, 0.6):
                    v = decidir(base, opt, n, nula)
                    if v.promover:
                        assert opt > base, (base, opt, n, nula)


def test_el_suelo_de_rentabilidad_es_absoluto() -> None:
    """Por muy mala que sea la base, una candidata que no gana no se promociona."""
    v = decidir(base_expectancy=-5.0, optimized_expectancy=MIN_EXPECTANCY - 0.001, n_holdout=100)
    assert not v.promover


def test_el_limite_de_muestra_es_estricto() -> None:
    justo = decidir(0.0, 0.5, MIN_TRADES_HOLDOUT, nula_p95=0.1)
    debajo = decidir(0.0, 0.5, MIN_TRADES_HOLDOUT - 1, nula_p95=0.1)
    assert justo.promover and not debajo.promover


def test_el_motivo_siempre_explica_la_decision() -> None:
    """Una promoción automática que no se puede explicar no es auditable."""
    for base, opt, n, nula in ((-0.7, -0.5, 21, 0.0), (0.1, 0.3, 30, 0.35), (0.0, 0.6, 40, 0.1)):
        v = decidir(base, opt, n, nula)
        assert isinstance(v.motivo, str) and len(v.motivo) > 15


# --- La nula ------------------------------------------------------------------------------------


def test_sin_diferencia_entre_ramas_la_nula_es_cero() -> None:
    """Si las dos configuraciones dan lo mismo, intercambiarlas no puede producir mejora."""
    r = [0.5] * 40
    marcas = [i // 10 for i in range(40)]
    assert abs(mejora_nula_p95(r, list(r), marcas, permutaciones=200)) < 1e-9


def test_la_nula_crece_con_la_diferencia_entre_ramas() -> None:
    """Cuanto más se distinguen las dos ramas, más mejora puede fabricar el azar al barajarlas."""
    marcas = [i // 10 for i in range(40)]
    poca = mejora_nula_p95([0.1] * 40, [0.2] * 40, marcas, permutaciones=500)
    mucha = mejora_nula_p95([-2.0] * 40, [2.0] * 40, marcas, permutaciones=500)
    assert mucha > poca


def test_series_vacias_no_producen_liston() -> None:
    assert mejora_nula_p95([], [1.0], [0], permutaciones=10) == 0.0
    assert mejora_nula_p95([1.0], [], [0], permutaciones=10) == 0.0


def test_un_solo_bloque_no_da_para_estimar() -> None:
    assert mejora_nula_p95([1.0] * 5, [2.0] * 5, [0] * 5, permutaciones=10) == 0.0


def test_las_marcas_agrupan_indices_en_bloques() -> None:
    assert marcas_de_indices([0, 50, 96, 97, 200], 96) == [0, 0, 1, 1, 2]
    assert marcas_de_indices([0, 1, 2], 0) == [0, 1, 2]  # sin bloque, cada índice es el suyo

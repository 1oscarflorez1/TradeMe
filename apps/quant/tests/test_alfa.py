"""El marco de alfa ortogonal: un vector tiene que aportar dinero, no solo información."""

from __future__ import annotations

from trademe_quant.alfa import MIN_OPERACIONES, UMBRAL_VIABILIDAD, evaluar_vector, juzgar


def _marcas(n: int, por_bloque: int = 6) -> list[int]:
    return [i // por_bloque for i in range(n)]


def test_sin_muestra_a_los_dos_lados_no_se_juzga_nada() -> None:
    """Un filtro que apenas descarta tiene lift ~0 por construcción: eso no es «no perjudica»."""
    rs = [0.5] * 100
    apenas = [i < 3 for i in range(100)]
    v = juzgar(rs, apenas, _marcas(100))
    assert v.aporta is False
    assert "muestra insuficiente" in v.motivo


def test_mejorar_sin_llegar_a_negocio_no_basta() -> None:
    """De −0,20 a −0,10 R es una mejora real y sigue siendo ruinoso.

    Sin esta condición el marco aprobaría filtros que solo pierden más despacio — el mismo fallo
    que 0.54.0 corrigió en el optimizador.
    """
    # Las descartadas son las peores, así que el lift es grande y la neta sigue negativa.
    rs = [-1.0] * 60 + [-0.2] * 60
    descartadas = [i < 60 for i in range(120)]
    v = juzgar(rs, descartadas, _marcas(120), permutaciones=200)
    assert v.lift > 0, "descartar las peores debe subir la expectancy"
    assert v.filtrada_neta < UMBRAL_VIABILIDAD
    assert v.aporta is False
    assert "no llega a ser negocio" in v.motivo


def test_un_filtro_que_no_supera_al_azar_se_rechaza() -> None:
    """Con retornos sin estructura, descartar un tercio no puede aportar nada sistemático."""
    rs = [0.4 if i % 2 else -0.4 for i in range(120)]
    descartadas = [i % 3 == 0 for i in range(120)]
    v = juzgar(rs, descartadas, _marcas(120), permutaciones=400)
    assert v.aporta is False


def test_un_filtro_que_descarta_las_perdedoras_y_deja_negocio_aporta() -> None:
    """El caso positivo: hace falta que exista para saber que el marco sabe decir que sí."""
    rs = [-1.0 if i < 40 else 0.6 for i in range(120)]
    descartadas = [i < 40 for i in range(120)]
    v = juzgar(rs, descartadas, _marcas(120), permutaciones=400)
    assert v.aporta is True
    assert v.filtrada_neta > UMBRAL_VIABILIDAD
    assert "aporta" in v.motivo


def test_las_operaciones_sin_valor_del_vector_se_quedan_fuera() -> None:
    """Un hueco de datos no es una lectura neutra; asumirle un cero ensuciaría el tercil."""
    trades = [{"index": i, "r": 0.1} for i in range(60)]
    valores = {i: float(i) for i in range(30)}  # solo la mitad tiene valor
    v = evaluar_vector(trades, valores, velas_por_bloque=6)
    assert v.n == 30


def test_el_umbral_de_viabilidad_es_el_orden_del_coste_de_1d() -> None:
    """No es un número redondo elegido a ojo: 1d cuesta 0,018 R y rinde +0,020 neta."""
    assert 0.010 <= UMBRAL_VIABILIDAD <= 0.025
    assert MIN_OPERACIONES >= 25

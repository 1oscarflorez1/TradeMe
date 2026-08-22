"""Distribuciones nulas por bloques (Hito A).

Lo que hay que vigilar aquí no es que los números salgan «bonitos», sino tres propiedades:

1. Cuando la nula **no se puede estimar**, devuelve 0,0 — y eso deja gobernando al umbral fijo, que
   es el comportamiento anterior. Nunca relaja.
2. Con una población **plana**, la nula es esa constante: sin aleatoriedad no se inventa varianza.
3. El muestreo **por bloques** captura la varianza que el muestreo por filas se comería. Es la razón
   de ser del módulo, y sin este test sería una afirmación del docstring.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import numpy as np

from trademe_quant.nula import (
    MIN_BLOQUES,
    MIN_POBLACION,
    agrupar,
    distribucion_expectancy_bloques,
    marcas_de,
    p95_seleccion,
    percentil_expectancy_bloques,
)

INICIO = datetime(2026, 8, 1, tzinfo=UTC)


def _poblacion(dias: int, por_dia: int, valor_dia: list[float]) -> tuple[list[float], list[int]]:
    """Población sintética: cada día tiene su propio valor, repetido `por_dia` veces."""
    rs: list[float] = []
    fechas: list[datetime] = []
    for d in range(dias):
        for k in range(por_dia):
            rs.append(valor_dia[d % len(valor_dia)])
            fechas.append(INICIO + timedelta(days=d, minutes=k))
    return rs, marcas_de(fechas)


# --- Utilidades ------------------------------------------------------------------------------


def test_marcas_separan_dias_y_juntan_horas() -> None:
    fechas = [INICIO, INICIO + timedelta(hours=23), INICIO + timedelta(days=3)]
    marcas = marcas_de(fechas)
    assert marcas[0] == marcas[1]
    assert marcas[2] != marcas[0]


def test_lo_que_no_es_fecha_cae_en_el_bloque_cero() -> None:
    """No se inventa un bloque por fila: sin fecha, la nula por bloques degenera en la simple."""
    assert marcas_de([None, "2026-08-01", 17]) == [0, 0, 0]


def test_agrupar_ordena_por_marca() -> None:
    grupos = agrupar([5, 1, 5, 1, 9])
    assert [list(g) for g in grupos] == [[1, 3], [0, 2], [4]]


# --- Guardias: cuando no se puede estimar, no se estima -----------------------------------------


def test_poblacion_pequena_no_produce_nula() -> None:
    rs, marcas = _poblacion(dias=10, por_dia=5, valor_dia=[1.0])  # 50 < MIN_POBLACION
    assert len(rs) < MIN_POBLACION
    assert percentil_expectancy_bloques(rs, marcas, 10) == 0.0


def test_pocos_bloques_no_producen_nula() -> None:
    """Con cuatro días, el «percentil 95» sería el mejor de los cuatro: no mide variabilidad."""
    rs, marcas = _poblacion(dias=MIN_BLOQUES - 1, por_dia=50, valor_dia=[1.0, -1.0])
    assert len(agrupar(marcas)) < MIN_BLOQUES
    assert percentil_expectancy_bloques(rs, marcas, 10) == 0.0


def test_muestra_vacia_no_produce_nula() -> None:
    rs, marcas = _poblacion(dias=20, por_dia=30, valor_dia=[1.0, -1.0])
    assert percentil_expectancy_bloques(rs, marcas, 0) == 0.0


def test_sin_seleccionadas_no_hay_nada_que_comparar() -> None:
    assert p95_seleccion([1.0, 2.0], [0, 0], [False, False], lambda a, e: 1.0) == 0.0
    assert p95_seleccion([], [], [], lambda a, e: 1.0) == 0.0


# --- Población plana: no se inventa varianza ---------------------------------------------------


def test_poblacion_plana_da_exactamente_la_constante() -> None:
    rs, marcas = _poblacion(dias=20, por_dia=30, valor_dia=[0.42])
    assert abs(percentil_expectancy_bloques(rs, marcas, 30, permutaciones=200) - 0.42) < 1e-12


def test_es_determinista() -> None:
    """Dos ejecuciones sobre los mismos datos deben dar el mismo veredicto."""
    rs, marcas = _poblacion(dias=20, por_dia=30, valor_dia=[1.0, -0.5, 0.3, -1.0])
    a = percentil_expectancy_bloques(rs, marcas, 30, permutaciones=300)
    b = percentil_expectancy_bloques(rs, marcas, 30, permutaciones=300)
    assert a == b


# --- Lo que justifica el diseño ----------------------------------------------------------------


def test_los_bloques_capturan_la_varianza_que_las_filas_sueltas_esconden() -> None:
    """La propiedad que da sentido al módulo entero.

    Población donde cada día es homogéneo (todo +1 o todo −1) y la media global es 0. Coger 30 filas
    sueltas daría casi siempre ~0; coger un día entero da +1 o −1. Si la nula fuese por filas, un
    +0,9 R medido en un solo día parecería extraordinario. Por bloques, no.
    """
    rs, marcas = _poblacion(dias=20, por_dia=40, valor_dia=[1.0, -1.0])
    assert abs(float(np.mean(rs))) < 1e-9  # la población está centrada en 0

    p95_bloques = percentil_expectancy_bloques(rs, marcas, 30, permutaciones=2_000, percentil=95)

    # Muestreo por filas sueltas, para contrastar: la varianza casi desaparece.
    rng = np.random.default_rng(1)
    arr = np.asarray(rs)
    sueltas = np.asarray(
        [arr[rng.choice(arr.size, 30, replace=False)].mean() for _ in range(2_000)]
    )
    p95_sueltas = float(np.percentile(sueltas, 95))

    assert p95_bloques > 0.9, p95_bloques
    assert p95_sueltas < 0.45, p95_sueltas


def test_el_estadistico_lo_pone_quien_llama() -> None:
    """Fundamental Score y meta-modelo llaman «lift» a cosas con distinto denominador."""
    rs = [2.0, 2.0, -1.0, -1.0] * 10
    marcas = [0, 0, 1, 1] * 10
    seleccionadas = [True, False, True, False] * 10

    def descartando(arr: np.ndarray, sel: np.ndarray) -> float:
        return float(np.where(sel, 0.0, arr).mean()) - float(arr.mean())

    def conservando(arr: np.ndarray, sel: np.ndarray) -> float:
        return float(arr[sel].mean()) - float(arr.mean())

    a = p95_seleccion(rs, marcas, seleccionadas, descartando, permutaciones=200)
    b = p95_seleccion(rs, marcas, seleccionadas, conservando, permutaciones=200)
    assert a != b


def test_el_percentil_lo_elige_quien_pregunta() -> None:
    """La mediana y el P95 responden a preguntas distintas, y confundirlos costó un despliegue.

    En v0.46.0 la puerta de salida de la cuarentena usó el P95 de una nula muestreada de la propia
    plataforma. Eso no es un listón de calidad: **es un cupo**. Lo que se comprueba aquí es
    exactamente eso — qué fracción de la propia distribución deja pasar cada percentil— porque es
    la parte que engaña: un P95 suena a «exigente» y significa «solo el 5 % lo cumple».
    """
    # Población continua a propósito: con días homogéneos la nula sale discreta, el P95 empata
    # consigo mismo y la fracción que lo «cruza» se dispara. Es el mismo problema de empates que
    # obligó a que el informe use p-valor en vez de percentil.
    rng = np.random.default_rng(11)
    rs: list[float] = []
    fechas: list[datetime] = []
    for d in range(20):
        centro = float(rng.normal(0.1, 0.6))
        for k in range(40):
            rs.append(centro + float(rng.normal(0, 0.4)))
            fechas.append(INICIO + timedelta(days=d, minutes=k))
    marcas = marcas_de(fechas)

    dist = distribucion_expectancy_bloques(rs, marcas, 30, permutaciones=4_000)
    assert dist is not None

    mediana = percentil_expectancy_bloques(rs, marcas, 30, permutaciones=4_000, percentil=50)
    p95 = percentil_expectancy_bloques(rs, marcas, 30, permutaciones=4_000, percentil=95)
    assert p95 > mediana

    # Un umbral puesto en el P95 solo lo cruza ~1 de cada 20; en la mediana, ~1 de cada 2.
    assert float((dist >= p95).mean()) <= 0.08
    assert 0.42 <= float((dist >= mediana).mean()) <= 0.58

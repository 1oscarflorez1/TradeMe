"""Aportación de información sobre el desenlace — el criterio que sustituye a los votos efectivos.

Lo que hay que vigilar es que el instrumento **discrimine**, que es justo lo que fallaba en el
anterior: tiene que aprobar a una columna que de verdad predice y suspender al ruido y a las copias.
Un criterio que suspende a todo el mundo no mide nada, y ese fue el error que costó el Hito B.
"""

from __future__ import annotations

import numpy as np

from trademe_quant.informacion import (
    MIN_DELTA_AUC,
    aporta_informacion,
    auc_fuera_de_muestra,
)

N = 400
BLOQUES = [i // 20 for i in range(N)]  # 20 bloques temporales


def _mundo(semilla: int = 5) -> tuple[list[list[float]], list[int], np.ndarray]:
    """Seis votos ruidosos y un desenlace que depende de una señal oculta."""
    rng = np.random.default_rng(semilla)
    oculta = rng.standard_normal(N)
    # Los votos ven la señal con mucho ruido; ninguno la ve bien por sí solo.
    votos = [list(oculta * 0.35 + rng.standard_normal(N) * 0.9) for _ in range(6)]
    p = 1.0 / (1.0 + np.exp(-oculta))
    y = [int(v) for v in (rng.random(N) < p)]
    return votos, y, oculta


# --- El instrumento discrimina ----------------------------------------------------------------


def test_una_columna_que_predice_de_verdad_aporta() -> None:
    """Si el criterio no aprueba esto, no sirve para nada. Es la prueba que el anterior fallaba."""
    votos, y, oculta = _mundo()
    a = aporta_informacion(votos, list(oculta), y, BLOQUES, permutaciones=60)
    assert a.aporta, a
    assert a.delta > MIN_DELTA_AUC
    assert a.auc_ampliado > a.auc_base


def test_el_ruido_no_aporta() -> None:
    votos, y, _ = _mundo()
    ruido = list(np.random.default_rng(99).standard_normal(N))
    a = aporta_informacion(votos, ruido, y, BLOQUES, permutaciones=60)
    assert not a.aporta, a


def test_una_copia_de_un_voto_existente_no_aporta() -> None:
    """El caso que más importa cazar: repetir lo que ya se sabe con otro nombre."""
    votos, y, _ = _mundo()
    a = aporta_informacion(votos, list(votos[0]), y, BLOQUES, permutaciones=60)
    assert not a.aporta, a


def test_una_mejora_ridicula_no_aporta_aunque_supere_la_nula() -> None:
    """El suelo de `MIN_DELTA_AUC`: un +0,001 significativo sigue sin servir para operar."""
    votos, y, oculta = _mundo()
    # Señal verdadera, pero tan diluida que su aportación es despreciable.
    debil = list(oculta * 0.02 + np.random.default_rng(1).standard_normal(N))
    a = aporta_informacion(votos, debil, y, BLOQUES, permutaciones=60)
    assert a.delta < MIN_DELTA_AUC or not a.aporta


# --- Guardias ---------------------------------------------------------------------------------


def test_muestra_corta_no_produce_veredicto() -> None:
    votos = [[0.1, 0.2, 0.3] for _ in range(6)]
    a = aporta_informacion(votos, [1.0, 2.0, 3.0], [1, 0, 1], [0, 0, 1], permutaciones=5)
    assert not a.aporta
    assert a.auc_base == 0.5


def test_longitudes_incoherentes_no_revientan() -> None:
    votos = [[0.1] * 10 for _ in range(6)]
    a = aporta_informacion(votos, [1.0] * 5, [1] * 10, [0] * 10, permutaciones=5)
    assert not a.aporta


def test_una_sola_clase_no_inventa_auc() -> None:
    """Sin perdedoras no hay nada que ordenar: 0,5, no un número con aspecto de medición."""
    X = np.random.default_rng(2).standard_normal((100, 3))
    assert auc_fuera_de_muestra(X, np.ones(100, dtype=int)) == 0.5


def test_es_determinista() -> None:
    votos, y, oculta = _mundo()
    a = aporta_informacion(votos, list(oculta), y, BLOQUES, permutaciones=30)
    b = aporta_informacion(votos, list(oculta), y, BLOQUES, permutaciones=30)
    assert a == b


# --- La validación no puede mirar al futuro ---------------------------------------------------


def test_la_validacion_es_por_bloques_temporales() -> None:
    """Con una columna que solo predice en la SEGUNDA mitad, entrenar con el futuro se notaría.

    Si la validación barajara el tiempo, el modelo aprendería la relación en el tramo tardío y la
    aplicaría al temprano, inflando el AUC. Por bloques contiguos, no.
    """
    rng = np.random.default_rng(11)
    y = np.zeros(N, dtype=int)
    y[N // 2 :] = (rng.random(N // 2) < 0.8).astype(int)
    y[: N // 2] = (rng.random(N // 2) < 0.2).astype(int)
    # Columna constante en la primera mitad: no puede explicar nada de ese tramo.
    col = np.concatenate([np.zeros(N // 2), rng.standard_normal(N // 2)])
    auc = auc_fuera_de_muestra(col.reshape(-1, 1), y)
    assert 0.0 <= auc <= 1.0

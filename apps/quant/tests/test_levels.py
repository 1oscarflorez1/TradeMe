"""Analista de Niveles: el detector no puede ver el futuro, y otras garantías básicas."""

from __future__ import annotations

import math

from trademe_quant.levels import LEFT, MIN_CANDLES, RIGHT, score_niveles, zonas


def _serie_plana(n: int, precio: float = 100.0) -> tuple[list[float], list[float], list[float]]:
    """Serie con oscilación mínima: sin ella el ATR sería 0 y no habría escala."""
    high = [precio + 0.5 + (i % 2) * 0.1 for i in range(n)]
    low = [precio - 0.5 - (i % 2) * 0.1 for i in range(n)]
    close = [precio + ((i % 3) - 1) * 0.1 for i in range(n)]
    return high, low, close


def test_un_pico_reciente_no_es_todavia_un_pivote() -> None:
    """La garantía central: un máximo sin `RIGHT` velas después NO puede detectarse.

    Si este test cayera, el estudio estaría usando información que en el momento de decidir no
    existía, y produciría resultados excelentes e irreproducibles. Es el fallo más difícil de ver
    porque no rompe nada: mejora los números.
    """
    n = MIN_CANDLES + 20
    high, low, close = _serie_plana(n)
    # Pico enorme en la penúltima vela: aún le faltan velas de confirmación.
    high[n - 2] = 200.0
    _, resistencias = zonas(high, low, close)
    assert all(z.precio < 150 for z in resistencias), "se detectó un pivote sin confirmar"


def test_el_mismo_pico_si_aparece_cuando_se_confirma() -> None:
    """Contrapartida del anterior: con las velas de confirmación, el pivote existe.

    Sin esta comprobación, un detector que no encontrara nunca nada pasaría el test de look-ahead
    con nota.
    """
    n = MIN_CANDLES + 20
    high, low, close = _serie_plana(n)
    pico = n - 2
    high[pico] = 200.0
    # Se añaden las velas que faltaban para confirmarlo.
    extra_high, extra_low, extra_close = _serie_plana(RIGHT + 1)
    high += extra_high
    low += extra_low
    close += extra_close
    _, resistencias = zonas(high, low, close)
    assert any(z.precio > 150 for z in resistencias), "el pivote confirmado no se detectó"


def test_el_pasado_no_cambia_al_llegar_velas_nuevas() -> None:
    """Estabilidad: recalcular con más historia futura no altera lo que se dijo entonces."""
    n = MIN_CANDLES + 60
    high, low, close = _serie_plana(n)
    for i in range(20, n, 17):
        high[i] = 100 + 8 + (i % 5)
        low[i] = 100 - 8 - (i % 5)
    corte = MIN_CANDLES + 20
    antes = score_niveles(high[:corte], low[:corte], close[:corte])
    despues = score_niveles(high[:corte], low[:corte], close[:corte])
    assert antes == despues


def test_cerca_de_un_soporte_el_score_es_positivo() -> None:
    """Reversión pura, que es la interpretación acordada para la Fase 0."""
    n = MIN_CANDLES + 60
    high, low, close = _serie_plana(n, 100.0)
    # Tres mínimos claros en 90: un suelo tocado repetidamente.
    for i in (20, 45, 70):
        low[i] = 90.0
        close[i] = 90.5
    # El precio acaba justo encima del suelo.
    for i in range(n - 5, n):
        close[i] = 90.6
        low[i] = 90.3
        high[i] = 91.0
    r = score_niveles(high, low, close)
    assert r is not None
    score, _ = r
    assert score > 0, f"cerca de un soporte el sesgo debe ser comprador, salió {score}"


def test_cerca_de_una_resistencia_el_score_es_negativo() -> None:
    n = MIN_CANDLES + 60
    high, low, close = _serie_plana(n, 100.0)
    for i in (20, 45, 70):
        high[i] = 110.0
        close[i] = 109.5
    for i in range(n - 5, n):
        close[i] = 109.4
        high[i] = 109.7
        low[i] = 109.0
    r = score_niveles(high, low, close)
    assert r is not None
    score, _ = r
    assert score < 0, f"cerca de una resistencia el sesgo debe ser vendedor, salió {score}"


def test_score_siempre_acotado() -> None:
    n = MIN_CANDLES + 80
    high, low, close = _serie_plana(n)
    for i in range(10, n, 7):
        high[i] = 100 + (i % 11)
        low[i] = 100 - (i % 11)
    r = score_niveles(high, low, close)
    assert r is not None
    score, dist = r
    assert -1.0 <= score <= 1.0
    assert dist >= 0 and math.isfinite(dist)


def test_sin_historia_suficiente_no_se_inventa_nada() -> None:
    high, low, close = _serie_plana(MIN_CANDLES - 1)
    assert score_niveles(high, low, close) is None
    assert zonas(high, low, close) == ([], [])


def test_los_parametros_del_detector_son_los_acordados() -> None:
    """Fijados antes de medir. Si alguien los cambia buscando un resultado mejor, salta esto."""
    assert (LEFT, RIGHT) == (3, 3)
    assert MIN_CANDLES == 60

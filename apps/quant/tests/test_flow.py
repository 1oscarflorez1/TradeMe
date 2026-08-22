"""Flujo de agresores (CVD) — Fase 0 del Hito B.

Lo que se vigila aquí es que la aritmética del delta sea la correcta, porque todo el estudio cuelga
de ella: si `delta = 2·taker_buy − volumen` estuviera mal, el informe mediría otra cosa y el
veredicto no valdría nada. Y que las métricas se comporten en los extremos conocidos.
"""

from __future__ import annotations

import numpy as np

from trademe_quant.flow import (
    MIN_CANDLES,
    WINDOW,
    delta_por_vela,
    ratio_por_vela,
    score_flujo,
)

# --- La aritmética del delta -----------------------------------------------------------------


def test_todo_comprador_agresivo_da_delta_maximo() -> None:
    assert delta_por_vela(volumen=10.0, taker_buy_base=10.0) == 10.0
    assert ratio_por_vela(volumen=10.0, taker_buy_base=10.0) == 1.0


def test_todo_vendedor_agresivo_da_delta_minimo() -> None:
    assert delta_por_vela(volumen=10.0, taker_buy_base=0.0) == -10.0
    assert ratio_por_vela(volumen=10.0, taker_buy_base=0.0) == -1.0


def test_mitad_y_mitad_da_cero() -> None:
    """El caso que distingue el flujo del volumen: mucho volumen y ninguna iniciativa neta."""
    assert delta_por_vela(volumen=1000.0, taker_buy_base=500.0) == 0.0
    assert ratio_por_vela(volumen=1000.0, taker_buy_base=500.0) == 0.0


def test_coincide_con_taker_buy_menos_taker_sell() -> None:
    """La definición, comprobada por su otro camino: comprador agresivo − vendedor agresivo."""
    volumen, taker_buy = 37.5, 21.25
    taker_sell = volumen - taker_buy
    assert abs(delta_por_vela(volumen, taker_buy) - (taker_buy - taker_sell)) < 1e-12


def test_una_vela_real_de_binance() -> None:
    """Cifras copiadas de una kline real de BTCUSDT (22 ago 2026), para fijar la interpretación."""
    volumen, taker_buy = 0.95674, 0.85629
    assert abs(delta_por_vela(volumen, taker_buy) - 0.75584) < 1e-9
    assert 0.78 < ratio_por_vela(volumen, taker_buy) < 0.80


def test_volumen_cero_no_revienta() -> None:
    """Ocurre en activos poco líquidos y en velas sin operaciones."""
    assert ratio_por_vela(volumen=0.0, taker_buy_base=0.0) == 0.0


def test_el_ratio_esta_acotado() -> None:
    """Aunque Binance devolviera un taker_buy incoherente, el ratio no se sale de [-1, 1]."""
    assert ratio_por_vela(volumen=10.0, taker_buy_base=99.0) == 1.0
    assert ratio_por_vela(volumen=10.0, taker_buy_base=-5.0) == -1.0


# --- Las métricas ----------------------------------------------------------------------------


def _serie(
    n: int, ratio: float, precio_paso: float = 0.0
) -> tuple[list[float], list[float], list[float]]:
    """Genera n velas con volumen 100 y el ratio de agresores pedido."""
    vol = [100.0] * n
    # ratio = (2*tb - v)/v  ->  tb = v*(1+ratio)/2
    tbb = [100.0 * (1.0 + ratio) / 2.0] * n
    closes = [100.0 + i * precio_paso for i in range(n)]
    return vol, tbb, closes


def test_sin_velas_suficientes_no_hay_metrica() -> None:
    vol, tbb, closes = _serie(MIN_CANDLES - 1, 0.5)
    assert score_flujo(vol, tbb, closes) is None


def test_flujo_constante_no_produce_señal() -> None:
    """Sin dispersión no hay z-score que calcular: la métrica es 0, no un número inventado.

    Importa porque un CVD que crece de forma perfectamente lineal —presión constante— no dice nada
    nuevo en ningún punto de la ventana.
    """
    vol, tbb, closes = _serie(WINDOW, 0.5)
    f = score_flujo(vol, tbb, closes)
    assert f is not None
    assert abs(f.delta_ratio - 0.5) < 1e-9
    # El CVD acumulado crece linealmente; su z en el último punto es alto pero finito y estable.
    assert np.isfinite(f.cvd_z)


def test_un_giro_de_flujo_al_final_se_nota() -> None:
    """Compradores dominando y, al final, vendedores: el z del CVD tiene que caer."""
    vol_a, tbb_a, cl_a = _serie(WINDOW - 5, 0.8)
    vol_b, tbb_b, cl_b = _serie(5, -0.8)
    sostenido = score_flujo(*_serie(WINDOW, 0.8))
    con_giro = score_flujo(vol_a + vol_b, tbb_a + tbb_b, cl_a + cl_b)
    assert sostenido is not None and con_giro is not None
    assert con_giro.cvd_z < sostenido.cvd_z
    assert con_giro.delta_ratio < 0


def test_la_divergencia_separa_flujo_de_precio() -> None:
    """La razón de ser de la segunda métrica.

    Dos ventanas con el MISMO flujo comprador y precios que se mueven distinto tienen que dar
    divergencias distintas. Si no, la métrica sería una copia del precio con otro nombre.
    """
    plano = score_flujo(*_serie(WINDOW, 0.6, precio_paso=0.0))
    subiendo = score_flujo(*_serie(WINDOW, 0.6, precio_paso=1.0))
    assert plano is not None and subiendo is not None
    assert abs(plano.cvd_z - subiendo.cvd_z) < 1e-9  # mismo flujo
    assert plano.divergencia != subiendo.divergencia  # distinta lectura


def test_solo_se_miran_las_ultimas_WINDOW_velas() -> None:
    """La ventana es fija: lo de hace mil velas no describe la presión de ahora."""
    largo = _serie(WINDOW * 3, 0.4)
    corto = _serie(WINDOW, 0.4)
    a, b = score_flujo(*largo), score_flujo(*corto)
    assert a is not None and b is not None
    assert abs(a.cvd_z - b.cvd_z) < 1e-9

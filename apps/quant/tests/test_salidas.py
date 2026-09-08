"""La gestión de la salida, con las dos propiedades de las que depende que signifique algo.

1. **Sin plan, nada cambia.** Si el camino de siempre se moviera aunque fuera un decimal, toda
   comparación contra el baseline estaría midiendo el cambio de código y no el mecanismo.
2. **No hay look-ahead intra-vela.** Es el error que daría un resultado espectacular y falso: en 1d
   una vela es un día y nadie sabe si el máximo ocurrió antes o después del mínimo.
"""

from __future__ import annotations

import random

import pytest

from trademe_quant.backtest import evaluate_trade
from trademe_quant.salidas import (
    SIN_GESTION,
    PlanSalida,
    nivel_breakeven,
    senal_apoya,
    stop_vigente,
)


def _serie(n: int, semilla: int) -> tuple[list[float], list[float], list[float]]:
    rnd = random.Random(semilla)
    precio = 100.0
    h, lo, c = [], [], []
    for _ in range(n):
        precio *= 1 + rnd.gauss(0, 0.02)
        alto = precio * (1 + abs(rnd.gauss(0, 0.01)))
        bajo = precio * (1 - abs(rnd.gauss(0, 0.01)))
        h.append(alto)
        lo.append(bajo)
        c.append(precio)
    return h, lo, c


# --- 1. Sin plan, el resultado es el de siempre ------------------------------------------------


@pytest.mark.parametrize("semilla", range(25))
@pytest.mark.parametrize("direccion", ["LONG", "SHORT"])
def test_sin_plan_el_resultado_es_identico(semilla: int, direccion: str) -> None:
    """Bit a bit, sobre series aleatorias y en las dos direcciones.

    El plan por defecto es `SIN_GESTION`, así que este test compara la función consigo misma con y
    sin el argumento. Parece trivial y no lo es: la rama nueva vive dentro del mismo bucle, y basta
    reordenar dos líneas para que el camino de siempre deje de dar lo mismo.
    """
    h, lo, c = _serie(40, semilla)
    entry = 100.0
    stop = 98.5 if direccion == "LONG" else 101.5
    tp = 103.0 if direccion == "LONG" else 97.0
    sin_argumento = evaluate_trade(direccion, entry, stop, tp, h, lo, c, coste_pct=0.12)
    con_plan_vacio = evaluate_trade(
        direccion, entry, stop, tp, h, lo, c, coste_pct=0.12, plan=SIN_GESTION
    )
    assert sin_argumento == con_plan_vacio


def test_un_plan_vacio_no_esta_activo() -> None:
    assert SIN_GESTION.activo is False
    assert PlanSalida(breakeven_r=1.0).activo is True
    assert PlanSalida(trailing_desde_r=1.0).activo is True
    assert PlanSalida(salida_por_senal=True).activo is True


# --- 2. El look-ahead intra-vela ----------------------------------------------------------------


def test_el_stop_no_se_mueve_con_la_vela_que_lo_pone_a_prueba() -> None:
    """La propiedad que separa una medición honesta de una espectacular y falsa.

    Se construye una vela que **sube hasta +2 R y baja hasta el stop inicial en el mismo periodo**.
    Con la convención ingenua —mover el stop con el máximo de esa vela y luego comprobar el mínimo—
    la operación saldría protegida en beneficios. Con la del proyecto, salta el stop inicial: es el
    peor caso, y es el único que no supone un orden que nadie conoce.
    """
    entry, stop, tp = 100.0, 98.0, 104.0  # 1 R = 2,0
    plan = PlanSalida(breakeven_r=1.0, trailing_desde_r=1.0)
    # Una sola vela: máximo en 102 (+1 R, activaría el breakeven) y mínimo en 98 (el stop inicial).
    res = evaluate_trade("LONG", entry, stop, tp, [102.0], [98.0], [99.0], plan=plan)
    assert res["result"] == "sl"
    assert res["r_bruto"] == -1.0


def test_la_vela_siguiente_si_esta_protegida() -> None:
    """El reverso del anterior: una vez cerrada la vela que llega a +1 R, el stop ya protege."""
    entry, stop, tp = 100.0, 98.0, 104.0
    plan = PlanSalida(breakeven_r=1.0)
    # Vela 1: sube a 102 sin tocar el stop. Vela 2: se desploma.
    res = evaluate_trade(
        "LONG", entry, stop, tp, [102.0, 101.0], [100.5, 90.0], [101.5, 90.0], plan=plan
    )
    assert res["result"] == "gestion"
    assert res["r_bruto"] == pytest.approx(0.0)  # breakeven sin costes
    assert res["bars"] == 2


# --- El breakeven cubre el coste, que si no no es breakeven -------------------------------------


def test_el_breakeven_deja_el_neto_en_cero_no_el_bruto() -> None:
    """Salir en el precio de entrada deja una pérdida del tamaño de la comisión."""
    entry, stop, tp = 100.0, 98.0, 104.0
    plan = PlanSalida(breakeven_r=1.0)
    res = evaluate_trade(
        "LONG",
        entry,
        stop,
        tp,
        [102.0, 101.0],
        [100.5, 90.0],
        [101.5, 90.0],
        coste_pct=0.12,
        plan=plan,
    )
    assert res["r"] == pytest.approx(0.0, abs=1e-9)


def test_nivel_breakeven_se_aleja_en_la_direccion_correcta() -> None:
    assert nivel_breakeven(100.0, "LONG", 0.02, 2.0) == pytest.approx(100.04)
    assert nivel_breakeven(100.0, "SHORT", 0.02, 2.0) == pytest.approx(99.96)


# --- El stop nunca afloja -----------------------------------------------------------------------


@pytest.mark.parametrize("direccion", ["LONG", "SHORT"])
def test_el_stop_nunca_retrocede(direccion: str) -> None:
    """Un stop que aflojara convertiría la gestión en un mecanismo para perder más."""
    entry, stop = 100.0, (98.0 if direccion == "LONG" else 102.0)
    plan = PlanSalida(breakeven_r=0.5, trailing_desde_r=0.5, trailing_distancia_r=1.0)
    d = 1.0 if direccion == "LONG" else -1.0
    anterior = stop
    for mejor_r in (0.0, 0.4, 0.6, 1.5, 3.0):
        mejor_precio = entry + d * mejor_r * 2.0
        s = stop_vigente(plan, direccion, entry, stop, mejor_r, mejor_precio, 0.0, 2.0)
        assert (s - anterior) * d >= -1e-12, f"aflojó en {mejor_r} R"
        anterior = s


def test_sin_alcanzar_el_disparador_el_stop_es_el_inicial() -> None:
    plan = PlanSalida(breakeven_r=1.0, trailing_desde_r=1.0)
    assert stop_vigente(plan, "LONG", 100.0, 98.0, 0.9, 101.8, 0.0, 2.0) == 98.0


# --- La salida por señal ------------------------------------------------------------------------


def test_senal_apoya_es_simetrica_entre_largo_y_corto() -> None:
    assert senal_apoya(0.10, "LONG", 0.0) is True
    assert senal_apoya(-0.10, "LONG", 0.0) is False
    assert senal_apoya(-0.10, "SHORT", 0.0) is True
    assert senal_apoya(0.10, "SHORT", 0.0) is False


def test_cierra_al_cierre_de_la_vela_en_que_la_senal_deja_de_apoyar() -> None:
    entry, stop, tp = 100.0, 98.0, 104.0
    plan = PlanSalida(salida_por_senal=True)
    res = evaluate_trade(
        "LONG",
        entry,
        stop,
        tp,
        [101.0, 101.5],
        [99.5, 100.0],
        [100.8, 101.2],
        plan=plan,
        future_senal=[-0.3, 0.5],
    )
    assert res["result"] == "senal"
    assert res["bars"] == 1
    assert res["r_bruto"] == pytest.approx((100.8 - 100.0) / 2.0)


def test_sin_serie_de_senal_no_cierra_por_senal() -> None:
    """Pedir la salida por señal sin darle la señal no puede inventarse un cierre."""
    res = evaluate_trade(
        "LONG",
        100.0,
        98.0,
        104.0,
        [101.0],
        [99.5],
        [100.8],
        plan=PlanSalida(salida_por_senal=True),
        future_senal=None,
    )
    assert res["result"] == "timeout"


# --- El trailing adaptado al ATR corriente ------------------------------------------------------


def test_el_atr_corriente_ensancha_el_arrastre_cuando_sube_la_volatilidad() -> None:
    """Con el ATR al doble, el stop arrastrado queda al doble de distancia del máximo."""
    entry, stop, tp = 100.0, 98.0, 999.0
    velas: tuple[list[float], list[float], list[float]] = (
        [103.0, 102.0],
        [100.0, 101.5],
        [102.0, 101.8],
    )
    fijo = evaluate_trade(
        "LONG",
        entry,
        stop,
        tp,
        *velas,
        plan=PlanSalida(trailing_desde_r=1.0, trailing_distancia_r=0.5),
    )
    ancho = evaluate_trade(
        "LONG",
        entry,
        stop,
        tp,
        *velas,
        plan=PlanSalida(
            trailing_desde_r=1.0, trailing_distancia_r=0.5, trailing_usa_atr_corriente=True
        ),
        future_atr=[2.0, 2.0],
        atr_entrada=1.0,
    )
    # Con distancia fija el stop queda en 103 − 0,5·2 = 102 y la vela 2 (mínimo 101,5) lo toca.
    assert fijo["result"] == "gestion"
    # Con el ATR al doble queda en 103 − 0,5·2·2 = 101, que la vela 2 ya no llega a tocar.
    assert ancho["result"] == "timeout"

"""Lo que cuesta operar, en las mismas unidades en que se mide todo lo demás."""

from __future__ import annotations

from trademe_quant.backtest import evaluate_trade
from trademe_quant.costes import coste_en_r, desde_config, neto, round_trip_pct


def test_el_round_trip_cobra_las_dos_patas() -> None:
    """Binance USDT-M Futuros: 0,05 % taker + 0,01 % de deslizamiento, al abrir y al cerrar."""
    assert abs(round_trip_pct("taker") - 0.12) < 1e-9
    assert abs(round_trip_pct("maker") - 0.06) < 1e-9


def test_el_coste_en_r_depende_de_la_distancia_al_stop() -> None:
    """`|entry - stop|` ya es 1 R en precio: por eso no hace falta el ATR aquí.

    Con un stop al 0,4 % del precio —lo típico en 15m— un round-trip del 0,12 % se lleva 0,30 R.
    Con el stop al 6,6 % —1d— el mismo round-trip cuesta 0,018 R. Ese es el motivo de que el coste
    haga inviables las temporalidades cortas y apenas roce las largas.
    """
    corto = coste_en_r(entry=100.0, stop=99.6, pct=0.12)  # stop al 0,4 %
    largo = coste_en_r(entry=100.0, stop=93.4, pct=0.12)  # stop al 6,6 %
    assert abs(corto - 0.30) < 0.005
    assert abs(largo - 0.018) < 0.001
    assert corto > largo * 10


def test_sin_riesgo_no_hay_coste_que_valga() -> None:
    """Con `entry == stop` no hay R en el que expresar nada; inventar un infinito no ayuda."""
    assert coste_en_r(100.0, 100.0, 0.12) == 0.0
    assert coste_en_r(100.0, 99.0, 0.0) == 0.0


def test_el_coste_se_descuenta_de_todos_los_desenlaces_incluido_el_stop() -> None:
    """Cerrar en pérdida también se paga: el exchange cobra igual."""
    sl = evaluate_trade("LONG", 100.0, 99.6, 100.8, [100.1], [99.0], [99.5], coste_pct=0.12)
    assert sl["result"] == "sl"
    assert sl["r_bruto"] == -1.0
    assert abs(sl["r"] - (-1.30)) < 0.005

    tp = evaluate_trade("LONG", 100.0, 99.6, 100.8, [101.0], [99.9], [100.9], coste_pct=0.12)
    assert tp["result"] == "tp"
    assert abs(tp["r_bruto"] - 2.0) < 1e-9
    assert abs(tp["r"] - 1.70) < 0.005


def test_con_coste_cero_el_resultado_es_el_de_siempre() -> None:
    """La compatibilidad no se supone: se comprueba."""
    for direccion, en, st, tp_ in (("LONG", 100.0, 97.0, 106.0), ("SHORT", 100.0, 103.0, 94.0)):
        con = evaluate_trade(direccion, en, st, tp_, [110.0], [95.0], [100.0], coste_pct=0.0)
        assert con["r"] == con["r_bruto"]
        assert con["coste_r"] == 0.0


def test_la_configuracion_manda_y_sin_seccion_no_se_cobra_nada() -> None:
    """El cero por defecto hace que medir en neto sea siempre una decisión explícita."""
    assert desde_config(None) == 0.0
    assert desde_config({}) == 0.0
    assert desde_config({"costs": {"enabled": False, "taker_pct": 0.05}}) == 0.0
    activo = {"costs": {"enabled": True, "mode": "taker", "taker_pct": 0.05, "slippage_pct": 0.01}}
    assert abs(desde_config(activo) - 0.12) < 1e-9


def test_el_dato_guardado_sigue_siendo_bruto_y_el_coste_se_resta_al_leer() -> None:
    """Reescribir la columna mezclaría dos reglas en el histórico, que es el error de M10.5."""
    r = neto(2.0, 100.0, 99.6, 0.12)
    assert r is not None and abs(r - 1.70) < 0.005
    assert neto(None, 100.0, 99.6, 0.12) is None
    assert neto(2.0, None, 99.6, 0.12) is None

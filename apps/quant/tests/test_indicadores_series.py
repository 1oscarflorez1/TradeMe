"""La vía rápida del backtest debe dar EXACTAMENTE lo mismo que la de siempre.

No «parecido dentro de tolerancia»: idéntico. Los indicadores son prefijo-calculables —el valor en
`t` solo depende de datos hasta `t`— así que calcular la serie entera de una vez no es una
aproximación, es la misma cuenta hecha una sola vez. Si algún día deja de serlo, estos tests fallan
y manda `indicators.py`, que es el mirror de Node.
"""

from __future__ import annotations

import math
import pathlib
import random
from typing import Any

from trademe_quant.backtest import MIN_CANDLES, evaluate_trade, run_backtest
from trademe_quant.decision import decide
from trademe_quant.ensemble import load_ensemble
from trademe_quant.indicadores_series import readings_series
from trademe_quant.indicators import compute_readings


def _serie(n: int, semilla: int = 7) -> tuple[list[float], list[float], list[float]]:
    """Camino aleatorio con volatilidad variable: reproduce tramos de tendencia y de rango."""
    rnd = random.Random(semilla)
    precio = 100.0
    high: list[float] = []
    low: list[float] = []
    close: list[float] = []
    for i in range(n):
        deriva = 0.15 * math.sin(i / 40.0)  # tramos alcistas y bajistas alternos
        precio = max(1.0, precio + deriva + rnd.uniform(-1.2, 1.2))
        rango = abs(rnd.gauss(0.8, 0.4)) + 0.1
        close.append(precio)
        high.append(precio + rango)
        low.append(precio - rango)
    return high, low, close


def test_las_lecturas_coinciden_vela_a_vela_sin_una_sola_diferencia() -> None:
    high, low, close = _serie(300)
    serie = readings_series(high, low, close)

    comparadas = 0
    for t in range(MIN_CANDLES, len(close)):
        esperado = compute_readings(high[: t + 1], low[: t + 1], close[: t + 1])
        obtenido = serie[t]
        assert obtenido is not None, f"sin lectura en t={t} cuando la vía lenta sí da una"
        for indicador, campos in esperado.items():
            for campo, valor in campos.items():
                assert (
                    obtenido[indicador][campo] == valor
                ), f"t={t} {indicador}.{campo}: {obtenido[indicador][campo]!r} != {valor!r}"
        comparadas += 1
    assert comparadas > 200, "la comparación debe cubrir la serie, no cuatro velas"


def _backtest_de_referencia(
    high: list[float], low: list[float], close: list[float], config: dict[str, Any]
) -> list[dict[str, Any]]:
    """La implementación anterior, literal: `decide` con una rebanada nueva en cada vela.

    Se conserva aquí como oráculo. Es O(N²) y por eso no está en producción, pero es la definición
    de «correcto» contra la que se juzga la rápida.
    """
    horizon = 20
    trades: list[dict[str, Any]] = []
    n = len(close)
    t = MIN_CANDLES
    while t < n - 1:
        d = decide(high[: t + 1], low[: t + 1], close[: t + 1], config, None, independence=1.0)
        levels = d["levels"]
        if d["action"] in ("BUY", "SELL") and levels is not None:
            end = min(n, t + 1 + horizon)
            res = evaluate_trade(
                d["direction"],
                levels["entry"],
                levels["stop"],
                levels["take_profit"],
                high[t + 1 : end],
                low[t + 1 : end],
                close[t + 1 : end],
            )
            trades.append(
                {
                    "index": t,
                    "direction": d["direction"],
                    "regime": d["regime"],
                    "confidence": d["confidence"],
                    "entry": levels["entry"],
                    "stop": levels["stop"],
                    "take_profit": levels["take_profit"],
                    **res,
                }
            )
            t += res["bars"] + 1
        else:
            t += 1
    return trades


def test_el_backtest_produce_las_mismas_operaciones_que_la_via_lenta() -> None:
    """La prueba que de verdad importa: mismas operaciones, mismos niveles, mismos desenlaces."""
    high, low, close = _serie(400, semilla=11)
    config = load_ensemble(pathlib.Path(__file__).parents[3] / "artifacts/ensemble.yaml")

    rapido = run_backtest(high, low, close, config, horizon=20)["trades"]
    lento = _backtest_de_referencia(high, low, close, config)

    assert len(rapido) == len(lento), f"{len(rapido)} operaciones frente a {len(lento)}"
    assert len(rapido) > 10, "sin operaciones la comparación no demuestra nada"
    for a, b in zip(rapido, lento, strict=True):
        assert a["index"] == b["index"]
        assert a["direction"] == b["direction"]
        assert a["regime"] == b["regime"]
        assert a["result"] == b["result"]
        assert a["bars"] == b["bars"]
        for campo in ("entry", "stop", "take_profit", "confidence", "r"):
            assert a[campo] == b[campo], f"operación en {a['index']}, campo {campo}"


def test_la_serie_no_emite_lecturas_antes_de_tener_historial() -> None:
    """Sin calentamiento no hay lectura: mejor `None` que un número inventado."""
    high, low, close = _serie(120)
    serie = readings_series(high, low, close)
    assert serie[0] is None
    assert serie[5] is None
    assert serie[-1] is not None


def test_una_serie_demasiado_corta_no_revienta() -> None:
    high, low, close = _serie(12)
    serie = readings_series(high, low, close)
    assert len(serie) == 12
    assert all(x is None for x in serie)

"""Harness de backtesting sin look-ahead (M6).

Recorre las velas usando solo datos hasta t, reproduce la decisión (mirror de Node) y
evalúa cada trade por primer toque (peor caso: si una vela toca SL y TP, gana el SL).
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from typing import Any

from .costes import coste_en_r, desde_config
from .decision import decidir_con_lecturas
from .indicadores_series import readings_series

MIN_CANDLES = 50


def evaluate_trade(
    direction: str,
    entry: float,
    stop: float,
    take_profit: float,
    future_high: Sequence[float],
    future_low: Sequence[float],
    future_close: Sequence[float],
    coste_pct: float = 0.0,
) -> dict[str, Any]:
    """Resultado de un trade sobre las velas futuras (primer toque, peor caso SL).

    `coste_pct` es el round-trip en porcentaje del nocional —comisión de las dos patas más
    deslizamiento— y se descuenta de **todos** los desenlaces, incluido el stop: cerrar en pérdida
    también se paga. Con `coste_pct = 0` el resultado es idéntico al de siempre, bit a bit, y hay un
    test que lo exige.

    El coste se convierte a R con `|entry - stop|`, que ya es 1 R en precio. Ver `costes.py`: la
    conversión importa más de lo que parece, porque cuanto más corta la temporalidad menos vale 1 R
    en dinero y más pesa la misma comisión sobre él.

    `r` es siempre **neto**. `r_bruto` viaja al lado para poder comparar las dos cosas sin repetir
    el backtest, que es justo lo que este hito necesitaba medir.
    """
    risk = abs(entry - stop)
    coste = coste_en_r(entry, stop, coste_pct)

    def cerrar(result: str, bruto: float, bars: int) -> dict[str, Any]:
        return {
            "result": result,
            "r": bruto - coste,
            "r_bruto": bruto,
            "coste_r": coste,
            "bars": bars,
        }

    for i in range(len(future_high)):
        high = future_high[i]
        low = future_low[i]
        if direction == "LONG":
            if low <= stop:  # peor caso: SL antes que TP
                return cerrar("sl", -1.0, i + 1)
            if high >= take_profit:
                return cerrar("tp", (take_profit - entry) / risk, i + 1)
        else:  # SHORT
            if high >= stop:
                return cerrar("sl", -1.0, i + 1)
            if low <= take_profit:
                return cerrar("tp", (entry - take_profit) / risk, i + 1)
    # timeout: cierre al final del horizonte
    if len(future_close) > 0 and risk > 0:
        last = future_close[-1]
        bruto = (last - entry) / risk if direction == "LONG" else (entry - last) / risk
        return cerrar("timeout", bruto, len(future_close))
    # Sin velas no hubo operación: tampoco se paga por ella.
    return {"result": "timeout", "r": 0.0, "r_bruto": 0.0, "coste_r": 0.0, "bars": 0}


def compute_metrics(trades: Sequence[dict[str, Any]]) -> dict[str, Any]:
    rs = [float(t["r"]) for t in trades]
    n = len(rs)
    if n == 0:
        return {
            "n_trades": 0,
            "win_rate": 0.0,
            "expectancy": 0.0,
            "profit_factor": None,
            "max_drawdown": 0.0,
            "sharpe": 0.0,
            "equity_curve": [],
        }
    wins = [r for r in rs if r > 0]
    losses = [r for r in rs if r <= 0]
    gross_win = sum(wins)
    gross_loss = abs(sum(losses))
    equity: list[float] = []
    cum = 0.0
    peak = 0.0
    max_dd = 0.0
    for r in rs:
        cum += r
        equity.append(cum)
        peak = max(peak, cum)
        max_dd = max(max_dd, peak - cum)
    sharpe = 0.0
    if n > 1 and statistics.pstdev(rs) > 0:
        sharpe = statistics.mean(rs) / statistics.pstdev(rs)
    return {
        "n_trades": n,
        "win_rate": len(wins) / n,
        "expectancy": sum(rs) / n,
        "profit_factor": (gross_win / gross_loss) if gross_loss > 0 else None,
        "max_drawdown": max_dd,
        "sharpe": sharpe,
        "equity_curve": equity,
    }


def run_backtest(
    high: Sequence[float],
    low: Sequence[float],
    close: Sequence[float],
    config: dict[str, Any],
    horizon: int = 20,
    macro_bias: float | None = None,
    oos_split: float = 0.7,
    independence: float = 1.0,
) -> dict[str, Any]:
    """Ejecuta el backtest y devuelve trades, métricas globales y out-of-sample.

    `independence` desinfla la confianza igual que en vivo, para que la cifra que registra el
    backtest sea la misma que declarará el motor. No afecta a qué operaciones se abren: escalar
    todos los logits no cambia el argmax.

    La **cuarentena no se aplica aquí a propósito**. Retirar una temporalidad de la operativa es una
    decisión sobre lo que se emite, no sobre lo que se mide: si el backtest dejara de simular 4h no
    habría forma de saber cuándo puede levantarse su cuarentena.
    """
    trades: list[dict[str, Any]] = []
    n = len(close)

    # Las lecturas de TODAS las velas en una sola pasada. Antes se llamaba a `decide(high[:t+1],…)`
    # por vela y cada indicador recorría la serie entera: coste O(N²), medido en ×4 el tiempo al
    # doblar las velas. Las lecturas son idénticas —hay un test que lo comprueba vela a vela con
    # igualdad exacta—, así que esto no cambia ni una operación del backtest, solo lo que tarda.
    lecturas = readings_series(high, low, close)
    # El round-trip sale de la configuración, así que medir en bruto o en neto es una decisión
    # explícita del yaml y no un descuido. Sin sección `costs`, cero — el comportamiento de antes.
    coste_pct = desde_config(config)

    t = MIN_CANDLES
    while t < n - 1:
        readings = lecturas[t]
        if readings is None:  # sin historial para todos los indicadores todavía
            t += 1
            continue
        d = decidir_con_lecturas(
            readings,
            float(close[t]),
            config,
            macro_bias,
            independence=independence,
        )
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
                coste_pct=coste_pct,
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

    split = int(n * oos_split)
    oos = [tr for tr in trades if tr["index"] >= split]
    return {
        "trades": trades,
        "metrics": compute_metrics(trades),
        "oos_metrics": compute_metrics(oos),
        "oos_split_index": split,
    }

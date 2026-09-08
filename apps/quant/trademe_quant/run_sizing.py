"""¿Mejora la curva dimensionar por volatilidad inversa? Estudio sobre las cuatro claves de 1d.

Uso: python -m trademe_quant.run_sizing

Se mide aparte del estudio de salidas porque **la pregunta es otra**. Un plan de salida cambia el R
de cada operación; el sizing no toca ni un R: cambia **cuánto pesa cada una** en la curva. Por eso
aquí no se mira la expectancy —es idéntica por construcción una vez normalizados los pesos— sino
retorno entre drawdown y Sharpe, que son las que responden a «¿reparte mejor el riesgo?».

La normalización a media 1 no es un detalle: sin ella, arriesgar menos bajaría el drawdown por
definición y se leería como una mejora. Ver `sizing`.
"""

from __future__ import annotations

import json
import sys
from typing import Any

import numpy as np

from .backtest import run_backtest
from .ensemble import artifacts_dir, load_active_ensemble
from .indicadores_series import atr_series
from .sizing import curva, pesos_por_volatilidad_inversa
from .velas import series

SIMBOLOS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]
INTERVALO = "1d"
HORIZONTE = 10


def estudiar(symbol: str) -> dict[str, Any]:
    h, lo, c = series(symbol, INTERVALO)
    cfg = load_active_ensemble(symbol, INTERVALO)
    trades = run_backtest(h, lo, c, cfg, horizon=HORIZONTE)["trades"]
    atr = atr_series(np.asarray(h), np.asarray(lo), np.asarray(c))

    # Volatilidad relativa en la vela de entrada: ATR entre precio. Es lo que ve quien dimensiona,
    # y es prefijo-calculable — en la vela `t` solo usa datos hasta `t`.
    vol = [
        float(atr[int(t["index"])]) / float(t["entry"]) if float(t["entry"]) > 0 else 0.0
        for t in trades
    ]
    rs = [float(t["r"]) for t in trades]
    pesos = pesos_por_volatilidad_inversa(vol)
    base, siz = curva(rs), curva(rs, pesos)
    return {
        "symbol": symbol,
        "n": len(trades),
        "base": {k: round(v, 4) for k, v in base.items()},
        "vol_inversa": {k: round(v, 4) for k, v in siz.items()},
        "peso_min": round(min(pesos), 3) if pesos else 0.0,
        "peso_max": round(max(pesos), 3) if pesos else 0.0,
        "mejora_ret_dd": bool(siz["retorno_por_dd"] > base["retorno_por_dd"]),
        "mejora_sharpe": bool(siz["sharpe"] > base["sharpe"]),
        "mejora_dd": bool(siz["max_dd"] < base["max_dd"]),
    }


def informe(filas: list[dict[str, Any]]) -> None:
    print("=" * 96)
    print("SIZING POR VOLATILIDAD INVERSA EN 1d  (pesos normalizados a media 1)")
    print("=" * 96)
    cab = "  " + "clave".ljust(12) + "n".rjust(5) + "esquema".rjust(24)
    print(cab + "total".rjust(9) + "maxDD".rjust(9) + "ret/DD".rjust(9) + "sharpe".rjust(9))
    for f in filas:
        for etiqueta, clave in (("base", "base"), ("vol inversa", "vol_inversa")):
            m = f[clave]
            print(
                f"  {f['symbol'] if etiqueta == 'base' else '':12}"
                f"{f['n'] if etiqueta == 'base' else '':>5}{etiqueta:>24}"
                f"{m['total']:>9.2f}{m['max_dd']:>9.2f}"
                f"{m['retorno_por_dd']:>9.3f}{m['sharpe']:>9.4f}"
            )
    print()
    print("=" * 96)
    for etiqueta, clave in (
        ("retorno/drawdown", "mejora_ret_dd"),
        ("sharpe", "mejora_sharpe"),
        ("drawdown máximo", "mejora_dd"),
    ):
        k = sum(1 for f in filas if f[clave])
        print(f"  mejora en {etiqueta:20} {k}/{len(filas)} claves")


def main() -> None:
    filas: list[dict[str, Any]] = []
    for symbol in SIMBOLOS:
        try:
            filas.append(estudiar(symbol))
            print(f"  ...{symbol} listo", file=sys.stderr)
        except Exception as err:  # noqa: BLE001 - una clave que falla no tumba el estudio
            print(f"  {symbol} ERROR {err}", file=sys.stderr)
    informe(filas)
    destino = artifacts_dir() / "sizing_estudio.json"
    destino.write_text(json.dumps(filas, indent=2, default=str), encoding="utf8")
    print(f"\n  informe: {destino}")


if __name__ == "__main__":
    main()

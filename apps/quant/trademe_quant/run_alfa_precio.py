"""¿Aporta alguno de los tres vectores nativo-precio? Estudio bajo el marco de `alfa.py`.

Uso: python -m trademe_quant.run_alfa_precio

El problema que hay que resolver antes de mirar ningún resultado
-----------------------------------------------------------------
Son **3 vectores × 2 reglas × 4 símbolos × 2 temporalidades = 48 pruebas**, cada una contra un
listón del percentil 95. Sin más, el azar produce **2,4 positivos** y el primero que salga parecerá
un hallazgo.

Por eso el veredicto tiene dos niveles y solo cuenta el segundo:

- **Por clave** — el de `alfa.juzgar`: muestra, superar la nula y ser viable.
- **Por vector y regla** — cuántas de las ocho claves lo pasan, contrastado con la binomial de
  falsos positivos. Con ocho pruebas al 5 %, **uno solo sale el 34 % de las veces** y hacen falta
  **tres** para bajar de 0,05.

Un vector que gana en una clave no ha demostrado nada. Uno que gana en tres, sí.

Ortogonalidad: hipótesis, no premisa
-------------------------------------
Se mide la correlación de cada vector con los votos que ya están dentro antes de juzgarlo. Un
candidato muy correlacionado con `supertrend` o con `atr14` no puede aportar información nueva
aunque gane la prueba — y saberlo cambia cómo se lee el resultado.
"""

from __future__ import annotations

import json
import sys
from typing import Any

import numpy as np

from .alfa import evaluar_vector, p_falsos_positivos, resumen
from .backtest import run_backtest
from .ensemble import artifacts_dir, load_active_ensemble
from .indicadores_series import atr_series, readings_series
from .market.normalize import interval_ms
from .vectores_precio import asimetria_mechas, compresion_atr, correlacion_con, ratio_parkinson
from .velas import series_ohlc

SIMBOLOS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]
#: Solo lo que sigue operando: medir en cuarentena daría veredictos sobre decisiones que nadie toma.
INTERVALOS = ["4h", "1d"]
HORIZONTES = {"4h": 15, "1d": 10}
REGLAS = ("descartar_bajos", "descartar_altos")


def _vectores(
    o: list[float], h: list[float], lo: list[float], c: list[float]
) -> dict[str, dict[int, float]]:
    return {
        "asimetria_mechas": asimetria_mechas(o, h, lo, c),
        "ratio_parkinson": ratio_parkinson(h, lo, c),
        "compresion_atr": compresion_atr(h, lo, c),
    }


def _ortogonalidad(
    valores: dict[int, float], h: list[float], lo: list[float], c: list[float]
) -> dict[str, float]:
    """Correlación con los votos que ya están dentro, para saber si el candidato es nuevo."""
    lecturas = readings_series(h, lo, c)
    fuera: dict[str, float] = {}
    for voto in ("supertrend", "ema_cross", "rsi14", "bbands"):
        serie = np.asarray(
            [r[voto]["score"] if r is not None else np.nan for r in lecturas], dtype=float
        )
        fuera[voto] = round(correlacion_con(valores, serie), 3)
    atr = atr_series(np.asarray(h), np.asarray(lo), np.asarray(c))
    fuera["atr14"] = round(correlacion_con(valores, atr), 3)
    return fuera


def estudiar(symbol: str, interval: str) -> list[dict[str, Any]]:
    o, h, lo, c = series_ohlc(symbol, interval)
    cfg = load_active_ensemble(symbol, interval)
    trades = run_backtest(h, lo, c, cfg, horizon=HORIZONTES.get(interval, 15))["trades"]
    if not trades:
        return []
    velas_dia = max(1, round(86_400_000 / interval_ms(interval)))

    filas: list[dict[str, Any]] = []
    for nombre, valores in _vectores(o, h, lo, c).items():
        corr = _ortogonalidad(valores, h, lo, c)
        for regla in REGLAS:
            v = evaluar_vector(trades, valores, velas_por_bloque=velas_dia, regla=regla)
            filas.append(
                {
                    "vector": nombre,
                    "symbol": symbol,
                    "interval": interval,
                    "regla": regla,
                    "correlaciones": corr,
                    **resumen(v),
                }
            )
    return filas


def informe(filas: list[dict[str, Any]]) -> None:
    print("=" * 108)
    print(
        "VECTORES NATIVO-PRECIO  (listón por clave: R neta > +0,015 y superar la nula por bloques)"
    )
    print("=" * 108)

    for nombre in ("asimetria_mechas", "ratio_parkinson", "compresion_atr"):
        del_vector = [f for f in filas if f["vector"] == nombre]
        if not del_vector:
            continue
        corr = del_vector[0]["correlaciones"]
        peor = max(corr.items(), key=lambda kv: abs(kv[1]))
        print(
            f"\n  {nombre.upper()}  (correlación máxima con un voto existente: "
            f"{peor[0]} {peor[1]:+.3f})"
        )
        cab = f"    {'clave':14}{'regla':18}{'n':>5}{'desc':>6}{'base':>9}"
        print(f"{cab}{'filtrada':>10}{'lift':>9}{'nula':>9}  ")
        for f in del_vector:
            marca = "APORTA" if f["aporta"] else ""
            print(
                f"    {f['symbol'] + ':' + f['interval']:14}{f['regla']:18}{f['n']:>5}"
                f"{f['n_descartadas']:>6}{f['base_neta']:>9.4f}{f['filtrada_neta']:>10.4f}"
                f"{f['lift']:>9.4f}{f['nula_p95']:>9.4f}  {marca}"
            )
        for regla in REGLAS:
            de_regla = [f for f in del_vector if f["regla"] == regla]
            k = sum(1 for f in de_regla if f["aporta"])
            p = p_falsos_positivos(k, len(de_regla))
            juicio = "SEÑAL" if p < 0.05 else "ruido"
            print(f"      {regla:18} {k}/{len(de_regla)} claves · p={p:.4f} · {juicio}")

    total = len(filas)
    aciertos = sum(1 for f in filas if f["aporta"])
    print()
    print("=" * 108)
    print(f"  pruebas: {total} · positivos: {aciertos} · esperados por azar: {0.05 * total:.1f}")
    print(f"  p de que TODO sea ruido: {p_falsos_positivos(aciertos, total):.4f}")


def main() -> None:
    filas: list[dict[str, Any]] = []
    for symbol in SIMBOLOS:
        for interval in INTERVALOS:
            try:
                filas.extend(estudiar(symbol, interval))
                print(f"  ...{symbol}:{interval} listo", file=sys.stderr)
            except Exception as err:  # noqa: BLE001 - una clave que falla no tumba el estudio
                print(f"  {symbol}:{interval} ERROR {err}", file=sys.stderr)
    informe(filas)
    destino = artifacts_dir() / "alfa_vectores_precio.json"
    destino.write_text(json.dumps(filas, indent=2, default=str), encoding="utf8")
    print(f"\n  informe: {destino}")


if __name__ == "__main__":
    main()

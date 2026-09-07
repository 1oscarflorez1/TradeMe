"""¿Aporta el contexto macro? Estudio de UUP y VXX bajo el marco de `alfa.py`.

Uso: python -m trademe_quant.run_alfa_macro   (requiere haber ejecutado antes descargar_macro)

Qué se prueba y contra qué
---------------------------
Son **2 vectores x 2 reglas x 4 símbolos x 2 temporalidades = 32 pruebas**, cada una contra un
listón del percentil 95. Sin corrección, el azar produce **1,6 positivos** y el primero que salga
parecerá un hallazgo. Por eso el veredicto vuelve a tener dos niveles y solo cuenta el segundo: con
ocho claves por vector y regla hacen falta **tres** positivos para bajar de 0,05.

Lo que este estudio tiene y los anteriores no
-----------------------------------------------
Los vectores de precio se calculaban sobre la misma serie que la decisión, así que estaban alineados
por construcción. Estos vienen de un mercado que **cierra por las noches y los fines de semana**, y
alinearlos es la mitad del trabajo: `series_macro.alinear` empareja cada vela con el último cierre
que ya se conocía cuando esa vela empezó, arrastrándolo mientras el mercado americano estaba
cerrado. Un fallo ahí no daría un resultado malo, daría uno **bueno y falso**.

Y una diferencia que conviene tener delante al leer el resultado: **VXX solo llega a 2018**, así que
sus pruebas cubren menos historia que las de UUP. La columna `cob` lo hace visible.
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
from .series_macro import Serie, alinear, cargar
from .vectores_macro import estres_volatilidad, tendencia_dolar
from .vectores_precio import correlacion_con
from .velas import aperturas, series

SIMBOLOS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]
#: 1d es la única que opera; 4h está en cuarentena estructural desde 0.63.0 pero sigue midiéndose
#: en sombra. Se incluye para tener con qué comparar, no porque sus veredictos manden: un
#: hallazgo en 4h sería un hallazgo sobre decisiones que hoy no se toman.
INTERVALOS = ["4h", "1d"]
HORIZONTES = {"4h": 15, "1d": 10}
REGLAS = ("descartar_bajos", "descartar_altos")
NOMBRES = ("tendencia_dolar", "estres_volatilidad")


def _por_sesion(macro: dict[str, Serie]) -> dict[str, dict[str, float]]:
    """Los dos vectores, cada uno sobre su propia serie y todavía en fechas de sesión."""
    return {
        "tendencia_dolar": tendencia_dolar(macro["UUP"]),
        "estres_volatilidad": estres_volatilidad(macro["VXX"]),
    }


def _ortogonalidad(
    valores: dict[int, float], h: list[float], lo: list[float], c: list[float]
) -> dict[str, float]:
    """Correlación con los votos que ya están dentro, para saber si el candidato es nuevo.

    Aquí se espera baja casi por construcción —son series de otro mercado— pero medirlo cuesta poco,
    y una correlación alta sería la señal de que la alineación está mal hecha.
    """
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


def estudiar(
    symbol: str, interval: str, por_sesion: dict[str, dict[str, float]]
) -> list[dict[str, Any]]:
    h, lo, c = series(symbol, interval)
    t0 = aperturas(symbol, interval)
    cfg = load_active_ensemble(symbol, interval)
    trades = run_backtest(h, lo, c, cfg, horizon=HORIZONTES.get(interval, 15))["trades"]
    if not trades:
        return []
    velas_dia = max(1, round(86_400_000 / interval_ms(interval)))

    filas: list[dict[str, Any]] = []
    for nombre in NOMBRES:
        valores = alinear(t0, por_sesion[nombre])
        corr = _ortogonalidad(valores, h, lo, c)
        cobertura = len([t for t in trades if int(t["index"]) in valores]) / len(trades)
        for regla in REGLAS:
            v = evaluar_vector(trades, valores, velas_por_bloque=velas_dia, regla=regla)
            filas.append(
                {
                    "vector": nombre,
                    "symbol": symbol,
                    "interval": interval,
                    "regla": regla,
                    "cobertura": round(cobertura, 3),
                    "correlaciones": corr,
                    **resumen(v),
                }
            )
    return filas


def informe(filas: list[dict[str, Any]]) -> None:
    print("=" * 112)
    print("VECTORES MACRO  (listón por clave: R neta > +0,015 y superar la nula por bloques)")
    print("=" * 112)

    for nombre in NOMBRES:
        del_vector = [f for f in filas if f["vector"] == nombre]
        if not del_vector:
            continue
        corr = del_vector[0]["correlaciones"]
        peor = max(corr.items(), key=lambda kv: abs(kv[1]))
        print(
            f"\n  {nombre.upper()}  (correlación máxima con un voto existente: "
            f"{peor[0]} {peor[1]:+.3f})"
        )
        cab = "    " + "clave".ljust(14) + "regla".ljust(18) + "cob".rjust(6)
        cab += "n".rjust(5) + "desc".rjust(6) + "base".rjust(9)
        print(cab + "filtrada".rjust(10) + "lift".rjust(9) + "nula".rjust(9) + "  ")
        for f in del_vector:
            marca = "APORTA" if f["aporta"] else ""
            clave = f["symbol"] + ":" + f["interval"]
            print(
                f"    {clave:14}{f['regla']:18}"
                f"{f['cobertura']:>6.0%}{f['n']:>5}{f['n_descartadas']:>6}"
                f"{f['base_neta']:>9.4f}{f['filtrada_neta']:>10.4f}"
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
    print("=" * 112)
    print(f"  pruebas: {total} · positivos: {aciertos} · esperados por azar: {0.05 * total:.1f}")
    print(f"  p de que TODO sea ruido: {p_falsos_positivos(aciertos, total):.4f}")


def main() -> None:
    por_sesion = _por_sesion(cargar(artifacts_dir()))
    for nombre, valores in por_sesion.items():
        fechas = sorted(valores)
        print(
            f"  {nombre:20} {len(valores):5} sesiones  {fechas[0]} - {fechas[-1]}",
            file=sys.stderr,
        )

    filas: list[dict[str, Any]] = []
    for symbol in SIMBOLOS:
        for interval in INTERVALOS:
            try:
                filas.extend(estudiar(symbol, interval, por_sesion))
                print(f"  ...{symbol}:{interval} listo", file=sys.stderr)
            except Exception as err:  # noqa: BLE001 - una clave que falla no tumba el estudio
                print(f"  {symbol}:{interval} ERROR {err}", file=sys.stderr)
    informe(filas)
    destino = artifacts_dir() / "alfa_vectores_macro.json"
    destino.write_text(json.dumps(filas, indent=2, default=str), encoding="utf8")
    print(f"\n  informe: {destino}")


if __name__ == "__main__":
    main()

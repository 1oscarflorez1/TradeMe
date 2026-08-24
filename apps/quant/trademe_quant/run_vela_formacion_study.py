"""¿Cuánto cambia la decisión por mirar una vela a medio formar?

Uso: python -m trademe_quant.run_vela_formacion_study [SIMBOLO] [INTERVALO] [DIAS]

El hito: entender por qué las configuraciones que ganan en el backtest fuera de muestra se degradan
en producción. El mecanismo candidato está en `vela_parcial.py` — el backtest decide sobre velas
cerradas y producción sobre la vela en formación.

Cómo se mide, sin depender de la base de datos
-----------------------------------------------
Se descargan del mismo periodo las velas del intervalo estudiado y las de 1 minuto que las componen.
Para cada vela ya cerrada se le pregunta al motor real —`decision.decide`, el mismo que garantiza la
paridad con la API— qué habría decidido en varios puntos de su formación:

    al 25 %, al 50 %, al 75 %   ->  lo que ve PRODUCCIÓN
    al 100 % (vela cerrada)     ->  lo que ve el BACKTEST

Y para cada una de esas decisiones se evalúa el desenlace con `backtest.evaluate_trade` contra las
velas siguientes, con el mismo horizonte. Así se compara no solo si la decisión cambia, sino cuánto
cuesta que cambie.

Sobre el look-ahead: la vela parcial se construye **solo** con los minutos transcurridos, y el
desenlace se mide sobre velas estrictamente posteriores a la vela de decisión. El motor nunca ve
nada que no estuviera disponible en ese instante.
"""

from __future__ import annotations

import json
import sys
import urllib.parse
import urllib.request
from collections import Counter
from typing import Any

import numpy as np

from .backtest import MIN_CANDLES, evaluate_trade
from .decision import decide
from .ensemble import artifacts_dir, load_ensemble
from .vela_parcial import Vela, agrupar_por_vela, instantes_de, vela_parcial

REST = "https://api.binance.com/api/v3/klines"
TIMEOUT_S = 20
MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000}
#: Puntos del recorrido de la vela en los que se le pregunta al motor.
FRACCIONES = (0.25, 0.50, 0.75, 1.0)
#: Velas de contexto que se le dan al motor. Las mismas que exige `decide`.
CONTEXTO = MIN_CANDLES + 10


def _klines(symbol: str, interval: str, desde_ms: int, hasta_ms: int) -> list[Vela]:
    out: list[Vela] = []
    cursor = desde_ms
    for _ in range(200):
        if cursor >= hasta_ms:
            break
        p = urllib.parse.urlencode(
            {
                "symbol": symbol.upper(),
                "interval": interval,
                "startTime": cursor,
                "endTime": hasta_ms,
                "limit": 1000,
            }
        )
        with urllib.request.urlopen(f"{REST}?{p}", timeout=TIMEOUT_S) as r:  # noqa: S310
            datos = json.loads(r.read().decode("utf8"))
        if not datos:
            break
        for k in datos:
            out.append(Vela(int(k[0]), float(k[1]), float(k[2]), float(k[3]), float(k[4])))
        ultimo = int(datos[-1][0])
        if ultimo <= cursor:
            break
        cursor = ultimo + 1
    return out


def _config(symbol: str, interval: str) -> tuple[dict[str, Any], str]:
    """La config ACTIVA de esa clave: la optimizada si existe, si no la base.

    Se usa la activa y no la base porque lo que se quiere medir es el mundo en el que vive la
    plataforma hoy, con los pesos que de verdad aplica.
    """
    art = artifacts_dir()
    opt = art / "optimized" / f"ensemble.{symbol.upper()}.{interval}.yaml"
    ruta = opt if opt.exists() else art / "ensemble.yaml"
    return dict(load_ensemble(ruta)), ruta.name


def estudiar(symbol: str, interval: str, dias: int) -> None:
    import time

    ms_vela = MS[interval]
    hasta = int(time.time() * 1000)
    desde = hasta - dias * 86_400_000
    print(f"descargando {interval} y 1m de {symbol}, {dias} días…", flush=True)
    velas = _klines(symbol, interval, desde, hasta)
    minutos = _klines(symbol, "1m", desde, hasta)
    grupos = agrupar_por_vela(minutos, ms_vela)
    cfg, nombre_cfg = _config(symbol, interval)
    horizonte = int(
        (
            (load_ensemble(artifacts_dir() / "ensemble.yaml").get("evaluation") or {}).get(
                "horizon_by_tf"
            )
            or {}
        ).get(interval, 20)
    )

    ancho = 100
    print("=" * ancho)
    print(f"LA VELA EN FORMACIÓN · {symbol}:{interval}   ·   config: {nombre_cfg}")
    print("=" * ancho)
    print(
        f"  velas {interval}: {len(velas)}   ·   velas 1m: {len(minutos)}   ·   "
        f"horizonte: {horizonte}"
    )

    # Para cada vela cerrada, la decisión al 25/50/75/100 % de su formación.
    acciones: dict[float, list[str]] = {f: [] for f in FRACCIONES}
    retornos: dict[float, list[float]] = {f: [] for f in FRACCIONES}
    cambios: Counter[float] = Counter()
    comparables = 0

    for i in range(CONTEXTO, len(velas) - 1):
        previas = velas[:i]
        mins = grupos.get(velas[i].abre_ms, [])
        if len(mins) < 4:
            continue
        futuro = velas[i + 1 : i + 1 + horizonte]
        if not futuro:
            continue
        fh = [v.high for v in futuro]
        fl = [v.low for v in futuro]
        fc = [v.close for v in futuro]

        del_cierre: str | None = None
        for frac, k in zip(FRACCIONES, instantes_de(len(mins), FRACCIONES), strict=True):
            actual = vela_parcial(mins[:k]) if frac < 1.0 else velas[i]
            ventana = [*previas, actual]
            d = decide(
                [v.high for v in ventana],
                [v.low for v in ventana],
                [v.close for v in ventana],
                cfg,
            )
            acciones[frac].append(d["action"])
            lv = d["levels"]
            if d["action"] in ("BUY", "SELL") and lv is not None:
                res = evaluate_trade(
                    d["direction"], lv["entry"], lv["stop"], lv["take_profit"], fh, fl, fc
                )
                retornos[frac].append(float(res["r"]))
            if frac == 1.0:
                del_cierre = str(d["action"])

        # Cuántas de las lecturas intermedias discrepan de la del cierre.
        if del_cierre is not None:
            comparables += 1
            for frac in FRACCIONES[:-1]:
                if acciones[frac][-1] != del_cierre:
                    cambios[frac] += 1

    print(f"  velas comparables: {comparables}\n")
    print(
        f"  {'momento':12s} {'BUY':>6s} {'SELL':>6s} {'HOLD':>6s} {'discrepa':>10s} "
        f"{'n oper.':>8s} {'expectancy':>11s}"
    )
    print("  " + "-" * 66)
    for frac in FRACCIONES:
        c = Counter(acciones[frac])
        rs = retornos[frac]
        etiqueta = "CIERRE (bt)" if frac == 1.0 else f"{int(frac * 100)} % formada"
        disc = "—" if frac == 1.0 else f"{100.0 * cambios[frac] / max(1, comparables):.1f} %"
        exp = f"{float(np.mean(rs)):+.3f} R" if rs else "—"
        print(
            f"  {etiqueta:12s} {c.get('BUY', 0):6d} {c.get('SELL', 0):6d} {c.get('HOLD', 0):6d} "
            f"{disc:>10s} {len(rs):8d} {exp:>11s}"
        )
    _veredicto(acciones, retornos, cambios, comparables)


def _veredicto(
    acciones: dict[float, list[str]],
    retornos: dict[float, list[float]],
    cambios: Counter[float],
    comparables: int,
) -> None:
    print()
    print("VEREDICTO")
    print("-" * 100)
    if not comparables:
        print("  Sin velas comparables: no se juzga nada.\n")
        return
    peor = max(FRACCIONES[:-1], key=lambda f: cambios[f])
    pct = 100.0 * cambios[peor] / comparables
    print(
        f"  Mirando la vela al {int(peor * 100)} % de formarse, la decisión difiere de la del "
        f"cierre en el {pct:.1f} % de los casos."
    )
    cierre = retornos[1.0]
    if cierre:
        base = float(np.mean(cierre))
        print(
            f"  Decidiendo al cierre —como hace el backtest—: {base:+.3f} R en {len(cierre)} oper."
        )
        for frac in FRACCIONES[:-1]:
            rs = retornos[frac]
            if rs:
                print(
                    f"  Decidiendo al {int(frac * 100):3d} % de la vela: "
                    f"{float(np.mean(rs)):+.3f} R en {len(rs)} oper.  ->  "
                    f"diferencia {float(np.mean(rs)) - base:+.3f} R"
                )
    print()
    print("  Si la diferencia es grande, el backtest está optimizando sobre un mundo que la")
    print("  producción no habita, y ninguna configuración promovida ahí describe lo que pasará.")
    print()


def main() -> None:
    symbol = sys.argv[1] if len(sys.argv) > 1 else "BTCUSDT"
    interval = sys.argv[2] if len(sys.argv) > 2 else "15m"
    dias = int(sys.argv[3]) if len(sys.argv) > 3 else 10
    if interval not in MS:
        print(f"intervalo no soportado: {interval}. Usa uno de {sorted(MS)}")
        raise SystemExit(2)
    estudiar(symbol, interval, dias)


if __name__ == "__main__":
    main()

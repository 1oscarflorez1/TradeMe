"""¿Aporta el momentum del funding? Primer uso del marco de alfa ortogonal.

Uso: python -m trademe_quant.run_alfa_estudio

El criterio está fijado **antes** de ver resultados, en `alfa.py`: muestra a los dos lados del
filtro, superar el P95 de una nula por bloques, y dejar una expectancy neta por encima de
+0,015 R — el orden de lo que hoy da la única temporalidad viable.

Se prueban las dos reglas, descartar el tercil bajo y el alto, porque el signo de la hipótesis no
está decidido de antemano: un funding que se carga rápido puede anticipar tanto continuación como
agotamiento. **Probar las dos duplica las pruebas**, así que el veredicto se lee con eso delante —
con dos reglas × dos temporalidades × cuatro símbolos son 16 pruebas contra un P95, y encontrar una
que lo supere es lo que produce el azar.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from .alfa import evaluar_vector, resumen
from .backtest import run_backtest
from .ensemble import artifacts_dir, load_active_ensemble
from .market.normalize import interval_ms
from .vector_funding import describir, historico_funding, momentum
from .velas import series

SIMBOLOS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]
#: Solo las temporalidades que siguen operando. Medir en las que están en cuarentena estructural
#: daría veredictos sobre decisiones que nadie va a tomar.
INTERVALOS = ["4h", "1d"]
HORIZONTES = {"4h": 15, "1d": 10}


def estudiar(symbol: str, interval: str) -> list[dict[str, Any]]:
    """Las dos reglas sobre una clave, con el mismo backtest y el mismo vector."""
    high, low, close = series(symbol, interval)
    cfg = load_active_ensemble(symbol, interval)
    res = run_backtest(high, low, close, cfg, horizon=HORIZONTES.get(interval, 15))
    trades = res["trades"]
    if not trades:
        return []

    paso = interval_ms(interval)
    # `series` devuelve las últimas N velas; las aperturas se reconstruyen hacia atrás desde la
    # última, que es la única forma de alinear el funding sin volver a descargar las velas.
    ultima = _ultima_apertura(symbol, interval)
    aperturas = [ultima - (len(close) - 1 - i) * paso for i in range(len(close))]

    fondo = historico_funding(symbol, aperturas[0] - 30 * 86_400_000, aperturas[-1] + paso)
    valores = momentum(aperturas, fondo)
    velas_dia = max(1, round(86_400_000 / paso))

    filas: list[dict[str, Any]] = []
    for regla in ("descartar_bajos", "descartar_altos"):
        v = evaluar_vector(trades, valores, velas_por_bloque=velas_dia, regla=regla)
        filas.append(
            {
                "symbol": symbol,
                "interval": interval,
                "regla": regla,
                "vector": describir(valores),
                "n_trades": len(trades),
                **resumen(v),
            }
        )
    return filas


def _ultima_apertura(symbol: str, interval: str) -> int:
    """Apertura de la última vela de la serie, pedida a Binance."""
    from .market.binance import fetch_klines

    filas = fetch_klines(symbol, interval, limit=1)
    return int(filas[-1][0])


def informe(filas: list[dict[str, Any]]) -> None:
    print("=" * 104)
    print(
        "¿APORTA EL MOMENTUM DEL FUNDING?  (listón: R neta > +0,015 y superar la nula por bloques)"
    )
    print("=" * 104)
    cab = f"  {'clave':14}{'regla':18}{'n':>5}{'desc':>6}{'base':>9}"
    print(f"{cab}{'filtrada':>10}{'lift':>9}{'nula':>9}  veredicto")
    for f in filas:
        marca = "APORTA" if f["aporta"] else "no"
        clave = f"{f['symbol']}:{f['interval']}"
        print(
            f"  {clave:14}{f['regla']:18}{f['n']:>5}{f['n_descartadas']:>6}"
            f"{f['base_neta']:>9.4f}{f['filtrada_neta']:>10.4f}{f['lift']:>9.4f}"
            f"{f['nula_p95']:>9.4f}  {marca}"
        )
    aportan = [f for f in filas if f["aporta"]]
    print()
    print(f"  pruebas: {len(filas)} · aportan: {len(aportan)}")
    print(f"  esperadas por azar con un listón del P95: {0.05 * len(filas):.1f}")
    if aportan:
        print()
        for f in aportan:
            print(f"    {f['symbol']}:{f['interval']} [{f['regla']}] — {f['motivo']}")
    else:
        print()
        print("  VEREDICTO: el momentum del funding NO aporta en ninguna clave.")


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
    destino = artifacts_dir() / "alfa_funding_momentum.json"
    destino.write_text(json.dumps(filas, indent=2, default=str), encoding="utf8")
    print(f"\n  informe: {destino}")


if __name__ == "__main__":
    main()

"""¿Concentrar la operativa en las mejores claves aporta? Walk-forward de la propia regla.

Uso: python -m trademe_quant.run_lista_blanca

Por qué no basta con mirar el ranking
--------------------------------------
Las cuatro claves de 1d dan +0,106 (SOL), +0,059 (ETH), −0,020 (BTC) y −0,043 (BNB). Quedarse con
las dos primeras **porque son las dos primeras** es selección post-hoc: con cuatro candidatas, la
mejor está sesgada al alza por construcción, y el sesgo es mayor cuanto menor es la muestra. Es el
mismo error que cometía el optimizador, y no se arregla mirando el número otra vez.

Lo que sí se puede probar es la **regla**: en cada corte, elegir las `K` mejores con lo que se sabía
hasta ese momento y operarlas en el tramo siguiente. Si concentrar aporta, la regla gana **sin
haber visto** los datos con los que se la juzga.

Qué mide, y qué no
-------------------
La cifra que sale es la ventaja media por trimestre frente a operar las cuatro. El bootstrap por
trimestres dice si esa ventaja aguanta: si su percentil 5 es negativo, la regla no alcanza
significancia por mucho que su media sea positiva. Las dos cosas se imprimen juntas a propósito.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np

from .backtest import run_backtest
from .ensemble import artifacts_dir, load_active_ensemble
from .velas import aperturas, series

SIMBOLOS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]
INTERVALO = "1d"
HORIZONTE = 10

DIA_MS = 86_400_000
#: Duración de cada tramo de evaluación. Un trimestre da suficientes operaciones en 1d para que la
#: media signifique algo, y suficientes cortes para que el bootstrap tenga de dónde remuestrear.
TRIMESTRE_MS = 90 * DIA_MS
#: Historia mínima antes del primer corte. Sin ella, las primeras selecciones se harían con cuatro
#: operaciones por clave y medirían el ruido del arranque.
CALENTAMIENTO_MS = 2 * 365 * DIA_MS
#: Operaciones mínimas por clave para que entre en el ranking de un corte.
MIN_OPERACIONES = 40


def operaciones() -> dict[str, list[tuple[int, float]]]:
    """`(instante de entrada, R neta)` de cada operación, por clave."""
    fuera: dict[str, list[tuple[int, float]]] = {}
    for symbol in SIMBOLOS:
        h, lo, c = series(symbol, INTERVALO)
        t0 = aperturas(symbol, INTERVALO)
        cfg = load_active_ensemble(symbol, INTERVALO)
        trades = run_backtest(h, lo, c, cfg, horizon=HORIZONTE)["trades"]
        fuera[symbol] = [(t0[int(t["index"])], float(t["r"])) for t in trades]
    return fuera


def walk_forward(ops: dict[str, list[tuple[int, float]]], k: int) -> dict[str, Any]:
    """Elige las `k` mejores con lo anterior a cada corte y las evalúa en el trimestre siguiente."""
    todos = sorted(ts for v in ops.values() for ts, _ in v)
    if not todos:
        return {"k": k, "n": 0}
    cortes = list(range(todos[0] + CALENTAMIENTO_MS, todos[-1], TRIMESTRE_MS))

    sel: list[float] = []
    tod: list[float] = []
    por_trimestre: list[float] = []
    elegidas: dict[str, int] = dict.fromkeys(SIMBOLOS, 0)
    for corte in cortes:
        rank: dict[str, float] = {}
        for s in SIMBOLOS:
            previas = [r for ts, r in ops[s] if ts < corte]
            if len(previas) >= MIN_OPERACIONES:
                rank[s] = float(np.mean(previas))
        if len(rank) < len(SIMBOLOS):
            continue  # todavía no se puede comparar a todas en igualdad
        top = sorted(rank, key=lambda x: -rank[x])[:k]
        for s in top:
            elegidas[s] += 1

        fin = corte + TRIMESTRE_MS
        de_sel = [r for s in top for ts, r in ops[s] if corte <= ts < fin]
        de_tod = [r for s in SIMBOLOS for ts, r in ops[s] if corte <= ts < fin]
        if not de_sel or not de_tod:
            continue
        sel += de_sel
        tod += de_tod
        por_trimestre.append(float(np.mean(de_sel)) - float(np.mean(de_tod)))

    return {
        "k": k,
        "n_operaciones": len(sel),
        "n_trimestres": len(por_trimestre),
        "expectancy_seleccionadas": round(float(np.mean(sel)), 4) if sel else 0.0,
        "expectancy_todas": round(float(np.mean(tod)), 4) if tod else 0.0,
        "diferencia_media": round(float(np.mean(por_trimestre)), 4) if por_trimestre else 0.0,
        "trimestres_a_favor": int(sum(1 for d in por_trimestre if d > 0)),
        "elegidas": elegidas,
        "_deltas": por_trimestre,
    }


def suelo_bootstrap(
    deltas: list[float], remuestreos: int = 10_000, semilla: int = 20260908
) -> float:
    """Percentil 5 de la diferencia media, remuestreando **trimestres** con reemplazo.

    El trimestre es la unidad porque dentro de él los desenlaces se amontonan: remuestrear
    operaciones sueltas trataría como independientes cosas que no lo son y daría un intervalo
    demasiado estrecho, que es el error que este proyecto ya cometió una vez.
    """
    if len(deltas) < 5:
        return float("-inf")
    d = np.asarray(deltas, dtype=float)
    rng = np.random.default_rng(semilla)
    medias = np.array([rng.choice(d, size=d.size, replace=True).mean() for _ in range(remuestreos)])
    return float(np.percentile(medias, 5))


def main() -> None:
    ops = operaciones()
    print("=" * 96)
    print("LISTA BLANCA: ¿aporta concentrar la operativa? (walk-forward trimestral en 1d)")
    print("=" * 96)
    print("\n  ranking con TODO el histórico (lo que NO basta para decidir):")
    for s in sorted(SIMBOLOS, key=lambda x: -float(np.mean([r for _, r in ops[x]]))):
        rs = [r for _, r in ops[s]]
        print(f"    {s:10} {float(np.mean(rs)):+.4f} R   n={len(rs)}")

    filas: list[dict[str, Any]] = []
    print(f"\n  {'K':>3}{'seleccionadas':>16}{'operar las 4':>15}{'diferencia':>13}{'P5 boot':>10}")
    for k in (1, 2, 3):
        r = walk_forward(ops, k)
        if not r.get("n_trimestres"):
            continue
        p5 = suelo_bootstrap(r.pop("_deltas"))
        r["suelo_p5"] = round(p5, 4)
        filas.append(r)
        print(
            f"  {k:>3}{r['expectancy_seleccionadas']:>16.4f}{r['expectancy_todas']:>15.4f}"
            f"{r['diferencia_media']:>13.4f}{p5:>10.4f}"
        )
    mejor = max(filas, key=lambda f: f["diferencia_media"]) if filas else None
    if mejor:
        print(f"\n  K óptimo: {mejor['k']}  ·  elegidas por trimestre: {mejor['elegidas']}")
        veredicto = "SÍ" if mejor["suelo_p5"] > 0 else "NO (el P5 del bootstrap es negativo)"
        print(
            f"  {mejor['trimestres_a_favor']}/{mejor['n_trimestres']} trimestres a favor"
            f"  ·  significancia: {veredicto}"
        )
    destino = artifacts_dir() / "lista_blanca_estudio.json"
    destino.write_text(json.dumps(filas, indent=2, default=str), encoding="utf8")
    print(f"\n  informe: {destino}")


if __name__ == "__main__":
    main()

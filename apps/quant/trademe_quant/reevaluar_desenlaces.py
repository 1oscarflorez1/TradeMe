"""Reevalúa los desenlaces ya guardados con la ventana que arranca en la captura (0.72.0).

Uso:
    python -m trademe_quant.reevaluar_desenlaces            # informe en seco: no escribe nada
    python -m trademe_quant.reevaluar_desenlaces --aplicar  # guarda copia y reescribe

Por qué hace falta
-------------------
Hasta 0.71.1 la ventana de evaluación excluía la vela en la que se capturaba la decisión: en 1d, las
primeras 24 horas de cada operación. `ventana.trayectoria` lo corrige para las decisiones nuevas,
pero los desenlaces ya guardados se calcularon con la regla anterior, y el filtro de
reproducibilidad (`evaluacion.juzgar`) los recalcula con la vigente. Sin reescribirlos, todos los
que cambian dejarían de reproducir y desaparecerían del expediente de la cuarentena, del
entrenamiento del meta-modelo y de los estudios del Fundamental Score.

Una sola regla en todo el histórico es la única forma de que esos tres sigan midiendo algo.

Qué se reescribe y qué no
--------------------------
Cada desenlace guardado se recalcula con **la misma función que usa el evaluador**
(`ventana.desenlace`) y se clasifica:

- **igual** — misma clase de resultado y mismo R. No se toca.
- **cambia** — se reescribe con el valor nuevo.
- **no recalculable** — hoy no se puede cerrar: faltan velas en su trayectoria y el resultado sería
  un timeout. **No se toca.** Borrarlo lo dejaría pendiente para siempre y se perdería el dato; se
  queda como está y el filtro de reproducibilidad lo excluye, igual que hoy.

`evaluated_at` no se modifica: la cuarentena mira las decisiones más recientes, y cambiar ese
instante alteraría qué filas entran en su ventana por un motivo que no tiene nada que ver con el
mercado.

Por qué con copia
------------------
`--aplicar` escribe antes, en `artifacts/`, un JSON con el valor anterior y el nuevo de cada fila
que va a cambiar. Los desenlaces son recalculables, pero con la copia la operación se deshace
exactamente, no aproximadamente.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .evaluacion import _RAMAS, TOLERANCIA_R
from .ventana import Trayectoria, desenlace

#: Mismas columnas que lee el filtro de reproducibilidad: si divergieran, reescribiría otra cosa.
RAMAS = _RAMAS

#: Las claves que operan desde 0.70.0: el informe les dedica un bloque propio.
CLAVES_OPERATIVAS = (("ETHUSDT", "1d"), ("SOLUSDT", "1d"))


@dataclass(frozen=True)
class Fila:
    """Un desenlace guardado, de cualquiera de las dos ramas."""

    rama: str
    id: Any
    symbol: str
    interval: str
    captured_at: dt.datetime
    candle_open: dt.datetime | None
    direction: str
    entry: float
    stop: float
    take_profit: float
    resultado: str
    r: float


@dataclass(frozen=True)
class Reevaluada:
    fila: Fila
    clase: str  # igual | cambia | no_recalculable | sin_duracion
    resultado_nuevo: str | None
    r_nuevo: float | None


def clasificar(fila: Fila, tray: Trayectoria | None, sin_duracion: bool = False) -> Reevaluada:
    """Recalcula un desenlace con la ventana vigente y dice qué hay que hacer con él."""
    if sin_duracion:
        return Reevaluada(fila, "sin_duracion", None, None)
    res = desenlace(fila.direction, fila.entry, fila.stop, fila.take_profit, tray)
    if res is None:
        return Reevaluada(fila, "no_recalculable", None, None)
    r_nuevo = float(res["r"])
    igual = res["result"] == fila.resultado and abs(r_nuevo - fila.r) <= TOLERANCIA_R
    return Reevaluada(fila, "igual" if igual else "cambia", str(res["result"]), r_nuevo)


def reevaluar(
    filas: list[Fila],
    trayectoria_de: Callable[[str, str, dt.datetime, int], Trayectoria | None],
    horizons: dict[str, int],
    horizon: int = 20,
) -> list[Reevaluada]:
    """Clasifica todas las filas. `trayectoria_de` sale de la base o de una exportación."""
    from .market.normalize import INTERVAL_MS

    fuera: list[Reevaluada] = []
    for fila in filas:
        if fila.interval not in INTERVAL_MS:
            fuera.append(clasificar(fila, None, sin_duracion=True))
            continue
        h = horizons.get(fila.interval, horizon)
        fuera.append(
            clasificar(fila, trayectoria_de(fila.symbol, fila.interval, fila.captured_at, h))
        )
    return fuera


def _expectancy(rs: list[float]) -> str:
    return f"{sum(rs) / len(rs):+.4f}" if rs else "  —   "


def _primeras_por_vela(
    resultados: list[Reevaluada], symbol: str, interval: str
) -> list[Reevaluada]:
    """Una fila por vela: la primera captura, que es la que se opera (ver `docs/salud-1d.md`)."""
    primeras: dict[Any, Reevaluada] = {}
    de_clave = [
        x
        for x in resultados
        if x.fila.rama == "real" and x.fila.symbol == symbol and x.fila.interval == interval
    ]
    for x in sorted(de_clave, key=lambda y: y.fila.captured_at):
        primeras.setdefault(x.fila.candle_open or x.fila.captured_at, x)
    return list(primeras.values())


def informe(resultados: list[Reevaluada], coste_pct: float) -> list[str]:
    """Lo que hay que ver antes de aplicar: cuánto cambia, dónde, y qué le pasa a lo que opera."""
    from .costes import coste_en_r

    lineas: list[str] = []
    for rama in RAMAS:
        de_rama = [x for x in resultados if x.fila.rama == rama]
        if not de_rama:
            continue
        clases = Counter(x.clase for x in de_rama)
        lineas.append(
            f"[{rama}] {len(de_rama)} desenlaces · iguales {clases['igual']} · "
            f"cambian {clases['cambia']} · no recalculables {clases['no_recalculable']} · "
            f"sin duración {clases['sin_duracion']}"
        )
        lineas.append(
            f"  {'temporalidad':14}{'total':>7}{'iguales':>9}{'cambian':>9}{'no recalc.':>12}"
        )
        for interval in sorted({x.fila.interval for x in de_rama}):
            c = Counter(x.clase for x in de_rama if x.fila.interval == interval)
            total = sum(c.values())
            lineas.append(
                f"  {interval:14}{total:>7}{c['igual']:>9}{c['cambia']:>9}"
                f"{c['no_recalculable']:>12}"
            )
        transiciones = Counter(
            f"{x.fila.resultado}->{x.resultado_nuevo}" for x in de_rama if x.clase == "cambia"
        )
        if transiciones:
            lineas.append(
                "  transiciones: " + ", ".join(f"{k} {v}" for k, v in transiciones.most_common())
            )
        lineas.append("")

    lineas.append("[operativas] primera captura de cada vela, rama real, expectancy en R")
    lineas.append(
        f"  {'clave':12}{'velas':>6}{'bruta antes':>13}{'bruta después':>15}"
        f"{'neta antes':>12}{'neta después':>14}"
    )
    for symbol, interval in CLAVES_OPERATIVAS:
        primeras = _primeras_por_vela(resultados, symbol, interval)
        antes: list[float] = []
        despues: list[float] = []
        costes: list[float] = []
        for x in primeras:
            costes.append(coste_en_r(x.fila.entry, x.fila.stop, coste_pct))
            antes.append(x.fila.r)
            # Lo que no se reescribe se queda con su valor: el «después» es lo que habrá en la base.
            despues.append(x.r_nuevo if x.clase == "cambia" and x.r_nuevo is not None else x.fila.r)
        lineas.append(
            f"  {symbol + ':' + interval:12}{len(primeras):>6}{_expectancy(antes):>13}"
            f"{_expectancy(despues):>15}"
            f"{_expectancy([r - c for r, c in zip(antes, costes, strict=True)]):>12}"
            f"{_expectancy([r - c for r, c in zip(despues, costes, strict=True)]):>14}"
        )
    return lineas


# --- Base de datos -------------------------------------------------------------------------------


def leer_filas(conn: Any) -> list[Fila]:
    filas: list[Fila] = []
    for rama, (direccion, entrada, parada, objetivo, resultado, retorno) in RAMAS.items():
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT id, symbol, interval, captured_at, candle_open, {direccion}, {entrada},
                       {parada}, {objetivo}, {resultado}, {retorno}
                  FROM snapshots
                 WHERE {resultado} IS NOT NULL AND {entrada} IS NOT NULL
                   AND {direccion} IN ('LONG','SHORT')
                 ORDER BY symbol, interval, captured_at
                """)  # noqa: S608 - nombres de un mapa fijo de este módulo
            for r in cur.fetchall():
                filas.append(
                    Fila(
                        rama,
                        r[0],
                        str(r[1]),
                        str(r[2]),
                        r[3],
                        r[4],
                        str(r[5]),
                        float(r[6]),
                        float(r[7]),
                        float(r[8]),
                        str(r[9]),
                        float(r[10]) if r[10] is not None else 0.0,
                    )
                )
    return filas


def aplicar(conn: Any, resultados: list[Reevaluada], destino: Path) -> tuple[Path, int]:
    """Guarda la copia y reescribe, en una sola transacción. Devuelve la copia y las filas escritas.

    Cada UPDATE exige que el valor guardado siga siendo el que se leyó: si algo lo cambió entre la
    lectura y la escritura, esa fila no se toca.
    """
    cambios = [x for x in resultados if x.clase == "cambia"]
    marca = dt.datetime.now(dt.UTC).strftime("%Y%m%dT%H%M%SZ")
    copia = destino / f"reevaluacion_ventana_{marca}.json"
    copia.write_text(
        json.dumps(
            [
                {
                    "rama": x.fila.rama,
                    "id": str(x.fila.id),
                    "resultado_anterior": x.fila.resultado,
                    "r_anterior": x.fila.r,
                    "resultado_nuevo": x.resultado_nuevo,
                    "r_nuevo": x.r_nuevo,
                }
                for x in cambios
            ],
            indent=1,
        ),
        encoding="utf8",
    )
    escritas = 0
    with conn.cursor() as cur:
        for x in cambios:
            _, _, _, _, resultado, retorno = RAMAS[x.fila.rama]
            cur.execute(
                f"UPDATE snapshots SET {resultado}=%s, {retorno}=%s "  # noqa: S608 - mapa fijo
                f"WHERE id=%s AND {resultado}=%s",
                (x.resultado_nuevo, x.r_nuevo, x.fila.id, x.fila.resultado),
            )
            escritas += cur.rowcount
    conn.commit()
    return copia, escritas


def main(argv: list[str] | None = None) -> None:
    import os

    import psycopg

    from .costes import desde_config
    from .ensemble import artifacts_dir, load_ensemble
    from .evaluacion import _CacheSeries

    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--aplicar", action="store_true", help="guarda copia y reescribe")
    args = parser.parse_args(argv)

    base = load_ensemble(artifacts_dir() / "ensemble.yaml")
    horizons = {
        str(k): int(v) for k, v in base.get("evaluation", {}).get("horizon_by_tf", {}).items()
    }
    with psycopg.connect(os.environ["DATABASE_URL"]) as conn:
        cache = _CacheSeries(conn)
        resultados = reevaluar(leer_filas(conn), cache.trayectoria, horizons)
        for linea in informe(resultados, desde_config(base)):
            print(linea)
        if not args.aplicar:
            print("\n  En seco: no se ha escrito nada. Para aplicar: --aplicar")
            return
        copia, escritas = aplicar(conn, resultados, artifacts_dir())
        print(f"\n  Copia de los valores anteriores: {copia}")
        print(f"  Filas reescritas: {escritas}")


if __name__ == "__main__":
    main()

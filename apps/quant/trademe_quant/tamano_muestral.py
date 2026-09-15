"""¿Cuánto falta para saber si las claves que operan ganan de verdad? (0.76.0)

Uso: python -m trademe_quant.tamano_muestral

El piloto lo calcula en cada ciclo (líneas `muestra:`), el Laboratorio lo muestra y el check 7 de
`infra/salud-1d.sql` lo reproduce en SQL con los mismos literales. Ver `docs/salud-1d.md`.

La pregunta
-----------
Desde 0.70.0 solo operan ETHUSDT:1d y SOLUSDT:1d, porque el backtest les da expectancy neta positiva
con la configuración base. En vivo, ¿cuántas operaciones hacen falta para confirmar que es mayor que
cero, y cuántas llevamos?

La regla, fijada el 15-sep-2026 antes de calcular ninguna cifra en vivo
----------------------------------------------------------------------
- **Contraste**: unilateral sobre la R neta, α = 0,05 y potencia 0,80.
- **Hipótesis**: la expectancy neta que el backtest da a cada clave (`HIPOTESIS`). Es la ventaja con
  la que se justificó operarlas; si fuera la real, esto dice cuándo se vería. Es una constante y no
  el último backtest: un objetivo que se mueve en cada ciclo no se puede seguir.
- **Muestra**: primera captura de cada vela, como el panel y el check 6, con desenlace y tomada con
  la configuración base. Las decisiones con `model_version` `ens-opt-*` no cuentan: hasta el
  8-sep-2026 las optimizadas sustituían al yaml y medían otro sistema.
- **Independientes**: una decisión se evalúa durante `horizon_by_tf` velas (10 en 1d), y la del
  día siguiente comparte casi todo ese recorrido. Se cuentan de forma voraz: la primera evaluada y,
  cada vez, la siguiente que abre cuando la anterior ya no puede seguir abierta. Es el tamaño
  muestral que entra en el error estándar; con las decisiones a secas la evidencia saldría inflada
  unas diez veces.
- **Dispersión (σ)**: la de la propia muestra cuando llega a `MIN_SIGMA_PROPIA` evaluadas. Hasta
  entonces, la agrupada de todas las operaciones reales evaluadas de las claves, con cualquier
  configuración: lo que mide un TP, un SL o un timeout lo fija el plan (stop 1 R, objetivo 2 R,
  10 velas), no la configuración. El backtest lo respalda: 1,127 y 1,148 R con cientos de
  operaciones.
- **Operaciones necesarias**: `n = ((z_α + z_potencia) · σ / μ)²`. **Velas**: al menos
  `n × horizonte`, porque cabe como mucho una independiente por horizonte.
- **Confirmada**: el límite inferior del intervalo unilateral del 95 % (t de Student con
  `independientes − 1` grados) queda por encima de cero. **Pérdida**: el superior queda por debajo.
"""

from __future__ import annotations

import datetime as dt
import json
import math
import statistics
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from typing import Any

#: z de la normal para α = 0,05 unilateral y potencia 0,80. Siete decimales: son los mismos
#: literales que el check 7 de `infra/salud-1d.sql`, para que el piloto y el check den lo mismo.
Z_ALFA = 1.6448536
Z_POTENCIA = 0.8416212

#: t de Student al 95 % unilateral, redondeada **hacia arriba** a tres decimales. Entre filas se usa
#: la de menos grados de libertad, que es mayor: cualquier error empuja hacia no confirmar.
T95: dict[int, float] = {
    1: 6.314, 2: 2.920, 3: 2.354, 4: 2.132, 5: 2.016, 6: 1.944, 7: 1.895, 8: 1.860, 9: 1.834,
    10: 1.813, 11: 1.796, 12: 1.783, 13: 1.771, 14: 1.762, 15: 1.754, 16: 1.746, 17: 1.740,
    18: 1.735, 19: 1.730, 20: 1.725, 21: 1.721, 22: 1.718, 23: 1.714, 24: 1.711, 25: 1.709,
    26: 1.706, 27: 1.704, 28: 1.702, 29: 1.700, 30: 1.698, 40: 1.684, 60: 1.671, 120: 1.658,
}  # fmt: skip

#: Expectancy neta del backtest con la configuración base, 15-sep-2026 (403 y 272 operaciones).
HIPOTESIS: dict[str, float] = {"ETHUSDT:1d": 0.0588, "SOLUSDT:1d": 0.1026}

#: Evaluadas propias a partir de las cuales σ deja de tomarse del conjunto.
MIN_SIGMA_PROPIA = 30

#: Las decisiones de las configuraciones optimizadas, que hasta 0.69.0 sustituían al yaml.
PREFIJO_OPTIMIZADA = "ens-opt-"

DURACION: dict[str, dt.timedelta] = {
    "1m": dt.timedelta(minutes=1),
    "5m": dt.timedelta(minutes=5),
    "15m": dt.timedelta(minutes=15),
    "30m": dt.timedelta(minutes=30),
    "1h": dt.timedelta(hours=1),
    "4h": dt.timedelta(hours=4),
    "1d": dt.timedelta(days=1),
    "1w": dt.timedelta(weeks=1),
}


@dataclass(frozen=True)
class Operacion:
    clave: str
    vela: dt.datetime
    #: R neta: el bruto guardado menos el coste de la operación.
    r: float
    #: Tomada con la configuración base, no con una optimizada.
    base: bool


def t_critico(gl: int) -> float:
    if gl < 1:
        raise ValueError("hacen falta al menos 1 grado de libertad")
    return T95[max(g for g in T95 if g <= gl)]


def independientes(velas: Iterable[dt.datetime], paso: dt.timedelta) -> list[dt.datetime]:
    """Las decisiones que no comparten recorrido: cada una abre cuando la anterior ya ha cerrado."""
    elegidas: list[dt.datetime] = []
    for vela in sorted(velas):
        if not elegidas or vela >= elegidas[-1] + paso:
            elegidas.append(vela)
    return elegidas


def sigma_agrupada(grupos: Sequence[Sequence[float]]) -> tuple[float | None, int]:
    """Desviación típica dentro de cada grupo, agrupada. Devuelve también cuántas operaciones usó.

    Cada grupo se centra en su propia media: si una clave gana más que otra, esa diferencia no es
    dispersión de las operaciones y no debe engordar σ.
    """
    llenos = [g for g in grupos if g]
    n = sum(len(g) for g in llenos)
    gl = n - len(llenos)
    if gl < 1:
        return None, n
    suma = 0.0
    for g in llenos:
        media = statistics.fmean(g)
        suma += sum((x - media) ** 2 for x in g)
    return math.sqrt(suma / gl), n


def operaciones_necesarias(sigma: float, mu: float) -> int | None:
    """Independientes para confirmar μ > 0 (α = 0,05, potencia 0,80) si la expectancy real es μ."""
    if mu <= 0 or sigma <= 0:
        return None
    return math.ceil(((Z_ALFA + Z_POTENCIA) * sigma / mu) ** 2)


def seguimiento(
    operaciones: Sequence[Operacion],
    claves: Sequence[str],
    horizontes: dict[str, int],
    hipotesis: dict[str, float] = HIPOTESIS,
) -> list[dict[str, Any]]:
    """Dónde está cada clave: cuánto lleva, cuánto le falta y qué se puede afirmar ya."""
    sigma_conjunta, n_conjunta = sigma_agrupada(
        [[o.r for o in operaciones if o.clave == c] for c in claves]
    )
    salida: list[dict[str, Any]] = []
    for clave in claves:
        intervalo = clave.split(":")[1]
        horizonte = horizontes[intervalo]
        base = [o for o in operaciones if o.clave == clave and o.base]
        rs = [o.r for o in base]
        n_indep = len(independientes((o.vela for o in base), horizonte * DURACION[intervalo]))

        if len(rs) >= MIN_SIGMA_PROPIA:
            sigma: float | None = statistics.stdev(rs)
            origen = f"propia ({len(rs)} evaluadas)"
        else:
            sigma = sigma_conjunta
            origen = f"agrupada ({n_conjunta} operaciones, cualquier configuración)"

        mu = hipotesis.get(clave)
        necesarias = operaciones_necesarias(sigma, mu) if sigma and mu is not None else None
        velas = necesarias * horizonte if necesarias is not None else None
        media = statistics.fmean(rs) if rs else None

        inferior = superior = efecto = None
        estado = "SIN MUESTRA"
        if sigma and media is not None and n_indep >= 2:
            t = t_critico(n_indep - 1)
            ee = sigma / math.sqrt(n_indep)
            inferior, superior, efecto = media - t * ee, media + t * ee, (t + Z_POTENCIA) * ee
            if inferior > 0:
                estado = "CONFIRMADA"
            elif superior < 0:
                estado = "PERDIDA"
            else:
                estado = "EN CURSO"

        salida.append(
            {
                "clave": clave,
                "evaluadas": len(rs),
                "independientes": n_indep,
                "media_neta": media,
                "sigma": sigma,
                "sigma_origen": origen,
                "ic95_inferior": inferior,
                "ic95_superior": superior,
                # La expectancy más pequeña que, de ser la real, hoy se confirmaría (potencia 0,80).
                "efecto_detectable": efecto,
                "hipotesis": mu,
                "necesarias": necesarias,
                "velas_minimas": velas,
                "anios_minimos": (
                    velas * DURACION[intervalo] / dt.timedelta(days=365.25)
                    if velas is not None
                    else None
                ),
                "progreso": n_indep / necesarias if necesarias else None,
                "estado": estado,
            }
        )
    return salida


def lineas(filas: Sequence[dict[str, Any]]) -> list[str]:
    """Una línea por clave para el log del piloto."""
    salida = []
    for f in filas:
        texto = f"{f['clave']} {f['independientes']} independientes ({f['evaluadas']} evaluadas)"
        if f["necesarias"] is not None:
            texto += (
                f" de {f['necesarias']} necesarias ({f['progreso']:.1%}), al menos "
                f"{f['velas_minimas']} velas (~{f['anios_minimos']:.0f} años)"
            )
        if f["estado"] == "SIN MUESTRA":
            texto += "; sin muestra todavía"
        else:
            texto += (
                f"; media {f['media_neta']:+.3f} R, IC95 [{f['ic95_inferior']:+.3f}, "
                f"{f['ic95_superior']:+.3f}], "
                f"hoy solo se confirmaría ≥ {f['efecto_detectable']:+.3f} R"
            )
        salida.append(f"{texto} · {f['estado']}")
    return salida


def cargar(dsn: str, claves: Sequence[str]) -> list[Operacion]:
    """Primera captura de cada vela de las claves, con desenlace, en R neta."""
    import psycopg

    from .costes import coste_en_r, desde_config
    from .ensemble import artifacts_dir, load_ensemble

    pct = desde_config(load_ensemble(artifacts_dir() / "ensemble.yaml"))
    simbolos = sorted({c.split(":")[0] for c in claves})
    intervalos = sorted({c.split(":")[1] for c in claves})
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT ON (symbol, interval, candle_open) symbol, interval, candle_open, "
            "model_version, outcome_result, outcome_return_r, plan_entry, plan_stop "
            "FROM snapshots WHERE symbol = ANY(%s) AND interval = ANY(%s) "
            "AND candle_open IS NOT NULL "
            "ORDER BY symbol, interval, candle_open, captured_at ASC",
            (simbolos, intervalos),
        )
        filas = cur.fetchall()

    operaciones = []
    for symbol, interval, vela, version, resultado, r_bruto, entry, stop in filas:
        clave = f"{symbol}:{interval}"
        if clave not in claves or resultado is None or r_bruto is None:
            continue
        coste = coste_en_r(entry, stop, pct) if entry is not None and stop is not None else 0.0
        operaciones.append(
            Operacion(
                clave=clave,
                vela=vela,
                r=float(r_bruto) - coste,
                base=version is not None and not str(version).startswith(PREFIJO_OPTIMIZADA),
            )
        )
    return operaciones


def medir(dsn: str) -> list[dict[str, Any]]:
    """El seguimiento de las claves de `active_keys`, con los horizontes del yaml base."""
    from .ensemble import artifacts_dir, horizontes_evaluacion, load_ensemble

    claves = [
        str(c) for c in load_ensemble(artifacts_dir() / "ensemble.yaml").get("active_keys", [])
    ]
    return seguimiento(cargar(dsn, claves), claves, horizontes_evaluacion())


def main() -> None:
    import os

    filas = medir(os.environ["DATABASE_URL"])
    for linea in lineas(filas):
        print(linea)
    print(json.dumps(filas, indent=2, ensure_ascii=False, default=str))


if __name__ == "__main__":
    main()

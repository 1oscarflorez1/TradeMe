"""¿Elige TradeMe la dirección mejor que una moneda? — biblioteca de medición.

El hecho que abre la pregunta
------------------------------
Medido el 23 de agosto de 2026 sobre las 1.218 decisiones cerradas de producción:

    LONG    n=586   expectancy +0,488 R   aciertos 53,9 %
    SHORT   n=632   expectancy −0,309 R   aciertos 28,3 %
    TOTAL   n=1218  expectancy +0,074 R   aciertos 40,6 %

Con la relación 2:1 de la plataforma, el punto de equilibrio está en **33,3 %** de aciertos. Los
largos lo baten con holgura y **los cortos quedan por debajo** — y se emiten más cortos que largos,
así que el conjunto se queda en un +0,074 R que no describe ni una cosa ni la otra.

Eso admite dos explicaciones muy distintas y hasta ahora nadie las había separado:

1. **Habilidad.** La plataforma acierta al elegir dirección, y los cortos tienen un defecto propio.
2. **Deriva.** El mercado subió durante ese periodo, así que cualquier largo habría ganado y
   cualquier corto habría perdido. No habría habilidad ninguna, solo viento a favor.

El contrafactual, y por qué es exacto
--------------------------------------
Cada decisión guardó su plan —entrada, stop y objetivo— en el momento de tomarla. El **plan espejo**
es ese mismo plan con la dirección invertida y los niveles reflejados sobre la entrada: mismo
riesgo, misma relación, dirección opuesta. Evaluándolo con `backtest.evaluate_trade` —el evaluador
real del proyecto, no una reimplementación— contra las mismas velas y el mismo horizonte, se obtiene
**qué habría pasado apostando al revés en ese mismo instante**.

Con las dos ramas de cada decisión se puede preguntar lo que importa: *¿lo que eligió la plataforma
bate a elegir la dirección a cara o cruz?*

Lo que esto NO mide
--------------------
La elección de **cuándo** operar. Aquí solo entran las decisiones que llegaron a abrir posición, así
que la pregunta es «dado que opera, ¿acierta la dirección?». Si la plataforma acertara eligiendo
momentos pero no direcciones —o al revés— este estudio solo vería la segunda mitad.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, NamedTuple

import numpy as np

from .nula import PERMUTACIONES_ESTUDIO, SEMILLA, agrupar

CONTRARIA = {"LONG": "SHORT", "SHORT": "LONG"}


class PlanEspejo(NamedTuple):
    direction: str
    entry: float
    stop: float
    take_profit: float


def plan_espejo(direction: str, entry: float, stop: float, take_profit: float) -> PlanEspejo:
    """El mismo plan apostando al revés: dirección opuesta y niveles reflejados sobre la entrada.

    Reflejar y no reconstruir es lo que hace la comparación limpia. Un corto que la plataforma
    hubiera generado de verdad en ese instante habría tenido su propio plan a partir del ATR, y
    entonces estaríamos comparando dos cosas a la vez —la dirección y el dimensionamiento—. Con el
    espejo, lo único que cambia es el signo de la apuesta.

    La distancia al stop se conserva exactamente, así que la unidad de riesgo (`R`) es la misma en
    las dos ramas y los retornos son comparables sin reescalar nada.
    """
    return PlanEspejo(
        direction=CONTRARIA.get(direction.upper(), direction.upper()),
        entry=entry,
        stop=2.0 * entry - stop,
        take_profit=2.0 * entry - take_profit,
    )


class Veredicto(NamedTuple):
    n: int
    observada: float
    siempre_largo: float
    siempre_corto: float
    nula_p50: float
    nula_p95: float
    supera: bool


def nula_direccion(
    r_real: Sequence[float],
    r_espejo: Sequence[float],
    marcas: Sequence[int],
    permutaciones: int = PERMUTACIONES_ESTUDIO,
    semilla: int = SEMILLA,
) -> np.ndarray[Any, Any]:
    """Expectancy que sale de elegir la dirección A CARA Y CRUZ en cada decisión.

    Para cada repetición se lanza una moneda **por bloque de 24 h**, no por decisión. Las decisiones
    de un mismo tramo comparten mercado, así que sortearlas por separado promediaría la deriva hasta
    hacerla desaparecer y produciría una nula artificialmente estrecha — el mismo error que se
    corrigió en `nula.py` con el muestreo por bloques.

    Con la moneda por bloque, la nula conserva que acertar o fallar la dirección se paga en rachas,
    que es como se paga de verdad.
    """
    real = np.asarray(r_real, dtype=float)
    espejo = np.asarray(r_espejo, dtype=float)
    grupos = agrupar(marcas)
    rng = np.random.default_rng(semilla)
    out = np.empty(permutaciones, dtype=float)
    for k in range(permutaciones):
        elige_real = rng.random(len(grupos)) < 0.5
        acumulado = 0.0
        for grupo, tomar_real in zip(grupos, elige_real, strict=True):
            acumulado += float((real[grupo] if tomar_real else espejo[grupo]).sum())
        out[k] = acumulado / real.size
    return out


def juzgar(
    r_real: Sequence[float],
    r_espejo: Sequence[float],
    direcciones: Sequence[str],
    marcas: Sequence[int],
    permutaciones: int = PERMUTACIONES_ESTUDIO,
    semilla: int = SEMILLA,
) -> Veredicto:
    """Compara lo que hizo la plataforma con la moneda y con las dos apuestas fijas.

    `siempre_largo` y `siempre_corto` salen de tomar, en cada decisión, la rama de esa dirección —
    la real si coincide con la que se eligió, el espejo si no. Son la medida directa de
    **la deriva del periodo**: si `siempre_largo` ya da +0,5 R, un +0,5 R en los largos de la
    plataforma no demuestra ninguna habilidad.
    """
    real = np.asarray(r_real, dtype=float)
    espejo = np.asarray(r_espejo, dtype=float)
    dirs = np.asarray([d.upper() for d in direcciones])
    if real.size == 0:
        return Veredicto(0, 0.0, 0.0, 0.0, 0.0, 0.0, False)

    era_largo = dirs == "LONG"
    largo = np.where(era_largo, real, espejo)
    corto = np.where(era_largo, espejo, real)

    dist = nula_direccion(list(real), list(espejo), marcas, permutaciones, semilla)
    observada = float(real.mean())
    p95 = float(np.percentile(dist, 95))
    return Veredicto(
        n=real.size,
        observada=observada,
        siempre_largo=float(largo.mean()),
        siempre_corto=float(corto.mean()),
        nula_p50=float(np.percentile(dist, 50)),
        nula_p95=p95,
        supera=bool(observada > p95),
    )

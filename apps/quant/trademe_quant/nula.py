"""Distribuciones nulas por bloques: cuánto de lo medido lo consigue el azar (Hito A).

Por qué existe este módulo
--------------------------
Tres veces seguidas este proyecto fijó un listón sin preguntarle antes al azar, y las tres veces el
azar lo superaba:

1. **Votos efectivos** — se pedía que el Analista de Niveles aportase «+0,5 votos efectivos». Una
   columna de puro ruido aporta entre +0,42 y +0,61.
2. **Lift del meta-modelo** — se pedían +0,05 R. Un modelo entrenado con las etiquetas barajadas
   produce +0,083 R de media.
3. **Lift del Fundamental Score** — el mismo listón de +0,05 R. Su nula sale **negativa**
   (P95 = −0,149 R con baseline +1,395 R), porque descartar operaciones al azar arrastra la media
   hacia cero. Es decir: un umbral fijo **no es neutral respecto al régimen** — exigente en las
   rachas buenas y regalado en las malas, que es justo al revés de lo que conviene.

La lección no es «ese umbral estaba mal», es que **un umbral sin nula no es un umbral**: es un
número. Este módulo centraliza el cálculo para que ningún criterio nuevo pueda nacer sin él.

Por qué por BLOQUES y no por filas sueltas
------------------------------------------
Las decisiones de la plataforma no son independientes entre sí. Los cuatro activos cripto valen
1,52 efectivos (ver `correlaciones.py`), y además las decisiones de una temporalidad se amontonan
en el tiempo: medido el 22 de agosto de 2026, las 30 decisiones que juzgan a `BTCUSDT:15m` caben en
**9,8 horas**. Una permutación fila a fila subestimaría la varianza, que es repetir el error de
tratar `n` como evidencia.

Muestrear bloques enteros de 24 h hace que la nula **incorpore sola** ese solapamiento temporal,
sin tener que inventar un factor de descuento aparte.

Las dos nulas que hacen falta, y por qué no son la misma
--------------------------------------------------------
- `p95_seleccion` — para criterios que **descartan o conservan** operaciones (Fundamental Score,
  meta-modelo). Se permuta *cuántas* se seleccionan en cada bloque; el estadístico se inyecta
  porque cada módulo define el suyo: el Fundamental Score reparte los descartes sobre `n`
  (aportan 0), y el meta-modelo promedia **solo las conservadas**. Mismo nombre, distinto
  denominador; usar el ajeno daría un número sin sentido.
- `p95_expectancy_bloques` — para la cuarentena, que no descarta nada: mide **expectancy directa**.
  Su nula es un bootstrap por bloques sobre la población de decisiones cerradas.

Cuando no se puede calcular, devuelve 0,0
-----------------------------------------
Sin bloques ni población suficiente no hay percentil que estimar. Devolver 0,0 deja gobernando al
umbral fijo, que es el comportamiento previo: **nunca relaja, solo endurece o se queda igual**. Es
el mismo criterio que `correlaciones.factor_para`, que sin medición devuelve 1 en vez de inventarse
un ajuste.
"""

from __future__ import annotations

from collections.abc import Callable, Sequence
from datetime import datetime
from typing import Any

import numpy as np

from .correlaciones import VENTANA_H

#: Permutaciones dentro del ciclo del piloto automático. Menos que en los estudios, suficiente para
#: un percentil 95 estable y barato de recalcular cada pocas horas.
PERMUTACIONES_CICLO = 1_000
#: Permutaciones en los informes puntuales, donde el coste da igual.
PERMUTACIONES_ESTUDIO = 10_000
#: Percentil del listón. Alfa 0,05 por un lado: al azar se le concede el 5 %.
PERCENTIL = 95.0
#: Semilla fija: dos ejecuciones sobre los mismos datos deben dar el mismo veredicto.
SEMILLA = 20260822

#: Bloques distintos mínimos para estimar un percentil. Con menos, el «percentil 95» sería
#: literalmente «el mejor día» y no mediría variabilidad ninguna.
MIN_BLOQUES = 5
#: Decisiones mínimas en la población de la que se muestrea.
MIN_POBLACION = 100

#: Días de los que se toma la población de la nula de expectancy, terminando en la decisión más
#: reciente de la ventana juzgada.
#:
#: Por qué 14 y no «el mismo periodo que lo observado», que sería lo natural: medido, las ventanas
#: de salida de la cuarentena caben en **1 a 4 bloques** de 24 h. Con cuatro días, el percentil 95
#: es «el mejor de los cuatro» y no estima variabilidad ninguna. Para saber cuánto varía un tramo
#: de un día hacen falta muchos tramos de un día.
#:
#: Y no más de 14 porque Optuna publica configuración nueva cada una o dos semanas: por encima de
#: ese horizonte se estaría comparando contra un sistema que ya no existe. Es el mismo razonamiento
#: por el que `quarantine_policy.evaluate_real` mira solo lo reciente.
DIAS_POBLACION = 14


def marcas_de(timestamps: Sequence[Any], ventana_h: int = VENTANA_H) -> list[int]:
    """Convierte instantes en marcas de bloque. Lo que no sea fecha cae en el bloque 0.

    Un solo bloque no degenera en `p95_seleccion` —dentro de él se sigue reeligiendo al azar qué
    filas se seleccionan—, así que la ausencia de fechas la deja equivalente a la nula simple.
    """
    marcas: list[int] = []
    for ts in timestamps:
        if isinstance(ts, datetime):
            marcas.append(int(ts.timestamp() // (ventana_h * 3600)))
        else:
            marcas.append(0)
    return marcas


def agrupar(marcas: Sequence[int]) -> list[np.ndarray]:
    """Índices agrupados por marca de bloque, en orden temporal."""
    grupos: dict[int, list[int]] = {}
    for i, m in enumerate(marcas):
        grupos.setdefault(int(m), []).append(i)
    return [np.asarray(v) for _, v in sorted(grupos.items())]


def p95_seleccion(
    rs: Sequence[float],
    marcas: Sequence[int],
    seleccionadas: Sequence[bool],
    estadistico: Callable[[np.ndarray, np.ndarray], float],
    permutaciones: int = PERMUTACIONES_CICLO,
    semilla: int = SEMILLA,
    percentil: float = PERCENTIL,
) -> float:
    """Percentil que alcanza el AZAR seleccionando la misma cantidad de operaciones.

    Se reparten entre bloques los **conteos** de seleccionadas —no se eligen filas sueltas—, así que
    la nula conserva que las selecciones se amontonen, que es lo que ocurre de verdad, y rompe solo
    la asociación entre bloque y resultados.

    `estadistico(rs, seleccionadas) -> float` lo pone cada módulo: es lo único que cambia entre el
    lift del Fundamental Score y el del meta-modelo, y confundirlos daría un listón sin sentido.
    """
    n = len(rs)
    if n == 0 or not any(seleccionadas):
        return 0.0
    arr = np.asarray(rs, dtype=float)
    grupos = agrupar(marcas)
    conteos = np.asarray([int(sum(bool(seleccionadas[i]) for i in g)) for g in grupos])

    rng = np.random.default_rng(semilla)
    valores = np.empty(permutaciones, dtype=float)
    for k in range(permutaciones):
        elegidas = np.zeros(n, dtype=bool)
        for grupo, cuantas in zip(grupos, rng.permutation(conteos), strict=True):
            c = min(int(cuantas), grupo.size)
            if c > 0:
                elegidas[rng.choice(grupo, size=c, replace=False)] = True
        valores[k] = estadistico(arr, elegidas)
    return float(np.percentile(valores, percentil))


def distribucion_expectancy_bloques(
    poblacion_rs: Sequence[float],
    poblacion_marcas: Sequence[int],
    n: int,
    permutaciones: int = PERMUTACIONES_CICLO,
    semilla: int = SEMILLA,
) -> np.ndarray[Any, Any] | None:
    """Distribución nula completa de la expectancy de `n` decisiones. `None` si no se puede estimar.

    La hipótesis nula: *las decisiones de esta temporalidad son una muestra cualquiera del mercado
    que hubo en ese periodo*. Se muestrean **bloques enteros** de la población, con reemplazo, hasta
    juntar `n` decisiones, y se promedia.

    Muestrear bloques y no filas es lo que hace que la nula incorpore el solapamiento temporal sola.
    Si una temporalidad concentra sus 30 decisiones en menos de un día, la pregunta correcta no es
    «¿30 decisiones cualesquiera darían esto?» sino «¿un día cualquiera de la plataforma daría
    esto?», y son preguntas con respuestas muy distintas.

    Dentro del bloque elegido las filas se barajan antes de tomarlas: quedarse con las primeras
    sería quedarse siempre con las más antiguas del día.

    Se devuelve la distribución entera, y no solo el percentil que gobierna, porque los informes
    necesitan mirarla por los dos lados: el gobierno solo usa el P95, pero para saber si una
    temporalidad *entró* en cuarentena por mala o por un mal martes hay que mirar el P5.
    """
    if n <= 0:
        return None
    arr = np.asarray(poblacion_rs, dtype=float)
    if arr.size < MIN_POBLACION:
        return None
    grupos = agrupar(poblacion_marcas)
    if len(grupos) < MIN_BLOQUES:
        return None

    rng = np.random.default_rng(semilla)
    medias = np.empty(permutaciones, dtype=float)
    total_bloques = len(grupos)
    for k in range(permutaciones):
        tomadas: list[np.ndarray] = []
        acumulado = 0
        while acumulado < n:
            grupo = grupos[int(rng.integers(total_bloques))]
            tomadas.append(rng.permutation(grupo))
            acumulado += int(grupo.size)
        idx = np.concatenate(tomadas)[:n]
        medias[k] = float(arr[idx].mean())
    return medias


def p95_expectancy_bloques(
    poblacion_rs: Sequence[float],
    poblacion_marcas: Sequence[int],
    n: int,
    permutaciones: int = PERMUTACIONES_CICLO,
    semilla: int = SEMILLA,
    percentil: float = PERCENTIL,
) -> float:
    """Percentil de `distribucion_expectancy_bloques`, o 0,0 si no se puede estimar."""
    dist = distribucion_expectancy_bloques(
        poblacion_rs, poblacion_marcas, n, permutaciones, semilla
    )
    if dist is None:
        return 0.0
    return float(np.percentile(dist, percentil))

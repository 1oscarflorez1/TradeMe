"""Gobierno de la promoción: qué tiene que demostrar una configuración para operar de verdad.

El fallo que corrige
---------------------
El criterio de promoción del optimizador era una línea:

    promoted = opt_exp > base_exp

**Puramente relativo.** No exige rentabilidad, ni muestra mínima, ni control contra el azar. Medido
el 23 de agosto de 2026 sobre los quince informes publicados:

| | |
|---|---|
| promovidas | 12 de 20 |
| de ellas, con expectancy **negativa** en hold-out | **4** |
| tamaño del hold-out | **11 a 32 operaciones** |

`BTCUSDT:15m` se promocionó con **−0,579 R** porque la base daba −0,768. `BNBUSDT:30m`, con
**−0,274 R** y **once operaciones**. Con esa muestra, una diferencia de +0,19 R está entera dentro
del ruido.

Y esto explica lo que se venía midiendo sin encontrarle causa. No hay fuga de datos ni sobreajuste
sofisticado: el backtest y la producción **están de acuerdo**. Las configuraciones que operan hoy no
prometían ganar — prometían perder algo menos que las anteriores, y eso bastaba.

Es el mismo patrón que el proyecto ya corrigió cuatro veces —umbrales decorativos, el cupo del
percentil 95 en la cuarentena, el listón de ruido de los votos efectivos, el régimen invertido— y
esta vez en el componente con **más** poder sobre las decisiones: el optimizador reescribe los pesos
enteros, y era el único que nunca había pasado por el gobierno que sí se exigió al meta-modelo, al
Fundamental Score y a la cuarentena.

Las tres condiciones, y por qué cada una
-----------------------------------------
1. **Muestra mínima.** Once operaciones no son evidencia de nada. `MIN_TRADES_HOLDOUT = 25`, que es
   el orden de lo que ya exigen los demás guardianes del proyecto.
2. **Rentabilidad, no solo mejora.** Promocionar algo que pierde porque lo anterior perdía más es
   una carrera hacia abajo: cada promoción compara contra la anterior, no contra un estándar, así
   que la degradación se acumula sin que nada la frene.
3. **Superar al azar.** La mejora tiene que quedar por encima del percentil 95 de una nula por
   bloques sobre los propios desenlaces del hold-out. Sin esto, +0,19 R con n=16 se lee como una
   ventaja cuando es una tirada de moneda.

Se exigen **las tres**. Y las tres solo endurecen: una configuración que las cumpla habría pasado
también el criterio viejo, porque `mejora > nula >= 0` implica `opt > base`.

Lo que NO hace
---------------
No toca las configuraciones ya promovidas. El guardia solo decide promociones futuras, así que
activarlo no cambia lo que la plataforma opera ahora mismo — decidir qué hacer con las cuatro que
prometían pérdidas es una decisión aparte, y del usuario.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, NamedTuple

from .nula import PERMUTACIONES_CICLO, SEMILLA, agrupar

#: Operaciones mínimas en el hold-out para que su expectancy signifique algo.
MIN_TRADES_HOLDOUT = 25
#: Expectancy mínima que debe prometer la configuración candidata. Positiva y no «≥ 0»: promocionar
#: algo que no gana nada no es una mejora, es cambiar por cambiar.
MIN_EXPECTANCY = 0.05


class Veredicto(NamedTuple):
    promover: bool
    motivo: str
    base_expectancy: float
    optimized_expectancy: float
    mejora: float
    nula_p95: float
    n_holdout: int


def mejora_nula_p95(
    r_base: Sequence[float],
    r_opt: Sequence[float],
    marcas: Sequence[int],
    permutaciones: int = PERMUTACIONES_CICLO,
    semilla: int = SEMILLA,
) -> float:
    """Mejora que alcanza el azar barajando POR BLOQUES cuál de las dos configuraciones actuó.

    La nula correcta aquí no es barajar los retornos —eso cambiaría el nivel y compararía peras
    con manzanas— sino **sortear por bloque de tiempo a cuál de las dos ramas se atribuye el
    tramo**. Así se conserva que las operaciones de un mismo tramo comparten mercado, que es de
    donde sale casi toda la varianza.

    Con las dos series de distinta longitud —cada configuración abre sus propias operaciones— se
    comparan sus medias por bloque, que es lo que hace comparables dos conjuntos que no se solapan.
    """
    import numpy as np

    if not r_base or not r_opt:
        return 0.0
    grupos_b = agrupar(marcas[: len(r_base)])
    grupos_o = agrupar(marcas[: len(r_opt)])
    arr_b = np.asarray(r_base, dtype=float)
    arr_o = np.asarray(r_opt, dtype=float)
    n = min(len(grupos_b), len(grupos_o))
    if n < 2:
        return 0.0

    rng = np.random.default_rng(semilla)
    fuera = np.empty(permutaciones, dtype=float)
    for k in range(permutaciones):
        intercambia = rng.random(n) < 0.5
        a: list[float] = []
        b: list[float] = []
        for i in range(n):
            gb, go = arr_b[grupos_b[i]], arr_o[grupos_o[i]]
            if intercambia[i]:
                gb, go = go, gb
            a.extend(gb.tolist())
            b.extend(go.tolist())
        fuera[k] = (float(np.mean(b)) if b else 0.0) - (float(np.mean(a)) if a else 0.0)
    return float(np.percentile(fuera, 95))


def decidir(
    base_expectancy: float,
    optimized_expectancy: float,
    n_holdout: int,
    nula_p95: float = 0.0,
) -> Veredicto:
    """¿Se ha ganado esta configuración el derecho a operar? Hacen falta las tres condiciones."""
    mejora = optimized_expectancy - base_expectancy

    def veredicto(promover: bool, motivo: str) -> Veredicto:
        return Veredicto(
            promover=promover,
            motivo=motivo,
            base_expectancy=base_expectancy,
            optimized_expectancy=optimized_expectancy,
            mejora=mejora,
            nula_p95=nula_p95,
            n_holdout=n_holdout,
        )

    # El orden importa: se informa del primer motivo por el que no pasa, y la muestra va antes que
    # todo lo demás porque sin ella los otros dos números no significan nada.
    if n_holdout < MIN_TRADES_HOLDOUT:
        return veredicto(
            False, f"muestra insuficiente: {n_holdout}/{MIN_TRADES_HOLDOUT} operaciones"
        )
    if optimized_expectancy < MIN_EXPECTANCY:
        return veredicto(
            False,
            f"no promete ganar ({optimized_expectancy:+.3f} R; se exige ≥{MIN_EXPECTANCY}). "
            f"Que la base fuera peor ({base_expectancy:+.3f}) no la hace buena",
        )
    exigido = max(0.0, nula_p95)
    if mejora <= exigido:
        return veredicto(False, f"la mejora ({mejora:+.3f} R) no supera al azar ({exigido:+.3f})")
    return veredicto(
        True,
        f"promete {optimized_expectancy:+.3f} R y mejora {mejora:+.3f} sobre un azar de "
        f"{exigido:+.3f}, en {n_holdout} operaciones",
    )


def marcas_de_indices(indices: Sequence[int], velas_por_bloque: int) -> list[int]:
    """Agrupa índices de vela en bloques temporales, para la nula.

    El backtest trabaja con índices, no con fechas, así que el bloque se define en número de velas.
    Con `velas_por_bloque` igual a un día de esa temporalidad, el agrupamiento equivale al de 24 h
    que usa el resto del proyecto.
    """
    return [int(i) // max(1, velas_por_bloque) for i in indices]


def resumen(v: Veredicto) -> dict[str, Any]:
    """Lo que se guarda en el informe del optimizador, para poder auditar un veredicto después."""
    return {
        "promover": v.promover,
        "motivo": v.motivo,
        "mejora": round(v.mejora, 4),
        "nula_p95": round(v.nula_p95, 4),
        "n_holdout": v.n_holdout,
    }

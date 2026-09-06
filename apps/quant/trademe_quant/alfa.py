"""¿Aporta este vector **dinero**, no información? Marco contrafactual para candidatos nuevos.

Por qué otro criterio, si ya está `informacion.py`
--------------------------------------------------
Aquel mide ΔAUC: si una columna ayuda a **ordenar** mejor los desenlaces. Es la pregunta correcta
para admitir un voto en el ensemble, y sigue siéndolo.

No es la pregunta de este hito. Un vector puede ordenar algo mejor —AUC 0,52— y no mover la
expectancy lo suficiente para cubrir el coste de operar. Desde 0.63.0 sabemos cuánto es «lo
suficiente»: en 1d, la única temporalidad que queda operando, el round-trip cuesta **0,018 R**, y la
expectancy neta del ensemble es **+0,020 R**. Un candidato que no supere ese orden de magnitud no
cambia nada aunque tenga señal estadística.

Así que aquí se mide **R neta**, directamente, y contra un listón absoluto.

Qué es un vector, y qué se le pide
-----------------------------------
Un vector es una serie alineada con las velas que, en cada instante, solo usa información
disponible **en ese instante**. El marco no lo comprueba —no puede— pero sí lo exige: un vector que
mire al futuro dará un resultado espectacular y falso, y es el error más fácil de cometer aquí.

La prueba es un **filtro contrafactual**: se descartan las operaciones donde el vector dice «no» y
se compara la expectancy neta resultante con la de operarlas todas. Descartar no es gratis en la
comparación: las descartadas cuentan como 0 sobre el mismo `n`, porque no operar también es una
decisión y renunciar a operaciones ganadoras se paga.

Las tres condiciones, y por qué
--------------------------------
1. **Muestra.** Al menos `MIN_OPERACIONES` descartadas y conservadas. Un filtro que apenas cambia
   nada tiene lift ≈0 por construcción, y eso se leería como «no perjudica» en vez de como «no ha
   demostrado nada».
2. **Superar al azar.** El lift tiene que batir el P95 de una nula que descarta la **misma
   cantidad** de operaciones, repartida **por bloques** de 24 h. Sin bloques, un día bueno contaría
   como decenas de observaciones independientes — el error que este proyecto ya cometió una vez.
3. **Ser viable.** La expectancy neta resultante tiene que superar `UMBRAL_VIABILIDAD`. Mejorar de
   −0,20 R a −0,10 R es una mejora real y sigue siendo un negocio ruinoso: sin esta condición, el
   marco aprobaría filtros que solo pierden más despacio, que es exactamente el fallo que 0.54.0
   corrigió en el optimizador.

Se exigen **las tres**.
"""

from __future__ import annotations

from typing import Any, NamedTuple

import numpy as np

from .nula import PERMUTACIONES_ESTUDIO, p95_seleccion
from .promocion import marcas_de_indices

#: Expectancy neta mínima que debe alcanzar el filtro para que operar tenga sentido. Es el orden de
#: lo que hoy da la única temporalidad viable (1d, +0,020 R neta) y de lo que cuesta su round-trip
#: (0,018 R): por debajo de aquí, la ventaja no paga el peaje.
UMBRAL_VIABILIDAD = 0.015

#: Operaciones mínimas a cada lado del filtro. Sin descartes no hay nada que medir; sin
#: conservadas, tampoco.
MIN_OPERACIONES = 25


class Veredicto(NamedTuple):
    aporta: bool
    motivo: str
    n: int
    n_descartadas: int
    base_neta: float
    filtrada_neta: float
    lift: float
    nula_p95: float


def _lift_descartando(rs: np.ndarray[Any, Any], descartadas: np.ndarray[Any, Any]) -> float:
    """Lift de no operar ese conjunto: las descartadas aportan 0 sobre el mismo `n`.

    El denominador no cambia a propósito. Si se promediara solo sobre las conservadas, un filtro que
    se quedase con la mejor operación de la serie daría un lift enorme y una cuenta de resultados
    irrelevante.
    """
    return float(np.where(descartadas, 0.0, rs).mean()) - float(rs.mean())


def juzgar(
    rs_netas: list[float],
    descartadas: list[bool],
    marcas: list[int],
    umbral: float = UMBRAL_VIABILIDAD,
    min_operaciones: int = MIN_OPERACIONES,
    permutaciones: int = PERMUTACIONES_ESTUDIO,
) -> Veredicto:
    """¿Se ha ganado este vector el derecho a filtrar decisiones? Hacen falta las tres condiciones.

    `rs_netas` son R **ya netas de costes**: juzgar en bruto compararía contra una línea base que
    nadie puede cobrar.
    """
    n = len(rs_netas)
    n_desc = sum(1 for d in descartadas if d)
    arr = np.asarray(rs_netas, dtype=float)
    marca = np.asarray(descartadas, dtype=bool)
    base = float(arr.mean()) if n else 0.0
    filtrada = float(np.where(marca, 0.0, arr).mean()) if n else 0.0
    lift = filtrada - base

    def veredicto(aporta: bool, motivo: str, nula: float = 0.0) -> Veredicto:
        return Veredicto(
            aporta=aporta,
            motivo=motivo,
            n=n,
            n_descartadas=n_desc,
            base_neta=base,
            filtrada_neta=filtrada,
            lift=lift,
            nula_p95=nula,
        )

    # El orden importa: sin muestra, los otros dos números no significan nada.
    if n_desc < min_operaciones or (n - n_desc) < min_operaciones:
        return veredicto(
            False,
            f"muestra insuficiente: descarta {n_desc} y conserva {n - n_desc} "
            f"(se exigen {min_operaciones} a cada lado)",
        )

    nula = p95_seleccion(
        rs_netas, marcas, descartadas, _lift_descartando, permutaciones=permutaciones
    )
    if lift <= max(0.0, nula):
        return veredicto(
            False, f"la mejora ({lift:+.4f} R) no supera al azar ({max(0.0, nula):+.4f})", nula
        )
    if filtrada < umbral:
        return veredicto(
            False,
            f"mejora pero no llega a ser negocio: {filtrada:+.4f} R netos, "
            f"se exigen {umbral:+.3f}. Perder más despacio no es ganar",
            nula,
        )
    return veredicto(
        True,
        f"aporta {lift:+.4f} R sobre un azar de {max(0.0, nula):+.4f} y deja "
        f"{filtrada:+.4f} R netos, descartando {n_desc} de {n}",
        nula,
    )


def evaluar_vector(
    trades: list[dict[str, Any]],
    valores: dict[int, float],
    velas_por_bloque: int,
    regla: str = "descartar_bajos",
    corte: float = 1.0 / 3.0,
    **kwargs: Any,
) -> Veredicto:
    """Juzga un vector sobre las operaciones de un backtest ya ejecutado.

    `valores` mapea el índice de vela de entrada de cada operación al valor del vector en **esa**
    vela. Las operaciones sin valor se quedan fuera del juicio en vez de asumirles un cero: un
    hueco de datos no es una lectura neutra.

    `velas_por_bloque` traduce índices de vela a bloques temporales para la nula. Es obligatorio y
    no tiene valor por defecto a propósito: el backtest trabaja con índices, y pasarle instantes a
    `nula.marcas_de` los metería todos en el bloque 0 — la nula degeneraría a la simple y
    subestimaría la varianza justo donde se quiere medir. Con un día de esa temporalidad, el
    agrupamiento coincide con el de 24 h que usa el resto del proyecto.

    `regla` define qué se descarta. `descartar_bajos` quita el tercil inferior del vector;
    `descartar_altos`, el superior. El corte se fija por percentil y no por un valor absoluto, para
    que el veredicto no dependa de la escala del candidato.
    """
    usables = [t for t in trades if int(t["index"]) in valores]
    if not usables:
        return juzgar([], [], [], **kwargs)

    v = np.asarray([valores[int(t["index"])] for t in usables], dtype=float)
    rs = [float(t["r"]) for t in usables]  # `r` es NETO desde 0.63.0
    marcas = marcas_de_indices([int(t["index"]) for t in usables], velas_por_bloque)

    if regla == "descartar_altos":
        limite = float(np.quantile(v, 1.0 - corte))
        descartadas = [bool(x >= limite) for x in v]
    else:
        limite = float(np.quantile(v, corte))
        descartadas = [bool(x <= limite) for x in v]
    return juzgar(rs, descartadas, marcas, **kwargs)


def resumen(v: Veredicto) -> dict[str, Any]:
    """Lo que se guarda del veredicto, para poder auditarlo después."""
    return {
        "aporta": v.aporta,
        "motivo": v.motivo,
        "n": v.n,
        "n_descartadas": v.n_descartadas,
        "base_neta": round(v.base_neta, 4),
        "filtrada_neta": round(v.filtrada_neta, 4),
        "lift": round(v.lift, 4),
        "nula_p95": round(v.nula_p95, 4),
    }

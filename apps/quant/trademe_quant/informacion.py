"""¿Aporta esta fuente información sobre el DESENLACE? (sustituye al listón de votos efectivos)

Por qué existe este módulo
--------------------------
El proyecto juzgaba a los candidatos a «eje nuevo» con el **lift de votos efectivos**: cuánto sube
la participación de autovalores al añadir una séptima columna. Medido el 22 de agosto de 2026, ese
criterio no sirve para esto, y se puede demostrar de dos formas:

1. **Ninguno de los seis votos en producción lo pasa.** Se quita uno, se mide cuánto aporta al
   reañadirlo y se compara con el p95 de 200 columnas de ruido: 0 de 6, en las diez claves medidas.
2. **El p95 del ruido está a 0,001 del máximo teórico absoluto.** Una columna construida por
   Gram-Schmidt para ser *perfectamente* ortogonal a los seis votos supera ese p95 por entre 0,0005
   y 0,001 — un 0,2 %. El listón no separa «aporta» de «no aporta»: separa «es exactamente
   ortogonal» de todo lo demás, y ninguna variable informativa lo es, porque describir el mismo
   mercado implica correlacionar algo.

La raíz del error es conceptual: **los votos efectivos miden diversificación, no aportación**. Una
columna de ruido diversifica perfectamente y no aporta nada. Siguen siendo la métrica correcta para
lo suyo —descontar muestra por dependencia, que es lo que hace `independence.py`— y la equivocada
para decidir si una fuente nueva merece votar.

Lo que se mide aquí
--------------------
La pregunta correcta no es «¿es independiente de los demás?» sino **«¿ayuda a predecir el
desenlace mejor de lo que ya lo hacen los seis?»**. Se compara el AUC de un modelo con los seis
votos contra el de un modelo con los siete, **fuera de muestra**, y se contrasta con una nula que
rompe la relación entre la columna nueva y el resultado.

Que el instrumento funciona se comprueba igual que se descubrió que el otro no: preguntándole por
los votos que ya están en producción. Y ahí hay una limitación que conviene tener delante:
**ninguno de los seis aporta de forma estable**. `supertrend` es el que más se acerca, pero su delta
promediado queda en +0,0014 con una desviación de 0,0174 entre esquemas de validación — es decir,
indistinguible de cero.

Eso significa que el criterio está **demostrado para suspender y no para aprobar**: distingue con
solidez lo claramente negativo —`cvd_z` da −0,0205 con desviación 0,0047, negativo en los seis
esquemas— de lo que ronda el cero, pero no hay ninguna columna de referencia que dé positivo de
forma robusta con la que comprobar que sabría detectar un aporte real. Con más historia habrá que
volver a calibrarlo antes de fiarse de un «APORTA».

Que ningún voto aporte incrementalmente no es un fallo del criterio: es coherente con lo demás que
sabe el proyecto — los seis valen 1,41 efectivos y el meta-modelo no encuentra señal en ellos. Son
redundantes entre sí, así que casi ninguno aporta **por separado** aunque el conjunto sí informe.

Decisiones de diseño, y por qué
-------------------------------
- **Regresión logística, no un bosque.** Con 100-250 filas por clave y siete columnas, un modelo
  flexible memoriza. Aquí no se busca el mejor predictor posible, sino saber si una columna añade
  información: para eso, el modelo simple es el que menos confunde capacidad con aportación.
- **Validación por bloques temporales contiguos, no K-fold barajado.** Barajar el tiempo entrena
  con el futuro y evalúa con el pasado; con decisiones que se amontonan en horas, eso infla el AUC.
- **La nula permuta el ORDEN de los bloques de la columna nueva**, no sus filas sueltas. Así
  conserva su autocorrelación —una serie temporal suave sigue siendo suave— y rompe solo su
  asociación con el desenlace. Permutar filas destruiría la estructura y haría la nula demasiado
  fácil de superar.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any, NamedTuple

import numpy as np

from .nula import PERMUTACIONES_CICLO, SEMILLA, agrupar

#: Esquemas de validación sobre los que se promedia. **No es un número, es una lista**, y esa es la
#: corrección del 22 de agosto de 2026 por la noche.
#:
#: La primera versión fijaba `BLOQUES_CV = 5`, y ese 5 decidía el veredicto. Medido sobre las 1.033
#: decisiones cerradas, el delta de `supertrend` iba de **−0,0312 con 3 bloques a +0,0173 con 10**:
#: cambiaba de signo. Un criterio cuyo resultado depende de una constante elegida a ojo no es un
#: criterio, es una elección disfrazada de medición — el mismo error que el listón de ruido y que el
#: percentil 95 de la cuarentena, por tercera vez.
#:
#: Promediar el delta sobre varios esquemas quita esa arbitrariedad. Cuesta seis veces más, y para
#: un estudio que se ejecuta a mano eso da igual.
ESQUEMAS_CV = (3, 4, 5, 6, 8, 10)
#: Compatibilidad: quien pida un solo esquema sigue pudiendo hacerlo.
BLOQUES_CV = 5
#: Mejora mínima de AUC exigida además de superar la nula. Un +0,001 significativo sigue siendo
#: irrelevante para operar, y sin este suelo una muestra grande convertiría cualquier nimiedad en
#: «aporta».
MIN_DELTA_AUC = 0.01


class Aportacion(NamedTuple):
    auc_base: float
    auc_ampliado: float
    delta: float
    nula_p95: float
    aporta: bool


def _auc(y: np.ndarray[Any, Any], puntajes: np.ndarray[Any, Any]) -> float:
    """AUC por conteo de pares, con empates a 0,5. Misma convención que el resto del proyecto."""
    pos = puntajes[y == 1]
    neg = puntajes[y == 0]
    if pos.size == 0 or neg.size == 0:
        return 0.5
    mejores = float((pos[:, None] > neg[None, :]).sum())
    empates = float((pos[:, None] == neg[None, :]).sum())
    return float((mejores + 0.5 * empates) / (pos.size * neg.size))


def auc_fuera_de_muestra(
    X: np.ndarray[Any, Any], y: np.ndarray[Any, Any], bloques: int = BLOQUES_CV
) -> float:
    """AUC evaluando cada bloque temporal con un modelo entrenado en los demás.

    Los bloques son contiguos en el tiempo: `X` e `y` deben llegar ordenados de más antiguo a más
    reciente. Un bloque cuyo entrenamiento no tenga las dos clases se salta en vez de inventarse una
    predicción.
    """
    from sklearn.linear_model import LogisticRegression

    n = y.size
    if n < bloques * 4:
        return 0.5
    idx = np.arange(n)
    pred = np.full(n, np.nan, dtype=float)
    for test in np.array_split(idx, bloques):
        train = np.setdiff1d(idx, test)
        if test.size == 0 or np.unique(y[train]).size < 2:
            continue
        modelo = LogisticRegression(max_iter=2000)
        modelo.fit(X[train], y[train])
        pred[test] = modelo.predict_proba(X[test])[:, 1]
    listos = ~np.isnan(pred)
    if np.unique(y[listos]).size < 2:
        return 0.5
    return _auc(y[listos], pred[listos])


def auc_promedio(
    X: np.ndarray[Any, Any],
    y: np.ndarray[Any, Any],
    esquemas: Sequence[int] = ESQUEMAS_CV,
) -> float:
    """AUC fuera de muestra promediado sobre varios repartos en bloques.

    Cada reparto da una estimación con su propio sesgo —cuántas filas entrena, cuántas evalúa—, y
    con ~1.000 decisiones la diferencia entre 3 y 10 bloques llega a mover el delta de una columna
    de −0,03 a +0,02. Promediar no elimina esa varianza, pero deja de dejar el veredicto en manos de
    una constante arbitraria.
    """
    return float(np.mean([auc_fuera_de_muestra(X, y, b) for b in esquemas]))


def _permuta_por_bloques(
    columna: np.ndarray[Any, Any], marcas: Sequence[int], rng: np.random.Generator
) -> np.ndarray[Any, Any]:
    """Reordena los bloques temporales de la columna, conservando su contenido interno."""
    grupos = agrupar(marcas)
    if len(grupos) < 2:
        return rng.permutation(columna)
    orden = rng.permutation(len(grupos))
    salida = np.empty_like(columna)
    destino = np.concatenate([grupos[i] for i in orden])
    origen = np.concatenate(grupos)
    salida[origen] = columna[destino]
    return salida


def aporta_informacion(
    votos: Sequence[Sequence[float]],
    extra: Sequence[float],
    ganadora: Sequence[int],
    marcas: Sequence[int],
    permutaciones: int = PERMUTACIONES_CICLO // 8,
    semilla: int = SEMILLA,
    esquemas: Sequence[int] = ESQUEMAS_CV,
) -> Aportacion:
    """¿Mejora `extra` la predicción del desenlace por encima de lo que ya hacen los votos?

    `votos` son las columnas actuales (una lista por voto), `ganadora` es 1 si la operación acabó en
    beneficio y 0 si no, y `marcas` son los bloques temporales para la nula. Todo ordenado de más
    antiguo a más reciente.

    Para aportar hacen falta las dos cosas: superar la nula **y** mejorar al menos `MIN_DELTA_AUC`.
    Lo segundo evita que una muestra grande convierta un +0,001 en un aprobado.
    """
    X6 = np.asarray(votos, dtype=float).T
    col = np.asarray(extra, dtype=float)
    y = np.asarray(ganadora, dtype=int)
    if X6.ndim != 2 or X6.shape[0] != y.size or col.size != y.size:
        return Aportacion(0.5, 0.5, 0.0, 0.0, False)

    base = auc_promedio(X6, y, esquemas)
    ampliado = auc_promedio(np.column_stack([X6, col]), y, esquemas)
    delta = ampliado - base

    rng = np.random.default_rng(semilla)
    nulos = np.empty(permutaciones, dtype=float)
    for k in range(permutaciones):
        barajada = _permuta_por_bloques(col, marcas, rng)
        nulos[k] = auc_promedio(np.column_stack([X6, barajada]), y, esquemas) - base
    p95 = float(np.percentile(nulos, 95))

    return Aportacion(
        auc_base=base,
        auc_ampliado=ampliado,
        delta=delta,
        nula_p95=p95,
        aporta=bool(delta > p95 and delta >= MIN_DELTA_AUC),
    )

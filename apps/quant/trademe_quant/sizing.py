"""Dimensionar la posición por volatilidad inversa, y el error que hay que evitar al medirlo.

Lo primero: buena parte ya está hecha
--------------------------------------
El sizing por volatilidad inversa consiste en arriesgar menos cuando el mercado se mueve más. En
TradeMe **eso ya ocurre**, y conviene verlo antes de añadir nada: el stop está a `atr_stop_mult ×
ATR`, así que cuando la volatilidad sube el stop se aleja en precio y, para arriesgar el mismo 1 %
del capital, hay que comprar menos unidades. **1 R es siempre 1 % del capital, con cualquier ATR.**

Por eso todo el proyecto mide en R: la normalización por volatilidad está dentro de la unidad. Lo
que queda por probar es otra cosa —variar el **porcentaje de capital** según el régimen de
volatilidad—, y eso no cambia el R de ninguna operación: cambia **cuánto pesa cada una** en la
curva.

El error que invalidaría la medición
-------------------------------------
Si se arriesga la mitad en todo, el drawdown baja a la mitad… y el retorno también. No se ha
mejorado nada: se ha cambiado la escala. Comparar drawdowns entre dos esquemas de tamaño distinto es
comparar cosas distintas.

Por eso los pesos se **normalizan a media 1**: el tamaño medio es el mismo que el del baseline y lo
único que cambia es su *reparto* entre operaciones. Así la pregunta que se responde es la correcta:
*a igual exposición media, ¿reparte mejor el riesgo?*

Y la métrica no puede ser el drawdown a secas, por lo mismo. Se mira **retorno entre drawdown** y
Sharpe, que son invariantes a la escala.
"""

from __future__ import annotations

import numpy as np

#: Recorte de los pesos, en múltiplos del tamaño medio. Sin él, una operación en un mercado muy
#: tranquilo se llevaría una fracción enorme del riesgo total y la curva la decidiría ella sola.
PESO_MIN = 0.25
PESO_MAX = 4.0


def pesos_por_volatilidad_inversa(
    volatilidades: list[float], minimo: float = PESO_MIN, maximo: float = PESO_MAX
) -> list[float]:
    """Pesos proporcionales a `1 / volatilidad`, recortados y **normalizados a media 1**.

    La normalización es lo que hace justa la comparación: el tamaño medio no cambia respecto al
    baseline, así que cualquier diferencia en la curva viene del reparto y no de la escala. Sin ella
    se estaría midiendo «arriesgar menos», que baja el drawdown por definición y no es un hallazgo.

    Las volatilidades no positivas se tratan como ausencia de dato y reciben peso 1: no se puede
    dividir por ellas, y asignarles un peso enorme sería justo lo contrario de lo que se busca.
    """
    v = np.asarray(volatilidades, dtype=float)
    crudos = np.where(v > 0, 1.0 / np.where(v > 0, v, 1.0), np.nan)
    if np.all(np.isnan(crudos)):
        return [1.0] * len(volatilidades)

    media = float(np.nanmean(crudos))
    if media <= 0:
        return [1.0] * len(volatilidades)
    w = np.where(np.isnan(crudos), 1.0, crudos / media)
    w = np.clip(w, minimo, maximo)
    # El recorte rompe la media, así que se vuelve a normalizar. Iterar no haría falta: basta con
    # que la media final sea 1 para que la exposición media coincida con la del baseline.
    return [float(x) for x in w / float(w.mean())]


def curva(rs: list[float], pesos: list[float] | None = None) -> dict[str, float]:
    """Métricas de la curva de capital, invariantes a la escala salvo donde no puede serlo.

    `retorno_por_dd` es lo que responde a «¿reparte mejor el riesgo?». El drawdown a secas no
    responde a nada por sí solo: siempre se puede bajar arriesgando menos.
    """
    if not rs:
        return {"total": 0.0, "max_dd": 0.0, "retorno_por_dd": 0.0, "sharpe": 0.0}
    w = np.asarray(pesos if pesos is not None else [1.0] * len(rs), dtype=float)
    r = np.asarray(rs, dtype=float) * w

    equity = np.cumsum(r)
    picos = np.maximum.accumulate(np.concatenate([[0.0], equity]))[1:]
    max_dd = float(np.max(picos - equity)) if len(equity) else 0.0
    total = float(equity[-1])
    sd = float(r.std())
    return {
        "total": total,
        "max_dd": max_dd,
        "retorno_por_dd": total / max_dd if max_dd > 0 else 0.0,
        "sharpe": float(r.mean()) / sd if sd > 0 else 0.0,
    }

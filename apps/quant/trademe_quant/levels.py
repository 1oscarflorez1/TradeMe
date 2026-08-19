"""Analista de Niveles — detector de soportes y resistencias (Fase 0: medición).

Qué se está probando
--------------------
La hipótesis del traspaso es que los niveles aportan **un eje independiente** del precio agregado.
Es plausible —miden estructura (dónde ha reaccionado el precio antes), no pendiente ni velocidad,
que es lo que miden los seis votos actuales— pero es una hipótesis, no un hecho: un soporte se
calcula del precio histórico igual que una EMA.

Por eso este módulo **no vota todavía**. Existe para que `run_levels_study.py` pueda responder dos
preguntas con umbrales fijados de antemano:

1. ¿Cuántos votos efectivos añade? Listón acordado: **+0,5** (de 1,41 a >=1,91 en 4h).
2. ¿Predice algo por sí solo? Expectancy por tercil, con corrección por comparaciones múltiples.

Si no los pasa, el hito se cierra aquí y la decisión no se ha tocado.

Los parámetros de abajo quedaron fijados **antes de calcular nada**. Probar variantes y quedarse con
la que mejor puntúe sería elegir el criterio mirando el desenlace — el error que este proyecto
lleva evitando desde M10.5.

Interpretación en Fase 0: **reversión pura**. Cerca de un soporte, sesgo comprador; cerca de una
resistencia, sesgo vendedor. La lectura alternativa —que romper una resistencia es alcista— es más
parecida a como se opera de verdad, pero mezcla dos efectos opuestos en un solo número y haría la
medición ilegible. Se plantea después, si el eje resulta independiente.

Sin look-ahead
--------------
Un máximo relativo no se confirma hasta que pasan `RIGHT` velas después de él. El detector solo
mira hasta `len(velas) - 1 - RIGHT`, así que **nunca usa una vela que no existiera en el momento de
decidir**. Es la diferencia entre medir y hacer trampa sin querer, y hay un test que la fija.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from .indicators import atr_last, clamp

#: Velas a cada lado que definen un pivote. `RIGHT` es además el desplazamiento sin look-ahead.
LEFT = 3
RIGHT = 3
#: Historia máxima donde buscar pivotes.
WINDOW = 200
#: Dos niveles a menos de esta distancia (en ATRs) son la misma zona.
MERGE_ATR = 0.5
#: Más allá de esta distancia (en ATRs) un nivel no influye en el score.
REACH_ATR = 2.0
#: Vida media, en velas, de la relevancia de un toque. Lo viejo pesa menos, pero no desaparece.
HALF_LIFE = 100.0
#: Velas mínimas para que el detector tenga algo que decir.
MIN_CANDLES = 60


@dataclass(frozen=True)
class Zona:
    """Un nivel: el precio donde el mercado reaccionó, y cuánto se le hizo caso."""

    precio: float
    #: Suma de toques, cada uno decaído por antigüedad.
    fuerza: float
    toques: int
    #: Velas transcurridas desde el toque más reciente.
    antiguedad: int


def _pivotes(
    high: Sequence[float], low: Sequence[float], left: int, right: int
) -> tuple[list[tuple[int, float]], list[tuple[int, float]]]:
    """Máximos y mínimos relativos **confirmados**.

    El bucle acaba en `n - 1 - right` a propósito: un pivote necesita `right` velas posteriores para
    confirmarse, y esas velas tienen que existir ya. Mirar más allá sería usar información que en
    el momento de decidir no estaba disponible.
    """
    n = len(high)
    altos: list[tuple[int, float]] = []
    bajos: list[tuple[int, float]] = []
    for i in range(left, n - right):
        ventana_alta = high[i - left : i + right + 1]
        ventana_baja = low[i - left : i + right + 1]
        if high[i] >= max(ventana_alta):
            altos.append((i, float(high[i])))
        if low[i] <= min(ventana_baja):
            bajos.append((i, float(low[i])))
    return altos, bajos


def _agrupar(pivotes: list[tuple[int, float]], n: int, tolerancia: float) -> list[Zona]:
    """Funde pivotes próximos en zonas. Un nivel tocado tres veces no son tres niveles."""
    if not pivotes:
        return []
    ordenados = sorted(pivotes, key=lambda p: p[1])
    grupos: list[list[tuple[int, float]]] = [[ordenados[0]]]
    for idx, precio in ordenados[1:]:
        if abs(precio - grupos[-1][-1][1]) <= tolerancia:
            grupos[-1].append((idx, precio))
        else:
            grupos.append([(idx, precio)])

    zonas: list[Zona] = []
    for g in grupos:
        # Media ponderada por relevancia: la zona la marca el toque más reciente, no el más viejo.
        pesos = [0.5 ** ((n - 1 - i) / HALF_LIFE) for i, _ in g]
        total = sum(pesos)
        if total <= 0:
            continue
        precio = sum(p * w for (_, p), w in zip(g, pesos, strict=True)) / total
        zonas.append(
            Zona(
                precio=precio,
                fuerza=total,
                toques=len(g),
                antiguedad=n - 1 - max(i for i, _ in g),
            )
        )
    return zonas


def zonas(
    high: Sequence[float], low: Sequence[float], close: Sequence[float]
) -> tuple[list[Zona], list[Zona]]:
    """Soportes y resistencias vigentes, en ese orden. Solo con pivotes confirmados."""
    n = len(close)
    if n < MIN_CANDLES:
        return [], []
    desde = max(0, n - WINDOW)
    h = list(high[desde:])
    lo = list(low[desde:])
    c = list(close[desde:])
    atr = atr_last(h, lo, c)
    if not atr or atr <= 0:
        return [], []
    altos, bajos = _pivotes(h, lo, LEFT, RIGHT)
    tol = MERGE_ATR * atr
    return _agrupar(bajos, len(c), tol), _agrupar(altos, len(c), tol)


def score_niveles(
    high: Sequence[float], low: Sequence[float], close: Sequence[float]
) -> tuple[float, float] | None:
    """Devuelve `(score, distancia_en_atr)` o None si no hay material suficiente.

    `score` en [-1,+1]: positivo cerca de un soporte, negativo cerca de una resistencia. La fuerza
    se normaliza contra la zona más fuerte del momento, no contra una constante: igual que el
    percentil del funding en M12, así la lectura sigue significando lo mismo cuando cambie el
    régimen.

    `distancia_en_atr` es la del nivel más cercano en cualquier dirección. Es la magnitud con la que
    el estudio parte en terciles, porque «estar cerca de un nivel» es la hipótesis a contrastar.
    """
    n = len(close)
    if n < MIN_CANDLES:
        return None
    desde = max(0, n - WINDOW)
    h = list(high[desde:])
    lo = list(low[desde:])
    c = list(close[desde:])
    atr = atr_last(h, lo, c)
    if not atr or atr <= 0:
        return None

    soportes, resistencias = zonas(high, low, close)
    if not soportes and not resistencias:
        return None

    precio = float(c[-1])
    fuerza_max = max((z.fuerza for z in soportes + resistencias), default=0.0)
    if fuerza_max <= 0:
        return None

    def _mas_cercana(zs: list[Zona], debajo: bool) -> tuple[float, float] | None:
        """(distancia en ATRs, fuerza normalizada) de la zona relevante más próxima."""
        candidatas = [z for z in zs if (z.precio <= precio) == debajo]
        if not candidatas:
            return None
        z = min(candidatas, key=lambda z: abs(precio - z.precio))
        return abs(precio - z.precio) / atr, z.fuerza / fuerza_max

    sop = _mas_cercana(soportes, True)
    res = _mas_cercana(resistencias, False)

    def _proximidad(d: float) -> float:
        return max(0.0, 1.0 - d / REACH_ATR)

    empuje = 0.0
    distancias: list[float] = []
    if sop is not None:
        d, f = sop
        empuje += _proximidad(d) * f
        distancias.append(d)
    if res is not None:
        d, f = res
        empuje -= _proximidad(d) * f
        distancias.append(d)

    if not distancias:
        return None
    return clamp(empuje), min(distancias)

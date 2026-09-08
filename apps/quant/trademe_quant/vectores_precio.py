"""Tres vectores derivados del precio, ortogonales a los ocho indicadores del ensemble.

Por qué del precio
-------------------
Los candidatos externos se agotaron por falta de datos: el interés abierto y el long/short solo dan
30 días de histórico, y DXY/VIX estaban entonces sin clave de Twelve Data. El precio, en cambio,
tiene todo el histórico disponible — hasta 2017 en 1d.

(La vía macro se exploró después, en 0.67.0: los índices no existen en el plan gratuito y hubo que
usar sus réplicas ETF. Está en `series_macro` y `vectores_macro`.)

La apuesta es que los ocho indicadores actuales describen **dirección** (EMA, MACD, Supertrend) y
**posición en un rango** (RSI, Bollinger, Estocástico), y ninguno describe la **forma** de la
vela ni el **estado de la volatilidad**. Ahí es donde puede quedar algo que no sea redundante.

Que sean ortogonales es una hipótesis, no un hecho: el estudio la comprueba midiendo la correlación
con los votos existentes antes de juzgar nada.

Los tres
---------
1. **Asimetría de mechas.** `(mecha_superior − mecha_inferior) / rango`. Proxy de rechazo: una vela
   con mecha superior larga es precio que subió y fue devuelto. Necesita la apertura para separar el
   cuerpo de las mechas — de ahí `velas.series_ohlc`.

2. **Volatilidad de Parkinson frente a cierre-cierre.** Parkinson usa el rango máximo-mínimo y es
   eficiente cuando el precio se mueve dentro de la vela; la de cierre-cierre solo ve el movimiento
   neto. Su **ratio** distingue dos estados que la volatilidad sola confunde: mucho rango con poco
   avance —agitación sin dirección— frente a poco rango con avance limpio —tendencia ordenada—.

3. **Compresión y expansión.** `ATR(5) / ATR(30)`. Por debajo de 1, la volatilidad reciente se está
   comprimiendo; por encima, expandiéndose. Es la forma más directa de preguntar «¿está a punto de
   romper?» sin mirar al futuro.

Todos son **prefijo-calculables**: en la vela `t` solo usan datos hasta `t`. Las ventanas se toman
hacia atrás y ninguno interpola. Es la condición que `alfa.py` exige y no puede comprobar.
"""

from __future__ import annotations

import math

import numpy as np
import numpy.typing as npt

from .indicadores_series import atr_series

FloatArr = npt.NDArray[np.float64]

#: Ventana de las volatilidades. En 1d son tres semanas de mercado: suficiente para que la
#: referencia signifique algo y corta para que siga describiendo el estado actual.
VENTANA_VOL = 20
#: Periodos de la compresión. El corto tiene que reaccionar y el largo servir de referencia.
ATR_CORTO = 5
ATR_LARGO = 30


def asimetria_mechas(
    open_: list[float], high: list[float], low: list[float], close: list[float]
) -> dict[int, float]:
    """`(mecha superior − mecha inferior) / rango` en cada vela, acotado a [−1, +1].

    Positivo = rechazo por arriba (subió y lo devolvieron); negativo = rechazo por abajo.

    Las velas de rango nulo se **omiten** en vez de valer 0: un rango cero no es una vela simétrica,
    es una vela sin información, y meterla como neutra ensuciaría el tercil que decide qué se
    descarta.
    """
    fuera: dict[int, float] = {}
    for i in range(len(close)):
        rango = high[i] - low[i]
        if rango <= 0:
            continue
        cuerpo_alto = max(open_[i], close[i])
        cuerpo_bajo = min(open_[i], close[i])
        superior = high[i] - cuerpo_alto
        inferior = cuerpo_bajo - low[i]
        fuera[i] = (superior - inferior) / rango
    return fuera


def ratio_parkinson(
    high: list[float], low: list[float], close: list[float], ventana: int = VENTANA_VOL
) -> dict[int, float]:
    """Volatilidad de Parkinson dividida por la de cierre-cierre, sobre `ventana` velas.

    Parkinson estima la volatilidad con el rango de cada barra —`ln(H/L)` reescalado por
    `1/(4·ln2)`—; la de cierre-cierre, con la desviación de los rendimientos. Cuando el precio
    recorre mucho dentro de la vela y acaba donde empezó, la primera sube y la segunda no: el ratio
    separa la agitación de la tendencia, que es lo que ninguno de los ocho indicadores mira.

    La ventana termina en `t` inclusive, así que no mira al futuro. Las velas sin ventana
    completa se omiten.
    """
    n = len(close)
    if n <= ventana:
        return {}
    h = np.asarray(high, dtype=float)
    lo = np.asarray(low, dtype=float)
    c = np.asarray(close, dtype=float)

    with np.errstate(divide="ignore", invalid="ignore"):
        log_hl2 = np.square(np.log(np.where(lo > 0, h / lo, np.nan)))
        rend = np.diff(np.log(np.where(c > 0, c, np.nan)), prepend=np.nan)

    factor = 1.0 / (4.0 * math.log(2.0))
    fuera: dict[int, float] = {}
    for i in range(ventana, n):
        tramo_hl = log_hl2[i - ventana + 1 : i + 1]
        tramo_r = rend[i - ventana + 1 : i + 1]
        if np.isnan(tramo_hl).any() or np.isnan(tramo_r).any():
            continue
        parkinson = math.sqrt(factor * float(tramo_hl.mean()))
        cierre = float(tramo_r.std())
        if cierre <= 0:
            continue  # sin movimiento neto el ratio es infinito, no «muy alto»
        fuera[i] = parkinson / cierre
    return fuera


def compresion_atr(
    high: list[float],
    low: list[float],
    close: list[float],
    corto: int = ATR_CORTO,
    largo: int = ATR_LARGO,
) -> dict[int, float]:
    """`ATR(corto) / ATR(largo)`: por debajo de 1 la volatilidad se comprime, por encima se expande.

    Reutiliza `indicadores_series.atr_series`, que ya es el ATR de Wilder alineado por vela y con la
    misma convención que el resto del proyecto. Repetir aquí el cálculo habría creado una segunda
    definición de ATR que podría divergir sin que nadie lo notase.
    """
    h = np.asarray(high, dtype=float)
    lo = np.asarray(low, dtype=float)
    c = np.asarray(close, dtype=float)
    a_corto = atr_series(h, lo, c, period=corto)
    a_largo = atr_series(h, lo, c, period=largo)

    fuera: dict[int, float] = {}
    for i in range(len(close)):
        cv, lv = float(a_corto[i]), float(a_largo[i])
        if math.isnan(cv) or math.isnan(lv) or lv <= 0:
            continue
        fuera[i] = cv / lv
    return fuera


def correlacion_con(valores: dict[int, float], serie: FloatArr) -> float:
    """Correlación de Pearson del vector con otra serie, sobre los índices que ambos tienen.

    Sirve para comprobar la **ortogonalidad**, que es una hipótesis y no un hecho: un vector muy
    correlacionado con un voto que ya está dentro no puede aportar nada nuevo, gane o no la prueba.
    """
    idx = [i for i in valores if i < len(serie) and not math.isnan(float(serie[i]))]
    if len(idx) < 3:
        return 0.0
    a = np.asarray([valores[i] for i in idx], dtype=float)
    b = np.asarray([float(serie[i]) for i in idx], dtype=float)
    if a.std() <= 0 or b.std() <= 0:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])

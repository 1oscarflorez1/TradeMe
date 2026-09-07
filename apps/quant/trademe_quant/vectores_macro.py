"""Dos vectores de sesgo macro: fuerza del dólar y estrés de volatilidad.

La hipótesis
-------------
Los ocho indicadores del ensemble miran **solo el precio del propio activo**. La tesis macro dice
que el cripto no se mueve en el vacío: cuando el dólar se aprecia y la volatilidad implícita se
dispara, el dinero sale de los activos de riesgo antes de que ningún indicador técnico del BTC se
entere. Si eso fuera cierto y medible, sería alfa de verdad — información que el ensemble no puede
deducir de su propia serie por mucho que la mire.

Por qué solo dos
-----------------
Cada candidato se prueba en 8 claves × 2 reglas, y cada prueba tiene un 5 % de salir positiva por
azar. Añadir un tercer vector poco motivado no aumenta la probabilidad de encontrar algo: aumenta la
de encontrar **ruido con aspecto de algo**. Estos dos son los que la teoría respalda; no hay un
tercero con el mismo respaldo, así que no hay un tercero.

Por qué el dólar en z-score y la volatilidad en cambios
---------------------------------------------------------
Son dos series con problemas distintos y la respuesta no puede ser la misma para ambas.

- **UUP** cotiza en dólares y su nivel no significa nada comparable entre 2007 y 2026. El
  **z-score** sobre su propia ventana reciente sí: dice «el dólar está fuerte *para lo que ha estado
  últimamente*», que es la pregunta de régimen.
- **VXX** no puede mirarse en nivel bajo ningún tratamiento, porque el contango le come el 99 % en
  ocho años: un z-score de su nivel mediría sobre todo el paso del tiempo. Solo su **variación**
  sigue al VIX. Por eso aquí es el cambio logarítmico a cinco sesiones — una semana de mercado.

Ambos son **prefijo-calculables**: en la sesión `t` solo usan sesiones hasta `t`. Es la condición
que `alfa.py` exige y no puede comprobar, y hay un test que la verifica truncando la serie.
"""

from __future__ import annotations

import math

import numpy as np

#: Sesiones del z-score del dólar. Un mes de mercado: suficiente para que «fuerte» signifique algo
#: y corto para que siga describiendo el régimen actual y no la historia.
VENTANA_DOLAR = 20

#: Sesiones del cambio de volatilidad. Una semana de mercado: el estrés se propaga en días, no en
#: meses, y una ventana larga lo diluiría hasta hacerlo invisible.
VENTANA_VOL = 5

Serie = list[tuple[str, float]]


def tendencia_dolar(serie: Serie, ventana: int = VENTANA_DOLAR) -> dict[str, float]:
    """Z-score del cierre de UUP frente a su media y desviación de las últimas `ventana` sesiones.

    Positivo = dólar fuerte para lo que ha estado siendo. La hipótesis de riesgo dice que eso
    presiona al cripto a la baja.

    Las sesiones sin ventana completa se omiten, y también aquellas en las que la desviación es
    cero: un z-score con denominador nulo no es «neutro», es indefinido, y colarlo como 0 movería
    el tercil que decide qué se descarta.
    """
    fechas = [f for f, _ in serie]
    cierres = np.asarray([c for _, c in serie], dtype=float)
    fuera: dict[str, float] = {}
    for i in range(ventana - 1, len(cierres)):
        tramo = cierres[i - ventana + 1 : i + 1]
        sd = float(tramo.std())
        if sd <= 0:
            continue
        fuera[fechas[i]] = (float(cierres[i]) - float(tramo.mean())) / sd
    return fuera


def estres_volatilidad(serie: Serie, ventana: int = VENTANA_VOL) -> dict[str, float]:
    """Cambio logarítmico del cierre de VXX en `ventana` sesiones: `ln(c[t] / c[t−ventana])`.

    Positivo = la volatilidad implícita ha subido esta semana, es decir, aversión al riesgo
    creciente. Se mide en cambios y no en nivel porque el nivel de VXX está dominado por el coste de
    mantener futuros, no por el miedo — ver la cabecera de `series_macro`.

    El logaritmo, y no el porcentaje, porque estas variaciones son grandes y asimétricas: un +100 %
    y un −50 % son el mismo movimiento de ida y vuelta, y en porcentaje no lo parecen.
    """
    fechas = [f for f, _ in serie]
    cierres = [c for _, c in serie]
    fuera: dict[str, float] = {}
    for i in range(ventana, len(cierres)):
        antes, ahora = cierres[i - ventana], cierres[i]
        if antes <= 0 or ahora <= 0:
            continue
        fuera[fechas[i]] = math.log(ahora / antes)
    return fuera

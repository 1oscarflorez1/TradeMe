"""La vela en formación: por qué el backtest y la producción no miden el mismo mundo.

El hallazgo
------------
`apps/api/src/indicators/buffer.ts` guarda la vela **abierta** y la va reemplazando a cada tick:

    // Reemplaza si es la misma vela (aún abierta); si no, añade.
    if (last && last.openTime === candle.openTime) buf[buf.length - 1] = candle;

Y `buildSignal` decide con esa ventana: `price: ventana[ventana.length - 1]!.close`. Es decir,
**en producción la última vela de la ventana está a medio formar**.

El backtest hace lo contrario. `run_backtest` recorre `decide(high[: t + 1], ...)` con todas las
velas **cerradas**, y además salta las que dura cada operación (`t += res["bars"] + 1`), así que
nunca solapa posiciones.

Dos motores, dos mundos:

| | backtest | producción |
|---|---|---|
| vela de decisión | cerrada | en formación |
| operaciones a la vez | una | varias |

Por qué importa, y por qué justo a los cortos
----------------------------------------------
Los osciladores —RSI, Bollinger, Estocástico— se calculan sobre el cierre. Con la vela a medio
hacer, ese «cierre» es el precio de ahora mismo, que dentro de la vela recorre todo el rango. Un
oscilador puede marcar sobrecompra en el minuto 7 de una vela de 15 y no marcarla al cerrar.

Eso encaja con lo medido en `docs/regimen-coherencia.md`: los cortos se emiten con los tres votos de
tendencia en positivo y son los tres osciladores los que arrastran la votación. Si esas lecturas de
sobrecompra son en parte un artefacto de mirar velas a medio formar, el backtest **no puede verlo**,
porque él siempre mira velas cerradas.

Lo que hace este módulo
------------------------
Reconstruir el estado de una vela a mitad de su formación a partir de las velas de menor
granularidad que la componen. Con eso se puede preguntarle al motor real qué habría decidido en cada
momento de la vela, y compararlo con lo que decide al cerrarla.

No necesita la base de datos: las velas de 1m y de 15m del mismo periodo salen de Binance.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import NamedTuple


class Vela(NamedTuple):
    abre_ms: int
    open: float
    high: float
    low: float
    close: float


def vela_parcial(minutos: Sequence[Vela]) -> Vela:
    """El estado de una vela cuando solo han transcurrido estos minutos.

    La apertura es la del primer minuto, el máximo y el mínimo son los acumulados hasta ahora, y el
    «cierre» es el último precio conocido — que es exactamente lo que el buffer de producción tiene
    en ese instante y lo que `buildSignal` usa como `price`.
    """
    if not minutos:
        raise ValueError("hacen falta minutos para formar la vela")
    return Vela(
        abre_ms=minutos[0].abre_ms,
        open=minutos[0].open,
        high=max(m.high for m in minutos),
        low=min(m.low for m in minutos),
        close=minutos[-1].close,
    )


def agrupar_por_vela(minutos: Sequence[Vela], ms_vela: int) -> dict[int, list[Vela]]:
    """Reparte velas de 1m en las mayores a las que pertenecen, por su instante de apertura."""
    grupos: dict[int, list[Vela]] = {}
    for m in minutos:
        grupos.setdefault((m.abre_ms // ms_vela) * ms_vela, []).append(m)
    for lista in grupos.values():
        lista.sort(key=lambda v: v.abre_ms)
    return grupos


def instantes_de(total: int, fracciones: Sequence[float]) -> list[int]:
    """Cuántos minutos han pasado en cada fracción del recorrido de la vela.

    Se muestrea en puntos del recorrido y no minuto a minuto porque el piloto no decide cada
    minuto: lo medido en producción son ~1,3 decisiones por vela de 15m. Lo que interesa es cómo
    cambia la decisión según cuánto de la vela se ha formado, no simular el reloj exacto.
    """
    vistos: list[int] = []
    for f in fracciones:
        k = max(1, min(total, int(round(total * f))))
        if k not in vistos:
            vistos.append(k)
    return vistos

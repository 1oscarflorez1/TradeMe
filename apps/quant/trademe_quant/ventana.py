"""La trayectoria de una decisión: qué velas le tocan desde que se tomó hasta que vence.

Es la **única definición** de la ventana de evaluación. La usan el evaluador de desenlaces
(`db.evaluate_snapshot_outcomes`, real y sombra), el filtro de reproducibilidad
(`evaluacion.veredictos`) y el contador de decisiones bloqueadas. Si cada uno la reconstruyera a su
manera, podrían discrepar sin que nada fallase — y verificador y verificado ya compartieron un
defecto una vez.

El fallo que corrige (13 sep 2026)
-----------------------------------
Hasta 0.71.1 la ventana eran las velas con `captured_at < ts <= captured_at + h·periodo`. Una
decisión capturada el día D a las 00:00:15 **excluía la propia vela D**, porque esa vela abre a las
00:00:00. La trayectoria en vivo empezaba en D+1; la del backtest para esa misma decisión —tomada
sobre la vela cerrada D−1, con entrada en su cierre— empieza en D.

**Se ignoraban las primeras 24 horas de cada operación diaria.** En cualquier temporalidad se
perdía la primera vela, 1/h del horizonte, pero solo en 1d eso es un día entero, y 1d es lo único
que opera.

Medido sobre el histórico de 1d: en torno al **40 % de las operaciones cambian de resultado** entre
una regla y otra, y la expectancy neta se mueve hasta **±0,03 R** por clave —SOLUSDT:1d de +0,108 a
+0,083—, sin un signo constante. Es del orden de la ventaja que se estaba midiendo. Mientras tanto,
**la decisión en vivo coincidía con la del backtest en 31 de 32 velas diarias**: lo que divergía no
era qué se decidía, sino cómo se medía después.

Por qué no basta con incluir la vela de captura entera
-------------------------------------------------------
Excluirla tenía una razón: sus máximos y mínimos anteriores a la captura no pertenecen a la
operación. Una decisión capturada a las 14:22 no puede ganar ni perder por lo que el precio hizo a
las 09:00. Incluir la vela entera lo contaría.

Así que la vela de captura se recorre con **velas más finas posteriores a la captura** —ver
`FINA`—, y a partir de la siguiente, con las de su temporalidad. Se pierde como mucho un periodo
fino (una hora en 1d) en vez de un periodo entero, y no entra nada anterior a la decisión.

La vela de captura cuenta como **la primera de las h**, igual que en el backtest: la trayectoria es
el resto de D más las h−1 velas siguientes, y un «timeout» cierra al cierre de la vela D+h−1.
"""

from __future__ import annotations

from bisect import bisect_left, bisect_right
from typing import Any, NamedTuple

from .market.normalize import INTERVAL_MS

Vela = tuple[float, float, float]  # (high, low, close)

#: Con qué temporalidad se recorre el resto de la vela en la que se capturó la decisión.
#:
#: Se elige la mayor que deja la pérdida por debajo de un periodo fino razonable y que está
#: guardada para todos los símbolos de Binance. Todas las de la derecha están alineadas con la época
#: Unix —abren en múltiplos exactos de su duración—, lo que permite saber cuántas deberían existir
#: sin consultarlo. `1m` no tiene nada más fino: se pierde el resto del minuto, como hasta ahora.
FINA: dict[str, str | None] = {
    "1w": "4h",
    "1d": "1h",
    "4h": "15m",
    "1h": "5m",
    "30m": "1m",
    "15m": "1m",
    "5m": "1m",
    "1m": None,
}


class Trayectoria(NamedTuple):
    """Las velas que recorre una decisión y si están todas las que le corresponden."""

    #: Resto de la vela de captura en velas finas, seguido de las h−1 velas siguientes.
    velas: list[Vela]
    #: `True` si no falta ninguna: todas las finas del resto y las h−1 siguientes. Solo con ella
    #: completa puede declararse un «timeout»; un toque de objetivo o stop vale igualmente.
    completa: bool
    #: Apertura de la vela en la que se capturó la decisión.
    apertura_captura_ms: int
    #: Cierre de la última vela de la ventana, `apertura_captura + h·periodo`.
    cierre_ms: int


def trayectoria(
    captured_ms: int,
    periodo_ms: int,
    h: int,
    gruesa_t: list[int],
    gruesa_v: list[Vela],
    fina_ms: int | None,
    fina_t: list[int],
    fina_v: list[Vela],
) -> Trayectoria | None:
    """La trayectoria de una decisión, a partir de sus series ya cargadas y ordenadas.

    `gruesa_*` son las velas de la temporalidad de la decisión y `fina_*` las de la temporalidad con
    la que se recorre el resto de la vela de captura. Basta con que cubran la ventana; pueden ser la
    serie entera.

    La apertura de la vela de captura se ancla en la **fase de la propia serie**, no en múltiplos de
    la época: las velas semanales de Binance abren en lunes y la época Unix empezó en jueves. Sin
    ninguna vela gruesa no hay de dónde anclarla, y se devuelve `None` en vez de suponer.
    """
    if periodo_ms <= 0 or h < 1 or not gruesa_t:
        return None
    fase = gruesa_t[0]
    apertura = fase + ((captured_ms - fase) // periodo_ms) * periodo_ms
    fin_captura = apertura + periodo_ms

    resto: list[Vela] = []
    finas_esperadas = 0
    if fina_ms:
        # Primera vela fina que abre en la captura o después: las anteriores contienen precio de
        # antes de decidir. Las finas están alineadas con la época, así que basta con redondear.
        primera = -(-captured_ms // fina_ms) * fina_ms
        finas_esperadas = max(0, -(-(fin_captura - primera) // fina_ms))
        resto = fina_v[bisect_left(fina_t, captured_ms) : bisect_left(fina_t, fin_captura)]

    ultima_siguiente = apertura + (h - 1) * periodo_ms
    siguientes = gruesa_v[
        bisect_right(gruesa_t, apertura) : bisect_right(gruesa_t, ultima_siguiente)
    ]

    return Trayectoria(
        velas=list(resto) + list(siguientes),
        completa=len(resto) == finas_esperadas and len(siguientes) == h - 1,
        apertura_captura_ms=apertura,
        cierre_ms=apertura + h * periodo_ms,
    )


def desenlace(
    direction: str, entry: float, stop: float, take_profit: float, tray: Trayectoria | None
) -> dict[str, Any] | None:
    """El desenlace de una decisión sobre su trayectoria, o `None` si aún no puede cerrarse.

    La regla de cierre de siempre, deliberadamente asimétrica: un toque de objetivo o de stop es
    **definitivo** aunque falten velas —el precio estuvo ahí y eso ya no cambia—, pero un «timeout»
    solo vale con la trayectoria **completa**. Cerrar por tiempo con parte de la ventana no
    significa que la operación no fuera a ninguna parte: significa que aún no se le dio su tiempo.

    El R que devuelve es **bruto**: el coste se descuenta al leer (`costes.neto`), no al escribir.
    """
    from .backtest import evaluate_trade

    if tray is None or not tray.velas:
        return None
    res = evaluate_trade(
        direction,
        entry,
        stop,
        take_profit,
        [v[0] for v in tray.velas],
        [v[1] for v in tray.velas],
        [v[2] for v in tray.velas],
    )
    if res["result"] == "timeout" and not tray.completa:
        return None
    return res


def fina_de(interval: str) -> tuple[str | None, int | None]:
    """La temporalidad fina de `interval` y su duración, si la tiene y es conocida."""
    fina = FINA.get(interval)
    if fina is None or fina not in INTERVAL_MS:
        return None, None
    return fina, INTERVAL_MS[fina]

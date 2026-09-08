"""Gestión de la salida: breakeven, trailing por ATR y cierre por decaimiento de la señal.

Por qué esta palanca y no otra
-------------------------------
Los tres estudios de alfa —funding, precio y macro; 96 pruebas— dijeron lo mismo: **no aparece
ventaja en la entrada**. Filtrar entradas de un motor sin ventaja no crea ventaja, solo reparte la
misma nada entre menos operaciones.

La gestión de la salida es distinta en un sentido concreto: **no depende de acertar más veces**.
Redistribuye lo que ya ocurre dentro de cada operación. Eso no la hace mágica —tampoco crea ventaja
de la nada— pero sí la convierte en la única palanca que los tres estudios no tocaron.

Dónde está el margen, medido antes de diseñar nada
---------------------------------------------------
Sobre las 1.416 operaciones de 1d, con la distribución de excursión favorable máxima (MFE):

=============  =====  ==========  ================================================
desenlace         n   R medio     qué dice
=============  =====  ==========  ================================================
stop             621    −1,005    solo el **6,6 %** llegó a +1 R antes de morir
take-profit      209    +2,000    MFE mediano 2,30 R: deja poco sobre la mesa
timeout          586    +0,332    el **48,5 %** llegó a +1 R; los ganadores cobran
                                  +0,63 R con un MFE mediano de **+1,13 R**
=============  =====  ==========  ================================================

La lectura es inequívoca: **el breakeven tiene poco que salvar** —41 operaciones de 621— y **los
timeouts son el 41 % de todo y devuelven la mitad de su mejor momento**. Ahí es donde puede haber
algo, y por eso el trailing y la salida por señal se prueban con más ganas que el breakeven.

El look-ahead que hay que evitar, y cómo
-----------------------------------------
Es el error que daría un resultado espectacular y falso. En 1d una vela es un día entero y **no se
sabe si el máximo ocurrió antes o después del mínimo**. Mover el stop con el máximo de la vela `t` y
después comprobar el mínimo de esa misma vela `t` sería asumir un orden que nadie conoce, y siempre
el orden favorable.

La regla aquí es la del resto del proyecto —peor caso—: en cada vela se comprueba **primero** si el
stop vigente se toca, y **solo después** se actualiza el stop con esa vela ya cerrada. El stop que
protege la vela `t` se calculó con información hasta `t−1`. Hay un test que lo fija con una vela
construida para que las dos convenciones den resultados distintos.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class PlanSalida:
    """Qué gestión se aplica una vez abierta la operación. Todo desactivado = comportamiento actual.

    Los valores van en **R**, no en precio ni en ATR, para que signifiquen lo mismo en cualquier
    símbolo y temporalidad: 1 R es siempre `atr_stop_mult × ATR` en el momento de entrar.
    """

    #: Mover el stop a la entrada al alcanzar esta ganancia flotante. `None` lo desactiva.
    breakeven_r: float | None = None
    #: Ganancia flotante a partir de la cual empieza a arrastrarse el stop. `None` lo desactiva.
    trailing_desde_r: float | None = None
    #: Distancia del arrastre, por detrás del mejor precio alcanzado.
    trailing_distancia_r: float = 1.0
    #: Medir esa distancia con el ATR **corriente** en vez de con el de la entrada.
    #:
    #: 1 R es `atr_stop_mult × ATR` **en el momento de entrar**, así que una distancia en R ya es
    #: una distancia en ATR — congelada. Con esta bandera el arrastre se adapta a la volatilidad que
    #: haya en cada momento: se aleja cuando el mercado se agita y se acerca cuando se calma.
    #:
    #: Son dos hipótesis distintas y por eso se miden como dos configuraciones, no como un parámetro
    #: que alguien pueda ajustar hasta que salga bien.
    trailing_usa_atr_corriente: bool = False
    #: Renunciar al take-profit fijo y dejar que el arrastre decida cuándo salir.
    #:
    #: Con un TP a 2 R el arrastre solo puede actuar **por debajo** de ese techo, así que solo
    #: puede cortar: medido, corta 32 operaciones que iban a TP —a −1,41 R cada una— para salvar
    #: 29 stops a +1,27 R. La única forma de que tenga algo que capturar es quitarle el techo.
    sin_take_profit: bool = False
    #: Cerrar cuando la señal del ensemble deja de apoyar la dirección de la operación.
    salida_por_senal: bool = False
    #: Umbral por debajo del cual se considera que la señal ya no apoya. En [0, 1].
    umbral_senal: float = 0.0

    @property
    def activo(self) -> bool:
        """¿Hace algo este plan? Si no, `evaluate_trade` toma el camino de siempre."""
        return (
            self.breakeven_r is not None
            or self.trailing_desde_r is not None
            or self.salida_por_senal
            or self.sin_take_profit
        )


#: El plan que reproduce exactamente el comportamiento anterior a 0.69.0.
SIN_GESTION = PlanSalida()


def nivel_breakeven(entry: float, direccion: str, coste_r: float, risk: float) -> float:
    """El stop de breakeven, que no es la entrada sino la entrada **más el coste**.

    Salir «a cero» en el precio de entrada deja una pérdida del tamaño de la comisión. Poner el stop
    justo donde el resultado neto es cero cuesta lo mismo y evita que un mecanismo pensado para
    proteger acabe produciendo una fila de pérdidas pequeñas.
    """
    d = 1.0 if direccion == "LONG" else -1.0
    return entry + d * coste_r * risk


def stop_arrastrado(
    mejor_precio: float,
    direccion: str,
    distancia_r: float,
    risk: float,
    factor_atr: float = 1.0,
) -> float:
    """Stop a `distancia_r` por detrás del mejor precio alcanzado hasta la vela anterior.

    `factor_atr` es `ATR corriente / ATR de entrada`, y vale 1 salvo que el plan pida adaptar la
    distancia a la volatilidad del momento.
    """
    d = 1.0 if direccion == "LONG" else -1.0
    return mejor_precio - d * distancia_r * risk * factor_atr


def stop_vigente(
    plan: PlanSalida,
    direccion: str,
    entry: float,
    stop_inicial: float,
    mejor_r: float,
    mejor_precio: float,
    coste_r: float,
    risk: float,
    factor_atr: float = 1.0,
) -> float:
    """El stop que protege la próxima vela, dado lo que ha pasado hasta la anterior.

    Nunca afloja: se queda con el más protector entre el inicial, el breakeven y el arrastrado. Un
    stop que retrocediera convertiría la gestión en un mecanismo para perder más, que es
    precisamente lo contrario de lo que se busca.
    """
    d = 1.0 if direccion == "LONG" else -1.0
    candidatos = [stop_inicial]

    if plan.breakeven_r is not None and mejor_r >= plan.breakeven_r:
        candidatos.append(nivel_breakeven(entry, direccion, coste_r, risk))

    if plan.trailing_desde_r is not None and mejor_r >= plan.trailing_desde_r:
        candidatos.append(
            stop_arrastrado(
                mejor_precio,
                direccion,
                plan.trailing_distancia_r,
                risk,
                factor_atr if plan.trailing_usa_atr_corriente else 1.0,
            )
        )

    # El más protector: el más alto en LONG, el más bajo en SHORT.
    return max(candidatos) if d > 0 else min(candidatos)


def senal_apoya(valor: float, direccion: str, umbral: float) -> bool:
    """¿La señal del ensemble sigue apoyando esta dirección?

    `valor` es el `net` del ensemble en esa vela, en [−1, +1]. Se compara con un umbral con signo
    para que «dejar de apoyar» signifique lo mismo en largo y en corto.
    """
    return valor >= umbral if direccion == "LONG" else valor <= -umbral

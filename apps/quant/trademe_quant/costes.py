"""Lo que cuesta operar, en las mismas unidades en que se mide todo lo demás.

Por qué hacía falta
--------------------
El backtest nunca modeló comisiones. Medido el 5-sep-2026 sobre años de histórico y ~2.000
operaciones por clave, la expectancy **bruta** del ensemble es ≈0 en todas las temporalidades: de
−0,020 R en 15m a +0,037 R en ETHUSDT:1h. Sobre esa base, cualquier coste la vuelve negativa.

Y no es un coste pequeño, porque **`1 R = atr_stop_mult × ATR`**: cuanto más corta la temporalidad,
menos vale 1 R en dinero y más pesa la comisión sobre él. En BTCUSDT:15m, 1 R son unos **0,40 % del
precio**, así que un round-trip del 0,12 % se lleva **0,3 R por operación**. En 1d, donde 1 R son
6,6 %, el mismo round-trip cuesta 0,018 R.

El daño escala inversamente con la temporalidad — justo donde más opera la plataforma.

La consecuencia que obliga a este hito: **todos los listones de gobierno estaban calibrados en
bruto** (cuarentena en −0,15 R, promoción en +0,05 R, meta-modelo, Fundamental Score). Exigir
+0,05 R en 15m cuando la comisión se lleva 0,3 no significa nada.

Cómo se calcula
----------------
`risk = |entry − stop|` **ya es 1 R expresado en precio**, así que no hace falta el ATR aquí: el
coste en R es el coste en precio dividido por ese riesgo. Es exacto, no una aproximación, y sigue
siendo correcto si algún día cambia `atr_stop_mult`.

Se cobra el **round-trip**: abrir y cerrar. Y el deslizamiento se cuenta también en las dos patas,
que es lo prudente — en la de salida suele ser peor, porque un stop se ejecuta cuando el mercado va
en contra.
"""

from __future__ import annotations

from typing import Any

#: Parámetros de Binance USDT-M Futuros, que es el mercado sobre el que se decidió medir.
#: Comisión por orden, en porcentaje del nocional.
TAKER_PCT = 0.05
MAKER_PCT = 0.02
#: Deslizamiento estimado por orden. No es una comisión: es la diferencia entre el precio que se
#: pide y el que se consigue. Se aplica en las dos patas.
SLIPPAGE_PCT = 0.01


def round_trip_pct(
    modo: str = "taker",
    taker_pct: float = TAKER_PCT,
    maker_pct: float = MAKER_PCT,
    slippage_pct: float = SLIPPAGE_PCT,
) -> float:
    """Coste de abrir **y** cerrar una posición, en porcentaje del nocional.

    Con los parámetros por defecto: `2 × (0,05 + 0,01) = 0,12 %` en taker y `0,06 %` en maker.
    """
    por_orden = maker_pct if modo == "maker" else taker_pct
    return 2.0 * (por_orden + slippage_pct)


def coste_en_r(entry: float, stop: float, pct: float) -> float:
    """El coste de una operación medido en unidades de riesgo.

    `|entry - stop|` es 1 R en precio, así que dividir por él convierte el porcentaje en R sin pasar
    por el ATR. Devuelve 0 si el riesgo es nulo: sin distancia al stop no hay R que valga, y
    inventar un coste infinito no ayudaría a nadie.
    """
    riesgo = abs(entry - stop)
    if riesgo <= 0 or pct <= 0:
        return 0.0
    return (pct / 100.0) * abs(entry) / riesgo


def desde_config(config: dict[str, Any] | None) -> float:
    """Round-trip en porcentaje según la sección `costs` del ensemble. Sin ella, **cero**.

    El cero por defecto es deliberado: mantiene el comportamiento anterior para quien no haya
    configurado nada, y hace que la diferencia bruto/neto sea siempre atribuible a una decisión
    explícita y no a un valor que alguien puso por ahí.
    """
    if not config:
        return 0.0
    costs = config.get("costs") or {}
    if not costs or not costs.get("enabled", False):
        return 0.0
    return round_trip_pct(
        modo=str(costs.get("mode", "taker")),
        taker_pct=float(costs.get("taker_pct", TAKER_PCT)),
        maker_pct=float(costs.get("maker_pct", MAKER_PCT)),
        slippage_pct=float(costs.get("slippage_pct", SLIPPAGE_PCT)),
    )


def neto(
    r_bruto: float | None, entry: float | None, stop: float | None, pct: float
) -> float | None:
    """El R **neto** de una decisión ya guardada. `None` si falta algo para calcularlo.

    El valor de la base de datos sigue siendo bruto y no se reescribe: hacerlo mezclaría dos reglas
    en la misma columna, que es el error que este proyecto ya arrastra desde M10.5 y que obligó a
    filtrar por reproducibilidad. El coste se descuenta **al leer**, y así cambiar la comisión no
    exige recalcular ningún histórico.
    """
    if r_bruto is None or entry is None or stop is None:
        return None
    return float(r_bruto) - coste_en_r(float(entry), float(stop), pct)

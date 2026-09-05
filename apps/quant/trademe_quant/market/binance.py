from __future__ import annotations

import json
import urllib.parse
import urllib.request
from typing import Any

REST_BASE = "https://api.binance.com/api/v3/klines"


def fetch_klines(
    symbol: str,
    interval: str,
    limit: int = 500,
    *,
    start_ms: int | None = None,
    end_ms: int | None = None,
    base_url: str = REST_BASE,
    timeout: float = 10.0,
) -> list[list[Any]]:
    """Descarga klines por REST. Datos públicos de Binance (sin clave).

    `start_ms` y `end_ms` acotan un tramo concreto del pasado, que es lo que hace falta para
    rellenar un hueco: sin ellos Binance devuelve siempre lo más reciente y no hay forma de pedir
    el trozo que falta.

    Ojo: esto no alarga la ventana de nadie. Sigue habiendo un máximo de 1000 velas por petición y
    quien quiera más historia tendrá que paginar — que es otra conversación, y cara, porque el
    backtest crece con el cuadrado del número de velas.
    """
    args: dict[str, Any] = {"symbol": symbol.upper(), "interval": interval, "limit": limit}
    if start_ms is not None:
        args["startTime"] = int(start_ms)
    if end_ms is not None:
        args["endTime"] = int(end_ms)
    url = f"{base_url}?{urllib.parse.urlencode(args)}"
    with urllib.request.urlopen(url, timeout=timeout) as resp:  # noqa: S310 - host fijo
        payload = json.loads(resp.read().decode("utf-8"))
    return [list(row) for row in payload]


#: Velas por petición: el máximo que devuelve Binance de una vez.
POR_PETICION = 1000

#: Ventana por defecto para backtest, calibración y optimización.
#:
#: Elegido midiendo, no a ojo. Con 1.000 velas —el tope de una petición— el hold-out del optimizador
#: eran **25 operaciones**, justo en el mínimo que exige `promocion.MIN_TRADES_HOLDOUT`; con 20.000
#: son **446**. Y el coste, ya linealizado el backtest, es de unos 6,4 minutos para el piloto
#: completo de 20 claves: menos de lo que tardaba antes con 1.000 velas.
#:
#: Medido el 5-sep-2026 sobre BTCUSDT:15m con 40 trials:
#:
#: | velas | días | una optimización | piloto | hold-out |
#: |---|---|---|---|---|
#: | 1.000 | 10 | 1,7 s | 0,6 min | 25 |
#: | 10.000 | 104 | 10,0 s | 3,3 min | 232 |
#: | 20.000 | 208 | 19,3 s | 6,4 min | 446 |
#:
#: Se expresa en velas y no en días porque lo que decide si una medición vale es el número de
#: observaciones, no el calendario. En temporalidades largas Binance dará menos y la paginación se
#: detendrá sola, que es la respuesta correcta.
VELAS_POR_DEFECTO = 20_000


def historico(
    symbol: str,
    interval: str,
    objetivo: int,
    *,
    base_url: str = REST_BASE,
    timeout: float = 10.0,
) -> list[list[Any]]:
    """Las últimas `objetivo` velas, paginando hacia atrás.

    `fetch_klines` topa en 1.000 por petición, y esas 1.000 velas eran toda la ventana con la que
    se optimizaba: en 15m, diez días. De ahí salían hold-outs de 11 a 32 operaciones, con los que
    ningún criterio de promoción puede distinguir una mejora de una racha — el guardia de 0.54.0
    frenaba el 100 % de las promociones y tenía razón en hacerlo.

    Paginar es barato; lo caro es lo que se hace con las velas. Por eso esto llega **después** de
    linealizar el backtest (0.59.0): con el coste cuadrático anterior, veinte mil velas habrían
    llevado el piloto a más de treinta horas. Ahora son unos seis minutos.

    Se detiene sola cuando Binance deja de dar más historia, así que pedir más de lo que existe
    devuelve lo que hay en vez de fallar.
    """
    reunidas: list[list[Any]] = []
    cursor: int | None = None
    while len(reunidas) < objetivo:
        lote = fetch_klines(
            symbol,
            interval,
            limit=min(POR_PETICION, objetivo - len(reunidas)),
            end_ms=None if cursor is None else cursor - 1,
            base_url=base_url,
            timeout=timeout,
        )
        if not lote:
            break
        primero = int(lote[0][0])
        if cursor is not None and primero >= cursor:
            break  # la API dejó de retroceder: se corta en vez de girar en vacío
        reunidas = lote + reunidas
        cursor = primero
    return reunidas

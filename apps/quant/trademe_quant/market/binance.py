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

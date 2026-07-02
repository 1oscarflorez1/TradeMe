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
    base_url: str = REST_BASE,
    timeout: float = 10.0,
) -> list[list[Any]]:
    """Descarga klines por REST. Datos públicos de Binance (sin clave)."""
    params = urllib.parse.urlencode(
        {"symbol": symbol.upper(), "interval": interval, "limit": limit}
    )
    url = f"{base_url}?{params}"
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        payload = json.loads(resp.read().decode("utf-8"))
    return [list(row) for row in payload]

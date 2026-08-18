"""Derivados de Binance: funding, interés abierto y long/short (M11).

Gratis, sin clave y con histórico — esa última parte es la que importa: permite **reconstruir la
serie hacia atrás** y comprobar hipótesis sobre decisiones ya tomadas. La primera que se comprobó
—si el escudo macro habría evitado los 69 cortos de 4h— resultó falsa: el sesgo del periodo era
bajista y los habría reforzado. Las demás fuentes solo existen hacia delante.

Estos son datos de mercado: se conocen en el instante en que ocurren, así que `observed_at` y
`published_at` coinciden. Se guardan los dos igualmente para que leer estas tablas sea siempre la
misma operación y nadie tenga que recordar cuál usar en cada caso.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import UTC, datetime
from typing import Any

from .base import DataProvider, ProviderError, Record

BASE = "https://fapi.binance.com"
TIMEOUT_S = 15


def _get(path: str, params: dict[str, Any]) -> Any:
    query = "&".join(f"{k}={v}" for k, v in params.items() if v is not None)
    url = f"{BASE}{path}?{query}"
    try:
        with urllib.request.urlopen(url, timeout=TIMEOUT_S) as r:  # noqa: S310 - host fijo
            return json.loads(r.read().decode("utf8"))
    except urllib.error.HTTPError as err:
        raise ProviderError(f"{path} respondió {err.code}") from err
    except Exception as err:  # noqa: BLE001
        raise ProviderError(f"{path}: {err}") from err


def _ts(ms: Any) -> datetime:
    return datetime.fromtimestamp(int(ms) / 1000, tz=UTC)


class BinanceFunding(DataProvider):
    """Tasa de financiación: lo que pagan los largos a los cortos (o al revés).

    Es la lectura más directa de si el apalancamiento está cargado a un lado. Un funding alto y
    sostenido significa largos saturados — justo el contexto en que 4h se puso corto 69 veces.
    """

    id = "binance_funding"
    table = "derivatives_metrics"
    cadence_s = 900  # se publica cada 8 h; preguntar cada 15 min basta y sobra

    def __init__(self, symbols: list[str] | None = None, limit: int = 100) -> None:
        self.symbols = symbols or ["BTCUSDT"]
        self.limit = limit

    def fetch(self) -> list[Record]:
        out: list[Record] = []
        for symbol in self.symbols:
            datos = _get("/fapi/v1/fundingRate", {"symbol": symbol, "limit": self.limit})
            for d in datos:
                t = _ts(d["fundingTime"])
                out.append(
                    Record(
                        observed_at=t,
                        published_at=t,
                        value=float(d["fundingRate"]),
                        key="funding_rate",
                        label=symbol,
                        raw={"symbol": symbol},
                    )
                )
        return out

    def backfill(self, symbol: str, desde: datetime, hasta: datetime) -> list[Record]:
        """Histórico entre dos fechas, paginando hacia delante.

        Es lo que permite reconstruir el contexto de decisiones ya tomadas **sin inventar nada**:
        el funding de aquel momento es un hecho registrado, no una estimación de hoy.
        """
        out: list[Record] = []
        cursor = int(desde.timestamp() * 1000)
        fin = int(hasta.timestamp() * 1000)
        vistos: set[int] = set()
        while cursor < fin:
            datos = _get(
                "/fapi/v1/fundingRate",
                {"symbol": symbol, "startTime": cursor, "endTime": fin, "limit": 1000},
            )
            if not datos:
                break
            for d in datos:
                ms = int(d["fundingTime"])
                if ms in vistos:
                    continue
                vistos.add(ms)
                t = _ts(ms)
                out.append(
                    Record(
                        observed_at=t,
                        published_at=t,
                        value=float(d["fundingRate"]),
                        key="funding_rate",
                        label=symbol,
                        raw={"symbol": symbol, "backfill": True},
                    )
                )
            ultimo = int(datos[-1]["fundingTime"])
            if ultimo <= cursor:
                break  # la API dejó de avanzar: se corta en vez de girar en vacío
            cursor = ultimo + 1
        return out


class BinanceOpenInterest(DataProvider):
    """Interés abierto: cuánto dinero hay realmente comprometido en derivados."""

    id = "binance_open_interest"
    table = "derivatives_metrics"
    cadence_s = 900

    def __init__(self, symbols: list[str] | None = None, period: str = "1h") -> None:
        self.symbols = symbols or ["BTCUSDT"]
        self.period = period

    def fetch(self) -> list[Record]:
        out: list[Record] = []
        for symbol in self.symbols:
            datos = _get(
                "/futures/data/openInterestHist",
                {"symbol": symbol, "period": self.period, "limit": 200},
            )
            for d in datos:
                t = _ts(d["timestamp"])
                out.append(
                    Record(
                        observed_at=t,
                        published_at=t,
                        value=float(d["sumOpenInterest"]),
                        key="open_interest",
                        label=symbol,
                        raw={"symbol": symbol, "notional": d.get("sumOpenInterestValue")},
                    )
                )
        return out


class BinanceLongShort(DataProvider):
    """Proporción de cuentas largas frente a cortas: el posicionamiento del minorista."""

    id = "binance_long_short"
    table = "derivatives_metrics"
    cadence_s = 900

    def __init__(self, symbols: list[str] | None = None, period: str = "1h") -> None:
        self.symbols = symbols or ["BTCUSDT"]
        self.period = period

    def fetch(self) -> list[Record]:
        out: list[Record] = []
        for symbol in self.symbols:
            datos = _get(
                "/futures/data/globalLongShortAccountRatio",
                {"symbol": symbol, "period": self.period, "limit": 200},
            )
            for d in datos:
                t = _ts(d["timestamp"])
                out.append(
                    Record(
                        observed_at=t,
                        published_at=t,
                        value=float(d["longShortRatio"]),
                        key="long_short_ratio",
                        label=symbol,
                        raw={"symbol": symbol},
                    )
                )
        return out

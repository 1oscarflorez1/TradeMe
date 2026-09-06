"""Las series con las que se mide, listas para usar y sin descargarlas tres veces por ciclo.

Con la ventana de 1.000 velas daba igual: eran 200 kB y una petición. Con 20.000 no: cada clave son
veinte peticiones y unos nueve segundos, y en un mismo ciclo del piloto las piden el backtest, la
calibración y el optimizador. Sin caché eso son sesenta descargas por ciclo —unos nueve minutos solo
de red— y una presión sobre la API de Binance que no hace falta.

Se cachean las series **ya normalizadas**, no las filas crudas: 20.000 velas crudas ocupan 14 MB y
las tres listas de float que realmente usa el backtest, 1,9 MB. Veinte claves cacheadas pasan así de
280 MB a unos 38.

El TTL por defecto es holgado a propósito. El backtest mide historia, no el presente: media hora de
desfase sobre 208 días no cambia ninguna medición, y evita que un ciclo largo tenga que redescargar
lo que ya trajo.
"""

from __future__ import annotations

import time

from .market.binance import VELAS_POR_DEFECTO, historico
from .market.normalize import normalize_rest_kline

Series = tuple[list[float], list[float], list[float]]
#: Con la apertura delante: la necesitan los vectores que miran la forma de la vela.
SeriesOHLC = tuple[list[float], list[float], list[float], list[float]]

#: Segundos que una serie se considera reutilizable.
TTL_S = 30 * 60
#: Tope de claves en memoria. Con 4 símbolos × 8 temporalidades sobra, y evita que un despliegue con
#: muchos activos vaya llenando la memoria sin que nadie lo mire.
MAX_ENTRADAS = 40

_cache: dict[tuple[str, str, int], tuple[float, Series]] = {}
_cache_ohlc: dict[tuple[str, str, int], tuple[float, SeriesOHLC]] = {}


def series(
    symbol: str, interval: str, velas: int = VELAS_POR_DEFECTO, *, ttl_s: float = TTL_S
) -> Series:
    """`(high, low, close)` de las últimas `velas` barras, con caché de proceso."""
    clave = (symbol.upper(), interval, velas)
    ahora = time.time()
    guardado = _cache.get(clave)
    if guardado is not None and ahora - guardado[0] < ttl_s:
        return guardado[1]

    o, h, lo, c = _descargar(symbol, interval, velas)
    datos: Series = (h, lo, c)
    _cache_ohlc[clave] = (ahora, (o, h, lo, c))
    if len(_cache) >= MAX_ENTRADAS:
        # Fuera la más vieja. Con un tope tan alto esto casi nunca ocurre; está para que «casi
        # nunca» no se convierta en «nunca se comprobó».
        _cache.pop(min(_cache, key=lambda k: _cache[k][0]), None)
    _cache[clave] = (ahora, datos)
    return datos


def series_ohlc(
    symbol: str, interval: str, velas: int = VELAS_POR_DEFECTO, *, ttl_s: float = TTL_S
) -> SeriesOHLC:
    """`(open, high, low, close)` de las últimas `velas` barras.

    La apertura no la necesita el backtest —`decide` solo mira máximos, mínimos y cierres— pero sí
    los vectores que describen la **forma** de la vela: sin ella no se puede separar el cuerpo de
    las mechas. Se cachea aparte para no engordar la entrada que usa el backtest, que es la que se
    pide veinte veces por ciclo.
    """
    clave = (symbol.upper(), interval, velas)
    ahora = time.time()
    guardado = _cache_ohlc.get(clave)
    if guardado is not None and ahora - guardado[0] < ttl_s:
        return guardado[1]

    datos = _descargar(symbol, interval, velas)
    if len(_cache_ohlc) >= MAX_ENTRADAS:
        _cache_ohlc.pop(min(_cache_ohlc, key=lambda k: _cache_ohlc[k][0]), None)
    _cache_ohlc[clave] = (ahora, datos)
    return datos


def _descargar(symbol: str, interval: str, velas: int) -> SeriesOHLC:
    filas = historico(symbol, interval, velas)
    candles = [normalize_rest_kline(symbol, interval, r) for r in filas]
    return (
        [c.open for c in candles],
        [c.high for c in candles],
        [c.low for c in candles],
        [c.close for c in candles],
    )


def limpiar_cache() -> None:
    """Vacía la caché. Para los tests y para forzar una relectura si alguna vez hace falta."""
    _cache.clear()
    _cache_ohlc.clear()

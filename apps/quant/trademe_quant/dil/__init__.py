"""Data Intelligence Layer (M11): prepara datos, no toma decisiones.

Obtiene información de fuentes externas, la valida, la normaliza y la guarda **con su fecha de
conocimiento**. Nada de lo que hay aquí influye en una sola señal: el `fundamental_score` es M12.

Esa separación es deliberada. Registrar primero y decidir después es lo que permitirá medir si el
análisis fundamental aporta algo, en vez de darlo por supuesto.
"""

from __future__ import annotations

from typing import Any

from .base import DataProvider, ProviderError, Record, Scheduler
from .binance_derivs import BinanceFunding, BinanceLongShort, BinanceOpenInterest
from .macro_ecb import ECBMacro, FREDMacro
from .sentiment_fng import FearAndGreed
from .store import as_of, mark_health, store

__all__ = [
    "BinanceFunding",
    "BinanceLongShort",
    "BinanceOpenInterest",
    "DataProvider",
    "ECBMacro",
    "FREDMacro",
    "FearAndGreed",
    "ProviderError",
    "Record",
    "Scheduler",
    "as_of",
    "default_providers",
    "mark_health",
    "run_once",
    "store",
]


def default_providers(symbols: list[str] | None = None) -> list[DataProvider]:
    """Las fuentes de la fase 1: todas gratuitas y solo una necesita registro (FRED)."""
    syms = symbols or ["BTCUSDT"]
    return [
        BinanceFunding(syms),
        BinanceOpenInterest(syms),
        BinanceLongShort(syms),
        FearAndGreed(),
        ECBMacro(),
        FREDMacro(),
    ]


#: Planificador compartido entre ciclos del piloto.
#:
#: Sin esto, cada llamada crearía uno nuevo y **todas las fuentes tocarían siempre**: el BCE se
#: consultaría cada pocos minutos en vez de dos veces al día, y la cadencia declarada por cada
#: proveedor sería decorativa. Vive en memoria a propósito — al reiniciar se vuelve a preguntar
#: una vez, que es inofensivo y evita tener que persistir estado.
_SCHEDULER = Scheduler()


def run_once(
    dsn: str,
    providers: list[DataProvider] | None = None,
    scheduler: Scheduler | None = None,
) -> list[str]:
    """Una pasada por todas las fuentes que toquen. Devuelve un registro legible.

    **Degradación grácil**: cada fuente se aísla. Si una falla o está caída, se anota en
    `data_sources` y las demás siguen. Una fuente ausente nunca debe convertirse en un dato
    inventado ni en un ciclo perdido.
    """
    provs = providers if providers is not None else default_providers()
    sched = scheduler if scheduler is not None else _SCHEDULER
    log: list[str] = []
    for p in provs:
        if not p.available:
            log.append(f"{p.id}: apagado ({p.unavailable_reason})")
            continue
        if not sched.due(p):
            continue
        try:
            crudos = p.fetch()
            validos = p.validate(crudos)
            guardados = store(dsn, p, validos)
            mark_health(dsn, p.id, guardados)
            sched.mark(p)
            descartados = len(crudos) - len(validos)
            extra = f" ({descartados} descartados por validación)" if descartados else ""
            log.append(f"{p.id}: {guardados} observaciones{extra}")
        except Exception as err:  # noqa: BLE001 - una fuente caída no tumba el ciclo
            mark_health(dsn, p.id, 0, str(err))
            sched.mark(p)  # se respeta su cadencia también al fallar: no se martillea una API caída
            log.append(f"{p.id}: ERROR {err}")
    return log


def backfill_funding(dsn: str, symbol: str, desde: Any, hasta: Any) -> int:
    """Reconstruye el histórico de funding entre dos fechas.

    Es lo que permitió responder si el escudo macro habría evitado los 69 cortos de 4h. La
    respuesta, medida el 18 de agosto de 2026, fue **no**: el sesgo reconstruido era bajista en las
    60 observaciones del periodo y habría reforzado esos cortos. El funding de aquel momento es un
    hecho registrado por Binance, no una estimación hecha hoy — y por eso la respuesta vale.
    """
    p = BinanceFunding([symbol])
    registros = p.validate(p.backfill(symbol, desde, hasta))
    n = store(dsn, p, registros)
    mark_health(dsn, p.id, n)
    return n


def asegurar_cobertura_funding(
    dsn: str, symbols: list[str], window_days: int = 90, ahora: Any = None
) -> list[str]:
    """Rellena el histórico de funding que le falte a cada símbolo. Sin que nadie se acuerde.

    El backfill existía desde M11 y funcionaba; lo que no existía era quien lo llamara por su
    cuenta. Cuando se añadieron los activos nuevos se les reconstruyó el histórico a mano y a
    BTCUSDT no, porque el sondeo ya le daba datos: acabó con **120 observaciones repartidas por 40
    de los 90 días** de ventana frente a las 270 de los demás, y su tercil de referencia quedó en
    otro sitio. Con el mismo funding real, unos símbolos penalizaban el largo y BTCUSDT no.

    Es el mismo fallo que el de `default_providers(["BTCUSDT"])` cableado, y por la misma razón: la
    cobertura dependía de la memoria de alguien. Aquí deja de depender — se comprueba y se repara
    en cada ciclo, que es lo único que no se olvida.

    Solo pide lo que falta: si la ventana ya está cubierta no se llama a Binance.
    """
    from datetime import UTC, datetime, timedelta

    from ..fundamental import MIN_COBERTURA, cobertura, funding_window

    momento = ahora or datetime.now(tz=UTC)
    log: list[str] = []
    for symbol in symbols:
        sym = symbol.upper()
        try:
            muestras = funding_window(dsn, sym, momento, window_days)
            cob = cobertura([f for f, _ in muestras], window_days)
            if cob >= MIN_COBERTURA:
                continue
            desde = momento - timedelta(days=window_days)
            n = backfill_funding(dsn, sym, desde, momento)
            nuevas = funding_window(dsn, sym, momento, window_days)
            ahora_cob = cobertura([f for f, _ in nuevas], window_days)
            log.append(
                f"{sym}: cobertura {cob:.0%} -> {ahora_cob:.0%} ({n} observaciones reconstruidas)"
            )
        except Exception as err:  # noqa: BLE001 - un símbolo sin perpetuo no tumba a los demás
            log.append(f"{sym}: no se pudo reconstruir el funding ({err})")
    return log

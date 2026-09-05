"""La ventana deja de topar en las 1.000 velas de una petición."""

from __future__ import annotations

from typing import Any

from trademe_quant.market import binance


def _lote(desde: int, n: int, paso: int = 900_000) -> list[list[Any]]:
    """Velas sintéticas contiguas a partir de `desde`."""
    return [[desde + i * paso, 1, 2, 0.5, 1.5, 10, desde + (i + 1) * paso - 1] for i in range(n)]


def test_pagina_hacia_atras_hasta_reunir_el_objetivo(monkeypatch: Any) -> None:
    pedidas: list[dict[str, Any]] = []
    paso = 900_000
    fin = 100 * paso

    def fake(symbol: str, interval: str, limit: int = 500, **kw: Any) -> list[list[Any]]:
        pedidas.append({"limit": limit, **kw})
        tope = kw.get("end_ms")
        ultimo = fin if tope is None else int(tope)
        primero = ultimo - (limit - 1) * paso
        return _lote(primero, limit, paso)

    monkeypatch.setattr(binance, "fetch_klines", fake)
    filas = binance.historico("BTCUSDT", "15m", 2500)

    assert len(filas) == 2500, "debe reunir exactamente lo pedido"
    assert len(pedidas) == 3, "1000 + 1000 + 500"
    assert pedidas[0].get("end_ms") is None, "la primera petición pide lo más reciente"
    # Orden cronológico y sin saltos: lo que espera el backtest.
    tiempos = [int(f[0]) for f in filas]
    assert tiempos == sorted(tiempos)
    assert len(set(tiempos)) == len(tiempos), "no puede repetir velas entre páginas"


def test_se_detiene_cuando_binance_deja_de_dar_historia(monkeypatch: Any) -> None:
    """Pedir más de lo que existe devuelve lo que hay, no un error."""
    llamadas = {"n": 0}

    def fake(symbol: str, interval: str, limit: int = 500, **kw: Any) -> list[list[Any]]:
        llamadas["n"] += 1
        return _lote(0, 300) if llamadas["n"] == 1 else []

    monkeypatch.setattr(binance, "fetch_klines", fake)
    assert len(binance.historico("BTCUSDT", "1d", 5000)) == 300
    assert llamadas["n"] == 2, "una para traer y otra para descubrir que no hay más"


def test_se_corta_si_la_api_no_retrocede(monkeypatch: Any) -> None:
    """Sin este corte, una API que devuelve siempre el mismo tramo pagina para siempre."""
    llamadas = {"n": 0}

    def fake(symbol: str, interval: str, limit: int = 500, **kw: Any) -> list[list[Any]]:
        llamadas["n"] += 1
        return _lote(0, 100)  # siempre el mismo tramo

    monkeypatch.setattr(binance, "fetch_klines", fake)
    binance.historico("BTCUSDT", "15m", 10_000)
    assert llamadas["n"] <= 2

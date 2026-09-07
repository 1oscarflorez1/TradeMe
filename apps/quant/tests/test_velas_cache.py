"""Con 20.000 velas por clave, descargar tres veces por ciclo deja de ser gratis."""

from __future__ import annotations

from typing import Any

from trademe_quant import velas


def _filas(n: int) -> list[list[Any]]:
    return [[i * 900_000, 1, 2, 0.5, 1.5, 10, i * 900_000 + 899_999] for i in range(n)]


def test_la_segunda_llamada_no_vuelve_a_descargar(monkeypatch: Any) -> None:
    """El backtest, la calibración y el optimizador piden lo mismo dentro de un ciclo."""
    descargas = {"n": 0}

    def fake(symbol: str, interval: str, objetivo: int, **kw: Any) -> list[list[Any]]:
        descargas["n"] += 1
        return _filas(50)

    velas.limpiar_cache()
    monkeypatch.setattr(velas, "historico", fake)

    a = velas.series("BTCUSDT", "15m", 50)
    b = velas.series("btcusdt", "15m", 50)  # el símbolo se normaliza a mayúsculas
    assert descargas["n"] == 1
    assert a is b


def test_una_clave_distinta_si_descarga(monkeypatch: Any) -> None:
    descargas = {"n": 0}

    def fake(symbol: str, interval: str, objetivo: int, **kw: Any) -> list[list[Any]]:
        descargas["n"] += 1
        return _filas(50)

    velas.limpiar_cache()
    monkeypatch.setattr(velas, "historico", fake)
    velas.series("BTCUSDT", "15m", 50)
    velas.series("BTCUSDT", "1h", 50)
    velas.series("ETHUSDT", "15m", 50)
    assert descargas["n"] == 3


def test_pasado_el_ttl_se_refresca(monkeypatch: Any) -> None:
    descargas = {"n": 0}

    def fake(symbol: str, interval: str, objetivo: int, **kw: Any) -> list[list[Any]]:
        descargas["n"] += 1
        return _filas(50)

    velas.limpiar_cache()
    monkeypatch.setattr(velas, "historico", fake)
    velas.series("BTCUSDT", "15m", 50)
    velas.series("BTCUSDT", "15m", 50, ttl_s=0)  # caducada
    assert descargas["n"] == 2


def test_la_cache_no_crece_sin_limite(monkeypatch: Any) -> None:
    """Un despliegue con muchos activos no debe ir llenando la memoria sin que nadie lo mire."""

    def fake(symbol: str, interval: str, objetivo: int, **kw: Any) -> list[list[Any]]:
        return _filas(5)

    velas.limpiar_cache()
    monkeypatch.setattr(velas, "historico", fake)
    for i in range(velas.MAX_ENTRADAS + 10):
        velas.series(f"SYM{i}", "15m", 5)
    assert len(velas._cache) <= velas.MAX_ENTRADAS


def test_devuelve_las_tres_series_alineadas(monkeypatch: Any) -> None:
    def fake(symbol: str, interval: str, objetivo: int, **kw: Any) -> list[list[Any]]:
        return _filas(30)

    velas.limpiar_cache()
    monkeypatch.setattr(velas, "historico", fake)
    high, low, close = velas.series("BTCUSDT", "15m", 30)
    assert len(high) == len(low) == len(close) == 30
    assert all(h >= c >= lo for h, lo, c in zip(high, low, close, strict=True))


def test_las_aperturas_van_alineadas_con_las_series(monkeypatch: Any) -> None:
    """Los vectores macro emparejan por instante, así que un desfase de un índice los falsearía."""

    def fake(symbol: str, interval: str, objetivo: int, **kw: Any) -> list[list[Any]]:
        return _filas(30)

    velas.limpiar_cache()
    monkeypatch.setattr(velas, "historico", fake)
    high, _, _ = velas.series("BTCUSDT", "15m", 30)
    t0 = velas.aperturas("BTCUSDT", "15m", 30)
    assert len(t0) == len(high) == 30
    assert t0 == [i * 900_000 for i in range(30)]


def test_las_aperturas_reaprovechan_la_descarga_de_las_series(monkeypatch: Any) -> None:
    """Pedirlas después de las series no puede costar una segunda descarga de 20.000 velas."""
    descargas = {"n": 0}

    def fake(symbol: str, interval: str, objetivo: int, **kw: Any) -> list[list[Any]]:
        descargas["n"] += 1
        return _filas(30)

    velas.limpiar_cache()
    monkeypatch.setattr(velas, "historico", fake)
    velas.series("BTCUSDT", "15m", 30)
    velas.aperturas("BTCUSDT", "15m", 30)
    velas.series_ohlc("BTCUSDT", "15m", 30)
    assert descargas["n"] == 1

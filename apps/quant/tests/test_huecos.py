"""Velas que nunca llegaron: detectarlas y pedir el tramo exacto que falta."""

from __future__ import annotations

from typing import Any

from trademe_quant.huecos import LIMITE_BINANCE, Hueco, rellenar_hueco, tramos_faltantes

MIN = 60_000


def test_una_serie_continua_no_tiene_huecos() -> None:
    assert tramos_faltantes([0, MIN, 2 * MIN, 3 * MIN], MIN) == []


def test_el_tramo_va_de_la_primera_que_falta_a_la_primera_que_esta() -> None:
    """Devuelto así, el rango se puede pedir tal cual sin recalcular nada."""
    huecos = tramos_faltantes([0, 5 * MIN], MIN)
    assert huecos == [(MIN, 5 * MIN)]


def test_varios_huecos_en_la_misma_serie() -> None:
    tiempos = [0, MIN, 4 * MIN, 5 * MIN, 9 * MIN]
    assert tramos_faltantes(tiempos, MIN) == [(2 * MIN, 4 * MIN), (6 * MIN, 9 * MIN)]


def test_serie_desordenada_da_el_mismo_resultado() -> None:
    assert tramos_faltantes([5 * MIN, 0, MIN], MIN) == [(2 * MIN, 5 * MIN)]


def test_menos_de_dos_velas_no_permite_hablar_de_huecos() -> None:
    """Con una sola vela no hay interior que rellenar. Extender la serie es otra cosa."""
    assert tramos_faltantes([0], MIN) == []
    assert tramos_faltantes([], MIN) == []


def test_el_hueco_sabe_cuantas_velas_y_cuantas_peticiones_cuesta() -> None:
    h = Hueco("BTCUSDT", "1m", 0, 2500 * MIN)
    assert h.velas == 2500
    assert h.peticiones == 3  # 1000 + 1000 + 500


def test_un_hueco_pequeno_cuesta_una_peticion() -> None:
    assert Hueco("BTCUSDT", "1m", 0, MIN).peticiones == 1


class _SinkFalso:
    def __init__(self) -> None:
        self.velas: list[Any] = []

    def write(self, candle: Any) -> None:
        self.velas.append(candle)

    def close(self) -> None:
        return None


def test_rellenar_no_escribe_velas_de_fuera_del_hueco(monkeypatch: Any) -> None:
    """Binance devuelve el lote completo aunque se pase de `endTime`; lo de más se descarta.

    Escribir una vela posterior al hueco no rompería nada hoy —el upsert es idempotente— pero
    haría que el recuento de recuperadas dejara de significar lo que dice.
    """
    pedidas: list[dict[str, Any]] = []

    def fake_fetch(symbol: str, interval: str, **kw: Any) -> list[list[Any]]:
        pedidas.append(kw)
        if len(pedidas) > 1:
            return []
        # tres velas dentro del hueco y dos que se salen
        return [[i * MIN, 1, 2, 0.5, 1.5, 10, i * MIN + MIN - 1] for i in range(5)]

    import trademe_quant.market.binance as binance

    monkeypatch.setattr(binance, "fetch_klines", fake_fetch)

    sink = _SinkFalso()
    escritas = rellenar_hueco("dsn-falso", Hueco("BTCUSDT", "1m", 0, 3 * MIN), sink=sink)

    assert escritas == 3
    assert [c.open_time for c in sink.velas] == [0, MIN, 2 * MIN]
    assert pedidas[0]["start_ms"] == 0
    assert pedidas[0]["end_ms"] == 3 * MIN - 1
    assert pedidas[0]["limit"] == LIMITE_BINANCE


def test_rellenar_se_corta_si_la_api_deja_de_avanzar(monkeypatch: Any) -> None:
    """Sin este corte, una API que devuelve siempre la misma vela gira en vacío para siempre."""
    llamadas = {"n": 0}

    def fake_fetch(symbol: str, interval: str, **kw: Any) -> list[list[Any]]:
        llamadas["n"] += 1
        return [[0, 1, 2, 0.5, 1.5, 10, MIN - 1]]  # siempre la misma

    import trademe_quant.market.binance as binance

    monkeypatch.setattr(binance, "fetch_klines", fake_fetch)

    rellenar_hueco("dsn-falso", Hueco("BTCUSDT", "1m", 0, 100 * MIN), sink=_SinkFalso())
    assert llamadas["n"] <= 2

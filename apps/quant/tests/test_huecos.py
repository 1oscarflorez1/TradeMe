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


class _ConexionFalsa:
    """Doble de psycopg: registra los `executemany` y los commits."""

    def __init__(self) -> None:
        self.lotes: list[int] = []
        self.commits = 0
        self.cerrada = False

    def cursor(self) -> Any:
        conexion = self

        class _Cur:
            def __enter__(self) -> Any:
                return self

            def __exit__(self, *_: object) -> None:
                return None

            def executemany(self, sql: str, filas: list[Any]) -> None:
                conexion.lotes.append(len(filas))

        return _Cur()

    def commit(self) -> None:
        self.commits += 1

    def close(self) -> None:
        self.cerrada = True


def _sink_falso(monkeypatch: Any, lote: int) -> tuple[Any, _ConexionFalsa]:
    """`psycopg` no está instalado en el entorno de tests —de ahí los imports perezosos del
    proyecto—, así que se inyecta un módulo falso en su lugar."""
    import sys
    import types

    from trademe_quant.db import PgCandleSink

    conexion = _ConexionFalsa()
    modulo = types.ModuleType("psycopg")
    modulo.connect = lambda *_a, **_k: conexion  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "psycopg", modulo)
    return PgCandleSink("dsn-falso", lote=lote), conexion


def _vela(i: int) -> Any:
    from trademe_quant.market.normalize import Candle

    return Candle("BTCUSDT", "1m", i * MIN, 1.0, 2.0, 0.5, 1.5, 10.0, i * MIN + MIN - 1, True)


def test_el_sink_agrupa_las_velas_en_lotes(monkeypatch: Any) -> None:
    """Un commit por vela eran decenas de miles de viajes por ciclo de relleno."""
    sink, conexion = _sink_falso(monkeypatch, lote=100)
    for i in range(250):
        sink.write(_vela(i))

    assert conexion.lotes == [100, 100], "debe comprometer al llenarse el lote, no al escribir"
    assert conexion.commits == 2


def test_al_cerrar_no_se_queda_nada_sin_escribir(monkeypatch: Any) -> None:
    sink, conexion = _sink_falso(monkeypatch, lote=100)
    for i in range(250):
        sink.write(_vela(i))
    sink.close()

    assert sum(conexion.lotes) == 250, "las 50 de la última tanda no pueden perderse"
    assert conexion.cerrada is True


def test_cerrar_sin_nada_pendiente_no_compromete_de_mas(monkeypatch: Any) -> None:
    sink, conexion = _sink_falso(monkeypatch, lote=100)
    sink.close()

    assert conexion.lotes == []
    assert conexion.commits == 0
    assert conexion.cerrada is True


def test_las_temporalidades_a_rellenar_salen_de_la_base_no_de_una_lista(monkeypatch: Any) -> None:
    """El fallo de 0.56.0: recibía `cfg.intervals` —lo que el piloto decide— en vez de lo guardado.

    Las cinco de esa lista quedaron a cero huecos mientras 1m y 5m acumulaban 118.606 velas
    ausentes. Preguntándoselo a la base, una temporalidad nueva entra sola.
    """
    import sys
    import types

    from trademe_quant.huecos import intervalos_almacenados

    class _Cur:
        def __enter__(self) -> Any:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def execute(self, sql: str, params: Any) -> None:
            assert "candles" in sql

        def fetchall(self) -> list[tuple[str]]:
            # incluye una temporalidad sin duración conocida, que debe quedarse fuera
            return [("1m",), ("5m",), ("15m",), ("1M",)]

    class _Conn:
        def cursor(self) -> Any:
            return _Cur()

        def __enter__(self) -> Any:
            return self

        def __exit__(self, *_: object) -> None:
            return None

    modulo = types.ModuleType("psycopg")
    modulo.connect = lambda *_a, **_k: _Conn()  # type: ignore[attr-defined]
    monkeypatch.setitem(sys.modules, "psycopg", modulo)

    assert intervalos_almacenados("dsn-falso", "BTCUSDT") == ["15m", "1m", "5m"]

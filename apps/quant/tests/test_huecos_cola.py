"""La cola de la serie: las velas que faltan después de la última guardada.

El caso que motivó esto es real y está fijado abajo con sus fechas: el 12-sep-2026 la última vela 1d
guardada de ETHUSDT y SOLUSDT era la del día 9, porque el stack estaba parado a las 00:00 UTC del 11
y del 12. El relleno de 0.70.0 no las veía — no eran huecos interiores— y las dos únicas claves que
operan se quedaban sin poder evaluar sus decisiones.
"""

from __future__ import annotations

import datetime as dt
import sys
import types
from typing import Any

import pytest

from trademe_quant import huecos
from trademe_quant.huecos import (
    MARGEN_CIERRE_MS,
    Hueco,
    cola_de,
    cola_faltante,
    prioridad,
    rellenar,
)

MIN = 60_000
DIA = 86_400_000
SEMANA = 7 * DIA


def _ms(texto: str) -> int:
    return int(dt.datetime.fromisoformat(texto).replace(tzinfo=dt.UTC).timestamp() * 1000)


def _fecha(ms: int) -> dt.datetime:
    return dt.datetime.fromtimestamp(ms / 1000, dt.UTC)


# --- La función pura ----------------------------------------------------------------------------


def test_el_caso_real_del_12_de_septiembre() -> None:
    """Última guardada el 9, ahora el 12 a las 19:04 UTC: faltan las velas del 10 y del 11.

    La del 12 no, porque todavía se está formando: cierra a las 00:00 UTC del 13.
    """
    tramo = cola_faltante(_ms("2026-09-09T00:00:00"), DIA, _ms("2026-09-12T19:04:00"))
    assert tramo == (_ms("2026-09-10T00:00:00"), _ms("2026-09-12T00:00:00"))
    assert (tramo[1] - tramo[0]) // DIA == 2


def test_sin_cola_si_la_ultima_cerrada_ya_esta_guardada() -> None:
    """Con el stack corriendo, lo normal: la última guardada es la última cerrada y no hay nada."""
    assert cola_faltante(_ms("2026-09-11T00:00:00"), DIA, _ms("2026-09-12T19:04:00")) is None


def test_nunca_incluye_la_vela_en_formacion() -> None:
    """Justo en el cierre teórico todavía no vale: hace falta el margen.

    Es lo que impide guardar un precio provisional si el reloj de la máquina adelanta respecto a
    Binance. Pasado el margen, la vela ya entra.
    """
    ultima = _ms("2026-09-10T00:00:00")
    cierre_de_la_siguiente = ultima + 2 * DIA  # la del 11 cierra el 12 a las 00:00
    assert cola_faltante(ultima, DIA, cierre_de_la_siguiente) is None
    assert cola_faltante(ultima, DIA, cierre_de_la_siguiente + MARGEN_CIERRE_MS - 1) is None
    assert cola_faltante(ultima, DIA, cierre_de_la_siguiente + MARGEN_CIERRE_MS) == (
        ultima + DIA,
        ultima + 2 * DIA,
    )


def test_la_semanal_se_ancla_en_la_serie_no_en_la_epoca() -> None:
    """La razón de no redondear la hora a múltiplos del periodo.

    Las velas semanales de Binance abren en **lunes** y la época Unix empezó en **jueves**.
    Redondear `ahora` a múltiplos de siete días daría una vela que empieza en jueves y que Binance
    no tiene.
    Anclando en la última vela guardada, la fase es la de la propia serie.
    """
    ultima = _ms("2026-08-31T00:00:00")  # lunes
    tramo = cola_faltante(ultima, SEMANA, _ms("2026-09-14T00:05:00"))
    assert tramo is not None
    assert _fecha(tramo[0]).strftime("%A") == "Monday"
    assert tramo == (_ms("2026-09-07T00:00:00"), _ms("2026-09-14T00:00:00"))
    # Y lo que habría dado redondear a la época, para dejar escrito por qué no se hace:
    assert _fecha((_ms("2026-09-14T00:05:00") // SEMANA) * SEMANA).strftime("%A") == "Thursday"


def test_con_el_reloj_por_detras_de_la_ultima_vela_no_hay_cola() -> None:
    """Un reloj muy retrasado no puede producir tramos negativos ni pedir el pasado al revés."""
    assert cola_faltante(_ms("2026-09-11T00:00:00"), DIA, _ms("2026-09-10T00:00:00")) is None


def test_un_periodo_no_valido_no_da_cola() -> None:
    assert cola_faltante(0, 0, DIA) is None


# --- El orden de atención -----------------------------------------------------------------------


def test_las_colas_van_primero_y_la_mas_larga_antes() -> None:
    """Una cola de 1d sigue siendo cola hasta 24 h; una de 1m deja de serlo al minuto siguiente."""
    socavon_1m = Hueco("BTCUSDT", "1m", 0, 30_000 * MIN)
    hueco_1h = Hueco("BTCUSDT", "1h", 0, 3 * 3_600_000)
    cola_1m = Hueco("ETHUSDT", "1m", 0, 2 * MIN, es_cola=True)
    cola_1d = Hueco("ETHUSDT", "1d", 0, 2 * DIA, es_cola=True)
    orden = sorted([socavon_1m, hueco_1h, cola_1m, cola_1d], key=prioridad)
    assert orden == [cola_1d, cola_1m, socavon_1m, hueco_1h]


# --- rellenar, de extremo a extremo con base y red simuladas ------------------------------------


class _SinkFalso:
    def __init__(self) -> None:
        self.velas: list[Any] = []

    def write(self, candle: Any) -> None:
        self.velas.append(candle)

    def close(self) -> None:
        return None


def _binance_falso(monkeypatch: Any) -> list[dict[str, Any]]:
    """Devuelve velas contiguas en el rango pedido, hasta el límite, como hace la API real."""
    from trademe_quant.market import binance
    from trademe_quant.market.normalize import interval_ms

    pedidas: list[dict[str, Any]] = []

    def fake_fetch(symbol: str, interval: str, **kw: Any) -> list[list[Any]]:
        pedidas.append({"symbol": symbol, "interval": interval, **kw})
        paso = interval_ms(interval)
        inicio, fin, limite = int(kw["start_ms"]), int(kw["end_ms"]), int(kw["limit"])
        filas: list[list[Any]] = []
        t = inicio
        while t <= fin and len(filas) < limite:
            filas.append([t, 1, 2, 0.5, 1.5, 10, t + paso - 1])
            t += paso
        return filas

    monkeypatch.setattr(binance, "fetch_klines", fake_fetch)
    return pedidas


def test_la_cola_de_1d_se_atiende_aunque_un_socavon_de_1m_agote_el_presupuesto(
    monkeypatch: Any,
) -> None:
    """El orden importa de verdad, no solo en el papel.

    Un socavón de 30.000 velas de 1m cuesta 30 peticiones, más que el presupuesto del ciclo. Con el
    orden de 0.70.0 —los huecos más grandes primero— se lo habría llevado entero y la cola de 1d, la
    de la única temporalidad que opera, habría esperado al ciclo siguiente. Y al otro.
    """
    ahora = _ms("2026-09-12T19:04:00")
    ultima_1d = _ms("2026-09-09T00:00:00")

    def falso_huecos_de(dsn: str, symbol: str, interval: str) -> list[Hueco]:
        if interval == "1m":
            return [Hueco(symbol, "1m", 0, 30_000 * MIN)]
        return []

    def falso_cola_de(dsn: str, symbol: str, interval: str, ahora_ms: int) -> Hueco | None:
        if interval != "1d":
            return None
        tramo = cola_faltante(ultima_1d, DIA, ahora_ms)
        assert tramo is not None
        return Hueco(symbol, "1d", tramo[0], tramo[1], es_cola=True)

    monkeypatch.setattr(huecos, "huecos_de", falso_huecos_de)
    monkeypatch.setattr(huecos, "cola_de", falso_cola_de)
    pedidas = _binance_falso(monkeypatch)
    sink = _SinkFalso()

    log = rellenar(
        "dsn-falso", ["ETHUSDT"], ["1m", "1d"], presupuesto=20, ahora_ms=ahora, sink=sink
    )

    velas_1d = [c for c in sink.velas if c.interval == "1d"]
    assert [_fecha(c.open_time).date().isoformat() for c in velas_1d] == [
        "2026-09-10",
        "2026-09-11",
    ]
    assert pedidas[0]["interval"] == "1d"  # la primera petición del ciclo es la cola
    assert "cola recuperada: ETHUSDT:1d +2" in log


def test_la_cola_nunca_escribe_la_vela_en_formacion(monkeypatch: Any) -> None:
    """Aunque Binance devuelva de más, la vela del 12 —que aún no ha cerrado— no se guarda."""
    ahora = _ms("2026-09-12T19:04:00")

    def falso_cola_de(dsn: str, symbol: str, interval: str, ahora_ms: int) -> Hueco | None:
        tramo = cola_faltante(_ms("2026-09-09T00:00:00"), DIA, ahora_ms)
        assert tramo is not None
        return Hueco(symbol, interval, tramo[0], tramo[1], es_cola=True)

    monkeypatch.setattr(huecos, "huecos_de", lambda *a, **k: [])
    monkeypatch.setattr(huecos, "cola_de", falso_cola_de)
    _binance_falso(monkeypatch)
    sink = _SinkFalso()
    rellenar("dsn-falso", ["SOLUSDT"], ["1d"], ahora_ms=ahora, sink=sink)
    assert all(c.open_time + DIA <= ahora for c in sink.velas)
    assert _ms("2026-09-12T00:00:00") not in {c.open_time for c in sink.velas}


def test_un_simbolo_ilegible_no_tumba_a_los_demas(monkeypatch: Any) -> None:
    """Lo que el comentario siempre prometió y el `return` de 0.70.0 no cumplía."""

    def falso_huecos_de(dsn: str, symbol: str, interval: str) -> list[Hueco]:
        if symbol == "BTCUSDT":
            raise RuntimeError("tabla bloqueada")
        return [Hueco(symbol, interval, 0, 3 * MIN)]

    monkeypatch.setattr(huecos, "huecos_de", falso_huecos_de)
    monkeypatch.setattr(huecos, "cola_de", lambda *a, **k: None)
    _binance_falso(monkeypatch)
    sink = _SinkFalso()

    log = rellenar(
        "dsn-falso", ["BTCUSDT", "ETHUSDT"], ["1m"], ahora_ms=_ms("2026-09-12"), sink=sink
    )

    assert any("BTCUSDT 1m: no se pudieron leer" in linea for linea in log)
    assert {c.symbol for c in sink.velas} == {"ETHUSDT"}
    assert len(sink.velas) == 3


# --- La lectura de la base ----------------------------------------------------------------------


def _psycopg_falso(monkeypatch: Any, maximo: int | None) -> None:
    class _Cur:
        def __enter__(self) -> Any:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def execute(self, sql: str, params: Any) -> None:
            assert "MAX(ts)" in sql and "candles" in sql

        def fetchone(self) -> tuple[int | None]:
            return (maximo,)

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


def test_cola_de_marca_el_tramo_como_cola(monkeypatch: Any) -> None:
    _psycopg_falso(monkeypatch, _ms("2026-09-09T00:00:00"))
    cola = cola_de("dsn-falso", "ETHUSDT", "1d", _ms("2026-09-12T19:04:00"))
    assert cola is not None
    assert cola.es_cola is True
    assert cola.velas == 2


def test_sin_velas_guardadas_no_se_inventa_la_serie(monkeypatch: Any) -> None:
    """Sin una vela de la que anclar la fase, no hay cola: poblar una serie vacía es otro hito."""
    _psycopg_falso(monkeypatch, None)
    assert cola_de("dsn-falso", "ETHUSDT", "1d", _ms("2026-09-12T19:04:00")) is None


@pytest.mark.parametrize("interval", ["1M", "raro"])
def test_una_temporalidad_sin_duracion_fija_no_tiene_cola(monkeypatch: Any, interval: str) -> None:
    _psycopg_falso(monkeypatch, _ms("2026-09-09T00:00:00"))
    assert cola_de("dsn-falso", "ETHUSDT", interval, _ms("2026-09-12T19:04:00")) is None

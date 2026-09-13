"""Lo que el evaluador pide a la base: la ventana acotada en TIEMPO, y desde la captura.

Dos fallos de la misma familia, con semanas de diferencia:

- M10.5 contaba **filas** donde la promesa hablaba de tiempo: `h` velas no son `h` periodos en
  cuanto la ingesta pierde una. Se corrigió acotando la consulta en tiempo.
- Hasta 0.71.1 la consulta empezaba en `ts > captured_at`, que **excluía la vela de captura**. En 1d
  eso eran las primeras 24 horas de cada operación.

La definición de la ventana vive en `ventana.trayectoria`; aquí se comprueba que la base entrega lo
que esa función necesita, ni más ni menos.
"""

from __future__ import annotations

import datetime as dt
from typing import Any

from trademe_quant.db import _trayectoria_de, _velas_sin_duracion

DIA = 86_400_000
HORA = 3_600_000


class _Cursor:
    def __init__(self, conn: _Conn) -> None:
        self._conn = conn

    def __enter__(self) -> _Cursor:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[Any, ...]) -> None:
        self._conn.consultas.append((sql, params))

    def fetchall(self) -> list[Any]:
        interval = self._conn.consultas[-1][1][1]
        return self._conn.filas.get(interval, [])


class _Conn:
    def __init__(self, filas: dict[str, list[Any]] | None = None) -> None:
        self.filas = filas or {}
        self.consultas: list[Any] = []

    def cursor(self) -> _Cursor:
        return _Cursor(self)


def _utc(texto: str) -> dt.datetime:
    return dt.datetime.fromisoformat(texto).replace(tzinfo=dt.UTC)


def test_pide_la_vela_de_captura_y_acota_el_final_en_tiempo() -> None:
    """Las gruesas desde un periodo antes de la captura, para incluir su propia vela, hasta h."""
    conn = _Conn()
    captura = _utc("2026-09-09T00:00:15")
    _trayectoria_de(conn, "ETHUSDT", "1d", captura, 10)

    sql, params = conn.consultas[0]
    assert (
        "ts > %s AND ts <= %s" in sql
    ), "sin cota superior la ventana vuelve a ser «las h que haya»"
    _, interval, desde, hasta = params
    assert interval == "1d"
    assert desde == captura - dt.timedelta(days=1)
    assert hasta == captura + dt.timedelta(days=10)


def test_recorre_el_dia_de_captura_con_velas_de_una_hora_posteriores_a_decidir() -> None:
    conn = _Conn()
    captura = _utc("2026-09-09T14:22:00")
    _trayectoria_de(conn, "ETHUSDT", "1d", captura, 10)

    _, (_, interval, desde, hasta) = conn.consultas[1]
    assert interval == "1h"
    assert desde == captura - dt.timedelta(milliseconds=1)  # la que abre justo al decidir, entra
    assert hasta == captura + dt.timedelta(days=1)


def test_construye_la_trayectoria_con_lo_que_devuelve_la_base() -> None:
    captura = _utc("2026-09-09T00:00:00")
    base = int(_utc("2026-09-08T00:00:00").timestamp() * 1000)
    diarias = [(base + i * DIA, 101.0, 99.0, 100.0) for i in range(11)]
    horas = [(base + DIA + i * HORA, 101.0, 99.0, 100.0) for i in range(24)]
    conn = _Conn({"1d": diarias, "1h": horas})

    tray = _trayectoria_de(conn, "ETHUSDT", "1d", captura, 10)

    assert tray is not None
    assert len(tray.velas) == 24 + 9
    assert tray.completa is True


def test_una_temporalidad_sin_duracion_no_tiene_trayectoria() -> None:
    """`1M` no está en INTERVAL_MS: sin duración no se puede acotar nada, y no se inventa."""
    conn = _Conn()
    assert _trayectoria_de(conn, "BTCUSDT", "1M", _utc("2026-08-01T00:00:00"), 4) is None
    assert conn.consultas == []


def test_sin_duracion_se_conserva_el_comportamiento_anterior() -> None:
    """Las cuatro decisiones en 1M del histórico siguen evaluándose como se evaluaban."""
    conn = _Conn({"1M": [(101.0, 99.0, 100.0)] * 2})
    velas = _velas_sin_duracion(conn, "BTCUSDT", "1M", _utc("2026-08-01T00:00:00"), 4)
    sql, params = conn.consultas[0]
    assert "LIMIT" in sql and "ts <=" not in sql
    assert params[-1] == 4
    assert len(velas) == 2

"""El contador de decisiones que nunca se evaluarán, y el límite de ventana que lo engañaba.

Hasta 0.71.1 no tenía ni un test, y así se coló el fallo: contaba como «perdida para siempre» una
decisión cuya última vela aún se estaba formando. El 12-sep-2026, recién desplegado 0.71.0, marcaba
`BNBUSDT:4h` con 14 velas de 15; la que faltaba era la de las 20:00 de ese mismo día.
"""

from __future__ import annotations

import datetime as dt
import sys
import types
from typing import Any

from trademe_quant.db import bloqueadas_por_hueco, ventana_cerrada
from trademe_quant.huecos import MARGEN_CIERRE_MS

H4 = 4 * 3_600_000
DIA = 86_400_000


def _dt(texto: str) -> dt.datetime:
    return dt.datetime.fromisoformat(texto).replace(tzinfo=dt.UTC)


def _ms(texto: str) -> int:
    return int(_dt(texto).timestamp() * 1000)


# --- La función pura ----------------------------------------------------------------------------


def test_el_caso_real_de_bnb_en_4h_no_esta_perdido_todavia() -> None:
    """Capturada el 10 a las 08:00, 15 velas de 4h: la ventana vence el 12 a las 20:00.

    Pero su última vela abre justo a las 20:00 y no cierra hasta las 00:00 del 13. A las 21:18 del
    12 —cuando el contador la daba por perdida— esa vela estaba simplemente en camino.
    """
    capturada = _ms("2026-09-10T08:00:00")
    assert ventana_cerrada(capturada, H4, 15, _ms("2026-09-12T21:18:00")) is False
    assert ventana_cerrada(capturada, H4, 15, _ms("2026-09-13T00:00:00")) is False  # sin margen aún
    assert ventana_cerrada(capturada, H4, 15, _ms("2026-09-13T00:00:00") + MARGEN_CIERRE_MS) is True


def test_en_1d_el_aviso_falso_habria_durado_un_dia_entero() -> None:
    """La razón de que esto importe ahora: 1d es la única temporalidad que opera.

    Con la regla antigua (`ahora > captured_at + h·periodo`) una decisión de 1d capturada a las
    00:05 se daba por perdida desde las 00:05 del día 10 hasta que su última vela cerraba, un día
    después. Cada decisión, cada vez.
    """
    capturada = _ms("2026-09-01T00:05:00")
    vencida_regla_antigua = _ms("2026-09-11T00:06:00")
    assert vencida_regla_antigua > capturada + 10 * DIA  # la regla antigua ya la contaba
    assert ventana_cerrada(capturada, DIA, 10, vencida_regla_antigua) is False
    assert ventana_cerrada(capturada, DIA, 10, _ms("2026-09-12T00:07:00")) is True


def test_el_margen_es_el_mismo_que_el_del_relleno_de_la_cola() -> None:
    """Si el contador y el relleno usaran márgenes distintos, discreparían sobre la misma vela."""
    capturada = _ms("2026-09-10T08:00:00")
    limite = capturada + 15 * H4 + H4 + MARGEN_CIERRE_MS
    assert ventana_cerrada(capturada, H4, 15, limite - 1) is False
    assert ventana_cerrada(capturada, H4, 15, limite) is True


# --- El contador, con la base simulada ----------------------------------------------------------


def _psycopg_falso(
    monkeypatch: Any, pendientes: list[tuple[str, str, dt.datetime]], velas: int
) -> list[str]:
    """Una base que devuelve esas decisiones pendientes y `velas` velas en cualquier ventana."""
    consultas: list[str] = []

    class _Cur:
        def __enter__(self) -> Any:
            return self

        def __exit__(self, *_: object) -> None:
            return None

        def execute(self, sql: str, params: Any = None) -> None:
            consultas.append(sql)

        def fetchall(self) -> list[tuple[str, str, dt.datetime]]:
            return pendientes

        def fetchone(self) -> tuple[int]:
            return (velas,)

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
    return consultas


def test_no_cuenta_una_decision_cuya_ultima_vela_aun_se_forma(monkeypatch: Any) -> None:
    """El caso de BNB tal y como lo vio el piloto: 14 de 15 velas a las 21:18 del día 12."""
    pendiente = [("BNBUSDT", "4h", _dt("2026-09-10T08:00:00"))]
    consultas = _psycopg_falso(monkeypatch, pendiente, velas=14)
    n = bloqueadas_por_hueco("dsn-falso", {"4h": 15}, ahora_ms=_ms("2026-09-12T21:18:00"))
    assert n == 0
    # Y ni siquiera se consulta la ventana: no tiene sentido contar velas que aún no pueden estar.
    assert len(consultas) == 1


def test_si_cuenta_la_misma_decision_cuando_su_ultima_vela_ya_debio_cerrar(
    monkeypatch: Any,
) -> None:
    """Pasado el cierre de la última vela, 14 de 15 sí es una vela perdida de verdad."""
    pendiente = [("BNBUSDT", "4h", _dt("2026-09-10T08:00:00"))]
    _psycopg_falso(monkeypatch, pendiente, velas=14)
    assert bloqueadas_por_hueco("dsn-falso", {"4h": 15}, ahora_ms=_ms("2026-09-13T01:00:00")) == 1


def test_con_la_ventana_completa_no_esta_bloqueada(monkeypatch: Any) -> None:
    pendiente = [("ETHUSDT", "1d", _dt("2026-08-20T00:05:00"))]
    _psycopg_falso(monkeypatch, pendiente, velas=10)
    assert bloqueadas_por_hueco("dsn-falso", {"1d": 10}, ahora_ms=_ms("2026-09-12T21:18:00")) == 0


def test_una_temporalidad_sin_duracion_fija_se_ignora(monkeypatch: Any) -> None:
    pendiente = [("BTCUSDT", "1M", _dt("2026-01-01T00:00:00"))]
    _psycopg_falso(monkeypatch, pendiente, velas=0)
    assert bloqueadas_por_hueco("dsn-falso", ahora_ms=_ms("2026-09-12T21:18:00")) == 0

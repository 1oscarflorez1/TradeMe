"""La ventana del desenlace se acota en TIEMPO, no en número de velas.

`h` velas no son `h` periodos en cuanto la ingesta pierde una. El guardia de M10.5 dejaba
pendiente el timeout cuando `len(future) < h`, que es lo correcto —pero contaba filas mientras la
promesa hablaba de tiempo, así que con un hueco pasaban `h` velas repartidas por un tramo mucho
más largo y el desenlace se decidía contra un mercado que no era el suyo.
"""

from __future__ import annotations

from types import TracebackType
from typing import Any

from trademe_quant.db import _velas_de_la_ventana


class _FakeCursor:
    """Registra la consulta y devuelve las filas que el test le ponga."""

    def __init__(self, filas: list[tuple[float, float, float]], registro: list[Any]) -> None:
        self._filas = filas
        self._registro = registro

    def __enter__(self) -> _FakeCursor:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[Any, ...]) -> None:
        self._registro.append((sql, params))

    def fetchall(self) -> list[tuple[float, float, float]]:
        return self._filas


class _FakeConn:
    def __init__(self, filas: list[tuple[float, float, float]] | None = None) -> None:
        self.filas = filas or []
        self.consultas: list[Any] = []

    def cursor(self) -> _FakeCursor:
        return _FakeCursor(self.filas, self.consultas)

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        return None


def test_acota_la_ventana_en_tiempo_con_la_duracion_de_la_temporalidad() -> None:
    conn = _FakeConn()
    _velas_de_la_ventana(conn, "BTCUSDT", "15m", "2026-08-01T00:00:00Z", 20)

    sql, params = conn.consultas[0]
    assert "ts <=" in sql, "sin cota superior la ventana vuelve a ser «las h velas que haya»"
    # 20 velas de 15 min = 5 h expresadas en milisegundos.
    assert 900_000 * 20 in params


def test_temporalidad_sin_duracion_conocida_cae_al_comportamiento_anterior() -> None:
    """`1M` no está en INTERVAL_MS: sin duración no se puede acotar, y no acotar no empeora nada."""
    conn = _FakeConn()
    _velas_de_la_ventana(conn, "BTCUSDT", "1M", "2026-08-01T00:00:00Z", 4)

    sql, _ = conn.consultas[0]
    assert "ts <=" not in sql


def test_una_ventana_con_hueco_devuelve_menos_de_h_y_el_guardia_la_deja_pendiente() -> None:
    """El efecto que se buscaba: con la ventana acotada, un hueco se nota al contar.

    Antes, esas mismas `h` velas llegaban completas —tomadas de después del hueco— y el timeout
    se cerraba en falso.
    """
    conn = _FakeConn(filas=[(101.0, 99.0, 100.0)] * 12)
    future = _velas_de_la_ventana(conn, "BTCUSDT", "15m", "2026-08-01T00:00:00Z", 20)

    assert len(future) < 20, "el llamador usa esta desigualdad para dejar el registro pendiente"

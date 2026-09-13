"""La reescritura del histórico con la ventana corregida: qué toca, qué respeta, cómo se deshace."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path
from typing import Any

from trademe_quant.reevaluar_desenlaces import Fila, aplicar, clasificar, informe, reevaluar
from trademe_quant.ventana import Trayectoria

QUIETA = (101.0, 99.0, 100.0)
CAPTURA = dt.datetime(2026, 9, 1, 0, 0, 15, tzinfo=dt.UTC)


def _fila(
    resultado: str = "timeout",
    r: float = 0.0,
    rama: str = "real",
    interval: str = "1d",
    symbol: str = "ETHUSDT",
    sid: int = 1,
    captura: dt.datetime = CAPTURA,
) -> Fila:
    return Fila(
        rama, sid, symbol, interval, captura, None, "LONG", 100.0, 95.0, 110.0, resultado, r
    )


def _tray(velas: list[tuple[float, float, float]], completa: bool = True) -> Trayectoria:
    return Trayectoria(velas, completa=completa, apertura_captura_ms=0, cierre_ms=1)


# --- Clasificación ------------------------------------------------------------------------------


def test_lo_que_ya_coincide_no_se_toca() -> None:
    assert clasificar(_fila("timeout", 0.0), _tray([QUIETA] * 10)).clase == "igual"


def test_un_timeout_que_cambia_de_r_se_reescribe() -> None:
    """El caso mayoritario en 1d: sigue siendo timeout, pero cierra a otro precio."""
    x = clasificar(_fila("timeout", 0.380), _tray([QUIETA] * 10))
    assert (x.clase, x.resultado_nuevo, x.r_nuevo) == ("cambia", "timeout", 0.0)


def test_un_stop_que_la_ventana_anterior_no_veia_se_reescribe() -> None:
    x = clasificar(_fila("timeout", 0.380), _tray([(101.0, 94.0, 96.0)] + [QUIETA] * 9))
    assert (x.clase, x.resultado_nuevo, x.r_nuevo) == ("cambia", "sl", -1.0)


def test_lo_que_hoy_no_puede_cerrarse_se_queda_como_esta() -> None:
    """Borrarlo lo dejaría pendiente para siempre: faltan velas y nunca volverán."""
    x = clasificar(_fila("timeout", 0.380), _tray([QUIETA] * 9, completa=False))
    assert (x.clase, x.resultado_nuevo, x.r_nuevo) == ("no_recalculable", None, None)


def test_una_temporalidad_sin_duracion_ni_se_intenta() -> None:
    llamadas: list[str] = []

    def trayectoria_de(symbol: str, interval: str, capturada: Any, h: int) -> Trayectoria | None:
        llamadas.append(interval)
        return _tray([QUIETA] * h)

    resultados = reevaluar([_fila(interval="1M"), _fila(interval="1d")], trayectoria_de, {"1d": 10})
    assert [x.clase for x in resultados] == ["sin_duracion", "igual"]
    assert llamadas == ["1d"]


def test_usa_el_horizonte_de_cada_temporalidad() -> None:
    pedidos: list[int] = []

    def trayectoria_de(symbol: str, interval: str, capturada: Any, h: int) -> Trayectoria | None:
        pedidos.append(h)
        return _tray([QUIETA] * h)

    reevaluar([_fila(interval="1d"), _fila(interval="4h")], trayectoria_de, {"1d": 10}, horizon=15)
    assert pedidos == [10, 15]


# --- Informe ------------------------------------------------------------------------------------


def test_el_informe_cuenta_por_rama_y_temporalidad() -> None:
    resultados = [
        clasificar(_fila("timeout", 0.0, sid=1), _tray([QUIETA] * 10)),
        clasificar(_fila("timeout", 0.5, sid=2), _tray([QUIETA] * 10)),
        clasificar(_fila("timeout", 0.5, sid=3, rama="sombra"), _tray([QUIETA], completa=False)),
    ]
    texto = "\n".join(informe(resultados, 0.0))
    assert "[real] 2 desenlaces · iguales 1 · cambian 1 · no recalculables 0" in texto
    assert "[sombra] 1 desenlaces · iguales 0 · cambian 0 · no recalculables 1" in texto
    assert "transiciones: timeout->timeout 1" in texto


def test_el_despues_de_las_operativas_es_lo_que_quedara_en_la_base() -> None:
    """Una por vela; lo no recalculable conserva su valor, porque no se va a escribir."""
    otro_dia = CAPTURA + dt.timedelta(days=1)
    resultados = [
        clasificar(_fila("timeout", 0.5, sid=1), _tray([QUIETA] * 10)),  # pasa a 0.0
        clasificar(_fila("timeout", 0.3, sid=2, captura=otro_dia), _tray([QUIETA], completa=False)),
    ]
    linea = next(x for x in informe(resultados, 0.0) if x.strip().startswith("ETHUSDT:1d"))
    velas, bruta_antes, bruta_despues = linea.split()[1:4]
    assert velas == "2"
    assert float(bruta_antes) == 0.4
    assert float(bruta_despues) == 0.15


def test_el_neto_descuenta_el_coste_de_cada_operacion() -> None:
    """Entrada 100 y stop 95: 1 R son 5 de precio, y un 0,12 % de 100 son 0,024 R."""
    resultados = [clasificar(_fila("timeout", 0.5), _tray([QUIETA] * 10))]
    linea = next(x for x in informe(resultados, 0.12) if x.strip().startswith("ETHUSDT:1d"))
    _, _, bruta_antes, bruta_despues, neta_antes, neta_despues = linea.split()
    assert abs(float(neta_antes) - (0.5 - 0.024)) < 1e-4
    assert abs(float(neta_despues) - (0.0 - 0.024)) < 1e-4


# --- Aplicar ------------------------------------------------------------------------------------


class _Cur:
    def __init__(self, conn: _Conn) -> None:
        self.conn = conn
        self.rowcount = 0

    def __enter__(self) -> _Cur:
        return self

    def __exit__(self, *_: object) -> None:
        return None

    def execute(self, sql: str, params: tuple[Any, ...]) -> None:
        self.conn.sentencias.append((sql, params))
        self.rowcount = 1


class _Conn:
    def __init__(self) -> None:
        self.sentencias: list[tuple[str, tuple[Any, ...]]] = []
        self.confirmada = False

    def cursor(self) -> _Cur:
        return _Cur(self)

    def commit(self) -> None:
        self.confirmada = True


def test_aplicar_solo_escribe_lo_que_cambia_y_guarda_la_copia_antes(tmp_path: Path) -> None:
    resultados = [
        clasificar(_fila("timeout", 0.0, sid=1), _tray([QUIETA] * 10)),
        clasificar(_fila("timeout", 0.38, sid=2), _tray([QUIETA] * 10)),
        clasificar(_fila("timeout", 0.5, sid=3, rama="sombra"), _tray([QUIETA], completa=False)),
        clasificar(_fila("tp", 2.0, sid=4, rama="sombra"), _tray([(101.0, 94.0, 96.0)])),
    ]
    conn = _Conn()

    copia, escritas = aplicar(conn, resultados, tmp_path)

    assert escritas == 2 and conn.confirmada
    guardada = json.loads(copia.read_text(encoding="utf8"))
    assert [(x["rama"], x["id"]) for x in guardada] == [("real", "2"), ("sombra", "4")]
    assert guardada[1] == {
        "rama": "sombra",
        "id": "4",
        "resultado_anterior": "tp",
        "r_anterior": 2.0,
        "resultado_nuevo": "sl",
        "r_nuevo": -1.0,
    }


def test_aplicar_no_toca_evaluated_at_y_exige_el_valor_leido(tmp_path: Path) -> None:
    """Cambiar el instante movería filas dentro o fuera de la ventana de la cuarentena."""
    conn = _Conn()
    aplicar(
        conn,
        [clasificar(_fila("tp", 2.0, sid=7, rama="sombra"), _tray([(101.0, 94.0, 96.0)]))],
        tmp_path,
    )

    ((sql, params),) = conn.sentencias
    assert "evaluated_at" not in sql
    assert "shadow_outcome_result=%s, shadow_outcome_return_r=%s" in sql
    assert "WHERE id=%s AND shadow_outcome_result=%s" in sql
    assert params == ("sl", -1.0, 7, "tp")

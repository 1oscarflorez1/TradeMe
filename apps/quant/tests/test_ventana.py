"""La trayectoria de una decisión arranca en la captura, no en la vela siguiente.

Hasta 0.71.1 la ventana eran las velas con `captured_at < ts`, así que una decisión diaria
capturada a las 00:00:15 excluía su propia vela —que abre a las 00:00:00— y se evaluaba desde el
día siguiente. Se ignoraban las primeras 24 horas de cada operación. Estos tests fijan lo que
cambia y, sobre todo, lo que no puede cambiar: que nada anterior a la decisión cuente en su
desenlace.
"""

from __future__ import annotations

import datetime as dt

from trademe_quant.backtest import evaluate_trade
from trademe_quant.ventana import FINA, Trayectoria, desenlace, fina_de, trayectoria

HORA = 3_600_000
DIA = 24 * HORA
SEMANA = 7 * DIA
QUIETA = (101.0, 99.0, 100.0)  # ni objetivo ni stop con entrada 100, stop 95, objetivo 110


def _ms(texto: str) -> int:
    return int(dt.datetime.fromisoformat(texto).replace(tzinfo=dt.UTC).timestamp() * 1000)


def _serie(
    desde_ms: int, paso_ms: int, n: int, vela: tuple[float, float, float] = QUIETA
) -> tuple[list[int], list[tuple[float, float, float]]]:
    return [desde_ms + i * paso_ms for i in range(n)], [vela] * n


# --- Dónde empieza y dónde acaba --------------------------------------------------------------


def test_una_decision_diaria_recorre_su_propio_dia_en_horas() -> None:
    """Capturada a las 00:00:15: el resto del día en velas de 1h y después las 9 diarias siguientes.

    La vela de la hora 00 no entra porque abre 15 segundos **antes** de decidir. Se pierde como
    mucho una hora, frente al día entero de la regla anterior.
    """
    captura = _ms("2026-09-09T00:00:15")
    gruesa_t, gruesa_v = _serie(_ms("2026-09-01T00:00:00"), DIA, 30)
    fina_t, fina_v = _serie(_ms("2026-09-08T00:00:00"), HORA, 24 * 5)

    tray = trayectoria(captura, DIA, 10, gruesa_t, gruesa_v, HORA, fina_t, fina_v)

    assert tray is not None
    assert tray.apertura_captura_ms == _ms("2026-09-09T00:00:00")
    assert len(tray.velas) == 23 + 9  # 23 horas del día 9, más los días 10 a 18
    assert tray.completa is True
    assert tray.cierre_ms == _ms("2026-09-19T00:00:00")


def test_capturada_justo_en_la_apertura_recorre_las_24_horas() -> None:
    captura = _ms("2026-09-09T00:00:00")
    gruesa_t, gruesa_v = _serie(_ms("2026-09-01T00:00:00"), DIA, 30)
    fina_t, fina_v = _serie(_ms("2026-09-09T00:00:00"), HORA, 24)
    tray = trayectoria(captura, DIA, 10, gruesa_t, gruesa_v, HORA, fina_t, fina_v)
    assert tray is not None
    assert len(tray.velas) == 24 + 9


def test_la_vela_de_captura_cuenta_como_la_primera_de_h_igual_que_en_el_backtest() -> None:
    """El timeout cierra al cierre de D+h−1, que es donde cierra el backtest para esa decisión.

    El backtest decide sobre la vela cerrada D−1 y recorre D..D+h−1. Si las velas horarias del día D
    son coherentes con la diaria, el desenlace en vivo tiene que ser el mismo.
    """
    captura = _ms("2026-09-09T00:00:00")
    diarias = [(101.0, 99.0, 100.0 + i * 0.1) for i in range(30)]
    gruesa_t = [_ms("2026-09-01T00:00:00") + i * DIA for i in range(30)]
    fina_t, fina_v = _serie(captura, HORA, 24, (101.0, 99.0, 100.0))

    tray = trayectoria(captura, DIA, 10, gruesa_t, diarias, HORA, fina_t, fina_v)
    vivo = desenlace("LONG", 100.0, 95.0, 110.0, tray)

    i_d = gruesa_t.index(captura)
    ventana_bt = diarias[i_d : i_d + 10]
    backtest = evaluate_trade(
        "LONG",
        100.0,
        95.0,
        110.0,
        [v[0] for v in ventana_bt],
        [v[1] for v in ventana_bt],
        [v[2] for v in ventana_bt],
    )
    assert vivo is not None
    assert vivo["result"] == backtest["result"] == "timeout"
    assert vivo["r"] == backtest["r"]


# --- Lo que corrige y lo que no puede romper ----------------------------------------------------


def test_un_stop_tocado_el_mismo_dia_de_la_captura_ahora_cuenta() -> None:
    """El caso que la regla anterior no veía: el stop salta a las 10:00 del propio día D."""
    captura = _ms("2026-09-09T00:00:00")
    gruesa_t, gruesa_v = _serie(_ms("2026-09-01T00:00:00"), DIA, 30)
    fina_t, fina_v = _serie(captura, HORA, 24)
    fina_v[10] = (101.0, 94.0, 96.0)  # a las 10:00 perfora el stop de 95

    tray = trayectoria(captura, DIA, 10, gruesa_t, gruesa_v, HORA, fina_t, fina_v)
    res = desenlace("LONG", 100.0, 95.0, 110.0, tray)

    assert res is not None and res["result"] == "sl"


def test_nada_anterior_a_la_decision_cuenta_en_su_desenlace() -> None:
    """La razón de recorrer el día en horas y no con la vela diaria entera.

    Capturada a las 14:22. A las 09:00 el precio perforó el stop, pero eso fue **antes** de decidir:
    no puede cerrar la operación. Con la vela diaria entera se habría contado como stop.
    """
    captura = _ms("2026-09-09T14:22:00")
    gruesa_t, gruesa_v = _serie(_ms("2026-09-01T00:00:00"), DIA, 30)
    fina_t, fina_v = _serie(_ms("2026-09-09T00:00:00"), HORA, 24)
    fina_v[9] = (101.0, 90.0, 99.0)  # 09:00, antes de la captura

    tray = trayectoria(captura, DIA, 10, gruesa_t, gruesa_v, HORA, fina_t, fina_v)
    res = desenlace("LONG", 100.0, 95.0, 110.0, tray)

    assert tray is not None
    assert len(tray.velas) == 9 + 9  # de 15:00 a 23:00, y los días 10 a 18
    assert res is not None and res["result"] == "timeout"


def test_sin_una_hora_la_trayectoria_esta_incompleta_y_no_cierra_por_tiempo() -> None:
    captura = _ms("2026-09-09T00:00:00")
    gruesa_t, gruesa_v = _serie(_ms("2026-09-01T00:00:00"), DIA, 30)
    fina_t, fina_v = _serie(captura, HORA, 24)
    del fina_t[5], fina_v[5]

    tray = trayectoria(captura, DIA, 10, gruesa_t, gruesa_v, HORA, fina_t, fina_v)

    assert tray is not None and tray.completa is False
    assert desenlace("LONG", 100.0, 95.0, 110.0, tray) is None


def test_un_toque_vale_aunque_falten_velas() -> None:
    """La asimetría de siempre: el precio estuvo ahí y eso ya no cambia."""
    tray = Trayectoria([(101.0, 94.0, 96.0)], completa=False, apertura_captura_ms=0, cierre_ms=DIA)
    res = desenlace("LONG", 100.0, 95.0, 110.0, tray)
    assert res is not None and res["result"] == "sl"


def test_sin_velas_gruesas_no_se_inventa_la_fase() -> None:
    assert trayectoria(_ms("2026-09-09"), DIA, 10, [], [], HORA, [], []) is None


def test_sin_velas_no_hay_desenlace() -> None:
    assert desenlace("LONG", 100.0, 95.0, 110.0, None) is None
    vacia = Trayectoria([], completa=False, apertura_captura_ms=0, cierre_ms=DIA)
    assert desenlace("LONG", 100.0, 95.0, 110.0, vacia) is None


# --- Fases y temporalidades ---------------------------------------------------------------------


def test_la_semanal_se_ancla_en_el_lunes_de_la_serie() -> None:
    """Las semanales de Binance abren en lunes; la época Unix empezó en jueves."""
    lunes = _ms("2026-08-31T00:00:00")
    gruesa_t, gruesa_v = _serie(lunes, SEMANA, 8)
    fina_t, fina_v = _serie(_ms("2026-09-07T00:00:00"), 4 * HORA, 6 * 7)

    tray = trayectoria(
        _ms("2026-09-09T10:00:00"), SEMANA, 3, gruesa_t, gruesa_v, 4 * HORA, fina_t, fina_v
    )

    assert tray is not None
    assert (
        dt.datetime.fromtimestamp(tray.apertura_captura_ms / 1000, dt.UTC).strftime("%A")
        == "Monday"
    )
    assert tray.apertura_captura_ms == _ms("2026-09-07T00:00:00")


def test_con_horizonte_uno_solo_cuenta_el_resto_de_la_vela_de_captura() -> None:
    captura = _ms("2026-09-09T00:00:00")
    gruesa_t, gruesa_v = _serie(_ms("2026-09-01T00:00:00"), DIA, 30)
    fina_t, fina_v = _serie(captura, HORA, 24)
    tray = trayectoria(captura, DIA, 1, gruesa_t, gruesa_v, HORA, fina_t, fina_v)
    assert tray is not None and len(tray.velas) == 24 and tray.completa is True


def test_un_minuto_no_tiene_nada_mas_fino() -> None:
    assert fina_de("1m") == (None, None)
    assert fina_de("1d") == ("1h", HORA)


def test_todas_las_temporalidades_finas_son_mas_cortas_que_la_suya() -> None:
    from trademe_quant.market.normalize import INTERVAL_MS

    for gruesa, fina in FINA.items():
        if fina is not None:
            assert INTERVAL_MS[fina] < INTERVAL_MS[gruesa], gruesa
            assert INTERVAL_MS[gruesa] % INTERVAL_MS[fina] == 0, gruesa

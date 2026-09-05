"""El piloto registraba sesenta líneas por ciclo y guardaba diez."""

from __future__ import annotations

from trademe_quant.scheduler import MAX_LINEAS_LOG, resumen_datos


def test_las_lineas_de_datos_se_recogen_aparte() -> None:
    """Van al principio del ciclo, así que eran justo las que se perdían."""
    log = [
        "huecos: 20000 velas recuperadas en 4 hueco(s); quedan 26",
        "cobertura: BTCUSDT: cobertura 44% -> 100%",
        "frescura: ecb_ipc_interanual: sin datos nuevos desde 2025-12-31",
        "histórico: 683/1078 desenlaces reproducibles (63%)",
        "BTCUSDT 15m: expectancy -0.070",
        "cuarentena: 30m entra en cuarentena",
    ]
    datos = resumen_datos(log)
    assert len(datos) == 4
    assert all(d.split(":")[0] in ("huecos", "cobertura", "frescura", "histórico") for d in datos)


def test_no_se_cuela_una_linea_de_decision() -> None:
    assert resumen_datos(["cuarentena: 4h sale", "meta-modelo n=892"]) == []


def test_se_conservan_muchas_mas_lineas_que_antes() -> None:
    """Diez no bastaban: un ciclo con 4 símbolos y 5 temporalidades genera del orden de 60."""
    assert MAX_LINEAS_LOG >= 100

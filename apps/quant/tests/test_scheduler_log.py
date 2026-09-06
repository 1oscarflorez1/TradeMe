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


def test_con_optimize_every_h_en_cero_no_se_optimiza_por_ninguna_via() -> None:
    """Apagar solo el mantenimiento dejaría viva la vía de degradación.

    Y esa reoptimizaría justo las claves que peor van, que es donde más tienta el sobreajuste. Las
    tres vías llaman al mismo optimizador, y lo medido es que ese optimizador no mejora la
    configuración manual — ni con 40 trials ni con 120.
    """
    from trademe_quant.scheduler import should_optimize

    for horas, degradada in ((None, False), (1000.0, False), (1000.0, True), (0.0, True)):
        toca, motivo = should_optimize(horas, degradada, every_h=0.0, cooldown_h=48.0)
        assert toca is False, f"con every_h=0 no debe optimizar (horas={horas}, degr={degradada})"
        assert motivo == ""


def test_subiendo_optimize_every_h_vuelve_a_optimizar() -> None:
    """No se borra la capacidad: la pregunta puede rehacerse con más historia."""
    from trademe_quant.scheduler import should_optimize

    toca, motivo = should_optimize(None, False, every_h=168.0, cooldown_h=48.0)
    assert toca is True
    assert "primera optimización" in motivo


def test_el_valor_por_defecto_deja_la_optimizacion_apagada() -> None:
    from trademe_quant.scheduler import AutoConfig

    assert AutoConfig().optimize_every_h == 0.0

"""Gestor de Correlaciones: que la métrica mida lo que decimos que mide."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

import numpy as np

from trademe_quant.correlaciones import (
    FLOOR,
    MIN_VELAS,
    efectivos,
    factor_para,
    matriz,
    observaciones_efectivas,
)


def _paseo(n: int, semilla: int) -> list[float]:
    rng = np.random.default_rng(semilla)
    return list(100.0 * np.exp(np.cumsum(rng.standard_normal(n) * 0.01)))


# ---------------------------------------------------------------------------------------------
# Extremos conocidos. Si la métrica no los supera, no mide lo que decimos que mide — es la
# comprobación que faltó la primera vez que se propuso un listón (ver analista-niveles-fase0).
# ---------------------------------------------------------------------------------------------
def test_series_independientes_dan_casi_todos_los_activos() -> None:
    series = {f"A{i}": _paseo(400, i) for i in range(4)}
    _, corr = matriz(series)
    assert corr is not None
    ef = efectivos(corr)
    assert ef > 3.3, f"cuatro series independientes deberían dar ~4 efectivos, dieron {ef:.2f}"


def test_series_identicas_dan_uno() -> None:
    base = _paseo(400, 7)
    series = {f"A{i}": list(base) for i in range(4)}
    _, corr = matriz(series)
    assert corr is not None
    ef = efectivos(corr)
    assert ef < 1.2, f"cuatro copias deberían dar ~1 efectivo, dieron {ef:.2f}"


def test_correlacion_intermedia_cae_entre_medias() -> None:
    """Cuatro activos que comparten un factor común: ni 4 ni 1."""
    rng = np.random.default_rng(11)
    comun = rng.standard_normal(400)
    series: dict[str, list[float]] = {}
    for i in range(4):
        propio = rng.standard_normal(400)
        r = 0.8 * comun + 0.6 * propio
        series[f"A{i}"] = list(100.0 * np.exp(np.cumsum(r * 0.01)))
    _, corr = matriz(series)
    ef = efectivos(corr)
    assert 1.2 < ef < 3.5


# ---------------------------------------------------------------------------------------------
# Degradación grácil
# ---------------------------------------------------------------------------------------------
def test_sin_muestra_suficiente_no_se_descuenta() -> None:
    series = {"A": _paseo(MIN_VELAS - 5, 1), "B": _paseo(MIN_VELAS - 5, 2)}
    _, corr = matriz(series)
    assert corr is None
    assert efectivos(corr) == 1.0


def test_un_activo_plano_no_rompe() -> None:
    series = {"A": _paseo(300, 3), "PLANO": [100.0] * 300}
    _, corr = matriz(series)
    assert corr is None  # sin varianza no hay correlación definida; no se inventa


def test_sin_artefacto_el_factor_es_uno() -> None:
    assert factor_para(["BTCUSDT", "ETHUSDT"], None) == 1.0
    assert factor_para(["BTCUSDT"], {"symbols": ["BTCUSDT"], "matrix": [[1.0]]}) == 1.0


# ---------------------------------------------------------------------------------------------
# El descuento por ventanas
# ---------------------------------------------------------------------------------------------
ART: dict[str, Any] = {
    # Cuatro activos muy correlacionados, como los cripto reales (0,69-0,81 medido).
    "symbols": ["BNBUSDT", "BTCUSDT", "ETHUSDT", "SOLUSDT"],
    "matrix": [
        [1.0, 0.71, 0.69, 0.70],
        [0.71, 1.0, 0.81, 0.75],
        [0.69, 0.81, 1.0, 0.76],
        [0.70, 0.75, 0.76, 1.0],
    ],
}

INICIO = datetime(2026, 8, 19, 12, 0, tzinfo=UTC)


def fila(symbol: str, horas: float) -> dict[str, Any]:
    return {"symbol": symbol, "captured_at": INICIO + timedelta(hours=horas)}


def test_decisiones_del_mismo_dia_en_activos_correlacionados_se_descuentan() -> None:
    """El caso real: 74 decisiones de ETH y SOL en 14 horas no son 74 observaciones."""
    filas = [fila("ETHUSDT", h * 0.2) for h in range(35)]
    filas += [fila("SOLUSDT", h * 0.2) for h in range(35)]
    n_ef = observaciones_efectivas(filas, ART)
    assert n_ef < len(filas), "no descontó nada"
    assert n_ef > 0


def test_la_diversidad_temporal_no_se_castiga() -> None:
    """Dos decisiones del mismo activo en días distintos son casi independientes.

    Es la razón de agrupar por ventanas en vez de aplicar el factor global: castigar esto sería
    penalizar justo lo que se quiere premiar.
    """
    mismo_dia = [fila("ETHUSDT", 0), fila("SOLUSDT", 1)]
    dias_distintos = [fila("ETHUSDT", 0), fila("SOLUSDT", 72)]
    assert observaciones_efectivas(dias_distintos, ART) > observaciones_efectivas(mismo_dia, ART)


def test_un_solo_activo_en_la_ventana_no_se_descuenta() -> None:
    filas = [fila("ETHUSDT", h) for h in range(5)]
    assert observaciones_efectivas(filas, ART) == float(len(filas))


def test_sin_artefacto_no_hay_descuento() -> None:
    filas = [fila("ETHUSDT", 0), fila("SOLUSDT", 1)]
    assert observaciones_efectivas(filas, None) == 2.0


def test_el_descuento_nunca_baja_del_suelo() -> None:
    """Por muy correlacionados que estén, la muestra no se anula."""
    art = {"symbols": ["A", "B", "C", "D"], "matrix": [[1.0] * 4 for _ in range(4)]}
    filas = [fila(s, 0) for s in ("A", "B", "C", "D")]
    n_ef = observaciones_efectivas(filas, art)
    assert n_ef >= len(filas) * FLOOR - 1e-9


def test_sin_filas_devuelve_cero() -> None:
    assert observaciones_efectivas([], ART) == 0.0

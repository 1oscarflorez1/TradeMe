"""Una configuración optimizada aporta lo que Optuna busca, y nada más.

El fallo que estos tests fijan es silencioso por naturaleza: nada falla, nada avisa, y una clave
sigue operando con el estado de gobierno del día en que se optimizó. Se detectó el 7 de septiembre
de 2026, con quince configuraciones de agosto aplicando una cuarentena, unos costes y un peso de
Reditum que ya no eran los vigentes.

Por eso el test que más importa no es el de los campos que sí viajan, sino el de **los que no**: es
el que se romperá el día que alguien añada una sección nueva al yaml y la lista blanca se quede
corta.
"""

from __future__ import annotations

from typing import Any

import pytest

from trademe_quant.ensemble import (
    CAMPOS_OPTIMIZABLES,
    REGIME_OPTIMIZABLES,
    fusionar_optimizada,
)


def _base() -> dict[str, Any]:
    """Una base con todo lo que el gobierno del proyecto ha ido añadiendo al yaml."""
    return {
        "version": "base-2026-09",
        "temperature": 0.8,
        "hold_band": 0.10,
        "weights": {"ema_cross": 1.0, "macd": 1.0, "supertrend": 1.0},
        "external_weights": {"tradingview": 0.0},
        "regime": {
            "adx_threshold": 25,
            "adx_lo": 20.0,
            "adx_hi": 30.0,
            "trend": {"trend": 1.0, "momentum": 1.0, "reversion": 0.5},
            "range": {"trend": 0.5, "momentum": 0.5, "reversion": 1.0},
        },
        "risk": {"atr_stop_mult": 1.5, "tp_r_multiple": 2.0, "risk_pct": 0.01},
        "costs": {"enabled": True, "mode": "taker", "taker_pct": 0.05, "slippage_pct": 0.01},
        "quarantine_intervals": ["15m", "30m", "1h", "4h"],
        "quarantine_structural": ["15m", "30m", "1h"],
        "macro": {"enabled": False},
        "fundamental": {"mode": "shadow"},
    }


def _optimizada() -> dict[str, Any]:
    """Una copia completa y vieja del yaml, que es exactamente lo que publica el optimizador."""
    return {
        "version": "ens-opt-SOLUSDT-1d-20260819",
        "temperature": 0.57,
        "hold_band": 0.15,
        "weights": {"ema_cross": 1.09, "macd": 0.43, "supertrend": 1.87},
        # Todo lo de abajo es estado de gobierno de agosto que NO debe viajar.
        "external_weights": {"tradingview": 2.0},
        "regime": {
            "adx_threshold": 99,
            "adx_lo": 15.6,
            "adx_hi": 29.5,
            "trend": {"trend": 0.51, "momentum": 0.58, "reversion": 1.23},
            "range": {"trend": 1.34, "momentum": 1.77, "reversion": 0.05},
        },
        "risk": {"atr_stop_mult": 9.9, "tp_r_multiple": 9.9, "risk_pct": 0.9},
        "quarantine_intervals": ["4h"],
        "macro": {"enabled": True},
        "fundamental": {"mode": "activo"},
    }


def test_viaja_lo_que_optuna_optimiza() -> None:
    """Los pesos, la banda, la temperatura y el escalado por ADX son suyos."""
    f = fusionar_optimizada(_base(), _optimizada())
    assert f["temperature"] == 0.57
    assert f["hold_band"] == 0.15
    assert f["weights"] == {"ema_cross": 1.09, "macd": 0.43, "supertrend": 1.87}
    assert f["regime"]["adx_lo"] == 15.6
    assert f["regime"]["adx_hi"] == 29.5
    assert f["regime"]["trend"]["reversion"] == 1.23
    assert f["regime"]["range"]["momentum"] == 1.77


def test_la_version_viaja_porque_es_la_identidad_del_artefacto() -> None:
    """La interfaz y los informes la muestran para saber qué configuración decidió."""
    assert fusionar_optimizada(_base(), _optimizada())["version"] == "ens-opt-SOLUSDT-1d-20260819"


@pytest.mark.parametrize(
    ("campo", "esperado"),
    [
        ("costs", {"enabled": True, "mode": "taker", "taker_pct": 0.05, "slippage_pct": 0.01}),
        ("quarantine_intervals", ["15m", "30m", "1h", "4h"]),
        ("quarantine_structural", ["15m", "30m", "1h"]),
        ("external_weights", {"tradingview": 0.0}),
        ("risk", {"atr_stop_mult": 1.5, "tp_r_multiple": 2.0, "risk_pct": 0.01}),
        ("macro", {"enabled": False}),
        ("fundamental", {"mode": "shadow"}),
    ],
)
def test_el_gobierno_lo_manda_siempre_la_base(campo: str, esperado: Any) -> None:
    """Los tres primeros son los que de verdad se escaparon, y por eso están uno a uno.

    Sin `costs` tres de las cuatro claves de 1d se medían en bruto; sin la cuarentena completa, la
    estructural de 15m/30m/1h no llegaba; y `tradingview: 2.0` habría empujado la decisión en cuanto
    se configurase el webhook, cuando la base lo puso en sombra.
    """
    assert fusionar_optimizada(_base(), _optimizada())[campo] == esperado


def test_adx_threshold_no_viaja_porque_optuna_no_lo_busca() -> None:
    """Está dentro de `regime`, que sí se fusiona: la lista blanca es por campo, no por sección."""
    assert fusionar_optimizada(_base(), _optimizada())["regime"]["adx_threshold"] == 25


def test_una_seccion_nueva_del_yaml_queda_protegida_sin_tocar_nada() -> None:
    """La razón de que la lista sea blanca y no negra.

    Es el test que se romperá el día que alguien añada una sección al yaml y la fusión la deje
    pasar. Que falle entonces es justamente lo que se quiere: el olvido es el modo de fallo de este
    mecanismo, no el error.
    """
    base = {**_base(), "gobierno_futuro": {"algo": "de la base"}}
    opt = {**_optimizada(), "gobierno_futuro": {"algo": "viejo"}}
    assert fusionar_optimizada(base, opt)["gobierno_futuro"] == {"algo": "de la base"}


def test_la_lista_blanca_es_la_que_optimize_declara() -> None:
    """Si Optuna empieza a buscar otra cosa, la lista tiene que enterarse.

    No se comprueba contra `optimize.py` en tiempo de ejecución a propósito —importarlo arrastraría
    Optuna a un test de configuración—, pero sí se fija el contenido: cambiarlo obliga a mirar aquí.
    """
    assert CAMPOS_OPTIMIZABLES == ("temperature", "hold_band", "weights")
    assert REGIME_OPTIMIZABLES == ("adx_lo", "adx_hi", "trend", "range")


def test_sin_regime_en_la_optimizada_se_conserva_el_de_la_base() -> None:
    """Una configuración incompleta no debe dejar la fusión a medias."""
    f = fusionar_optimizada(_base(), {"version": "v", "weights": {"macd": 2.0}})
    assert f["regime"] == _base()["regime"]
    assert f["weights"] == {"macd": 2.0}
    assert f["temperature"] == 0.8

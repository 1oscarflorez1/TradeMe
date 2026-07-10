import pathlib

import pytest

from trademe_quant.ensemble import EnsembleConfigError, load_ensemble, validate_ensemble

ENSEMBLE_PATH = pathlib.Path(__file__).parents[3] / "artifacts/ensemble.yaml"


def test_real_ensemble_is_valid() -> None:
    data = load_ensemble(ENSEMBLE_PATH)
    assert data["external_weights"]["tradingview"] == 2.0
    assert data["temperature"] > 0
    assert data["risk"]["risk_pct"] == 0.01


def test_missing_key_raises() -> None:
    with pytest.raises(EnsembleConfigError):
        validate_ensemble({"version": "x"})


def test_bad_weight_raises() -> None:
    bad = {
        "version": "x",
        "temperature": 0.5,
        "hold_band": 0.1,
        "weights": {"rsi14": -1},
        "external_weights": {"tradingview": 2},
        "regime": {"adx_threshold": 25, "trend": {}, "range": {}},
        "risk": {"atr_stop_mult": 1.5, "tp_r_multiple": 2, "risk_pct": 0.01},
    }
    with pytest.raises(EnsembleConfigError):
        validate_ensemble(bad)


def test_bad_risk_raises() -> None:
    bad = {
        "version": "x",
        "temperature": 0.5,
        "hold_band": 0.1,
        "weights": {"rsi14": 1},
        "external_weights": {"tradingview": 2},
        "regime": {"adx_threshold": 25, "trend": {}, "range": {}},
        "risk": {"atr_stop_mult": -1, "tp_r_multiple": 2, "risk_pct": 0.01},
    }
    with pytest.raises(EnsembleConfigError):
        validate_ensemble(bad)

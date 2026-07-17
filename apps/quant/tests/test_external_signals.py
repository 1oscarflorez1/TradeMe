import pytest

from trademe_quant.external_signals import ExternalSignalError, normalize_external_row


def test_normalize_ok() -> None:
    row = {
        "source": "tradingview",
        "strategy": "reditum_sniper",
        "symbol": "BTCUSDT",
        "score": 1.0,
        "ts": "2026-07-07T00:00:00Z",
        "signal": "long",
        "tf": "5m",
    }
    sig = normalize_external_row(row)
    assert sig.strategy == "reditum_sniper"
    assert sig.score == 1.0
    assert sig.signal == "long"


def test_missing_field_raises() -> None:
    with pytest.raises(ExternalSignalError):
        normalize_external_row({"source": "tradingview"})

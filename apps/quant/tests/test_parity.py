import json
import pathlib

from trademe_quant.indicators import compute_readings

VECTORS = json.loads(
    (pathlib.Path(__file__).parents[3] / "packages/core-signals/parity/vectors.json").read_text()
)


def _series():
    candles = VECTORS["dataset"]["candles"]
    high = [c["h"] for c in candles]
    low = [c["l"] for c in candles]
    close = [c["c"] for c in candles]
    return high, low, close


def test_parity_scores_within_tolerance() -> None:
    high, low, close = _series()
    got = compute_readings(high, low, close)
    expected = VECTORS["expected"]
    for key, exp in expected.items():
        assert key in got, f"falta {key}"
        # El score es lo que decide el ensemble: tolerancia estricta.
        assert abs(got[key]["score"] - exp["score"]) < 0.03, (
            key,
            got[key]["score"],
            exp["score"],
        )


def test_parity_values_within_tolerance() -> None:
    high, low, close = _series()
    got = compute_readings(high, low, close)
    expected = VECTORS["expected"]
    for key, exp in expected.items():
        tol = max(0.05, 0.02 * abs(exp["value"]))
        assert abs(got[key]["value"] - exp["value"]) < tol, (key, got[key]["value"], exp["value"])

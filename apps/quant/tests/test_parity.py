import json
import pathlib

from trademe_quant.calibration import apply_calibrator
from trademe_quant.decision import decide
from trademe_quant.ensemble import load_ensemble
from trademe_quant.indicators import compute_readings
from trademe_quant.inference import infer_probs, pick_action
from trademe_quant.macro import compute_macro_bias

VECTORS = json.loads(
    (pathlib.Path(__file__).parents[3] / "packages/core-signals/parity/vectors.json").read_text()
)
MACRO = json.loads(
    (
        pathlib.Path(__file__).parents[3] / "packages/core-signals/parity/macro_vectors.json"
    ).read_text()
)


def _series() -> tuple[list[float], list[float], list[float]]:
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


def test_parity_macro_bias() -> None:
    cfg = MACRO["macroConfig"]
    for v in MACRO["macro_bias"]:
        inp = v["input"]
        got = compute_macro_bias(
            inp["funding"],
            inp["price"],
            inp["weeklyEma"],
            cfg["fundingWeight"],
            cfg["trendWeight"],
            cfg["fundingScale"],
            cfg["trendScale"],
        )
        assert abs(got["bias"] - v["expected"]["bias"]) < 1e-4, (got, v["expected"])
        assert got["label"] == v["expected"]["label"]


def test_parity_inference() -> None:
    for v in MACRO["inference"]:
        inp = v["input"]
        probs = infer_probs(
            inp["net"], inp["temperature"], inp["holdBand"], inp["bias"], inp["wMacro"]
        )
        assert abs(probs["BUY"] - v["expected"]["BUY"]) < 1e-4, (probs, v["expected"])
        assert abs(probs["SELL"] - v["expected"]["SELL"]) < 1e-4
        assert pick_action(probs) == v["expected"]["action"]


def test_parity_decision() -> None:
    candles = VECTORS["dataset"]["candles"]
    high = [c["h"] for c in candles]
    low = [c["l"] for c in candles]
    close = [c["c"] for c in candles]
    config = load_ensemble(pathlib.Path(__file__).parents[3] / "artifacts/ensemble.yaml")
    for v in MACRO["decision"]:
        got = decide(high, low, close, config, v["macroBias"])
        exp = v["expected"]
        assert got["action"] == exp["action"], (got["action"], exp)
        assert got["direction"] == exp["direction"]
        assert abs(got["net"] - exp["net"]) < 1e-4, (got["net"], exp["net"])
        if exp["levels"] is not None:
            assert got["levels"] is not None
            assert abs(got["levels"]["entry"] - exp["levels"]["entry"]) < 0.05
            assert abs(got["levels"]["stop"] - exp["levels"]["stop"]) < 0.05
            assert abs(got["levels"]["take_profit"] - exp["levels"]["take_profit"]) < 0.05


def test_parity_calibration() -> None:
    """El applier del calibrador debe coincidir Node<->Python (identidad/isotónica/Platt)."""
    for v in MACRO["calibration"]:
        got = apply_calibrator(v["cal"], float(v["input"]))
        assert abs(got - v["expected"]) < 1e-6, (v["calibrator"], v["input"], got, v["expected"])

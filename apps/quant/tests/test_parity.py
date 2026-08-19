import json
import pathlib

from trademe_quant.calibration import apply_calibrator
from trademe_quant.decision import decide, horizon_for, is_quarantined, valid_candles_for
from trademe_quant.ensemble import load_ensemble
from trademe_quant.fundamental import long_penalty, percentile_of
from trademe_quant.indicators import compute_readings
from trademe_quant.inference import infer_probs, pick_action
from trademe_quant.macro import compute_macro_bias
from trademe_quant.metamodel import predict_forest

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
            inp["net"],
            inp["temperature"],
            inp["holdBand"],
            inp["bias"],
            inp["wMacro"],
            inp.get("independence", 1.0),
        )
        assert abs(probs["BUY"] - v["expected"]["BUY"]) < 1e-4, (probs, v["expected"])
        assert abs(probs["SELL"] - v["expected"]["SELL"]) < 1e-4
        assert pick_action(probs) == v["expected"]["action"]


def test_desinflado_no_cambia_la_direccion() -> None:
    """Invariante del ajuste por dependencia: baja la confianza, nunca la decisión.

    Escalar los tres logits por una constante positiva no altera cuál es el mayor. Si esto se
    rompiera, el ajuste habría dejado de ser una corrección de calibración para convertirse en un
    cambio de criterio, y habría que volver a validar toda la estrategia.
    """
    for net in (-0.9, -0.35, -0.05, 0.0, 0.05, 0.35, 0.9):
        for bias in (-0.8, 0.0, 0.8):
            base = infer_probs(net, 0.5, 0.06, bias, 1.0, 1.0)
            for k in (0.9, 0.66, 0.485, 0.35):
                bajado = infer_probs(net, 0.5, 0.06, bias, 1.0, k)
                assert pick_action(bajado) == pick_action(base), (net, bias, k)
                # Y la confianza declarada nunca sube al desinflar.
                assert bajado[pick_action(bajado)] <= base[pick_action(base)] + 1e-12


def test_parity_decision() -> None:
    candles = VECTORS["dataset"]["candles"]
    high = [c["h"] for c in candles]
    low = [c["l"] for c in candles]
    close = [c["c"] for c in candles]
    config = load_ensemble(pathlib.Path(__file__).parents[3] / "artifacts/ensemble.yaml")
    for v in MACRO["decision"]:
        got = decide(
            high,
            low,
            close,
            config,
            v["macroBias"],
            independence=v.get("independence", 1.0),
            quarantined=v.get("quarantined", False),
        )
        exp = v["expected"]
        assert got["action"] == exp["action"], (got["action"], exp)
        assert got["direction"] == exp["direction"]
        assert got["hold_reason"] == exp["hold_reason"], (got["hold_reason"], exp["hold_reason"])
        # La sombra de la cuarentena: sin ella una temporalidad vetada no podría salir nunca.
        assert got["shadow_action"] == exp["shadow_action"], (got, exp)
        assert got["shadow_direction"] == exp["shadow_direction"], (got, exp)
        assert abs(got["net"] - exp["net"]) < 1e-4, (got["net"], exp["net"])
        if exp["levels"] is not None:
            assert got["levels"] is not None
            assert abs(got["levels"]["entry"] - exp["levels"]["entry"]) < 0.05
            assert abs(got["levels"]["stop"] - exp["levels"]["stop"]) < 0.05
            assert abs(got["levels"]["take_profit"] - exp["levels"]["take_profit"]) < 0.05


def test_parity_por_temporalidad() -> None:
    """Frescura de la entrada, horizonte de evaluación y cuarentena, idénticos Node<->Python.

    No están en el camino de la decisión, pero deciden cuándo cierra una operación el backtest de
    Python y cuánto vive el plan en Node. Si divergieran, el backtest dejaría de medir lo que la
    plataforma hace de verdad, que es el fallo más caro de detectar de todos.
    """
    config = load_ensemble(pathlib.Path(__file__).parents[3] / "artifacts/ensemble.yaml")
    for v in MACRO["timeframes"]:
        iv, exp = v["interval"], v["expected"]
        assert valid_candles_for(config, iv) == exp["valid_candles"], iv
        assert horizon_for(config, iv) == exp["horizon"], iv
        assert is_quarantined(config, iv) == exp["quarantined"], iv


def test_parity_calibration() -> None:
    """El applier del calibrador debe coincidir Node<->Python (identidad/isotónica/Platt)."""
    for v in MACRO["calibration"]:
        got = apply_calibrator(v["cal"], float(v["input"]))
        assert abs(got - v["expected"]) < 1e-6, (v["calibrator"], v["input"], got, v["expected"])


def test_parity_metamodel() -> None:
    """El bosque serializado debe evaluarse idéntico en Node y en Python."""
    mm = MACRO["metamodel"]
    for v in mm["vectors"]:
        got = predict_forest(mm["forest"], v["input"])
        assert abs(got - v["expected"]) < 1e-6, (v["input"], got, v["expected"])


def test_parity_fundamental_percentil() -> None:
    """Situar un funding en la distribución debe dar lo mismo en Node y en Python."""
    for v in MACRO["fundamental"]["percentile"]:
        got = percentile_of([float(k) for k in v["knots"]], float(v["funding"]))
        assert abs(got - v["expected"]) < 1e-6, (v["funding"], got, v["expected"])


def test_parity_fundamental_penalizacion() -> None:
    """La curva de penalización a los largos debe coincidir Node<->Python."""
    for v in MACRO["fundamental"]["penalty"]:
        got = long_penalty(float(v["pct"]), float(v["start"]))
        assert abs(got - v["expected"]) < 1e-6, (v["pct"], got, v["expected"])


def test_parity_fundamental_inferencia() -> None:
    """La inyección asimétrica en el softmax debe ser idéntica en los dos motores."""
    for v in MACRO["fundamental"]["inference"]:
        i = v["input"]
        probs = infer_probs(
            float(i["net"]),
            float(i["temperature"]),
            float(i["holdBand"]),
            float(i["bias"]),
            float(i["wMacro"]),
            float(i["independence"]),
            float(i["fundTerm"]),
        )
        for k in ("BUY", "HOLD", "SELL"):
            assert abs(probs[k] - v["expected"][k]) < 1e-6, (i, k, probs[k], v["expected"][k])
        assert pick_action(probs) == v["expected"]["action"], i


def test_la_penalizacion_no_toca_el_lado_corto() -> None:
    """La asimetría, comprobada donde de verdad vive: en los logits.

    Ojo con leer esto como «P(SELL) no cambia»: sí cambia, y debe cambiar. El softmax normaliza, así
    que al hundir el logit BUY la masa sobrante se reparte entre HOLD y SELL. Lo que no se toca es
    el **logit** de SELL, y su consecuencia observable es esta: la relación SELL/HOLD queda
    exactamente igual, penalice lo que penalice el funding. El score desaconseja ponerse largo; no
    opina sobre ponerse corto, que es justo lo que dicen los datos (en cortos no hay patrón).
    """
    base = infer_probs(0.5, 0.5, 0.06, 0.0, 1.0, 1.0, 0.0)
    for fund_term in (0.1, 0.25, 0.5, 1.0, 3.0):
        p = infer_probs(0.5, 0.5, 0.06, 0.0, 1.0, 1.0, fund_term)
        assert abs(p["SELL"] / p["HOLD"] - base["SELL"] / base["HOLD"]) < 1e-9, fund_term
        assert p["BUY"] < base["BUY"], fund_term


def test_la_penalizacion_es_monotona_y_nunca_empuja_a_comprar() -> None:
    """Más funding nunca puede favorecer al largo.

    Sin esta comprobación, un signo cambiado en la inyección pasaría inadvertido.
    """
    previo = 1.0
    for fund_term in (0.0, 0.25, 0.5, 0.75, 1.0, 2.0):
        p = infer_probs(0.4, 0.5, 0.06, 0.2, 1.0, 0.7, fund_term)
        assert p["BUY"] <= previo + 1e-12, fund_term
        previo = p["BUY"]

import pathlib

from trademe_quant.backtest import compute_metrics, evaluate_trade, run_backtest
from trademe_quant.ensemble import load_ensemble


def test_evaluate_trade_long_tp_and_sl() -> None:
    # LONG entry 100, stop 97, tp 106 (rr 2)
    tp = evaluate_trade("LONG", 100, 97, 106, [107], [99], [107])
    assert tp["result"] == "tp"
    assert tp["r"] == 2.0
    sl = evaluate_trade("LONG", 100, 97, 106, [101], [96], [96])
    assert sl["result"] == "sl"
    assert sl["r"] == -1.0


def test_evaluate_trade_worst_case_sl() -> None:
    # misma vela toca stop y tp -> peor caso SL
    res = evaluate_trade("LONG", 100, 97, 106, [110], [95], [100])
    assert res["result"] == "sl"


def test_compute_metrics() -> None:
    trades = [{"r": 2.0}, {"r": -1.0}, {"r": 2.0}, {"r": -1.0}]
    m = compute_metrics(trades)
    assert m["n_trades"] == 4
    assert m["win_rate"] == 0.5
    assert m["expectancy"] == 0.5
    assert m["profit_factor"] == 2.0


def test_run_backtest_smoke() -> None:
    # serie sintética; solo comprobamos que corre sin look-ahead y produce estructura
    n = 200
    high = [100 + i * 0.1 + 1 for i in range(n)]
    low = [100 + i * 0.1 - 1 for i in range(n)]
    close = [100 + i * 0.1 for i in range(n)]
    config = load_ensemble(pathlib.Path(__file__).parents[3] / "artifacts/ensemble.yaml")
    result = run_backtest(high, low, close, config, horizon=10)
    assert "trades" in result and "metrics" in result and "oos_metrics" in result
    assert result["metrics"]["n_trades"] >= 0

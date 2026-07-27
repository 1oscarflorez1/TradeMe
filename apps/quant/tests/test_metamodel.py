"""Tests del meta-modelo (Módulo 2)."""

from __future__ import annotations

import random
from typing import Any

import numpy as np

from trademe_quant.metamodel import (
    expectancy_with_filter,
    pick_threshold,
    row_to_features,
    train_metamodel,
)


def _row(i: int, good: bool) -> dict[str, Any]:
    """Snapshot sintético: las señales 'buenas' tienen net/confianza altos y ADX alto."""
    base = 0.6 if good else 0.1
    return {
        "captured_at": f"2026-07-{(i % 27) + 1:02d}T00:00:00Z",
        "price": 60000.0,
        "net": base + random.uniform(-0.05, 0.05),
        "confidence": 0.4 + base / 2,
        "prob_buy": 0.5,
        "prob_hold": 0.3,
        "prob_sell": 0.2,
        "adx14_value": 30 if good else 12,
        "atr14_value": 100.0,
        "ema_cross_score": base,
        "macd_score": base,
        "rsi14_score": 0.1,
        "bbands_score": 0.0,
        "stoch14_score": 0.0,
        "supertrend_score": base,
        "regime_label": "tendencia" if good else "rango",
        "direction": "LONG",
        "outcome_result": "tp" if good else "sl",
        "outcome_return_r": 2.0 if good else -1.0,
    }


def test_features_orden_y_longitud() -> None:
    v = row_to_features(_row(0, True))
    assert len(v) == 15
    assert v[6] == 100.0 / 60000.0  # atr relativo


def test_expectancy_con_filtro() -> None:
    probs = np.array([0.9, 0.2, 0.8, 0.1])
    rs = np.array([2.0, -1.0, 1.0, -1.0])
    e, n = expectancy_with_filter(probs, rs, 0.5)
    assert n == 2 and e == 1.5
    assert expectancy_with_filter(probs, rs, 0.99)[1] == 0


def test_pick_threshold_respeta_minimo() -> None:
    probs = np.linspace(0.1, 0.9, 20, dtype=np.float64)
    rs = np.where(probs > 0.5, 1.0, -1.0).astype(np.float64)
    t = pick_threshold(probs, rs, min_kept_ratio=0.3)
    assert 0.3 <= t <= 0.75


def test_no_entrena_con_dataset_pequeno() -> None:
    rows = [_row(i, i % 2 == 0) for i in range(20)]
    out = train_metamodel(rows)
    assert out["trained"] is False
    assert "insuficiente" in out["reason"]


def test_entrena_y_evalua_con_dataset_suficiente() -> None:
    random.seed(7)
    rows = [_row(i, i % 2 == 0) for i in range(120)]
    out = train_metamodel(rows)
    assert out["trained"] is True
    assert 0.0 <= out["auc"] <= 1.0
    assert out["features"][0] == "net"
    assert isinstance(out["promote"], bool)

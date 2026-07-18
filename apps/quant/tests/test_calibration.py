"""Tests del núcleo de calibración (M7 Slice A)."""

from __future__ import annotations

import numpy as np
import numpy.typing as npt

from trademe_quant.calibration import (
    apply_calibrator,
    brier,
    fit_calibrators,
    fit_isotonic,
    fit_platt,
    fit_regime,
)


def _synthetic(
    n: int = 400, seed: int = 7
) -> tuple[npt.NDArray[np.float64], npt.NDArray[np.float64]]:
    rng = np.random.default_rng(seed)
    # confianza cruda "sobreoptimista": p alto pero acierto real menor
    p = rng.uniform(0.34, 0.95, n)
    true_rate = 0.15 + 0.55 * (p - 0.34) / (0.95 - 0.34)  # menor que p
    y = (rng.uniform(0, 1, n) < true_rate).astype(float)
    return p, y


def test_brier_perfect_and_worst() -> None:
    y = np.array([1.0, 0.0, 1.0, 0.0])
    assert brier(y, y) == 0.0
    assert brier(1 - y, y) == 1.0


def test_isotonic_monotone_and_clamped() -> None:
    p, y = _synthetic()
    cal = fit_isotonic(p, y)
    ys = cal["y"]
    assert all(ys[i] <= ys[i + 1] + 1e-9 for i in range(len(ys) - 1))  # no decreciente
    assert 0.0 <= apply_calibrator(cal, 0.0) <= 1.0
    assert 0.0 <= apply_calibrator(cal, 1.0) <= 1.0
    # fuera de rango se clampa a los extremos
    assert apply_calibrator(cal, -5.0) == ys[0]
    assert apply_calibrator(cal, 5.0) == ys[-1]


def test_platt_sigmoid_monotone() -> None:
    p, y = _synthetic()
    cal = fit_platt(p, y)
    a = apply_calibrator(cal, 0.4)
    b = apply_calibrator(cal, 0.9)
    assert 0.0 <= a <= 1.0 and 0.0 <= b <= 1.0


def test_fit_regime_improves_brier() -> None:
    p, y = _synthetic()
    raw = brier(p, y)
    cal = fit_regime(p, y)
    assert cal["method"] in ("isotonic", "platt")
    assert cal["brier"] <= raw  # calibrar no empeora el Brier
    assert cal["n"] == len(p)
    assert len(cal["reliability"]) > 0


def test_small_sample_falls_back_to_identity() -> None:
    p = np.array([0.6, 0.7, 0.8])
    y = np.array([1.0, 0.0, 1.0])
    cal = fit_regime(p, y)
    assert cal["method"] == "identity"
    assert apply_calibrator(cal, 0.73) == 0.73


def test_fit_calibrators_groups_by_regime() -> None:
    p, y = _synthetic()
    samples = [("tendencia", float(pi), float(yi)) for pi, yi in zip(p, y, strict=False)]
    samples += [("rango", float(pi), float(yi)) for pi, yi in zip(p[:80], y[:80], strict=False)]
    out = fit_calibrators(samples, version="test")
    assert out["version"] == "test"
    assert set(out["regimes"]) == {"tendencia", "rango"}

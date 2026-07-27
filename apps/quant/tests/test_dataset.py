"""Tests del veredicto de preparación del dataset (Módulo 2 · fase 0)."""

from __future__ import annotations

from trademe_quant.dataset import readiness_from_counts


def test_listo_cuando_cumple_todo() -> None:
    v = readiness_from_counts(evaluated=80, tp=35, sl=30, feature_completeness=0.98)
    assert v["ready"] is True
    assert v["reasons"] == []


def test_no_listo_por_pocos_evaluados() -> None:
    v = readiness_from_counts(evaluated=10, tp=6, sl=4, feature_completeness=1.0)
    assert v["ready"] is False
    assert any("faltan decisiones" in r for r in v["reasons"])


def test_no_listo_por_desbalance() -> None:
    v = readiness_from_counts(evaluated=100, tp=95, sl=5, feature_completeness=1.0)
    assert v["ready"] is False
    assert any("minoritaria" in r for r in v["reasons"])


def test_no_listo_por_features() -> None:
    v = readiness_from_counts(evaluated=100, tp=50, sl=50, feature_completeness=0.5)
    assert v["ready"] is False
    assert any("features" in r for r in v["reasons"])

"""Tests del walk-forward con purga/embargo (M7 Slice B)."""

from __future__ import annotations

from trademe_quant.walkforward import in_test_folds, make_folds


def test_make_folds_cubre_rango_expanding() -> None:
    folds = make_folds(0, 100, 4)
    assert len(folds) == 4
    assert folds[0][0] == 0
    assert folds[-1][1] == 100
    # contiguos y crecientes
    for (a1, b1), (a2, _b2) in zip(folds, folds[1:], strict=False):
        assert b1 == a2
        assert a1 < b1


def test_embargo_separa_bloques() -> None:
    folds = make_folds(0, 100, 4, embargo=3)
    # el segundo bloque empieza 3 velas después del corte (25 -> 28)
    assert folds[1][0] == 28
    assert folds[0][0] == 0  # el primero no lleva embargo


def test_purga_por_horizonte() -> None:
    folds = [(0, 50)]
    # trade que cabe entero
    assert in_test_folds(10, 20, folds) is True
    # trade cuyo horizonte se sale del bloque -> purgado
    assert in_test_folds(40, 20, folds) is False
    # justo en el borde
    assert in_test_folds(30, 20, folds) is True
    assert in_test_folds(31, 20, folds) is False


def test_sin_folds_es_falso() -> None:
    assert in_test_folds(5, 10, []) is False
    assert make_folds(10, 10, 4) == []

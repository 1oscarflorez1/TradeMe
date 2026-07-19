"""Validación temporal walk-forward con purga y embargo (M7 · Slice B).

Evita la fuga temporal al seleccionar pesos: los trades solo cuentan para la validación
si caen COMPLETOS dentro de un bloque de test (purga del horizonte de etiqueta), y un
embargo separa cada bloque del anterior. Estilo *purged/embargoed k-fold* (López de Prado),
adaptado a una optimización de pesos globales evaluados out-of-sample.
"""

from __future__ import annotations


def make_folds(lo: int, hi: int, k: int, embargo: int = 0) -> list[tuple[int, int]]:
    """Divide [lo, hi) en k bloques de test contiguos (walk-forward expanding).

    El embargo recorta el inicio de cada bloque (salvo el primero) para separarlo del previo.
    """
    if k < 1 or hi <= lo:
        return []
    size = (hi - lo) / k
    folds: list[tuple[int, int]] = []
    for i in range(k):
        start = int(lo + i * size)
        end = int(lo + (i + 1) * size) if i < k - 1 else hi
        s = start + embargo if i > 0 else start
        if s < end:
            folds.append((s, end))
    return folds


def in_test_folds(idx: int, horizon: int, folds: list[tuple[int, int]]) -> bool:
    """True si el trade (idx..idx+horizon) cae COMPLETO en algún bloque (purga de horizonte)."""
    for a, b in folds:
        if idx >= a and idx + horizon <= b:
            return True
    return False

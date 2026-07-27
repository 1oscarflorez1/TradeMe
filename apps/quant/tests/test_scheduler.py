"""Tests de la política del piloto automático (lógica pura)."""

from __future__ import annotations

from trademe_quant.scheduler import is_degraded, should_calibrate, should_optimize


def test_degradacion_requiere_dos_negativas_y_muestra() -> None:
    assert is_degraded([-0.1, -0.05], [20, 15]) is True
    assert is_degraded([-0.1, 0.02], [30, 30]) is False
    assert is_degraded([-0.1, -0.2], [5, 5]) is False  # poca muestra
    assert is_degraded([-0.1], [100]) is False  # una sola medición no basta


def test_primera_optimizacion_siempre_toca() -> None:
    ok, reason = should_optimize(None, False, 168, 48)
    assert ok and "primera" in reason


def test_cooldown_bloquea_incluso_degradado() -> None:
    ok, _ = should_optimize(10, True, 168, 48)
    assert ok is False


def test_degradacion_dispara_tras_cooldown() -> None:
    ok, reason = should_optimize(72, True, 168, 48)
    assert ok and "degradación" in reason


def test_mantenimiento_semanal() -> None:
    ok, reason = should_optimize(200, False, 168, 48)
    assert ok and "mantenimiento" in reason
    ok2, _ = should_optimize(100, False, 168, 48)
    assert ok2 is False


def test_calibra_siempre_tras_promocion() -> None:
    ok, reason = should_calibrate(1.0, True, 168, 24)  # aunque el cooldown no haya pasado
    assert ok and "promoción" in reason


def test_primera_calibracion() -> None:
    ok, reason = should_calibrate(None, False, 168, 24)
    assert ok and "primera" in reason


def test_cooldown_bloquea_calibracion_rutinaria() -> None:
    assert should_calibrate(5.0, False, 168, 24)[0] is False


def test_calibracion_por_mantenimiento() -> None:
    ok, reason = should_calibrate(200.0, False, 168, 24)
    assert ok and "mantenimiento" in reason

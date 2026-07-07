"""Validación del artefacto ensemble.yaml consumido por apps/api.

En M3 solo se valida el esquema; la optimización (Optuna) llega en M7.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, cast

import yaml

REQUIRED_KEYS = ["version", "temperature", "hold_band", "weights", "external_weights", "regime"]


class EnsembleConfigError(ValueError):
    """El ensemble.yaml no cumple el esquema esperado."""


def _is_number(x: Any) -> bool:
    return isinstance(x, (int, float)) and not isinstance(x, bool)


def validate_ensemble(data: Any) -> None:
    if not isinstance(data, dict):
        raise EnsembleConfigError("el ensemble debe ser un mapping")
    for key in REQUIRED_KEYS:
        if key not in data:
            raise EnsembleConfigError(f"falta la clave requerida: {key}")
    if not _is_number(data["temperature"]) or data["temperature"] <= 0:
        raise EnsembleConfigError("temperature debe ser un número > 0")
    if not _is_number(data["hold_band"]) or data["hold_band"] < 0:
        raise EnsembleConfigError("hold_band debe ser un número >= 0")
    for section in ("weights", "external_weights"):
        block = data[section]
        if not isinstance(block, dict):
            raise EnsembleConfigError(f"{section} debe ser un mapping")
        for name, weight in block.items():
            if not _is_number(weight) or weight < 0:
                raise EnsembleConfigError(f"{section}.{name} debe ser un número >= 0")
    regime = data["regime"]
    if not isinstance(regime, dict) or "adx_threshold" not in regime:
        raise EnsembleConfigError("regime debe incluir adx_threshold")
    for phase in ("trend", "range"):
        if phase not in regime or not isinstance(regime[phase], dict):
            raise EnsembleConfigError(f"regime.{phase} debe ser un mapping")


def load_ensemble(path: str | Path) -> dict[str, Any]:
    data = yaml.safe_load(Path(path).read_text())
    validate_ensemble(data)
    return cast("dict[str, Any]", data)

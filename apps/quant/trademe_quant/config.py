from __future__ import annotations

import os
from dataclasses import dataclass

DEFAULT_TRACKING_URI = "file:./mlruns"
DEFAULT_ARTIFACTS_DIR = "../../artifacts"


@dataclass(frozen=True)
class QuantConfig:
    """Configuración del subsistema quant, poblada desde el entorno."""

    tracking_uri: str = DEFAULT_TRACKING_URI
    artifacts_dir: str = DEFAULT_ARTIFACTS_DIR

    @classmethod
    def from_env(cls) -> QuantConfig:
        return cls(
            tracking_uri=os.environ.get("MLFLOW_TRACKING_URI", DEFAULT_TRACKING_URI),
            artifacts_dir=os.environ.get("TRADEME_ARTIFACTS_DIR", DEFAULT_ARTIFACTS_DIR),
        )

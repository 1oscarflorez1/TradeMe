from __future__ import annotations

import os

from .config import DEFAULT_TRACKING_URI


def get_tracking_uri() -> str:
    """URI de tracking de MLflow (local por defecto)."""
    return os.environ.get("MLFLOW_TRACKING_URI", DEFAULT_TRACKING_URI)


def configure_mlflow(tracking_uri: str | None = None) -> str:
    """Configura MLflow con tracking local y devuelve la URI usada.

    El import de mlflow es perezoso para no penalizar utilidades que no lo necesiten.
    """
    uri = tracking_uri or get_tracking_uri()
    import mlflow

    mlflow.set_tracking_uri(uri)
    return uri

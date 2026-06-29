"""TradeMe quant: backtesting, optimización y entrenamiento/calibración (offline).

Su salida son los artefactos que `apps/api` consume (ver docs/contrato.md).
"""

from .config import QuantConfig
from .mlflow_setup import configure_mlflow, get_tracking_uri

__version__ = "0.0.0"

__all__ = ["QuantConfig", "configure_mlflow", "get_tracking_uri", "__version__"]

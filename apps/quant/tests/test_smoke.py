import pytest

import trademe_quant
from trademe_quant import QuantConfig, configure_mlflow, get_tracking_uri


def test_version() -> None:
    assert trademe_quant.__version__ == "0.0.0"


def test_config_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MLFLOW_TRACKING_URI", raising=False)
    cfg = QuantConfig.from_env()
    assert cfg.tracking_uri == "file:./mlruns"


def test_tracking_uri_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MLFLOW_TRACKING_URI", "file:/tmp/mlruns")
    assert get_tracking_uri() == "file:/tmp/mlruns"


def test_configure_mlflow_sets_uri() -> None:
    # En CI (Python 3.11 con mlflow-skinny) corre completo; en entornos sin
    # mlflow instalado se salta en vez de fallar.
    pytest.importorskip("mlflow")
    import mlflow

    uri = configure_mlflow("file:/tmp/mlruns-test")
    assert uri == "file:/tmp/mlruns-test"
    assert mlflow.get_tracking_uri() == "file:/tmp/mlruns-test"

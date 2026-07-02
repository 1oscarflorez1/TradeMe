# apps/quant — TradeMe (Python)

Subsistema offline: backtesting, optimización (Optuna), calibración y entrenamiento. Su salida son
los **artefactos** que `apps/api` consume (`ensemble.yaml`, `calibrators/`, `model.onnx`), descritos
en [`../../docs/contrato.md`](../../docs/contrato.md).

## Entorno

```bash
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

## Calidad

```bash
ruff check .
black --check .
mypy
pytest
```

En M0 el paquete solo expone la configuración y el tracking local de MLflow; el harness de
backtesting y el pipeline de entrenamiento llegan en M6–M7.

> MLflow se instala vía `mlflow-skinny` (tracking ligero, sin servidor/UI) para mantener el entorno
> y la CI ágiles. Se ampliará a `mlflow` completo si se necesita la UI.

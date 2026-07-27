"""Servicio HTTP del entorno quant: lanza backtest y optimización desde la API.

Arranca con: uvicorn trademe_quant.service:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import os
from typing import Any

from fastapi import FastAPI

from .dataset import dataset_report
from .run_backtest import run_and_save
from .run_optimize import optimize_and_publish
from .scheduler import automation_status, config_from_env, start_scheduler

app = FastAPI(title="TradeMe quant")
start_scheduler()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "trademe-quant"}


@app.post("/run-backtest")
def run_backtest_endpoint(symbol: str = "BTCUSDT", interval: str = "5m") -> dict[str, Any]:
    return run_and_save(symbol, interval)


@app.post("/run-optimize")
def run_optimize_endpoint(
    symbol: str = "BTCUSDT", interval: str = "5m", trials: int = 40
) -> dict[str, Any]:
    return optimize_and_publish(symbol, interval, trials)


@app.get("/dataset-report")
def dataset_report_endpoint() -> dict[str, Any]:
    dsn = os.environ.get("DATABASE_URL", "postgresql://trademe:trademe@localhost:5432/trademe")
    return dataset_report(dsn)


@app.get("/automation")
def automation_endpoint() -> dict[str, Any]:
    return automation_status(config_from_env())

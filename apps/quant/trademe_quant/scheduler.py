"""Piloto automático del backtest (medir seguido, optimizar solo cuando toca).

Política:
- MEDIR: backtest de cada símbolo+TF activo cada `backtest_every_h` horas (evalúa snapshots).
- OPTIMIZAR: solo si (a) nunca se optimizó ese TF, (b) mantenimiento cada `optimize_every_h`,
  o (c) degradación (últimas 2 mediciones con expectancy < 0 y trades suficientes) — siempre
  respetando un cooldown y el gate de hold-out del optimizador.
- AVISAR: alerta en la campana solo ante promoción o degradación sin mejora.
"""

from __future__ import annotations

import json
import os
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path

from .db import insert_alert, last_backtests
from .ensemble import artifacts_dir


@dataclass
class AutoConfig:
    enabled: bool = True
    symbols: list[str] = field(default_factory=lambda: ["BTCUSDT"])
    intervals: list[str] = field(default_factory=lambda: ["15m", "30m", "1h", "4h", "1d"])
    backtest_every_h: float = 6.0
    optimize_every_h: float = 24.0 * 7
    cooldown_h: float = 48.0
    trials: int = 40
    min_trades_degradation: int = 30


def _config_path() -> Path:
    return artifacts_dir() / "automation.json"


def save_config_overrides(data: dict[str, object]) -> None:
    """Guarda overrides de la política (editables desde la UI). El piloto los relee cada ciclo."""
    path = _config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    current: dict[str, object] = {}
    if path.exists():
        try:
            current = json.loads(path.read_text())
        except Exception:  # noqa: BLE001
            current = {}
    current.update(data)
    path.write_text(json.dumps(current, indent=2))


def load_config() -> AutoConfig:
    """Config efectiva: defaults de env + overrides de artifacts/automation.json (UI)."""
    cfg = config_from_env()
    path = _config_path()
    if path.exists():
        try:
            o = json.loads(path.read_text())
        except Exception:  # noqa: BLE001
            return cfg
        if isinstance(o.get("enabled"), bool):
            cfg.enabled = o["enabled"]
        for k in ("backtest_every_h", "optimize_every_h", "cooldown_h"):
            if isinstance(o.get(k), (int, float)) and o[k] > 0:
                setattr(cfg, k, float(o[k]))
        if isinstance(o.get("trials"), int) and 5 <= o["trials"] <= 200:
            cfg.trials = o["trials"]
        if isinstance(o.get("intervals"), list) and o["intervals"]:
            cfg.intervals = [str(x) for x in o["intervals"]]
    return cfg


def config_from_env() -> AutoConfig:
    def _list(name: str, default: str) -> list[str]:
        return [x.strip() for x in os.environ.get(name, default).split(",") if x.strip()]

    return AutoConfig(
        enabled=os.environ.get("AUTO_ENABLED", "true").lower() == "true",
        symbols=_list("AUTO_SYMBOLS", "BTCUSDT"),
        intervals=_list("AUTO_INTERVALS", "15m,30m,1h,4h,1d"),
        backtest_every_h=float(os.environ.get("AUTO_BACKTEST_EVERY_H", "6")),
        optimize_every_h=float(os.environ.get("AUTO_OPTIMIZE_EVERY_H", str(24 * 7))),
        cooldown_h=float(os.environ.get("AUTO_OPT_COOLDOWN_H", "48")),
        trials=int(os.environ.get("AUTO_TRIALS", "40")),
    )


def is_degraded(expectancies: list[float], trades: list[int], min_trades: int = 30) -> bool:
    """Degradación = las DOS últimas mediciones en negativo con muestra suficiente."""
    if len(expectancies) < 2:
        return False
    return all(e < 0 for e in expectancies[:2]) and sum(trades[:2]) >= min_trades


def should_optimize(
    hours_since_opt: float | None,
    degraded: bool,
    every_h: float,
    cooldown_h: float,
) -> tuple[bool, str]:
    """Decide si toca optimizar y por qué (lógica pura, testeable)."""
    if hours_since_opt is None:
        return True, "primera optimización de esta temporalidad"
    if hours_since_opt < cooldown_h:
        return False, ""
    if degraded:
        return True, "degradación detectada (expectancy negativa sostenida)"
    if hours_since_opt >= every_h:
        return True, "mantenimiento programado"
    return False, ""


def hours_since_optimize(symbol: str, interval: str) -> float | None:
    p = artifacts_dir() / "optimized" / f"report.{symbol.upper()}.{interval}.json"
    if not p.exists():
        return None
    return (time.time() - p.stat().st_mtime) / 3600.0


def _dsn() -> str:
    return os.environ.get("DATABASE_URL", "postgresql://trademe:trademe@localhost:5432/trademe")


def run_cycle(cfg: AutoConfig) -> list[str]:
    """Una pasada: mide lo vencido y optimiza solo cuando toca. Devuelve un log."""
    from .run_backtest import run_and_save
    from .run_optimize import optimize_and_publish

    log: list[str] = []
    dsn = _dsn()
    for symbol in cfg.symbols:
        for iv in cfg.intervals:
            try:
                past = last_backtests(dsn, symbol, iv, 2)
                due = not past or past[0]["hours_ago"] >= cfg.backtest_every_h
                if due:
                    run_and_save(symbol, iv)
                    past = last_backtests(dsn, symbol, iv, 2)
                    log.append(f"medido {symbol} {iv}")
                degraded = is_degraded(
                    [p["expectancy"] for p in past],
                    [p["n_trades"] for p in past],
                    cfg.min_trades_degradation,
                )
                ok, reason = should_optimize(
                    hours_since_optimize(symbol, iv), degraded, cfg.optimize_every_h, cfg.cooldown_h
                )
                if not ok:
                    continue
                report = optimize_and_publish(symbol, iv, cfg.trials)
                run_and_save(symbol, iv)  # re-medir con la config activa resultante
                log.append(f"optimizado {symbol} {iv} ({reason}; promovido={report['promoted']})")
                if report["promoted"]:
                    insert_alert(
                        dsn,
                        "auto_optimize",
                        "success",
                        f"Optimización promovida · {iv}",
                        f"{symbol} {iv}: nueva config activa ({reason}). "
                        "Ganó en hold-out; backtest re-medido.",
                        symbol,
                        iv,
                    )
                elif degraded:
                    insert_alert(
                        dsn,
                        "auto_optimize",
                        "warning",
                        f"Degradación sin mejora · {iv}",
                        f"{symbol} {iv}: expectancy negativa sostenida; el optimizador no halló "
                        "una config que gane en hold-out. Revisar estrategia en esta temporalidad.",
                        symbol,
                        iv,
                    )
            except Exception as err:  # noqa: BLE001 - el piloto no debe morir por un TF
                log.append(f"error {symbol} {iv}: {err}")
    return log


_state: dict[str, object] = {"last_cycle": None, "last_log": []}


def automation_status(cfg: AutoConfig) -> dict[str, object]:
    per_tf = []
    dsn = _dsn()
    for symbol in cfg.symbols:
        for iv in cfg.intervals:
            try:
                past = last_backtests(dsn, symbol, iv, 1)
                bt_h = past[0]["hours_ago"] if past else None
            except Exception:  # noqa: BLE001
                bt_h = None
            per_tf.append(
                {
                    "symbol": symbol,
                    "interval": iv,
                    "hours_since_backtest": bt_h,
                    "hours_since_optimize": hours_since_optimize(symbol, iv),
                }
            )
    return {
        "enabled": cfg.enabled,
        "backtest_every_h": cfg.backtest_every_h,
        "optimize_every_h": cfg.optimize_every_h,
        "cooldown_h": cfg.cooldown_h,
        "intervals": cfg.intervals,
        "last_cycle": _state["last_cycle"],
        "last_log": _state["last_log"],
        "per_tf": per_tf,
    }


def start_scheduler() -> None:
    def loop() -> None:
        time.sleep(60)  # dejar arrancar API/DB
        while True:
            try:
                cfg = load_config()  # la UI puede haber cambiado la política
                log = run_cycle(cfg) if cfg.enabled else []
                _state["last_cycle"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                if log:
                    _state["last_log"] = log[-10:]
            except Exception:  # noqa: BLE001
                pass
            time.sleep(15 * 60)  # re-evaluar cada 15 min (las acciones se gatean por horas)

    threading.Thread(target=loop, daemon=True, name="trademe-auto").start()

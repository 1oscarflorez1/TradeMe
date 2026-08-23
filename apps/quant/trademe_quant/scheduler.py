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
    # Calibración: siempre tras promoción + mantenimiento semanal (cooldown para no ajustar ruido).
    calibrate_every_h: float = 24.0 * 7
    calibrate_cooldown_h: float = 24.0
    # Meta-modelo (Módulo 2): reentrena con los registros nuevos cada N horas.
    metamodel_every_h: float = 12.0


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
        for k in (
            "backtest_every_h",
            "optimize_every_h",
            "cooldown_h",
            "calibrate_every_h",
            "metamodel_every_h",
        ):
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
        calibrate_every_h=float(os.environ.get("AUTO_CALIBRATE_EVERY_H", str(24 * 7))),
        calibrate_cooldown_h=float(os.environ.get("AUTO_CALIBRATE_COOLDOWN_H", "24")),
        metamodel_every_h=float(os.environ.get("AUTO_METAMODEL_EVERY_H", "12")),
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


def _hours_since_file(name: str) -> float | None:
    p = artifacts_dir() / name
    if not p.exists():
        return None
    return (time.time() - p.stat().st_mtime) / 3600.0


def should_calibrate(
    hours_since_cal: float | None, promoted: bool, every_h: float, cooldown_h: float
) -> tuple[bool, str]:
    """Recalibrar: SIEMPRE tras una promoción (los parámetros nuevos cambian la confianza),
    y por mantenimiento periódico (la relación confianza→acierto deriva con el mercado).
    El cooldown evita recalibrar con muestras pequeñas una y otra vez."""
    if hours_since_cal is None:
        return True, "primera calibración"
    if promoted:
        return True, "tras promoción (parámetros nuevos)"
    if hours_since_cal < cooldown_h:
        return False, ""
    if hours_since_cal >= every_h:
        return True, "mantenimiento periódico"
    return False, ""


def hours_since_optimize(symbol: str, interval: str) -> float | None:
    p = artifacts_dir() / "optimized" / f"report.{symbol.upper()}.{interval}.json"
    if not p.exists():
        return None
    return (time.time() - p.stat().st_mtime) / 3600.0


def watchlist_symbols(dsn: str) -> list[str]:
    """Activos seguidos según la base de datos (la UI los gestiona). Vacío si no hay tabla."""
    import psycopg

    try:
        with psycopg.connect(dsn) as conn, conn.cursor() as cur:
            cur.execute("SELECT symbol FROM watchlist WHERE enabled = true ORDER BY added_at")
            return [str(r[0]) for r in cur.fetchall()]
    except Exception:  # noqa: BLE001 - si aún no existe, se usa la config de entorno
        return []


def _dsn() -> str:
    return os.environ.get("DATABASE_URL", "postgresql://trademe:trademe@localhost:5432/trademe")


def run_cycle(cfg: AutoConfig) -> list[str]:
    """Una pasada: mide lo vencido y optimiza solo cuando toca. Devuelve un log."""
    from .meta_policy import decide_mode, evaluate_shadow, load_policy, save_policy
    from .run_backtest import run_and_save
    from .run_calibration import calibrate_and_publish
    from .run_metamodel import fetch_shadow_rows, train_and_publish
    from .run_optimize import optimize_and_publish

    log: list[str] = []
    dsn = _dsn()
    symbols = watchlist_symbols(dsn) or cfg.symbols
    for symbol in symbols:
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

                # Auditoría de coherencia del régimen. El espacio de búsqueda de Optuna propone cada
                # peso entre 0 y 2 sin restricción de orden, así que puede publicar —y publicaba, en
                # 12 de 15 claves— configuraciones donde la reversión pesa más que la tendencia EN
                # RÉGIMEN DE TENDENCIA. Cuando eso pasa, el `regime_label` que se guarda en cada
                # decisión deja de describir el mecanismo que se aplicó.
                #
                # Solo avisa: restringir la búsqueda cambiaría lo que la plataforma opera y esa es
                # una decisión aparte. Lo que faltaba era que alguien lo señalara.
                if report["promoted"]:
                    try:
                        from .regimen import auditar

                        diag = auditar(report.get("config") or {})
                        if not diag.coherente:
                            log.append(f"⚠ régimen incoherente {symbol} {iv}: {diag.resumen()}")
                            insert_alert(
                                dsn,
                                "regimen_incoherente",
                                "warning",
                                f"{symbol} {iv}: el régimen no significa lo que dice",
                                f"La configuración promovida invierte la conmutación por régimen "
                                f"({diag.resumen()}). El `regime_label` de sus decisiones ya no "
                                f"describe los pesos que se aplican.",
                                symbol,
                                iv,
                            )
                    except Exception as err:  # noqa: BLE001 - auditar nunca puede tumbar el ciclo
                        log.append(f"error auditoría de régimen: {err}")
                cal_ok, cal_reason = should_calibrate(
                    _hours_since_file("calibrators.json"),
                    bool(report["promoted"]),
                    cfg.calibrate_every_h,
                    cfg.calibrate_cooldown_h,
                )
                if cal_ok:
                    # Todos los símbolos, no solo el que acaba de optimizarse: el artefacto es uno
                    # y publicarlo con un único activo borraría los calibradores de los demás.
                    calibrate_and_publish(symbols, iv)
                    log.append(f"calibrado {symbols} {iv} ({cal_reason})")
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

    # Independencia de los votos: se remide en cada ciclo porque es barato (una matriz 6x6 por
    # símbolo y temporalidad) y porque su valor cambia con el régimen de mercado. Si no hay muestra
    # suficiente para una clave, simplemente no se publica y la API no desinfla nada.
    try:
        from .independence import publish as publish_independence

        datos = publish_independence(artifacts_dir(), dsn)
        n_claves = len(datos["entries"])
        if n_claves:
            peor = min(datos["entries"].items(), key=lambda kv: float(kv[1]["effective"]))
            log.append(
                f"independencia medida en {n_claves} claves "
                f"(la más colapsada: {peor[0]} con {peor[1]['effective']:.2f} votos efectivos)"
            )
        else:
            log.append("independencia: sin muestra suficiente todavía")
    except Exception as err:  # noqa: BLE001 - sin independencia se decide sin desinflar
        log.append(f"error independencia: {err}")

    # Data Intelligence Layer (M11): trae los datos externos y los guarda con su fecha de
    # conocimiento. NO decide nada — el Fundamental Score es M12. Cada fuente va aislada: si una
    # cae, se anota en `data_sources` y las demás siguen.
    #
    # Los proveedores se construyen con **los símbolos de la watchlist**, no con el valor por
    # defecto. Hasta 0.38.2 se llamaba a `run_once(dsn)` a secas, que cae en `default_providers()`
    # con `["BTCUSDT"]` cableado: cualquier activo añadido después quedaba sin funding, sin interés
    # abierto y sin long/short, y por tanto con el Fundamental Score `stale` para siempre. Se veía
    # en la base de datos —`derivatives_metrics` tenía tres filas, todas de BTCUSDT— pero no en
    # ningún error, porque «no hay datos» es un estado válido del score.
    try:
        from .dil import default_providers
        from .dil import run_once as dil_run_once

        for linea in dil_run_once(dsn, default_providers(symbols)):
            log.append(f"datos: {linea}")
    except Exception as err:  # noqa: BLE001 - sin datos externos el motor decide igual que hoy
        log.append(f"error datos externos: {err}")

    # Fundamental Score (M12): publica la distribución de referencia del funding de cada símbolo.
    # Va DESPUÉS de la DIL a propósito — usa lo que esa acaba de guardar. Sigue sin decidir nada:
    # el score está en sombra y la penalización efectiva es 0 hasta que demuestre su lift.
    try:
        from .run_fundamental import publish as publish_fundamental

        for linea in publish_fundamental(dsn, symbols):
            log.append(f"fundamental: {linea}")
    except Exception as err:  # noqa: BLE001 - sin score el motor decide igual que hoy
        log.append(f"error fundamental: {err}")

    # Gestor de Correlaciones: mide cuántos activos INDEPENDIENTES hay de verdad. Va antes del
    # gobierno porque este lo usa para descontar la muestra: cuatro activos cripto correlacionados
    # a 0,7-0,8 valen 1,52 efectivos, así que 134 decisiones pueden ser evidencia de unas 50.
    try:
        from .correlaciones import publish as publish_correlaciones

        corr = publish_correlaciones(artifacts_dir(), symbols)
        if corr.get("matrix"):
            log.append(
                f"correlaciones: {corr['nominales']} activos -> "
                f"{corr['efectivos']:.2f} efectivos (factor {corr['factor']:.3f})"
            )
        else:
            log.append("correlaciones: sin muestra suficiente, no se descuenta nada")
    except (
        Exception
    ) as err:  # noqa: BLE001 - sin medición no se descuenta; nunca relaja el criterio
        log.append(f"error correlaciones: {err}")

    # Gobierno del Fundamental Score: mide su expediente sombra y decide si ya se ha ganado el
    # derecho a influir. Va después de publicar las distribuciones porque juzga lo que estas
    # produjeron. Como todo lo demás aquí: asciende con evidencia y retrocede al perderla.
    try:
        from .fundamental_policy import publish as publish_fund_policy

        fpol = publish_fund_policy(artifacts_dir(), dsn)
        if fpol["changed"]:
            log.append(f"fundamental: modo -> {fpol['mode']} ({fpol['reason']})")
            insert_alert(
                dsn,
                "fundamental_policy",
                "warning" if fpol["mode"] == "active" else "success",
                f"Fundamental Score: modo {fpol['mode']}",
                str(fpol["reason"]),
                None,
                None,
            )
        else:
            log.append(f"fundamental: sigue en {fpol['mode']} ({fpol['reason']})")
    except Exception as err:  # noqa: BLE001 - sin política, manda ensemble.yaml
        log.append(f"error política fundamental: {err}")

    # Gobierno de la cuarentena: mide el expediente sombra de las temporalidades vetadas y el
    # rendimiento real de las que operan, y decide. Sin esto, `quarantine_intervals` sería una
    # lista fija que alguien tendría que acordarse de vaciar.
    try:
        from .ensemble import load_ensemble
        from .quarantine_policy import publish as publish_quarantine

        base = load_ensemble(artifacts_dir() / "ensemble.yaml")
        vetadas = [str(x) for x in base.get("quarantine_intervals", [])]
        qtn = publish_quarantine(artifacts_dir(), dsn, vetadas)
        cambios = [v for v in qtn["intervals"].values() if v["changed"]]
        for c in cambios:
            estado = "entra en" if c["quarantined"] else "sale de"
            log.append(f"cuarentena: {c['interval']} {estado} cuarentena — {c['reason']}")
            insert_alert(
                dsn,
                "cuarentena",
                "warning" if c["quarantined"] else "success",
                f"{c['interval']}: {estado} cuarentena",
                c["reason"],
                None,
                c["interval"],
            )
        if not cambios:
            log.append(f"cuarentena revisada ({len(qtn['intervals'])} claves, sin cambios)")
    except Exception as err:  # noqa: BLE001 - sin política, manda ensemble.yaml
        log.append(f"error cuarentena: {err}")

    # Calibración de mantenimiento (independiente de que haya habido optimización).
    try:
        cal_ok, cal_reason = should_calibrate(
            _hours_since_file("calibrators.json"),
            False,
            cfg.calibrate_every_h,
            cfg.calibrate_cooldown_h,
        )
        if cal_ok and symbols and cfg.intervals:
            # Con `symbols` (la watchlist), no con `cfg.symbols` (el entorno): el artefacto lleva
            # un juego de calibradores por activo y se escribe de una vez. Publicarlos por separado
            # haría que el último borrase a los anteriores.
            cal_out = calibrate_and_publish(symbols, cfg.intervals[0])
            log.append(f"calibrado {cal_out['por_simbolo']} {cfg.intervals[0]} ({cal_reason})")
    except Exception as err:  # noqa: BLE001
        log.append(f"error calibración: {err}")

    # Meta-modelo (Módulo 2): reentrena con los registros nuevos; publica solo si mejora.
    try:
        mm_age = _hours_since_file("metamodel.json")
        if mm_age is None or mm_age >= cfg.metamodel_every_h:
            out = train_and_publish(dsn)
            if out.get("trained"):
                log.append(
                    f"meta-modelo n={out['n']} AUC={out['auc']:.2f} "
                    f"publicado={out.get('published')}"
                )
                # Política automática: ¿ya se ganó el derecho a influir en las decisiones?
                try:
                    art = artifacts_dir()
                    pol = load_policy(art)
                    thr = float(out.get("threshold") or 0.5)
                    ev = evaluate_shadow(fetch_shadow_rows(dsn), thr)
                    new_mode, why = decide_mode(
                        str(pol.get("mode", "shadow")),
                        ev,
                        os.environ.get("META_MAX_MODE", "veto"),
                    )
                    if new_mode != pol.get("mode"):
                        save_policy(art, new_mode, why, ev)
                        insert_alert(
                            dsn,
                            "metamodel",
                            "success" if new_mode != "shadow" else "warning",
                            f"Meta-modelo: modo {new_mode}",
                            f"{why}. Cambia cómo influye el filtro ML en las decisiones.",
                        )
                        log.append(f"meta-política -> {new_mode} ({why})")
                    else:
                        save_policy(art, str(pol.get("mode", "shadow")), why, ev)
                except Exception as err:  # noqa: BLE001
                    log.append(f"error meta-política: {err}")
                if out.get("published"):
                    insert_alert(
                        dsn,
                        "metamodel",
                        "success",
                        "Meta-modelo actualizado",
                        f"Entrenado con {out['n']} decisiones evaluadas (AUC {out['auc']:.2f}). "
                        f"Filtra señales por debajo de {out['threshold']:.0%} de probabilidad de "
                        "éxito; mejora la expectancy en validación.",
                    )
    except Exception as err:  # noqa: BLE001
        log.append(f"error meta-modelo: {err}")
    return log


_state: dict[str, object] = {"last_cycle": None, "last_log": []}


def _meta_policy_summary() -> dict[str, object]:
    from .meta_policy import load_policy

    pol = load_policy(artifacts_dir())
    return {
        "mode": pol.get("mode"),
        "reason": pol.get("reason"),
        "updated_at": pol.get("updated_at"),
        "evidence": pol.get("evidence"),
    }


def automation_status(cfg: AutoConfig) -> dict[str, object]:
    per_tf = []
    dsn = _dsn()
    symbols = watchlist_symbols(dsn) or cfg.symbols
    for symbol in symbols:
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
        "calibrate_every_h": cfg.calibrate_every_h,
        "metamodel_every_h": cfg.metamodel_every_h,
        "hours_since_calibration": _hours_since_file("calibrators.json"),
        "hours_since_metamodel": _hours_since_file("metamodel.json"),
        "meta_policy": _meta_policy_summary(),
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

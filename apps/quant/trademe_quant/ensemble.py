"""Validación del artefacto ensemble.yaml consumido por apps/api.

En M3 solo se valida el esquema; la optimización (Optuna) llega en M7.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, cast

import yaml

REQUIRED_KEYS = [
    "version",
    "temperature",
    "hold_band",
    "weights",
    "external_weights",
    "regime",
    "risk",
]
RISK_KEYS = ["atr_stop_mult", "tp_r_multiple", "risk_pct"]


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
    risk = data["risk"]
    if not isinstance(risk, dict):
        raise EnsembleConfigError("risk debe ser un mapping")
    for key in RISK_KEYS:
        if key not in risk or not _is_number(risk[key]) or risk[key] < 0:
            raise EnsembleConfigError(f"risk.{key} debe ser un número >= 0")


def load_ensemble(path: str | Path) -> dict[str, Any]:
    data = yaml.safe_load(Path(path).read_text())
    validate_ensemble(data)
    return cast("dict[str, Any]", data)


def artifacts_dir() -> Path:
    """Carpeta de artefactos (override con ARTIFACTS_DIR para tests/despliegues)."""
    return Path(
        os.environ.get("ARTIFACTS_DIR", str(Path(__file__).resolve().parents[3] / "artifacts"))
    )


#: Lo ÚNICO que Optuna busca, y por tanto lo único que una configuración optimizada puede aportar.
#: Coincide con los `trial.suggest_*` de `optimize.py`. Es una lista **blanca** a propósito: lo que
#: no esté aquí viene de la base, así que una sección nueva del yaml queda protegida por defecto en
#: vez de quedar olvidada hasta que alguien note que no se aplica.
CAMPOS_OPTIMIZABLES = ("temperature", "hold_band", "weights")
#: Dentro de `regime`, solo el escalado por ADX y los multiplicadores. `adx_threshold` no se busca.
REGIME_OPTIMIZABLES = ("adx_lo", "adx_hi", "trend", "range")


def fusionar_optimizada(base: dict[str, Any], opt: dict[str, Any]) -> dict[str, Any]:
    """Aplica sobre la base **solo lo que Optuna optimiza**. Todo lo demás manda la base.

    El fallo que esto corrige (7 sep 2026)
    ---------------------------------------
    El optimizador publica una **copia completa** del yaml, pero solo busca doce cosas: los seis
    pesos, `hold_band`, `temperature`, `adx_lo`, `adx_width` y los multiplicadores de régimen. Y
    quien la consumía —aquí y en `server.ts`— la cargaba **entera**, sustituyendo la base.

    El resultado es que cada clave con configuración optimizada quedaba **congelada en el estado de
    gobierno del día en que se generó**. Las quince que había el 7 de septiembre de 2026 eran de
    agosto, y por tanto aplicaban:

    - **sin sección `costs`** — se medían en bruto, tres de las cuatro claves de 1d incluidas;
    - `quarantine_intervals: ['4h']` — la cuarentena estructural de 15m, 30m y 1h no les llegaba;
    - `external_weights.tradingview: 2.0` — cuando la base lo puso a 0 (sombra) en 0.62.0.

    Lo caro no fue lo que hacía, sino lo que hizo creer: `docs/costes.md` daba **+0,020 R netos**
    para 1d, y ese número sale de medir la configuración **base**. Con la que de verdad opera, y
    aplicándole los costes que le faltaban, 1d da **−0,019 R**. El listón de viabilidad de `alfa.py`
    se ancló en el primero.

    Es el mismo patrón que este proyecto ya ha corregido varias veces —un mecanismo que mide algo
    parecido a lo que dice medir— y aquí en el punto más silencioso: nada fallaba, solo se aplicaba
    una configuración vieja sin que nadie lo dijera.
    """
    fusionada = dict(base)
    for campo in CAMPOS_OPTIMIZABLES:
        if campo in opt:
            fusionada[campo] = opt[campo]
    regime_base = dict(base.get("regime", {}))
    regime_opt = opt.get("regime", {})
    if isinstance(regime_opt, dict):
        for campo in REGIME_OPTIMIZABLES:
            if campo in regime_opt:
                regime_base[campo] = regime_opt[campo]
    fusionada["regime"] = regime_base
    # La versión sí viaja: es la identidad del artefacto que se está aplicando, y la interfaz y los
    # informes la muestran para saber qué configuración produjo cada decisión.
    if "version" in opt:
        fusionada["version"] = opt["version"]
    return fusionada


def load_active_ensemble(symbol: str, interval: str) -> dict[str, Any]:
    """Config ACTIVA para un símbolo+temporalidad: la base, con lo optimizado de esa clave encima.

    Es la misma regla que aplica la API en vivo: así el backtest mide exactamente lo que decide el
    sistema para esa temporalidad. Ver `fusionar_optimizada` para por qué es una fusión y no una
    sustitución — lo era hasta el 7 de septiembre de 2026, y salía caro.
    """
    base = load_ensemble(artifacts_dir() / "ensemble.yaml")
    opt = artifacts_dir() / "optimized" / f"ensemble.{symbol.upper()}.{interval}.yaml"
    if not opt.exists():
        return base
    return fusionar_optimizada(base, load_ensemble(opt))

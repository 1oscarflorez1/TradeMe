"""CLI: entrena calibradores de probabilidad por régimen y por símbolo, desde el backtest.

Uso: python -m trademe_quant.run_calibration 5m BTCUSDT ETHUSDT SOLUSDT

Reproduce el backtest (sin look-ahead), toma cada trade como un par
(confianza prevista, acierto real) segmentado por régimen, ajusta el calibrador
(isotónica o Platt, el de menor Brier) y exporta el artefacto que consume la API.

**Por símbolo, desde el multiactivo.** Hasta 0.38.2 el artefacto era único y se entrenaba con un
solo activo (su versión lo delataba: `cal-BTCUSDT-30m`). Con varios activos eso significaría
enseñar la calibración de BTC en el panel de ETH: un número plausible, con la etiqueta correcta, y
falso. La calibración responde a «¿cuánto vale una confianza del 70 % *en este mercado*?», y esa
respuesta no se transfiere entre activos.
"""

from __future__ import annotations

import json
import os
import pathlib
import sys
import time

from .backtest import run_backtest
from .calibration import fit_calibrators
from .ensemble import load_active_ensemble
from .market.binance import VELAS_POR_DEFECTO
from .velas import series


def _repo_artifact(name: str) -> str:
    return str(pathlib.Path(__file__).resolve().parents[3] / "artifacts" / name)


def _samples_for(
    symbol: str, interval: str, velas: int = VELAS_POR_DEFECTO
) -> list[tuple[str, float, float]]:
    """Pares (régimen, confianza prevista, acierto) del backtest de un símbolo."""
    high, low, close = series(symbol, interval, velas)

    config = load_active_ensemble(symbol, interval)
    result = run_backtest(high, low, close, config)

    return [
        (str(t["regime"]), float(t["confidence"]), 1.0 if float(t["r"]) > 0 else 0.0)
        for t in result["trades"]
        if "regime" in t and "confidence" in t
    ]


def calibrate_and_publish(symbols: list[str], interval: str) -> dict[str, object]:
    """Entrena un juego de calibradores por símbolo y publica un único artefacto.

    Se escribe de una vez con todos los símbolos: si cada uno se publicara por separado, el último
    borraría a los anteriores, que es lo que hacía la versión anterior sin que se notara —había un
    solo activo—.

    Un símbolo cuyo backtest no da trades se **omite** del artefacto. La api lo interpreta como
    «sin calibración» y no muestra confianza calibrada, en vez de heredar la de otro activo.
    """
    por_simbolo: dict[str, object] = {}
    detalle: dict[str, int] = {}
    for symbol in symbols:
        sym = symbol.upper()
        try:
            samples = _samples_for(sym, interval)
        except Exception:  # noqa: BLE001 - un símbolo sin histórico no impide calibrar los demás
            detalle[sym] = 0
            continue
        detalle[sym] = len(samples)
        if not samples:
            continue
        por_simbolo[sym] = fit_calibrators(samples)["regimes"]

    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    artefacto = {
        "version": f"cal-{interval}-{now}",
        "created_at": now,
        "interval": interval,
        "symbols": por_simbolo,
    }

    out_path = os.environ.get("CALIBRATORS_PATH", _repo_artifact("calibrators.json"))
    pathlib.Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(artefacto, fh, indent=2)

    return {
        "samples": sum(detalle.values()),
        "por_simbolo": detalle,
        "version": artefacto["version"],
        "path": out_path,
    }


def main() -> None:
    interval = sys.argv[1] if len(sys.argv) > 1 else "5m"
    symbols = sys.argv[2:] or ["BTCUSDT"]
    out = calibrate_and_publish(symbols, interval)
    print(f"calibradores {out['por_simbolo']} -> {out['path']}")


if __name__ == "__main__":
    main()

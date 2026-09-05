"""¿Aporta Optuna algo sobre la configuración base? Informe sobre las claves de producción.

Uso: python -m trademe_quant.run_optimizador_estudio [n_trials]

La pregunta
------------
Hasta 0.60.0 no se podía responder. El hold-out eran 25 operaciones y con esa muestra la diferencia
entre una mejora y una racha no es medible; el guardia de promoción frenaba el 100 % y tenía razón.
Con 20.000 velas el hold-out pasa a 445-543, y la pregunta se vuelve contestable.

Tres condiciones, sobre el mismo hold-out intacto
--------------------------------------------------
- **manual** — el `ensemble.yaml` escrito a mano en M3, sin optimizar nunca.
- **activa** — la configuración que esa clave opera hoy. En 15 de las 20 es una optimizada de
  agosto, así que «activa» **no** es sinónimo de «a mano»: distinguirlas es lo que separa «Optuna no
  mejora lo que ya hay» de «Optuna no mejora el diseño manual», que son dos afirmaciones distintas.
- **libre** — Optuna con el espacio de siempre: `suggest_float(0.0, 2.0)` sin restricción de orden.
- **coherente** — Optuna con la conmutación de régimen obligada a significar lo que dice: en
  tendencia manda la familia direccional, en rango la de reversión.

La tercera existe porque la segunda tenía una salida fácil: 6 de las 15 configuraciones publicadas
invertían el régimen, así que «Optuna no aporta» podía ser «Optuna busca en un espacio que permite
configuraciones incoherentes» y no «la búsqueda no sirve». Separar las dos cosas es el objeto de
este estudio.

El criterio, fijado ANTES de ver resultados
--------------------------------------------
Se reutiliza `promocion.decidir`, el mismo guardia de producción: muestra ≥ 25 operaciones,
expectancy ≥ +0,05 R y superar el P95 de una nula por bloques. Y por encima de las claves sueltas,
la pregunta agregada:

    Optuna aporta si gana a la base en MÁS DE LA MITAD de las claves con muestra suficiente.

Se cuenta por claves y no promediando expectancies porque las claves comparten mercado —cuatro
activos que la plataforma calcula como 1,46 independientes— y promediar sobre ellas volvería a
inflar la evidencia, que es el error que ya se cometió una vez con las decisiones.
"""

from __future__ import annotations

import json
import sys
import time
from typing import Any

from .ensemble import artifacts_dir, load_active_ensemble, load_ensemble
from .market.binance import VELAS_POR_DEFECTO
from .optimize import _holdout_expectancy, optimize_weights
from .velas import series

#: Claves que opera la plataforma.
SIMBOLOS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]
INTERVALOS = ["15m", "30m", "1h", "4h", "1d"]
#: Mínimo de operaciones en hold-out para que una clave entre en el recuento.
MIN_HOLDOUT = 25


def estudiar_clave(
    symbol: str, interval: str, n_trials: int, velas: int = VELAS_POR_DEFECTO
) -> dict[str, Any] | None:
    """Las tres condiciones sobre la misma clave y el mismo hold-out."""
    high, low, close = series(symbol, interval, velas)
    if len(close) < 500:
        return None
    base = load_active_ensemble(symbol, interval)
    manual = load_ensemble(artifacts_dir() / "ensemble.yaml")

    libre = optimize_weights(high, low, close, base, n_trials=n_trials, coherencia_regimen=False)
    coherente = optimize_weights(high, low, close, base, n_trials=n_trials, coherencia_regimen=True)

    # La manual no se optimiza: solo se mide en el MISMO hold-out, para que las cuatro columnas
    # sean comparables.
    split = int(len(close) * 0.7)
    man_exp, man_n = _holdout_expectancy(high, low, close, manual, split, 20)

    return {
        "manual_expectancy": man_exp,
        "manual_trades": man_n,
        "symbol": symbol,
        "interval": interval,
        "velas": len(close),
        "base_expectancy": libre["holdout"]["base_expectancy"],
        "base_trades": libre["holdout"]["base_trades"],
        "libre_expectancy": libre["holdout"]["optimized_expectancy"],
        "libre_trades": libre["holdout"]["optimized_trades"],
        "libre_promueve": libre["promoted"],
        "libre_motivo": libre["promocion"]["motivo"],
        "coherente_expectancy": coherente["holdout"]["optimized_expectancy"],
        "coherente_trades": coherente["holdout"]["optimized_trades"],
        "coherente_promueve": coherente["promoted"],
        "coherente_motivo": coherente["promocion"]["motivo"],
        "nula_p95": coherente["promocion"]["nula_p95"],
    }


def p_binomial(exitos: int, n: int) -> float:
    """Probabilidad de ver `exitos` o más de `n` si la moneda fuera justa (una cola).

    Un recuento de 11 de 20 parece una victoria y no lo es: sale así el 41 % de las veces por puro
    azar. Sin esto, «gana en más de la mitad» invita a leer como señal lo que es un empate — el
    mismo error de agregación que ya costó un hallazgo en este proyecto.
    """
    from math import comb

    if n <= 0:
        return 1.0
    return sum(comb(n, k) for k in range(exitos, n + 1)) / (2.0**n)


def veredicto(filas: list[dict[str, Any]]) -> dict[str, Any]:
    """El recuento por claves, que es la unidad de evidencia que no infla nada."""
    utiles = [f for f in filas if f["base_trades"] >= MIN_HOLDOUT]
    gana_libre = [f for f in utiles if f["libre_expectancy"] > f["base_expectancy"]]
    gana_coh = [f for f in utiles if f["coherente_expectancy"] > f["base_expectancy"]]
    # Y la pregunta que de verdad se hizo: ¿mejora Optuna el diseño MANUAL?
    libre_vs_man = [f for f in utiles if f["libre_expectancy"] > f["manual_expectancy"]]
    coh_vs_man = [f for f in utiles if f["coherente_expectancy"] > f["manual_expectancy"]]
    activa_vs_man = [f for f in utiles if f["base_expectancy"] > f["manual_expectancy"]]
    return {
        "claves": len(filas),
        "con_muestra": len(utiles),
        "gana_libre": len(gana_libre),
        "gana_coherente": len(gana_coh),
        "libre_vs_manual": len(libre_vs_man),
        "coherente_vs_manual": len(coh_vs_man),
        "activa_vs_manual": len(activa_vs_man),
        "promueve_libre": sum(1 for f in utiles if f["libre_promueve"]),
        "promueve_coherente": sum(1 for f in utiles if f["coherente_promueve"]),
        "aporta_libre": len(gana_libre) > len(utiles) / 2,
        "aporta_coherente": len(gana_coh) > len(utiles) / 2,
        "p_libre": p_binomial(len(gana_libre), len(utiles)),
        "p_coherente": p_binomial(len(gana_coh), len(utiles)),
        "p_libre_vs_manual": p_binomial(len(libre_vs_man), len(utiles)),
        "p_coherente_vs_manual": p_binomial(len(coh_vs_man), len(utiles)),
        "p_activa_vs_manual": p_binomial(len(activa_vs_man), len(utiles)),
    }


def informe(filas: list[dict[str, Any]], v: dict[str, Any], n_trials: int) -> None:
    ancho = 96
    print("=" * ancho)
    print(f"¿APORTA OPTUNA SOBRE LA CONFIGURACIÓN BASE?  ({n_trials} trials por condición)")
    print("=" * ancho)
    print(
        f"  {'clave':16}{'n_ho':>6}{'manual':>9}{'activa':>9}{'libre':>9}"
        f"{'coherente':>11}   quién gana"
    )
    for f in sorted(filas, key=lambda x: (x["symbol"], x["interval"])):
        mejor = max(
            ("manual", f["manual_expectancy"]),
            ("activa", f["base_expectancy"]),
            ("libre", f["libre_expectancy"]),
            ("coherente", f["coherente_expectancy"]),
            key=lambda p: p[1],
        )[0]
        print(
            f"  {f['symbol'] + ':' + f['interval']:16}{f['base_trades']:>6}"
            f"{f['manual_expectancy']:>9.3f}{f['base_expectancy']:>9.3f}"
            f"{f['libre_expectancy']:>9.3f}{f['coherente_expectancy']:>11.3f}   {mejor}"
        )
    print()
    print(f"  claves con muestra suficiente (>= {MIN_HOLDOUT} operaciones): {v['con_muestra']}")
    n = v["con_muestra"]
    print(
        f"  frente a la config ACTIVA:  libre {v['gana_libre']}/{n}, "
        f"coherente {v['gana_coherente']}/{n}"
    )
    print(
        f"  frente a la config MANUAL:  libre {v['libre_vs_manual']}/{n}, "
        f"coherente {v['coherente_vs_manual']}/{n}, activa {v['activa_vs_manual']}/{n}"
    )
    print(
        f"  promociones que pasarían el guardia: libre {v['promueve_libre']}, "
        f"coherente {v['promueve_coherente']}"
    )
    print()
    print("  VEREDICTO (criterio fijado antes: aportar = ganar en más de la mitad)")
    print(f"    Optuna libre:     {'APORTA' if v['aporta_libre'] else 'NO APORTA'}")
    print(f"    Optuna coherente: {'APORTA' if v['aporta_coherente'] else 'NO APORTA'}")


def main() -> None:
    n_trials = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    filas: list[dict[str, Any]] = []
    t0 = time.perf_counter()
    for symbol in SIMBOLOS:
        for interval in INTERVALOS:
            try:
                fila = estudiar_clave(symbol, interval, n_trials)
            except Exception as err:  # noqa: BLE001 - una clave que falla no tumba el estudio
                print(f"  {symbol}:{interval} ERROR {err}", file=sys.stderr)
                continue
            if fila is not None:
                filas.append(fila)
                print(f"  ...{symbol}:{interval} listo", file=sys.stderr)
    v = veredicto(filas)
    informe(filas, v, n_trials)
    print(f"\n  ({time.perf_counter() - t0:.0f} s)")
    destino = artifacts_dir() / f"optimizador_estudio_{n_trials}.json"
    destino.write_text(
        json.dumps({"n_trials": n_trials, "veredicto": v, "claves": filas}, indent=2),
        encoding="utf8",
    )
    print(f"  informe: {destino}")


if __name__ == "__main__":
    main()

"""¿Aporta gestionar la salida? Seis planes contra el baseline, en 1d.

Uso: python -m trademe_quant.run_salidas

Qué se prueba, y por qué solo seis
-----------------------------------
Cada plan se mide en las cuatro claves de 1d, así que son **24 comparaciones**. Con un listón del
percentil 95, el azar produce **1,2 positivos**; con seis planes y cuatro claves, hacen falta **3 de
4** en un mismo plan para bajar de 0,05.

Los parámetros están **fijados a priori** y no barridos. Un barrido sobre activación y distancia
daría decenas de combinaciones y la mejor sería ruido — es el error que este proyecto ya cometió con
el optimizador. Los valores son los convencionales: activar a 1 R, arrastrar a 1 R.

Los seis planes
----------------
1. **breakeven_1r** — stop a la entrada (más el coste) al alcanzar +1 R.
2. **trailing_1r** — arrastre a 1 R por detrás del máximo, desde +1 R.
3. **trailing_atr** — lo mismo, pero midiendo la distancia con el ATR corriente.
4. **senal** — cerrar cuando el `net` del ensemble deja de apoyar la dirección.
5. **trailing_y_senal** — los dos que atacan los timeouts, juntos.
6. **breakeven_y_trailing** — la combinación clásica.

Qué se mide, y por qué no solo la expectancy
----------------------------------------------
La expectancy neta responde a «¿gana más dinero?». El **drawdown máximo** responde a «¿se puede
aguantar?», y son preguntas distintas: un plan que baje la expectancy y hunda el drawdown puede ser
preferible, y uno que la suba a costa de duplicar el drawdown, no.

El listón para decir que un plan **aporta** conserva las tres condiciones de `alfa.juzgar`: muestra
(al menos 25 operaciones cambiadas), control del azar y quedar por encima de `UMBRAL_VIABILIDAD`.

Lo que cambia es **cómo se controla el azar**, y merece explicarse. `nula.p95_seleccion` pregunta
«¿qué daría elegir otras operaciones?», que es lo correcto para un filtro. Un plan de salida no
elige: cambia el desenlace de las que toca, y el delta de cada operación depende de su propio
recorrido, así que no es transferible a otra. La pregunta aquí es «¿la mejora sobrevive a que me
hubieran tocado otros meses?», y se responde con un **bootstrap por bloques de 24 h** —ver
`suelo_del_lift`—. Se exige que el percentil 5 del lift remuestreado siga siendo positivo.
"""

from __future__ import annotations

import json
import sys
from typing import Any

import numpy as np

from .alfa import UMBRAL_VIABILIDAD, p_falsos_positivos
from .backtest import compute_metrics, run_backtest
from .ensemble import artifacts_dir, load_active_ensemble
from .market.normalize import interval_ms
from .nula import PERMUTACIONES_ESTUDIO
from .promocion import marcas_de_indices
from .salidas import SIN_GESTION, PlanSalida
from .velas import series

SIMBOLOS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT"]
INTERVALO = "1d"
HORIZONTE = 10

PLANES: dict[str, PlanSalida] = {
    "breakeven_1r": PlanSalida(breakeven_r=1.0),
    "trailing_1r": PlanSalida(trailing_desde_r=1.0, trailing_distancia_r=1.0),
    "trailing_atr": PlanSalida(
        trailing_desde_r=1.0, trailing_distancia_r=1.0, trailing_usa_atr_corriente=True
    ),
    "senal": PlanSalida(salida_por_senal=True),
    "trailing_y_senal": PlanSalida(
        trailing_desde_r=1.0, trailing_distancia_r=1.0, salida_por_senal=True
    ),
    "breakeven_y_trailing": PlanSalida(
        breakeven_r=1.0, trailing_desde_r=1.0, trailing_distancia_r=1.0
    ),
    # Los dos siguientes salen del diagnóstico, no de un barrido: con el TP a 2 R el arrastre solo
    # puede cortar, así que la única hipótesis viva es quitarle el techo y dejar correr.
    "sin_tp_trailing_1r": PlanSalida(
        sin_take_profit=True, trailing_desde_r=1.0, trailing_distancia_r=1.0
    ),
    "sin_tp_trailing_atr": PlanSalida(
        sin_take_profit=True,
        trailing_desde_r=1.0,
        trailing_distancia_r=1.0,
        trailing_usa_atr_corriente=True,
    ),
}


def _emparejar(
    base: list[dict[str, Any]], gestionado: list[dict[str, Any]]
) -> tuple[list[float], list[float], list[int]]:
    """Empareja operaciones por su vela de entrada, que es lo que el plan no cambia.

    Un plan de salida puede cerrar antes y liberar velas, así que el segundo backtest abre
    operaciones que el primero no tenía y viceversa. **Solo se comparan las que ambos abrieron**:
    las demás no son la misma operación gestionada de otra forma, son operaciones distintas, y
    meterlas en la comparación mediría el cambio de calendario en vez del mecanismo.
    """
    por_indice = {int(t["index"]): t for t in gestionado}
    rs_base: list[float] = []
    rs_gest: list[float] = []
    indices: list[int] = []
    for t in base:
        g = por_indice.get(int(t["index"]))
        if g is None:
            continue
        rs_base.append(float(t["r"]))
        rs_gest.append(float(g["r"]))
        indices.append(int(t["index"]))
    return rs_base, rs_gest, indices


def suelo_del_lift(
    deltas: list[float],
    marcas: list[int],
    remuestreos: int = PERMUTACIONES_ESTUDIO,
    semilla: int = 20260907,
    percentil: float = 5.0,
) -> float:
    """Percentil 5 del lift bajo remuestreo **por bloques** de 24 h. Si es > 0, la mejora aguanta.

    Por qué un bootstrap y no la nula por permutación del resto del proyecto
    ------------------------------------------------------------------------
    `nula.p95_seleccion` pregunta «¿qué daría *elegir otras* operaciones?». Es la pregunta correcta
    cuando el mecanismo **selecciona**: un filtro que descarta el tercil bajo podría haber
    descartado cualquier otro tercio.

    Un plan de salida no selecciona: **cambia el desenlace** de las operaciones que toca, y el
    cambio de cada una depende de su propio recorrido. El delta de una operación no es transferible
    a otra, así que permutar a quién le toca el cambio compararía contra un mundo que no existe.

    La pregunta aquí es otra: «¿la mejora sobrevive a que me hubieran tocado otros meses?». Se
    remuestrean **bloques enteros** de 24 h con reemplazo —no operaciones sueltas— porque los
    desenlaces se amontonan en el tiempo y tratarlos como independientes subestimaría la varianza,
    que es el error que este proyecto ya cometió una vez.
    """
    if not deltas:
        return 0.0
    d = np.asarray(deltas, dtype=float)
    bloques = [np.flatnonzero(np.asarray(marcas) == m) for m in sorted(set(marcas))]
    if len(bloques) < 5:
        # Con menos de cinco bloques el percentil no significa nada. Ver `nula.py`: se prefiere no
        # dar listón antes que dar uno inventado.
        return float("inf")

    rng = np.random.default_rng(semilla)
    n = len(d)
    valores = np.empty(remuestreos, dtype=float)
    for k in range(remuestreos):
        elegidos = rng.integers(0, len(bloques), size=len(bloques))
        idx = np.concatenate([bloques[i] for i in elegidos])
        valores[k] = float(d[idx].sum() / n)
    return float(np.percentile(valores, percentil))


def estudiar(symbol: str) -> list[dict[str, Any]]:
    h, lo, c = series(symbol, INTERVALO)
    cfg = load_active_ensemble(symbol, INTERVALO)
    base = run_backtest(h, lo, c, cfg, horizon=HORIZONTE, plan=SIN_GESTION)
    m_base = base["metrics"]
    velas_dia = max(1, round(86_400_000 / interval_ms(INTERVALO)))

    filas: list[dict[str, Any]] = []
    for nombre, plan in PLANES.items():
        g = run_backtest(h, lo, c, cfg, horizon=HORIZONTE, plan=plan)
        m_g = g["metrics"]
        rs_base, rs_gest, indices = _emparejar(base["trades"], g["trades"])
        if not rs_base:
            continue
        marcas = marcas_de_indices(indices, velas_dia)
        exp_base = float(np.mean(rs_base))
        exp_gest = float(np.mean(rs_gest))
        lift = exp_gest - exp_base
        deltas = [b - a for a, b in zip(rs_base, rs_gest, strict=True)]
        suelo = suelo_del_lift(deltas, marcas)
        cambiadas = sum(1 for d in deltas if abs(d) > 1e-12)
        # Las tres condiciones de siempre: muestra, control del azar y viabilidad.
        aporta = bool(cambiadas >= 25 and suelo > 0.0 and exp_gest >= UMBRAL_VIABILIDAD)
        filas.append(
            {
                "plan": nombre,
                "symbol": symbol,
                "interval": INTERVALO,
                "n_comparadas": len(rs_base),
                "n_cambiadas": cambiadas,
                "exp_base": round(exp_base, 4),
                "exp_plan": round(exp_gest, 4),
                "lift": round(lift, 4),
                "suelo_lift": round(suelo, 4) if suelo != float("inf") else None,
                "dd_base": round(float(m_base["max_drawdown"]), 2),
                "dd_plan": round(float(m_g["max_drawdown"]), 2),
                "sharpe_base": round(float(m_base["sharpe"]), 4),
                "sharpe_plan": round(float(m_g["sharpe"]), 4),
                "n_base": int(m_base["n_trades"]),
                "n_plan": int(m_g["n_trades"]),
                "aporta": aporta,
            }
        )
    return filas


def informe(filas: list[dict[str, Any]]) -> None:
    print("=" * 118)
    print(
        f"GESTIÓN DE SALIDAS EN 1d  (listón: R neta > {UMBRAL_VIABILIDAD:+.3f}, "
        "suelo P5 del lift > 0 y al menos 25 operaciones cambiadas)"
    )
    print("=" * 118)
    for nombre in PLANES:
        del_plan = [f for f in filas if f["plan"] == nombre]
        if not del_plan:
            continue
        print(f"\n  {nombre.upper()}")
        cab = "    " + "clave".ljust(14) + "comp".rjust(6) + "camb".rjust(6)
        cab += "base".rjust(10) + "plan".rjust(10) + "lift".rjust(9) + "sueloP5".rjust(9)
        print(cab + "ddBase".rjust(9) + "ddPlan".rjust(9) + "shBase".rjust(9) + "shPlan".rjust(9))
        for f in del_plan:
            marca = "APORTA" if f["aporta"] else ""
            print(
                f"    {f['symbol']:14}{f['n_comparadas']:>6}{f['n_cambiadas']:>6}"
                f"{f['exp_base']:>10.4f}{f['exp_plan']:>10.4f}{f['lift']:>9.4f}"
                f"{(f['suelo_lift'] if f['suelo_lift'] is not None else float('nan')):>9.4f}"
                f"{f['dd_base']:>9.2f}{f['dd_plan']:>9.2f}"
                f"{f['sharpe_base']:>9.4f}{f['sharpe_plan']:>9.4f}  {marca}"
            )
        k = sum(1 for f in del_plan if f["aporta"])
        p = p_falsos_positivos(k, len(del_plan))
        print(f"      {k}/{len(del_plan)} claves · p={p:.4f} · {'SEÑAL' if p < 0.05 else 'ruido'}")

    total = len(filas)
    aciertos = sum(1 for f in filas if f["aporta"])
    print()
    print("=" * 118)
    print(f"  pruebas: {total} · positivos: {aciertos} · esperados por azar: {0.05 * total:.1f}")
    print(f"  p de que TODO sea ruido: {p_falsos_positivos(aciertos, total):.4f}")


def main() -> None:
    filas: list[dict[str, Any]] = []
    for symbol in SIMBOLOS:
        try:
            filas.extend(estudiar(symbol))
            print(f"  ...{symbol} listo", file=sys.stderr)
        except Exception as err:  # noqa: BLE001 - una clave que falla no tumba el estudio
            print(f"  {symbol} ERROR {err}", file=sys.stderr)
    informe(filas)
    destino = artifacts_dir() / "salidas_estudio.json"
    destino.write_text(json.dumps(filas, indent=2, default=str), encoding="utf8")
    print(f"\n  informe: {destino}")


if __name__ == "__main__":
    main()


__all__ = ["PLANES", "compute_metrics", "estudiar", "informe", "main"]

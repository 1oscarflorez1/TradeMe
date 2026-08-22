"""Fase A del diagnóstico del meta-modelo: ¿hay algo que diagnosticar?

Uso: python -m trademe_quant.run_metamodel_diagnostico <meta.csv>

El meta-modelo lleva meses en sombra y su confianza aparece **anti-correlacionada** con el
resultado: AUC 0,46, y en BTCUSDT el tercil de menor confianza rinde +0,195 R frente a −0,168 R el
de mayor, con la dirección repetida en las cuatro temporalidades medibles.

Antes de buscar causas hay que descartar la más simple: **que sea ruido**. Un AUC de 0,46 con esta
muestra puede estar perfectamente dentro de lo que produce el azar, y entonces no habría inversión
que explicar — habría un modelo que no aprende, que es una conclusión distinta y más útil.

Es el mismo control que tumbó al Analista de Niveles. Allí el listón de votos efectivos premiaba
igual a una fuente nueva y a un dado; aquí la pregunta es si 0,46 se distingue de barajar las
etiquetas.

Dos pruebas, con los umbrales fijados **antes** de calcular nada
----------------------------------------------------------------
1. **Permutación del test** (10.000 barajadas, sin reentrenar): ¿la ordenación que produce este
   modelo entrenado se distingue del azar? Responde por el AUC, que no depende del umbral elegido.

2. **Permutación completa** (con reentrenamiento): ¿el *procedimiento* extrae señal? Es más caro y
   más exigente: si el propio pipeline no supera al azar, el problema no está en el modelo sino en
   las features.

Significativo si el valor observado cae **fuera del percentil 5-95** de la distribución nula
(bilateral, alfa 0,05).

Corrección incluida: el umbral ya no se elige mirando el test
--------------------------------------------------------------
`train_metamodel` hacía `pick_threshold(probs_te, r_te)` y después reportaba la expectancy filtrada
sobre ese mismo `r_te`. El umbral se optimizaba en los datos que luego lo juzgaban, así que la
mejora salía inflada por construcción. Aquí se usa el reparto en tres tramos
—entrenamiento / selección / prueba— que es el que corrige `metamodel.py`.
"""

from __future__ import annotations

import csv
import sys
from typing import Any

import numpy as np

from .metamodel import FEATURES, expectancy_with_filter, pick_threshold, row_to_features

#: Barajadas para la distribución nula sin reentrenar (barato).
PERMUTACIONES_TEST = 10_000
#: Barajadas con reentrenamiento (caro: cada una entrena un bosque).
PERMUTACIONES_COMPLETAS = 300
#: Percentiles del intervalo central. Fuera de aquí, el valor observado no es azar.
PCT_BAJO, PCT_ALTO = 5.0, 95.0


def cargar(csv_path: str) -> list[dict[str, Any]]:
    filas: list[dict[str, Any]] = []
    with open(csv_path, encoding="utf8", newline="") as fh:
        for row in csv.DictReader(fh):
            if row.get("outcome_result") not in ("tp", "sl"):
                continue
            limpio: dict[str, Any] = {}
            for k, v in row.items():
                if k in ("captured_at", "symbol", "regime_label", "direction", "outcome_result"):
                    limpio[k] = v
                else:
                    limpio[k] = float(v) if v not in (None, "") else None
            filas.append(limpio)
    return filas


def _auc(y: np.ndarray, p: np.ndarray) -> float:
    """AUC por conteo de pares. Sin dependencias y coincide con roc_auc_score."""
    pos = p[y > 0.5]
    neg = p[y <= 0.5]
    if pos.size == 0 or neg.size == 0:
        return 0.5
    mejores = float((pos[:, None] > neg[None, :]).sum())
    empates = float((pos[:, None] == neg[None, :]).sum())
    return (mejores + 0.5 * empates) / (pos.size * neg.size)


def _entrenar(x_tr: np.ndarray, y_tr: np.ndarray) -> Any:
    from sklearn.ensemble import RandomForestClassifier

    modelo = RandomForestClassifier(
        n_estimators=200,
        max_depth=4,
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=42,
    )
    modelo.fit(x_tr, y_tr)
    return modelo


def diagnosticar(filas: list[dict[str, Any]]) -> None:
    filas = sorted(filas, key=lambda r: str(r.get("captured_at")))
    y_all = np.asarray([1.0 if r["outcome_result"] == "tp" else 0.0 for r in filas])
    x_all = np.asarray([row_to_features(r) for r in filas], dtype=np.float64)
    r_all = np.asarray([float(r["outcome_return_r"]) for r in filas], dtype=np.float64)

    n = len(filas)
    # Tres tramos: entrenar / elegir umbral / juzgar. El corte del medio es la corrección: antes el
    # umbral se elegía en el mismo tramo donde luego se reportaba la mejora.
    corte_tr = int(n * 0.6)
    corte_sel = int(n * 0.8)
    x_tr, y_tr = x_all[:corte_tr], y_all[:corte_tr]
    x_sel, r_sel = x_all[corte_tr:corte_sel], r_all[corte_tr:corte_sel]
    x_te, y_te, r_te = x_all[corte_sel:], y_all[corte_sel:], r_all[corte_sel:]

    print("=" * 78)
    print("DIAGNÓSTICO DEL META-MODELO · FASE A: ¿es real o es ruido?")
    print("=" * 78)
    print(f"  filas evaluadas: {n}   ·   tp: {int(y_all.sum())}   sl: {int(n - y_all.sum())}")
    print(
        f"  reparto: {corte_tr} entrenar · {corte_sel - corte_tr} selección · "
        f"{n - corte_sel} prueba"
    )
    print(f"  listón: fuera del percentil {PCT_BAJO:.0f}-{PCT_ALTO:.0f} de la distribución nula\n")

    modelo = _entrenar(x_tr, y_tr)
    probs_te = modelo.predict_proba(x_te)[:, 1].astype(np.float64)
    probs_sel = modelo.predict_proba(x_sel)[:, 1].astype(np.float64)

    auc_obs = _auc(y_te, probs_te)
    # El umbral sale del tramo de SELECCIÓN, no del de prueba.
    umbral = pick_threshold(probs_sel, r_sel)
    base = float(np.mean(r_te))
    filtrada, conservadas = expectancy_with_filter(probs_te, r_te, umbral)
    lift_obs = filtrada - base

    print("--- observado ---------------------------------------------------------------")
    print(f"  AUC (prueba)          : {auc_obs:.4f}")
    print(f"  umbral (de selección) : {umbral:.2f}")
    print(f"  expectancy base       : {base:+.3f} R")
    print(f"  con filtro            : {filtrada:+.3f} R   ({conservadas}/{len(r_te)} conservadas)")
    print(f"  lift                  : {lift_obs:+.3f} R\n")

    # ---- Prueba 1: permutar las etiquetas del test, sin reentrenar --------------------------
    rng = np.random.default_rng(20260822)
    nulos = np.empty(PERMUTACIONES_TEST, dtype=float)
    y_baraja = y_te.copy()
    for i in range(PERMUTACIONES_TEST):
        rng.shuffle(y_baraja)
        nulos[i] = _auc(y_baraja, probs_te)
    lo, hi = np.percentile(nulos, [PCT_BAJO, PCT_ALTO])
    fuera = auc_obs < lo or auc_obs > hi
    p_val = float(np.mean(np.abs(nulos - 0.5) >= abs(auc_obs - 0.5)))
    print("--- prueba 1: ¿la ordenación se distingue del azar? -------------------------")
    print(f"  {PERMUTACIONES_TEST} barajadas del test, sin reentrenar")
    print(
        f"  nulo: media {nulos.mean():.4f}   ·   intervalo {PCT_BAJO:.0f}-{PCT_ALTO:.0f}: "
        f"[{lo:.4f}, {hi:.4f}]"
    )
    print(
        f"  observado {auc_obs:.4f}  ->  {'FUERA (significativo)' if fuera else 'DENTRO: es ruido'}"
        f"   ·   p = {p_val:.3f}\n"
    )

    # ---- Prueba 2: permutar y reentrenar ----------------------------------------------------
    print("--- prueba 2: ¿el procedimiento extrae señal? ------------------------------")
    print(f"  {PERMUTACIONES_COMPLETAS} barajadas con reentrenamiento (esto tarda)...")
    aucs = np.empty(PERMUTACIONES_COMPLETAS, dtype=float)
    lifts = np.empty(PERMUTACIONES_COMPLETAS, dtype=float)
    y_tr_baraja = y_tr.copy()
    for i in range(PERMUTACIONES_COMPLETAS):
        rng.shuffle(y_tr_baraja)
        m = _entrenar(x_tr, y_tr_baraja)
        p_te = m.predict_proba(x_te)[:, 1].astype(np.float64)
        p_sel = m.predict_proba(x_sel)[:, 1].astype(np.float64)
        aucs[i] = _auc(y_te, p_te)
        t = pick_threshold(p_sel, r_sel)
        f, _ = expectancy_with_filter(p_te, r_te, t)
        lifts[i] = f - base
    for nombre, obs, dist in (("AUC", auc_obs, aucs), ("lift", lift_obs, lifts)):
        lo2, hi2 = np.percentile(dist, [PCT_BAJO, PCT_ALTO])
        fuera2 = obs < lo2 or obs > hi2
        print(
            f"  {nombre:5s}: nulo media {dist.mean():+.4f}  "
            f"intervalo [{lo2:+.4f}, {hi2:+.4f}]  ·  observado {obs:+.4f}  ->  "
            f"{'FUERA' if fuera2 else 'DENTRO: es ruido'}"
        )

    print()
    print("=" * 78)
    if not fuera:
        print("VEREDICTO: la anti-correlación NO se distingue del azar.")
        print("  No hay inversión que explicar: hay un modelo que no aprende. El diagnóstico")
        print("  termina en la Fase A, y lo que falta no es afinar el modelo sino conseguir")
        print("  features que no deriven todas del mismo precio.")
    else:
        print("VEREDICTO: el efecto es real. Procede la Fase B (periodo, activos, features).")
    print("=" * 78)


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    filas = cargar(sys.argv[1])
    if len(filas) < 60:
        print(f"muestra insuficiente: {len(filas)} filas")
        raise SystemExit(1)
    print(f"features del modelo ({len(FEATURES)}): {', '.join(FEATURES)}\n")
    diagnosticar(filas)


if __name__ == "__main__":
    main()

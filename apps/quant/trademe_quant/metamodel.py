"""Meta-modelo de ML (Módulo 2 · meta-labeling).

Aprende de las decisiones REALES ya evaluadas (snapshots con outcome TP/SL) a estimar la
probabilidad de éxito de una señal del ensemble. Actúa como filtro anti-falsos-positivos: no
cambia la dirección, ajusta la confianza.

Decisiones de diseño (honestas):
- **RandomForest (sklearn)** en vez de LightGBM: con datasets de decenas/centenares de filas un
  bosque pequeño generaliza mejor que un boosting profundo, y skl2onnx lo exporta a ONNX de forma
  nativa (LightGBM exige convertidores extra). Si el dataset crece mucho, migrar es trivial.
- **Split temporal** (entrena con lo viejo, valida con lo nuevo): nunca aleatorio, para no mirar
  al futuro.
- **Promoción sólo si se la gana**: desde 0.58.0 pasa por `promocion.decidir`, el mismo gobierno
  que el optimizador. Hacen falta las tres: muestra mínima, expectancy positiva de verdad y superar
  el P95 de una nula por bloques. Antes bastaba `filtered > baseline`, que es puramente relativo:
  el mismo criterio que 0.54.0 declaró inaceptable para Optuna y que aquí seguía vivo.
- **Reentrenamiento continuo:** cada ejecución usa todos los snapshots evaluados disponibles, así
  el modelo mejora a medida que llegan registros nuevos.
"""

from __future__ import annotations

import json
from typing import Any

import numpy as np
import numpy.typing as npt

FloatArr = npt.NDArray[np.float64]

# Orden de features: DEBE coincidir con el applier (API). Se guarda también en el artefacto.
FEATURES = [
    "net",
    "confidence",
    "prob_buy",
    "prob_hold",
    "prob_sell",
    "adx14_value",
    "atr_rel",  # atr14_value / price (escala-invariante)
    "ema_cross_score",
    "macd_score",
    "rsi14_score",
    "bbands_score",
    "stoch14_score",
    "supertrend_score",
    "is_trend",  # régimen: 1 tendencia, 0 rango
    "is_long",  # dirección: 1 LONG, 0 SHORT
]

MIN_ROWS = 60
MIN_PER_CLASS = 20


def row_to_features(row: dict[str, Any]) -> list[float]:
    """Convierte un snapshot (dict) al vector de features en el orden canónico."""

    def f(key: str) -> float:
        v = row.get(key)
        return float(v) if v is not None else 0.0

    price = f("price") or 1.0
    return [
        f("net"),
        f("confidence"),
        f("prob_buy"),
        f("prob_hold"),
        f("prob_sell"),
        f("adx14_value"),
        f("atr14_value") / price,
        f("ema_cross_score"),
        f("macd_score"),
        f("rsi14_score"),
        f("bbands_score"),
        f("stoch14_score"),
        f("supertrend_score"),
        1.0 if str(row.get("regime_label")) == "tendencia" else 0.0,
        1.0 if str(row.get("direction")) == "LONG" else 0.0,
    ]


def expectancy_with_filter(probs: FloatArr, rs: FloatArr, threshold: float) -> tuple[float, int]:
    """Expectancy media si solo se operaran las señales con prob >= umbral."""
    mask = probs >= threshold
    n = int(np.sum(mask))
    if n == 0:
        return 0.0, 0
    return float(np.mean(rs[mask])), n


def pick_threshold(probs: FloatArr, rs: FloatArr, min_kept_ratio: float = 0.3) -> float:
    """Umbral que maximiza la expectancy conservando al menos una fracción de las señales."""
    best_t, best_e = 0.5, -1e9
    total = len(probs)
    for t in np.arange(0.30, 0.75, 0.05):
        e, n = expectancy_with_filter(probs, rs, float(t))
        if total and n / total < min_kept_ratio:
            continue
        if e > best_e:
            best_e, best_t = e, float(t)
    return best_t


def train_metamodel(rows: list[dict[str, Any]], test_ratio: float = 0.3) -> dict[str, Any]:
    """Entrena y evalúa el meta-modelo. Devuelve veredicto + modelo si mejora."""
    from sklearn.ensemble import RandomForestClassifier

    usable = [
        r
        for r in rows
        if r.get("outcome_result") in ("tp", "sl") and r.get("outcome_return_r") is not None
    ]
    usable.sort(key=lambda r: str(r.get("captured_at")))  # orden temporal
    y_all = np.asarray([1.0 if r["outcome_result"] == "tp" else 0.0 for r in usable])
    if (
        len(usable) < MIN_ROWS
        or min(int(y_all.sum()), int(len(y_all) - y_all.sum())) < MIN_PER_CLASS
    ):
        return {
            "trained": False,
            "reason": (
                f"dataset insuficiente: {len(usable)} evaluadas "
                f"(mín {MIN_ROWS}), clase minoritaria "
                f"{min(int(y_all.sum()), int(len(y_all) - y_all.sum()))} (mín {MIN_PER_CLASS})"
            ),
            "n": len(usable),
        }

    x_all = np.asarray([row_to_features(r) for r in usable], dtype=np.float64)
    r_all = np.asarray([float(r["outcome_return_r"]) for r in usable], dtype=np.float64)

    # TRES tramos, no dos. El umbral se elige en el del medio y se juzga en el último.
    #
    # Antes era `pick_threshold(probs_te, r_te)` seguido de medir la expectancy filtrada sobre ese
    # mismo `r_te`: el umbral se optimizaba en los datos que después lo juzgaban, así que la mejora
    # salía inflada por construcción y el `threshold` publicado venía ajustado a datos ya vistos.
    split = int(len(usable) * (1 - test_ratio))
    corte_sel = split + max(1, int(len(usable) * test_ratio / 2))
    x_tr, y_tr = x_all[:split], y_all[:split]
    x_sel, r_sel = x_all[split:corte_sel], r_all[split:corte_sel]
    x_te, y_te, r_te = x_all[corte_sel:], y_all[corte_sel:], r_all[corte_sel:]

    if len(np.unique(y_tr)) < 2 or len(y_te) < 10 or len(r_sel) < 10:
        return {"trained": False, "reason": "tramo de validación insuficiente", "n": len(usable)}

    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=4,
        min_samples_leaf=5,
        class_weight="balanced",
        random_state=42,
    )
    model.fit(x_tr, y_tr)
    probs_te = model.predict_proba(x_te)[:, 1].astype(np.float64)
    probs_sel = model.predict_proba(x_sel)[:, 1].astype(np.float64)

    baseline = float(np.mean(r_te))
    # El umbral sale del tramo de SELECCIÓN. El de prueba solo juzga.
    threshold = pick_threshold(probs_sel, r_sel)
    filtered, kept = expectancy_with_filter(probs_te, r_te, threshold)

    # El criterio era `filtered > baseline and kept >= 30 %`: puramente relativo, sin muestra
    # mínima seria y **sin control de azar**. Es exactamente el que el proyecto declaró inaceptable
    # para el optimizador en 0.54.0 —`opt_exp > base_exp`— y que aquí seguía vivo, en el componente
    # que atenúa o veta decisiones ya tomadas.
    #
    # Medido el 5-sep-2026: el tramo de prueba eran **134 filas repartidas en 6 días**, con cuatro
    # activos que la propia plataforma calcula como 1,46 independientes. Un AUC de 0,74 sobre eso
    # no se distingue del azar, y nada lo comprobaba.
    #
    # La nula agrupa por bloques de 24 h porque las decisiones se amontonan en el tiempo: sin eso
    # se contaría un día de mercado como decenas de observaciones independientes.
    from .nula import marcas_de
    from .promocion import decidir, mejora_nula_p95, resumen

    kept_rs = [float(r) for r, p in zip(r_te, probs_te, strict=False) if p >= threshold]
    marcas = marcas_de([r.get("captured_at") for r in usable[corte_sel:]])
    nula = mejora_nula_p95([float(r) for r in r_te], kept_rs, marcas)
    veredicto = decidir(baseline, filtered, kept, nula)
    improves = veredicto.promover

    try:
        from sklearn.metrics import roc_auc_score

        auc = float(roc_auc_score(y_te, probs_te)) if len(np.unique(y_te)) > 1 else 0.5
    except Exception:  # noqa: BLE001
        auc = 0.5

    return {
        "trained": True,
        "promote": improves,
        "model": model,
        "promocion": resumen(veredicto),
        "n": len(usable),
        "n_train": int(split),
        "n_select": int(len(r_sel)),
        "n_test": int(len(y_te)),
        "auc": auc,
        "threshold": threshold,
        "baseline_expectancy": baseline,
        "filtered_expectancy": filtered,
        "kept": kept,
        "features": FEATURES,
    }


def export_onnx(model: Any, path: str, meta: dict[str, Any]) -> None:
    """Exporta el modelo a ONNX + un JSON con features, umbral y métricas."""
    from skl2onnx import to_onnx

    sample = np.zeros((1, len(FEATURES)), dtype=np.float32)
    onx = to_onnx(model, sample, options={id(model): {"zipmap": False}})
    with open(path, "wb") as fh:
        fh.write(onx.SerializeToString())
    with open(path.replace(".onnx", ".json"), "w", encoding="utf-8") as fh:
        json.dump(meta, fh, indent=2)


def forest_to_dict(model: Any) -> dict[str, Any]:
    """Serializa un RandomForest a un artefacto plano (árboles como arrays).

    Se aplica igual en Python y en Node (sin dependencias nativas): mismo patrón que los
    calibradores. La inferencia en vivo son unas comparaciones por árbol: microsegundos.
    """
    trees: list[dict[str, Any]] = []
    for est in model.estimators_:
        t = est.tree_
        # value[:, 0, :] = conteos por clase en cada hoja -> probabilidad de la clase 1
        counts = t.value[:, 0, :]
        totals = counts.sum(axis=1)
        with np.errstate(divide="ignore", invalid="ignore"):
            p1 = np.where(totals > 0, counts[:, 1] / np.maximum(totals, 1e-9), 0.5)
        trees.append(
            {
                "feature": [int(x) for x in t.feature],
                "threshold": [float(x) for x in t.threshold],
                "left": [int(x) for x in t.children_left],
                "right": [int(x) for x in t.children_right],
                "value": [float(x) for x in p1],
            }
        )
    return {"kind": "random_forest", "features": FEATURES, "trees": trees}


def predict_forest(forest: dict[str, Any], x: list[float]) -> float:
    """Aplica el bosque serializado (mirror exacto del applier de Node)."""
    trees = forest["trees"]
    if not trees:
        return 0.5
    total = 0.0
    for tree in trees:
        node = 0
        while tree["left"][node] != -1:
            f = tree["feature"][node]
            node = tree["left"][node] if x[f] <= tree["threshold"][node] else tree["right"][node]
        total += tree["value"][node]
    return total / len(trees)

"""Preparación del dataset ML (Módulo 2 · fase 0).

Antes de entrenar el meta-modelo hay que saber si el dataset de snapshots puede enseñar
algo: cuántas decisiones evaluadas hay, si las clases (TP/SL) están balanceadas y si las
features relevantes están completas. Este módulo mide eso y emite un veredicto honesto.
"""

from __future__ import annotations

from typing import Any

# Criterios mínimos para un primer entrenamiento honesto (meta-labeling binario TP/SL).
MIN_EVALUATED = 60
MIN_PER_CLASS = 20
MIN_FEATURE_COMPLETENESS = 0.9


def readiness_from_counts(
    evaluated: int,
    tp: int,
    sl: int,
    feature_completeness: float,
) -> dict[str, Any]:
    """Veredicto puro (testeable) a partir de los conteos."""
    reasons: list[str] = []
    if evaluated < MIN_EVALUATED:
        reasons.append(
            f"faltan decisiones evaluadas: {evaluated}/{MIN_EVALUATED} "
            "(cada snapshot necesita tocar TP o SL para contar)"
        )
    minority = min(tp, sl)
    if minority < MIN_PER_CLASS:
        reasons.append(
            f"clase minoritaria insuficiente: {minority}/{MIN_PER_CLASS} "
            f"(TP={tp}, SL={sl}; el modelo necesita ejemplos de ambos desenlaces)"
        )
    if feature_completeness < MIN_FEATURE_COMPLETENESS:
        reasons.append(
            f"features incompletas: {feature_completeness:.0%} "
            f"(mínimo {MIN_FEATURE_COMPLETENESS:.0%} de snapshots con todas las columnas clave)"
        )
    ready = not reasons
    return {"ready": ready, "reasons": reasons}


def dataset_report(dsn: str) -> dict[str, Any]:
    """Informe del dataset de snapshots para el meta-modelo."""
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM snapshots")
        row0 = cur.fetchone()
        total = int(row0[0]) if row0 else 0
        cur.execute("""SELECT
                 COUNT(*) FILTER (WHERE outcome_result IS NOT NULL) AS evaluated,
                 COUNT(*) FILTER (WHERE outcome_result = 'tp') AS tp,
                 COUNT(*) FILTER (WHERE outcome_result = 'sl') AS sl,
                 COUNT(*) FILTER (WHERE outcome_result = 'timeout') AS timeout
               FROM snapshots""")
        row = cur.fetchone() or (0, 0, 0, 0)
        evaluated, tp, sl, timeout = (int(x) for x in row)
        cur.execute("""SELECT interval, COUNT(*),
                      COUNT(*) FILTER (WHERE outcome_result IS NOT NULL)
               FROM snapshots GROUP BY interval ORDER BY 2 DESC""")
        by_interval = [
            {"interval": r[0], "total": int(r[1]), "evaluated": int(r[2])} for r in cur.fetchall()
        ]
        cur.execute("""SELECT regime_label, COUNT(*) FROM snapshots
               WHERE regime_label IS NOT NULL GROUP BY regime_label""")
        by_regime = {r[0]: int(r[1]) for r in cur.fetchall()}
        cur.execute("""SELECT COUNT(*) FROM snapshots
               WHERE net IS NOT NULL AND confidence IS NOT NULL
                 AND prob_buy IS NOT NULL AND adx14_value IS NOT NULL
                 AND atr14_value IS NOT NULL AND regime_label IS NOT NULL""")
        rowc = cur.fetchone()
        complete = int(rowc[0]) if rowc else 0

    feature_completeness = (complete / total) if total > 0 else 0.0
    verdict = readiness_from_counts(evaluated, tp, sl, feature_completeness)
    return {
        "total": total,
        "evaluated": evaluated,
        "pending": total - evaluated,
        "tp": tp,
        "sl": sl,
        "timeout": timeout,
        "by_interval": by_interval,
        "by_regime": by_regime,
        "feature_completeness": feature_completeness,
        "criteria": {
            "min_evaluated": MIN_EVALUATED,
            "min_per_class": MIN_PER_CLASS,
            "min_feature_completeness": MIN_FEATURE_COMPLETENESS,
        },
        **verdict,
    }

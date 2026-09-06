"""Entrena el meta-modelo desde los snapshots evaluados y publica el artefacto ONNX.

CLI: python -m trademe_quant.run_metamodel
También expone train_and_publish() para el servicio HTTP y el piloto automático.
"""

from __future__ import annotations

import json
import os
import time
from typing import Any

from .ensemble import artifacts_dir
from .metamodel import export_onnx, forest_to_dict, train_metamodel

SNAPSHOT_COLUMNS = [
    "captured_at",
    # `symbol` NO es una feature del modelo: se arrastra para poder validar cruzado entre activos
    # (entrenar con unos y comprobar con otros) y para separar el modelo por símbolo si algún día la
    # medición lo pide. Meterlo como feature enseñaría al bosque a memorizar el activo.
    "symbol",
    "price",
    "net",
    "confidence",
    "prob_buy",
    "prob_hold",
    "prob_sell",
    "adx14_value",
    "atr14_value",
    "ema_cross_score",
    "macd_score",
    "rsi14_score",
    "bbands_score",
    "stoch14_score",
    "supertrend_score",
    "regime_label",
    "direction",
    "outcome_result",
    "outcome_return_r",
]


def fetch_rows(
    dsn: str, solo_reproducibles: bool = True, horizons: dict[str, int] | None = None
) -> list[dict[str, Any]]:
    """Snapshots evaluados (TP/SL) ordenados por fecha: el dataset del meta-modelo.

    Filtra por **reproducibilidad**, no por fecha: el histórico mezcla reglas de evaluación y un
    desenlace escrito con otra regla no es un dato antiguo, es otra medición. Entrenar con ellos
    enseña al bosque una relación que no existió. Ver `evaluacion.py`.

    `id` se arrastra solo para poder filtrar y se retira antes de devolver: como `symbol`, no es
    una feature y meterlo como tal enseñaría al bosque a memorizar registros concretos.
    """
    import psycopg

    cols = ", ".join(SNAPSHOT_COLUMNS)
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            # Una decisión por vela **y por símbolo**: los duplicados de la captura antigua no
            # son observaciones independientes y, sin deduplicar, el modelo memoriza las
            # situaciones repetidas.
            #
            # `symbol` en el DISTINCT ON no es un detalle: esta consulta no filtra por activo, y las
            # velas de todos los símbolos comparten los mismos `candle_open` porque son ventanas de
            # tiempo alineadas. Sin él, cuatro activos colapsarían a una sola fila por vela y se
            # perdería el 75 % de la muestra — justo lo contrario de lo que busca el multiactivo, y
            # sin ningún error a la vista.
            #
            # El envoltorio devuelve el orden cronológico, que es el que necesita la división
            # temporal del entrenamiento (si no, se entrenaría con el futuro).
            f"SELECT * FROM (SELECT DISTINCT ON (symbol, interval, candle_open) "  # noqa: S608
            f"id, plan_entry, plan_stop, {cols} "
            "FROM snapshots WHERE outcome_result IN ('tp','sl') "
            "ORDER BY symbol, interval, candle_open, captured_at ASC) t ORDER BY captured_at ASC"
        )
        filas = [
            dict(zip(["id", "plan_entry", "plan_stop", *SNAPSHOT_COLUMNS], r, strict=False))
            for r in cur.fetchall()
        ]

    if solo_reproducibles:
        from .evaluacion import ids_reproducibles

        fiables = ids_reproducibles(dsn, horizons)
        filas = [f for f in filas if f["id"] in fiables]
    # Los listones del meta-modelo se miden en NETO desde 0.63.0: entrenar y decidir sobre R bruto
    # con comisiones que se llevan 0,3 R en 15m era juzgar con un listón que no existe.
    from .costes import desde_config, neto
    from .ensemble import artifacts_dir, load_ensemble

    pct = desde_config(load_ensemble(artifacts_dir() / "ensemble.yaml"))
    for f in filas:
        if pct > 0:
            r = neto(f.get("outcome_return_r"), f.get("plan_entry"), f.get("plan_stop"), pct)
            if r is not None:
                f["outcome_return_r"] = r
        for clave in ("id", "plan_entry", "plan_stop"):
            f.pop(clave, None)
    return filas


def fetch_shadow_rows(dsn: str, limit: int = 500) -> list[dict[str, Any]]:
    """Decisiones cerradas que además guardaron la predicción del meta-modelo (modo sombra).

    `captured_at` viaja desde el Hito A: `meta_policy` agrupa por bloques de 24 h para su nula, y
    sin fecha todas las filas caerían en el mismo bloque — lo que convertiría la nula por bloques en
    la simple y subestimaría la varianza justo donde se quería medir.
    """
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT meta_confidence, outcome_return_r, captured_at, plan_entry, plan_stop
               FROM snapshots
               WHERE meta_confidence IS NOT NULL AND outcome_result IN ('tp','sl')
               ORDER BY captured_at DESC LIMIT %s""",
            (limit,),
        )
        crudas = cur.fetchall()

    # En NETO, como el entrenamiento: `meta_policy` decide con esto si el filtro sale de sombra, y
    # medir su lift en bruto lo compararía contra una línea base que nadie puede cobrar.
    from .costes import desde_config, neto
    from .ensemble import load_ensemble

    pct = desde_config(load_ensemble(artifacts_dir() / "ensemble.yaml"))
    filas: list[dict[str, Any]] = []
    for mc, r_bruto, capturada, p_en, p_st in crudas:
        r = neto(r_bruto, p_en, p_st, pct) if pct > 0 else float(r_bruto)
        filas.append(
            {
                "meta_confidence": float(mc),
                "outcome_return_r": float(r if r is not None else r_bruto),
                "captured_at": capturada,
            }
        )
    return filas


def train_and_publish(dsn: str | None = None) -> dict[str, Any]:
    """Reentrena con TODOS los registros evaluados; publica el ONNX solo si mejora."""
    dsn = dsn or os.environ.get(
        "DATABASE_URL", "postgresql://trademe:trademe@localhost:5432/trademe"
    )
    rows = fetch_rows(dsn)
    result = train_metamodel(rows)
    out: dict[str, Any] = {k: v for k, v in result.items() if k != "model"}
    out["trained_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    if not result.get("trained"):
        return out
    if result.get("promote"):
        artifacts_dir().mkdir(parents=True, exist_ok=True)
        path = str(artifacts_dir() / "metamodel.onnx")
        export_onnx(
            result["model"], path, out
        )  # formato estándar (portabilidad/futuros consumidores)
        # Artefacto plano que consume el motor en vivo (Node), igual que los calibradores.
        flat = forest_to_dict(result["model"])
        flat.update(
            {
                "version": f"meta-{out['trained_at']}",
                "threshold": out["threshold"],
                "auc": out["auc"],
                "n": out["n"],
                "trained_at": out["trained_at"],
            }
        )
        with open(artifacts_dir() / "metamodel.json", "w", encoding="utf-8") as fh:
            json.dump(flat, fh)
        out["published"] = True
        out["path"] = path
    else:
        out["published"] = False
    return out


def main() -> None:
    out = train_and_publish()
    if not out.get("trained"):
        print(f"no entrenado: {out.get('reason')}")
        return
    print(
        f"n={out['n']} (train {out['n_train']} / test {out['n_test']}) AUC={out['auc']:.3f} "
        f"umbral={out['threshold']:.2f} expectancy {out['baseline_expectancy']:.3f}R -> "
        f"{out['filtered_expectancy']:.3f}R | publicado={out.get('published')}"
    )


if __name__ == "__main__":
    main()

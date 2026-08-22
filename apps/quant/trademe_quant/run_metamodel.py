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


def fetch_rows(dsn: str) -> list[dict[str, Any]]:
    """Snapshots evaluados (TP/SL) ordenados por fecha: el dataset del meta-modelo."""
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
            f"SELECT * FROM (SELECT DISTINCT ON (symbol, interval, candle_open) {cols} "  # noqa: S608
            "FROM snapshots WHERE outcome_result IN ('tp','sl') "
            "ORDER BY symbol, interval, candle_open, captured_at ASC) t ORDER BY captured_at ASC"
        )
        return [dict(zip(SNAPSHOT_COLUMNS, r, strict=False)) for r in cur.fetchall()]


def fetch_shadow_rows(dsn: str, limit: int = 500) -> list[dict[str, Any]]:
    """Decisiones cerradas que además guardaron la predicción del meta-modelo (modo sombra).

    `captured_at` viaja desde el Hito A: `meta_policy` agrupa por bloques de 24 h para su nula, y
    sin fecha todas las filas caerían en el mismo bloque — lo que convertiría la nula por bloques en
    la simple y subestimaría la varianza justo donde se quería medir.
    """
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT meta_confidence, outcome_return_r, captured_at FROM snapshots
               WHERE meta_confidence IS NOT NULL AND outcome_result IN ('tp','sl')
               ORDER BY captured_at DESC LIMIT %s""",
            (limit,),
        )
        return [
            {
                "meta_confidence": float(r[0]),
                "outcome_return_r": float(r[1]),
                "captured_at": r[2],
            }
            for r in cur.fetchall()
        ]


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

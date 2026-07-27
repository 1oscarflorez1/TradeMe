"""Entrena el meta-modelo desde los snapshots evaluados y publica el artefacto ONNX.

CLI: python -m trademe_quant.run_metamodel
También expone train_and_publish() para el servicio HTTP y el piloto automático.
"""

from __future__ import annotations

import os
import time
from typing import Any

from .ensemble import artifacts_dir
from .metamodel import export_onnx, train_metamodel

SNAPSHOT_COLUMNS = [
    "captured_at",
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
            f"SELECT {cols} FROM snapshots "  # noqa: S608 - columnas fijas del módulo
            "WHERE outcome_result IN ('tp','sl') ORDER BY captured_at ASC"
        )
        return [dict(zip(SNAPSHOT_COLUMNS, r, strict=False)) for r in cur.fetchall()]


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
        path = str(artifacts_dir() / "metamodel.onnx")
        artifacts_dir().mkdir(parents=True, exist_ok=True)
        export_onnx(result["model"], path, out)
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

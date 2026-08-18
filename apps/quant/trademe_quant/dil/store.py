"""Almacenamiento y lectura point-in-time de la Data Intelligence Layer (M11).

`as_of()` es la única forma autorizada de leer estas tablas. Cualquier otra consulta podría olvidar
el filtro por `published_at` y devolver datos del futuro sin que nadie lo note — y un backtest con
look-ahead no falla, simplemente da resultados magníficos que no se reproducen nunca.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from .base import DataProvider, Record

# Cada tabla guarda lo mismo con nombres distintos; esto evita cuatro funciones casi iguales.
_COLUMNAS: dict[str, tuple[str, str]] = {
    "macro_series": ("series_id", "value"),
    "derivatives_metrics": ("metric", "value"),
    "sentiment": ("scope", "value"),
}


def store(dsn: str, provider: DataProvider, records: list[Record]) -> int:
    """Guarda las observaciones. Idempotente: reejecutar un ciclo no duplica nada."""
    import psycopg

    if not records:
        return 0
    clave, _ = _COLUMNAS.get(provider.table, ("series_id", "value"))
    guardados = 0
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            for r in records:
                if provider.table == "macro_series":
                    cur.execute(
                        """
                        INSERT INTO macro_series
                          (source, series_id, observed_at, published_at, value, unit, raw)
                        VALUES (%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (source, series_id, observed_at, published_at)
                        DO UPDATE SET value = EXCLUDED.value, raw = EXCLUDED.raw
                        """,
                        (
                            provider.id,
                            r.key,
                            r.observed_at,
                            r.published_at,
                            r.value,
                            r.unit,
                            json.dumps(r.raw),
                        ),
                    )
                elif provider.table == "derivatives_metrics":
                    cur.execute(
                        """
                        INSERT INTO derivatives_metrics
                          (source, symbol, metric, observed_at, published_at, value, raw)
                        VALUES (%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (source, symbol, metric, observed_at)
                        DO UPDATE SET value = EXCLUDED.value, raw = EXCLUDED.raw
                        """,
                        (
                            provider.id,
                            r.label or "",
                            r.key,
                            r.observed_at,
                            r.published_at,
                            r.value,
                            json.dumps(r.raw),
                        ),
                    )
                elif provider.table == "sentiment":
                    cur.execute(
                        """
                        INSERT INTO sentiment
                          (source, scope, observed_at, published_at, value, label, raw)
                        VALUES (%s,%s,%s,%s,%s,%s,%s)
                        ON CONFLICT (source, scope, observed_at)
                        DO UPDATE SET value = EXCLUDED.value, label = EXCLUDED.label
                        """,
                        (
                            provider.id,
                            r.key,
                            r.observed_at,
                            r.published_at,
                            r.value,
                            r.label,
                            json.dumps(r.raw),
                        ),
                    )
                else:
                    continue
                guardados += 1
        conn.commit()
    return guardados


def mark_health(dsn: str, source: str, rows: int, error: str | None = None) -> None:
    """Deja constancia de cómo fue la última pasada de una fuente.

    Una fuente caída y una fuente sin novedades son indistinguibles si no se registra. Esto es lo
    que permitirá en M12 bajar la confianza del score en vez de fingir que todo va bien.
    """
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        if error is None:
            cur.execute(
                """
                INSERT INTO data_sources (source, last_ok_at, rows_last_run, runs_ok, updated_at)
                VALUES (%s, now(), %s, 1, now())
                ON CONFLICT (source) DO UPDATE SET
                  last_ok_at = now(), rows_last_run = EXCLUDED.rows_last_run,
                  runs_ok = data_sources.runs_ok + 1, updated_at = now()
                """,
                (source, rows),
            )
        else:
            cur.execute(
                """
                INSERT INTO data_sources (source, last_error_at, last_error, runs_error, updated_at)
                VALUES (%s, now(), %s, 1, now())
                ON CONFLICT (source) DO UPDATE SET
                  last_error_at = now(), last_error = EXCLUDED.last_error,
                  runs_error = data_sources.runs_error + 1, updated_at = now()
                """,
                (source, error[:500]),
            )
        conn.commit()


def as_of(
    dsn: str, table: str, key: str, momento: datetime, scope: str | None = None
) -> dict[str, Any] | None:
    """El último dato **que ya se conocía** en `momento`. La regla de oro del hito.

    Filtra por `published_at <= momento`, no por `observed_at`. Esa única diferencia es lo que
    separa una medición honesta de una que mira al futuro.
    """
    import psycopg

    consultas = {
        "macro_series": (
            "SELECT observed_at, published_at, value FROM macro_series "
            "WHERE series_id=%s AND published_at <= %s "
            "ORDER BY published_at DESC, observed_at DESC LIMIT 1",
            (key, momento),
        ),
        "derivatives_metrics": (
            "SELECT observed_at, published_at, value FROM derivatives_metrics "
            "WHERE metric=%s AND symbol=%s AND published_at <= %s "
            "ORDER BY published_at DESC LIMIT 1",
            (key, scope or "", momento),
        ),
        "sentiment": (
            "SELECT observed_at, published_at, value FROM sentiment "
            "WHERE scope=%s AND published_at <= %s ORDER BY published_at DESC LIMIT 1",
            (key, momento),
        ),
    }
    if table not in consultas:
        return None
    sql, params = consultas[table]
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        fila = cur.fetchone()
    if not fila:
        return None
    return {"observed_at": fila[0], "published_at": fila[1], "value": fila[2]}

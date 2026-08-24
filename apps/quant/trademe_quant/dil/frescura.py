"""Una fuente puede responder perfectamente y llevar meses sin decir nada nuevo.

`mark_health` registra si la pasada fue bien y cuántas filas trajo, y con eso una fuente estancada
es indistinguible de una sana: el BCE devuelve fielmente sus 48 filas cada doce horas —las mismas
48— y figura con 33 pasadas correctas y cero errores mientras su serie de IPC lleva **siete meses
sin avanzar** (última observación: diciembre de 2025, comprobado el 24-ago-2026 contra la propia
API del BCE, que tampoco publica nada posterior).

El fallo no es del ingestor, que hace bien su trabajo. Es que «sana» se estaba midiendo como «el
grifo se abre» en vez de «sale agua nueva», y son dos preguntas distintas. Esta es la segunda.

No hace falta guardar nada para responderla: el `observed_at` más reciente de cada serie ya está en
la tabla. El estado derivado no se duplica, se consulta.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Any, NamedTuple

#: Cuánto puede callar cada serie antes de que el silencio signifique algo. Es la periodicidad real
#: de **publicación** —no la de consulta, que es otra cosa— con margen para un fallo o un puente.
#:
#: Fijados por lo que publica la fuente, no por lo que conviene que pase: el funding sale cada 8 h,
#: así que un día entero mudo son tres publicaciones perdidas; el IPC es mensual y llega con 17
#: días de retraso, de modo que 45 días cubren un mes normal sin dar falsos positivos.
SILENCIO_TOLERABLE_S: dict[str, int] = {
    "funding_rate": 24 * 3600,
    "open_interest": 6 * 3600,
    "long_short_ratio": 6 * 3600,
    "ecb_tipo_deposito": 5 * 86400,
    "ecb_ipc_interanual": 45 * 86400,
    # El índice de miedo y codicia se guarda con `scope='cripto'`, no con el nombre del proveedor.
    # Declarado primero como «fear_greed», no vigilaba absolutamente nada: una clave que no existe
    # nunca dispara y el panel se ve igual de tranquilo que si todo fuera bien.
    "cripto": 3 * 86400,
}

#: Dónde vive la fecha de cada familia de series.
_TABLAS: dict[str, tuple[str, str]] = {
    "macro_series": ("macro_series", "series_id"),
    "derivatives_metrics": ("derivatives_metrics", "metric"),
    "sentiment": ("sentiment", "scope"),
}


class Estancada(NamedTuple):
    tabla: str
    serie: str
    ultima: datetime
    silencio_s: float
    tolerable_s: int

    @property
    def dias(self) -> float:
        return self.silencio_s / 86400.0

    def __str__(self) -> str:
        return (
            f"{self.serie}: sin datos nuevos desde {self.ultima:%Y-%m-%d} "
            f"({self.dias:.0f} días; se tolera {self.tolerable_s / 86400:.0f})"
        )


def esta_estancada(ultima: datetime, ahora: datetime, tolerable_s: int) -> bool:
    """¿Lleva la serie más tiempo callada del que le corresponde?"""
    return (ahora - ultima).total_seconds() > tolerable_s


def series_estancadas(dsn: str, ahora: datetime | None = None) -> list[Estancada]:
    """Series cuyo dato más reciente es más viejo de lo que su periodicidad justifica.

    Una serie sin umbral declarado se deja pasar en vez de inventarle uno: preferimos no avisar a
    avisar por algo que no sabemos medir. Añadirla a `SILENCIO_TOLERABLE_S` la pone bajo vigilancia.
    """
    import psycopg

    momento = ahora or datetime.now(tz=UTC)
    fuera: list[Estancada] = []
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        for tabla, (nombre, columna) in _TABLAS.items():
            # `nombre` y `columna` salen de _TABLAS, un mapa fijo de este módulo: nada aquí viene
            # de fuera, que es lo que haría peligrosa la interpolación.
            sql = f"SELECT {columna}, max(observed_at) FROM {nombre} GROUP BY 1"  # noqa: S608
            cur.execute(sql)
            for serie, ultima in cur.fetchall():
                tolerable = SILENCIO_TOLERABLE_S.get(str(serie))
                if tolerable is None or ultima is None:
                    continue
                if esta_estancada(ultima, momento, tolerable):
                    fuera.append(
                        Estancada(
                            tabla=tabla,
                            serie=str(serie),
                            ultima=ultima,
                            silencio_s=(momento - ultima).total_seconds(),
                            tolerable_s=tolerable,
                        )
                    )
    return sorted(fuera, key=lambda e: e.silencio_s, reverse=True)


def resumen(estancadas: list[Estancada]) -> dict[str, Any]:
    """Lo que el piloto deja escrito en su log."""
    return {
        "n": len(estancadas),
        "series": [
            {"serie": e.serie, "ultima": e.ultima.isoformat(), "dias": round(e.dias, 1)}
            for e in estancadas
        ],
    }

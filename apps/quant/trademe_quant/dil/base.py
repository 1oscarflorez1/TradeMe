"""Data Intelligence Layer: contrato de proveedores y consulta point-in-time (M11).

Un proveedor hace cuatro cosas, siempre las mismas: **traer, normalizar, validar y guardar**.
Añadir una fuente es implementar `fetch()`; el resto —cadencia, reintentos, deduplicación, salud—
ya está resuelto aquí. Es el mismo reparto que el de los proveedores de velas en `apps/api`, y por
la misma razón: el que añade una fuente no debería tener que acordarse de nada.

La regla que lo gobierna todo:

    observed_at   a qué momento se REFIERE el dato
    published_at  cuándo se SUPO

El IPC de julio se publica a mediados de agosto. Un backtest situado el 10 de agosto **no puede
verlo**, aunque hable de un mes ya pasado. `as_of()` es la única forma autorizada de leer estas
tablas precisamente para que esa regla no dependa de que nadie la recuerde al escribir una consulta.
"""

from __future__ import annotations

import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(frozen=True)
class Record:
    """Una observación con su fecha de conocimiento. Sin `published_at` no se guarda."""

    observed_at: datetime
    published_at: datetime
    value: float | None
    key: str = ""
    label: str | None = None
    unit: str | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class ProviderError(RuntimeError):
    """Fallo al traer datos. Se registra y el ciclo continúa: nunca tumba al piloto."""


class DataProvider(ABC):
    """Fuente externa de datos fundamentales.

    `available` decide si el proveedor participa. Uno sin clave configurada no es un error: es una
    fuente apagada, y el sistema debe seguir con las demás bajando su confianza, no romperse.
    """

    #: Identificador estable; es la clave en `data_sources` y en las tablas.
    id: str = ""
    #: Tabla destino: macro_series · derivatives_metrics · sentiment · econ_calendar
    table: str = ""
    #: Cada cuánto tiene sentido volver a preguntar, en segundos.
    cadence_s: int = 3600

    @property
    def available(self) -> bool:
        return True

    @property
    def unavailable_reason(self) -> str | None:
        return None

    @abstractmethod
    def fetch(self) -> list[Record]:
        """Trae las observaciones nuevas. Puede lanzar `ProviderError`."""

    def validate(self, records: list[Record]) -> list[Record]:
        """Descarta lo que no se puede usar honestamente.

        Un dato sin fecha de conocimiento, o conocido *antes* de referirse a su propio momento, es
        un dato roto: no se corrige ni se adivina, se descarta y se deja constancia.
        """
        out: list[Record] = []
        for r in records:
            if r.published_at is None or r.observed_at is None:
                continue
            # Margen de un día: algunas fuentes fechan la publicación al inicio del día del dato.
            if (r.observed_at - r.published_at).total_seconds() > 86_400:
                continue
            if r.value is not None and (r.value != r.value or abs(r.value) == float("inf")):
                continue  # NaN o infinito
            out.append(r)
        return out


class Scheduler:
    """Decide qué proveedor toca, según su cadencia. Sin estado en disco: basta con la memoria."""

    def __init__(self, clock: Any = time.time) -> None:
        self._last: dict[str, float] = {}
        self._clock = clock

    def due(self, provider: DataProvider) -> bool:
        if not provider.available:
            return False
        last = self._last.get(provider.id)
        return last is None or (self._clock() - last) >= provider.cadence_s

    def mark(self, provider: DataProvider) -> None:
        self._last[provider.id] = self._clock()

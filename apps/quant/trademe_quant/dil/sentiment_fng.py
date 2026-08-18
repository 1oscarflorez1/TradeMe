"""Índice de miedo y codicia de alternative.me (M11).

Una sola cifra diaria de 0 a 100, gratis y sin clave. Es la fuente de mejor relación
valor/esfuerzo del hito y sirve sobre todo en los extremos: por debajo de 20 o por encima de 80,
el mercado suele estar más cargado de emoción que de argumentos.

Trae histórico desde 2018, así que también participa del relleno retroactivo.
"""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from datetime import UTC, datetime

from .base import DataProvider, ProviderError, Record

URL = "https://api.alternative.me/fng/"
TIMEOUT_S = 15


class FearAndGreed(DataProvider):
    id = "alternative_me_fng"
    table = "sentiment"
    cadence_s = 3600 * 6  # se actualiza una vez al día; cuatro intentos diarios sobran

    def __init__(self, limit: int = 30) -> None:
        self.limit = limit

    def fetch(self) -> list[Record]:
        url = f"{URL}?limit={self.limit}&format=json"
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT_S) as r:  # noqa: S310 - host fijo
                body = json.loads(r.read().decode("utf8"))
        except urllib.error.HTTPError as err:
            raise ProviderError(f"fng respondió {err.code}") from err
        except Exception as err:  # noqa: BLE001
            raise ProviderError(f"fng: {err}") from err

        out: list[Record] = []
        for d in body.get("data", []):
            try:
                t = datetime.fromtimestamp(int(d["timestamp"]), tz=UTC)
                out.append(
                    Record(
                        observed_at=t,
                        published_at=t,
                        value=float(d["value"]),
                        key="cripto",
                        label=d.get("value_classification"),
                        raw={"clasificacion": d.get("value_classification")},
                    )
                )
            except (KeyError, ValueError, TypeError):
                continue  # una fila malformada no invalida el resto
        return out

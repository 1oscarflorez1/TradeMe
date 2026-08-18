"""Series macroeconómicas del Banco Central Europeo y de FRED (M11).

Dos proveedores con una diferencia que decide cuál está activo:

- **BCE**: API pública, sin registro ni clave. Funciona desde el primer despliegue.
- **FRED**: exige una clave gratuita. Sin ella el proveedor queda **apagado**, no roto — el hito
  entero se diseñó para arrancar sin que nadie tenga que registrarse en ningún sitio.

Aquí `observed_at` y `published_at` **no** coinciden, y esa es la razón de ser de estas tablas: el
IPC de julio se publica a mediados de agosto. Un backtest situado el 10 de agosto no puede verlo.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from typing import Any

from .base import DataProvider, ProviderError, Record

TIMEOUT_S = 20

#: Series del BCE que interesan, con el retraso típico entre el periodo y su publicación.
#: Cuando la fuente no da la fecha de publicación, se estima con este desfase — siempre hacia
#: **más tarde**, porque equivocarse hacia delante es prudente y hacia atrás es look-ahead.
SERIES_BCE: dict[str, tuple[str, int]] = {
    # clave interna: (ruta de la serie en el BCE, días de retraso de publicación)
    "ecb_tipo_deposito": ("FM/D.U2.EUR.4F.KR.DFR.LEV", 0),
    "ecb_ipc_interanual": ("ICP/M.U2.N.000000.4.ANR", 17),
}


class ECBMacro(DataProvider):
    """Series del BCE. Sin clave, sin registro, sin excusas."""

    id = "ecb"
    table = "macro_series"
    cadence_s = 3600 * 12

    def __init__(self, series: dict[str, tuple[str, int]] | None = None, ultimos: int = 24) -> None:
        self.series = series or SERIES_BCE
        self.ultimos = ultimos

    def fetch(self) -> list[Record]:
        out: list[Record] = []
        for clave, (ruta, retraso) in self.series.items():
            url = (
                f"https://data-api.ecb.europa.eu/service/data/{ruta}"
                f"?lastNObservations={self.ultimos}&format=jsondata"
            )
            try:
                with urllib.request.urlopen(url, timeout=TIMEOUT_S) as r:  # noqa: S310 - host fijo
                    body = json.loads(r.read().decode("utf8"))
            except urllib.error.HTTPError as err:
                raise ProviderError(f"BCE {clave} respondió {err.code}") from err
            except Exception as err:  # noqa: BLE001
                raise ProviderError(f"BCE {clave}: {err}") from err
            out.extend(self._parse(body, clave, retraso))
        return out

    @staticmethod
    def _parse(body: dict[str, Any], clave: str, retraso: int) -> list[Record]:
        """El formato del BCE separa las fechas de los valores; hay que volver a casarlos."""
        try:
            estructura = body["structure"]["dimensions"]["observation"][0]["values"]
            fechas = [v["id"] for v in estructura]
            series = body["dataSets"][0]["series"]
            primera = next(iter(series.values()))
            observaciones = primera["observations"]
        except (KeyError, IndexError, StopIteration):
            return []

        out: list[Record] = []
        for idx, valores in observaciones.items():
            try:
                i = int(idx)
                if i >= len(fechas) or not valores or valores[0] is None:
                    continue
                observed = _fecha_periodo(fechas[i])
                out.append(
                    Record(
                        observed_at=observed,
                        published_at=observed + timedelta(days=retraso),
                        value=float(valores[0]),
                        key=clave,
                        raw={"periodo": fechas[i]},
                    )
                )
            except (ValueError, TypeError):
                continue
        return out


def _fecha_periodo(periodo: str) -> datetime:
    """`2026-08`, `2026-08-14` o `2026-Q3` -> instante UTC del **final** del periodo.

    El final, no el principio: un dato mensual describe el mes entero, así que antes de que el mes
    acabe no existe. Fecharlo al día 1 sería adelantarlo.
    """
    p = periodo.strip()
    if "Q" in p:
        anio, q = p.split("-Q")
        mes = int(q) * 3
        return _fin_de_mes(int(anio), mes)
    partes = p.split("-")
    if len(partes) == 3:
        return datetime(int(partes[0]), int(partes[1]), int(partes[2]), tzinfo=UTC)
    if len(partes) == 2:
        return _fin_de_mes(int(partes[0]), int(partes[1]))
    return datetime(int(partes[0]), 12, 31, tzinfo=UTC)


def _fin_de_mes(anio: int, mes: int) -> datetime:
    if mes >= 12:
        return datetime(anio, 12, 31, tzinfo=UTC)
    return datetime(anio, mes + 1, 1, tzinfo=UTC) - timedelta(days=1)


#: Series de FRED que interesan. El segundo elemento es el retraso típico de publicación.
SERIES_FRED: dict[str, tuple[str, int]] = {
    "fred_fed_funds": ("DFF", 1),
    "fred_ipc_usa": ("CPIAUCSL", 14),
    "fred_desempleo_usa": ("UNRATE", 7),
}


class FREDMacro(DataProvider):
    """Series de la Reserva Federal. **Apagado sin `FRED_API_KEY`**, que no es un error."""

    id = "fred"
    table = "macro_series"
    cadence_s = 3600 * 12

    def __init__(
        self, api_key: str | None = None, series: dict[str, tuple[str, int]] | None = None
    ) -> None:
        self.api_key = api_key if api_key is not None else os.environ.get("FRED_API_KEY", "")
        self.series = series or SERIES_FRED

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    @property
    def unavailable_reason(self) -> str | None:
        if self.available:
            return None
        return (
            "sin FRED_API_KEY: la clave es gratuita en fred.stlouisfed.org "
            "y activa las series de EE. UU."
        )

    def fetch(self) -> list[Record]:
        if not self.available:
            return []
        out: list[Record] = []
        for clave, (serie, retraso) in self.series.items():
            params = urllib.parse.urlencode(
                {
                    "series_id": serie,
                    "api_key": self.api_key,
                    "file_type": "json",
                    "sort_order": "desc",
                    "limit": 24,
                }
            )
            url = f"https://api.stlouisfed.org/fred/series/observations?{params}"
            try:
                with urllib.request.urlopen(url, timeout=TIMEOUT_S) as r:  # noqa: S310 - host fijo
                    body = json.loads(r.read().decode("utf8"))
            except urllib.error.HTTPError as err:
                raise ProviderError(f"FRED {clave} respondió {err.code}") from err
            except Exception as err:  # noqa: BLE001
                raise ProviderError(f"FRED {clave}: {err}") from err

            for obs in body.get("observations", []):
                if obs.get("value") in (None, ".", ""):
                    continue
                try:
                    observed = datetime.strptime(obs["date"], "%Y-%m-%d").replace(tzinfo=UTC)
                    out.append(
                        Record(
                            observed_at=observed,
                            published_at=observed + timedelta(days=retraso),
                            value=float(obs["value"]),
                            key=clave,
                            raw={"serie": serie},
                        )
                    )
                except (ValueError, KeyError):
                    continue
        return out

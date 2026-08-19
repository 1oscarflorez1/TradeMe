"""CLI: publica la distribución de referencia del funding por símbolo (M12).

Uso: python -m trademe_quant.run_fundamental BTCUSDT ETHUSDT

Lee `derivatives_metrics` filtrando por `published_at` —nunca por `observed_at`— y escribe
`artifacts/fundamental/<SÍMBOLO>.json`. La api lo recoge con `POST /reload` y sitúa contra esos
cortes el funding del momento.

Lo que se publica es una **distribución, no una decisión**: los 101 cortes de percentil de los
últimos 90 días. Quién penaliza y cuánto se decide en el motor, y hoy no penaliza a nadie porque el
score está en sombra.
"""

from __future__ import annotations

import os
import sys
from datetime import UTC, datetime

from .ensemble import artifacts_dir
from .fundamental import DEFAULT_WINDOW_DAYS, MIN_OBSERVACIONES, refresh


def _dsn() -> str:
    return os.environ.get("DATABASE_URL", "postgresql://trademe:trademe@localhost:5432/trademe")


def publish(
    dsn: str,
    symbols: list[str],
    momento: datetime | None = None,
    window_days: int = DEFAULT_WINDOW_DAYS,
) -> list[str]:
    """Recalcula y publica todos los símbolos. Devuelve un registro legible para el piloto.

    Cada símbolo va aislado: uno sin histórico suficiente no impide publicar los demás. Se declara
    `stale` y la api aplica penalización 0 — que es la respuesta honesta, no un 0 disimulado.
    """
    ahora = momento or datetime.now(tz=UTC)
    base = artifacts_dir()
    log: list[str] = []
    for symbol in symbols:
        try:
            art = refresh(dsn, symbol.upper(), ahora, base, window_days)
            if art["stale"]:
                log.append(
                    f"{symbol}: sin muestra suficiente "
                    f"({art['n']}/{MIN_OBSERVACIONES}), score en 0"
                )
            else:
                log.append(f"{symbol}: distribución de {art['n']} observaciones ({art['version']})")
        except Exception as err:  # noqa: BLE001 - un símbolo caído no tumba el ciclo
            log.append(f"{symbol}: ERROR {err}")
    return log


def main() -> None:
    symbols = sys.argv[1:] or ["BTCUSDT"]
    for linea in publish(_dsn(), symbols):
        print(linea)


if __name__ == "__main__":
    main()

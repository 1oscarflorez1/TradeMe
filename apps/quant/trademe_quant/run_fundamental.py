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
from .fundamental import (
    DEFAULT_WINDOW_DAYS,
    MIN_OBSERVACIONES,
    build_artifact,
    funding_window,
    write_artifact,
)


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
            sym = symbol.upper()
            valores = funding_window(dsn, sym, ahora, window_days)
            if not valores:
                # Sin una sola observación no hay nada que publicar. Suele ser un activo que
                # simplemente no tiene funding —una acción, un índice—, y escribirle un artefacto
                # vacío dejaría un fichero muerto por cada uno de ellos.
                log.append(f"{sym}: sin funding (no es un perpetuo), no se publica")
                continue
            art = build_artifact(sym, valores, ahora, window_days)
            write_artifact(art, base)
            if art["stale"]:
                # Dos motivos distintos y conviene no confundirlos: «faltan datos» se arregla
                # esperando, «faltan días» se arregla con un backfill. Decir solo «sin muestra»
                # cuando sobran observaciones y lo que falta es historia manda a mirar donde no es.
                if art["n"] < MIN_OBSERVACIONES:
                    motivo = f"sin muestra suficiente ({art['n']}/{MIN_OBSERVACIONES})"
                else:
                    motivo = (
                        f"ventana cubierta al {art['cobertura']:.0%} de los {window_days} días "
                        f"(se exige {art['min_cobertura']:.0%}); faltan datos históricos"
                    )
                log.append(f"{sym}: {motivo}, score en 0")
            else:
                log.append(f"{sym}: distribución de {art['n']} observaciones ({art['version']})")
        except Exception as err:  # noqa: BLE001 - un símbolo caído no tumba el ciclo
            log.append(f"{symbol}: ERROR {err}")
    return log


def main() -> None:
    symbols = sys.argv[1:] or ["BTCUSDT"]
    for linea in publish(_dsn(), symbols):
        print(linea)


if __name__ == "__main__":
    main()

from __future__ import annotations

from typing import Any

from .market.normalize import Candle

_UPSERT = """
INSERT INTO candles (symbol, interval, ts, open, high, low, close, volume)
VALUES (%s, %s, to_timestamp(%s / 1000.0), %s, %s, %s, %s, %s)
ON CONFLICT (symbol, interval, ts) DO UPDATE SET
  open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
  close = EXCLUDED.close, volume = EXCLUDED.volume
"""


#: Velas por lote. Un commit por vela era irrelevante mientras el sink solo servía para sembrar unos
#: cientos; con el relleno de huecos pasan decenas de miles por ciclo y cada commit es un viaje de
#: ida y vuelta. Quinientas caben de sobra en un `executemany` y acotan lo que se pierde si el
#: proceso muere a media tanda — que no es gran cosa, porque el upsert es idempotente y el ciclo
#: siguiente vuelve a por ellas.
LOTE_VELAS = 500


class PgCandleSink:
    """Sink que persiste velas en TimescaleDB vía psycopg (import perezoso).

    Escribe **por lotes**: `write` acumula y comprometer ocurre cada `lote` velas y al cerrar. Quien
    necesite que algo esté en disco antes de tiempo, que llame a `flush`.
    """

    def __init__(self, dsn: str, lote: int = LOTE_VELAS) -> None:
        import psycopg

        self._conn: Any = psycopg.connect(dsn)
        self._lote = max(1, lote)
        self._pendientes: list[tuple[Any, ...]] = []

    def write(self, candle: Candle) -> None:
        self._pendientes.append(
            (
                candle.symbol,
                candle.interval,
                candle.open_time,
                candle.open,
                candle.high,
                candle.low,
                candle.close,
                candle.volume,
            )
        )
        if len(self._pendientes) >= self._lote:
            self.flush()

    def flush(self) -> None:
        """Compromete lo acumulado. Idempotente: sin nada pendiente no hace nada."""
        if not self._pendientes:
            return
        with self._conn.cursor() as cur:
            cur.executemany(_UPSERT, self._pendientes)
        self._conn.commit()
        self._pendientes.clear()

    def close(self) -> None:
        """Cierra, comprometiendo antes lo que quede. La conexión se cierra pase lo que pase."""
        try:
            self.flush()
        finally:
            self._conn.close()


def save_backtest(dsn: str, symbol: str, interval: str, result: dict[str, Any]) -> None:
    """Persiste el resultado de un backtest en la tabla backtests."""
    import json

    import psycopg

    m = result["metrics"]
    oos = result["oos_metrics"]
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO backtests
              (symbol, interval, n_trades, win_rate, expectancy, profit_factor,
               max_drawdown, sharpe, oos_win_rate, oos_expectancy, metrics, trades, equity_curve)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                symbol.upper(),
                interval,
                m["n_trades"],
                m["win_rate"],
                m["expectancy"],
                m["profit_factor"],
                m["max_drawdown"],
                m["sharpe"],
                oos["win_rate"],
                oos["expectancy"],
                json.dumps({"metrics": m, "oos_metrics": oos}),
                json.dumps(result["trades"]),
                json.dumps(m["equity_curve"]),
            ),
        )
        conn.commit()


def _serie_entre(
    conn: Any, symbol: str, interval: str, desde_excl: Any, hasta_incl: Any
) -> tuple[list[int], list[tuple[float, float, float]]]:
    """Velas con `desde_excl < ts <= hasta_incl`, como `(tiempos en ms, (high, low, close))`."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT (EXTRACT(epoch FROM ts) * 1000)::bigint, high, low, close FROM candles "
            "WHERE symbol=%s AND interval=%s AND ts > %s AND ts <= %s ORDER BY ts",
            (symbol, interval, desde_excl, hasta_incl),
        )
        filas = cur.fetchall()
    return [int(r[0]) for r in filas], [(float(r[1]), float(r[2]), float(r[3])) for r in filas]


def _trayectoria_de(conn: Any, symbol: str, interval: str, captured_at: Any, h: int) -> Any:
    """La trayectoria de una decisión leída de la base. La definición está en `ventana`.

    Se piden solo las velas que pueden entrar: las gruesas desde un periodo antes de la captura
    —para incluir la vela de captura y anclar su fase— hasta `h` periodos después, y las finas del
    periodo que sigue a la captura. Con eso `ventana.trayectoria` tiene todo lo que necesita.

    Devuelve `None` si la temporalidad no tiene duración conocida: sin ella no hay trayectoria que
    construir. Ver `_velas_sin_duracion`.
    """
    from datetime import timedelta

    from .market.normalize import INTERVAL_MS
    from .ventana import fina_de, trayectoria

    periodo = INTERVAL_MS.get(str(interval))
    if periodo is None:
        return None
    captured_ms = int(captured_at.timestamp() * 1000)
    gruesa_t, gruesa_v = _serie_entre(
        conn,
        symbol,
        interval,
        captured_at - timedelta(milliseconds=periodo),
        captured_at + timedelta(milliseconds=periodo * h),
    )
    fina, fina_ms = fina_de(str(interval))
    fina_t: list[int] = []
    fina_v: list[tuple[float, float, float]] = []
    if fina is not None:
        # `ts >= captured_at` se pide como `> captured_at − 1 ms`: la vela fina que abre justo en
        # la captura es enteramente posterior a la decisión y tiene que entrar.
        fina_t, fina_v = _serie_entre(
            conn,
            symbol,
            fina,
            captured_at - timedelta(milliseconds=1),
            captured_at + timedelta(milliseconds=periodo),
        )
    return trayectoria(captured_ms, periodo, h, gruesa_t, gruesa_v, fina_ms, fina_t, fina_v)


def _velas_sin_duracion(
    conn: Any, symbol: str, interval: str, captured_at: Any, h: int
) -> list[tuple[float, float, float]]:
    """Las `h` velas posteriores de una temporalidad **sin duración fija** (`1M`).

    Sin duración no se puede construir una trayectoria acotada en tiempo, así que se mantiene el
    comportamiento anterior. A 13-sep-2026 hay cuatro decisiones en `1M` en todo el histórico: no
    merece una regla propia, pero tampoco se les cambia la que tenían.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT high, low, close FROM candles WHERE symbol=%s AND interval=%s AND ts > %s "
            "ORDER BY ts LIMIT %s",
            (symbol, interval, captured_at, h),
        )
        return [(float(r[0]), float(r[1]), float(r[2])) for r in cur.fetchall()]


#: Columnas de cada rama de desenlace: (dirección, entrada, stop, objetivo, resultado, R, instante).
_COLUMNAS: dict[str, tuple[str, str, str, str, str, str, str]] = {
    "real": (
        "direction",
        "plan_entry",
        "plan_stop",
        "plan_take_profit",
        "outcome_result",
        "outcome_return_r",
        "evaluated_at",
    ),
    "sombra": (
        "shadow_direction",
        "shadow_entry",
        "shadow_stop",
        "shadow_take_profit",
        "shadow_outcome_result",
        "shadow_outcome_return_r",
        "shadow_evaluated_at",
    ),
}


def _evaluar_rama(dsn: str, rama: str, horizon: int, horizons: dict[str, int] | None) -> int:
    """Rellena los desenlaces pendientes de una rama. Real y sombra comparten regla, no columnas.

    Estaban escritas dos veces, línea a línea. Con la ventana cambiando de definición, dos copias
    eran dos sitios donde olvidarse de cambiarla.
    """
    import psycopg

    from .backtest import evaluate_trade
    from .ventana import desenlace

    direccion, entrada, parada, objetivo, resultado, retorno, instante = _COLUMNAS[rama]
    updated = 0
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT id, symbol, interval, captured_at, {direccion},
                       {entrada}, {parada}, {objetivo}
                FROM snapshots
                WHERE {resultado} IS NULL AND {entrada} IS NOT NULL
                      AND {direccion} IN ('LONG','SHORT')
                """)  # noqa: S608 - los nombres salen de _COLUMNAS, un mapa fijo de este módulo
            pending = cur.fetchall()
        for row in pending:
            sid, symbol, interval, captured_at, direction, entry, stop, tp = row
            h = (horizons or {}).get(str(interval), horizon)
            tray = _trayectoria_de(conn, symbol, interval, captured_at, h)
            if tray is not None:
                res = desenlace(direction, float(entry), float(stop), float(tp), tray)
            else:
                future = _velas_sin_duracion(conn, symbol, interval, captured_at, h)
                res = (
                    evaluate_trade(
                        direction,
                        float(entry),
                        float(stop),
                        float(tp),
                        [r[0] for r in future],
                        [r[1] for r in future],
                        [r[2] for r in future],
                    )
                    if future
                    else None
                )
                if res is not None and res["result"] == "timeout" and len(future) < h:
                    res = None
            if res is None:
                continue  # aún no puede cerrarse: se deja pendiente
            with conn.cursor() as cur:
                cur.execute(
                    f"UPDATE snapshots SET {resultado}=%s, {retorno}=%s, {instante}=now() "
                    "WHERE id=%s",  # noqa: S608 - mismo mapa fijo
                    (res["result"], res["r"], sid),
                )
            updated += 1
        conn.commit()
    return updated


def evaluate_shadow_outcomes(
    dsn: str, horizon: int = 20, horizons: dict[str, int] | None = None
) -> int:
    """Puntúa las decisiones **sombra**: las que la cuarentena impidió emitir (M10.7).

    Una temporalidad en cuarentena no opera, así que no genera ninguna operación real que evaluar.
    Sin esto no podría acumular expediente y la cuarentena sería irreversible por construcción: la
    temporalidad quedaría vetada para siempre por no poder demostrar lo contrario.

    Mismas reglas de cierre que el desenlace real —primer toque, horizonte completo para declarar
    timeout— pero en `shadow_outcome_*`. **Estas cifras no son rendimiento**: nadie operó. Sirven
    para decidir si la cuarentena se levanta, y para nada más.
    """
    return _evaluar_rama(dsn, "sombra", horizon, horizons)


def evaluate_snapshot_outcomes(
    dsn: str, horizon: int = 20, horizons: dict[str, int] | None = None
) -> int:
    """Rellena outcome_* de los snapshots pendientes usando las velas posteriores.

    Regla de cierre, deliberadamente asimétrica:

    - Un toque de objetivo o de stop es DEFINITIVO aunque ocurra en la primera vela: el precio
      estuvo ahí y eso ya no cambia. Se cierra siempre.
    - Un «timeout» solo es válido si de verdad transcurrió el horizonte completo. Cerrar por tiempo
      con tres velas disponibles no significa que la operación no fuera a ninguna parte, significa
      que aún no le hemos dado tiempo. Antes se cerraban igual y, como el resultado dejaba de ser
      nulo, no se volvían a evaluar jamás: en 1d eso convertía el 100 % de los registros en timeouts
      artificiales.

    «Horizonte completo» se comprueba **en tiempo**, no en número de filas, y la ventana arranca
    **en la captura**, no en la vela siguiente. Las dos cosas están en `ventana.trayectoria`, que es
    la única definición: la usan también el filtro de reproducibilidad y el contador de bloqueadas.

    El horizonte es **por temporalidad** desde M10.5 (`horizons`). Las 20 velas fijas anteriores
    eran 20 minutos en 1m y 20 días en 1d: en las cortas cerraban por tiempo operaciones que aún
    tenían recorrido —el 31 % del total—, y en 1d, 1w y 1M exigían más histórico del que existe, de
    modo que esos registros no llegaban a evaluarse nunca. `horizon` queda como reserva para las
    temporalidades que no aparezcan en el mapa.
    """
    return _evaluar_rama(dsn, "real", horizon, horizons)


def last_backtests(dsn: str, symbol: str, interval: str, limit: int = 2) -> list[dict[str, Any]]:
    """Últimas mediciones (más reciente primero) para decidir si hay degradación."""
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """SELECT expectancy, n_trades,
                      EXTRACT(EPOCH FROM (now() - created_at)) / 3600 AS hours_ago
               FROM backtests WHERE symbol = %s AND interval = %s
               ORDER BY created_at DESC LIMIT %s""",
            (symbol.upper(), interval, limit),
        )
        return [
            {
                "expectancy": float(r[0]) if r[0] is not None else 0.0,
                "n_trades": int(r[1] or 0),
                "hours_ago": float(r[2]),
            }
            for r in cur.fetchall()
        ]


def insert_alert(
    dsn: str,
    type_: str,
    severity: str,
    title: str,
    message: str,
    symbol: str | None = None,
    interval: str | None = None,
) -> None:
    """Crea una alerta (campana del portal) desde el worker de automatización."""
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            """INSERT INTO alerts (symbol, interval, type, severity, title, message)
               VALUES (%s, %s, %s, %s, %s, %s)""",
            (symbol, interval, type_, severity, title, message),
        )
        conn.commit()


def ventana_cerrada(
    captured_at_ms: int, periodo_ms: int, h: int, ahora_ms: int, margen_ms: int | None = None
) -> bool:
    """¿Debería estar ya **cerrada** la última vela de la ventana de evaluación de una decisión?

    Desde 0.72.0 la ventana arranca en la vela de captura y cierra en `apertura_captura + h·periodo`
    —ver `ventana.trayectoria`—, que nunca es posterior a `captured_at + h·periodo`. Esta función
    usa esa cota superior más un periodo y el margen, así que sigue siendo segura sin consultar la
    base: puede esperar de más, nunca de menos. Por eso «la ventana venció» no basta para decir que
    a una decisión le faltan velas: hay que esperar a que su última vela haya podido cerrar.

    El fallo que esto corrige (12 sep 2026)
    ----------------------------------------
    La primera versión de `bloqueadas_por_hueco` usaba `now() > captured_at + h·periodo`. El día que
    se desplegó 0.71.0 informaba de `BNBUSDT:4h` como «nunca se evaluará» con 14 velas de 15, y la
    que faltaba era la de las 20:00 de ese mismo día, **todavía en formación**. En 4h el aviso falso
    dura cuatro horas; en **1d, un día entero por cada decisión** —y 1d es la única temporalidad que
    opera. Un contador de «perdidas para siempre» que cuenta como perdidas las que aún están en
    camino no mide lo que dice.

    El margen es el mismo que usa el relleno de la cola (`huecos.MARGEN_CIERRE_MS`), a propósito:
    si las dos piezas usaran márgenes distintos, podrían discrepar sobre si una vela ya cerró.
    """
    if margen_ms is None:
        from .huecos import MARGEN_CIERRE_MS

        margen_ms = MARGEN_CIERRE_MS
    fin = captured_at_ms + periodo_ms * h
    return ahora_ms >= fin + periodo_ms + margen_ms


def bloqueadas_por_hueco(
    dsn: str,
    horizons: dict[str, int] | None = None,
    horizon: int = 20,
    ahora_ms: int | None = None,
) -> int:
    """Decisiones que ya nunca se evaluarán porque a su ventana le faltan velas.

    Acotar la ventana en tiempo corrige el desenlace falso, pero tiene una consecuencia que no debe
    quedar muda: si un hueco de ingesta cae dentro de la ventana de una decisión, esa decisión se
    queda pendiente **para siempre**, porque el momento de recogerlas ya pasó. Es preferible a
    inventarle un desenlace, y aun así hay que poder contarlas: una cifra que crece delata que la
    ingesta está perdiendo velas, y era justo lo que nadie estaba mirando.

    Solo cuenta aquellas cuya última vela **ya debería haber cerrado**; las demás están pendientes
    por motivos normales. Ver `ventana_cerrada`. `ahora_ms` existe para fijar el reloj en los tests.
    """
    import time

    import psycopg

    from .market.normalize import INTERVAL_MS

    ahora = ahora_ms if ahora_ms is not None else int(time.time() * 1000)
    total = 0
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT symbol, interval, captured_at FROM snapshots
                WHERE outcome_result IS NULL AND plan_entry IS NOT NULL
                      AND direction IN ('LONG','SHORT')
                """)
            pendientes = cur.fetchall()
        for symbol, interval, captured_at in pendientes:
            ms = INTERVAL_MS.get(str(interval))
            if ms is None:
                continue
            h = (horizons or {}).get(str(interval), horizon)
            if not ventana_cerrada(int(captured_at.timestamp() * 1000), ms, h, ahora):
                continue  # su última vela aún puede estar formándose: no está perdida, llegará
            # Misma definición de ventana que el evaluador: si aquí se contara de otra forma, el
            # contador y el evaluador podrían discrepar sobre la misma decisión.
            tray = _trayectoria_de(conn, symbol, interval, captured_at, h)
            if tray is None or not tray.completa:
                total += 1
    return total

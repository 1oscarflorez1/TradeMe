"""Las velas que nunca llegaron, recuperadas de Binance.

De dónde salen los huecos
--------------------------
La api persiste **solo lo que ve pasar**: `onCandle` escribe la vela cuando el stream la cierra. Si
el proceso no está corriendo —la máquina apagada, un reinicio, un despliegue— esas velas no las
guarda nadie, y nadie vuelve nunca a por ellas. No es un fallo de reconexión que se pueda arreglar
en el stream: es una condición del despliegue, y lo que faltaba era la compensación.

Se nota en que los huecos son **simultáneos en todos los símbolos**: el de 24 h del 20 de agosto
está en BTCUSDT, ETHUSDT, SOLUSDT y BNBUSDT a la vez. No se cae el stream de un activo, se para el
proceso entero.

Lo que costaba
--------------
Medido el 24-ago-2026: **BTCUSDT 1m tenía 11.099 velas de las 36.037** de su propio rango, un 31 %.
Y eso no es solo un gráfico con menos puntos — la evaluación de desenlaces lee de aquí, así que
343 de las 839 decisiones cerradas desde el 6 de agosto tenían la ventana incompleta. El guardia de
0.55.0 dejó de darlas por buenas, que era lo correcto; esto es lo que hace que dejen de faltar.

Lo que NO hace
---------------
Rellena **huecos interiores**, entre la primera y la última vela que ya existen. No extiende la
serie hacia atrás: alargar la ventana es otro hito, tiene otro coste y hay que medirlo antes,
porque el backtest crece con el cuadrado del número de velas.

Y solo para símbolos de **Binance**. En una acción un hueco no es un fallo, es que el mercado
estaba cerrado; rellenar ahí inventaría sesiones que no existieron.
"""

from __future__ import annotations

from typing import Any, NamedTuple

from .market.normalize import interval_ms

#: Máximo de velas que Binance devuelve por petición.
LIMITE_BINANCE = 1000
#: Peticiones que puede gastar un ciclo. Con ~66 hacía falta para ponerse al día desde cero, así
#: que veinte por ciclo lo resuelven en tres o cuatro pasadas sin alargar el ciclo ni martillear la
#: API. El presupuesto es por ciclo entero, no por símbolo: si uno tiene un socavón, se lo lleva.
PRESUPUESTO_POR_CICLO = 20


class Hueco(NamedTuple):
    """Tramo que falta, en milisegundos [desde, hasta), ambos en `open_time` de vela."""

    symbol: str
    interval: str
    desde: int
    hasta: int

    @property
    def velas(self) -> int:
        paso = interval_ms(self.interval)
        return max(0, (self.hasta - self.desde) // paso)

    @property
    def peticiones(self) -> int:
        return max(1, -(-self.velas // LIMITE_BINANCE))  # techo de la división


def tramos_faltantes(open_times: list[int], paso_ms: int) -> list[tuple[int, int]]:
    """Tramos ausentes dentro de una serie ordenada de `open_time`.

    Devuelve `[desde, hasta)` con la primera vela que falta y la primera que ya está, de modo que
    el rango se puede pedir tal cual. Función pura: la parte que decide qué falta no necesita ni
    base de datos ni red, y así se puede probar de verdad.
    """
    if paso_ms <= 0 or len(open_times) < 2:
        return []
    orden = sorted(open_times)
    fuera: list[tuple[int, int]] = []
    for anterior, siguiente in zip(orden, orden[1:], strict=False):
        if siguiente - anterior > paso_ms:
            fuera.append((anterior + paso_ms, siguiente))
    return fuera


def huecos_de(dsn: str, symbol: str, interval: str) -> list[Hueco]:
    """Huecos interiores de un símbolo y temporalidad, leídos de la base de datos."""
    import psycopg

    try:
        paso = interval_ms(interval)
    except ValueError:
        return []  # temporalidad sin duración conocida (1M): no se puede razonar sobre huecos
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT (EXTRACT(epoch FROM ts) * 1000)::bigint FROM candles "
            "WHERE symbol=%s AND interval=%s ORDER BY ts",
            (symbol, interval),
        )
        tiempos = [int(r[0]) for r in cur.fetchall()]
    return [
        Hueco(symbol=symbol, interval=interval, desde=a, hasta=b)
        for a, b in tramos_faltantes(tiempos, paso)
    ]


def rellenar_hueco(dsn: str, hueco: Hueco, sink: Any = None) -> int:
    """Pide a Binance el tramo que falta y lo guarda. Devuelve las velas escritas.

    Pagina dentro del hueco porque un socavón de tres días en 1m son 4.320 velas y Binance da 1.000
    por petición. Se corta si la API deja de avanzar, para no girar en vacío.
    """
    from .db import PgCandleSink
    from .market.binance import fetch_klines
    from .market.normalize import normalize_rest_kline

    paso = interval_ms(hueco.interval)
    propio = sink is None
    destino = sink if sink is not None else PgCandleSink(dsn)
    escritas = 0
    cursor = hueco.desde
    try:
        while cursor < hueco.hasta:
            filas = fetch_klines(
                hueco.symbol,
                hueco.interval,
                limit=LIMITE_BINANCE,
                start_ms=cursor,
                end_ms=hueco.hasta - 1,
            )
            if not filas:
                break
            for fila in filas:
                vela = normalize_rest_kline(hueco.symbol, hueco.interval, fila)
                if vela.open_time >= hueco.hasta:
                    continue
                destino.write(vela)
                escritas += 1
            ultimo = int(filas[-1][0])
            if ultimo + paso <= cursor:
                break  # la API no avanza: se corta en vez de repetir la misma petición
            cursor = ultimo + paso
    finally:
        if propio:
            destino.close()
    return escritas


def rellenar(
    dsn: str,
    symbols: list[str],
    intervals: list[str],
    presupuesto: int = PRESUPUESTO_POR_CICLO,
) -> list[str]:
    """Rellena lo que quepa en el presupuesto, empezando por los huecos más grandes.

    Se atacan primero los mayores porque son los que más evaluaciones bloquean: un socavón de tres
    días en 1m deja sin desenlace muchas más decisiones que veinte huecos de una vela.
    """
    pendientes: list[Hueco] = []
    for symbol in symbols:
        for interval in intervals:
            try:
                pendientes.extend(huecos_de(dsn, symbol, interval))
            except Exception as err:  # noqa: BLE001 - un símbolo ilegible no tumba a los demás
                return [f"{symbol} {interval}: no se pudieron leer los huecos ({err})"]
    if not pendientes:
        return []

    from .db import PgCandleSink

    pendientes.sort(key=lambda h: h.velas, reverse=True)
    log: list[str] = []
    gastado = 0
    escritas = 0
    atendidos = 0
    sink = PgCandleSink(dsn)  # uno para todo el ciclo: son decenas de miles de velas
    try:
        for hueco in pendientes:
            if gastado >= presupuesto:
                break
            try:
                escritas += rellenar_hueco(dsn, hueco, sink=sink)
                gastado += hueco.peticiones
                atendidos += 1
            except Exception as err:  # noqa: BLE001 - un hueco que falla no impide los siguientes
                log.append(f"{hueco.symbol} {hueco.interval}: falló el relleno ({err})")
                gastado += 1
    finally:
        sink.close()

    quedan = len(pendientes) - atendidos
    faltan_velas = sum(h.velas for h in pendientes[atendidos:])
    log.append(
        f"{escritas} velas recuperadas en {atendidos} hueco(s); "
        f"quedan {quedan} hueco(s) con {faltan_velas} velas"
    )
    return log

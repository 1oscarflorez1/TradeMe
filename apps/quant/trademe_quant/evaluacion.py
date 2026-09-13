"""¿Se puede confiar en el desenlace que hay guardado?

Por qué hace falta preguntarlo
-------------------------------
El histórico mezcla dos reglas. Los `outcome_return_r` anteriores al 6 de agosto de 2026 se
evaluaron con 20 velas fijas para toda temporalidad; los posteriores, con `horizon_by_tf`. Y desde
0.55.0 hay una tercera diferencia: la ventana se acota **en tiempo**, no en número de velas.

Un desenlace escrito con una regla vieja no es «antiguo», es **otra medición**. Y sigue alimentando
el entrenamiento del meta-modelo, el expediente de la cuarentena y los estudios del Fundamental
Score, que hasta ahora se lo comían entero.

Por qué se recalcula y no se marca
-----------------------------------
Marcar en una columna obligaría a acordarse de refrescarla, y el propio proyecto lleva tres hitos
corrigiendo justo eso. Además el veredicto **cambia con los datos**: al rellenar los huecos de
`candles`, decisiones que hoy no reproducen pasan a reproducir porque por fin tienen sus velas. Una
marca escrita hoy sería falsa mañana; un criterio que se recalcula, no.

Por qué por fecha no vale
--------------------------
El corte del 6 de agosto no separa lo fiable de lo que no: de los 83 «timeout» posteriores a esa
fecha, 50 tampoco tenían ventana completa. Se filtra por reproducibilidad, no por fecha.

Y una advertencia que costó descubrir: una comprobación de reproducibilidad **solo vale si puede
fallar por el motivo que se busca**. La de `run_direccion_study` daba «perfecta desde el 6-ago»
porque pedía las velas igual que la evaluación original —`LIMIT h`, sin acotar—, así que verificador
y verificado compartían el mismo defecto. De ahí que la ventana se pida aquí, en un solo sitio.
"""

from __future__ import annotations

from typing import Any, NamedTuple

from .market.normalize import INTERVAL_MS
from .ventana import Trayectoria, fina_de, trayectoria

#: Horizonte de reserva para temporalidades que no aparezcan en el mapa de configuración.
HORIZONTE_POR_DEFECTO = 20


class Veredicto(NamedTuple):
    """Por qué una decisión entra o no en un estudio."""

    id: Any
    reproducible: bool
    motivo: str
    r_guardado: float
    r_reevaluado: float | None


class Resumen(NamedTuple):
    total: int
    reproducibles: int
    sin_ventana: int
    discrepantes: int

    @property
    def fraccion(self) -> float:
        return self.reproducibles / self.total if self.total else 0.0


#: Diferencia de R por debajo de la cual dos desenlaces se consideran el mismo. La base guarda
#: `double precision`, así que recalcular con los mismos datos da el mismo número salvo redondeo.
TOLERANCIA_R = 1e-6


def juzgar(
    direction: str,
    entry: float,
    stop: float,
    take_profit: float,
    tray: Trayectoria | None,
    resultado_guardado: str,
    r_guardado: float,
    sid: Any = None,
) -> Veredicto:
    """Reevalúa una decisión con la regla vigente y la compara con lo que hay escrito.

    Misma asimetría que la evaluación real: un toque de objetivo o de stop es definitivo aunque
    falten velas, pero un «timeout» solo cuenta con la trayectoria completa. La trayectoria es la de
    `ventana.trayectoria`, la misma que usa el evaluador.

    Compara la **clase** del resultado y **el R** (0.72.0)
    -----------------------------------------------------
    Hasta 0.71.1 solo comparaba la clase: tp, sl o timeout. Un timeout cuyo R cambiaba —porque la
    ventana cerraba en otra vela y por tanto a otro precio— seguía contando como reproducible. Al
    corregir la ventana, en torno al 40 % de las operaciones de 1d cambiaban de R y casi todas
    seguían siendo timeouts: el filtro no habría detectado ninguna. Una comprobación de
    reproducibilidad solo vale si puede fallar por el motivo que se busca.
    """
    from .ventana import desenlace

    if tray is None or not tray.velas:
        return Veredicto(sid, False, "sin velas en la ventana", r_guardado, None)

    res = desenlace(direction, entry, stop, take_profit, tray)
    if res is None:
        return Veredicto(sid, False, "ventana incompleta", r_guardado, None)
    r_nuevo = float(res["r"])
    if res["result"] != resultado_guardado:
        return Veredicto(
            sid,
            False,
            f"reevaluado «{res['result']}» frente a «{resultado_guardado}» guardado",
            r_guardado,
            r_nuevo,
        )
    if abs(r_nuevo - r_guardado) > TOLERANCIA_R:
        return Veredicto(
            sid,
            False,
            f"reevaluado con R {r_nuevo:+.4f} frente a {r_guardado:+.4f} guardado",
            r_guardado,
            r_nuevo,
        )
    return Veredicto(sid, True, "coincide con la regla vigente", r_guardado, r_nuevo)


#: Las dos ramas de desenlace tienen el mismo problema y las mismas reglas, solo cambian de
#: columnas. La sombra decide si una temporalidad en cuarentena puede volver a operar, así que un
#: expediente construido sobre desenlaces de otra regla es igual de engañoso que un entrenamiento.
_RAMAS: dict[str, tuple[str, str, str, str, str, str]] = {
    "real": (
        "direction",
        "plan_entry",
        "plan_stop",
        "plan_take_profit",
        "outcome_result",
        "outcome_return_r",
    ),
    "sombra": (
        "shadow_direction",
        "shadow_entry",
        "shadow_stop",
        "shadow_take_profit",
        "shadow_outcome_result",
        "shadow_outcome_return_r",
    ),
}


def veredictos(
    dsn: str,
    horizons: dict[str, int] | None = None,
    horizon: int = HORIZONTE_POR_DEFECTO,
    rama: str = "real",
) -> list[Veredicto]:
    """Juzga todas las decisiones cerradas. Una consulta de velas por símbolo y temporalidad."""
    import psycopg

    if rama not in _RAMAS:
        raise ValueError(f"rama desconocida: {rama}")
    direccion, entrada, parada, objetivo, resultado, retorno = _RAMAS[rama]

    fuera: list[Veredicto] = []
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT id, symbol, interval, captured_at, {direccion}, {entrada}, {parada},
                       {objetivo}, {resultado}, {retorno}
                  FROM snapshots
                 WHERE {resultado} IS NOT NULL AND {entrada} IS NOT NULL
                   AND {direccion} IN ('LONG','SHORT')
                 ORDER BY symbol, interval, captured_at
                """)  # noqa: S608 - los nombres salen de _RAMAS, un mapa fijo de este módulo
            filas = cur.fetchall()

        series = _CacheSeries(conn)
        for fila in filas:
            sid, symbol, interval, capturada, direction, entry, stop, tp, res_guardado, r = fila
            ms = INTERVAL_MS.get(str(interval))
            if ms is None:
                continue  # sin duración conocida no se puede acotar la ventana ni juzgar nada
            h = (horizons or {}).get(str(interval), horizon)
            fuera.append(
                juzgar(
                    str(direction),
                    float(entry),
                    float(stop),
                    float(tp),
                    series.trayectoria(str(symbol), str(interval), capturada, h),
                    str(res_guardado),
                    float(r) if r is not None else 0.0,
                    sid=sid,
                )
            )
    return fuera


class _CacheSeries:
    """Carga cada serie una vez por símbolo y temporalidad y construye trayectorias sobre ella.

    Una consulta por serie en vez de una por decisión: son unas decenas frente a varios miles, y el
    resultado es idéntico al del evaluador porque la trayectoria sale de la misma función.
    """

    def __init__(self, conn: Any) -> None:
        self._conn = conn
        self._series: dict[tuple[str, str], tuple[list[int], list[tuple[float, float, float]]]] = {}

    def serie(
        self, symbol: str, interval: str
    ) -> tuple[list[int], list[tuple[float, float, float]]]:
        clave = (symbol, interval)
        if clave not in self._series:
            with self._conn.cursor() as cur:
                cur.execute(
                    "SELECT (EXTRACT(epoch FROM ts) * 1000)::bigint, high, low, close "
                    "FROM candles WHERE symbol=%s AND interval=%s ORDER BY ts",
                    (symbol, interval),
                )
                cargadas = cur.fetchall()
            self._series[clave] = (
                [int(c[0]) for c in cargadas],
                [(float(c[1]), float(c[2]), float(c[3])) for c in cargadas],
            )
        return self._series[clave]

    def trayectoria(self, symbol: str, interval: str, capturada: Any, h: int) -> Trayectoria | None:
        ms = INTERVAL_MS.get(interval)
        if ms is None:
            return None
        gruesa_t, gruesa_v = self.serie(symbol, interval)
        fina, fina_ms = fina_de(interval)
        fina_t, fina_v = self.serie(symbol, fina) if fina is not None else ([], [])
        return trayectoria(
            int(capturada.timestamp() * 1000), ms, h, gruesa_t, gruesa_v, fina_ms, fina_t, fina_v
        )


def ids_reproducibles(
    dsn: str,
    horizons: dict[str, int] | None = None,
    horizon: int = HORIZONTE_POR_DEFECTO,
    rama: str = "real",
) -> set[Any]:
    """El conjunto con el que los estudios filtran sus filas."""
    return {v.id for v in veredictos(dsn, horizons, horizon, rama) if v.reproducible}


def resumir(lista: list[Veredicto]) -> Resumen:
    """Cifras para el log del piloto: cuántas entran y por qué se caen las demás."""
    return Resumen(
        total=len(lista),
        reproducibles=sum(1 for v in lista if v.reproducible),
        sin_ventana=sum(1 for v in lista if not v.reproducible and "ventana" in v.motivo),
        discrepantes=sum(1 for v in lista if not v.reproducible and "reevaluado" in v.motivo),
    )

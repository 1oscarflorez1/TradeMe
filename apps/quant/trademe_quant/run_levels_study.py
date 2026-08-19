"""Fase 0 del Analista de Niveles: medir antes de dar voto.

Uso: python -m trademe_quant.run_levels_study <snapshots.csv> [SIMBOLO]

Responde a las dos preguntas acordadas, con los umbrales fijados **antes** de calcular nada:

1. **¿Aporta un eje independiente?** Se calculan los votos efectivos —participación de los
   autovalores de la matriz de correlación, la misma medida que usa `independence.py`— con los seis
   votos actuales y con los siete. Listón: **+0,5** (de 1,41 a >=1,91 en 4h).

2. **¿Predice algo por sí solo?** Expectancy por tercil, separando largos de cortos como se hizo con
   el funding en M12, y con corrección de Bonferroni por el número de comparaciones que se declaran
   aquí abajo y no después de ver los resultados.

El script **no toca producción**: lee snapshots ya registrados y velas públicas de Binance, y
escribe un informe por pantalla. Nada de lo que calcula entra en ninguna decisión.

Sobre el look-ahead: para cada snapshot se usan solo las velas cuyo cierre es anterior a su
`captured_at`, y el detector además descarta los pivotes sin confirmar (ver `levels.py`). Las dos
cosas hacen falta: la primera evita usar velas del futuro, la segunda evita usar el futuro *dentro*
de las velas disponibles.
"""

from __future__ import annotations

import csv
import json
import math
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import UTC, datetime
from typing import NamedTuple

import numpy as np

from .independence import effective_votes
from .levels import WINDOW, score_niveles

REST = "https://api.binance.com/api/v3/klines"
TIMEOUT_S = 20
#: Tope de páginas por temporalidad, para que el estudio no se eternice en 1m.
MAX_PAGINAS = 60
#: Muestra mínima para fiarse de una matriz de correlación de 7x7 (21 pares).
MIN_MUESTRA = 40
#: Umbral acordado con el usuario antes de medir: votos efectivos que debe añadir.
UMBRAL_LIFT_VOTOS = 0.5

VOTOS_ACTUALES = (
    "ema_cross_score",
    "macd_score",
    "supertrend_score",
    "rsi14_score",
    "bbands_score",
    "stoch14_score",
)

MS_POR_INTERVALO: dict[str, int] = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "30m": 1_800_000,
    "1h": 3_600_000,
    "4h": 14_400_000,
    "1d": 86_400_000,
}


class Vela(NamedTuple):
    abre_ms: int
    high: float
    low: float
    close: float


class Fila(NamedTuple):
    interval: str
    captured_ms: int
    direction: str
    votos: list[float]
    retorno_r: float | None


def _klines(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[Vela]:
    """Histórico paginado. Datos públicos de Binance, sin clave."""
    out: list[Vela] = []
    cursor = start_ms
    for _ in range(MAX_PAGINAS):
        if cursor >= end_ms:
            break
        params = urllib.parse.urlencode(
            {
                "symbol": symbol.upper(),
                "interval": interval,
                "startTime": cursor,
                "endTime": end_ms,
                "limit": 1000,
            }
        )
        with urllib.request.urlopen(f"{REST}?{params}", timeout=TIMEOUT_S) as r:  # noqa: S310
            datos = json.loads(r.read().decode("utf8"))
        if not datos:
            break
        for k in datos:
            out.append(Vela(int(k[0]), float(k[2]), float(k[3]), float(k[4])))
        ultimo = int(datos[-1][0])
        if ultimo <= cursor:
            break
        cursor = ultimo + 1
    return out


def cargar(csv_path: str) -> list[Fila]:
    """Snapshots exportados de la base de datos. Se descartan los que no tienen los seis votos."""
    filas: list[Fila] = []
    with open(csv_path, encoding="utf8", newline="") as fh:
        for row in csv.DictReader(fh):
            valores: list[float] = []
            completo = True
            for col in VOTOS_ACTUALES:
                bruto = (row.get(col) or "").strip()
                if not bruto:
                    completo = False
                    break
                valores.append(float(bruto))
            if not completo:
                continue
            ts = datetime.fromisoformat(row["captured_at"]).astimezone(UTC)
            r_bruto = (row.get("outcome_return_r") or "").strip()
            filas.append(
                Fila(
                    interval=row["interval"],
                    captured_ms=int(ts.timestamp() * 1000),
                    direction=(row.get("direction") or "").strip(),
                    votos=valores,
                    retorno_r=float(r_bruto) if r_bruto else None,
                )
            )
    return filas


def score_en(velas: list[Vela], hasta_ms: int) -> tuple[float, float] | None:
    """Score de niveles con lo que se sabía en `hasta_ms`.

    El corte es por **vela ya cerrada**: se exige `abre_ms < hasta_ms`. Una vela que todavía se está
    formando no ha producido ningún pivote confirmado, así que incluirla no aportaría nada y sí
    abriría la puerta a contar como pasado algo que aún no lo era.
    """
    fin = 0
    for i, v in enumerate(velas):
        if v.abre_ms < hasta_ms:
            fin = i + 1
        else:
            break
    if fin < WINDOW // 2:
        return None
    trozo = velas[max(0, fin - WINDOW) : fin]
    return score_niveles([v.high for v in trozo], [v.low for v in trozo], [v.close for v in trozo])


def _corr(columnas: list[list[float]]) -> np.ndarray:
    datos = np.asarray(columnas, dtype=float)
    desv = datos.std(axis=1)
    if float(desv.max(initial=0.0)) <= 0.0:
        return np.ones((len(columnas), len(columnas)), dtype=float)
    constantes = desv <= 0.0
    if constantes.any():
        datos = datos.copy()
        datos[constantes, :] = np.linspace(0.0, 1.0, datos.shape[1])
    corr = np.corrcoef(datos)
    limpia: np.ndarray = np.nan_to_num(np.asarray(corr, dtype=float), nan=1.0)
    return limpia


def _terciles(pares: list[tuple[float, float]]) -> list[tuple[int, float, float]]:
    """Parte por terciles de la magnitud y devuelve (n, media, desviación) del retorno."""
    if len(pares) < 9:
        return []
    ordenados = sorted(pares, key=lambda p: p[0])
    corte = len(ordenados) // 3
    grupos = [ordenados[:corte], ordenados[corte : 2 * corte], ordenados[2 * corte :]]
    out: list[tuple[int, float, float]] = []
    for g in grupos:
        rs = [r for _, r in g]
        n = len(rs)
        media = sum(rs) / n if n else 0.0
        var = sum((x - media) ** 2 for x in rs) / (n - 1) if n > 1 else 0.0
        out.append((n, media, math.sqrt(var)))
    return out


def _t_extremos(grupos: list[tuple[int, float, float]]) -> float:
    """t de Welch entre el tercil bajo y el alto."""
    if len(grupos) != 3:
        return 0.0
    (n1, m1, s1), _, (n3, m3, s3) = grupos
    if n1 < 2 or n3 < 2:
        return 0.0
    denom = math.sqrt(s1 * s1 / n1 + s3 * s3 / n3)
    return 0.0 if denom <= 0 else (m1 - m3) / denom


def estudiar(symbol: str, filas: list[Fila]) -> None:
    por_intervalo: dict[str, list[Fila]] = defaultdict(list)
    for f in filas:
        if f.interval in MS_POR_INTERVALO:
            por_intervalo[f.interval].append(f)

    intervalos = [iv for iv, fs in sorted(por_intervalo.items()) if len(fs) >= MIN_MUESTRA]
    # Comparaciones declaradas ANTES de ver un solo resultado: por cada temporalidad, dos
    # particiones (distancia y score) por dos direcciones (largos y cortos).
    comparaciones = max(1, len(intervalos) * 2 * 2)
    z_critico = _z_bonferroni(comparaciones)

    print(f"\n{'=' * 78}")
    print(f"ANALISTA DE NIVELES - FASE 0 (medición, sin voto)   ·   {symbol}")
    print(f"{'=' * 78}")
    print(f"Temporalidades con muestra suficiente (>= {MIN_MUESTRA}): {', '.join(intervalos)}")
    print(
        f"Comparaciones declaradas: {comparaciones}  ->  "
        f"|t| crítico Bonferroni = {z_critico:.3f}"
    )
    print(f"Umbral de independencia acordado: +{UMBRAL_LIFT_VOTOS} votos efectivos\n")

    resumen: list[tuple[str, float, float, float, bool]] = []

    for iv in intervalos:
        fs = por_intervalo[iv]
        ms = MS_POR_INTERVALO[iv]
        desde = min(f.captured_ms for f in fs) - (WINDOW + 10) * ms
        hasta = max(f.captured_ms for f in fs) + ms
        velas = _klines(symbol, iv, desde, hasta)

        con_nivel: list[tuple[Fila, float, float]] = []
        for f in fs:
            r = score_en(velas, f.captured_ms)
            if r is not None:
                con_nivel.append((f, r[0], r[1]))

        print(f"--- {iv} " + "-" * (72 - len(iv)))
        print(
            f"  snapshots: {len(fs)}   ·   velas descargadas: {len(velas)}   "
            f"·   con nivel calculable: {len(con_nivel)}"
        )
        if len(con_nivel) < MIN_MUESTRA:
            print("  muestra insuficiente tras alinear con las velas: no se juzga\n")
            continue

        # ---- 1. Votos efectivos: seis frente a siete ----
        cols6 = [[f.votos[i] for f, _, _ in con_nivel] for i in range(len(VOTOS_ACTUALES))]
        cols7 = [*cols6, [s for _, s, _ in con_nivel]]
        ef6 = effective_votes(_corr(cols6))
        ef7 = effective_votes(_corr(cols7))
        lift = ef7 - ef6
        pasa = lift >= UMBRAL_LIFT_VOTOS
        marca = "PASA" if pasa else "no pasa"
        print(
            f"  votos efectivos:  6 votos = {ef6:.3f}   ·   7 votos = {ef7:.3f}   "
            f"·   lift = {lift:+.3f}  [{marca}]"
        )

        # CONTROL DE RUIDO. Un voto aleatorio, que por definición no aporta nada, también sube los
        # votos efectivos: no está correlacionado con nadie. Sin esta referencia, el criterio de
        # independencia premiaría exactamente igual a un eje nuevo y a un generador de números
        # aleatorios. Es la comprobación que decide si el listón acordado mide lo que creíamos.
        rng = np.random.default_rng(20260819)
        lifts_ruido = []
        for _ in range(200):
            ruido = list(rng.standard_normal(len(con_nivel)))
            lifts_ruido.append(effective_votes(_corr([*cols6, ruido])) - ef6)
        ruido_medio = float(np.mean(lifts_ruido))
        ruido_p95 = float(np.percentile(lifts_ruido, 95))
        supera_ruido = lift > ruido_p95
        print(
            f"  control de ruido: un voto aleatorio daría {ruido_medio:+.3f} "
            f"(p95 = {ruido_p95:+.3f})  ->  el detector "
            f"{'SUPERA' if supera_ruido else 'NO supera'} al azar"
        )

        # Correlación del voto nuevo con cada uno de los actuales: dice si es otra copia y de quién.
        serie_niv = np.asarray([s for _, s, _ in con_nivel], dtype=float)
        correlaciones: list[str] = []
        for nombre, col in zip(VOTOS_ACTUALES, cols6, strict=True):
            arr = np.asarray(col, dtype=float)
            if arr.std() <= 0 or serie_niv.std() <= 0:
                correlaciones.append(f"{nombre.replace('_score', '')}=n/d")
            else:
                c = float(np.corrcoef(arr, serie_niv)[0, 1])
                correlaciones.append(f"{nombre.replace('_score', '')}={c:+.2f}")
        print("  correlación del voto nuevo:  " + "  ".join(correlaciones))

        # ---- 2. ¿Predice por sí solo? ----
        t_max = 0.0
        for etiqueta, usa_distancia in (("distancia al nivel", True), ("score de niveles", False)):
            for direccion in ("LONG", "SHORT"):
                pares = [
                    (dist if usa_distancia else sc, float(f.retorno_r))
                    for f, sc, dist in con_nivel
                    if f.direction == direccion and f.retorno_r is not None
                ]
                grupos = _terciles(pares)
                if not grupos:
                    continue
                t_val = _t_extremos(grupos)
                t_max = max(t_max, abs(t_val))
                cuerpo = "  ".join(f"n={n:<3d} {m:+.3f}R" for n, m, _ in grupos)
                sig = "SIGNIFICATIVO" if abs(t_val) >= z_critico else ""
                print(f"  {etiqueta:<20s} {direccion:<5s}  {cuerpo}   |t|={abs(t_val):.2f} {sig}")

        resumen.append((iv, ef6, ef7, t_max, pasa))
        print()

    _veredicto(resumen, z_critico)


def _z_bonferroni(comparaciones: int) -> float:
    """z crítico bilateral para alfa=0,05 corregido por el número de comparaciones."""
    alfa = 0.05 / comparaciones
    # Inversa de la normal por bisección: evita traer scipy solo para esto.
    lo, hi = 0.0, 10.0
    objetivo = 1.0 - alfa / 2.0
    for _ in range(200):
        mid = (lo + hi) / 2.0
        phi = 0.5 * (1.0 + math.erf(mid / math.sqrt(2.0)))
        if phi < objetivo:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def _veredicto(resumen: list[tuple[str, float, float, float, bool]], z_critico: float) -> None:
    print("=" * 78)
    print("VEREDICTO")
    print("=" * 78)
    if not resumen:
        print("Sin temporalidades juzgables. No hay base para dar voto a los niveles.")
        return
    print(f"{'TF':<6} {'6 votos':>9} {'7 votos':>9} {'lift':>8} {'|t| máx':>9}  independencia")
    for iv, ef6, ef7, t_max, pasa in resumen:
        print(
            f"{iv:<6} {ef6:>9.3f} {ef7:>9.3f} {ef7 - ef6:>+8.3f} {t_max:>9.2f}  "
            f"{'PASA' if pasa else 'no pasa'}"
        )
    pasan = [iv for iv, _, _, _, p in resumen if p]
    predice = [iv for iv, _, _, t, _ in resumen if t >= z_critico]
    print()
    print(
        f"Independencia (>= +{UMBRAL_LIFT_VOTOS} votos efectivos): "
        f"{', '.join(pasan) if pasan else 'NINGUNA temporalidad'}"
    )
    print(
        f"Poder predictivo (|t| >= {z_critico:.3f}):              "
        f"{', '.join(predice) if predice else 'NINGUNA temporalidad'}"
    )


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    symbol = sys.argv[2] if len(sys.argv) > 2 else "BTCUSDT"
    estudiar(symbol, cargar(sys.argv[1]))


if __name__ == "__main__":
    main()

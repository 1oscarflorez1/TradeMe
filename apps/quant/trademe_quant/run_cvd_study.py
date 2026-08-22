"""Fase 0 del CVD: medir antes de dar voto (Hito B).

Uso: python -m trademe_quant.run_cvd_study <snapshots.csv> [SIMBOLO ...]

La pregunta
-----------
Los seis votos valen **1,41 efectivos** porque todos derivan del precio, y el meta-modelo no
encuentra señal (AUC 0,4967, dentro de su nula) probablemente por lo mismo: no hay información nueva
que extraer. El flujo de agresores es el candidato a aportarla. Este estudio decide si la aporta de
verdad, **antes** de que toque una sola decisión.

Las tres reglas de oro, fijadas ANTES de calcular nada
-------------------------------------------------------
1. **Control de ruido obligatorio.** El listón de independencia NO es un número fijo. Una columna de
   ruido puro añade entre +0,42 y +0,61 votos efectivos —medido con el Analista de Niveles—, así que
   un «+0,5» habría premiado igual a un eje nuevo y a un generador de aleatorios. Se exige superar
   el **percentil 95 de 200 columnas de ruido**, recalculado con esta misma muestra.

2. **Correlación con los seis votos, POR TEMPORALIDAD.** Con poca historia un indicador puede
   degenerar en oscilador y acabar siendo una copia de otro. Se exige **|r| < 0,50 con los seis**.
   Por temporalidad y no en agregado, porque una correlación baja en el conjunto puede esconder una
   alta en la temporalidad que más opera.

3. **Expectancy por tercil, LONG y SHORT por separado, con Bonferroni.** El efecto del funding en
   M12 solo existía en largos; mezclar direcciones habría diluido la señal con ruido. Las
   comparaciones se declaran **antes** de ver resultados: `temporalidades × 2 métricas × 2
   direcciones`.

**Para pasar hacen falta las tres.** Dos de tres es no pasar: sin independencia el voto es una copia
con otro nombre, sin poder predictivo no aporta, y sin significancia no se distingue del azar.

De dónde salen los datos
-------------------------
Las klines de Binance traen el flujo agregado en el campo 9 (`taker buy base asset volume`), así que
no hacen falta `aggTrades`: ver `flow.py`. El estudio **no toca producción** — lee snapshots ya
registrados y velas públicas, y escribe un informe por pantalla.

Sobre el look-ahead: para cada snapshot solo se usan velas cuyo `open` es anterior a su
`captured_at`, es decir, ya cerradas en el momento de decidir.
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

from .flow import MIN_CANDLES, WINDOW, Flujo, score_flujo
from .independence import effective_votes
from .run_levels_study import MS_POR_INTERVALO

REST = "https://api.binance.com/api/v3/klines"
TIMEOUT_S = 20
#: Tope de páginas por temporalidad, para que el estudio no se eternice en 1m.
MAX_PAGINAS = 60

#: Muestra mínima por temporalidad para juzgarla.
MIN_MUESTRA = 40
#: Correlación máxima admisible con cualquiera de los seis votos. Por encima, es una copia.
MAX_CORRELACION = 0.50
#: Repeticiones del control de ruido.
RUIDO_REPETICIONES = 200
#: Métricas candidatas, declaradas en `flow.py` antes de medir.
METRICAS = ("cvd_z", "divergencia")

VOTOS_ACTUALES = (
    "ema_cross_score",
    "macd_score",
    "supertrend_score",
    "rsi14_score",
    "bbands_score",
    "stoch14_score",
)


class Caso(NamedTuple):
    """Una combinación clave × métrica ya juzgada, con las tres reglas resueltas."""

    symbol: str
    interval: str
    metrica: str
    lift: float
    ruido_p95: float
    corr_max: float
    t_max: float
    indep: bool
    corr: bool
    pred: bool

    @property
    def pasa_las_tres(self) -> bool:
        return self.indep and self.corr and self.pred


class Fila(NamedTuple):
    symbol: str
    interval: str
    captured_ms: int
    direction: str
    votos: list[float]
    retorno_r: float | None


def cargar(csv_path: str) -> list[Fila]:
    """Snapshots exportados de la base de datos. Se descartan los que no traen los seis votos."""
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
                    symbol=row["symbol"],
                    interval=row["interval"],
                    captured_ms=int(ts.timestamp() * 1000),
                    direction=(row.get("direction") or "").strip(),
                    votos=valores,
                    retorno_r=float(r_bruto) if r_bruto else None,
                )
            )
    return filas


class VelaFlujo(NamedTuple):
    """Lo que hace falta de cada kline: el campo 9 es el volumen del agresor comprador."""

    abre_ms: int
    volumen: float
    taker_buy: float
    close: float


def _klines_flujo(symbol: str, interval: str, start_ms: int, end_ms: int) -> list[VelaFlujo]:
    """Histórico paginado con los campos del flujo. Datos públicos de Binance, sin clave.

    No se reutiliza el descargador de `run_levels_study` porque aquel se queda con high/low/close y
    aquí hacen falta volumen y `taker buy base` — los campos 5 y 9.
    """
    out: list[VelaFlujo] = []
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
            out.append(VelaFlujo(int(k[0]), float(k[5]), float(k[9]), float(k[4])))
        ultimo = int(datos[-1][0])
        if ultimo <= cursor:
            break
        cursor = ultimo + 1
    return out


def flujo_en(velas: list[VelaFlujo], hasta_ms: int) -> Flujo | None:
    """Métricas de flujo con lo que se sabía en `hasta_ms`. Solo velas ya abiertas antes."""
    fin = 0
    for i, v in enumerate(velas):
        if v.abre_ms < hasta_ms:
            fin = i + 1
        else:
            break
    if fin < MIN_CANDLES:
        return None
    trozo = velas[max(0, fin - WINDOW) : fin]
    return score_flujo(
        [v.volumen for v in trozo], [v.taker_buy for v in trozo], [v.close for v in trozo]
    )


def _calibracion(cols6: list[list[float]], n: int) -> int:
    """¿Cuántos de los seis votos EN PRODUCCIÓN superarían el listón de ruido?

    Es la comprobación que valida el instrumento antes de usarlo para condenar a nadie, y hace falta
    por una razón matemática: el ruido gaussiano está descorrelacionado con todo **por
    construcción**, así que es el máximo teórico de «añadir votos efectivos». Cualquier variable
    informativa correlaciona algo con las demás —si no, no estaría describiendo el mismo mercado— y
    por tanto añade menos que el ruido.

    Si sale 0, el listón exige *ser más independiente que el azar puro*, que no es una propiedad de
    la información útil: los votos efectivos miden **diversificación**, no aportación. El veredicto
    de la regla 1 no valdría entonces ni para aprobar ni para suspender.
    """
    rng = np.random.default_rng(20260822)
    pasan = 0
    for quitar in range(len(cols6)):
        resto = [c for i, c in enumerate(cols6) if i != quitar]
        base = effective_votes(_corr(resto))
        lift_real = effective_votes(_corr([*resto, cols6[quitar]])) - base
        ruidos = [
            effective_votes(_corr([*resto, list(rng.standard_normal(n))])) - base
            for _ in range(RUIDO_REPETICIONES // 4)
        ]
        if lift_real > float(np.percentile(ruidos, 95)):
            pasan += 1
    return pasan


def _corr(columnas: list[list[float]]) -> np.ndarray:
    datos = np.asarray(columnas, dtype=float)
    desv = datos.std(axis=1)
    if float(desv.max(initial=0.0)) <= 0.0:
        return np.ones((len(columnas), len(columnas)), dtype=float)
    constantes = desv <= 0.0
    if constantes.any():
        datos = datos.copy()
        datos[constantes, :] = np.linspace(0.0, 1.0, datos.shape[1])
    limpia: np.ndarray = np.nan_to_num(np.asarray(np.corrcoef(datos), dtype=float), nan=1.0)
    return limpia


def _terciles(pares: list[tuple[float, float]]) -> list[tuple[int, float, float]]:
    if len(pares) < 9:
        return []
    ordenados = sorted(pares, key=lambda p: p[0])
    corte = len(ordenados) // 3
    out: list[tuple[int, float, float]] = []
    for g in (ordenados[:corte], ordenados[corte : 2 * corte], ordenados[2 * corte :]):
        rs = [r for _, r in g]
        n = len(rs)
        media = sum(rs) / n if n else 0.0
        var = sum((x - media) ** 2 for x in rs) / (n - 1) if n > 1 else 0.0
        out.append((n, media, math.sqrt(var)))
    return out


def _t_extremos(grupos: list[tuple[int, float, float]]) -> float:
    if len(grupos) != 3:
        return 0.0
    (n1, m1, s1), _, (n3, m3, s3) = grupos
    if n1 < 2 or n3 < 2:
        return 0.0
    denom = math.sqrt(s1 * s1 / n1 + s3 * s3 / n3)
    return 0.0 if denom <= 0 else (m1 - m3) / denom


def _z_bonferroni(comparaciones: int) -> float:
    """z crítico bilateral para alfa=0,05 corregido por el número de comparaciones."""
    alfa = 0.05 / max(1, comparaciones)
    lo, hi = 0.0, 10.0
    objetivo = 1.0 - alfa / 2.0
    for _ in range(200):
        mid = (lo + hi) / 2.0
        if 0.5 * (1.0 + math.erf(mid / math.sqrt(2.0))) < objetivo:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2.0


def estudiar(symbol: str, filas: list[Fila], z_critico: float) -> list[Caso]:
    por_intervalo: dict[str, list[Fila]] = defaultdict(list)
    for f in filas:
        if f.interval in MS_POR_INTERVALO:
            por_intervalo[f.interval].append(f)
    intervalos = [iv for iv, fs in sorted(por_intervalo.items()) if len(fs) >= MIN_MUESTRA]

    print(f"\n{'=' * 86}")
    print(f"CVD · FASE 0 (medición, sin voto)   ·   {symbol}")
    print(f"{'=' * 86}")
    if not intervalos:
        print(f"  sin temporalidades con muestra suficiente (>= {MIN_MUESTRA})\n")
        return []

    resumen: list[Caso] = []
    for iv in intervalos:
        fs = por_intervalo[iv]
        ms = MS_POR_INTERVALO[iv]
        desde = min(f.captured_ms for f in fs) - (WINDOW + 10) * ms
        hasta = max(f.captured_ms for f in fs) + ms
        velas = _klines_flujo(symbol, iv, desde, hasta)

        con_flujo: list[tuple[Fila, Flujo]] = []
        for f in fs:
            r = flujo_en(velas, f.captured_ms)
            if r is not None:
                con_flujo.append((f, r))

        print(f"--- {iv} " + "-" * (80 - len(iv)))
        print(
            f"  snapshots: {len(fs)}   ·   velas: {len(velas)}   ·   "
            f"con flujo calculable: {len(con_flujo)}"
        )
        if len(con_flujo) < MIN_MUESTRA:
            print("  muestra insuficiente tras alinear con las velas: no se juzga\n")
            continue

        cols6 = [[f.votos[i] for f, _ in con_flujo] for i in range(len(VOTOS_ACTUALES))]
        ef6 = effective_votes(_corr(cols6))

        # --- Regla 1: control de ruido -------------------------------------------------------
        rng = np.random.default_rng(20260822)
        lifts_ruido = [
            effective_votes(_corr([*cols6, list(rng.standard_normal(len(con_flujo)))])) - ef6
            for _ in range(RUIDO_REPETICIONES)
        ]
        ruido_p95 = float(np.percentile(lifts_ruido, 95))
        print(f"  votos efectivos base (6): {ef6:.3f}   ·   listón de ruido p95: +{ruido_p95:.3f}")
        pasan_votos = _calibracion(cols6, len(con_flujo))
        print(f"  calibración del listón: lo superan {pasan_votos}/6 de los votos YA en producción")
        if pasan_votos == 0:
            print(
                "    -> el listón no distingue información de ruido: ninguna variable real puede "
                "cruzarlo"
            )

        for metrica in METRICAS:
            serie = [float(getattr(r, metrica)) for _, r in con_flujo]
            ef7 = effective_votes(_corr([*cols6, serie]))
            lift = ef7 - ef6
            pasa_indep = lift > ruido_p95

            # --- Regla 2: correlación con cada voto --------------------------------------
            arr = np.asarray(serie, dtype=float)
            corrs: list[tuple[str, float]] = []
            for nombre, col in zip(VOTOS_ACTUALES, cols6, strict=True):
                c = np.asarray(col, dtype=float)
                if c.std() <= 0 or arr.std() <= 0:
                    corrs.append((nombre, float("nan")))
                else:
                    corrs.append((nombre, float(np.corrcoef(c, arr)[0, 1])))
            peor = max((abs(c) for _, c in corrs if not math.isnan(c)), default=0.0)
            pasa_corr = peor < MAX_CORRELACION

            print(f"  [{metrica}]")
            print(
                f"    independencia : 7 votos = {ef7:.3f}  lift = {lift:+.3f}  "
                f"-> {'PASA' if pasa_indep else 'no pasa'}"
            )
            print(
                "    correlación   : "
                + "  ".join(f"{n.replace('_score', '')}={c:+.2f}" for n, c in corrs)
            )
            print(
                f"                    |r| máx = {peor:.2f} (límite {MAX_CORRELACION})  "
                f"-> {'PASA' if pasa_corr else 'NO PASA: es una copia'}"
            )

            # --- Regla 3: expectancy por tercil ------------------------------------------
            t_max, pasa_pred = 0.0, False
            for direccion in ("LONG", "SHORT"):
                pares = [
                    (float(getattr(r, metrica)), float(f.retorno_r))
                    for f, r in con_flujo
                    if f.direction == direccion and f.retorno_r is not None
                ]
                grupos = _terciles(pares)
                if not grupos:
                    print(f"    terciles {direccion:<5s}: sin desenlaces suficientes")
                    continue
                t_val = abs(_t_extremos(grupos))
                t_max = max(t_max, t_val)
                pasa_pred = pasa_pred or t_val >= z_critico
                cuerpo = "  ".join(f"n={n:<3d} {m:+.3f}R" for n, m, _ in grupos)
                marca = "SIGNIFICATIVO" if t_val >= z_critico else ""
                print(f"    terciles {direccion:<5s}: {cuerpo}   |t|={t_val:.2f} {marca}")

            resumen.append(
                Caso(
                    symbol=symbol,
                    interval=iv,
                    metrica=metrica,
                    lift=lift,
                    ruido_p95=ruido_p95,
                    corr_max=peor,
                    t_max=t_max,
                    indep=pasa_indep,
                    corr=pasa_corr,
                    pred=pasa_pred,
                )
            )
        print()
    return resumen


def veredicto(resumen: list[Caso], z_critico: float) -> None:
    print("=" * 86)
    print("VEREDICTO — hacen falta LAS TRES reglas, no dos de tres")
    print("=" * 86)
    if not resumen:
        print("  Sin casos juzgables. No hay base para dar voto al CVD.\n")
        return
    print(
        f"  {'clave':22s} {'métrica':13s} {'lift':>7s} {'ruido':>7s} "
        f"{'|r|máx':>7s} {'|t|máx':>7s}   indep corr pred"
    )
    print("  " + "-" * 82)
    aprobados = sum(1 for r in resumen if r.pasa_las_tres)
    for r in resumen:
        clave = f"{r.symbol}:{r.interval}"
        print(
            f"  {clave:22s} {r.metrica:13s} {r.lift:+7.3f} {r.ruido_p95:+7.3f} "
            f"{r.corr_max:7.2f} {r.t_max:7.2f}   "
            f"{'SI ' if r.indep else 'no '}   {'SI ' if r.corr else 'no '}  "
            f"{'SI ' if r.pred else 'no '}" + ("   <- PASA LAS TRES" if r.pasa_las_tres else "")
        )
    print("  " + "-" * 82)
    print(f"  |t| crítico Bonferroni: {z_critico:.3f}   ·   casos que pasan las tres: {aprobados}")
    print()
    if aprobados == 0:
        print("  El CVD no se gana el voto. Igual que el Analista de Niveles: el módulo se queda")
        print("  como biblioteca medida y NO se conecta a ninguna decisión.")
    else:
        print("  Hay casos que pasan las tres reglas. Antes de la Fase 1, revisar si se concentran")
        print("  en una temporalidad o activo: un aprobado suelto entre muchos es lo que la")
        print("  corrección de Bonferroni ya intenta descontar, no una invitación a construir.")
    print()


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    filas = cargar(sys.argv[1])
    simbolos = sys.argv[2:] or sorted({f.symbol for f in filas})

    # Comparaciones declaradas ANTES de ver un solo resultado.
    por_simbolo = {s: [f for f in filas if f.symbol == s] for s in simbolos}
    intervalos_juzgables = 0
    for fs in por_simbolo.values():
        cuenta: dict[str, int] = defaultdict(int)
        for f in fs:
            if f.interval in MS_POR_INTERVALO:
                cuenta[f.interval] += 1
        intervalos_juzgables += sum(1 for n in cuenta.values() if n >= MIN_MUESTRA)
    comparaciones = max(1, intervalos_juzgables * len(METRICAS) * 2)
    z_critico = _z_bonferroni(comparaciones)

    print(f"\nsnapshots cargados: {len(filas)}   ·   activos: {', '.join(simbolos)}")
    print(f"comparaciones declaradas: {comparaciones}  ->  |t| crítico = {z_critico:.3f}")

    todo: list[Caso] = []
    for s in simbolos:
        todo.extend(estudiar(s, por_simbolo[s], z_critico))
    veredicto(todo, z_critico)


if __name__ == "__main__":
    main()

"""¿Elige TradeMe la dirección mejor que una moneda? Informe sobre las decisiones reales.

Uso: python -m trademe_quant.run_direccion_study [DSN]

La pregunta y el método están en `direccion.py`. Aquí solo se reúnen los datos: los planes que cada
decisión registró en su momento, las velas posteriores que ya están en la base, y el evaluador real
del proyecto —`backtest.evaluate_trade`— aplicado a los dos lados de cada apuesta.

Sobre el look-ahead: no lo hay. Los planes son los que se guardaron al decidir, las velas son
estrictamente posteriores a `captured_at`, y el horizonte es el mismo `horizon_by_tf` que usó el
evaluador para el desenlace real. El espejo no es una decisión tomada con información futura: es el
mismo plan con el signo cambiado.

Una comprobación de coherencia antes de nada: se reevalúa también el plan **real** y se compara con
el `outcome_return_r` guardado. Si no coinciden, el contrafactual tampoco valdría.

Y no coinciden en todas, por un motivo que conviene tener presente más allá de este estudio: **el
histórico contiene desenlaces evaluados con dos reglas distintas**. El horizonte por temporalidad
(`horizon_by_tf`) se introdujo en M10.5; antes eran 20 velas fijas para todo. Medido el 23 de agosto
de 2026, 248 de 1.218 decisiones no se reproducen, **todas anteriores al 6 de agosto**, y las velas
disponibles en ellas son exactamente 15, 18, 25 y 30 — los valores nuevos del mapa.

Aquella medición decía que desde esa fecha la coincidencia era perfecta (0 de 673), y **decía menos
de lo que parecía**: las velas se pedían con `LIMIT h` sin acotar en tiempo, igual que la evaluación
original, así que verificador y verificado compartían el mismo defecto y coincidían por repetir el
error. Con la ventana acotada (0.55.0) la cifra cambia: de las 839 cerradas desde el 6 de agosto,
ninguna cambia de desenlace pero 343 no tenían ventana completa. Una comprobación solo vale si puede
fallar por el motivo que se busca.

Así que el estudio **se queda solo con lo reproducible** y dice cuánto descarta. Descartar por no
poder reproducir no sesga el veredicto: el horizonte de una decisión depende de su temporalidad y de
cuándo se evaluó, no de cómo acabó.

Esto afecta a cualquier análisis que use `outcome_return_r` del histórico antiguo, el entrenamiento
del meta-modelo incluido. Queda anotado aquí porque es donde se encontró.
"""

from __future__ import annotations

import os
import sys
from collections import defaultdict
from typing import Any

import numpy as np

from .backtest import evaluate_trade
from .direccion import juzgar, plan_espejo
from .ensemble import artifacts_dir, load_ensemble
from .nula import PERMUTACIONES_ESTUDIO, marcas_de

#: Horizonte por temporalidad si el `ensemble.yaml` no lo trae.
HORIZONTE_POR_DEFECTO = 20
#: Decisiones mínimas para juzgar un corte.
MIN_MUESTRA = 60
#: Desajuste tolerado al reevaluar el plan real contra lo guardado.
TOLERANCIA = 1e-6


def horizontes(artifacts: Any = None) -> dict[str, int]:
    """`evaluation.horizon_by_tf` del ensemble: el mismo horizonte que usó el desenlace real."""
    try:
        cfg = load_ensemble((artifacts or artifacts_dir()) / "ensemble.yaml")
        mapa = (cfg.get("evaluation") or {}).get("horizon_by_tf") or {}
        return {str(k): int(v) for k, v in mapa.items()}
    except Exception:  # noqa: BLE001 - sin configuración se usa el de reserva
        return {}


def _ms(interval: str) -> int:
    """Duración de la vela: sin ella no se puede acotar la ventana ni juzgar nada."""
    from .market.normalize import INTERVAL_MS

    return INTERVAL_MS.get(interval, 900_000)


def recoger(dsn: str, h_por_tf: dict[str, int]) -> list[dict[str, Any]]:
    """Cada decisión cerrada, con su desenlace real, el reevaluado y el del plan espejo."""
    import psycopg

    filas: list[dict[str, Any]] = []
    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, symbol, interval, captured_at, direction,
                       plan_entry, plan_stop, plan_take_profit, outcome_return_r
                  FROM snapshots
                 WHERE outcome_return_r IS NOT NULL AND plan_entry IS NOT NULL
                   AND direction IN ('LONG','SHORT')
                 ORDER BY captured_at
                """)
            pendientes = cur.fetchall()

        for sid, symbol, interval, capturada, direction, entry, stop, tp, r_real in pendientes:
            h = h_por_tf.get(str(interval), HORIZONTE_POR_DEFECTO)
            # Acotada en TIEMPO, igual que la evaluación real desde 0.55.0. Pedirlas con `LIMIT h`
            # a secas era lo que hacía que este estudio se declarase «coherente»: verificador y
            # verificado compartían el mismo defecto, así que coincidían por repetir el error.
            with conn.cursor() as cur:
                cur.execute(
                    """SELECT high, low, close FROM candles
                       WHERE symbol=%s AND interval=%s AND ts > %s
                         AND ts <= %s + (%s * interval '1 millisecond')
                       ORDER BY ts LIMIT %s""",
                    (symbol, interval, capturada, capturada, _ms(str(interval)) * h, h),
                )
                futuro = cur.fetchall()
            if not futuro:
                continue
            highs = [float(f[0]) for f in futuro]
            lows = [float(f[1]) for f in futuro]
            closes = [float(f[2]) for f in futuro]

            reeval = evaluate_trade(
                direction, float(entry), float(stop), float(tp), highs, lows, closes
            )
            esp = plan_espejo(direction, float(entry), float(stop), float(tp))
            contra = evaluate_trade(
                esp.direction, esp.entry, esp.stop, esp.take_profit, highs, lows, closes
            )
            filas.append(
                {
                    "id": sid,
                    "symbol": symbol,
                    "interval": interval,
                    "captured_at": capturada,
                    "direction": direction,
                    "r_real": float(r_real),
                    "r_reeval": float(reeval["r"]),
                    "r_espejo": float(contra["r"]),
                    "velas": len(futuro),
                }
            )
    return filas


def coherencia(filas: list[dict[str, Any]]) -> tuple[int, int, float]:
    """¿Reproduce la reevaluación el desenlace guardado? Sin esto el contrafactual no valdría."""
    difs = [abs(f["r_reeval"] - f["r_real"]) for f in filas]
    iguales = sum(1 for d in difs if d <= TOLERANCIA)
    return iguales, len(filas), (max(difs) if difs else 0.0)


def _linea(etiqueta: str, v: Any) -> None:
    marca = "SUPERA A LA MONEDA" if v.supera else "no supera"
    print(
        f"  {etiqueta:16s} n={v.n:5d}  obs={v.observada:+.3f}R  "
        f"largo={v.siempre_largo:+.3f}  corto={v.siempre_corto:+.3f}  "
        f"moneda p50={v.nula_p50:+.3f} p95={v.nula_p95:+.3f}  ->  {marca}"
    )


def informe(filas: list[dict[str, Any]]) -> None:
    ancho = 104
    print("=" * ancho)
    print("¿ELIGE TRADEME LA DIRECCIÓN MEJOR QUE UNA MONEDA?")
    print("=" * ancho)

    iguales, total, peor = coherencia(filas)
    print(f"  coherencia: {iguales}/{total} desenlaces reevaluados coinciden con lo guardado")
    print(f"              (peor desajuste entre los que no: {peor:.2f} R)")
    reproducibles = [f for f in filas if abs(f["r_reeval"] - f["r_real"]) <= TOLERANCIA]
    if len(reproducibles) < total:
        desde = min(f["captured_at"] for f in reproducibles).date()
        print(
            f"  se descartan {total - len(reproducibles)} evaluadas con la regla anterior a "
            f"`horizon_by_tf` (ver cabecera). Quedan {len(reproducibles)} desde {desde}."
        )
    if len(reproducibles) < MIN_MUESTRA:
        print()
        print("  ⚠ Sin muestra reproducible suficiente: no se juzga nada.")
        return
    filas = reproducibles

    r_real = [f["r_real"] for f in filas]
    r_esp = [f["r_espejo"] for f in filas]
    dirs = [f["direction"] for f in filas]
    marcas = marcas_de([f["captured_at"] for f in filas])
    print(f"  bloques de 24 h: {len(set(marcas))}   ·   permutaciones: {PERMUTACIONES_ESTUDIO:,}")
    print()
    print("  obs = lo que hizo la plataforma · largo/corto = apostar siempre a un lado (la deriva)")
    print("  moneda = elegir la dirección a cara y cruz, una tirada por bloque de 24 h")
    print("-" * ancho)

    _linea("TODAS", juzgar(r_real, r_esp, dirs, marcas))

    print()
    print("  por dirección elegida:")
    for d in ("LONG", "SHORT"):
        idx = [i for i, x in enumerate(dirs) if x == d]
        if len(idx) >= MIN_MUESTRA:
            _linea(
                d,
                juzgar(
                    [r_real[i] for i in idx],
                    [r_esp[i] for i in idx],
                    [dirs[i] for i in idx],
                    [marcas[i] for i in idx],
                ),
            )

    print()
    print("  por temporalidad:")
    por_iv: dict[str, list[int]] = defaultdict(list)
    for i, f in enumerate(filas):
        por_iv[str(f["interval"])].append(i)
    for iv, idx in sorted(por_iv.items()):
        if len(idx) >= MIN_MUESTRA:
            _linea(
                iv,
                juzgar(
                    [r_real[i] for i in idx],
                    [r_esp[i] for i in idx],
                    [dirs[i] for i in idx],
                    [marcas[i] for i in idx],
                ),
            )
    print("-" * ancho)
    _veredicto(juzgar(r_real, r_esp, dirs, marcas), r_real, r_esp, dirs)


def _veredicto(v: Any, r_real: list[float], r_esp: list[float], dirs: list[str]) -> None:
    largos = [r for r, d in zip(r_real, dirs, strict=True) if d == "LONG"]
    cortos = [r for r, d in zip(r_real, dirs, strict=True) if d == "SHORT"]
    print()
    print("VEREDICTO")
    print("-" * 104)
    if v.supera:
        print(f"  Lo que eligió la plataforma ({v.observada:+.3f} R) supera al percentil 95 de la")
        print("  moneda: hay habilidad direccional que la deriva del periodo no explica.")
    else:
        print(f"  Lo que eligió la plataforma ({v.observada:+.3f} R) NO supera al percentil 95 de")
        print(f"  la moneda ({v.nula_p95:+.3f} R). Con esta muestra no se distingue de elegir la")
        print("  dirección a cara y cruz.")
    print()
    print(
        f"  Deriva del periodo: apostar SIEMPRE largo daba {v.siempre_largo:+.3f} R y siempre "
        f"corto {v.siempre_corto:+.3f} R."
    )
    if largos and cortos:
        print(
            f"  La plataforma sacó {float(np.mean(largos)):+.3f} R en sus {len(largos)} largos y "
            f"{float(np.mean(cortos)):+.3f} R en sus {len(cortos)} cortos."
        )
        margen_l = float(np.mean(largos)) - v.siempre_largo
        margen_c = float(np.mean(cortos)) - v.siempre_corto
        print()
        print("  Lo que aporta ELEGIR, descontada la deriva de cada lado:")
        print(f"    en largos: {margen_l:+.3f} R sobre el {v.siempre_largo:+.3f} que daba el lado")
        print(f"    en cortos: {margen_c:+.3f} R sobre el {v.siempre_corto:+.3f} que daba el lado")
    print()


def main() -> None:
    dsn = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.environ.get("DATABASE_URL", "postgresql://trademe:trademe@localhost:5432/trademe")
    )
    h = horizontes()
    print(f"horizontes por temporalidad: {h or '(no configurados, se usa el de reserva)'}")
    filas = recoger(dsn, h)
    print(f"decisiones cerradas con plan y velas posteriores: {len(filas)}\n")
    if len(filas) < MIN_MUESTRA:
        print("muestra insuficiente para juzgar")
        raise SystemExit(1)
    informe(filas)


if __name__ == "__main__":
    main()

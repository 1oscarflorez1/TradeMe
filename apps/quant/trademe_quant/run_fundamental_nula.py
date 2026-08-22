"""¿El umbral que gobierna el Fundamental Score distingue mérito de suerte?

Uso: python -m trademe_quant.run_fundamental_nula <sombra.csv>

De dónde viene esta pregunta
----------------------------
Al diagnosticar el meta-modelo (22 ago 2026) apareció que **un modelo entrenado con etiquetas
barajadas produce un lift medio de +0,083 R**, por encima del umbral de 0,05 R que se exige para
promocionarlo. El listón no distinguía mérito de suerte.

Ese mismo umbral gobierna el Fundamental Score. Pero no se le puede aplicar la conclusión sin más:
el score **no es un modelo entrenado**, su penalización sale de una fórmula fija, así que su
distribución nula es otra y probablemente más estrecha. Copiar el veredicto sería tan arbitrario
como ignorarlo.

La hipótesis nula correcta
---------------------------
No es «barajar los resultados» —eso cambiaría el baseline y compararía peras con manzanas—, sino:

    ¿descartar ESTAS d compras es mejor que descartar d compras cualesquiera?

El score convierte en HOLD las decisiones donde discrepa: esas operaciones no se abren y aportan 0.
La nula elige al azar **la misma cantidad** y mide el lift que sale.

Dos nulas, porque las observaciones están correlacionadas
----------------------------------------------------------
Los cuatro activos cripto valen 1,52 efectivos (ver correlaciones.md), así que una permutación
simple subestima la varianza: sería repetir el error de tratar `n` como evidencia.

- **Simple**: elegir d filas al azar entre las n.
- **Por bloques**: agrupar en ventanas de 24 h y permutar entre ventanas *cuántas* se descartan en
  cada una. Preserva que los descartes se concentren —que es lo que ocurre de verdad— y rompe solo
  la asociación entre ventana y resultados.

El veredicto usa **la más conservadora** de las dos, es decir la de intervalo más ancho.

Listón fijado antes de calcular nada: fuera del percentil 5-95 (bilateral, alfa 0,05).
"""

from __future__ import annotations

import csv
import sys
from datetime import datetime
from typing import Any

import numpy as np

#: Barajadas por cada nula.
PERMUTACIONES = 10_000
#: Ventana de agrupación, la misma que usa el descuento por correlación.
VENTANA_H = 24
PCT_BAJO, PCT_ALTO = 5.0, 95.0
#: Umbral vigente para promocionar el score. Es lo que se pone a prueba.
UMBRAL_LIFT_VIGENTE = 0.05


def cargar(csv_path: str) -> list[dict[str, Any]]:
    filas: list[dict[str, Any]] = []
    with open(csv_path, encoding="utf8", newline="") as fh:
        for row in csv.DictReader(fh):
            r = (row.get("outcome_return_r") or "").strip()
            if not r:
                continue
            filas.append(
                {
                    "symbol": row["symbol"],
                    "action": row["action"],
                    "fund_shadow_action": row["fund_shadow_action"],
                    "fund_penalty": float(row["fund_penalty"] or 0.0),
                    "outcome_return_r": float(r),
                    "captured_at": datetime.fromisoformat(row["captured_at"]),
                }
            )
    return filas


def _lift(rs: np.ndarray, descartadas: np.ndarray) -> float:
    """Lift de descartar ese conjunto: las descartadas no se abren y aportan 0."""
    n = rs.size
    if n == 0:
        return 0.0
    base = float(rs.mean())
    con = float(np.where(descartadas, 0.0, rs).mean())
    return con - base


def _auc(rs: np.ndarray, puntajes: np.ndarray) -> float:
    """AUC de `1 - penalización` frente a ganar. Convención: > 0,5 = acierta."""
    pos = puntajes[rs > 0]
    neg = puntajes[rs <= 0]
    if pos.size == 0 or neg.size == 0:
        return 0.5
    mejores = float((pos[:, None] > neg[None, :]).sum())
    empates = float((pos[:, None] == neg[None, :]).sum())
    return (mejores + 0.5 * empates) / (pos.size * neg.size)


def _bloques(filas: list[dict[str, Any]]) -> list[list[int]]:
    """Índices agrupados por ventana de `VENTANA_H` horas."""
    grupos: dict[int, list[int]] = {}
    for i, f in enumerate(filas):
        ts = f["captured_at"]
        marca = int(ts.timestamp() // (VENTANA_H * 3600))
        grupos.setdefault(marca, []).append(i)
    return [v for _, v in sorted(grupos.items())]


def estudiar(filas: list[dict[str, Any]]) -> None:
    n = len(filas)
    rs = np.asarray([f["outcome_return_r"] for f in filas], dtype=float)
    descartadas = np.asarray(
        [str(f["fund_shadow_action"]) != str(f["action"]) for f in filas], dtype=bool
    )
    puntajes = np.asarray([1.0 - float(f["fund_penalty"]) for f in filas], dtype=float)
    d = int(descartadas.sum())

    lift_obs = _lift(rs, descartadas)
    auc_obs = _auc(rs, puntajes)
    bloques = _bloques(filas)

    print("=" * 78)
    print("FUNDAMENTAL SCORE · ¿el umbral distingue mérito de suerte?")
    print("=" * 78)
    print(f"  decisiones LONG cerradas : {n}")
    print(f"  descartadas por el score : {d}  ({100.0 * d / n:.0f} %)")
    print(f"  ventanas de {VENTANA_H} h        : {len(bloques)}")
    print(f"  listón: fuera del percentil {PCT_BAJO:.0f}-{PCT_ALTO:.0f}\n")
    print("--- observado ---------------------------------------------------------------")
    print(f"  expectancy base : {rs.mean():+.3f} R")
    print(f"  lift            : {lift_obs:+.3f} R")
    print(f"  AUC             : {auc_obs:.3f}\n")

    rng = np.random.default_rng(20260822)

    # ---- Nula simple: d filas al azar ------------------------------------------------------
    lifts_s = np.empty(PERMUTACIONES, dtype=float)
    aucs_s = np.empty(PERMUTACIONES, dtype=float)
    idx = np.arange(n)
    for i in range(PERMUTACIONES):
        elegidas = np.zeros(n, dtype=bool)
        elegidas[rng.choice(idx, size=d, replace=False)] = True
        lifts_s[i] = _lift(rs, elegidas)
        aucs_s[i] = _auc(rs, rng.permutation(puntajes))

    # ---- Nula por bloques: se permuta CUÁNTAS se descartan en cada ventana ------------------
    conteos = np.asarray([int(descartadas[b].sum()) for b in bloques])
    lifts_b = np.empty(PERMUTACIONES, dtype=float)
    for i in range(PERMUTACIONES):
        elegidas = np.zeros(n, dtype=bool)
        for bloque, cuantas in zip(bloques, rng.permutation(conteos), strict=True):
            k = min(int(cuantas), len(bloque))
            if k > 0:
                elegidas[rng.choice(np.asarray(bloque), size=k, replace=False)] = True
        lifts_b[i] = _lift(rs, elegidas)

    def _informe(nombre: str, obs: float, dist: np.ndarray) -> tuple[float, float, bool]:
        lo, hi = (float(x) for x in np.percentile(dist, [PCT_BAJO, PCT_ALTO]))
        fuera = obs < lo or obs > hi
        print(
            f"  {nombre:22s} media {dist.mean():+.3f}  intervalo [{lo:+.3f}, {hi:+.3f}]  ->  "
            f"{'FUERA' if fuera else 'dentro: no se distingue del azar'}"
        )
        return lo, hi, fuera

    print("--- distribución nula del LIFT ---------------------------------------------")
    _, hi_s, fuera_s = _informe("simple", lift_obs, lifts_s)
    _, hi_b, fuera_b = _informe("por bloques", lift_obs, lifts_b)
    print()
    print("--- distribución nula del AUC ----------------------------------------------")
    _informe("penalización barajada", auc_obs, aucs_s)

    # El veredicto se queda con la nula más conservadora: la de intervalo más ancho.
    hi = max(hi_s, hi_b)
    conservadora = "por bloques" if hi_b >= hi_s else "simple"
    print()
    print("=" * 78)
    print("VEREDICTO")
    print("=" * 78)
    print(f"  El azar alcanza un lift de {hi:+.3f} R en el percentil 95 (nula {conservadora}).")
    if hi > UMBRAL_LIFT_VIGENTE:
        veces = hi / UMBRAL_LIFT_VIGENTE
        aviso = f"  El umbral vigente es {UMBRAL_LIFT_VIGENTE:+.3f} R:"
        print(f"{aviso} el azar lo supera, y por {veces:.1f}x.")
        print(f"  Para exigir mérito y no suerte haría falta un listón >= {hi:+.3f} R.")
    else:
        print(
            f"  El umbral vigente ({UMBRAL_LIFT_VIGENTE:+.3f} R) queda POR ENCIMA de lo que da el"
        )
        print("  azar: distingue mérito de suerte con esta muestra.")
    print()
    print(
        f"  Lo observado ({lift_obs:+.3f} R) "
        f"{'SÍ se distingue' if (fuera_s and fuera_b) else 'NO se distingue'} del azar."
    )
    print("=" * 78)


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    filas = cargar(sys.argv[1])
    if len(filas) < 30:
        print(f"muestra insuficiente: {len(filas)} filas")
        raise SystemExit(1)
    estudiar(filas)


if __name__ == "__main__":
    main()

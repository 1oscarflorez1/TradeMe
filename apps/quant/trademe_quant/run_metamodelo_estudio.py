"""¿Aporta algo el meta-modelo? Walk-forward semanal, con nula y separando por dirección.

Uso: python -m trademe_quant.run_metamodelo_estudio

Por qué hace falta
-------------------
Reentrenado el 14-sep-2026 el meta-modelo dio AUC 0,30: ordena ganadores y perdedores **al revés**.
El diagnóstico apuntó a la deriva direccional —en el tramo de prueba ganaron los cortos y la feature
«es largo» sola daba 0,24—, pero un solo corte temporal no basta para decidir nada. Este estudio
repite la pregunta en cada semana, con un modelo entrenado solo con lo anterior, que es como lo
usaría el piloto.

La regla de decisión se fijó ANTES de mirar resultados
-------------------------------------------------------
El meta-modelo se queda solo si se cumplen las tres:

1. **AUC agregada ≥ 0,55** en walk-forward, el mismo listón que exige su gobierno para ascender.
2. **Mejora de expectancy por encima del P95 de la nula**: filtrar con él tiene que ganar al azar
   filtrando las mismas operaciones, por bloques diarios (`nula.p95_seleccion`).
3. **AUC ≥ 0,55 dentro de cada dirección** —solo largos y solo cortos— con muestra suficiente. Si la
   señal solo existe mezclando direcciones, lo que ordena es la deriva del mercado, no las
   operaciones: es exactamente lo que ya se midió en `docs/habilidad-direccional.md`.

Si no se cumplen, sale del ciclo del piloto. Elegir el listón después de ver el número sería el
mismo sesgo que el proyecto lleva meses quitando de otros sitios.

Qué datos usa
--------------
Desenlaces reales **y de sombra**: el meta-modelo filtra decisiones, y las decisiones vetadas
también se tomaron, con las mismas features. Una fila por vela —la primera captura, la regla del
panel—, solo desenlaces reproducibles y en R **neta**.

- **Se entrena** con TP/SL, como el meta-modelo de producción.
- **La AUC** se mide sobre TP/SL.
- **La mejora** se mide sobre **todas** las decisiones del tramo, timeouts incluidos: un filtro
  actúa sobre todo lo que se decide, no solo sobre lo que acabó tocando algo.
"""

from __future__ import annotations

import datetime as dt
import json
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from .metamodel import pick_threshold, row_to_features

SEMANA = dt.timedelta(days=7)
#: Semanas de historia antes del primer tramo de prueba.
SEMANAS_MIN = 2
#: Fracción final del entrenamiento que elige el umbral, como en `train_metamodel`.
FRACCION_SELECCION = 0.15
AUC_MINIMA = 0.55
#: Filas TP/SL mínimas en una dirección para exigirle AUC propia.
MIN_POR_DIRECCION = 50
PERMUTACIONES = 1000
SEMILLA = 42


@dataclass(frozen=True)
class Decision:
    instante: dt.datetime
    clave: str
    interval: str
    direccion: str
    rama: str
    resultado: str  # tp | sl | timeout
    r: float  # neta
    features: tuple[float, ...]

    @property
    def etiquetada(self) -> bool:
        return self.resultado in ("tp", "sl")


@dataclass(frozen=True)
class Prediccion:
    decision: Decision
    prob: float
    umbral: float

    @property
    def conservada(self) -> bool:
        return self.prob >= self.umbral


Entrenador = Callable[[np.ndarray, np.ndarray], Callable[[np.ndarray], np.ndarray]]


def bosque_de_produccion(x: np.ndarray, y: np.ndarray) -> Callable[[np.ndarray], np.ndarray]:
    """El mismo bosque que `train_metamodel`: si se midiera otro, no se mediría el meta-modelo."""
    from sklearn.ensemble import RandomForestClassifier

    modelo = RandomForestClassifier(
        n_estimators=200, max_depth=4, min_samples_leaf=5, class_weight="balanced", random_state=42
    )
    modelo.fit(x, y)
    return lambda xs: modelo.predict_proba(xs)[:, 1]


def pliegues_semanales(
    decisiones: Sequence[Decision], semanas_min: int = SEMANAS_MIN
) -> list[tuple[list[int], list[int]]]:
    """Cortes de walk-forward: entrena con todo lo anterior a cada semana y prueba en esa semana."""
    if not decisiones:
        return []
    inicio = min(d.instante for d in decisiones)
    fin = max(d.instante for d in decisiones)
    pliegues: list[tuple[list[int], list[int]]] = []
    corte = inicio + semanas_min * SEMANA
    while corte <= fin:
        tren = [i for i, d in enumerate(decisiones) if d.instante < corte]
        prueba = [i for i, d in enumerate(decisiones) if corte <= d.instante < corte + SEMANA]
        if tren and prueba:
            pliegues.append((tren, prueba))
        corte += SEMANA
    return pliegues


def walk_forward(
    decisiones: Sequence[Decision],
    entrenar: Entrenador = bosque_de_produccion,
    semanas_min: int = SEMANAS_MIN,
) -> list[Prediccion]:
    """Predicciones fuera de muestra. Cada una la hace un modelo que no vio su semana."""
    predicciones: list[Prediccion] = []
    for tren, prueba in pliegues_semanales(decisiones, semanas_min):
        etiquetadas = sorted(
            (i for i in tren if decisiones[i].etiquetada), key=lambda i: decisiones[i].instante
        )
        corte_sel = int(len(etiquetadas) * (1 - FRACCION_SELECCION))
        ajuste, seleccion = etiquetadas[:corte_sel], etiquetadas[corte_sel:]
        y = np.asarray([1.0 if decisiones[i].resultado == "tp" else 0.0 for i in ajuste])
        if len(np.unique(y)) < 2 or len(seleccion) < 10:
            continue
        predecir = entrenar(np.asarray([decisiones[i].features for i in ajuste]), y)
        p_sel = predecir(np.asarray([decisiones[i].features for i in seleccion]))
        r_sel = np.asarray([decisiones[i].r for i in seleccion])
        umbral = pick_threshold(p_sel, r_sel)
        p_prueba = predecir(np.asarray([decisiones[i].features for i in prueba]))
        predicciones.extend(
            Prediccion(decisiones[i], float(p), umbral)
            for i, p in zip(prueba, p_prueba, strict=True)
        )
    return predicciones


def auc(etiquetas: Sequence[int], puntuaciones: Sequence[float]) -> float | None:
    """AUC por rangos (Mann-Whitney), con empates a mitad. `None` si falta una de las clases."""
    y = np.asarray(etiquetas, dtype=int)
    s = np.asarray(puntuaciones, dtype=float)
    pos, neg = int(y.sum()), int(len(y) - y.sum())
    if pos == 0 or neg == 0:
        return None
    orden = np.argsort(s, kind="mergesort")
    rangos = np.empty(len(s), dtype=float)
    i = 0
    s_ord = s[orden]
    while i < len(s):
        j = i
        while j + 1 < len(s) and s_ord[j + 1] == s_ord[i]:
            j += 1
        rangos[orden[i : j + 1]] = (i + j) / 2 + 1
        i = j + 1
    return float((rangos[y == 1].sum() - pos * (pos + 1) / 2) / (pos * neg))


def nula_auc_p95(
    etiquetas: Sequence[int],
    puntuaciones: Sequence[float],
    permutaciones: int = PERMUTACIONES,
    semilla: int = SEMILLA,
) -> float:
    """P95 de la AUC del azar, desplazando las puntuaciones en círculo respecto a las etiquetas.

    El desplazamiento conserva la autocorrelación temporal de las dos series —rachas de ganadoras,
    rachas de probabilidades altas— y rompe solo su alineación. Barajar fila a fila la destruiría y
    daría una nula demasiado estrecha.
    """
    n = len(etiquetas)
    if n < 3:
        return 1.0
    rng = np.random.default_rng(semilla)
    s = np.asarray(puntuaciones, dtype=float)
    valores = []
    for _ in range(permutaciones):
        k = int(rng.integers(1, n))
        a = auc(etiquetas, np.roll(s, k).tolist())
        if a is not None:
            valores.append(a)
    return float(np.percentile(valores, 95)) if valores else 1.0


def mejora(predicciones: Sequence[Prediccion]) -> tuple[float, int]:
    """Expectancy de lo conservado menos la de todo, y cuántas se conservan."""
    if not predicciones:
        return 0.0, 0
    rs = np.asarray([p.decision.r for p in predicciones])
    mask = np.asarray([p.conservada for p in predicciones])
    if not mask.any():
        return 0.0, 0
    return float(rs[mask].mean() - rs.mean()), int(mask.sum())


def deriva_semana_anterior(
    decisiones: Sequence[Decision], predicciones: Sequence[Prediccion]
) -> list[float]:
    """Puntuación de referencia: 1 si la dirección fue la ganadora de los 7 días anteriores.

    Es un «modelo» que solo sabe de deriva. Si el meta-modelo no le gana, no aporta nada que no dé
    mirar qué dirección ganó la semana pasada.
    """
    puntos: list[float] = []
    for p in predicciones:
        desde = p.decision.instante - SEMANA
        previas = [d for d in decisiones if desde <= d.instante < p.decision.instante]
        largos = [d.r for d in previas if d.direccion == "LONG"]
        cortos = [d.r for d in previas if d.direccion == "SHORT"]
        media_l = float(np.mean(largos)) if largos else 0.0
        media_c = float(np.mean(cortos)) if cortos else 0.0
        ganadora = "LONG" if media_l >= media_c else "SHORT"
        puntos.append(1.0 if p.decision.direccion == ganadora else 0.0)
    return puntos


def veredicto(resumen: dict[str, Any]) -> tuple[bool, list[str]]:
    """La regla fijada antes de medir. Devuelve (se queda, motivos)."""
    motivos: list[str] = []
    ok = True
    a = resumen.get("auc")
    if a is None or a < AUC_MINIMA:
        ok = False
        motivos.append(f"AUC agregada {a} < {AUC_MINIMA}")
    if resumen["mejora"] <= resumen["mejora_nula_p95"]:
        ok = False
        motivos.append(
            f"mejora {resumen['mejora']:+.3f} R no supera el P95 del azar "
            f"({resumen['mejora_nula_p95']:+.3f})"
        )
    for dir_, datos in resumen["por_direccion"].items():
        if datos["n"] < MIN_POR_DIRECCION:
            continue
        if datos["auc"] is None or datos["auc"] < AUC_MINIMA:
            ok = False
            motivos.append(f"AUC solo en {dir_} {datos['auc']} < {AUC_MINIMA}")
    return ok, motivos


def resumir(decisiones: Sequence[Decision], predicciones: Sequence[Prediccion]) -> dict[str, Any]:
    from .nula import marcas_de, p95_seleccion

    etiquetadas = [p for p in predicciones if p.decision.etiquetada]
    y = [1 if p.decision.resultado == "tp" else 0 for p in etiquetadas]
    s = [p.prob for p in etiquetadas]
    ganancia, conservadas = mejora(predicciones)
    rs = [p.decision.r for p in predicciones]

    def estadistico(r: np.ndarray, sel: np.ndarray) -> float:
        return float(r[sel].mean() - r.mean()) if sel.any() else 0.0

    nula_mejora = p95_seleccion(
        rs,
        marcas_de([p.decision.instante for p in predicciones], 24),
        [p.conservada for p in predicciones],
        estadistico,
        PERMUTACIONES,
        SEMILLA,
    )
    por_direccion: dict[str, dict[str, Any]] = {}
    for dir_ in ("LONG", "SHORT"):
        sub = [p for p in etiquetadas if p.decision.direccion == dir_]
        por_direccion[dir_] = {
            "n": len(sub),
            "auc": auc(
                [1 if p.decision.resultado == "tp" else 0 for p in sub], [p.prob for p in sub]
            ),
        }
    deriva = deriva_semana_anterior(decisiones, etiquetadas)
    es_largo = [1.0 if p.decision.direccion == "LONG" else 0.0 for p in etiquetadas]
    por_intervalo: dict[str, dict[str, Any]] = {}
    for iv in sorted({p.decision.interval for p in etiquetadas}):
        sub = [p for p in etiquetadas if p.decision.interval == iv]
        por_intervalo[iv] = {
            "n": len(sub),
            "auc": auc(
                [1 if p.decision.resultado == "tp" else 0 for p in sub], [p.prob for p in sub]
            ),
        }
    return {
        "decisiones": len(decisiones),
        "predicciones": len(predicciones),
        "etiquetadas": len(etiquetadas),
        "semanas": len({p.decision.instante.isocalendar()[:2] for p in predicciones}),
        "auc": auc(y, s),
        "auc_nula_p95": nula_auc_p95(y, s),
        "auc_deriva_semana_anterior": auc(y, deriva),
        "auc_es_largo": auc(y, es_largo),
        "mejora": ganancia,
        "mejora_nula_p95": nula_mejora,
        "conservadas": conservadas,
        "expectancy_todas": float(np.mean(rs)) if rs else 0.0,
        "por_direccion": por_direccion,
        "por_intervalo": por_intervalo,
    }


# --- Datos ---------------------------------------------------------------------------------------


def cargar(dsn: str) -> list[Decision]:
    """Primera captura de cada vela con desenlace real o de sombra, reproducible y en R neta."""
    import psycopg

    from .costes import desde_config, neto
    from .ensemble import artifacts_dir, load_ensemble
    from .evaluacion import ids_reproducibles
    from .run_metamodel import SNAPSHOT_COLUMNS

    pct = desde_config(load_ensemble(artifacts_dir() / "ensemble.yaml"))
    fiables_real = ids_reproducibles(dsn, rama="real")
    fiables_sombra = ids_reproducibles(dsn, rama="sombra")
    columnas = [c for c in SNAPSHOT_COLUMNS if c != "captured_at"]
    extra = [
        "id",
        "interval",
        "captured_at",
        "plan_entry",
        "plan_stop",
        "shadow_direction",
        "shadow_entry",
        "shadow_stop",
        "shadow_outcome_result",
        "shadow_outcome_return_r",
    ]
    nombres = extra + columnas
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT DISTINCT ON (symbol, interval, candle_open) {', '.join(nombres)} "  # noqa: S608
            "FROM snapshots WHERE candle_open IS NOT NULL "
            "ORDER BY symbol, interval, candle_open, captured_at ASC"
        )
        filas = [dict(zip(nombres, r, strict=True)) for r in cur.fetchall()]

    decisiones: list[Decision] = []
    for f in filas:
        if f["outcome_result"] is not None and f["id"] in fiables_real:
            rama, direccion, resultado, r = (
                "real",
                f["direction"],
                f["outcome_result"],
                f["outcome_return_r"],
            )
            entry, stop = f["plan_entry"], f["plan_stop"]
        elif f["shadow_outcome_result"] is not None and f["id"] in fiables_sombra:
            rama, direccion = "sombra", f["shadow_direction"]
            resultado, r = f["shadow_outcome_result"], f["shadow_outcome_return_r"]
            entry, stop = f["shadow_entry"], f["shadow_stop"]
        else:
            continue
        if direccion not in ("LONG", "SHORT") or r is None or entry is None or stop is None:
            continue
        r_neta = neto(float(r), float(entry), float(stop), pct) if pct > 0 else float(r)
        features = tuple(row_to_features({**f, "direction": direccion}))
        decisiones.append(
            Decision(
                instante=f["captured_at"],
                clave=f"{f['symbol']}:{f['interval']}",
                interval=str(f["interval"]),
                direccion=str(direccion),
                rama=rama,
                resultado=str(resultado),
                r=float(r_neta if r_neta is not None else r),
                features=features,
            )
        )
    decisiones.sort(key=lambda d: d.instante)
    return decisiones


def main() -> None:
    import os

    from .ensemble import artifacts_dir
    from .publicacion import publicar_json

    decisiones = cargar(os.environ["DATABASE_URL"])
    predicciones = walk_forward(decisiones)
    resumen = resumir(decisiones, predicciones)
    queda, motivos = veredicto(resumen)
    resumen["veredicto"] = {"se_queda": queda, "motivos": motivos}
    ramas = {r: sum(1 for d in decisiones if d.rama == r) for r in ("real", "sombra")}
    resumen["ramas"] = ramas
    print(json.dumps(resumen, indent=2, ensure_ascii=False, default=str))
    publicar_json(artifacts_dir() / "metamodelo_estudio.json", resumen, indent=2, default=str)


if __name__ == "__main__":
    main()

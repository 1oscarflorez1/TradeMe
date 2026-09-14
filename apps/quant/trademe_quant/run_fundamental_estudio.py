"""¿Aporta algo el Fundamental Score? La misma auditoría que retiró el meta-modelo (0.74.0).

Uso: python -m trademe_quant.run_fundamental_estudio

Qué es lo que se audita
------------------------
El score penaliza el logit de COMPRA cuando el funding del perpetuo está caro frente a sus 90 días
anteriores (`docs/fundamental.md`). Lleva en sombra desde el 19-ago-2026 y registra en cada captura
qué se habría decidido con la penalización aplicada (`fund_shadow_action`). Su gobierno lo mide cada
ciclo y lo mantiene en sombra con AUC 0,35.

Qué cambia respecto al estudio del meta-modelo, y por qué
---------------------------------------------------------
- **No hay entrenamiento.** Es una fórmula fija sobre un percentil calculado con los 90 días
  anteriores a cada decisión: cada semana ya es fuera de muestra y no hay nada que ajustar ni que
  pueda ver el futuro. El walk-forward consiste en juzgar semana a semana lo que registró en vivo.
- **Solo actúa sobre los largos.** Penalizar el logit de COMPRA nunca convierte una venta en otra
  cosa, así que en los cortos no descarta nada. El control «por dirección» no puede ser «AUC en cada
  dirección»: pasa a ser que el efecto en largos **se mantenga dentro de cada semana**. Si solo
  aparece mezclando semanas, lo que ordena es la deriva entre semanas —semanas buenas para los
  largos con funding bajo, semanas malas con funding alto—, no las operaciones. Los cortos quedan
  como control informativo.

La regla, fijada ANTES de ejecutarlo
-------------------------------------
Se queda solo si se cumplen las tres:

1. **AUC en largos ≥ 0,55**, ordenando TP sobre SL con `1 − penalización` —la magnitud con la que
   actuaría—, el listón de su propia migración 019 y del meta-modelo.
2. **Mejora de los largos que conservaría por encima del P95 del azar y de 0,05 R**: la media de lo
   conservado menos la de todo, sobre todas las decisiones —timeouts incluidos—, contra el azar
   descartando el mismo número por bloques diarios. El 0,05 es el suelo de su gobierno.
3. **AUC en largos dentro de cada semana ≥ 0,55**, media ponderada por decisiones de las semanas con
   muestra suficiente.

Si no se cumplen, sale del ciclo del piloto. Relajar la regla tras ver el resultado sería el sesgo
que este proyecto lleva meses quitando de otros sitios.
"""

from __future__ import annotations

import datetime as dt
import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import numpy as np

from .run_metamodelo_estudio import AUC_MINIMA, PERMUTACIONES, SEMANA, SEMILLA, auc, nula_auc_p95

MEJORA_MINIMA = 0.05
#: TP/SL mínimos en una semana para que su AUC cuente en la media ponderada.
MIN_POR_SEMANA = 20


@dataclass(frozen=True)
class DecisionFund:
    instante: dt.datetime
    clave: str
    direccion: str
    rama: str
    resultado: str  # tp | sl | timeout
    r: float  # neta
    percentil: float
    penalizacion: float
    #: El score la habría cambiado: con él aplicado no se abre.
    descartada: bool

    @property
    def etiquetada(self) -> bool:
        return self.resultado in ("tp", "sl")

    @property
    def semana(self) -> tuple[int, int]:
        iso = self.instante.isocalendar()
        return (iso[0], iso[1])


def _etiquetas(ds: Sequence[DecisionFund]) -> list[int]:
    return [1 if d.resultado == "tp" else 0 for d in ds]


def _puntuacion(ds: Sequence[DecisionFund]) -> list[float]:
    """Lo que ordenaría el score: sin penalización, la compra más fiable."""
    return [1.0 - d.penalizacion for d in ds]


def mejora_conservadas(ds: Sequence[DecisionFund]) -> tuple[float, int]:
    """Media de lo que el score dejaría abrir menos la media de todo, como en el meta-modelo."""
    if not ds:
        return 0.0, 0
    rs = np.asarray([d.r for d in ds])
    conservadas = np.asarray([not d.descartada for d in ds])
    if not conservadas.any():
        return 0.0, 0
    return float(rs[conservadas].mean() - rs.mean()), int(conservadas.sum())


def auc_dentro_de_semanas(ds: Sequence[DecisionFund]) -> tuple[float | None, list[dict[str, Any]]]:
    """AUC de cada semana y su media ponderada. Quita la deriva entre semanas de en medio."""
    semanas: dict[tuple[int, int], list[DecisionFund]] = {}
    for d in ds:
        semanas.setdefault(d.semana, []).append(d)
    detalle: list[dict[str, Any]] = []
    suma, peso = 0.0, 0
    for clave in sorted(semanas):
        grupo = semanas[clave]
        etiquetadas = [d for d in grupo if d.etiquetada]
        a = auc(_etiquetas(etiquetadas), _puntuacion(etiquetadas))
        ganancia, conservadas = mejora_conservadas(grupo)
        detalle.append(
            {
                "semana": f"{clave[0]}-W{clave[1]:02d}",
                "largos": len(grupo),
                "tp_sl": len(etiquetadas),
                "descartadas": sum(1 for d in grupo if d.descartada),
                "auc": a,
                "mejora": ganancia,
                "expectancy": float(np.mean([d.r for d in grupo])) if grupo else 0.0,
            }
        )
        if a is not None and len(etiquetadas) >= MIN_POR_SEMANA:
            suma += a * len(etiquetadas)
            peso += len(etiquetadas)
    return (suma / peso if peso else None), detalle


def deriva_semana_anterior(
    ds: Sequence[DecisionFund], objetivo: Sequence[DecisionFund]
) -> list[float]:
    """Referencia de deriva para largos: la expectancy de los largos de los 7 días anteriores."""
    puntos: list[float] = []
    for d in objetivo:
        previas = [x.r for x in ds if d.instante - SEMANA <= x.instante < d.instante]
        puntos.append(float(np.mean(previas)) if previas else 0.0)
    return puntos


def resumir(decisiones: Sequence[DecisionFund]) -> dict[str, Any]:
    from .fundamental_policy import lift_nulo_p95
    from .nula import marcas_de, p95_seleccion

    largos = sorted((d for d in decisiones if d.direccion == "LONG"), key=lambda d: d.instante)
    cortos = [d for d in decisiones if d.direccion == "SHORT"]
    etiquetados = [d for d in largos if d.etiquetada]
    y, s = _etiquetas(etiquetados), _puntuacion(etiquetados)
    ganancia, conservadas = mejora_conservadas(largos)
    rs = [d.r for d in largos]
    marcas = marcas_de([d.instante for d in largos], 24)

    def estadistico(r: np.ndarray, sel: np.ndarray) -> float:
        return float(r[sel].mean() - r.mean()) if sel.any() else 0.0

    nula_mejora = p95_seleccion(
        rs, marcas, [not d.descartada for d in largos], estadistico, PERMUTACIONES, SEMILLA
    )
    # El estadístico del gobierno, para poder cotejar con su artefacto: las descartadas aportan 0.
    descartes = [d.descartada for d in largos]
    lift_gobierno = (
        float(np.mean([0.0 if x else r for r, x in zip(rs, descartes, strict=True)]) - np.mean(rs))
        if rs
        else 0.0
    )
    auc_semanas, por_semana = auc_dentro_de_semanas(largos)
    cortos_etiquetados = [d for d in cortos if d.etiquetada]
    return {
        "largos": len(largos),
        "largos_tp_sl": len(etiquetados),
        "descartadas": sum(1 for d in largos if d.descartada),
        "conservadas": conservadas,
        "auc_largos": auc(y, s),
        "auc_largos_nula_p95": nula_auc_p95(y, s),
        "auc_largos_percentil": auc(y, [-d.percentil for d in etiquetados]),
        "auc_dentro_de_semanas": auc_semanas,
        "auc_deriva_semana_anterior": auc(y, deriva_semana_anterior(largos, etiquetados)),
        "mejora": ganancia,
        "mejora_nula_p95": nula_mejora,
        "lift_gobierno": lift_gobierno,
        "lift_gobierno_nula_p95": lift_nulo_p95(rs, descartes, marcas),
        "expectancy_largos": float(np.mean(rs)) if rs else 0.0,
        "control_cortos": {
            "n": len(cortos_etiquetados),
            "descartadas": sum(1 for d in cortos if d.descartada),
            "auc": auc(_etiquetas(cortos_etiquetados), _puntuacion(cortos_etiquetados)),
        },
        "por_semana": por_semana,
    }


def veredicto(resumen: dict[str, Any]) -> tuple[bool, list[str]]:
    """La regla fijada antes de medir. Devuelve (se queda, motivos)."""
    motivos: list[str] = []
    a = resumen.get("auc_largos")
    if a is None or a < AUC_MINIMA:
        motivos.append(f"AUC en largos {a} < {AUC_MINIMA}")
    exigido = max(MEJORA_MINIMA, float(resumen["mejora_nula_p95"]))
    if resumen["mejora"] <= exigido:
        motivos.append(
            f"mejora {resumen['mejora']:+.3f} R no supera lo exigido ({exigido:+.3f}: el máximo de "
            f"{MEJORA_MINIMA} y el P95 del azar)"
        )
    dentro = resumen.get("auc_dentro_de_semanas")
    if dentro is None or dentro < AUC_MINIMA:
        motivos.append(f"AUC en largos dentro de cada semana {dentro} < {AUC_MINIMA}")
    return not motivos, motivos


# --- Datos ---------------------------------------------------------------------------------------


def cargar(dsn: str) -> list[DecisionFund]:
    """Primera captura de cada vela con score calculado y desenlace reproducible, en R neta."""
    import psycopg

    from .costes import desde_config, neto
    from .ensemble import artifacts_dir, load_ensemble
    from .evaluacion import ids_reproducibles

    pct = desde_config(load_ensemble(artifacts_dir() / "ensemble.yaml"))
    fiables_real = ids_reproducibles(dsn, rama="real")
    fiables_sombra = ids_reproducibles(dsn, rama="sombra")
    nombres = [
        "id",
        "symbol",
        "interval",
        "captured_at",
        "action",
        "direction",
        "plan_entry",
        "plan_stop",
        "outcome_result",
        "outcome_return_r",
        "shadow_action",
        "shadow_direction",
        "shadow_entry",
        "shadow_stop",
        "shadow_outcome_result",
        "shadow_outcome_return_r",
        "fund_percentile",
        "fund_penalty",
        "fund_shadow_action",
    ]
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute(
            f"SELECT DISTINCT ON (symbol, interval, candle_open) {', '.join(nombres)} "  # noqa: S608
            "FROM snapshots WHERE candle_open IS NOT NULL "
            "ORDER BY symbol, interval, candle_open, captured_at ASC"
        )
        filas = [dict(zip(nombres, r, strict=True)) for r in cur.fetchall()]

    decisiones: list[DecisionFund] = []
    for f in filas:
        if f["fund_percentile"] is None:
            continue  # sin score: stale o anterior al 19-ago
        if f["outcome_result"] is not None and f["id"] in fiables_real:
            rama, direccion, resultado, r = (
                "real",
                f["direction"],
                f["outcome_result"],
                f["outcome_return_r"],
            )
            entry, stop, libre = f["plan_entry"], f["plan_stop"], f["action"]
        elif f["shadow_outcome_result"] is not None and f["id"] in fiables_sombra:
            rama, direccion = "sombra", f["shadow_direction"]
            resultado, r = f["shadow_outcome_result"], f["shadow_outcome_return_r"]
            entry, stop, libre = f["shadow_entry"], f["shadow_stop"], f["shadow_action"]
        else:
            continue
        if direccion not in ("LONG", "SHORT") or r is None or entry is None or stop is None:
            continue
        r_neta = neto(float(r), float(entry), float(stop), pct) if pct > 0 else float(r)
        # La sombra del score se calcula contra la decisión libre, previa a cuarentena y lista.
        descartada = f["fund_shadow_action"] is not None and f["fund_shadow_action"] != libre
        decisiones.append(
            DecisionFund(
                instante=f["captured_at"],
                clave=f"{f['symbol']}:{f['interval']}",
                direccion=str(direccion),
                rama=rama,
                resultado=str(resultado),
                r=float(r_neta if r_neta is not None else r),
                percentil=float(f["fund_percentile"]),
                penalizacion=float(f["fund_penalty"] or 0.0),
                descartada=bool(descartada),
            )
        )
    decisiones.sort(key=lambda d: d.instante)
    return decisiones


def main() -> None:
    import os

    from .ensemble import artifacts_dir
    from .publicacion import publicar_json

    decisiones = cargar(os.environ["DATABASE_URL"])
    resumen = resumir(decisiones)
    queda, motivos = veredicto(resumen)
    resumen["veredicto"] = {"se_queda": queda, "motivos": motivos}
    print(json.dumps(resumen, indent=2, ensure_ascii=False, default=str))
    publicar_json(artifacts_dir() / "fundamental_estudio.json", resumen, indent=2, default=str)


if __name__ == "__main__":
    main()

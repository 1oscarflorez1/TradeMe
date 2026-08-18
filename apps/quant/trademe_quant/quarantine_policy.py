"""Gobierno automático de la cuarentena de temporalidades (M10.7).

En M10.5 se retiró 4h de la operativa: −0,485 R en 89 decisiones, 69 cortos con el 85,6 % al stop.
La medida era correcta (la causa, en cambio, no era la que se creyó: ver M11). Su
implementación tenía un fallo:
`quarantine_intervals` era una lista fija que alguien tendría que acordarse de vaciar, y —peor— una
temporalidad vetada no generaba ninguna operación evaluable, así que **no podía demostrar nunca que
merecía volver**. Una medida temporal, irreversible por construcción.

Este módulo cierra el círculo. La temporalidad en cuarentena sigue registrando *qué habría hecho*
(las columnas `shadow_*`, ver migración 017) y aquí se mide ese expediente: si demuestra ventaja con
muestra suficiente, sale sola; si vuelve a degradarse, entra sola.

Es el mismo principio que gobierna al meta-modelo en `meta_policy.py`, y por las mismas razones:
**nada gana ni pierde poder sobre las decisiones sin demostrarlo con datos que no controlaba**.

Una nota sobre el sesgo: los umbrales están escritos ANTES de que exista muestra suficiente, a
propósito. Escribirlos después sería elegirlos mirando el resultado.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

# Decisiones sombra evaluadas que hacen falta para plantearse levantar la cuarentena. Con menos, una
# racha buena de tres días bastaría para volver a operar una temporalidad que perdía dinero.
MIN_SAMPLES_SALIDA = 40
# Expectancy mínima del expediente sombra para salir. Se pide claramente positiva, no «≥ 0»: salir
# con 0,00 R es volver a operar algo que no ha demostrado ganar nada.
MIN_EXPECTANCY_SALIDA = 0.05
# Y por debajo de esto, una temporalidad que opera entra en cuarentena.
MAX_EXPECTANCY_ENTRADA = -0.15
# Muestra para meter en cuarentena algo que sí opera. Más baja que la de salida a propósito: es
# asimétrico, y debe serlo. Cuesta poco dejar de operar y cuesta mucho volver a hacerlo.
MIN_SAMPLES_ENTRADA = 30


def _resumen(rs: list[float]) -> dict[str, Any]:
    n = len(rs)
    if n == 0:
        return {"n": 0, "expectancy": 0.0, "aciertos": 0, "win_rate": 0.0}
    aciertos = sum(1 for r in rs if r > 0)
    return {"n": n, "expectancy": sum(rs) / n, "aciertos": aciertos, "win_rate": aciertos / n}


def evaluate_shadow(rows: list[dict[str, Any]], limite: int = MIN_SAMPLES_SALIDA) -> dict[str, Any]:
    """Resume el expediente sombra: qué habría pasado si la temporalidad hubiera operado.

    `rows` llega ordenado de la decisión más reciente a la más antigua, y solo se miran las
    `limite` primeras. Ver `evaluate_real` para el porqué.
    """
    rs = [
        float(r["shadow_outcome_return_r"])
        for r in rows
        if r.get("shadow_outcome_return_r") is not None
    ][:limite]
    return _resumen(rs)


def evaluate_real(rows: list[dict[str, Any]], limite: int = MIN_SAMPLES_ENTRADA) -> dict[str, Any]:
    """Resume el rendimiento REAL de una temporalidad que sí opera.

    **Solo las `limite` decisiones evaluadas más recientes**, y esto es lo que corrige el defecto
    detectado el 17 de agosto de 2026: el expediente promediaba toda la historia, mezclando
    decisiones tomadas con configuraciones distintas. En 15m eso diluía 65 decisiones recientes a
    −0,260 R con 155 antiguas a +0,068 R y daba −0,029 R, por encima del umbral. Una temporalidad
    se libraba de la cuarentena por un pasado que ya no la describe.

    Cambiar la configuración cambia el sujeto medido: el historial anterior describe a un sistema
    que ya no existe.

    ¿Por qué la ventana vale exactamente `limite`, es decir, el mínimo de muestra que ya exigía la
    política? Porque **es el único número que no se elige mirando el resultado**. Estaba fijado
    desde M10.7, antes de que existiera este problema. Cualquier otra ventana habría que
    justificarla, y la única justificación disponible hoy sería el desenlace que produce, que es
    justamente el sesgo que este proyecto evita.

    No se filtra por `model_version` exacta porque Optuna publica una nueva cada una o dos semanas
    y el expediente se reiniciaría con ella, dejando el gobierno paralizado justo después de cada
    reoptimización. La recencia consigue lo mismo sin ese efecto.
    """
    rs = [float(r["outcome_return_r"]) for r in rows if r.get("outcome_return_r") is not None][
        :limite
    ]
    return _resumen(rs)


def decide_quarantine(en_cuarentena: bool, ev: dict[str, Any]) -> tuple[bool, str]:
    """Decide si la temporalidad debe estar en cuarentena, y por qué.

    Devuelve `(en_cuarentena, motivo)`. El motivo se muestra en la interfaz y se guarda en el
    artefacto: una decisión automática que no se puede explicar no es auditable.
    """
    n, exp = int(ev["n"]), float(ev["expectancy"])

    if en_cuarentena:
        if n < MIN_SAMPLES_SALIDA:
            return True, (
                f"sigue en cuarentena: {n}/{MIN_SAMPLES_SALIDA} decisiones sombra evaluadas"
            )
        if exp < MIN_EXPECTANCY_SALIDA:
            return True, (
                f"sigue en cuarentena: en sombra habría dado {exp:+.3f} R en {n} decisiones "
                f"(se exige ≥{MIN_EXPECTANCY_SALIDA})"
            )
        return False, (
            f"sale de cuarentena: en sombra habría dado {exp:+.3f} R en {n} decisiones, "
            f"con {ev['win_rate']:.0%} de aciertos"
        )

    # No está en cuarentena: se vigila su rendimiento real.
    if n < MIN_SAMPLES_ENTRADA:
        return False, f"opera con normalidad ({n}/{MIN_SAMPLES_ENTRADA} decisiones evaluadas)"
    if exp <= MAX_EXPECTANCY_ENTRADA:
        return True, (
            f"entra en cuarentena: {exp:+.3f} R en {n} decisiones "
            f"(el límite está en {MAX_EXPECTANCY_ENTRADA})"
        )
    return False, f"opera con normalidad ({exp:+.3f} R en {n} decisiones)"


def load_policy(artifacts: Path) -> dict[str, Any]:
    p = artifacts / "quarantine.json"
    if p.exists():
        try:
            data: dict[str, Any] = json.loads(p.read_text(encoding="utf8"))
            return data
        except Exception:  # noqa: BLE001
            pass
    return {"intervals": {}, "updated_at": None}


def save_policy(artifacts: Path, decisiones: dict[str, dict[str, Any]]) -> dict[str, Any]:
    artifacts.mkdir(parents=True, exist_ok=True)
    data = {
        "version": time.strftime("qtn-%Y-%m-%dT%H%M%SZ", time.gmtime()),
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "min_samples_salida": MIN_SAMPLES_SALIDA,
        "min_expectancy_salida": MIN_EXPECTANCY_SALIDA,
        "intervals": decisiones,
    }
    (artifacts / "quarantine.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf8"
    )
    return data


def _fetch(dsn: str) -> dict[str, list[dict[str, Any]]]:
    import psycopg

    agrupado: dict[str, list[dict[str, Any]]] = {}
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        # De la más reciente a la más antigua: el expediente se queda con las primeras, porque lo
        # que describe al sistema de hoy es lo que ha hecho últimamente, no su historia entera.
        cur.execute("""
            SELECT symbol, interval, outcome_return_r, shadow_outcome_return_r
              FROM snapshots
             WHERE outcome_return_r IS NOT NULL OR shadow_outcome_return_r IS NOT NULL
             ORDER BY captured_at DESC
            """)
        for symbol, interval, real, sombra in cur.fetchall():
            agrupado.setdefault(f"{symbol}:{interval}", []).append(
                {"outcome_return_r": real, "shadow_outcome_return_r": sombra}
            )
    return agrupado


def publish(artifacts: Path, dsn: str, actuales: list[str]) -> dict[str, Any]:
    """Revisa cada temporalidad y publica `quarantine.json`.

    `actuales` son las temporalidades hoy en cuarentena, según `ensemble.yaml`. La decisión de cada
    una depende de a qué expediente mira: si está vetada, al sombra (lo que habría hecho); si opera,
    al real (lo que hizo).
    """
    datos = _fetch(dsn)
    decisiones: dict[str, dict[str, Any]] = {}
    for clave, filas in datos.items():
        interval = clave.split(":", 1)[1]
        vetada = interval in actuales
        # Cada caso mira su propio expediente y su propia ventana: la de salida es más larga porque
        # volver a operar exige más pruebas que dejar de hacerlo.
        ev = (
            evaluate_shadow(filas, MIN_SAMPLES_SALIDA)
            if vetada
            else evaluate_real(filas, MIN_SAMPLES_ENTRADA)
        )
        nueva, motivo = decide_quarantine(vetada, ev)
        decisiones[clave] = {
            "interval": interval,
            "quarantined": nueva,
            "was_quarantined": vetada,
            "changed": nueva != vetada,
            "reason": motivo,
            "evidence": {
                "n": ev["n"],
                "expectancy": round(float(ev["expectancy"]), 4),
                "win_rate": round(float(ev["win_rate"]), 4),
                "source": "sombra" if vetada else "real",
            },
        }
    return save_policy(artifacts, decisiones)

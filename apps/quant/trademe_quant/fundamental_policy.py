"""Gobierno del Fundamental Score: de sombra a activo, solo con evidencia (M12).

El score entra en sombra y no influye. Este módulo mide, con decisiones reales ya cerradas, si
haberlo aplicado habría mejorado el resultado; y solo entonces lo asciende. Si deja de cumplir,
retrocede.

Es el mismo principio que el meta-modelo y la cuarentena: nada gana poder sobre una decisión sin
demostrarlo con datos que no controlaba. Los umbrales —lift >= 0,05 R y AUC >= 0,55— quedaron
escritos en la migración 019 **antes de ver el primer resultado**.

Tres diferencias con `meta_policy.py`, y no son de estilo
---------------------------------------------------------
1. **Solo LONG.** El score penaliza compras y no dice nada de las ventas, porque el efecto medido
   solo existe ahí. Evaluarlo sobre cortos sería medir ruido y diluir la señal con él.

2. **El lift sale de la sombra que se registró, no de reconstruir un filtro.** `fund_shadow_action`
   guarda qué se habría decidido con la penalización aplicada, así que la comparación es directa:
   donde la sombra discrepa, esa operación no se habría abierto y su resultado habría sido 0.
   Reconstruirlo a posteriori invitaría a elegir el criterio mirando el desenlace.

3. **Hace falta un mínimo de DISCREPANCIAS, no solo de decisiones.** Un score que nunca cambia nada
   tiene lift exactamente 0 por construcción, y con muestra suficiente eso se leería como «no
   perjudica» en vez de como «no ha demostrado nada». Son cosas distintas.

Limitación conocida: `n` cuenta decisiones, no evidencia
--------------------------------------------------------
Las decisiones de varios activos cripto en el mismo tramo de mercado **no son independientes**. La
primera medición real (21 ago 2026) lo enseñó de golpe: de 75 decisiones LONG cerradas, 74 eran de
ETH y SOL dentro de las mismas 14 horas de subida, con 27 aciertos de 35 en ETH. El `baseline` salía
+1,08 R —una cifra que no describe la plataforma, sino ese rally— y contra él cualquier filtro que
quite operaciones parece desastroso.

`MIN_SAMPLES` no protege de eso: cien decisiones correlacionadas siguen siendo casi una sola
apuesta observada cien veces. Mientras no exista el Gestor de Correlaciones, conviene mirar el
reparto por símbolo y por ventana temporal antes de dar peso a un veredicto, en las dos direcciones
—tanto si el score sale bien parado como si sale mal—.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import numpy as np

from .correlaciones import observaciones_efectivas
from .nula import p95_seleccion

MODES = ["off", "shadow", "active"]

#: Decisiones LONG cerradas mínimas para juzgar.
MIN_SAMPLES = 100
#: De esas, cuántas tiene que haber cambiado el score. Sin discrepancias no hay nada que medir.
MIN_DISCREPANCIAS = 30
#: Mejora mínima de expectancy, en R. Fijado en la migración 019.
MIN_LIFT_R = 0.05
#: Capacidad mínima de ordenar perdedoras sobre ganadoras. Fijado en la migración 019.
MIN_AUC = 0.55


#: Permutaciones para la nula que se calcula en cada ciclo. Menos que en el estudio (10.000),
#: suficiente para un percentil 95 estable y barato de ejecutar cada pocas horas.
PERMUTACIONES_NULA = 1_000


def _lift_descartando(arr: np.ndarray[Any, Any], descartadas: np.ndarray[Any, Any]) -> float:
    """Lift de descartar ese conjunto: las descartadas no se abren y aportan 0, sobre `n`."""
    return float(np.where(descartadas, 0.0, arr).mean()) - float(arr.mean())


def lift_nulo_p95(
    rs: list[float], descartadas: list[bool], marcas: list[int], semilla: int = 20260822
) -> float:
    """Lift que alcanza el AZAR en el percentil 95, descartando la misma cantidad de operaciones.

    Por qué hace falta y por qué el umbral fijo no basta: el lift de descartar operaciones **depende
    del signo del baseline**. Con expectancy positiva, quitar operaciones al azar la reduce hacia
    cero y da lift negativo; con expectancy negativa, la sube y da lift positivo. Un listón fijo de
    0,05 R es entonces exigente en las rachas buenas y regalado en las malas — justo al revés de lo
    que conviene.

    Medido el 22 de agosto de 2026 con 114 decisiones y baseline +1,395 R: el azar alcanzaba
    −0,149 R en el percentil 95. Con un baseline negativo ese número habría sido positivo, y por
    encima del umbral fijo de 0,05.

    La permutación es **por bloques**: se reparten entre ventanas los conteos de descartes en vez de
    elegir filas sueltas. Los cuatro activos cripto valen 1,52 efectivos, así que una permutación
    simple subestimaría la varianza — sería tratar `n` como evidencia otra vez.

    El bucle vive en `nula.py` desde el Hito A, porque el mismo control lo necesitan la cuarentena y
    el meta-modelo. Lo que **no** se comparte es el estadístico: aquí los descartes aportan 0 y el
    denominador sigue siendo `n`, mientras que el meta-modelo promedia solo las conservadas. Se
    verificó que el traslado no mueve un solo dígito del percentil con la misma semilla.
    """
    return p95_seleccion(
        rs,
        marcas,
        descartadas,
        _lift_descartando,
        permutaciones=PERMUTACIONES_NULA,
        semilla=semilla,
    )


def evaluate_shadow(
    rows: list[dict[str, Any]], correlaciones: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Compara lo que pasó con lo que habría pasado aplicando la penalización.

    `rows` son decisiones **LONG ya cerradas** con su `fund_shadow_action` registrado. Cada una
    aporta su R real al escenario base; al escenario con score aporta 0 si la sombra discrepaba
    (no se habría operado) y su R real si coincidía.

    `correlaciones` es el artefacto del Gestor de Correlaciones. Con él se calcula `n_efectivo`:
    cuántas observaciones **independientes** representan esas decisiones. Cuatro activos cripto
    correlacionados a 0,7-0,8 valen 1,52 efectivos, así que un `n` de 134 puede ser evidencia de
    unas 50. Sin artefacto, `n_efectivo == n` y no se descuenta nada.
    """
    usable = [
        r
        for r in rows
        if r.get("outcome_return_r") is not None
        and r.get("action") is not None
        and r.get("fund_shadow_action") is not None
    ]
    n = len(usable)
    if n == 0:
        return {
            "n": 0,
            "n_efectivo": 0.0,
            "lift_nulo_p95": 0.0,
            "baseline": 0.0,
            "con_score": 0.0,
            "lift": 0.0,
            "discrepancias": 0,
            "auc": 0.5,
        }

    rs = [float(r["outcome_return_r"]) for r in usable]
    discrepa = [str(r["fund_shadow_action"]) != str(r["action"]) for r in usable]
    baseline = sum(rs) / n
    # Donde el score habría dicho otra cosa, la operación no se abre: su aportación es 0.
    con_score = sum(0.0 if d else r for r, d in zip(rs, discrepa, strict=True)) / n

    # AUC por conteo de pares, sin dependencias. Se ordena por `1 - penalización`: la penalización
    # pretende señalar las MALAS compras, así que su complementario debe ordenar las ganadoras por
    # encima. Con esta convención, AUC > 0,5 significa «acierta», igual que en el meta-modelo.
    puntajes = [1.0 - float(r.get("fund_penalty") or 0.0) for r in usable]
    ganadoras = [p for p, r in zip(puntajes, rs, strict=True) if r > 0]
    perdedoras = [p for p, r in zip(puntajes, rs, strict=True) if r <= 0]
    if ganadoras and perdedoras:
        mejores = sum(1 for g in ganadoras for p in perdedoras if g > p)
        empates = sum(1 for g in ganadoras for p in perdedoras if g == p)
        auc = (mejores + 0.5 * empates) / (len(ganadoras) * len(perdedoras))
    else:
        auc = 0.5

    marcas = [
        int(r["captured_at"].timestamp() // (24 * 3600)) if r.get("captured_at") else 0
        for r in usable
    ]
    nula_p95 = lift_nulo_p95(rs, discrepa, marcas)

    return {
        "n": n,
        # Se guardan LOS DOS a propósito: la diferencia entre decisiones y evidencia tiene que
        # verse en el artefacto, no esconderse detrás de un solo número.
        "n_efectivo": observaciones_efectivas(usable, correlaciones),
        "lift_nulo_p95": nula_p95,
        "baseline": baseline,
        "con_score": con_score,
        "lift": con_score - baseline,
        "discrepancias": sum(1 for d in discrepa if d),
        "auc": auc,
    }


def decide_mode(current: str, ev: dict[str, Any], max_mode: str = "active") -> tuple[str, str]:
    """Decide el modo siguiente. Asciende solo con evidencia; retrocede en cuanto la pierde."""
    cap = MODES.index(max_mode) if max_mode in MODES else len(MODES) - 1
    cur = MODES.index(current) if current in MODES else 1
    n = int(ev["n"])
    # El umbral se compara contra la evidencia, no contra el recuento de filas. Sin medición de
    # correlaciones son el mismo número, así que esto nunca relaja el criterio: solo lo endurece.
    n_ef = float(ev.get("n_efectivo", n))
    lift = float(ev["lift"])
    auc = float(ev["auc"])
    disc = int(ev["discrepancias"])
    # Umbral efectivo = el más exigente entre el fijo y lo que alcanza el azar.
    #
    # `MIN_LIFT_R` solo no basta: el lift de descartar operaciones depende del signo del baseline,
    # así que 0,05 R es exigente en las rachas buenas y regalado en las malas. Tomar el máximo hace
    # el criterio neutral al régimen y **solo endurece**: nunca deja pasar algo que antes no pasaba.
    exigido = max(MIN_LIFT_R, float(ev.get("lift_nulo_p95", 0.0)))

    # Permanencia simétrica. Quien ya influye en las decisiones sigue cumpliendo lo que se le exigió
    # para llegar ahí: un umbral que solo se comprueba al ascender es un peaje de entrada, no un
    # umbral. El meta-modelo aprendió esto conservando poder con AUC 0,43.
    if cur >= 2 and n_ef >= MIN_SAMPLES:
        if lift < exigido or auc < MIN_AUC:
            return "shadow", (
                f"deja de cumplir lo exigido para influir (mejora {lift:+.3f} R, AUC {auc:.2f}; "
                f"se exige >={exigido:+.3f} R y AUC >={MIN_AUC} en {n} decisiones): vuelve a sombra"
            )

    if n_ef < MIN_SAMPLES:
        detalle = f"{n_ef:.0f}/{MIN_SAMPLES} observaciones efectivas"
        if abs(n_ef - n) >= 1:
            detalle += f" ({n} decisiones LONG cerradas, descontadas por correlación entre activos)"
        return current, f"evidencia insuficiente: {detalle}"
    if disc < MIN_DISCREPANCIAS:
        # Sin discrepancias el lift es 0 por construcción, y un 0 así no significa «inofensivo»:
        # significa que el score no ha llegado a opinar distinto ni una vez.
        return current, (
            f"el score apenas cambia decisiones ({disc}/{MIN_DISCREPANCIAS} discrepancias): "
            "no hay nada que medir todavía"
        )
    if lift < exigido or auc < MIN_AUC:
        detalle = f"se exige >={exigido:+.3f} R"
        if exigido > MIN_LIFT_R:
            detalle += (
                f" (el azar alcanza {exigido:+.3f} con esta muestra,"
                f" por encima del fijo {MIN_LIFT_R})"
            )
        return current, (
            f"aún no demuestra ventaja (mejora {lift:+.3f} R, AUC {auc:.2f}; "
            f"{detalle} y AUC >={MIN_AUC})"
        )
    if cur < 2 <= cap:
        return "active", (
            f"demuestra ventaja ({lift:+.3f} R sobre un azar de {exigido:+.3f}, AUC {auc:.2f} "
            f"en {n} decisiones LONG, {disc} de ellas cambiadas): pasa a penalizar de verdad"
        )
    return current, "sin cambios"


def fetch_rows(
    dsn: str, solo_reproducibles: bool = True, horizons: dict[str, int] | None = None
) -> list[dict[str, Any]]:
    """Decisiones LONG cerradas que además registraron la sombra del score.

    Se deduplica por símbolo, temporalidad y vela: la captura repetida de una misma vela no son
    observaciones independientes, y sin esto una situación repetida pesaría varias veces.

    Y se filtra por reproducibilidad del desenlace, por la misma razón que se deduplica: lo que no
    mide lo que dice medir no debería contar.
    """
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM (
                 SELECT DISTINCT ON (symbol, interval, candle_open)
                        id, symbol, action, fund_shadow_action, fund_penalty,
                        outcome_return_r, captured_at
                   FROM snapshots
                  WHERE direction = 'LONG'
                    AND outcome_result IN ('tp','sl')
                    AND fund_shadow_action IS NOT NULL
                  ORDER BY symbol, interval, candle_open, captured_at ASC
               ) t ORDER BY captured_at ASC""")
        columnas = [
            "id",
            "symbol",
            "action",
            "fund_shadow_action",
            "fund_penalty",
            "outcome_return_r",
            "captured_at",
        ]
        filas = [dict(zip(columnas, r, strict=True)) for r in cur.fetchall()]

    # Mismo criterio que el resto de estudios: un desenlace escrito con otra regla de evaluación
    # no mide lo mismo, y aquí decide si el Fundamental Score sale de sombra. Ver `evaluacion.py`.
    if solo_reproducibles:
        from .evaluacion import ids_reproducibles

        fiables = ids_reproducibles(dsn, horizons)
        filas = [f for f in filas if f["id"] in fiables]
    for f in filas:
        f.pop("id", None)
    return filas


def load_policy(artifacts: Path) -> dict[str, Any]:
    p = artifacts / "fundamental_policy.json"
    if p.exists():
        try:
            return json.loads(p.read_text())  # type: ignore[no-any-return]
        except Exception:  # noqa: BLE001
            pass
    return {"mode": "shadow", "reason": "estado inicial", "updated_at": None}


def save_policy(artifacts: Path, mode: str, reason: str, ev: dict[str, Any]) -> dict[str, Any]:
    artifacts.mkdir(parents=True, exist_ok=True)
    data = {
        "mode": mode,
        "reason": reason,
        "evidence": ev,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (artifacts / "fundamental_policy.json").write_text(json.dumps(data, indent=2))
    return data


def publish(artifacts: Path, dsn: str, max_mode: str = "active") -> dict[str, Any]:
    """Mide el expediente sombra y publica el modo que corresponda."""
    from .correlaciones import load as load_correlaciones

    actual = str(load_policy(artifacts).get("mode", "shadow"))
    ev = evaluate_shadow(fetch_rows(dsn), load_correlaciones(artifacts))
    modo, razon = decide_mode(actual, ev, max_mode)
    data = save_policy(artifacts, modo, razon, ev)
    data["changed"] = modo != actual
    return data

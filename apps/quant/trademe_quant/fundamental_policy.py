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

MODES = ["off", "shadow", "active"]

#: Decisiones LONG cerradas mínimas para juzgar.
MIN_SAMPLES = 100
#: De esas, cuántas tiene que haber cambiado el score. Sin discrepancias no hay nada que medir.
MIN_DISCREPANCIAS = 30
#: Mejora mínima de expectancy, en R. Fijado en la migración 019.
MIN_LIFT_R = 0.05
#: Capacidad mínima de ordenar perdedoras sobre ganadoras. Fijado en la migración 019.
MIN_AUC = 0.55


def evaluate_shadow(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """Compara lo que pasó con lo que habría pasado aplicando la penalización.

    `rows` son decisiones **LONG ya cerradas** con su `fund_shadow_action` registrado. Cada una
    aporta su R real al escenario base; al escenario con score aporta 0 si la sombra discrepaba
    (no se habría operado) y su R real si coincidía.
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

    return {
        "n": n,
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
    lift = float(ev["lift"])
    auc = float(ev["auc"])
    disc = int(ev["discrepancias"])

    # Permanencia simétrica. Quien ya influye en las decisiones sigue cumpliendo lo que se le exigió
    # para llegar ahí: un umbral que solo se comprueba al ascender es un peaje de entrada, no un
    # umbral. El meta-modelo aprendió esto conservando poder con AUC 0,43.
    if cur >= 2 and n >= MIN_SAMPLES:
        if lift < MIN_LIFT_R or auc < MIN_AUC:
            return "shadow", (
                f"deja de cumplir lo exigido para influir (mejora {lift:+.3f} R, AUC {auc:.2f}; "
                f"se exige >={MIN_LIFT_R} R y AUC >={MIN_AUC} en {n} decisiones): vuelve a sombra"
            )

    if n < MIN_SAMPLES:
        return current, f"evidencia insuficiente ({n}/{MIN_SAMPLES} decisiones LONG cerradas)"
    if disc < MIN_DISCREPANCIAS:
        # Sin discrepancias el lift es 0 por construcción, y un 0 así no significa «inofensivo»:
        # significa que el score no ha llegado a opinar distinto ni una vez.
        return current, (
            f"el score apenas cambia decisiones ({disc}/{MIN_DISCREPANCIAS} discrepancias): "
            "no hay nada que medir todavía"
        )
    if lift < MIN_LIFT_R or auc < MIN_AUC:
        return current, (
            f"aún no demuestra ventaja (mejora {lift:+.3f} R, AUC {auc:.2f}; "
            f"se exige >={MIN_LIFT_R} R y AUC >={MIN_AUC})"
        )
    if cur < 2 <= cap:
        return "active", (
            f"demuestra ventaja ({lift:+.3f} R, AUC {auc:.2f} en {n} decisiones LONG, "
            f"{disc} de ellas cambiadas): pasa a penalizar de verdad"
        )
    return current, "sin cambios"


def fetch_rows(dsn: str) -> list[dict[str, Any]]:
    """Decisiones LONG cerradas que además registraron la sombra del score.

    Se deduplica por símbolo, temporalidad y vela: la captura repetida de una misma vela no son
    observaciones independientes, y sin esto una situación repetida pesaría varias veces.
    """
    import psycopg

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        cur.execute("""SELECT * FROM (
                 SELECT DISTINCT ON (symbol, interval, candle_open)
                        symbol, action, fund_shadow_action, fund_penalty,
                        outcome_return_r, captured_at
                   FROM snapshots
                  WHERE direction = 'LONG'
                    AND outcome_result IN ('tp','sl')
                    AND fund_shadow_action IS NOT NULL
                  ORDER BY symbol, interval, candle_open, captured_at ASC
               ) t ORDER BY captured_at ASC""")
        columnas = [
            "symbol",
            "action",
            "fund_shadow_action",
            "fund_penalty",
            "outcome_return_r",
            "captured_at",
        ]
        return [dict(zip(columnas, r, strict=True)) for r in cur.fetchall()]


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
    actual = str(load_policy(artifacts).get("mode", "shadow"))
    ev = evaluate_shadow(fetch_rows(dsn))
    modo, razon = decide_mode(actual, ev, max_mode)
    data = save_policy(artifacts, modo, razon, ev)
    data["changed"] = modo != actual
    return data

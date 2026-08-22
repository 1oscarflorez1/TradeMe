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

Hito A (22 ago 2026) — el umbral de salida se compara con el azar
------------------------------------------------------------------
Auditando los tres módulos de gobierno apareció algo incómodo: la cuarentena era **el único con
poder de veto activo** y **el único sin control contra el azar**. `fundamental_policy` tenía 8
referencias a su distribución nula; este fichero, ninguna.

Y aquí el problema muerde con fuerza, porque las decisiones que juzgan a una temporalidad se
amontonan en el tiempo. Medido: las 30 que juzgan a `BTCUSDT:15m` caben en **9,8 horas**; las de
`SOLUSDT:15m`, 15 decisiones en **2,8 horas**. `BTCUSDT:15m` entró en cuarentena con −0,940 R sobre
30 decisiones de menos de un día. Puede ser una temporalidad mala o puede ser un mal martes: la
medición anterior **no lo distinguía**.

Desde aquí, la puerta de salida se compara con esa nula, que pregunta: *¿qué expectancy da coger `n`
decisiones cualesquiera de la plataforma, en bloques de 24 h, del mismo periodo?* Ver `nula.py`.

El criterio exacto es **no-inferioridad al mercado** —`mediana de la nula + 0,05 R`— y no el
percentil 95, que fue lo que se entregó en v0.46.0 y hubo que corregir un día después: exigir el
P95 de una nula muestreada de la propia plataforma es un cupo del 5 %, no un listón. Ver
`umbral_salida`.

**La puerta de entrada NO lleva nula, y es deliberado.** Exigir significancia para *entrar* dejaría
operando temporalidades malas mientras no se demuestre que lo son —el efecto contrario al que se
busca—. La nula solo se usa donde endurece la seguridad, que es coherente con lo que este módulo ya
decía: cuesta poco dejar de operar y cuesta mucho volver a hacerlo.

Dos piezas de `fundamental_policy` que NO son trasplantables aquí, y por qué
----------------------------------------------------------------------------
1. **`observaciones_efectivas`** descuenta por correlación *entre activos* dentro de una ventana.
   La cuarentena evalúa por clave `SÍMBOLO:intervalo`, o sea un solo símbolo por grupo, y
   `correlaciones.factor_para` devuelve exactamente 1 con un símbolo. Sería una llamada que no hace
   nada. El solapamiento que sí sufre esta medición es **temporal**, y de eso se encarga el
   muestreo por bloques.
2. **`lift_nulo_p95`** mide el efecto de *descartar* operaciones, con las descartadas aportando 0
   sobre `n`. Aquí no se descarta nada: se mide **expectancy directa**. Otro estadístico, otra nula.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, NamedTuple

import numpy as np

from .nula import (
    DIAS_POBLACION,
    PERCENTIL,
    PERCENTIL_REFERENCIA,
    PERMUTACIONES_CICLO,
    agrupar,
    distribucion_expectancy_bloques,
    marcas_de,
)

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


class Poblacion(NamedTuple):
    """Todas las decisiones cerradas de la plataforma, para muestrear la nula.

    De **todos** los activos y temporalidades, no solo de la clave juzgada: la pregunta es si esta
    temporalidad se distingue del mercado que hubo, y ese mercado son las demás decisiones. Que la
    propia clave forme parte de la población es correcto y, medido, irrelevante: la mayor aporta 31
    filas de más de mil.

    Se mezclan desenlaces reales y de sombra a propósito. La migración 017 dejó escrito que la
    sombra se evalúa con las **mismas reglas** que el desenlace real —primer toque, horizonte por
    temporalidad—, así que son la misma unidad. Lo que nunca se mezcla es *quién* se juzga con qué:
    eso sigue separado en `evaluate_shadow` y `evaluate_real`.
    """

    rs: list[float]
    instantes: list[datetime]


def _resumen(rs: list[float]) -> dict[str, Any]:
    n = len(rs)
    base = {"nula_mediana": 0.0, "nula_p95": 0.0, "n_poblacion": 0, "bloques_poblacion": 0}
    if n == 0:
        return {"n": 0, "expectancy": 0.0, "aciertos": 0, "win_rate": 0.0, **base}
    aciertos = sum(1 for r in rs if r > 0)
    return {
        "n": n,
        "expectancy": sum(rs) / n,
        "aciertos": aciertos,
        "win_rate": aciertos / n,
        **base,
    }


def _nula(
    poblacion: Poblacion | None,
    instantes: list[Any],
    n: int,
    permutaciones: int = PERMUTACIONES_CICLO,
) -> dict[str, Any]:
    """Expectancy que alcanza el azar con `n` decisiones del mismo periodo.

    El periodo se toma como los `DIAS_POBLACION` días que terminan en la decisión más reciente de la
    ventana juzgada, ampliado si esa ventana fuera aún más larga. No se recorta al span exacto de lo
    observado porque medido eso deja **1 a 4 bloques** de 24 h, y con cuatro días el «percentil 95»
    es el mejor de los cuatro: no estima variabilidad ninguna.

    Sin población, sin fechas o sin bloques suficientes devuelve 0,0, que deja gobernando al umbral
    fijo — es decir, el comportamiento anterior al Hito A. Nunca relaja.
    """
    vacio = {"nula_mediana": 0.0, "nula_p95": 0.0, "n_poblacion": 0, "bloques_poblacion": 0}
    fechas = [t for t in instantes if isinstance(t, datetime)]
    if poblacion is None or n <= 0 or not fechas or not poblacion.rs:
        return vacio

    fin = max(fechas)
    inicio = min(min(fechas), fin - timedelta(days=DIAS_POBLACION))
    pares = [
        (r, t) for r, t in zip(poblacion.rs, poblacion.instantes, strict=True) if inicio <= t <= fin
    ]
    if not pares:
        return vacio

    marcas = marcas_de([t for _, t in pares])
    dist = distribucion_expectancy_bloques(
        [r for r, _ in pares], marcas, n, permutaciones=permutaciones
    )
    if dist is None:
        return vacio
    # Se guardan los dos percentiles: la **mediana gobierna** y el P95 queda como referencia de cuán
    # extremo habría sido el criterio anterior. Auditar un veredicto no debería obligar a
    # recalcularlo.
    return {
        "nula_mediana": float(np.percentile(dist, PERCENTIL_REFERENCIA)),
        "nula_p95": float(np.percentile(dist, PERCENTIL)),
        "n_poblacion": len(pares),
        "bloques_poblacion": len(agrupar(marcas)),
    }


def evaluate_shadow(
    rows: list[dict[str, Any]],
    limite: int = MIN_SAMPLES_SALIDA,
    poblacion: Poblacion | None = None,
    permutaciones: int = PERMUTACIONES_CICLO,
) -> dict[str, Any]:
    """Resume el expediente sombra: qué habría pasado si la temporalidad hubiera operado.

    `rows` llega ordenado de la decisión más reciente a la más antigua, y solo se miran las
    `limite` primeras. Ver `evaluate_real` para el porqué.

    Con `poblacion` se calcula además la nula que gobierna la puerta de salida. Sin ella el resumen
    lleva `nula_p95 = 0.0` y la decisión sale igual que antes del Hito A.
    """
    usable = [r for r in rows if r.get("shadow_outcome_return_r") is not None][:limite]
    rs = [float(r["shadow_outcome_return_r"]) for r in usable]
    ev = _resumen(rs)
    ev.update(_nula(poblacion, [r.get("captured_at") for r in usable], len(rs), permutaciones))
    return ev


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

    **No recibe población y no calcula nula, a propósito.** La entrada en cuarentena se decide con
    el umbral fijo de siempre. Pedirle significancia estadística dejaría operando temporalidades
    malas mientras no se demuestre que lo son, que es el error contrario y el más caro de los dos.
    Que la firma ni siquiera admita el argumento lo hace estructuralmente imposible, no cuestión de
    acordarse.
    """
    rs = [float(r["outcome_return_r"]) for r in rows if r.get("outcome_return_r") is not None][
        :limite
    ]
    return _resumen(rs)


def umbral_salida(ev: dict[str, Any]) -> float:
    """Expectancy que hay que demostrar para volver a operar.

    **No-inferioridad al mercado**: `mediana de la nula + MIN_EXPECTANCY_SALIDA`, con el fijo como
    suelo. En castellano: *sé algo mejor que un tramo típico del mercado que hubo en ese periodo*.

    Por qué la mediana y no el percentil 95, que es lo que hacía la v0.46.0
    -----------------------------------------------------------------------
    Porque la nula se muestrea de la **propia plataforma**, así que exigir su P95 para readmitir es
    un **cupo del 5 %**, no un listón de calidad: si todas las temporalidades fueran buenas e
    idénticas, el 95 % seguiría vetado. Medido el 22 de agosto de 2026, el P95 pedía un 57 % de
    aciertos para volver cuando para **seguir operando** bastaba un 28 %, y esa banda muerta dejaba
    fuera a temporalidades rentables — el punto de equilibrio del sistema está en el 33 %. La mitad
    de las claves que operaban ese día no habrían podido regresar con el rendimiento que tenían.

    Es el defecto espejo del que `meta_policy` documenta: allí un umbral que solo se comprueba al
    ascender es un peaje de entrada; aquí un umbral de readmisión mucho más alto que el de
    permanencia es un cupo. En los dos casos el arreglo es el mismo — que readmitir y permanecer se
    midan con la misma vara, más la asimetría que se haya decidido a conciencia y no de rebote.

    El P95 **sigue siendo el correcto** en `meta_policy` y `fundamental_policy`, y no es
    incoherencia: allí la pregunta es «¿este mecanismo aporta algo o es azar?», con un solo
    candidato al que se le exige evidencia fuerte. Aquí es «¿esta temporalidad merece volver?», con
    muchos competidores homogéneos. Preguntas distintas, percentiles distintos.

    Qué se conserva del Hito A
    ---------------------------
    Lo que se buscaba: **neutralidad respecto al régimen**. Un umbral fijo es exigente en las
    rachas buenas y regalado en las malas; contra la mediana, el listón sube y baja con el mercado.
    El P95 no lo hacía neutral, lo hacía extremo.

    Y el suelo se mantiene: por muy malo que fuera el mercado —mediana negativa— nunca se sale con
    menos de `MIN_EXPECTANCY_SALIDA`. Volver a operar con 0,00 R sigue sin valer.
    """
    return max(MIN_EXPECTANCY_SALIDA, float(ev.get("nula_mediana", 0.0)) + MIN_EXPECTANCY_SALIDA)


def decide_quarantine(en_cuarentena: bool, ev: dict[str, Any]) -> tuple[bool, str]:
    """Decide si la temporalidad debe estar en cuarentena, y por qué.

    Devuelve `(en_cuarentena, motivo)`. El motivo se muestra en la interfaz y se guarda en el
    artefacto: una decisión automática que no se puede explicar no es auditable.

    La regla es **asimétrica** desde el Hito A: la salida se compara además con el azar; la entrada,
    no. Ver la cabecera del módulo.
    """
    n, exp = int(ev["n"]), float(ev["expectancy"])

    if en_cuarentena:
        if n < MIN_SAMPLES_SALIDA:
            return True, (
                f"sigue en cuarentena: {n}/{MIN_SAMPLES_SALIDA} decisiones sombra evaluadas"
            )
        exigido = umbral_salida(ev)
        if exp < exigido:
            detalle = f"se exige ≥{exigido:+.3f} R"
            if exigido > MIN_EXPECTANCY_SALIDA:
                detalle += (
                    f", que es {MIN_EXPECTANCY_SALIDA} por encima del tramo típico del mercado"
                    f" en este periodo ({float(ev.get('nula_mediana', 0.0)):+.3f} R)"
                )
            return True, (
                f"sigue en cuarentena: en sombra habría dado {exp:+.3f} R en {n} decisiones "
                f"({detalle})"
            )
        return False, (
            f"sale de cuarentena: en sombra habría dado {exp:+.3f} R en {n} decisiones, "
            f"con {ev['win_rate']:.0%} de aciertos, por encima del {exigido:+.3f} R exigido"
        )

    # No está en cuarentena: se vigila su rendimiento real. Aquí NO se lee `nula_p95` —ni siquiera
    # cuando viene calculado—, por lo dicho en la cabecera: la significancia solo se exige donde
    # endurece la seguridad, y en la entrada la endurecería al revés.
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
        # Con qué se calculó la nula de la puerta de salida. Va en el artefacto para que el
        # veredicto se pueda reproducir sin leer el código de la versión que lo escribió.
        "nula": {
            "dias_poblacion": DIAS_POBLACION,
            "permutaciones": PERMUTACIONES_CICLO,
            "aplica_a": "salida",
        },
        "intervals": decisiones,
    }
    (artifacts / "quarantine.json").write_text(
        json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf8"
    )
    return data


def fetch_expedientes(dsn: str) -> tuple[dict[str, list[dict[str, Any]]], Poblacion]:
    """Expedientes por clave y, de la misma consulta, la población para la nula."""
    import psycopg

    agrupado: dict[str, list[dict[str, Any]]] = {}
    pob_rs: list[float] = []
    pob_ts: list[datetime] = []
    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        # De la más reciente a la más antigua: el expediente se queda con las primeras, porque lo
        # que describe al sistema de hoy es lo que ha hecho últimamente, no su historia entera.
        cur.execute("""
            SELECT symbol, interval, captured_at, outcome_return_r, shadow_outcome_return_r
              FROM snapshots
             WHERE outcome_return_r IS NOT NULL OR shadow_outcome_return_r IS NOT NULL
             ORDER BY captured_at DESC
            """)
        for symbol, interval, capturada, real, sombra in cur.fetchall():
            agrupado.setdefault(f"{symbol}:{interval}", []).append(
                {
                    "outcome_return_r": real,
                    "shadow_outcome_return_r": sombra,
                    "captured_at": capturada,
                }
            )
            # Cada decisión cerrada aporta una R a la población, venga del desenlace real o del de
            # sombra. Nunca las dos: una fila concreta es una cosa o la otra.
            valor = real if real is not None else sombra
            if valor is not None and isinstance(capturada, datetime):
                pob_rs.append(float(valor))
                pob_ts.append(capturada)
    return agrupado, Poblacion(pob_rs, pob_ts)


def estado_previo(politica: dict[str, Any], clave: str, interval: str, actuales: list[str]) -> bool:
    """¿Está vetada esta clave AHORA MISMO? Yaml (por temporalidad) ∪ artefacto (por clave).

    El fallo que esto corrige (22 ago 2026)
    ----------------------------------------
    `publish` decidía a qué expediente mirar con `interval in actuales`, es decir con la lista del
    `ensemble.yaml`, **que es por temporalidad**. Pero quien veta de verdad en la plataforma es
    `quarantine.json`, **que es por clave `SÍMBOLO:intervalo`** — así lo lee `quarantine.ts`.

    Consecuencia, medida: una clave que entraba en cuarentena por su rendimiento real dejaba de
    generar `outcome_return_r` —una temporalidad vetada solo produce sombra—, así que su expediente
    real se congelaba en las decisiones de antes del veto. Y como su temporalidad no figuraba en el
    yaml, el gobierno la seguía juzgando con ESE expediente congelado y la recondenaba cada ciclo
    con las mismas filas. **Jamás llegaba a la puerta de salida.**

    Es exactamente el fallo que la migración 017 arregló para 4h, reaparecido en el eje
    `SÍMBOLO:intervalo`: «una medida temporal, irreversible por construcción». El 22 de agosto de
    2026 había 11 claves vetadas acumuladas en seis días, 6 de ellas atrapadas así, y ninguna había
    salido nunca. La plataforma se estaba apagando sola.

    El yaml es un SUELO, no un techo
    ---------------------------------
    Quitar una temporalidad de `quarantine_intervals` ya no levanta su cuarentena: quien esté vetado
    en el artefacto sigue vetado hasta demostrar la salida con su expediente sombra. Es deliberado
    —una cuarentena se levanta con evidencia, no editando un fichero— y la vía manual, si algún día
    hiciera falta, es borrar la entrada del artefacto.

    Sin artefacto, o con uno ilegible, manda el yaml: exactamente el comportamiento anterior.
    """
    if interval in actuales:
        return True
    entrada = (politica.get("intervals") or {}).get(clave)
    return bool(entrada.get("quarantined")) if isinstance(entrada, dict) else False


def publish(artifacts: Path, dsn: str, actuales: list[str]) -> dict[str, Any]:
    """Revisa cada temporalidad y publica `quarantine.json`.

    `actuales` son las temporalidades vetadas según `ensemble.yaml`, pero el estado real de cada
    clave sale de `estado_previo`: el yaml es el suelo y el artefacto manda por encima. De eso
    depende a qué expediente se mira — si está vetada, al sombra (lo que habría hecho); si opera, al
    real (lo que hizo)— y equivocarse ahí deja claves condenadas para siempre.
    """
    datos, poblacion = fetch_expedientes(dsn)
    politica = load_policy(artifacts)
    decisiones: dict[str, dict[str, Any]] = {}
    for clave, filas in datos.items():
        interval = clave.split(":", 1)[1]
        vetada = estado_previo(politica, clave, interval, actuales)
        # Cada caso mira su propio expediente y su propia ventana: la de salida es más larga porque
        # volver a operar exige más pruebas que dejar de hacerlo. Y solo la de salida recibe la
        # población: la nula no puede afectar a la entrada ni por accidente.
        ev = (
            evaluate_shadow(filas, MIN_SAMPLES_SALIDA, poblacion)
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
                # Los tres se guardan aunque la entrada no los use: la diferencia entre «el azar da
                # esto» y «se exigía esto» tiene que poder auditarse desde el artefacto, no
                # reconstruirse. En la entrada salen a 0 y el umbral efectivo coincide con el fijo.
                "nula_mediana": round(float(ev.get("nula_mediana", 0.0)), 4),
                "nula_p95": round(float(ev.get("nula_p95", 0.0)), 4),
                "n_poblacion": int(ev.get("n_poblacion", 0)),
                "bloques_poblacion": int(ev.get("bloques_poblacion", 0)),
                "umbral_salida": round(umbral_salida(ev), 4) if vetada else None,
            },
        }
    return save_policy(artifacts, decisiones)

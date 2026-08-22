"""¿Qué vetos de cuarentena vigentes se sostienen cuando se les pregunta al azar? (Hito A)

Uso:  python -m trademe_quant.run_quarantine_nula [DSN]

La pregunta
-----------
La cuarentena es el **único** módulo de gobierno con poder de veto activo sobre las decisiones, y
hasta el Hito A era el único que no comparaba su umbral con lo que da el azar. El problema no es
teórico: las decisiones que juzgan a una temporalidad se amontonan en el tiempo. `BTCUSDT:15m` entró
en cuarentena con −0,940 R sobre 30 decisiones que caben en **9,8 horas**. Eso puede ser una
temporalidad mala o un mal martes, y la medición anterior no lo distinguía.

Este informe pone cada clave contra su distribución nula: *¿qué expectancy sale de coger n
decisiones cualesquiera de la plataforma, en bloques de 24 h, del mismo periodo?*

Qué gobierna y qué es solo información
---------------------------------------
- **Puerta de salida**: la nula **sí** gobierna desde el Hito A. Se exige **no-inferioridad al
  mercado** — `mediana de la nula + 0,05 R`, con el fijo como suelo. En v0.46.0 se exigió el P95 y
  hubo que corregirlo: sobre una nula muestreada de la propia plataforma, eso es un cupo del 5 %.
- **Puerta de entrada**: la nula **NO** gobierna, a propósito. Exigir significancia para entrar
  dejaría operando temporalidades malas mientras no se demuestre que lo son. Se muestra porque
  responde a la pregunta «¿mala o mal martes?», que es interesante aunque no decida nada.

Qué se considera «vetado» aquí, y por qué no es lo mismo que en `publish`
-------------------------------------------------------------------------
`quarantine_policy.publish` decide a qué expediente mirar con `interval in quarantine_intervals`, es
decir **con la lista del `ensemble.yaml`, que es por temporalidad**. Pero quien veta de verdad en la
plataforma es el artefacto `quarantine.json`, que es **por clave `SÍMBOLO:intervalo`**.

Este informe usa el veto efectivo (artefacto ∪ yaml) porque es el que describe lo que la plataforma
está haciendo. La diferencia entre ambos no es cosmética y el informe la señala con `⚠ ATRAPADA`:
una clave vetada por rendimiento real deja de generar `outcome_return_r`, así que su expediente real
se queda congelado en las decisiones de antes del veto y `publish` la vuelve a condenar con las
mismas filas cada ciclo, sin llegar nunca a mirar su expediente sombra.

Listones fijados antes de ejecutar: P95 para la salida, [P5, P95] para el lado informativo.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta
from typing import Any

import numpy as np

from .ensemble import artifacts_dir, load_ensemble
from .nula import (
    DIAS_POBLACION,
    PERCENTIL_REFERENCIA,
    PERMUTACIONES_ESTUDIO,
    agrupar,
    distribucion_expectancy_bloques,
    marcas_de,
)
from .quarantine_policy import (
    MAX_EXPECTANCY_ENTRADA,
    MIN_EXPECTANCY_SALIDA,
    MIN_SAMPLES_ENTRADA,
    MIN_SAMPLES_SALIDA,
    Poblacion,
    estado_previo,
    fetch_expedientes,
    load_policy,
    umbral_salida,
)

ANCHO = 98


def claves_vetadas(datos: dict[str, list[dict[str, Any]]], politica: dict[str, Any]) -> set[str]:
    """Veto efectivo, delegando en `quarantine_policy.estado_previo`.

    El informe tenía su propia copia de esta regla, y esa duplicación es justo lo que hacía falta
    para que el fallo de las claves atrapadas existiera: el informe sabía leer el artefacto por
    clave y el gobierno no. Con una sola fuente, informe y gobierno no pueden discrepar.
    """
    actuales = [str(x) for x in politica.get("intervals_yaml", [])]
    return {c for c in datos if estado_previo(politica, c, c.split(":", 1)[1], actuales)}


def _ventana(
    filas: list[dict[str, Any]], columna: str, limite: int
) -> tuple[list[float], list[datetime]]:
    usable = [r for r in filas if r.get(columna) is not None][:limite]
    return (
        [float(r[columna]) for r in usable],
        [r["captured_at"] for r in usable if isinstance(r.get("captured_at"), datetime)],
    )


def _recorta(poblacion: Poblacion, fechas: list[datetime]) -> tuple[list[float], list[int]]:
    """La misma población que usa el gobierno: `DIAS_POBLACION` días hasta lo más reciente."""
    fin = max(fechas)
    inicio = min(min(fechas), fin - timedelta(days=DIAS_POBLACION))
    pares = [
        (r, t) for r, t in zip(poblacion.rs, poblacion.instantes, strict=True) if inicio <= t <= fin
    ]
    return [r for r, _ in pares], marcas_de([t for _, t in pares])


def _ficha(
    filas: list[dict[str, Any]], poblacion: Poblacion, columna: str, limite: int
) -> dict[str, Any] | None:
    """Resumen de una ventana con su distribución nula, o `None` si no hay decisiones."""
    rs, fechas = _ventana(filas, columna, limite)
    if not rs or not fechas:
        return None
    pob_rs, pob_marcas = _recorta(poblacion, fechas)
    return {
        "n": len(rs),
        "exp": float(np.mean(rs)),
        "span_h": (max(fechas) - min(fechas)).total_seconds() / 3600.0,
        "bloques_obs": len(agrupar(marcas_de(fechas))),
        "hasta": max(fechas),
        "n_pob": len(pob_rs),
        "bloques_pob": len(agrupar(pob_marcas)),
        "dist": distribucion_expectancy_bloques(
            pob_rs, pob_marcas, len(rs), permutaciones=PERMUTACIONES_ESTUDIO
        ),
    }


def _contra_el_azar(f: dict[str, Any]) -> str:
    """Dónde cae lo observado respecto del azar, con p-valor bilateral.

    Se cuenta la proporción de la nula que iguala o supera lo observado, **empates incluidos**, en
    vez de compararlo con el percentil 5. No es lo mismo, y la diferencia se vio en los datos
    reales: `BNBUSDT:1h` y `SOLUSDT:15m` dan una expectancy de exactamente −0,700 R y el percentil 5
    de su nula cae **también** en −0,700. Comparar con `<` los declaraba «distintas del azar» por un
    residuo de coma flotante, cuando lo que hay ahí es un empate.

    Los desenlaces son casi discretos —casi todo es −1 R o +2 R—, así que los empates no son un caso
    raro de laboratorio: son el caso normal. Un informe que los resuelve por el lado favorable dice
    justo lo que este proyecto no puede permitirse decir.
    """
    dist = f["dist"]
    if dist is None:
        return f"nula no estimable ({f['n_pob']} filas, {f['bloques_pob']} bloques)"
    obs = f["exp"]
    p_bajo = float((dist <= obs).mean())
    p_alto = float((dist >= obs).mean())
    p = min(1.0, 2.0 * min(p_bajo, p_alto))
    p5, p95 = (float(x) for x in np.percentile(dist, [5, 95]))
    return (
        f"azar [{p5:+.4f}, {p95:+.4f}] · p={p:.3f} · "
        f"{'DISTINTA del azar' if p < 0.05 else 'dentro del azar '}"
    )


def informe(
    datos: dict[str, list[dict[str, Any]]],
    poblacion: Poblacion,
    vetadas: set[str],
    intervalos_yaml: set[str],
    politica: dict[str, Any] | None = None,
) -> None:
    print("=" * ANCHO)
    print("CUARENTENA · ¿los vetos distinguen una temporalidad mala de un mal martes?")
    print("=" * ANCHO)
    print(f"  población total        : {len(poblacion.rs)} decisiones cerradas")
    print(f"  ventana de muestreo    : {DIAS_POBLACION} días hasta la más reciente de cada clave")
    print(f"  permutaciones          : {PERMUTACIONES_ESTUDIO:,}")
    print(f"  claves vetadas hoy     : {len(vetadas)} de {len(datos)}")
    print()

    previas = (politica or {}).get("intervals") or {}

    def juzgada_real(clave: str) -> bool:
        """¿El artefacto la juzgó con su expediente REAL estando vetada? Eso es estar atrapada."""
        entrada = previas.get(clave)
        if not isinstance(entrada, dict) or not entrada.get("quarantined"):
            return False
        return (entrada.get("evidence") or {}).get("source") == "real"

    salidas, condenas, entradas = [], [], []
    for clave in sorted(datos):
        filas = datos[clave]
        if clave in vetadas:
            sombra = _ficha(filas, poblacion, "shadow_outcome_return_r", MIN_SAMPLES_SALIDA)
            salidas.append((clave, sombra))
            real = _ficha(filas, poblacion, "outcome_return_r", MIN_SAMPLES_ENTRADA)
            if real is not None:
                # Detector de regresión. Hasta v0.46.0 `publish` elegía expediente con
                # `interval in yaml`, así que una clave vetada cuyo intervalo no figuraba ahí se
                # juzgaba con su expediente real —que ya no crece— y no salía jamás. Desde el
                # destrabe esto debe dar SIEMPRE 0; si vuelve a marcar algo, el fallo ha vuelto.
                real["atrapada"] = clave.split(":", 1)[1] not in intervalos_yaml and juzgada_real(
                    clave
                )
                condenas.append((clave, real))
        else:
            real = _ficha(filas, poblacion, "outcome_return_r", MIN_SAMPLES_ENTRADA)
            if real is not None:
                entradas.append((clave, real))

    _seccion_salida(salidas)
    _seccion_condenas(condenas)
    _seccion_entrada(entradas)


def _seccion_salida(fichas: list[tuple[str, dict[str, Any] | None]]) -> None:
    print("1) PUERTA DE SALIDA — expediente sombra. La nula GOBIERNA desde el Hito A")
    print("-" * ANCHO)
    if not fichas:
        print("  (ninguna clave en cuarentena)\n")
        return
    endurecidas = 0
    for clave, f in fichas:
        if f is None:
            print(f"  {clave:14s} sin una sola decisión sombra evaluada todavía")
            continue
        if f["n"] < MIN_SAMPLES_SALIDA:
            print(
                f"  {clave:14s} n={f['n']:3d}/{MIN_SAMPLES_SALIDA} · aún no puede plantearse salir "
                f"(exp {f['exp']:+.3f} R en {f['span_h']:.1f} h)"
            )
            continue
        dist = f["dist"]
        if dist is None:
            print(
                f"  {clave:14s} n={f['n']:3d} exp={f['exp']:+.3f} R · nula no estimable -> manda "
                f"el fijo {MIN_EXPECTANCY_SALIDA:+.3f}"
            )
            continue
        # La regla vive en `quarantine_policy.umbral_salida`; aquí solo se muestra. Duplicarla es
        # exactamente lo que dejó claves atrapadas la última vez.
        mediana = float(np.percentile(dist, PERCENTIL_REFERENCIA))
        exigido = umbral_salida({"nula_mediana": mediana})
        sale = f["exp"] >= exigido
        endurecidas += 1 if (f["exp"] >= MIN_EXPECTANCY_SALIDA and not sale) else 0
        print(
            f"  {clave:14s} n={f['n']:3d} exp={f['exp']:+.3f} R · mercado típico={mediana:+.3f} · "
            f"exigido={exigido:+.3f} -> {'SALE' if sale else 'SIGUE VETADA'}"
        )
    print()
    print("  El listón es no-inferioridad: la mediana de la nula más 0,05 R, con el fijo como")
    print(f"  suelo. Claves que el ajuste por régimen retiene: {endurecidas}.")
    print()


def _seccion_condenas(fichas: list[tuple[str, dict[str, Any]]]) -> None:
    print("2) ¿SE SOSTIENE EL VETO? — el expediente REAL que condenó a cada clave, contra el azar")
    print("-" * ANCHO)
    print("  Informativo: la puerta de entrada NO usa la nula, a propósito. Pero saber si aquellas")
    print("  decisiones se distinguían del mercado de esos días es justo la pregunta del hito.")
    print()
    if not fichas:
        print("  (ninguna)\n")
        return
    atrapadas = 0
    for clave, f in fichas:
        atrapadas += 1 if f["atrapada"] else 0
        print(
            f"  {clave:14s} n={f['n']:3d} exp={f['exp']:+.3f} R en {f['span_h']:5.1f} h "
            f"({f['bloques_obs']} bloq) · {_contra_el_azar(f)}"
            + ("  ⚠ ATRAPADA" if f["atrapada"] else "")
        )
    if atrapadas:
        print()
        print(f"  ⚠ REGRESIÓN: {atrapadas} claves ATRAPADAS. Están vetadas y aun así se las")
        print("    juzga con su expediente REAL, que ya no crece porque una clave vetada solo")
        print("    produce sombra. Se recondenan cada ciclo con las mismas filas y jamás llegan")
        print("    a la puerta de salida. Se corrigió en v0.47.0 y esto debe dar 0: si aparece,")
        print("    el fallo de la migración 017 ha vuelto por el eje SÍMBOLO:intervalo.")
    else:
        print()
        print("  Sin claves atrapadas: toda clave vetada se juzga con su expediente sombra, que")
        print("  sí crece, así que todas tienen camino de vuelta. Corregido en v0.47.0.")
    print()


def _seccion_entrada(fichas: list[tuple[str, dict[str, Any]]]) -> None:
    print("3) PUERTA DE ENTRADA — las que operan. La nula NO gobierna aquí")
    print("-" * ANCHO)
    print("  Una temporalidad que pierde pero NO se distingue del azar puede estar teniendo un mal")
    print("  martes; entra en cuarentena igual, y es lo correcto: retener es el lado barato.")
    print()
    for clave, f in fichas:
        entra = f["n"] >= MIN_SAMPLES_ENTRADA and f["exp"] <= MAX_EXPECTANCY_ENTRADA
        print(
            f"  {clave:14s} n={f['n']:3d} exp={f['exp']:+.3f} R en {f['span_h']:5.1f} h "
            f"({f['bloques_obs']} bloq) · {_contra_el_azar(f)} · "
            f"{'ENTRARÍA' if entra else 'opera'}"
        )
    print()


def main() -> None:
    dsn = (
        sys.argv[1]
        if len(sys.argv) > 1
        else os.environ.get("DATABASE_URL", "postgresql://trademe:trademe@localhost:5432/trademe")
    )
    artifacts = artifacts_dir()
    datos, poblacion = fetch_expedientes(dsn)
    politica = load_policy(artifacts)
    yaml = {
        str(x) for x in load_ensemble(artifacts / "ensemble.yaml").get("quarantine_intervals", [])
    }
    politica["intervals_yaml"] = sorted(yaml)
    informe(datos, poblacion, claves_vetadas(datos, politica), yaml, politica)


if __name__ == "__main__":
    main()

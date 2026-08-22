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
- **Puerta de salida**: la nula **sí** gobierna desde el Hito A. Se exige `max(0,05 R, P95)`. Solo
  endurece.
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
    fetch_expedientes,
    load_policy,
)

ANCHO = 98


def claves_vetadas(datos: dict[str, list[dict[str, Any]]], politica: dict[str, Any]) -> set[str]:
    """Veto efectivo: lo que dice el artefacto, más lo que dice el yaml por temporalidad."""
    intervalos = {str(x) for x in politica.get("intervals_yaml", [])}
    vetadas = {
        clave
        for clave, entrada in (politica.get("intervals") or {}).items()
        if isinstance(entrada, dict) and entrada.get("quarantined")
    }
    vetadas |= {c for c in datos if c.split(":", 1)[1] in intervalos}
    return vetadas


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
    """Dónde cae lo observado dentro del [P5, P95] del azar."""
    dist = f["dist"]
    if dist is None:
        return f"nula no estimable ({f['n_pob']} filas, {f['bloques_pob']} bloques)"
    p5, p95 = (float(x) for x in np.percentile(dist, [5, 95]))
    fuera = f["exp"] < p5 or f["exp"] > p95
    # Cuatro decimales y no tres: varias claves rozan el P5 por milésimas, y con tres el intervalo
    # se imprimía idéntico a lo observado mientras el veredicto decía «distinta». Parecía un fallo.
    return (
        f"azar [{p5:+.4f}, {p95:+.4f}] · " f"{'DISTINTA del azar' if fuera else 'dentro del azar '}"
    )


def informe(
    datos: dict[str, list[dict[str, Any]]],
    poblacion: Poblacion,
    vetadas: set[str],
    intervalos_yaml: set[str],
) -> None:
    print("=" * ANCHO)
    print("CUARENTENA · ¿los vetos distinguen una temporalidad mala de un mal martes?")
    print("=" * ANCHO)
    print(f"  población total        : {len(poblacion.rs)} decisiones cerradas")
    print(f"  ventana de muestreo    : {DIAS_POBLACION} días hasta la más reciente de cada clave")
    print(f"  permutaciones          : {PERMUTACIONES_ESTUDIO:,}")
    print(f"  claves vetadas hoy     : {len(vetadas)} de {len(datos)}")
    print()

    salidas, condenas, entradas = [], [], []
    for clave in sorted(datos):
        filas = datos[clave]
        if clave in vetadas:
            sombra = _ficha(filas, poblacion, "shadow_outcome_return_r", MIN_SAMPLES_SALIDA)
            salidas.append((clave, sombra))
            real = _ficha(filas, poblacion, "outcome_return_r", MIN_SAMPLES_ENTRADA)
            if real is not None:
                # `publish` juzga por `interval in yaml`. Una clave vetada cuyo intervalo NO está en
                # esa lista se sigue juzgando con el expediente real, que ya no crece: atrapada.
                real["atrapada"] = clave.split(":", 1)[1] not in intervalos_yaml
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
        p95 = float(np.percentile(dist, 95))
        exigido = max(MIN_EXPECTANCY_SALIDA, p95)
        salia_antes = f["exp"] >= MIN_EXPECTANCY_SALIDA
        sale_ahora = f["exp"] >= exigido
        endurecidas += 1 if (salia_antes and not sale_ahora) else 0
        print(
            f"  {clave:14s} n={f['n']:3d} exp={f['exp']:+.3f} R · azar P95={p95:+.3f} · "
            f"exigido={exigido:+.3f} -> {'SALE' if sale_ahora else 'SIGUE VETADA'}"
            + ("  (antes salía)" if salia_antes and not sale_ahora else "")
        )
    print()
    print(f"  Vetos que la nula endurece: {endurecidas}. Ninguna clave SALE por este cambio, por")
    print("  construcción: el umbral de salida solo puede subir.")
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
        print(
            f"  ⚠ {atrapadas} claves ATRAPADAS. Están vetadas por el artefacto, pero su intervalo"
        )
        print("    no figura en `quarantine_intervals` del yaml, que es lo que `publish` consulta")
        print("    para elegir expediente. Se las sigue juzgando con el REAL — que ya no crece,")
        print("    porque una clave vetada solo produce sombra— así que se recondenan cada ciclo")
        print("    con las mismas filas y jamás llegan a la puerta de salida.")
        print("    Es el fallo de la migración 017 reaparecido en el eje SÍMBOLO:intervalo, y es")
        print("    un problema APARTE del Hito A: no lo arregla ni lo empeora.")
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
    informe(datos, poblacion, claves_vetadas(datos, politica), yaml)


if __name__ == "__main__":
    main()

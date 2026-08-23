"""Revisión del Analista de Niveles con el criterio vigente (ΔAUC contra su nula).

Uso: python -m trademe_quant.run_levels_revision <snapshots.csv> [SIMBOLO ...]

Por qué se reabre un expediente cerrado
---------------------------------------
La Fase 0 del Analista de Niveles se cerró en negativo apoyándose en un listón que
**resultó ser imposible de cruzar para cualquier variable real**: superar el percentil 95 de 200
columnas de ruido en lift de votos efectivos. Ninguno de los seis votos en producción lo pasa, y
una columna perfectamente ortogonal por Gram-Schmidt lo supera por 0,001 — un 0,2 %. Ver
`informacion.py` y `docs/cvd-fase0.md`.

Un veredicto apoyado en un instrumento roto no vale ni para condenar ni para absolver. Este script
vuelve a juzgar al detector con el criterio que sustituyó a aquel — **y con el criterio ya escrito y
calibrado antes de mirar estos datos**, que es lo que hace legítima la revisión. Reabrirlo diseñando
la regla a la vez habría sido elegir el criterio mirando el resultado.

Lo que NO cambia respecto al veredicto original
------------------------------------------------
El cierre de aquel hito se apoyaba en dos patas: la independencia (rota) y el poder predictivo, que
no alcanzaba significancia en ninguna temporalidad. **Esta revisión solo repone la primera.** Si el
detector sigue sin aportar información, el expediente queda cerrado con datos limpios; si aporta, lo
que procede no es darle voto sino rehacer la Fase 0 entera con muestra actual.

Un fallo latente que se corrige de paso
----------------------------------------
`run_levels_study.cargar` no filtra por símbolo: cuando se escribió, el CSV era de un solo activo.
Con el multiactivo, ejecutarlo tal cual cruzaría snapshots de ETH con velas de BTC. Aquí se filtra.
"""

from __future__ import annotations

import sys
from collections import defaultdict
from datetime import UTC, datetime

import numpy as np

from .informacion import MIN_DELTA_AUC, aporta_informacion, auc_fuera_de_muestra
from .levels import WINDOW
from .nula import marcas_de
from .run_cvd_study import VOTOS_ACTUALES, Fila, cargar
from .run_levels_study import MS_POR_INTERVALO, _klines, score_en

#: Permutaciones de la nula. Las mismas que usó la revisión del CVD, para poder comparar.
PERMUTACIONES = 200
#: Decisiones cerradas mínimas para que el veredicto tenga potencia. Por debajo, el AUC fuera de
#: muestra oscila tanto que el test no distingue nada — se midió en la Fase 0 del CVD.
MIN_MUESTRA_GLOBAL = 160
#: Las dos lecturas del detector, las mismas que se juzgaron en la Fase 0 original.
METRICAS = ("score de niveles", "distancia al nivel")


def recoger(filas: list[Fila], simbolos: list[str]) -> list[tuple[Fila, float, float]]:
    """Calcula el score de niveles de cada decisión cerrada, sin mirar velas del futuro."""
    por_clave: dict[tuple[str, str], list[Fila]] = defaultdict(list)
    for f in filas:
        if f.retorno_r is not None and f.interval in MS_POR_INTERVALO and f.symbol in simbolos:
            por_clave[(f.symbol, f.interval)].append(f)

    out: list[tuple[Fila, float, float]] = []
    for (sym, iv), fs in sorted(por_clave.items()):
        ms = MS_POR_INTERVALO[iv]
        desde = min(f.captured_ms for f in fs) - (WINDOW + 10) * ms
        hasta = max(f.captured_ms for f in fs) + ms
        velas = _klines(sym, iv, desde, hasta)
        n = 0
        for f in fs:
            r = score_en(velas, f.captured_ms)
            if r is not None:
                out.append((f, r[0], r[1]))
                n += 1
        print(f"  {sym}:{iv:4s} -> {n} de {len(fs)} decisiones cerradas con nivel calculable")
    return out


def revisar(recogido: list[tuple[Fila, float, float]]) -> None:
    recogido.sort(key=lambda t: t[0].captured_ms)
    print()
    print("=" * 86)
    print("ANALISTA DE NIVELES · REVISIÓN con el criterio vigente (ΔAUC contra su nula)")
    print("=" * 86)
    if len(recogido) < MIN_MUESTRA_GLOBAL:
        print(f"  solo {len(recogido)} decisiones cerradas con nivel: sin potencia para juzgarlo.")
        print("  El expediente NO se puede cerrar con datos limpios todavía.\n")
        return

    votos = [[f.votos[i] for f, _, _ in recogido] for i in range(len(VOTOS_ACTUALES))]
    y = [1 if float(f.retorno_r or 0.0) > 0 else 0 for f, _, _ in recogido]
    marcas = marcas_de([datetime.fromtimestamp(f.captured_ms / 1000, UTC) for f, _, _ in recogido])
    series = {
        "score de niveles": [s for _, s, _ in recogido],
        "distancia al nivel": [d for _, _, d in recogido],
    }

    print(
        f"  n = {len(recogido)} decisiones cerradas  ·  {len(set(marcas))} bloques de 24 h  ·  "
        f"ganadoras {sum(y) / len(y):.1%}"
    )
    base = auc_fuera_de_muestra(np.asarray(votos, dtype=float).T, np.asarray(y), 5)
    print(f"  AUC fuera de muestra con los seis votos: {base:.4f}")
    print(f"  se exige superar la nula y mejorar al menos {MIN_DELTA_AUC} de AUC\n")
    print(
        f"  {'columna':20s} {'AUC 6':>8s} {'AUC 7':>8s} {'delta':>9s} {'nula p95':>10s}  veredicto"
    )
    print("  " + "-" * 76)

    aprobados = 0
    for nombre in METRICAS:
        a = aporta_informacion(votos, series[nombre], y, marcas, permutaciones=PERMUTACIONES)
        aprobados += 1 if a.aporta else 0
        print(
            f"  {nombre:20s} {a.auc_base:8.4f} {a.auc_ampliado:8.4f} {a.delta:+9.4f} "
            f"{a.nula_p95:+10.4f}  {'APORTA' if a.aporta else 'no aporta'}"
        )

    resto = [c for i, c in enumerate(votos) if i != 2]
    ref = aporta_informacion(resto, votos[2], y, marcas, permutaciones=PERMUTACIONES)
    print()
    print("  referencia — el voto en producción que más se acerca a aportar:")
    print(
        f"  {'supertrend':20s} {ref.auc_base:8.4f} {ref.auc_ampliado:8.4f} {ref.delta:+9.4f} "
        f"{ref.nula_p95:+10.4f}  {'APORTA' if ref.aporta else 'no aporta'}"
    )
    print("  (ni él aporta de forma estable: el criterio está demostrado para suspender, no para")
    print("   aprobar. Ver `informacion.py`.)")

    print()
    print("=" * 86)
    print("VEREDICTO")
    print("=" * 86)
    if aprobados == 0:
        print("  El Analista de Niveles NO aporta información sobre el desenlace por encima de los")
        print("  seis votos, con el criterio vigente y promediando sobre seis esquemas de")
        print("  validación. El cierre de su Fase 0 se sostiene.")
        print()
        print("  Matiz honesto: se sostiene porque sus dos lecturas quedan en cero o por debajo,")
        print("  no porque el instrumento haya demostrado que sabría detectar un aporte real —")
        print("  ninguna columna de referencia da positivo de forma estable con esta muestra.")
        print()
        print("  `levels.py` se queda como estaba: biblioteca medida, sin votar y sin")
        print("  importarse desde ningún camino de decisión. Expediente cerrado.")
    else:
        print(f"  {aprobados} de {len(METRICAS)} lecturas APORTAN información. El cierre de la")
        print("  Fase 0 se apoyaba en un instrumento roto y con el bueno el veredicto cambia.")
        print()
        print("  Lo que procede NO es darle voto: es rehacer la Fase 0 entera con muestra")
        print("  actual, incluida la expectancy por tercil, que aquí no se ha vuelto a medir.")
    print()


def main() -> None:
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(2)
    filas = cargar(sys.argv[1])
    simbolos = sys.argv[2:] or sorted({f.symbol for f in filas})
    print(f"snapshots cargados: {len(filas)}   ·   activos: {', '.join(simbolos)}")
    revisar(recoger(filas, simbolos))


if __name__ == "__main__":
    main()

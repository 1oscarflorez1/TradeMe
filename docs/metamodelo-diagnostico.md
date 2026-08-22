# Diagnóstico del meta-modelo — no estaba invertido, no aprende

> Medido el 22 de agosto de 2026 sobre 785 decisiones evaluadas de cuatro activos.
> **El hito termina en la Fase A**, y con un hallazgo que va más allá del meta-modelo.

## Qué se investigaba

El meta-modelo llevaba meses en sombra y su confianza parecía **anti-correlacionada** con el
resultado: AUC 0,46, y en BTCUSDT el tercil de menor confianza rendía +0,195 R frente a −0,168 R el
de mayor, con la dirección repetida en las cuatro temporalidades medibles (t de Welch 2,82).

Parecía un modelo con el signo del revés. La pregunta era por qué.

## La respuesta: no hay inversión

Antes de buscar causas había que descartar la más simple: **que fuera ruido**.

| | |
|---|---|
| AUC observado (con reparto correcto) | **0,4967** |
| Nulo, 10.000 barajadas del test | [0,4216 – 0,5796] |
| Veredicto | **DENTRO** · p = **0,942** |

Azar puro. El 0,46 de partida venía de un reparto y una muestra distintos; con 785 filas y el
reparto en tres tramos, la ordenación del modelo es indistinguible de barajar las etiquetas.

La segunda prueba —permutar **y reentrenar**, 300 veces, para juzgar el procedimiento entero y no
solo el modelo entrenado— dice lo mismo:

| Métrica | Nulo (percentil 5–95) | Observado | |
|---|---|---|---|
| AUC | [0,163 – 0,842] | 0,497 | dentro |
| lift | [−0,469 – +0,816] | +0,260 | dentro |

**No hay un modelo invertido que arreglar. Hay un modelo que no aprende.**

Y eso reorienta: lo que falta no es afinar el bosque, es conseguir features que no deriven todas del
mismo precio. Las 15 actuales salen de seis votos que valen **1,41 efectivos** — en realidad son
unas dos dimensiones, y ningún modelo extrae de ahí lo que no hay.

## El hallazgo que va más allá

Mira la fila del lift en la tabla de arriba. El nulo tiene **media +0,083 R** y llega a **+0,816 R**
en el percentil 95.

Es decir: **un modelo entrenado con etiquetas barajadas produce, de media, un lift positivo mayor
que el umbral que exigimos para promocionarlo** (0,05 R).

La causa es mecánica: el filtro conserva pocas señales —32 de 157 en la medición— y con muestras
pequeñas quedarse con un subconjunto produce mejoras aparentes por azar. Cuanto más agresivo el
filtro, más fácil que parezca bueno sin serlo.

Lo mismo ocurre con el AUC: exigir ≥ 0,55 tampoco protege, porque el percentil 95 del azar llega a
0,84 cuando se reentrena.

**Es el mismo tipo de fallo que el control de ruido destapó en los votos efectivos**: un criterio
que parece riguroso y que el azar supera con facilidad. Dos veces ya en este proyecto.

### Qué implica y qué NO se ha cambiado

Los umbrales `lift ≥ 0,05 R` y `AUC ≥ 0,55` gobiernan **el meta-modelo y el Fundamental Score**.
Ninguno de los dos ha promocionado nunca, así que no ha habido consecuencia práctica — pero el
listón, tal como está, no distingue mérito de suerte.

**No se han tocado en este hito**, porque cambiarlos afecta al gobierno de dos componentes y es una
decisión que merece tomarse aparte, con su medición propia para el Fundamental Score (cuya
penalización viene de una fórmula fija y tendrá una distribución nula distinta, seguramente más
estrecha).

## Lo que sí se corrigió

`train_metamodel` elegía el umbral **mirando el conjunto de prueba**:

```python
threshold = pick_threshold(probs_te, r_te)          # se optimiza en el test...
filtered, kept = expectancy_with_filter(probs_te, r_te, threshold)
improves = filtered > baseline and ...              # ...y se juzga con el mismo test
```

La mejora salía inflada por construcción, y el `threshold` publicado —el que usa el gobierno en
producción— venía ajustado a datos que ya había visto.

Ahora hay **tres tramos**: entrenamiento · selección · prueba. El umbral se elige en el del medio y
solo se juzga en el último.

## Cómo reproducirlo

```bash
python -m trademe_quant.run_metamodel_diagnostico <meta.csv>
```

El CSV se exporta con las columnas de `SNAPSHOT_COLUMNS` sobre `outcome_result IN ('tp','sl')`,
deduplicando por `(symbol, interval, candle_open)`.

## Qué NO se hizo, a propósito

**Invertir el modelo.** Era la tentación obvia cuando parecía anti-correlacionado, y habría sido
exactamente el ajuste post-hoc que este proyecto evita: elegir el criterio mirando el desenlace. La
medición dice además que no habría funcionado — no hay señal que invertir.

## Relacionado

- [metamodelo.md](metamodelo.md) — qué es y cómo se gobierna
- [independencia.md](independencia.md) — por qué seis votos son 1,41, y el control de ruido
- [correlaciones.md](correlaciones.md) — la misma idea aplicada a las observaciones

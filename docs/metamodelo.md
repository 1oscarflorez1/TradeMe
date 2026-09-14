# Meta-modelo (Módulo 2) — inferencia en vivo

> **Retirado en 0.74.0.** Ni el piloto lo reentrena ni la api lo aplica (`metamodel.enabled: false`
> en `ensemble.yaml`). En walk-forward no supera al azar y pierde contra una regla que solo mira qué
> dirección ganó la semana pasada. Ver [Retirado](#retirado-0740) al final. El resto del documento
> describe cómo funcionaba y cómo funcionaría si se reactivara.

> Decisión de arquitectura: **el entrenamiento vive 100 % en Python** (`apps/quant`); el motor en
> vivo (Node) solo **evalúa** un artefacto plano publicado. Sin dependencias nativas, sin salto de
> red y con paridad Node≡Python verificada en CI. Es el mismo patrón que ya usan `ensemble.yaml` y
> `calibrators.json`.

## Por qué NO se hace la inferencia en Python en vivo

En TradeMe **la señal nace en Node**: el adaptador recibe las velas por WebSocket y `buildSignal`
decide en milisegundos para cada símbolo y temporalidad. `apps/quant` es el gemelo *offline*
(backtest, optimización, entrenamiento) y no participa en el camino en vivo.

Mover la inferencia a Python obligaría a que cada vela hiciera un salto de red a un servicio de lotes
(que a ratos está ocupado 1 minuto optimizando con Optuna), añadiría latencia al streaming y
convertiría a `quant` en dependencia crítica de tiempo real: hoy, si `quant` cae, las señales siguen
funcionando y solo se pierden backtest/optimización.

## Por qué NO `onnxruntime-node`

Es una dependencia **nativa** (bindings C++): engorda la imagen, complica ARM/x86 y añade
fragilidad al despliegue. Un RandomForest es un conjunto de árboles: serializarlo a JSON y recorrerlo
en TypeScript son ~30 líneas, microsegundos por señal y cero riesgo de compilación. El `.onnx` se
sigue exportando como formato estándar para futuros consumidores (móvil, otros servicios).

## Flujo

```
snapshots evaluados ──▶ apps/quant (entrena, valida, decide si publica)
                              │  metamodel.json  (+ metamodel.onnx)
                              ▼
                        apps/api  ──recarga sola (≤15 s)──▶  evalúa por señal ──▶ Panel / WS / DB
```

## Modos (`META_MODE`)

| Modo | Qué hace | Cuándo usarlo |
|---|---|---|
| `off` | No se calcula. | Desactivar por completo. |
| `shadow` | Calcula `meta_confidence` y lo guarda/muestra, **sin afectar la decisión**. | **Por defecto.** Para validar con tus propios registros que el filtro acierta antes de darle poder. |
| `modulate` | La confianza final combina ensemble y meta-modelo (`META_MODULATE_WEIGHT`). | Cuando el modo sombra demuestre valor. |
| `veto` | Además **descarta** (pasa a MANTENER/FLAT) las señales por debajo de `META_VETO_THRESHOLD`. | Cuando el meta-modelo sea sólido y quieras que filtre de verdad. |

El umbral de veto por defecto es `0.5` y el modelo publica su propio umbral óptimo (calculado por
expectancy en validación) en el artefacto, como referencia.

## Ascenso automático de modo (el sistema decide cuándo confiar)

No hace falta cambiar el modo a mano. El piloto **evalúa el modo sombra con decisiones reales ya
cerradas** (compara lo que pasó con lo que habría pasado filtrando) y asciende solo cuando hay
evidencia:

| Paso | Requisitos |
|---|---|
| `shadow` → `modulate` | ≥40 decisiones evaluadas con predicción, mejora ≥ 0,05 R, AUC ≥ 0,55 y que el filtro conserve ≥25 % de las señales |
| `modulate` → `veto` | Lo anterior sostenido con ≥100 decisiones |
| **Permanencia** | Con muestra suficiente, quien ya tiene poder debe **seguir cumpliendo** lo mismo que se le exigió para tenerlo (mejora ≥ 0,05 R **y** AUC ≥ 0,55). Si deja de cumplirlo, baja un escalón. |

### El fallo que corrigió M10.5

Hasta la versión 0.34.0 el guardián de salida era más laxo que el de entrada: para **ascender** se
exigía AUC ≥ 0,55, pero para **permanecer** solo se miraba que el lift no cayera por debajo de
−0,05 R. El AUC no se volvía a comprobar nunca.

El 11 de agosto de 2026 eso tenía al meta-modelo en modo `modulate` —modulando la confianza de las
decisiones en vivo— con **AUC 0,43**, es decir, ordenando ganadores y perdedores *peor que una
moneda*. Su propio artefacto lo decía («aún no demuestra ventaja»), y aun así conservaba el poder,
porque su lift era −0,005 R y no llegaba al umbral de retroceso.

Un umbral que solo se comprueba al ascender no es un umbral: es un peaje de entrada. Ahora la
condición de permanencia repite la de ascenso. **Si un componente deja de cumplir lo que se le exigió
para darle poder, lo pierde.** Es la regla que gobernará también a los agentes del consejo (M13).

La decisión se publica en `artifacts/meta_policy.json` y se avisa por la campana. La variable
`META_MODE` pasa a ser un **tope de seguridad**: la automatización nunca sube por encima de él
(ponlo en `shadow` si quieres que jamás influya, o en `modulate` para que nunca vete).

### Un AUC de 0,30 no es un fallo del modelo (14-sep-2026)

Reentrenado tras la reescritura del histórico y el arreglo de los horizontes (904 filas, frente a 627
del publicado el 5-sep), el meta-modelo dio **AUC 0,30** en su tramo de prueba. Por debajo de 0,5 no
es «sin señal»: ordena al revés, así que se diagnosticó antes de darlo por bueno. En solo lectura,
entrenando en memoria:

| | AUC en prueba |
|---|---|
| Como lo entrena el piloto | 0,30 |
| Mismos datos sin filtro de reproducibilidad | 0,38 |
| Con las etiquetas de antes de la reescritura, sin filtro | 0,39 |
| Solo la feature «es largo», en el tramo de prueba | **0,24** |
| Solo el voto neto, en el tramo de prueba | 0,29 |

- **La reescritura no lo causó**: con las etiquetas anteriores el modelo también ordena al revés.
- **Es la dirección del mercado.** El modelo entrenó con julio y agosto y se juzgó del 7 al 12 de
  septiembre. En ese tramo ganaron los cortos, y la feature «es largo» sola predice al revés con AUC
  0,24. Lo que el bosque aprende es la deriva direccional del periodo de entrenamiento, que es
  exactamente lo que ya se midió en [`habilidad-direccional.md`](habilidad-direccional.md): la
  plataforma no tiene habilidad direccional, sigue la deriva.
- **Y entrena con lo que ya no opera**: de las 632 filas de entrenamiento, 496 son de 15m y 30m y solo
  23 de 1d, la única temporalidad que opera desde 0.70.0.

El gobierno hizo lo que debía: no publicó el modelo y mantiene el modo en `shadow`. Pero un solo
corte temporal no basta para decidir, así que se repitió la pregunta semana a semana: ver
[Retirado](#retirado-0740).

## Campos en la señal

- `meta_confidence` — probabilidad de éxito estimada (0–1).
- `meta_version`, `meta_mode`, `meta_vetoed`.

En el Panel aparece como un chip 🧠 junto a la decisión.

## Paridad

`predictForest` (Node) y `predict_forest` (Python) se verifican con vectores dorados en
`packages/core-signals/parity/macro_vectors.json` → sección `metamodel`. Si divergen, CI falla.

## Retirado (0.74.0)

### La pregunta y la regla, antes de medir

¿Ordena el meta-modelo las decisiones mejor que el azar, en las condiciones en que lo usaría el
piloto? `trademe_quant.run_metamodelo_estudio` lo mide en **walk-forward semanal**: cada semana se
juzga con un modelo entrenado solo con las anteriores, con el mismo bosque y el mismo procedimiento
de umbral que producción. Usa desenlaces reales y de sombra —las decisiones vetadas también se
tomaron, con las mismas features—, una fila por vela (primera captura), solo reproducibles y en R
neta.

La regla se fijó **antes** de ver ningún número. Se queda solo si cumple las tres:

1. AUC agregada ≥ 0,55, el mismo listón que su gobierno exige para ascender.
2. Mejora de expectancy filtrando por encima del P95 del azar filtrando las mismas operaciones, por
   bloques diarios.
3. AUC ≥ 0,55 **dentro de cada dirección**. Si solo ordena mezclando largos y cortos, lo que ordena
   es la deriva del mercado.

### Lo medido (14-sep-2026)

6 semanas, 3.937 decisiones y 3.027 TP/SL juzgadas fuera de muestra:

| | meta-modelo | listón |
|---|---|---|
| AUC agregada | **0,528** | ≥ 0,55; el azar alcanza 0,535 |
| Mejora de expectancy filtrando | **−0,022 R** | > +0,139, el P95 del azar |
| AUC solo en largos | 0,580 | ≥ 0,55 |
| AUC solo en cortos | **0,523** | ≥ 0,55 |
| Referencia: «la dirección que ganó la semana pasada» | **0,562** | — |

No cumple ninguna. Y lo más elocuente es la última fila: una regla de una línea que solo sabe qué
dirección ganó la semana anterior ordena mejor que el bosque. Filtrar con él **empeora** la
expectancy.

La única AUC alta por temporalidad es la de 4h, 0,69 con 128 filas: una de siete comparaciones, con
muestra corta, en una temporalidad que no opera. No es base para reactivar nada.

Encaja con lo que ya decían [`metamodelo-diagnostico.md`](metamodelo-diagnostico.md) —no estaba
invertido, no aprende— y [`habilidad-direccional.md`](habilidad-direccional.md): no hay habilidad
direccional que filtrar, hay deriva.

### Qué cambia

- **El piloto** no reentrena el meta-modelo ni evalúa su sombra ni gobierna su modo. Lo dice en el
  log: `meta-modelo retirado (metamodel.enabled: false)`.
- **La api** lo aplica en modo `off`: no calcula `meta_confidence`, no aparece el chip 🧠 y `/status`
  lo marca como desactivado. El **Laboratorio** muestra «Meta-modelo retirado» en lugar del modo y de
  las horas desde el último reentrenamiento (desde 0.74.1: antes seguía enseñando «sombra»). La bandera se lee del yaml, que la api recarga sola, así que el cambio
  no necesita reinicio.
- **No se borra nada**: ni el código, ni el último artefacto publicado, ni `meta_policy.json`.

### Cómo reactivarlo

Repetir el estudio con más histórico y, **solo si cumple la regla de arriba**, poner
`metamodel.enabled: true`. Relajar la regla después de ver el resultado sería el mismo sesgo que
retiró las configuraciones optimizadas.

```
docker exec trademe-prod-quant-1 python -m trademe_quant.run_metamodelo_estudio
```


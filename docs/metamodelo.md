# Meta-modelo (Módulo 2) — inferencia en vivo

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
                        apps/api  ──POST /reload──▶  evalúa por señal ──▶ Panel / WS / DB
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

## Campos en la señal

- `meta_confidence` — probabilidad de éxito estimada (0–1).
- `meta_version`, `meta_mode`, `meta_vetoed`.

En el Panel aparece como un chip 🧠 junto a la decisión.

## Paridad

`predictForest` (Node) y `predict_forest` (Python) se verifican con vectores dorados en
`packages/core-signals/parity/macro_vectors.json` → sección `metamodel`. Si divergen, CI falla.

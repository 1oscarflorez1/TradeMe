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

## Campos en la señal

- `meta_confidence` — probabilidad de éxito estimada (0–1).
- `meta_version`, `meta_mode`, `meta_vetoed`.

En el Panel aparece como un chip 🧠 junto a la decisión.

## Paridad

`predictForest` (Node) y `predict_forest` (Python) se verifican con vectores dorados en
`packages/core-signals/parity/macro_vectors.json` → sección `metamodel`. Si divergen, CI falla.

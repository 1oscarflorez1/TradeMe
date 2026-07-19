# Optimización de pesos (M7 · Slice B)

> Objetivo: **validación antes que optimización**. Buscar los pesos del ensemble que mejoran la
> ventaja estadística, pero midiéndolos out-of-sample y promocionándolos **solo si ganan en un tramo
> hold-out** nunca usado en la búsqueda. Así se evita el sobreajuste.

## Cómo funciona

1. **Espacio de búsqueda:** pesos de los 7 indicadores (los 5 que votan) y los multiplicadores por
   régimen (`tendencia` / `rango`), en el rango `[0, 2]`.
2. **Optuna (TPE):** propone combinaciones de pesos de forma bayesiana (más eficiente que grid/random).
3. **Walk-forward con purga/embargo** (`walkforward.py`): la serie se parte en bloques temporales
   (expanding). Un trade solo cuenta para la validación si cae **completo** dentro de un bloque de
   test (purga del horizonte de etiqueta) y respeta el **embargo** entre bloques. Sin fuga temporal.
4. **Métrica objetivo:** **expectancy penalizada** = expectancy media en validación − penalización de
   complejidad (desviación de los pesos respecto a 1.0) − castigo si hay menos del mínimo de trades.
5. **Gating por hold-out:** al final se compara el candidato contra el ensemble base en el **30 %
   final** reservado. Solo se promociona si su expectancy en hold-out supera a la del base.

## Flujo de artefactos

```
apps/quant ──run_optimize──► artifacts/ensemble.optimized.yaml (+ optimization_report.json)
           └───────────────► apps/api (carga el optimizado por delante del base) ──► POST /reload
```

1. Optimizar:

   ```bash
   docker compose -f infra/docker-compose.yml run --rm quant \
     python -m trademe_quant.run_optimize BTCUSDT 5m
   ```

   Imprime el veredicto (base vs optimizado en hold-out). Si gana, escribe
   `artifacts/ensemble.optimized.yaml`; siempre escribe `artifacts/optimization_report.json`.

2. Recargar en la API (sin reiniciar):

   ```bash
   curl -X POST http://localhost:3001/reload
   ```

   La API carga `ensemble.optimized.yaml` por delante del base si existe. `GET /ensemble` devuelve la
   versión activa y el informe (comparador base vs optimizado, visible en la pestaña Backtest).

## Parámetros (env del CLI)

- `OPTUNA_TRIALS` (por defecto 60): número de trials de búsqueda.
- `ENSEMBLE_CONFIG`, `OPTIMIZED_ENSEMBLE`, `OPT_REPORT_PATH`: rutas de artefactos.

## Notas

- No cambia el **contrato** ni la matemática de la decisión: solo produce otro `ensemble.yaml` (mismos
  campos, distintos valores), que Node y Python leen igual. La paridad de la decisión sigue vigente.
- El **meta-modelo ONNX** (LogReg/LightGBM) queda para un **M7.x** posterior; se promocionaría con el
  mismo criterio: solo si gana en hold-out.

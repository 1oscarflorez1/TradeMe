# Calibración de probabilidades (M7 · Slice A)

> Objetivo: **honestidad estadística**. Que cuando TradeMe diga "70 % de confianza", acierte
> aproximadamente el 70 % de las veces. La calibración corrige el exceso (o defecto) de confianza
> del modelo sin cambiar la acción sugerida.

## Idea

El ensemble produce una `confidence` cruda (la probabilidad de la acción elegida). Esa probabilidad
rara vez está bien calibrada. Un **calibrador por régimen** mapea la confianza cruda a una
probabilidad calibrada que refleja la frecuencia real de acierto observada en el backtest.

Se entrena **por régimen** (`tendencia` / `rango`) porque la fiabilidad del modelo difiere según el
estado del mercado.

## Métodos (se elige el mejor por Brier)

Por cada régimen se ajustan dos calibradores y se conserva el de **menor Brier score**:

- **Isotónica (PAVA):** función monótona no decreciente, no paramétrica. Flexible; necesita más
  datos. Se exporta como *knots* `(x, y)` y se aplica por interpolación lineal.
- **Platt (sigmoide):** `prob = sigmoid(w·p + c)`, paramétrica y estable con pocos datos.

Con menos de `MIN_SAMPLES` (20) trades en un régimen se usa el **calibrador identidad** (no
distorsionar con poca evidencia).

> Todo se implementa a mano en numpy (sin scikit-learn) para mantener **paridad exacta**: el
> artefacto exporta parámetros simples y Node aplica la misma fórmula que Python. La paridad del
> applier está en `packages/core-signals/parity/macro_vectors.json` (sección `calibration`).

## Brier score y diagrama de fiabilidad

- **Brier score:** error cuadrático medio entre probabilidad y resultado (0/1). Más bajo = mejor.
- **Diagrama de fiabilidad:** probabilidad prevista (x) vs frecuencia real de acierto (y) por bins.
  La diagonal es la calibración perfecta; cuanto más pegados los puntos, más honestas las
  probabilidades. Visible en la pestaña **Backtest** del dashboard.

## Flujo de artefactos

```
apps/quant  ──run_calibration──►  artifacts/calibrators.json  ──►  apps/api (POST /reload)  ──►  señal
```

1. Entrenar (reproduce el backtest y ajusta los calibradores):

   ```bash
   docker compose -f infra/docker-compose.yml run --rm quant \
     python -m trademe_quant.run_calibration BTCUSDT 5m
   ```

   Escribe `artifacts/calibrators.json` (carpeta compartida por volumen con la API).

2. Recargar en la API sin reiniciar:

   ```bash
   curl -X POST http://localhost:3001/reload
   ```

3. La señal incluye ahora `calibrated_confidence` y `calibration_version`. Metadatos de fiabilidad
   en `GET /calibration`.

## Contrato del artefacto (`artifacts/calibrators.json`)

```json
{
  "version": "cal-BTCUSDT-5m",
  "created_at": "2026-07-18T00:00:00Z",
  "regimes": {
    "tendencia": {
      "method": "isotonic",
      "x": [0.34, 0.55, 0.80],
      "y": [0.20, 0.45, 0.70],
      "n": 120,
      "brier": 0.21,
      "reliability": [{ "p_pred": 0.4, "p_true": 0.38, "n": 30 }]
    },
    "rango": { "method": "platt", "w": 2.1, "c": -1.3, "n": 60, "brier": 0.23, "reliability": [] }
  }
}
```

## Qué NO hace todavía

La **optimización de pesos (Optuna)** y la **validación walk-forward con purga/embargo** llegan en el
Slice B de M7. El **meta-modelo ONNX** se evalúa en un M7.x posterior y solo se promociona si gana en
hold-out.

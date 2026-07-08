# Ensemble y probabilidades (M3)

El ensemble combina los votos (indicadores internos **+ señales externas como NinjaTrader**) en una
decisión **BUY / HOLD / SELL** con probabilidades. Configuración en `artifacts/ensemble.yaml`
(hand-authored en M3; la optimización con Optuna llega en M7).

## Agregación (score neto)

`net` = media ponderada de los `score` de los votos que votan dirección. ADX (contexto) y ATR
(volatilidad) **no votan**: definen el régimen y alimentan el plan (M4).

Peso efectivo de cada voto = **peso base × multiplicador de régimen**:

- **Peso base**: `weights[key]` para internos; `external_weights[source]` para externos. NinjaTrader
  pesa **2×** por ser la señal core.
- **Conmutación por régimen** (ADX): si `ADX ≥ adx_threshold` → _tendencia_ (sube EMA/MACD, baja
  reversión); si no → _rango_ (sube reversión). Las señales `custom` (NT8) no se ajustan por régimen.

El peso aplicado a cada voto se guarda en `vote.weight` para que la decisión sea **explicable**.

## Inferencia (probabilidades)

`net ∈ [-1,+1]` → `BUY/HOLD/SELL` vía **softmax con temperatura**:

```
logits = { BUY: net/T, SELL: -net/T, HOLD: hold_band/T }
probs  = softmax(logits)
action = argmax(probs);  confidence = probs[action]
```

`T` (temperature) controla lo decidido del reparto; `hold_band` da una zona neutra que favorece HOLD
cuando `net ≈ 0`. La **calibración estadística real** (isotónica/Platt sobre datos) es M7.

## Salida

`GET /signal?symbol=BTCUSDT&interval=1m` y el WS (`{type:'signal'}`) emiten el objeto **Signal**
completo (`packages/core-signals/schema/signal.schema.json`): `regime`, `votes` (con peso), `net`,
`probs`, `action`, `confidence`, `atr`, `model_version`. El plan de acción (`plan`) se llena en M4.

> Recordatorio: apoyo a la decisión, no asesoría financiera. Ningún modelo garantiza rentabilidad.

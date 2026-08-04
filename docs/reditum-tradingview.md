# Conectar los algoritmos Reditum (TradingView) con TradeMe

Las estrategias privadas viven en TradingView (Pine Script). TradeMe **no contiene su código**: solo
recibe sus alertas y las convierte en un voto más del ensemble, con más peso por ser fuente
principal de alfa.

## 1. Define el secreto

En `infra/.env.prod` añade una clave larga e inventada:

```
TV_WEBHOOK_SECRET=una-clave-larga-solo-para-tradingview
```

Recarga: `docker compose --env-file infra\.env.prod -f infra\docker-compose.prod.yml up -d api`

En la pestaña **Estado**, «Webhook Reditum» pasará de *No configurado* a **Operativo** y te mostrará
la dirección exacta a la que apuntar.

## 2. Crea la alerta en TradingView

En el gráfico con tu indicador Reditum: **Alerta → Notificaciones → Webhook URL**:

```
https://trademe.TU-TAILNET.ts.net:8443/tv-hook
```

Y en el **mensaje** de la alerta, este JSON:

```json
{
  "secret": "una-clave-larga-solo-para-tradingview",
  "strategy": "reditum_sniper",
  "symbol": "{{ticker}}",
  "signal": "long",
  "tf": "{{interval}}",
  "price": {{close}}
}
```

- `strategy`: `reditum_sniper`, `reditum_geny` o `reditum_poc` (según el indicador).
- `signal`: `long`, `short` o `flat` — normalmente crearás una alerta por cada dirección.

## 3. Compruébalo

Al dispararse la alerta verás la señal en el panel **Webhooks · Reditum** del Panel, con su latencia
y su tiempo de validez, y la decisión se inclinará en consecuencia. Todas las alertas quedan
registradas para poder analizarlas después.

## Notas

- El mapeo (qué señal equivale a qué voto y cuánto dura) es configurable en
  `apps/api/config/external_signals.yaml`.
- Si TradingView no puede entregar la alerta, revisa que la URL sea la del **túnel** (no `localhost`)
  y que el secreto coincida exactamente.

# Integración TradingView (Reditum) — configuración de alertas

Las estrategias privadas **Reditum** (SniperUltra = `reditum_sniper`, nuevoPOC = `reditum_poc`) viven
en TradingView (Pine Script). Sus alertas envían un webhook a TradeMe (`POST /tv-hook`), que las
convierte en votos del ensemble (peso 2×) y las registra para el backtest.

## 1. El endpoint

`POST /tv-hook` — valida un **token secreto en el cuerpo JSON** (los webhooks de TradingView no
permiten cabeceras HTTP personalizadas). Configura el token en `TV_WEBHOOK_SECRET` (env).

Payload esperado (lo que emite la alerta Pine):

```json
{
  "secret": "TOKEN_SECRETO_COMPARTIDO",
  "strategy": "reditum_sniper",
  "symbol": "BTCUSDT",
  "signal": "long",
  "tf": "5m",
  "price": 64000
}
```

`signal`: `long` (compra, score +1), `short` (venta, −1) o `flat` (cierre/neutral, 0). El mapeo y el
TTL de cada estrategia están en `apps/api/config/external_signals.yaml`.

## 2. Configurar la alerta en TradingView

1. En tu script Reditum, crea una **Alerta**.
2. En "Mensaje", pega el JSON de arriba (usa las variables de Pine para `price`/`symbol` si quieres).
3. En "Notificaciones → Webhook URL", pon la URL pública de tu backend: `https://<tu-host>/tv-hook`.

## 3. URL pública en local (túnel)

TradingView necesita alcanzar tu backend por una URL pública. En local, expón el puerto 3001 con un
túnel, por ejemplo **ngrok**:

```bash
ngrok http 3001
# usa la URL https que te da ngrok + /tv-hook como Webhook URL en TradingView
```

## 4. Probar sin TradingView (simulación local)

```powershell
Invoke-RestMethod -Method Post -Uri http://localhost:3001/tv-hook `
  -ContentType 'application/json' `
  -Body '{"secret":"TOKEN","strategy":"reditum_sniper","symbol":"BTCUSDT","signal":"long","tf":"5m","price":64000}'
```

Debe devolver `accepted = True` y un `vote` con `source: tradingview`, `score: 1`. En el dashboard,
el panel **Webhooks · Reditum** mostrará la señal con su latencia y TTL, y la decisión se inclinará
hacia BUY.

> El registro permanente en la tabla `external_signals` alimentará el replay de señales externas en
> el backtest (M6).

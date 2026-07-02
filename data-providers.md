# Fuentes de datos de mercado

> Archivo de contexto para **SignalDeck**. Define de dónde salen los datos OHLCV por clase de activo.
> **Para Cowork:** verifica límites, planes y precios actuales en la documentación de cada proveedor **antes** de integrarlo (cambian con frecuencia). Empieza la integración por **cripto** en M1, que es gratis y sin clave.

## Resumen por clase de activo

| Clase | Proveedor sugerido | Coste | Tiempo real | Histórico para backtest |
|-------|--------------------|-------|-------------|--------------------------|
| Cripto | **Binance** (alt: Bybit) | Gratis, sin clave para datos públicos | WebSocket | REST de klines |
| Acciones (US) | **Alpaca** (alt: Polygon) | Free tier limitado / plan de pago | WebSocket | API histórica |
| Forex | **Twelve Data** u **OANDA** (alt: Polygon FX) | Free tier limitado / de pago | WebSocket o polling | API histórica |

## Cripto — Binance (prioridad para M1)

- **Datos públicos de mercado no requieren clave** y suelen permitir CORS. Ideal para arrancar.
- Tiempo real por **WebSocket** (streams de velas/kline y trades); histórico por **REST de klines** para sembrar TimescaleDB.
- Hay **testnet** para pruebas sin riesgo.
- Solo necesitas clave si más adelante tocas datos de cuenta o ejecución (que queda fuera del MVP).

## Acciones US — Alpaca (alternativa: Polygon)

- **Alpaca:** tiene plan gratuito (datos con cierta limitación/retraso según el feed) y planes de pago para feed consolidado completo. Da **paper trading** nativo, útil para la fase simulada.
- **Polygon:** datos de buena calidad, de pago; bueno si necesitas profundidad histórica.
- Respeta **horario de mercado** (no hay velas 24/7) y maneja cierres/festivos.
- Requiere **API key**.

## Forex — Twelve Data / OANDA (alternativa: Polygon FX)

- Mercado **24/5**; cuida los huecos de fin de semana.
- **Twelve Data** y **OANDA** ofrecen tiempo real y histórico con free tier limitado; **OANDA** además da entorno *practice*.
- Requiere **API key / token**.

## Manejo de claves (obligatorio)

- **Nunca** subas claves al repo. Van en variables de entorno y en un gestor de secretos.
- Añade un `.env.example` (sin valores reales) y documenta cada variable.
- Carga las claves solo en el backend (`apps/api` / `apps/quant`), nunca en el frontend.

### `.env.example` sugerido

```
# Cripto (solo si se usa cuenta; los datos públicos no requieren clave)
BINANCE_API_KEY=
BINANCE_API_SECRET=

# Acciones (Alpaca)
ALPACA_API_KEY_ID=
ALPACA_API_SECRET_KEY=
ALPACA_BASE_URL=https://paper-api.alpaca.markets   # paper por defecto

# Forex (Twelve Data u OANDA)
TWELVEDATA_API_KEY=
OANDA_API_TOKEN=
OANDA_ACCOUNT_ID=

# Webhook de TradingView (señales tipo SniperUltra)
TV_WEBHOOK_SECRET=

# Infra
DATABASE_URL=postgres://signaldeck:signaldeck@localhost:5432/signaldeck
REDIS_URL=redis://localhost:6379
```

## Guía de integración para Cowork

1. **M1:** integra solo Binance (gratis, sin clave). Normaliza sus velas al esquema OHLCV común y deja el adaptador detrás de una interfaz `DataAdapter` para añadir más proveedores sin tocar el resto.
2. **M6 (backtesting):** usa el REST histórico de cada proveedor para sembrar TimescaleDB; verifica que no haya gaps ni look-ahead.
3. Acciones y forex se añaden cuando el motor ya funcione con cripto, para no bloquear el avance por temas de cuentas/claves de pago.
4. Implementa **reconexión con backoff**, control de **rate limits** y validación de integridad de velas en cada adaptador.
5. Antes de elegir plan de pago en cualquier proveedor, confírmame el coste; no contrates nada por tu cuenta.

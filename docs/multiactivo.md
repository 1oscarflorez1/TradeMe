# Multi-activo — analizar y entrenar sobre cualquier par disponible

## Qué se puede y qué no (importante)

TradeMe **dibuja** cualquier símbolo con el widget de TradingView, pero solo puede **decidir,
hacer backtest y entrenar** sobre activos de los que obtiene velas. Hoy la fuente de datos es
**Binance spot**, así que el catálogo real son sus pares (cientos de criptomonedas contra USDT,
USDC, BTC…). Acciones o forex requerirían añadir otro proveedor de datos; la arquitectura ya lo
contempla (`apps/api/src/market/catalog.ts`).

## Cómo funciona

1. En la barra superior, junto al selector de activo, pulsa **＋**.
2. Busca (por ejemplo `ETH`, `SOL`, `ADAUSDT`) y pulsa **+ Añadir**.
3. A partir de ese momento, **sin reiniciar nada**:
   - el motor se **suscribe en caliente** al stream de ese activo en todas las temporalidades;
   - siembra su histórico para poder calcular indicadores desde el primer minuto;
   - el **piloto automático** lo incluye en sus ciclos: lo mide, lo optimiza cuando toca y captura
     sus decisiones;
   - cada activo tiene **su propia estrategia optimizada por temporalidad**
     (`artifacts/optimized/ensemble.<SÍMBOLO>.<TF>.yaml`), sus backtests y sus registros.

Puedes **pausar** un activo (deja de analizarse pero conserva su historial) o **quitarlo** de la
lista. Quitarlo no borra sus registros ni sus backtests.

## Dónde vive

- Tabla `watchlist` (migración 013). Sustituye a la antigua lista fija en `TRADEME_SYMBOLS`, que
  queda solo como respaldo si la base de datos no está disponible.
- Endpoints: `GET /assets`, `GET /assets/search?q=`, `POST /assets`, `DELETE /assets/:symbol`,
  `POST /assets/:symbol/toggle`.

## Consejo de uso

Cada activo nuevo multiplica el trabajo del piloto (mediciones y optimizaciones por temporalidad).
Empieza con **dos o tres** activos líquidos y añade más cuando veas que el equipo los usa. La
pestaña **Estado** te dirá si el servicio quant se queda corto.

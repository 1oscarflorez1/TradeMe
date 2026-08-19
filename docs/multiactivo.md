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
- Migración 014: cada activo recuerda su `provider`, `asset_class` y `tv_symbol`.
- Endpoints: `GET /assets`, `GET /assets/providers`, `GET /assets/search?q=&assetClass=`,
  `POST /assets`, `DELETE /assets/:symbol`, `POST /assets/:symbol/toggle`.

> **De qué mercados se puede tirar y por qué TradingView no cuenta como fuente de datos:**
> ver [`proveedores.md`](proveedores.md).

## Consejo de uso

Cada activo nuevo multiplica el trabajo del piloto (mediciones y optimizaciones por temporalidad).
Empieza con **dos o tres** activos líquidos y añade más cuando veas que el equipo los usa. La
pestaña **Estado** te dirá si el servicio quant se queda corto.


## Lo que estaba cableado a un solo activo (y ya no)

Al pasar de uno a cuatro activos cripto en agosto de 2026 salieron tres piezas que asumían que solo
existía BTCUSDT. Ninguna daba error: todas fallaban en silencio, produciendo números plausibles.

**1 · La Data Intelligence Layer solo pedía datos de BTCUSDT.** El piloto llamaba a `run_once(dsn)`
sin símbolos, que cae en `default_providers()` con `["BTCUSDT"]` por defecto. Cualquier activo
añadido después quedaba sin funding, sin interés abierto y sin long/short — y por tanto con el
Fundamental Score `stale` para siempre. Se veía en la base de datos (`derivatives_metrics` tenía
tres filas, todas de BTC), pero no en ningún error, porque «sin datos» es un estado legítimo del
score. Ahora se construyen con los símbolos de la watchlist.

**2 · Los calibradores eran un artefacto único** entrenado con un solo activo; su versión lo
delataba: `cal-BTCUSDT-30m`. Con varios activos habría mostrado la calibración de BTC en el panel de
ETH. Ahora van por símbolo (`symbols['ETHUSDT']['rango']`) y **un activo sin calibración propia no
hereda la de otro**: se queda sin confianza calibrada, que es la respuesta honesta. La calibración
responde a «¿cuánto vale una confianza del 70 % *en este mercado*?», y eso no se transfiere.

**3 · El dataset del meta-modelo deduplicaba por `(interval, candle_open)` sin el símbolo.** Esa
consulta no filtra por activo y las velas de todos comparten los mismos `candle_open`, porque son
ventanas de tiempo alineadas. Con cuatro activos habría colapsado a una fila por vela: **el 75 % de
la muestra perdida**, justo lo contrario de lo que el multiactivo persigue, y sin un solo error a la
vista. Corregido a `(symbol, interval, candle_open)`.

Lo que **sí** estaba bien por símbolo desde el principio: `independence.json` y `quarantine.json`
(claves `SÍMBOLO:intervalo`), los artefactos de `fundamental/` y `optimized/`, el bucle del piloto
—que ya iteraba la watchlist— y las consultas de la api, que filtran por símbolo antes de deduplicar.

### Por qué esto era el requisito del Gestor de Correlaciones

Y por qué se hizo antes: con un solo activo, **toda** la evidencia del proyecto venía de la misma
serie de precios. El funding asimétrico de M12, la cuarentena de 4h, el desinflado por dependencia:
todo medido sobre BTCUSDT. Cuatro activos convierten cada hallazgo en replicable — un patrón que
aparece en BTC y se repite en ETH y SOL es otra cosa que uno que solo aparece en BTC. Es la
validación fuera de muestra que el proyecto no tenía, y además cuadruplica el ritmo de decisiones
evaluadas, que había caído a 56 por semana.

# Proveedores de datos de mercado

TradeMe separa **de dónde vienen las velas** (proveedor) de **qué hace con ellas** (indicadores,
ensemble, calibración, meta-modelo). Añadir un mercado nuevo no toca la matemática: solo se registra
otro proveedor.

---

## ¿Se puede usar TradingView como proveedor de datos?

**No, y conviene entender por qué antes de diseñar nada encima.**

TradingView no publica una API de datos de mercado para terceros. Lo que ofrece es:

| Lo que sí ofrece | Lo que TradeMe hace con ello |
|---|---|
| **Widget de gráfico** (`tv.js`) | La pestaña «TradingView» del Panel: dibuja casi cualquier mercado del mundo. |
| **Alertas con webhook** (plan de pago) | El endpoint `POST /tv-hook`: por ahí entran las señales de los algoritmos privados Reditum. |
| **Pine Script** | Se ejecuta dentro de TradingView; su resultado llega a TradeMe como alerta, no como datos. |

Lo que **no** ofrece es un endpoint público de velas OHLCV. Sus feeds internos (`scanner`,
`udf/history`) son privados, requieren sesión de usuario, cambian sin aviso y su uso automatizado
está prohibido por sus Términos de Servicio. Construir el motor sobre eso significaría que TradeMe
podría dejar de funcionar cualquier martes por la mañana, sin recurso posible, y con una cuenta
potencialmente bloqueada.

Por eso el reparto de papeles es este:

- **TradingView = pantalla y sensor.** Dibuja el gráfico y nos manda alertas Reditum.
- **Proveedores de datos = fuente.** Entregan las velas con las que TradeMe decide, calibra,
  hace backtest y entrena.

La consecuencia práctica es la regla que ya aparece en la interfaz: *el gráfico puede mostrar
cualquier mercado, pero solo se puede **analizar y entrenar** sobre activos con datos disponibles.*
Cada activo de la lista dice de qué proveedor salen sus velas.

---

## Cómo está montado

```
                    ┌──────────────────────────────┐
   symbol ─────────▶│      ProviderRegistry        │
                    │  ruta símbolo → proveedor    │
                    │  búsqueda combinada          │
                    │  reparto de suscripciones    │
                    └───────┬──────────────┬───────┘
                            │              │
              ⚡ modo stream │              │ ⏱ modo poll
                            ▼              ▼
                  ┌───────────────┐  ┌──────────────────┐
                  │ BinanceProvider│  │ TwelveDataProvider│
                  │  WebSocket     │  │  REST + sondeo    │
                  └───────┬───────┘  └────────┬─────────┘
                          └────────┬──────────┘
                                   ▼
                              Candle (idéntica)
                                   ▼
                   buffer → indicadores → ensemble → decisión
```

El resto del motor **no sabe** de qué proveedor viene cada vela: todos entregan el mismo objeto
`Candle` validado por el mismo esquema. Ese es el punto de todo el diseño.

### Los dos modos de entrega

| Modo | Qué significa | Cuándo se usa |
|---|---|---|
| **⚡ stream** | El proveedor empuja cada vela por WebSocket en cuanto ocurre. | Binance (cripto). Gratis y en tiempo real. |
| **⏱ poll** | TradeMe pregunta cada pocos minutos por las últimas velas y emite las que ya cerraron. | Acciones, forex e índices: sus planes gratuitos son REST, sin streaming. |

El modo `poll` es una diferencia real, no cosmética: en 1m o 5m se nota el retraso. **Para activos
por sondeo, usa temporalidades de 15m en adelante**, que es además donde el sistema tiene mejor
expectancy. La cadencia se calcula sola (≈ un cuarto de vela, con suelo de 1 min y techo de 15) y
siempre pasa por un presupuesto de peticiones para no agotar el plan gratuito.

---

## Proveedores incluidos

### Binance — cripto, tiempo real, sin clave

Es el proveedor con el que nació TradeMe y sigue siendo el preferente. Catálogo completo de spot
(`exchangeInfo`, caché de 6 h), velas por WebSocket, histórico por REST. No requiere registro.

### Twelve Data — acciones, divisas, índices y ETF

Se activa poniendo una clave gratuita en el `.env`:

```env
TWELVEDATA_API_KEY=tu_clave
```

La clave se obtiene registrándose en `twelvedata.com` (plan gratuito, sin tarjeta). **Sin clave, el
proveedor aparece en la interfaz como «sin configurar» y TradeMe sigue funcionando solo con
Binance**; no es un error ni rompe nada.

Límites del plan gratuito y cómo los respeta TradeMe:

| Límite del plan | Cómo se respeta |
|---|---|
| 8 peticiones/minuto | Presupuesto interno fijado en **6/min** (margen de seguridad). |
| 800 peticiones/día | Presupuesto interno fijado en **700/día**. |
| Sin WebSocket | Modo `poll` con cadencia derivada de la temporalidad. |

Cuando el presupuesto se agota, el sondeo **se pospone** en vez de fallar: no se pierde el activo,
solo llega la vela un poco más tarde. Presupuesto orientativo: un activo con 15m/1h/4h/1d consume
≈ 400 peticiones/día, así que **con el plan gratuito caben unos 2 activos por sondeo**. Para más,
o subes de plan o repartes temporalidades.

**Símbolos con barra.** Este proveedor usa `EUR/USD`, y la barra no es segura en URLs ni como clave
de base de datos. Dentro de TradeMe se guarda `EUR-USD` y se traduce al consultar. Es transparente
para quien usa el portal.

---

## Añadir un tercer proveedor

Todo el contrato está en `apps/api/src/providers/types.ts`. Un proveedor nuevo son tres pasos:

1. **Implementa `MarketProvider`.** Si la fuente tiene WebSocket, hazlo directo (mira
   `binance-provider.ts`). Si es REST, hereda de `PollingProvider` y solo implementa
   `searchCatalog`, `exists` y `getHistory`: el sondeo, la cadencia, el presupuesto y la deduplicación
   de velas ya están resueltos (mira `twelvedata-provider.ts`).
2. **Regístralo** en `apps/api/src/server.ts`, en la lista del `ProviderRegistry`. El orden importa:
   el primero que reconozca un símbolo se lo queda.
3. **Nada más.** Búsqueda, insignias en la interfaz, columna `provider` en la watchlist, reparto de
   suscripciones, histórico, backtest y piloto automático funcionan solos.

Alternativas gratuitas conocidas, por si en algún momento interesa cambiar o sumar:

| Proveedor | Cubre | Nota |
|---|---|---|
| **Twelve Data** | Acciones, forex, índices, ETF, cripto | El incluido. Buen equilibrio y catálogo con búsqueda. |
| Finnhub | Acciones EE. UU., forex, cripto | Plan gratuito generoso; WebSocket solo de precios, no de velas. |
| Alpha Vantage | Acciones, forex, cripto | 25 peticiones/día en el plan gratuito: demasiado justo para el motor. |
| Yahoo Finance | Casi todo | Sin API oficial ni garantías: mismo problema de fondo que TradingView. |

---

## Preguntas frecuentes

**¿Un activo por sondeo entrena peor?**
No entrena peor: entrena igual, con las mismas velas cerradas. Lo que cambia es la *latencia* de la
decisión en vivo. En 15m o superior es irrelevante; en 1m sí lo es.

**¿Puedo mezclar cripto y acciones en la misma lista?**
Sí. Cada activo lleva su proveedor y el registro reparte las suscripciones. La configuración
optimizada, la calibración y el meta-modelo ya eran por símbolo y temporalidad.

**¿Los mercados cerrados rompen algo?**
No. Fuera de horario simplemente no aparecen velas nuevas; el sondeo no encuentra nada que emitir y
el motor mantiene la última decisión. El piloto automático no confundirá esa quietud con
degradación, porque mide sobre operaciones evaluadas, no sobre tiempo.

**¿Y las acciones no necesitan análisis fundamental?**
Sí, y mucho más que el cripto. Esa es exactamente la razón de ser de M11–M14 (Data Intelligence
Layer y Fundamental Intelligence Engine). Este trabajo abre la puerta al mercado; el fundamental
llega después, y por eso conviene tomar los resultados de acciones con más cautela que los de
cripto hasta entonces.

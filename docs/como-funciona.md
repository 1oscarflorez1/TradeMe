# Cómo funciona TradeMe

TradeMe es un copiloto de trading en tiempo real para activos mixtos (cripto, acciones, forex).
Sobre el activo referenciado sugiere **COMPRAR / MANTENER / VENDER**, acompañado de un **plan de
acción ordenado** (entrada, stop-loss, take-profit y tamaño de posición) y una **probabilidad
calibrada de acierto**. No ejecuta operaciones por defecto: es apoyo a la decisión.

## Flujo de datos (end-to-end)

1. **Ingesta** (Node): adaptadores por clase de activo reciben OHLCV en streaming y normalizan al mismo esquema de velas.
2. **Motor de indicadores** (Node, en vivo): cada indicador emite un voto normalizado en `[-1, +1]` con metadatos.
3. **Agregador (ensemble)** (Node): combina votos con pesos configurables; el régimen de mercado (ADX) cambia la ponderación.
4. **Calibración + inferencia** (Node): convierte el puntaje neto en probabilidades fiables `BUY/HOLD/SELL` con artefactos entrenados offline.
5. **Generador de plan** (Node): con ATR calcula entrada, stop, take-profit y tamaño según riesgo fijo.
6. **Entrega** (Node): señales por WebSocket y push, con reglas de disparo (umbral, cambio de señal, cooldown).
7. **Mejora continua** (Python, offline): backtesting, optimización y entrenamiento; publica artefactos que Node carga.
8. **Clientes**: dashboard web (React) y app móvil (Expo).

## Glosario

voto, score, ensemble, régimen, calibración, walk-forward, expectancy, profit factor, drawdown, R-múltiplo.

> **Disclaimer**: ningún modelo garantiza rentabilidad; el rendimiento pasado no asegura resultados
> futuros. TradeMe es educativo y de apoyo a la decisión, no asesoría financiera.

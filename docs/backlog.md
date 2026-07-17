# Backlog y visión (referencia del equipo)

Resumen del backlog compartido, para alinear los hitos de TradeMe con la visión del proyecto.

## Fases

- **Fase 1 — Conexión TradingView ↔ agente:** suscripción TradingView, checklist de validación,
  bitácora, definición de storage, **conexión TradingView ↔ backend** (hecho en M5), plan maestro,
  arquitectura del agente, skills. _(la mayoría en curso/hecho)_
- **Fase 2 — Validar la consistencia de las decisiones del agente.** → se apoya en **M6 (backtesting)**
  y **M7 (calibración)**.
- **Fase 3 — Conexión con brokers (IBKR, Binance).** → ejecución real, siempre tras el _feature flag_
  desactivado por defecto (post-M8/M10).

## Roles y turnos

- Equipo: Edgar, Oscar, Sergio. Turnos de vigilancia de TradingView repartidos durante el día.

## Visión mayor (futuro)

- Sistema multi-agente: **Agente Analista**, **Agente Auditor**, **Agente Director** (evalúa contexto,
  noticias que mueven el mercado).
- Mesa de dinero con cartera de activos (acumulación / crecimiento), estrategias intradía.

## Mapa hitos TradeMe ↔ backlog

| Backlog                            | Hito TradeMe                       |
| ---------------------------------- | ---------------------------------- |
| Conexión TradingView               | M5 ✅                              |
| Contexto macro + registro para IA  | M5.5 / M5.6 ✅                     |
| Validar consistencia de decisiones | M6 (backtesting), M7 (calibración) |
| Ejecución con brokers              | M8+ (tras feature flag)            |

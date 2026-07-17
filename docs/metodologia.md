# Metodología de trading (referencia)

Basado en el checklist del equipo. Guía la lógica de decisión y el DoD de las señales de TradeMe.

## Los 10 pasos del trader de alto nivel

1. Preparación mental (condición emocional apropiada).
2. Revisar el contexto general del mercado.
3. Escoger activos con liquidez apropiada.
4. Identificar señales, patrones, pivots, POCs.
5. Establecer una hipótesis.
6. Definir precio de entrada, stop-loss y take-profit.
7. Definir el tamaño del lote.
8. Ejecutar con disciplina.
9. Gerenciar la operación.
10. Documentar, evaluar y mejorar.

## Checklist de identificación de patrones (para disparar un trade)

- Escoger el activo a operar.
- Identificar la tendencia de largo plazo (alcista/bajista) — en TradeMe: **sesgo macro 1w+**.
- Confirmar liquidez.
- Escoger el rango temporal (intradía, swing) — en TradeMe: **selector de temporalidad**.
- Cargar los algoritmos: **Sniper Ultra, Geny Trend, Nuevo POC**.
- Analizar en varias temporalidades (iniciar con el diario).
- Alternar velas y líneas.
- Identificar quién controla la subasta (compradores/vendedores) y cuándo cambia.
- Mirar siempre a la izquierda del gráfico.
- Identificar POCs anteriores, soportes y resistencias (**Nuevo POC**).
- Contar el pivot de la evolución del precio (Fibonacci).
- Identificar clusters de soportes/resistencias (**Sniper Ultra**).

> **Pendiente:** el checklist menciona un **tercer algoritmo, "Geny Trend"** (`reditum_geny`), además de
> SniperUltra y nuevoPOC. Está pendiente de confirmar su incorporación al mapeo `external_signals.yaml`.

## Cómo se refleja hoy en TradeMe

- Contexto/tendencia mayor → **sesgo macro (1w+)** con degradación a FLAT en conflicto.
- Entrada/stop/TP/tamaño → **plan de acción** (M4) con **validez temporal** (M5.6).
- Documentar/evaluar/mejorar → **snapshots** + seguimiento (M5.5/M5.6) y **backtesting** (M6).
- POCs, Fibonacci, control de subasta → candidatos a futuros indicadores/votos.

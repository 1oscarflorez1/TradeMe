# Backtesting (M6)

Valida la estrategia sobre histórico **sin look-ahead**: en cada vela `t` se decide usando solo
datos hasta `t`. Vive en `apps/quant` (mirror de la decisión de Node, validado por paridad).

## Cómo funciona

1. **Reproducción de la decisión:** `trademe_quant/decision.py` es el mirror de `buildSignal` (agrega
   los votos por régimen, softmax con modulación macro, dirección y niveles del plan). La **suite de
   paridad** garantiza que Node y Python deciden lo mismo (`macro_vectors.json` → sección `decision`).
2. **Harness** (`backtest.py`): recorre las velas; cuando la acción es LONG/SHORT abre un trade
   simulado con entrada/stop/TP del plan y lo evalúa por **primer toque** sobre las velas siguientes.
   **Peor caso:** si una vela toca stop y TP a la vez, se asume **SL** (prudencia).
3. **Métricas** (out-of-sample con split temporal 70/30): nº de trades, win rate, **expectancy** (R
   medio), **profit factor**, **max drawdown** (sobre la curva de R) y **Sharpe**. Son las mismas
   métricas de la bitácora del equipo.
4. **Evaluador de outcomes:** rellena los `outcome_*` de la tabla `snapshots` con la misma lógica de
   primer toque, para que la pestaña Registros muestre el resultado real.

## Ejecutar

Con la infraestructura levantada (`docker compose up`):

```bash
cd apps/quant && pip install -e ".[dev]"
python -m trademe_quant.run_backtest BTCUSDT 5m
```

Descarga 1000 velas de Binance, corre el backtest, **guarda el resultado en la tabla `backtests`** y
evalúa los snapshots pendientes. El dashboard lo muestra en la pestaña **Backtest**
(`GET /backtest?symbol=BTCUSDT&interval=5m`).

> Rigor: el split temporal simple valida el motor ahora; la **purga/embargo** (López de Prado) y la
> optimización de pesos (Optuna) llegan en **M7**. Ningún resultado garantiza rentabilidad futura.

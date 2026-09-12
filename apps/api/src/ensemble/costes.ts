import type { EnsembleConfig } from './config.js';

/**
 * Lo que cuesta operar, en las mismas unidades en que se mide todo lo demás.
 *
 * **Espejo de `apps/quant/trademe_quant/costes.py`.** Las dos implementaciones tienen que dar el
 * mismo número; hay tests espejo a cada lado.
 *
 * Por qué existe este fichero (8 sep 2026)
 * ----------------------------------------
 * Desde 0.63.0 el backtest, la cuarentena, el meta-modelo y el Fundamental Score miden en **R
 * neta**: el coste se descuenta al leer, porque la columna `outcome_return_r` guarda el bruto y
 * reescribirla mezclaría dos reglas en la misma columna.
 *
 * Pero la **interfaz no se enteró**. `snapshots-repo` calculaba la expectancy con
 * `AVG(outcome_return_r)` a secas, así que el panel mostraba una cifra bruta mientras todo el
 * gobierno del proyecto razonaba en neto. En 1d eso son ~0,015 R por operación de optimismo — el
 * orden de magnitud de la propia ventaja que se estaba midiendo.
 *
 * Cómo se calcula
 * ---------------
 * `|entry − stop|` **ya es 1 R expresado en precio**, así que el coste en R es el coste en precio
 * dividido por ese riesgo. No hace falta el ATR y sigue siendo correcto si cambia `atr_stop_mult`.
 */

/** Parámetros de Binance USDT-M Futuros, que es el mercado sobre el que se decidió medir. */
export const TAKER_PCT = 0.05;
export const MAKER_PCT = 0.02;
/**
 * Deslizamiento estimado por orden. No es una comisión: es la diferencia entre el precio que se
 * pide y el que se consigue. Se aplica en las dos patas, que es lo prudente — en la de salida suele
 * ser peor, porque un stop se ejecuta cuando el mercado va en contra.
 */
export const SLIPPAGE_PCT = 0.01;

/**
 * Coste de abrir **y** cerrar una posición, en porcentaje del nocional.
 *
 * Con los parámetros por defecto: `2 × (0,05 + 0,01) = 0,12 %` en taker y `0,06 %` en maker.
 */
export function roundTripPct(
  modo: 'taker' | 'maker' = 'taker',
  takerPct = TAKER_PCT,
  makerPct = MAKER_PCT,
  slippagePct = SLIPPAGE_PCT,
): number {
  const porOrden = modo === 'maker' ? makerPct : takerPct;
  return 2 * (porOrden + slippagePct);
}

/**
 * El coste de una operación medido en unidades de riesgo.
 *
 * Devuelve 0 si el riesgo es nulo: sin distancia al stop no hay R que valga, e inventar un coste
 * infinito no ayudaría a nadie.
 */
export function costeEnR(entry: number, stop: number, pct: number): number {
  const riesgo = Math.abs(entry - stop);
  if (riesgo <= 0 || pct <= 0) return 0;
  return ((pct / 100) * Math.abs(entry)) / riesgo;
}

/**
 * Round-trip en porcentaje según la sección `costs` del ensemble. Sin ella, **cero**.
 *
 * El cero por defecto es deliberado: mantiene el comportamiento anterior para quien no haya
 * configurado nada, y hace que la diferencia bruto/neto sea siempre atribuible a una decisión
 * explícita y no a un valor que alguien puso por ahí.
 */
export function desdeConfig(cfg: Pick<EnsembleConfig, 'costs'> | null | undefined): number {
  const costs = cfg?.costs;
  if (!costs || !costs.enabled) return 0;
  return roundTripPct(
    costs.mode === 'maker' ? 'maker' : 'taker',
    costs.takerPct ?? TAKER_PCT,
    costs.makerPct ?? MAKER_PCT,
    costs.slippagePct ?? SLIPPAGE_PCT,
  );
}

import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

export interface RegimeMultipliers {
  trend: number;
  momentum: number;
  reversion: number;
}

export interface RiskConfig {
  atrStopMult: number;
  tpRMultiple: number;
  riskPct: number;
}

export interface PlanConfig {
  /** Validez por defecto, en velas, cuando la temporalidad no tiene entrada propia. */
  validCandles: number;
  /**
   * Frescura de la ENTRADA por temporalidad (M10.5).
   *
   * Cuánto tiempo sigue teniendo sentido entrar al precio propuesto. Las 3 velas fijas anteriores
   * eran 3 minutos en 1m y 12 horas en 4h: el mismo número para horizontes que se diferencian en
   * tres órdenes de magnitud. En las cortas se descartaba una entrada todavía buena; en las largas
   * se mantenía viva mucho después de que el contexto hubiera cambiado.
   *
   * No confundir con `EvaluationConfig.horizonByTf`: esto decide hasta cuándo se puede entrar, no
   * cuánto tiempo se le da a la operación una vez abierta.
   */
  validCandlesByTf: Record<string, number>;
}

export interface EvaluationConfig {
  /** Horizonte por defecto, en velas, cuando la temporalidad no tiene entrada propia. */
  horizon: number;
  /**
   * Velas que se le dan a una operación antes de cerrarla por tiempo (M10.5).
   *
   * **Este es el parámetro que produce los «timeout»**, no la frescura de la entrada. Estaba fijo en
   * 20 velas para todas las temporalidades, escrito como valor por defecto de una función y sin
   * forma de configurarlo: el 31 % de las decisiones acababa expirando sin resolverse y 1d/1w/1M no
   * llegaban a evaluarse nunca, porque 20 velas de 1d son 20 días y el histórico no llegaba.
   *
   * Con stop a 1,5·ATR y objetivo a 2R el precio tiene que recorrer 3·ATR. Bajo un paseo aleatorio
   * de pasos del tamaño del ATR eso pide del orden de 9 velas: por debajo de ahí un «timeout» no
   * mide que la operación no fuera a ninguna parte, mide que no le dimos tiempo. Por arriba, en las
   * temporalidades largas, cada vela ya es tanto tiempo de reloj que esperar 20 significa no cerrar
   * nunca. De ahí que baje al alargarse la temporalidad.
   */
  horizonByTf: Record<string, number>;
}

export interface MacroConfig {
  enabled: boolean;
  wMacro: number;
  fundingWeight: number;
  trendWeight: number;
  fundingScale: number;
  trendScale: number;
  conflictDowngrade: boolean;
  conflictThreshold: number;
  enableScaling: boolean;
  tfScale: Record<string, number>;
}

/**
 * Fundamental Score (M12).
 *
 * `mode` gobierna además la **migración del funding**. Hoy `MacroConfig` mezcla funding y tendencia
 * semanal en un único `bias` simétrico; el acuerdo de M12 es que el funding pase a vivir aquí, en
 * exclusiva y asimétrico. Pero mover el peso el mismo día que entra el score haría lo contrario de
 * lo que pretende el gobierno en sombra: quitaría el funding de las decisiones reales sin que nada
 * lo sustituyera, y sin haberlo medido.
 *
 * Por eso la migración va atada a la promoción. Mientras `mode` no sea `active`, `bias.ts` se
 * comporta exactamente como hoy y las decisiones reales no cambian ni un dígito. Ver
 * `effectiveMacro`.
 */
export interface FundamentalConfig {
  /** `off` ni se calcula · `shadow` se calcula y registra sin influir · `active` penaliza. */
  mode: 'off' | 'shadow' | 'active';
  /** Peso de la penalización sobre el logit BUY. */
  wFund: number;
  /** Percentil por debajo del cual no se penaliza (tercil inferior de la medición). */
  start: number;
  /** Ventana móvil, en días, que define «lo normal últimamente». */
  windowDays: number;
  /** Al promocionar, el funding sale de `macro.bias` y vive solo aquí. */
  absorbsFunding: boolean;
}

export interface EnsembleConfig {
  version: string;
  temperature: number;
  holdBand: number;
  weights: Record<string, number>;
  externalWeights: Record<string, number>;
  regime: {
    adxThreshold: number;
    adxLo: number;
    adxHi: number;
    trend: RegimeMultipliers;
    range: RegimeMultipliers;
  };
  risk: RiskConfig;
  macro: MacroConfig;
  fundamental: FundamentalConfig;
  plan: PlanConfig;
  evaluation: EvaluationConfig;
  /**
   * Temporalidades en cuarentena: se calculan y se registran, pero no emiten señal operable.
   *
   * 4h acumulaba −0,485 R en 89 decisiones (69 cortos con el 85,6 % al stop). Se creyó que era por
   * operar contra una tendencia alcista de fondo; M11 reconstruyó el sesgo macro real del periodo y
   * resultó bajista, así que habría reforzado esos cortos en vez de vetarlos. La cuarentena sigue
   * justificada por el resultado; la causa está por determinar.
   *
   * Una temporalidad en cuarentena se calcula y se registra, pero no emite señal operable. Se
   * retira el permiso para operar, no la observación: desde M10.7 conserva su decisión sombra para
   * poder demostrar que merece volver.
   */
  quarantineIntervals: string[];
  /**
   * ¿Se aplican las configuraciones de Optuna? Por defecto sí; desde 0.69.0 el yaml dice que no.
   *
   * Retiradas el 7 de septiembre de 2026 tras medirlas contra la base en R netas sobre 1d: la
   * mediana pasa de −0,019 con ellas a +0,020 sin ellas, y SOLUSDT:1d de −0,013 a +0,106. La
   * salvedad apunta en su contra: desde que se generaron solo han pasado de 2 a 4 operaciones, así
   * que **pierden incluso en los datos con los que se ajustaron**.
   *
   * Se desactivan por bandera y no se borran: la decisión es reversible y queda auditable.
   */
  /**
   * Lo que cuesta operar, para poder medir en R **neta**. Sin la sección, cero.
   *
   * La api nunca leyó este bloque —lo declaraba el yaml desde 0.63.0 y solo lo consumía quant—, así
   * que la expectancy del panel salía bruta mientras todo el gobierno razonaba en neto. Ver
   * `costes.ts`.
   */
  costs: {
    enabled: boolean;
    mode: 'taker' | 'maker';
    takerPct: number;
    makerPct: number;
    slippagePct: number;
  };
  useOptimizedConfigs: boolean;
  /**
   * Claves `SÍMBOLO:intervalo` autorizadas a emitir señal. Vacía o ausente = no restringe nada.
   *
   * **Restringe, nunca habilita.** Una clave que esté en la lista pero además en cuarentena sigue
   * vetada: este filtro se suma a los que ya hay, no los sustituye. Escrito así a propósito —una
   * lista blanca que pudiera levantar una cuarentena sería una puerta trasera al gobierno.
   *
   * Desde 0.70.0 vive aquí la concentración en `ETHUSDT:1d` y `SOLUSDT:1d`. La justificación no es
   * «son las dos mejores» —eso, dicho sobre el mismo histórico con el que se midieron, sería
   * selección post-hoc— sino un walk-forward de la propia regla: sobre 21 trimestres, seleccionar
   * las dos mejores con lo anterior y operarlas en el siguiente da **+0,044 R por trimestre** frente
   * a operar las cuatro. Ver `docs/lista-blanca.md`, que incluye también lo que esa cifra no
   * demuestra.
   */
  activeKeys: string[];
  /** Resuelto por temporalidad en `forInterval`. */
  quarantined?: boolean;
  /** Resuelto por símbolo+temporalidad en `forInterval` (1 = sin desinflar). */
  independenceFactor?: number;
}

export const DEFAULT_ENSEMBLE: EnsembleConfig = {
  version: 'ens-default',
  temperature: 0.5,
  holdBand: 0.06,
  weights: { ema_cross: 1, macd: 1, supertrend: 1, rsi14: 1, bbands: 1, stoch14: 1 },
  // Reditum en sombra. El valor por defecto importa tanto como el del yaml: si la clave
  // desapareciera del artefacto, un 2 aquí devolvería a la fuente el peso más alto del sistema
  // sin que nadie lo decidiera. Ver `artifacts/ensemble.yaml`.
  externalWeights: { tradingview: 0 },
  regime: {
    adxThreshold: 25,
    adxLo: 15,
    adxHi: 35,
    trend: { trend: 1.5, momentum: 1.5, reversion: 0.6 },
    range: { trend: 0.6, momentum: 0.8, reversion: 1.5 },
  },
  risk: { atrStopMult: 1.5, tpRMultiple: 2, riskPct: 0.01 },
  macro: {
    enabled: true,
    wMacro: 1,
    fundingWeight: 0.5,
    trendWeight: 0.5,
    fundingScale: 0.0005,
    trendScale: 0.05,
    conflictDowngrade: true,
    conflictThreshold: 0.5,
    enableScaling: false,
    tfScale: { '1m': 0.2, '5m': 0.3, '15m': 0.4, '30m': 0.5, '1h': 0.6, '4h': 0.8, '1d': 1, '1w': 1, '1M': 1 },
  },
  fundamental: {
    // Entra en sombra, como todo lo que aspira a mandar sobre una decisión.
    mode: 'shadow',
    // La mitad del peso macro: actúa en un solo lado, no en los dos. Es un punto de partida
    // razonado, no medido — se calibrará con decisiones reales cerradas antes de promocionar.
    wFund: 0.5,
    start: 1 / 3,
    windowDays: 90,
    absorbsFunding: true,
  },
  plan: {
    validCandles: 3,
    validCandlesByTf: {
      '1m': 5,
      '5m': 5,
      '15m': 4,
      '30m': 4,
      '1h': 3,
      '4h': 3,
      '1d': 2,
      '1w': 2,
      '1M': 1,
    },
  },
  evaluation: {
    horizon: 20,
    horizonByTf: {
      '1m': 30,
      '5m': 25,
      '15m': 20,
      '30m': 20,
      '1h': 18,
      '4h': 15,
      '1d': 10,
      '1w': 6,
      '1M': 4,
    },
  },
  // 15m, 30m y 1h entran por un motivo distinto al de 4h: no es su expediente, es el coste
  // estructural. Con `1 R = atrStopMult x ATR`, en 15m 1 R son ~0,40 % del precio y el round-trip
  // de Binance USDT-M Futuros (0,12 %) se lleva 0,29 R por operación — contra una expectancy bruta
  // medida de +0,003 R sobre ~1.850 operaciones. Ver `docs/costes.md`.
  quarantineIntervals: ['15m', '30m', '1h', '4h'],
  costs: { enabled: false, mode: 'taker', takerPct: 0.05, makerPct: 0.02, slippagePct: 0.01 },
  useOptimizedConfigs: false,
  activeKeys: [],
};

/** Frescura de la entrada, en velas, para una temporalidad. */
export function validCandlesFor(cfg: EnsembleConfig, interval: string): number {
  const v = cfg.plan.validCandlesByTf?.[interval];
  return typeof v === 'number' && v > 0 ? v : cfg.plan.validCandles;
}

/** Velas que se le dan a la operación antes de cerrarla por tiempo. */
export function horizonFor(cfg: EnsembleConfig, interval: string): number {
  const v = cfg.evaluation?.horizonByTf?.[interval];
  return typeof v === 'number' && v > 0 ? v : (cfg.evaluation?.horizon ?? 20);
}

/**
 * Pesos del sesgo macro una vez resuelta la migración del funding (M12).
 *
 * Mientras el Fundamental Score esté en `shadow` u `off`, devuelve la configuración tal cual: las
 * decisiones reales no cambian. Al promocionarlo a `active` con `absorbsFunding`, el funding sale
 * de aquí —pasa a penalizar solo los largos— y el peso que ocupaba **se transfiere a la tendencia**
 * en vez de desaparecer.
 *
 * Esa transferencia no es un adorno. Con `fundingWeight: 0.5` y `trendWeight: 0.5`, anular el
 * primero sin renormalizar dejaría `|bias| <= 0.5`, y el escudo macro —que exige
 * `|bias| > conflictThreshold`, hoy 0.5— no volvería a dispararse jamás. Se habría desactivado una
 * salvaguarda sin que nadie lo decidiera ni lo notara.
 */
export function effectiveMacro(cfg: EnsembleConfig): MacroConfig {
  const f = cfg.fundamental;
  if (!f || f.mode !== 'active' || !f.absorbsFunding) return cfg.macro;
  const total = cfg.macro.fundingWeight + cfg.macro.trendWeight;
  return {
    ...cfg.macro,
    fundingWeight: 0,
    trendWeight: total > 0 ? total : cfg.macro.trendWeight,
  };
}

/**
 * Aplica sobre la base **solo lo que Optuna optimiza**. Todo lo demás manda la base.
 *
 * Lo que viaja coincide con los `trial.suggest_*` de `optimize.py` y con `CAMPOS_OPTIMIZABLES` en
 * `apps/quant/trademe_quant/ensemble.py`. Es una lista **blanca** a propósito: lo que no esté aquí
 * viene de la base, así que una sección nueva del yaml queda protegida por defecto en vez de quedar
 * olvidada hasta que alguien note que no se aplica.
 *
 * El fallo que esto corrige (7 sep 2026)
 * --------------------------------------
 * El optimizador publica una **copia completa** del yaml, pero solo busca doce cosas: los seis
 * pesos, `hold_band`, `temperature`, `adx_lo`, `adx_width` y los multiplicadores de régimen. Y
 * quien la consumía —aquí y en `load_active_ensemble`— la cargaba **entera**, sustituyendo la base.
 *
 * El resultado es que cada clave con configuración optimizada quedaba **congelada en el estado de
 * gobierno del día en que se generó**. Las quince que había el 7 de septiembre de 2026 eran de
 * agosto, y por tanto aplicaban:
 *
 * - **sin sección `costs`** — se medían en bruto, tres de las cuatro claves de 1d incluidas;
 * - `quarantine_intervals: ['4h']` — la cuarentena estructural de 15m, 30m y 1h no les llegaba;
 * - `external_weights.tradingview: 2.0` — cuando la base lo puso a 0 (sombra) en 0.62.0.
 *
 * Lo caro no fue lo que hacía, sino lo que hizo creer: `docs/costes.md` daba **+0,020 R netos**
 * para 1d, y ese número sale de medir la configuración **base**. Con la que de verdad opera, y
 * aplicándole los costes que le faltaban, 1d da **−0,019 R**.
 */
export function fusionarOptimizada(
  base: EnsembleConfig,
  opt: EnsembleConfig,
): EnsembleConfig {
  return {
    ...base,
    // La versión sí viaja: es la identidad del artefacto que se está aplicando, y la interfaz y los
    // informes la muestran para saber qué configuración produjo cada decisión.
    version: opt.version,
    temperature: opt.temperature,
    holdBand: opt.holdBand,
    weights: opt.weights,
    regime: {
      ...base.regime,
      adxLo: opt.regime.adxLo,
      adxHi: opt.regime.adxHi,
      trend: opt.regime.trend,
      range: opt.regime.range,
    },
  };
}

/**
 * ¿Esta clave está fuera de la lista blanca? Con la lista vacía, nadie lo está.
 *
 * Devuelve **un veto más**, que el llamante combina con la cuarentena mediante un OR. No sustituye a
 * ninguno de los que ya hay: una clave puede estar en la lista blanca y seguir vetada por su
 * expediente, y así debe ser.
 */
export function fueraDeListaBlanca(
  cfg: EnsembleConfig,
  symbol: string,
  interval: string,
): boolean {
  const lista = cfg.activeKeys ?? [];
  if (lista.length === 0) return false;
  return !lista.includes(`${symbol.toUpperCase()}:${interval}`);
}

/**
 * El veto efectivo de una clave: cuarentena **o** fuera de la lista blanca.
 *
 * Vive aquí y no suelto en `server.ts` porque es una regla, no un detalle de cableado: los vetos se
 * **suman**, nunca se sustituyen. Estar en la lista blanca no levanta una cuarentena puesta con
 * evidencia, y estar en cuarentena no se salva por aparecer en una lista.
 */
export function vetadaEfectiva(
  cfg: EnsembleConfig,
  symbol: string,
  interval: string,
  enCuarentena: boolean,
): boolean {
  return enCuarentena || fueraDeListaBlanca(cfg, symbol, interval);
}

/**
 * Especializa la configuración para un símbolo y temporalidad concretos.
 *
 * Deja resueltos los tres ajustes que dependen de la temporalidad —validez del plan, cuarentena y
 * factor de independencia— para que `buildSignal` siga leyendo un único objeto de configuración y
 * ningún punto de llamada tenga que acordarse de aplicarlos.
 */
export function forInterval(
  cfg: EnsembleConfig,
  interval: string,
  independenceFactor = 1,
  /** Cuarentena efectiva. Sin argumento manda `quarantine_intervals` de la configuración. */
  quarantined?: boolean,
): EnsembleConfig {
  const base = (cfg.quarantineIntervals ?? []).includes(interval);
  return {
    ...cfg,
    plan: { ...cfg.plan, validCandles: validCandlesFor(cfg, interval) },
    quarantined: quarantined ?? base,
    independenceFactor,
  };
}

interface RawRegimeMult {
  trend?: number;
  momentum?: number;
  reversion?: number;
}
interface RawConfig {
  version?: string;
  temperature?: number;
  hold_band?: number;
  weights?: Record<string, number>;
  external_weights?: Record<string, number>;
  regime?: {
    adx_threshold?: number;
    adx_lo?: number;
    adx_hi?: number;
    trend?: RawRegimeMult;
    range?: RawRegimeMult;
  };
  risk?: { atr_stop_mult?: number; tp_r_multiple?: number; risk_pct?: number };
  plan?: { valid_candles?: number; valid_candles_by_tf?: Record<string, number> };
  evaluation?: { horizon?: number; horizon_by_tf?: Record<string, number> };
  quarantine_intervals?: string[];
  use_optimized_configs?: boolean;
  active_keys?: string[];
  costs?: {
    enabled?: boolean;
    mode?: string;
    taker_pct?: number;
    maker_pct?: number;
    slippage_pct?: number;
  };
  macro?: {
    enabled?: boolean;
    w_macro?: number;
    enable_scaling?: boolean;
    tf_scale?: Record<string, number>;
    funding_weight?: number;
    trend_weight?: number;
    funding_scale?: number;
    trend_scale?: number;
    conflict_downgrade?: boolean;
    conflict_threshold?: number;
  };
  fundamental?: {
    mode?: 'off' | 'shadow' | 'active';
    w_fund?: number;
    start?: number;
    window_days?: number;
    absorbs_funding?: boolean;
  };
}

function mult(raw: RawRegimeMult | undefined, fallback: RegimeMultipliers): RegimeMultipliers {
  return {
    trend: raw?.trend ?? fallback.trend,
    momentum: raw?.momentum ?? fallback.momentum,
    reversion: raw?.reversion ?? fallback.reversion,
  };
}

export function fromRaw(raw: RawConfig): EnsembleConfig {
  const d = DEFAULT_ENSEMBLE;
  return {
    version: raw.version ?? d.version,
    temperature: raw.temperature ?? d.temperature,
    holdBand: raw.hold_band ?? d.holdBand,
    weights: raw.weights ?? d.weights,
    externalWeights: raw.external_weights ?? d.externalWeights,
    regime: {
      adxThreshold: raw.regime?.adx_threshold ?? d.regime.adxThreshold,
      adxLo: raw.regime?.adx_lo ?? d.regime.adxLo,
      adxHi: raw.regime?.adx_hi ?? d.regime.adxHi,
      trend: mult(raw.regime?.trend, d.regime.trend),
      range: mult(raw.regime?.range, d.regime.range),
    },
    risk: {
      atrStopMult: raw.risk?.atr_stop_mult ?? d.risk.atrStopMult,
      tpRMultiple: raw.risk?.tp_r_multiple ?? d.risk.tpRMultiple,
      riskPct: raw.risk?.risk_pct ?? d.risk.riskPct,
    },
    macro: {
      enabled: raw.macro?.enabled ?? d.macro.enabled,
      wMacro: raw.macro?.w_macro ?? d.macro.wMacro,
      fundingWeight: raw.macro?.funding_weight ?? d.macro.fundingWeight,
      trendWeight: raw.macro?.trend_weight ?? d.macro.trendWeight,
      fundingScale: raw.macro?.funding_scale ?? d.macro.fundingScale,
      trendScale: raw.macro?.trend_scale ?? d.macro.trendScale,
      conflictDowngrade: raw.macro?.conflict_downgrade ?? d.macro.conflictDowngrade,
      conflictThreshold: raw.macro?.conflict_threshold ?? d.macro.conflictThreshold,
      enableScaling: raw.macro?.enable_scaling ?? d.macro.enableScaling,
      tfScale: raw.macro?.tf_scale ?? d.macro.tfScale,
    },
    fundamental: {
      mode: raw.fundamental?.mode ?? d.fundamental.mode,
      wFund: raw.fundamental?.w_fund ?? d.fundamental.wFund,
      start: raw.fundamental?.start ?? d.fundamental.start,
      windowDays: raw.fundamental?.window_days ?? d.fundamental.windowDays,
      absorbsFunding: raw.fundamental?.absorbs_funding ?? d.fundamental.absorbsFunding,
    },
    plan: {
      validCandles: raw.plan?.valid_candles ?? d.plan.validCandles,
      validCandlesByTf: raw.plan?.valid_candles_by_tf ?? d.plan.validCandlesByTf,
    },
    evaluation: {
      horizon: raw.evaluation?.horizon ?? d.evaluation.horizon,
      horizonByTf: raw.evaluation?.horizon_by_tf ?? d.evaluation.horizonByTf,
    },
    quarantineIntervals: raw.quarantine_intervals ?? d.quarantineIntervals,
    useOptimizedConfigs: raw.use_optimized_configs ?? d.useOptimizedConfigs,
    activeKeys: raw.active_keys ?? d.activeKeys,
    costs: {
      enabled: raw.costs?.enabled ?? d.costs.enabled,
      mode: raw.costs?.mode === 'maker' ? 'maker' : 'taker',
      takerPct: raw.costs?.taker_pct ?? d.costs.takerPct,
      makerPct: raw.costs?.maker_pct ?? d.costs.makerPct,
      slippagePct: raw.costs?.slippage_pct ?? d.costs.slippagePct,
    },
  };
}

export function loadEnsemble(path: string): EnsembleConfig {
  return fromRaw(parse(readFileSync(path, 'utf8')) as RawConfig);
}

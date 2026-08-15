import type pg from 'pg';
import { intervalMs, type Interval } from '../domain/candle.js';
import type { Signal } from '../domain/signal.js';
import type { PlanLevels } from '../ensemble/plan.js';
import type { SnapshotRow } from '../snapshots/tracking.js';

function score(signal: Signal, key: string): number | null {
  return signal.votes.find((v) => v.key === key)?.score ?? null;
}
function value(signal: Signal, key: string): number | null {
  return signal.votes.find((v) => v.key === key)?.value ?? null;
}

/** Persiste una instantánea completa del escenario (para análisis y entrenamiento de IA). */
export interface SnapshotStatsTf {
  interval: string;
  total: number;
  tp: number;
  sl: number;
  timeout: number;
  abiertos: number;
  winRate: number | null;
  expectancy: number | null;
}

export interface SnapshotStats {
  total: number;
  tp: number;
  sl: number;
  timeout: number;
  abiertos: number;
  sinPlan: number;
  /** Decisiones de NO TRADE registradas con su motivo (subconjunto de `sinPlan`). */
  noTrade: number;
  /**
   * Decisiones sombra ya evaluadas: lo que una temporalidad en cuarentena habría hecho.
   *
   * **No es rendimiento y no entra en `expectancy` ni en `winRate`**: nadie operó. Se cuenta aparte
   * porque es lo que decide si la cuarentena se levanta. Confundir ambas cosas apuntaría como
   * ganado un dinero que no existe.
   */
  sombraEvaluadas: number;
  sombraExpectancy: number | null;
  resueltos: number;
  winRate: number | null;
  expectancy: number | null;
  porTf: SnapshotStatsTf[];
}

export class SnapshotsRepo {
  constructor(private readonly pool: pg.Pool) {}

  async record(
    signal: Signal,
    interval: string,
    levels: PlanLevels | null,
    note: string | undefined,
    /** Plan que se habría emitido si la temporalidad no estuviera en cuarentena. */
    shadowLevels: PlanLevels | null = null,
  ): Promise<string> {
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO snapshots (
        symbol, interval, price, atr, adx, regime_label,
        net, prob_buy, prob_hold, prob_sell, action, direction, confidence,
        macro_bias, funding_rate, weekly_trend, macro_label, confluence,
        ema_cross_score, macd_score, rsi14_score, rsi14_value, bbands_score,
        stoch14_score, supertrend_score, meta_confidence, adx14_value, atr14_value, reditum_sniper_score, reditum_poc_score,
        plan_entry, plan_stop, plan_take_profit, plan_size, plan_rr, valid_until,
        model_version, source, note, raw_signal, hold_reason, independence_factor,
        shadow_action, shadow_direction, shadow_entry, shadow_stop, shadow_take_profit,
        candle_open
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,
        $24,$25,$26,$27,$28,$29,$30,
        $31,$32,$33,$34,$35,$36,
        $37,'manual',$38,$39,$40,$41,
        $42,$43,$44,$45,$46,
        -- Vela a la que pertenece la decisión: es lo que garantiza una sola por vela.
        to_timestamp(floor(extract(epoch FROM now()) / $47) * $47)
      ) RETURNING id`,
      [
        signal.symbol,
        interval,
        signal.price,
        signal.atr,
        signal.regime.adx,
        signal.regime.label,
        signal.net,
        signal.probs.BUY,
        signal.probs.HOLD,
        signal.probs.SELL,
        signal.action,
        signal.direction,
        signal.confidence,
        signal.macro?.bias ?? null,
        signal.macro?.funding ?? null,
        signal.macro?.weekly_trend ?? null,
        signal.macro?.label ?? null,
        signal.macro?.confluence ?? null,
        score(signal, 'ema_cross'),
        score(signal, 'macd'),
        score(signal, 'rsi14'),
        value(signal, 'rsi14'),
        score(signal, 'bbands'),
        score(signal, 'stoch14'),
        score(signal, 'supertrend'),
        signal.meta_confidence ?? null,
        value(signal, 'adx14'),
        value(signal, 'atr14'),
        score(signal, 'reditum_sniper'),
        score(signal, 'reditum_poc'),
        levels?.entry ?? null,
        levels?.stop ?? null,
        levels?.takeProfit ?? null,
        levels?.size ?? null,
        levels?.rr ?? null,
        signal.valid_until,
        signal.model_version,
        note ?? null,
        JSON.stringify(signal),
        signal.hold_reason ?? null,
        signal.independence_factor ?? null,
        signal.shadow_action ?? null,
        signal.shadow_direction ?? null,
        shadowLevels?.entry ?? null,
        shadowLevels?.stop ?? null,
        shadowLevels?.takeProfit ?? null,
        Math.round(intervalMs(interval as Interval) / 1000),
      ],
    );
    return res.rows[0]?.id ?? '';
  }

  async list(
    symbol: string,
    limit: number,
  ): Promise<{ rows: SnapshotRow[]; total: number }> {
    const res = await this.pool.query<SnapshotRow>(
      `SELECT id, captured_at, symbol, interval, action, direction, price, confidence,
              regime_label, net, prob_buy, prob_hold, prob_sell,
              macro_bias, plan_entry, plan_stop, plan_take_profit, plan_rr, valid_until,
              hold_reason, independence_factor,
              outcome_result, outcome_return_r
       FROM snapshots WHERE symbol = $1 ORDER BY captured_at DESC LIMIT $2`,
      [symbol.toUpperCase(), limit],
    );
    const count = await this.pool.query<{ n: string }>(
      'SELECT COUNT(*)::text AS n FROM snapshots WHERE symbol = $1',
      [symbol.toUpperCase()],
    );
    return { rows: res.rows, total: Number(count.rows[0]?.n ?? 0) };
  }

  /**
   * Resumen calculado en la base de datos sobre TODOS los registros del símbolo.
   *
   * Antes el resumen se calculaba en el navegador sobre la página cargada (500 filas como mucho) y
   * mezclando resultado histórico con seguimiento en vivo, así que los totales no cuadraban.
   *
   * Además se cuenta UNA decisión por vela: la captura antigua, con enfriamiento fijo de 20 minutos,
   * generaba hasta 12 registros de la misma vela de 4h. Contarlos por separado fingía tener doce
   * observaciones independientes cuando en realidad era una sola.
   */
  async stats(symbol: string): Promise<SnapshotStats> {
    const sym = symbol.toUpperCase();
    const res = await this.pool.query<{
      total: number; tp: number; sl: number; timeout: number;
      abiertos: number; sin_plan: number; no_trade: number; expectancy: string | null;
      sombra_evaluadas: number; sombra_expectancy: string | null;
    }>(
      `WITH una_por_vela AS (
         SELECT DISTINCT ON (interval, candle_open) *
           FROM snapshots WHERE symbol = $1
          ORDER BY interval, candle_open, captured_at ASC
       )
       SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE outcome_result = 'tp')::int AS tp,
              COUNT(*) FILTER (WHERE outcome_result = 'sl')::int AS sl,
              COUNT(*) FILTER (WHERE outcome_result = 'timeout')::int AS timeout,
              COUNT(*) FILTER (WHERE outcome_result IS NULL
                               AND direction IN ('LONG','SHORT')
                               AND plan_entry IS NOT NULL)::int AS abiertos,
              COUNT(*) FILTER (WHERE direction = 'FLAT' OR plan_entry IS NULL)::int AS sin_plan,
              COUNT(*) FILTER (WHERE hold_reason IS NOT NULL)::int AS no_trade,
              -- La expectancy solo mira lo que tuvo desenlace. Un NO TRADE nunca lo tiene (no hay
              -- plan que evaluar), así que registrar los descartes no mueve ni un decimal de estas
              -- cifras: solo llena el hueco que tenía el dataset.
              AVG(outcome_return_r) FILTER (WHERE outcome_result IS NOT NULL) AS expectancy,
              -- Expediente sombra, en columnas propias: lo que una temporalidad en cuarentena
              -- habría hecho. Va aparte de la expectancy porque NO se operó, y contarlo como
              -- rendimiento sería apuntarse un dinero que nadie ganó.
              COUNT(*) FILTER (WHERE shadow_outcome_result IS NOT NULL)::int AS sombra_evaluadas,
              AVG(shadow_outcome_return_r) FILTER (WHERE shadow_outcome_result IS NOT NULL)
                AS sombra_expectancy
         FROM una_por_vela`,
      [sym],
    );
    const porTf = await this.pool.query<{
      interval: string; total: number; tp: number; sl: number;
      timeout: number; abiertos: number; expectancy: string | null;
    }>(
      `WITH una_por_vela AS (
         SELECT DISTINCT ON (interval, candle_open) *
           FROM snapshots WHERE symbol = $1
          ORDER BY interval, candle_open, captured_at ASC
       )
       SELECT interval,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE outcome_result = 'tp')::int AS tp,
              COUNT(*) FILTER (WHERE outcome_result = 'sl')::int AS sl,
              COUNT(*) FILTER (WHERE outcome_result = 'timeout')::int AS timeout,
              COUNT(*) FILTER (WHERE outcome_result IS NULL
                               AND direction IN ('LONG','SHORT')
                               AND plan_entry IS NOT NULL)::int AS abiertos,
              AVG(outcome_return_r) FILTER (WHERE outcome_result IS NOT NULL) AS expectancy
         FROM una_por_vela GROUP BY interval`,
      [sym],
    );
    const fila = res.rows[0];
    const num = (v: string | null): number | null => (v === null ? null : Number(v));
    const base = {
      total: fila?.total ?? 0,
      tp: fila?.tp ?? 0,
      sl: fila?.sl ?? 0,
      timeout: fila?.timeout ?? 0,
      abiertos: fila?.abiertos ?? 0,
      sinPlan: fila?.sin_plan ?? 0,
      noTrade: fila?.no_trade ?? 0,
      sombraEvaluadas: fila?.sombra_evaluadas ?? 0,
      sombraExpectancy: num(fila?.sombra_expectancy ?? null),
      expectancy: num(fila?.expectancy ?? null),
    };
    return {
      ...base,
      resueltos: base.tp + base.sl + base.timeout,
      // Tasa de acierto solo entre las que tocaron objetivo o stop: un «timeout» no es ni acierto
      // ni fallo, se cerró por tiempo con el resultado que llevara.
      winRate: base.tp + base.sl > 0 ? base.tp / (base.tp + base.sl) : null,
      porTf: porTf.rows.map((r) => ({
        interval: r.interval,
        total: r.total,
        tp: r.tp,
        sl: r.sl,
        timeout: r.timeout,
        abiertos: r.abiertos,
        winRate: r.tp + r.sl > 0 ? r.tp / (r.tp + r.sl) : null,
        expectancy: num(r.expectancy),
      })),
    };
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.pool.query('DELETE FROM snapshots WHERE id = $1', [id]);
    return (res.rowCount ?? 0) > 0;
  }
}

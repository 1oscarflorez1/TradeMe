import type pg from 'pg';
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
export class SnapshotsRepo {
  constructor(private readonly pool: pg.Pool) {}

  async record(
    signal: Signal,
    interval: string,
    levels: PlanLevels | null,
    note: string | undefined,
  ): Promise<string> {
    const res = await this.pool.query<{ id: string }>(
      `INSERT INTO snapshots (
        symbol, interval, price, atr, adx, regime_label,
        net, prob_buy, prob_hold, prob_sell, action, direction, confidence,
        macro_bias, funding_rate, weekly_trend, macro_label, confluence,
        ema_cross_score, macd_score, rsi14_score, rsi14_value, bbands_score,
        stoch14_score, adx14_value, atr14_value, reditum_sniper_score, reditum_poc_score,
        plan_entry, plan_stop, plan_take_profit, plan_size, plan_rr, valid_until,
        model_version, source, note, raw_signal
      ) VALUES (
        $1,$2,$3,$4,$5,$6,
        $7,$8,$9,$10,$11,$12,$13,
        $14,$15,$16,$17,$18,
        $19,$20,$21,$22,$23,
        $24,$25,$26,$27,$28,
        $29,$30,$31,$32,$33,$34,
        $35,'manual',$36,$37
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
      ],
    );
    return res.rows[0]?.id ?? '';
  }

  async list(symbol: string, limit: number): Promise<SnapshotRow[]> {
    const res = await this.pool.query<SnapshotRow>(
      `SELECT id, captured_at, symbol, interval, action, direction, price, confidence,
              regime_label, net, prob_buy, prob_hold, prob_sell,
              macro_bias, plan_entry, plan_stop, plan_take_profit, plan_rr, valid_until,
              outcome_result, outcome_return_r
       FROM snapshots WHERE symbol = $1 ORDER BY captured_at DESC LIMIT $2`,
      [symbol.toUpperCase(), limit],
    );
    return res.rows;
  }
}

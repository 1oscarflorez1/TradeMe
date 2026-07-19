export interface SnapshotRow {
  id: string;
  captured_at: string;
  symbol: string;
  interval: string;
  action: string;
  direction: 'LONG' | 'SHORT' | 'FLAT';
  price: number;
  confidence: number | null;
  regime_label: string | null;
  net: number | null;
  prob_buy: number | null;
  prob_hold: number | null;
  prob_sell: number | null;
  macro_bias: number | null;
  plan_entry: number | null;
  plan_stop: number | null;
  plan_take_profit: number | null;
  plan_rr: number | null;
  valid_until: string | null;
  outcome_result: string | null;
  outcome_return_r: number | null;
}

export type TrackingStatus = 'tp' | 'sl' | 'en_curso' | 'sin_plan';

export interface SnapshotTracking {
  status: TrackingStatus;
  liveR: number | null;
  expired: boolean;
}

/** Estado en vivo de un snapshot comparando el precio actual con sus niveles. */
export function trackSnapshot(
  row: SnapshotRow,
  currentPrice: number,
  now: number,
): SnapshotTracking {
  const expired = row.valid_until ? now > Date.parse(row.valid_until) : false;

  if (
    row.direction === 'FLAT' ||
    row.plan_entry === null ||
    row.plan_stop === null ||
    row.plan_take_profit === null
  ) {
    return { status: 'sin_plan', liveR: null, expired };
  }

  const dir = row.direction === 'LONG' ? 1 : -1;
  const risk = Math.abs(row.plan_entry - row.plan_stop);
  const liveR = risk > 0 ? (dir * (currentPrice - row.plan_entry)) / risk : null;

  let status: TrackingStatus = 'en_curso';
  if (dir === 1) {
    if (currentPrice >= row.plan_take_profit) status = 'tp';
    else if (currentPrice <= row.plan_stop) status = 'sl';
  } else {
    if (currentPrice <= row.plan_take_profit) status = 'tp';
    else if (currentPrice >= row.plan_stop) status = 'sl';
  }
  return { status, liveR, expired };
}

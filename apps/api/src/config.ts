import { z } from 'zod';
import { INTERVALS, isInterval, type Interval } from './domain/candle.js';
import type { Subscription } from './adapters/data-adapter.js';

const EnvSchema = z.object({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ENABLE_LIVE_TRADING: z.enum(['true', 'false']).default('false'),
  // Modo solo-técnico: el sesgo macro/fundamental no se inyecta en la decisión en vivo.
  MACRO_ENABLED: z.enum(['true', 'false']).default('false'),
  DATABASE_URL: z.string().optional(),
  TRADEME_SYMBOLS: z.string().default('BTCUSDT'),
  TRADEME_INTERVALS: z.string().default('1m,5m,15m,30m,1h,4h,1d,1w,1M'),
  // Señales externas (TradingView). Si el secret está vacío, el endpoint acepta en dev.
  TV_WEBHOOK_SECRET: z.string().optional(),
  EXTERNAL_SIGNALS_CONFIG: z.string().default('apps/api/config/external_signals.yaml'),
  // CORS: lista de orígenes separada por comas; vacío = permitir cualquiera (dev).
  CORS_ORIGIN: z.string().optional(),
  ENSEMBLE_CONFIG: z.string().default('artifacts/ensemble.yaml'),
  CALIBRATORS_PATH: z.string().default('artifacts/calibrators.json'),
  OPTIMIZED_ENSEMBLE: z.string().default('artifacts/ensemble.optimized.yaml'),
  OPT_REPORT_PATH: z.string().default('artifacts/optimization_report.json'),
  VAPID_PUBLIC_KEY: z.string().default('BEg-pAQi-VrkEr0n9OpokYqzXsBq7Ub_ZqTpGkUrwPZSBb3PlMbj5Hb4qcjJGqydWcqcUnUFrO6EE5gnw0_BIss'),
  VAPID_PRIVATE_KEY: z.string().default('dUfNiCSsZ-NL-v543jUw-cyRwPD0AX29bz9Jt12tbFI'),
  VAPID_SUBJECT: z.string().default('mailto:trademe@example.com'),
  PUSH_MIN_CONFIDENCE: z.coerce.number().default(0.65),
  PUSH_COOLDOWN_MS: z.coerce.number().int().default(600000),

  MIGRATIONS_DIR: z.string().default('infra/postgres/migrations'),
  QUANT_URL: z.string().optional(),
  ACCOUNT_EQUITY: z.coerce.number().positive().default(10_000),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}

export function parseSymbols(env: Env): string[] {
  return env.TRADEME_SYMBOLS.split(',')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
}

export function parseIntervals(env: Env): Interval[] {
  const parsed = env.TRADEME_INTERVALS.split(',')
    .map((s) => s.trim())
    .filter(isInterval);
  return parsed.length > 0 ? parsed : [...INTERVALS];
}

export function buildSubscriptions(env: Env): Subscription[] {
  const subs: Subscription[] = [];
  for (const symbol of parseSymbols(env)) {
    for (const interval of parseIntervals(env)) {
      subs.push({ symbol, interval });
    }
  }
  return subs;
}

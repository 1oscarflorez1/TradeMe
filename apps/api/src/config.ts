import { z } from 'zod';

const EnvSchema = z.object({
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  // La ejecución con dinero real SIEMPRE va detrás de este flag, desactivado por defecto.
  ENABLE_LIVE_TRADING: z.enum(['true', 'false']).default('false'),
});

export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return EnvSchema.parse(source);
}

import { buildApp } from './app.js';
import { attachStream } from './ws.js';
import { loadEnv } from './config.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const app = buildApp();
  await app.ready();
  attachStream(app.server);
  await app.listen({ host: env.API_HOST, port: env.API_PORT });
  app.log.info(`WS base disponible en ws://${env.API_HOST}:${env.API_PORT}/stream`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

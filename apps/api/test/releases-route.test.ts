import { describe, expect, it } from 'vitest';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app.js';
import { Releases } from '../src/releases/parse.js';
import { makeDeps } from './helpers.js';

const CHANGELOG = join(dirname(fileURLToPath(import.meta.url)), '../../../CHANGELOG.md');

/** La ruta de la que depende la pestaña Novedades: si cae, el equipo deja de ver qué cambió. */
describe('GET /releases', () => {
  it('devuelve el historial y la versión en ejecución', async () => {
    const app = buildApp({ ...makeDeps(), releases: new Releases(CHANGELOG) });
    const res = await app.inject({ method: 'GET', url: '/releases' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      actual: string;
      total: number;
      releases: Array<{ version: string; fecha: string | null }>;
    };
    expect(body.total).toBeGreaterThan(20);
    expect(body.releases).toHaveLength(body.total);
    expect(body.actual).toMatch(/^\d+\.\d+\.\d+$/);
    await app.close();
  });

  it('la versión en ejecución coincide con la primera del registro', async () => {
    // Es la misma condición que comprueba la puerta de CI, aquí desde dentro de la aplicación:
    // si se rompiera, el portal mostraría un historial que no corresponde a lo que ejecuta.
    const app = buildApp({ ...makeDeps(), releases: new Releases(CHANGELOG) });
    const body = (await app.inject({ method: 'GET', url: '/releases' })).json() as {
      actual: string;
      releases: Array<{ version: string }>;
    };
    expect(body.releases[0]?.version).toBe(body.actual);
    await app.close();
  });

  it('acepta un límite', async () => {
    const app = buildApp({ ...makeDeps(), releases: new Releases(CHANGELOG) });
    const body = (await app.inject({ method: 'GET', url: '/releases?limite=3' })).json() as {
      releases: unknown[];
    };
    expect(body.releases).toHaveLength(3);
    await app.close();
  });

  it('devuelve una versión concreta, y 404 si no existe', async () => {
    const app = buildApp({ ...makeDeps(), releases: new Releases(CHANGELOG) });
    const ok = await app.inject({ method: 'GET', url: '/releases?version=0.34.0' });
    expect(ok.statusCode).toBe(200);
    expect((ok.json() as { release: { version: string } }).release.version).toBe('0.34.0');

    const no = await app.inject({ method: 'GET', url: '/releases?version=99.0.0' });
    expect(no.statusCode).toBe(404);
    await app.close();
  });

  it('sin historial configurado responde 503, no 500', async () => {
    const app = buildApp(makeDeps());
    const res = await app.inject({ method: 'GET', url: '/releases' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});

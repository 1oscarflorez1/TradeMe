import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { fromRaw, loadEnsemble } from '../src/ensemble/config.js';
import { modoEfectivo } from '../src/metamodel/policy.js';
import { buildApp } from '../src/app.js';
import type { MetaModel } from '../src/metamodel/apply.js';
import { makeDeps } from './helpers.js';

/**
 * El meta-modelo, retirado en 0.74.0.
 *
 * En walk-forward semanal no supera al azar (AUC 0,528 frente a un P95 de 0,535), filtrar con él
 * empeora la expectancy y pierde contra «la dirección que ganó la semana pasada». La retirada es una
 * bandera del yaml, `metamodel.enabled`, que la api lee igual que quant (`metamodelo_activo`).
 */

describe('la bandera del yaml', () => {
  it('el ensemble.yaml desplegado lo tiene retirado', () => {
    const cfg = loadEnsemble(join(__dirname, '..', '..', '..', 'artifacts', 'ensemble.yaml'));
    expect(cfg.metamodelEnabled).toBe(false);
  });

  it('sin la sección sigue activo: es el comportamiento anterior', () => {
    expect(fromRaw({}).metamodelEnabled).toBe(true);
    expect(fromRaw({ metamodel: {} }).metamodelEnabled).toBe(true);
    expect(fromRaw({ metamodel: { enabled: false } }).metamodelEnabled).toBe(false);
  });
});

describe('el modo con el que se aplica', () => {
  it('retirado es off, diga lo que diga su gobierno', () => {
    for (const mode of ['shadow', 'modulate', 'veto'] as const) {
      expect(modoEfectivo(false, { mode })).toBe('off');
      expect(modoEfectivo(true, { mode })).toBe(mode);
    }
  });
});

describe('/status', () => {
  it('con el modo off lo presenta como desactivado, aunque haya un modelo publicado', async () => {
    const deps = makeDeps({ metaModel: { ready: true } as unknown as MetaModel });
    let modo: 'off' | 'shadow' = 'off';
    Object.defineProperty(deps, 'metaMode', { get: () => modo });
    const app = buildApp(deps);

    const leer = async () => {
      const res = await app.inject({ method: 'GET', url: '/status' });
      const cuerpo = res.json() as { components: Array<{ key: string; status: string; detail: string }> };
      return cuerpo.components.find((c) => c.key === 'meta');
    };

    const retirado = await leer();
    expect(retirado?.status).toBe('na');
    expect(retirado?.detail).toContain('desactivado');

    // Y el modo se lee en cada petición: reactivarlo en el yaml se ve sin reiniciar.
    modo = 'shadow';
    const activo = await leer();
    expect(activo?.status).toBe('ok');
    expect(activo?.detail).toContain('modo shadow');
    await app.close();
  });
});

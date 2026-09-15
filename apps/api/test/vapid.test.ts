import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadEnv } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { Pusher } from '../src/push/push.js';
import { resolverClavesVapid, type OrigenVapid } from '../src/push/vapid.js';
import { makeDeps } from './helpers.js';

/**
 * Claves VAPID sin valores en el código (0.75.1).
 *
 * `config.ts` traía un par por defecto con la privada publicada en el repositorio. Ahora producción
 * las toma solo del entorno y desarrollo, si faltan, genera unas al arrancar.
 */

const PAR_FALSO = { publicKey: 'publica-generada', privateKey: 'privada-generada' };

function entorno(vars: Record<string, string> = {}) {
  return loadEnv({ ...vars });
}

function generadorQueNoDebeLlamarse(): never {
  throw new Error('no debe generar claves');
}

describe('config.ts', () => {
  it('sin variables, las claves VAPID quedan vacías: no hay par de reserva', () => {
    const env = entorno();
    expect(env.VAPID_PUBLIC_KEY).toBe('');
    expect(env.VAPID_PRIVATE_KEY).toBe('');
    expect(env.NODE_ENV).toBe('development');
  });

  it('no contiene literales con forma de clave', () => {
    const fuente = readFileSync(join(__dirname, '..', 'src', 'config.ts'), 'utf8');
    // Una clave VAPID en base64url: 43 caracteres la privada, 87 la pública.
    expect(fuente).not.toMatch(/['"][A-Za-z0-9_-]{40,}['"]/);
  });
});

describe('producción', () => {
  it('usa las claves del entorno tal cual', () => {
    const v = resolverClavesVapid(
      entorno({
        NODE_ENV: 'production',
        VAPID_PUBLIC_KEY: ' pub ',
        VAPID_PRIVATE_KEY: 'priv',
        VAPID_SUBJECT: 'mailto:equipo@ejemplo.com',
      }),
      generadorQueNoDebeLlamarse,
    );
    expect(v).toMatchObject({
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:equipo@ejemplo.com',
      origen: 'entorno',
      nivel: 'info',
    });
  });

  it('sin claves no genera nada: apaga el push y avisa', () => {
    const v = resolverClavesVapid(entorno({ NODE_ENV: 'production' }), generadorQueNoDebeLlamarse);
    expect(v.origen).toBe('ninguna');
    expect(v.publicKey).toBe('');
    expect(v.privateKey).toBe('');
    expect(v.nivel).toBe('warn');
    expect(v.mensaje).toContain('push desactivado');
    expect(new Pusher(v.publicKey, v.privateKey, v.subject).enabled).toBe(false);
  });

  it('el mensaje de arranque nunca lleva las claves', () => {
    const v = resolverClavesVapid(
      entorno({ NODE_ENV: 'production', VAPID_PUBLIC_KEY: 'pub-secreta', VAPID_PRIVATE_KEY: 'priv-secreta' }),
    );
    expect(v.mensaje).not.toContain('pub-secreta');
    expect(v.mensaje).not.toContain('priv-secreta');
  });
});

describe('desarrollo y tests', () => {
  it('sin claves genera un par al arrancar', () => {
    let llamadas = 0;
    const v = resolverClavesVapid(entorno(), () => {
      llamadas += 1;
      return PAR_FALSO;
    });
    expect(llamadas).toBe(1);
    expect(v).toMatchObject({ ...PAR_FALSO, origen: 'efimeras', nivel: 'info' });
  });

  it('NODE_ENV=test (el de vitest) también genera', () => {
    expect(resolverClavesVapid(entorno({ NODE_ENV: 'test' }), () => PAR_FALSO).origen).toBe('efimeras');
  });

  it('con claves en el entorno las respeta y no genera', () => {
    const v = resolverClavesVapid(
      entorno({ VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' }),
      generadorQueNoDebeLlamarse,
    );
    expect(v.origen).toBe('entorno');
  });

  it('el par generado es válido para web-push: el push queda activo', () => {
    const v = resolverClavesVapid(entorno());
    expect(v.publicKey).toMatch(/^[A-Za-z0-9_-]{87}$/);
    expect(v.privateKey).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new Pusher(v.publicKey, v.privateKey, v.subject).enabled).toBe(true);
    // Y es de verdad dinámico: otro arranque, otro par.
    expect(resolverClavesVapid(entorno()).privateKey).not.toBe(v.privateKey);
  });
});

describe('media pareja', () => {
  it.each(['production', 'development'])('en %s apaga el push y dice qué falta', (NODE_ENV) => {
    const soloPublica = resolverClavesVapid(
      entorno({ NODE_ENV, VAPID_PUBLIC_KEY: 'pub' }),
      generadorQueNoDebeLlamarse,
    );
    expect(soloPublica).toMatchObject({ origen: 'ninguna', publicKey: '', nivel: 'warn' });
    expect(soloPublica.mensaje).toContain('falta VAPID_PRIVATE_KEY');

    const soloPrivada = resolverClavesVapid(
      entorno({ NODE_ENV, VAPID_PRIVATE_KEY: 'priv' }),
      generadorQueNoDebeLlamarse,
    );
    expect(soloPrivada).toMatchObject({ origen: 'ninguna', privateKey: '' });
    expect(soloPrivada.mensaje).toContain('falta VAPID_PUBLIC_KEY');
  });
});

describe('/status y /push/vapid', () => {
  async function push(origen: OrigenVapid | undefined, vapidPublicKey?: string) {
    const app = buildApp(makeDeps({ vapidOrigen: origen, vapidPublicKey }));
    const status = (await app.inject({ method: 'GET', url: '/status' })).json() as {
      components: Array<{ key: string; status: string; detail: string }>;
    };
    const clave = (await app.inject({ method: 'GET', url: '/push/vapid' })).json() as {
      publicKey: string | null;
    };
    await app.close();
    return { componente: status.components.find((c) => c.key === 'push'), clave: clave.publicKey };
  }

  it('refleja las claves que se usan, no las variables de entorno', async () => {
    const efimeras = await push('efimeras', 'PUB-GENERADA');
    expect(efimeras.componente?.status).toBe('ok');
    expect(efimeras.componente?.detail).toContain('efímeras');
    expect(efimeras.clave).toBe('PUB-GENERADA');

    const configuradas = await push('entorno', 'PUB');
    expect(configuradas.componente).toMatchObject({ status: 'ok', detail: 'claves VAPID configuradas' });

    const ninguna = await push('ninguna');
    expect(ninguna.componente?.status).toBe('na');
    expect(ninguna.clave).toBeNull();
  });
});

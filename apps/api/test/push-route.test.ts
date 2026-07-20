import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps } from './helpers.js';

describe('push routes', () => {
  it('devuelve la clave VAPID pública', async () => {
    const app = buildApp(makeDeps({ vapidPublicKey: 'PUBKEY' }));
    const res = await app.inject({ method: 'GET', url: '/push/vapid' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { publicKey: string }).publicKey).toBe('PUBKEY');
    await app.close();
  });

  it('guarda una suscripción válida', async () => {
    let saved = false;
    const app = buildApp(
      makeDeps({
        savePushSub: async () => {
          saved = true;
        },
      }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/push/subscribe',
      payload: {
        endpoint: 'https://push.example.com/abc',
        keys: { p256dh: 'x', auth: 'y' },
      },
    });
    expect(res.statusCode).toBe(200);
    expect(saved).toBe(true);
    await app.close();
  });

  it('rechaza suscripción inválida', async () => {
    const app = buildApp(makeDeps({ savePushSub: async () => undefined }));
    const res = await app.inject({ method: 'POST', url: '/push/subscribe', payload: { foo: 1 } });
    expect(res.statusCode).toBe(400);
    await app.close();
  });
});

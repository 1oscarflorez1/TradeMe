import { describe, it, expect } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeDeps } from './helpers.js';
import { hashPassword, verifyPassword } from '../src/auth/password.js';
import { signJwt, verifyJwt } from '../src/auth/jwt.js';
import type { UserRow } from '../src/db/users-repo.js';

const SECRET = 'test-secret-no-usar-en-prod';

function sampleUser(password: string): UserRow {
  return {
    id: 'u1',
    created_at: '2026-07-25T00:00:00Z',
    email: 'edgar@equipo.com',
    password_hash: hashPassword(password),
  };
}

describe('password hashing (scrypt)', () => {
  it('verifica la contraseña correcta', () => {
    const hash = hashPassword('clave-fuerte-123');
    expect(verifyPassword('clave-fuerte-123', hash)).toBe(true);
  });

  it('rechaza la contraseña incorrecta', () => {
    const hash = hashPassword('clave-fuerte-123');
    expect(verifyPassword('otra-clave', hash)).toBe(false);
  });

  it('rechaza un hash con formato inválido', () => {
    expect(verifyPassword('cualquiera', 'no-es-un-hash-scrypt')).toBe(false);
  });

  it('dos hashes de la misma contraseña son distintos (salt aleatorio)', () => {
    expect(hashPassword('igual')).not.toBe(hashPassword('igual'));
  });
});

describe('JWT (HS256 a mano)', () => {
  it('firma y verifica un token válido', () => {
    const token = signJwt({ sub: 'u1', email: 'edgar@equipo.com' }, SECRET);
    const payload = verifyJwt(token, SECRET);
    expect(payload).not.toBeNull();
    expect(payload?.sub).toBe('u1');
    expect(payload?.email).toBe('edgar@equipo.com');
  });

  it('rechaza un token firmado con otro secreto', () => {
    const token = signJwt({ sub: 'u1', email: 'edgar@equipo.com' }, SECRET);
    expect(verifyJwt(token, 'otro-secreto')).toBeNull();
  });

  it('rechaza un token manipulado', () => {
    const token = signJwt({ sub: 'u1', email: 'edgar@equipo.com' }, SECRET);
    const [head, , sig] = token.split('.');
    const tampered = `${head}.${Buffer.from('{"sub":"otro","email":"x","iat":0,"exp":9999999999}').toString('base64url')}.${sig}`;
    expect(verifyJwt(tampered, SECRET)).toBeNull();
  });

  it('rechaza un token expirado', () => {
    const token = signJwt({ sub: 'u1', email: 'edgar@equipo.com' }, SECRET, -1);
    expect(verifyJwt(token, SECRET)).toBeNull();
  });

  it('rechaza texto que no tiene forma de JWT', () => {
    expect(verifyJwt('no.es.jwt.valido', SECRET)).toBeNull();
    expect(verifyJwt('tampoco', SECRET)).toBeNull();
  });
});

describe('rutas /auth/login y /auth/me', () => {
  it('login con credenciales correctas devuelve token', async () => {
    const user = sampleUser('clave-fuerte-123');
    const app = buildApp(
      makeDeps({ authSecret: SECRET, findUserByEmail: async () => user }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: 'clave-fuerte-123' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { token: string; user: { email: string } };
    expect(body.token.split('.')).toHaveLength(3);
    expect(body.user.email).toBe(user.email);
    await app.close();
  });

  it('login con contraseña incorrecta -> 401', async () => {
    const user = sampleUser('clave-fuerte-123');
    const app = buildApp(
      makeDeps({ authSecret: SECRET, findUserByEmail: async () => user }),
    );
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: user.email, password: 'incorrecta' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('login con email inexistente -> 401', async () => {
    const app = buildApp(makeDeps({ authSecret: SECRET, findUserByEmail: async () => null }));
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'nadie@equipo.com', password: 'x' },
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('sin authSecret configurado, /auth/login responde 503 (no hay auth activa)', async () => {
    const app = buildApp(makeDeps());
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: 'x@x.com', password: 'x' },
    });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('/auth/me sin token -> 401', async () => {
    const app = buildApp(makeDeps({ authSecret: SECRET }));
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('/auth/me con token válido -> devuelve la identidad', async () => {
    const app = buildApp(makeDeps({ authSecret: SECRET }));
    const token = signJwt({ sub: 'u1', email: 'edgar@equipo.com' }, SECRET);
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { email: string }).email).toBe('edgar@equipo.com');
    await app.close();
  });
});

describe('middleware de protección de rutas', () => {
  it('con authSecret configurado, una ruta protegida sin token -> 401', async () => {
    const app = buildApp(makeDeps({ authSecret: SECRET }));
    const res = await app.inject({ method: 'GET', url: '/candles?symbol=BTCUSDT&interval=1m' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });

  it('con authSecret configurado, una ruta protegida con token válido -> pasa', async () => {
    const app = buildApp(makeDeps({ authSecret: SECRET, getHistory: async () => [] }));
    const token = signJwt({ sub: 'u1', email: 'edgar@equipo.com' }, SECRET);
    const res = await app.inject({
      method: 'GET',
      url: '/candles?symbol=BTCUSDT&interval=1m',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('/health nunca requiere token, aunque authSecret esté configurado', async () => {
    const app = buildApp(makeDeps({ authSecret: SECRET }));
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { authRequired: boolean }).authRequired).toBe(true);
    await app.close();
  });

  it('/health anuncia authRequired=false sin authSecret', async () => {
    const app = buildApp(makeDeps());
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect((res.json() as { authRequired: boolean }).authRequired).toBe(false);
    await app.close();
  });

  it('sin authSecret configurado, las rutas quedan abiertas (comportamiento previo)', async () => {
    const app = buildApp(makeDeps({ getHistory: async () => [] }));
    const res = await app.inject({ method: 'GET', url: '/candles?symbol=BTCUSDT&interval=1m' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});

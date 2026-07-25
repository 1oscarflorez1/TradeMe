import { createHmac, timingSafeEqual } from 'node:crypto';

// JWT (HS256) minimalista a mano: es un formato simple (header.payload.firma) y evita sumar
// una dependencia solo para esto. Mismo criterio que el resto del repo (calibración, ADX,
// Supertrend... todo a mano en vez de tirar de una librería pesada).

export interface JwtPayload {
  sub: string; // user id
  email: string;
  iat: number;
  exp: number;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function b64urlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

export function signJwt(
  claims: { sub: string; email: string },
  secret: string,
  expiresInSec = 60 * 60 * 12,
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtPayload = { ...claims, iat: now, exp: now + expiresInSec };
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${signature}`;
}

/** Verifica firma y expiración. Devuelve el payload si es válido, o null si no. */
export function verifyJwt(token: string, secret: string): JwtPayload | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [head, body, signature] = parts;
  const expected = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  const sigBuf = b64urlDecode(signature!);
  const expBuf = b64urlDecode(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  let payload: JwtPayload;
  try {
    payload = JSON.parse(b64urlDecode(body!).toString('utf8')) as JwtPayload;
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

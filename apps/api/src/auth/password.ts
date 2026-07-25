import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

// Hash de contraseñas con scrypt (nativo de Node, sin dependencia extra). Formato almacenado:
// "scrypt:<saltHex>:<hashHex>". Parámetros por defecto de scryptSync (N=16384) son adecuados
// para un login de equipo (no es un servicio público de alto volumen).
const KEY_LEN = 64;

export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEY_LEN);
  return `scrypt:${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, hashHex] = parts;
  try {
    const salt = Buffer.from(saltHex!, 'hex');
    const expected = Buffer.from(hashHex!, 'hex');
    const actual = scryptSync(plain, salt, expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

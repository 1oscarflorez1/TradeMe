// Sesión del equipo (Módulo 3). El token vive en memoria + sessionStorage (sobrevive un
// refresh de la pestaña, se pierde al cerrarla) — nada de localStorage para no dejarlo
// pegado indefinidamente en el navegador compartido de un equipo.
const STORAGE_KEY = 'trademe.authToken';

let token: string | null = null;
try {
  token = sessionStorage.getItem(STORAGE_KEY);
} catch {
  token = null;
}

const listeners = new Set<(t: string | null) => void>();

export function getToken(): string | null {
  return token;
}

export function setToken(t: string | null): void {
  token = t;
  try {
    if (t) sessionStorage.setItem(STORAGE_KEY, t);
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
  for (const l of listeners) l(t);
}

export function onTokenChange(listener: (t: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function authHeaders(): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

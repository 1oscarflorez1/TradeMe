import { useEffect, useState, type ReactNode } from 'react';
import { fetchAuthRequired, fetchMe } from './api';
import { getToken, onTokenChange } from './auth';
import { Login } from './Login';

type Status = 'checking' | 'open' | 'authed' | 'login';

/** Antes de mostrar la app, resuelve si el backend exige login (Módulo 3) y si ya hay una
 * sesión válida. Si el backend no tiene auth configurada (dev), no pide nada. */
export function AuthGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('checking');

  useEffect(() => {
    let cancelled = false;
    const check = async (): Promise<void> => {
      const required = await fetchAuthRequired();
      if (cancelled) return;
      if (!required) {
        setStatus('open');
        return;
      }
      if (!getToken()) {
        setStatus('login');
        return;
      }
      const me = await fetchMe();
      if (!cancelled) setStatus(me ? 'authed' : 'login');
    };
    void check();
    const unsubscribe = onTokenChange((t) => {
      if (!t) setStatus('login');
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  if (status === 'checking') {
    return (
      <div className="login-screen">
        <p className="muted">Cargando…</p>
      </div>
    );
  }
  if (status === 'login') {
    return <Login onLogin={() => setStatus('authed')} />;
  }
  return <>{children}</>;
}

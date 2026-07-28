import { useEffect, useState } from 'react';
import { fetchSystemStatus } from './api';
import type { SystemStatus } from './api';

const DOT: Record<string, string> = { ok: '🟢', degradado: '🟡', caido: '🔴', na: '⚪' };
const LABEL: Record<string, string> = {
  ok: 'Operativo',
  degradado: 'Degradado',
  caido: 'Caído',
  na: 'No configurado',
};

export function StatusView() {
  const [st, setSt] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = () =>
    fetchSystemStatus().then((r) => {
      setSt(r);
      setError(r === null);
      setLoading(false);
    });

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), 30000);
    return () => clearInterval(id);
  }, []);

  if (loading) return <p className="muted">Comprobando el sistema…</p>;

  return (
    <section className="panel registros">
      <div className="reg-head">
        <h2>Estado del sistema</h2>
        <p className="reg-intro">
          Comprobación <strong>en vivo</strong> de cada pieza y de que se comunican entre sí. Se
          actualiza cada 30 segundos. Si algo falla, aquí verás qué es y qué implica.
        </p>
      </div>

      {error || !st ? (
        <div className="panel error" style={{ maxWidth: 'none' }}>
          <p>
            🔴 <strong>No hay conexión con la API.</strong>
          </p>
          <p className="hint">
            El portal no puede hablar con el motor. Comprueba que los servicios estén levantados
            (Docker) y recarga esta página.
          </p>
        </div>
      ) : (
        <>
          <div className="reg-summary">
            <span
              className={`reg-chip ${st.overall === 'ok' ? 'reg-chip-ok' : 'reg-chip-bad'}`}
              title="Resumen: el peor estado entre todos los componentes"
            >
              {DOT[st.overall]} Estado general <strong>{LABEL[st.overall]}</strong>
            </span>
            <span className="reg-chip">
              Versión <strong>{st.version}</strong>
            </span>
            <span className="reg-chip">
              Comprobado en <strong>{st.took_ms} ms</strong>
            </span>
            <span className="reg-chip muted">
              {new Date(st.checked_at).toLocaleTimeString('es')} · se refresca cada 30s
            </span>
          </div>

          <div className="snap-scroll">
            <table className="snap-table">
              <thead>
                <tr>
                  <th>Componente</th>
                  <th>Estado</th>
                  <th>Detalle</th>
                  <th>Latencia</th>
                </tr>
              </thead>
              <tbody>
                {st.components.map((c) => (
                  <tr key={c.key}>
                    <td>{c.label}</td>
                    <td
                      className={
                        c.status === 'ok' ? 'wh-long' : c.status === 'caido' ? 'wh-short' : 'muted'
                      }
                    >
                      {DOT[c.status]} {LABEL[c.status]}
                    </td>
                    <td className="muted">{c.detail}</td>
                    <td className="muted">{c.ms !== undefined ? `${c.ms} ms` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="muted calib-legend">
            <strong>Cómo leerlo:</strong> 🟢 operativo · 🟡 degradado (funciona con limitaciones) ·
            🔴 caído (esa función no está disponible) · ⚪ no configurado (opcional, no es un error).
            Si «Servicio quant» está caído, los botones ▶/⚙/🧠 no responderán; si «Base de datos»
            falla, no se guardan registros ni backtests; si «Datos de mercado» falla, el Panel no
            actualiza precios.
          </p>
        </>
      )}
    </section>
  );
}

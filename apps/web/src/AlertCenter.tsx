import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAlerts, markAlertsRead, postAlert } from './api';
import type { Alert, AlertInputWeb } from './types';

function canNotify(): boolean {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

/** Estado + acciones del centro de alertas (historial en DB + notificación de navegador). */
export function useAlerts() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [unread, setUnread] = useState(0);

  const reload = useCallback(async () => {
    const r = await fetchAlerts(60);
    setAlerts(r.alerts);
    setUnread(r.unread);
  }, []);

  useEffect(() => {
    void reload();
    const id = setInterval(() => void reload(), 20000);
    return () => clearInterval(id);
  }, [reload]);

  const create = useCallback(
    async (a: AlertInputWeb) => {
      const row = await postAlert(a);
      if (!row) return;
      if (canNotify()) {
        try {
          new Notification(`TradeMe · ${row.title}`, { body: row.message ?? undefined });
        } catch {
          /* el navegador puede bloquear notificaciones */
        }
      }
      void reload();
    },
    [reload],
  );

  const markRead = useCallback(async () => {
    await markAlertsRead();
    void reload();
  }, [reload]);

  return { alerts, unread, create, markRead };
}

const SEV_ICON: Record<Alert['severity'], string> = {
  info: '•',
  success: '✓',
  warning: '⚠',
};

export function AlertCenter({
  alerts,
  unread,
  onMarkRead,
}: {
  alerts: Alert[];
  unread: number;
  onMarkRead: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported',
  );
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const requestPerm = () => {
    if (typeof Notification === 'undefined') return;
    void Notification.requestPermission().then(setPerm);
  };

  return (
    <div className="bell-wrap" ref={boxRef}>
      <button
        type="button"
        className="bell-btn"
        aria-label="Centro de alertas"
        title="Centro de alertas"
        onClick={() => setOpen((v) => !v)}
      >
        🔔
        {unread > 0 && <span className="bell-badge">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-pop" role="dialog" aria-label="Alertas">
          <div className="bell-head">
            <strong>Alertas</strong>
            <button type="button" className="bell-link" onClick={onMarkRead}>
              Marcar leídas
            </button>
          </div>
          {perm !== 'granted' && perm !== 'unsupported' && (
            <button type="button" className="bell-perm" onClick={requestPerm}>
              Activar notificaciones del navegador
            </button>
          )}
          <div className="bell-list">
            {alerts.length === 0 ? (
              <p className="muted">Sin alertas todavía.</p>
            ) : (
              alerts.map((a) => (
                <div key={a.id} className={`bell-item sev-${a.severity} ${a.read ? '' : 'unread'}`}>
                  <span className="bell-icon">{SEV_ICON[a.severity]}</span>
                  <div className="bell-body">
                    <div className="bell-title">
                      {a.title}
                      {a.symbol && <span className="muted"> · {a.symbol}</span>}
                      {a.interval && <span className="muted"> {a.interval}</span>}
                    </div>
                    {a.message && <div className="bell-msg">{a.message}</div>}
                    <div className="bell-time">{new Date(a.created_at).toLocaleString('es')}</div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

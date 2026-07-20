import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAlerts, fetchVapidKey, markAlertsRead, postAlert, postPushSubscribe } from './api';
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

function urlB64ToUint8(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function subscribePush(): Promise<'on' | 'denied' | 'unsupported' | 'error'> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return 'unsupported';
  try {
    const reg = await navigator.serviceWorker.ready;
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'denied';
    const key = await fetchVapidKey();
    if (!key) return 'error';
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8(key) as unknown as BufferSource,
    });
    const ok = await postPushSubscribe(sub.toJSON());
    return ok ? 'on' : 'error';
  } catch {
    return 'error';
  }
}

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
  const [pushState, setPushState] = useState<string>('idle');
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const activarPush = () => {
    setPushState('working');
    void subscribePush().then(setPushState);
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
          <button
            type="button"
            className="bell-perm"
            onClick={activarPush}
            disabled={pushState === 'working' || pushState === 'on'}
          >
            {pushState === 'on'
              ? '✓ Push activado en este dispositivo'
              : pushState === 'working'
                ? 'Activando…'
                : pushState === 'denied'
                  ? 'Permiso denegado — actívalo en el navegador'
                  : pushState === 'unsupported'
                    ? 'Este navegador no soporta push'
                    : 'Activar push en este dispositivo'}
          </button>
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

import type { Vote } from './types';

function label(score: number): { text: string; cls: string } {
  if (score > 0) return { text: 'LONG', cls: 'wh-long' };
  if (score < 0) return { text: 'SHORT', cls: 'wh-short' };
  return { text: 'FLAT', cls: 'wh-flat' };
}

export function WebhookStatus({ votes, now }: { votes: Vote[]; now: number }) {
  const external = votes.filter((v) => v.source === 'tradingview');
  if (external.length === 0) {
    return (
      <p className="muted">Sin señales de Reditum activas. Envía una alerta a POST /tv-hook.</p>
    );
  }
  return (
    <ul className="webhooks">
      {external.map((v) => {
        const age = Math.max(0, now - Date.parse(v.ts));
        const remaining = v.ttlMs ? Math.max(0, v.ttlMs - age) : null;
        const s = label(v.score);
        return (
          <li key={v.key} className="webhook-row">
            <span className="wh-name">{v.key}</span>
            <span className={s.cls}>{s.text}</span>
            <span className="wh-meta">lat {Math.round(age / 1000)}s</span>
            <span className="wh-meta">
              {remaining === null ? '—' : `TTL ${Math.round(remaining / 1000)}s`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

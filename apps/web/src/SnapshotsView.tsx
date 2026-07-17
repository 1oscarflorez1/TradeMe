import { useEffect, useState } from 'react';
import { fetchSnapshots } from './api';
import type { SnapshotRow, SnapshotTracking } from './types';

const STATUS_LABEL: Record<SnapshotTracking['status'], string> = {
  tp: '✓ TP',
  sl: '✗ SL',
  en_curso: 'En curso',
  sin_plan: '—',
};
const STATUS_CLASS: Record<SnapshotTracking['status'], string> = {
  tp: 'wh-long',
  sl: 'wh-short',
  en_curso: '',
  sin_plan: 'muted',
};

function num(n: number | null, d = 2): string {
  return n === null ? '—' : n.toFixed(d);
}

export function SnapshotsView({ symbol }: { symbol: string }) {
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [price, setPrice] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const load = () =>
      fetchSnapshots(symbol).then((r) => {
        if (!cancelled && r) {
          setRows(r.snapshots);
          setPrice(r.currentPrice);
          setLoading(false);
        }
      });
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

  if (loading) return <p className="muted">Cargando registros…</p>;
  if (rows.length === 0) {
    return (
      <p className="muted">Aún no hay snapshots. Pulsa 📸 en el Panel para guardar el primero.</p>
    );
  }

  return (
    <section className="panel registros">
      <div className="chart-head">
        <strong>Registros · Snapshots</strong>
        <span className="muted">
          · precio {symbol} {price.toFixed(2)} · seguimiento en vivo (5s)
        </span>
      </div>
      <div className="snap-scroll">
        <table className="snap-table">
          <thead>
            <tr>
              <th>Fecha</th>
              <th>TF</th>
              <th>Dir</th>
              <th>Entrada</th>
              <th>Stop</th>
              <th>TP</th>
              <th>Estado</th>
              <th>R vivo</th>
              <th>Macro</th>
              <th>Validez</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const t = r.tracking;
              const dirClass =
                r.direction === 'LONG' ? 'wh-long' : r.direction === 'SHORT' ? 'wh-short' : 'muted';
              return (
                <tr key={r.id}>
                  <td>{new Date(r.captured_at).toLocaleString('es')}</td>
                  <td>{r.interval}</td>
                  <td className={dirClass}>{r.direction}</td>
                  <td>{num(r.plan_entry)}</td>
                  <td>{num(r.plan_stop)}</td>
                  <td>{num(r.plan_take_profit)}</td>
                  <td className={t ? STATUS_CLASS[t.status] : ''}>
                    {t ? STATUS_LABEL[t.status] : '—'}
                    {t?.expired ? ' (exp)' : ''}
                  </td>
                  <td>{num(t?.liveR ?? null)}</td>
                  <td>{num(r.macro_bias)}</td>
                  <td>{r.valid_until ? new Date(r.valid_until).toLocaleTimeString('es') : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

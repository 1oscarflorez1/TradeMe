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

function num(n: number | null | undefined, d = 2): string {
  return n === null || n === undefined ? '—' : n.toFixed(d);
}
function pct(n: number | null | undefined): string {
  return n === null || n === undefined ? '—' : `${(n * 100).toFixed(0)}%`;
}

/** Mini barra apilada con las probabilidades BUY / HOLD / SELL. */
function ProbBar({ b, h, s }: { b: number | null; h: number | null; s: number | null }) {
  if (b === null || h === null || s === null) return <span className="muted">—</span>;
  const total = b + h + s || 1;
  return (
    <div className="prob-mini" title={`Compra ${pct(b)} · Mantener ${pct(h)} · Vender ${pct(s)}`}>
      <span className="pm-buy" style={{ width: `${(b / total) * 100}%` }} />
      <span className="pm-hold" style={{ width: `${(h / total) * 100}%` }} />
      <span className="pm-sell" style={{ width: `${(s / total) * 100}%` }} />
    </div>
  );
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

  const enCurso = rows.filter((r) => r.tracking?.status === 'en_curso').length;
  const tp = rows.filter((r) => r.tracking?.status === 'tp' || r.outcome_result === 'tp').length;
  const sl = rows.filter((r) => r.tracking?.status === 'sl' || r.outcome_result === 'sl').length;
  const expirados = rows.filter((r) => r.tracking?.expired).length;

  return (
    <section className="panel registros">
      <div className="reg-head">
        <h2>Registros · decisiones capturadas en vivo</h2>
        <p className="reg-intro">
          Cada fila es una decisión que guardaste con 📸 en el momento real. TradeMe la sigue{' '}
          <strong>hacia adelante</strong> comparando el precio actual con su plan (entrada, stop,
          objetivo) y marca si va <strong>En curso</strong>, alcanzó <strong>✓ TP</strong> o tocó{' '}
          <strong>✗ SL</strong>. El objetivo: medir cómo se comportan de verdad las decisiones del
          copiloto (test hacia adelante) y alimentar el dataset que calibra y optimiza el modelo.
        </p>
      </div>

      <div className="reg-summary">
        <span className="reg-chip">
          Precio {symbol} <strong>{price.toFixed(2)}</strong>
        </span>
        <span className="reg-chip">
          Total <strong>{rows.length}</strong>
        </span>
        <span className="reg-chip">
          En curso <strong>{enCurso}</strong>
        </span>
        <span className="reg-chip reg-chip-ok">
          ✓ TP <strong>{tp}</strong>
        </span>
        <span className="reg-chip reg-chip-bad">
          ✗ SL <strong>{sl}</strong>
        </span>
        <span className="reg-chip">
          Expirados <strong>{expirados}</strong>
        </span>
        <span className="reg-chip muted">actualiza cada 5s</span>
      </div>

      {rows.length === 0 ? (
        <p className="muted">Aún no hay snapshots. Pulsa 📸 en el Panel para guardar el primero.</p>
      ) : (
        <div className="snap-scroll">
          <table className="snap-table">
            <thead>
              <tr>
                <th>Fecha / hora</th>
                <th>TF</th>
                <th>Régimen</th>
                <th>Acción</th>
                <th>Dir</th>
                <th>Confianza</th>
                <th>Prob. B/H/S</th>
                <th>Precio</th>
                <th>Entrada</th>
                <th>Stop</th>
                <th>Objetivo</th>
                <th>R:R</th>
                <th>Estado</th>
                <th>R en vivo</th>
                <th>Resultado</th>
                <th>Macro</th>
                <th>Validez</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = r.tracking;
                const dirClass =
                  r.direction === 'LONG'
                    ? 'wh-long'
                    : r.direction === 'SHORT'
                      ? 'wh-short'
                      : 'muted';
                const actClass =
                  r.action === 'BUY' ? 'wh-long' : r.action === 'SELL' ? 'wh-short' : 'muted';
                return (
                  <tr key={r.id}>
                    <td>{new Date(r.captured_at).toLocaleString('es')}</td>
                    <td>{r.interval}</td>
                    <td className="muted">{r.regime_label ?? '—'}</td>
                    <td className={actClass}>{r.action}</td>
                    <td className={dirClass}>{r.direction}</td>
                    <td>{pct(r.confidence)}</td>
                    <td>
                      <ProbBar b={r.prob_buy} h={r.prob_hold} s={r.prob_sell} />
                    </td>
                    <td>{num(r.price)}</td>
                    <td>{num(r.plan_entry)}</td>
                    <td className="wh-short">{num(r.plan_stop)}</td>
                    <td className="wh-long">{num(r.plan_take_profit)}</td>
                    <td>{r.plan_rr ? `1:${r.plan_rr.toFixed(1)}` : '—'}</td>
                    <td className={t ? STATUS_CLASS[t.status] : ''}>
                      {t ? STATUS_LABEL[t.status] : '—'}
                      {t?.expired ? ' (exp)' : ''}
                    </td>
                    <td className={(t?.liveR ?? 0) >= 0 ? 'wh-long' : 'wh-short'}>
                      {num(t?.liveR ?? null)}
                    </td>
                    <td>
                      {r.outcome_result
                        ? `${r.outcome_result.toUpperCase()} (${num(r.outcome_return_r)}R)`
                        : '—'}
                    </td>
                    <td>{num(r.macro_bias)}</td>
                    <td>{r.valid_until ? new Date(r.valid_until).toLocaleTimeString('es') : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

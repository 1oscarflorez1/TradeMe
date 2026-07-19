import { Fragment, useEffect, useState } from 'react';
import { deleteSnapshot, fetchCandlesUntil, fetchSnapshots } from './api';
import type { Candle, SnapshotRow, SnapshotTracking } from './types';
import { CandleChart } from './CandleChart';
import { DrawingLayer } from './DrawingLayer';

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

function ProbBar({ b, h, s }: { b: number | null; h: number | null; s: number | null }) {
  if (b === null || h === null || s === null) return <span className="muted">—</span>;
  const total = b + h + s || 1;
  return (
    <span className="prob-mini" title={`Compra ${pct(b)} · Mantener ${pct(h)} · Vender ${pct(s)}`}>
      <span className="pm-buy" style={{ width: `${(b / total) * 100}%` }} />
      <span className="pm-hold" style={{ width: `${(h / total) * 100}%` }} />
      <span className="pm-sell" style={{ width: `${(s / total) * 100}%` }} />
    </span>
  );
}

// Columnas siempre visibles (caben a lo ancho). El resto va en el detalle plegable.
const HEADERS: Array<[string, string]> = [
  ['Fecha y hora', 'Momento exacto en que capturaste la decisión con 📸.'],
  ['Temporalidad', 'Marco temporal de las velas con que se decidió (1m, 5m, 15m, …).'],
  ['Acción', 'Sugerencia del modelo: COMPRAR, MANTENER o VENDER.'],
  ['Dirección', 'Orientación operativa: LONG (al alza), SHORT (a la baja) o FLAT (fuera).'],
  ['Confianza', 'Probabilidad de la acción elegida (0–100%), calibrada por régimen si hay calibrador.'],
  [
    'Estado',
    'Seguimiento en vivo comparando el precio actual con el plan: En curso, ✓ TP o ✗ SL. «(exp)» = validez vencida.',
  ],
  ['R en vivo', 'Resultado actual en múltiplos de R (unidad de riesgo). Positivo = a favor.'],
];

function Th({ label, tip }: { label: string; tip: string }) {
  return (
    <th>
      <span className="th-label">
        {label}
        <span className="th-tip" role="tooltip">
          {tip}
        </span>
      </span>
    </th>
  );
}

const CHIP_TIPS = {
  precio: 'Precio de mercado actual del activo, con el que se sigue cada registro en vivo.',
  total: 'Número total de registros (snapshots) guardados para este activo.',
  enCurso: 'Registros cuya operación sigue abierta: el precio aún no ha tocado ni objetivo ni stop.',
  tp: 'Registros que alcanzaron su objetivo de ganancia (take-profit).',
  sl: 'Registros que tocaron su stop de pérdida.',
  expirados: 'Registros cuya validez temporal ya venció (la entrada caducó sin activarse a tiempo).',
  refresh: 'La tabla vuelve a consultar el precio y el estado cada 5 segundos.',
};

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="det-field">
      <span className="det-label">{label}</span>
      <span className="det-value">{children}</span>
    </div>
  );
}

export function SnapshotsView({ symbol }: { symbol: string }) {
  const [rows, setRows] = useState<SnapshotRow[]>([]);
  const [price, setPrice] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [chartFor, setChartFor] = useState<SnapshotRow | null>(null);
  const [chartCandles, setChartCandles] = useState<Candle[]>([]);
  const [chartLoading, setChartLoading] = useState(false);

  const load = () =>
    fetchSnapshots(symbol).then((r) => {
      if (r) {
        setRows(r.snapshots);
        setPrice(r.currentPrice);
        setLoading(false);
      }
    });

  useEffect(() => {
    if (!symbol) return;
    let cancelled = false;
    const run = () => {
      if (!cancelled) void load();
    };
    run();
    const id = setInterval(run, 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [symbol]);

  useEffect(() => {
    if (!chartFor) return;
    let cancelled = false;
    setChartLoading(true);
    setChartCandles([]);
    fetchCandlesUntil(chartFor.symbol, chartFor.interval, Date.parse(chartFor.captured_at)).then(
      (c) => {
        if (!cancelled) {
          setChartCandles(c);
          setChartLoading(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [chartFor]);

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const doDelete = async () => {
    if (!confirmId) return;
    await deleteSnapshot(confirmId);
    setConfirmId(null);
    await load();
  };

  if (loading) return <p className="muted">Cargando registros…</p>;

  const enCurso = rows.filter((r) => r.tracking?.status === 'en_curso').length;
  const tp = rows.filter((r) => r.tracking?.status === 'tp' || r.outcome_result === 'tp').length;
  const sl = rows.filter((r) => r.tracking?.status === 'sl' || r.outcome_result === 'sl').length;
  const expirados = rows.filter((r) => r.tracking?.expired).length;
  const COLS = HEADERS.length + 2;

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
          Pulsa la flecha de cada fila para ver todos los datos, o la ✕ para eliminar el registro.
        </p>
      </div>

      <div className="reg-summary">
        <span className="reg-chip" title={CHIP_TIPS.precio}>
          Precio {symbol} <strong>{price.toFixed(2)}</strong>
        </span>
        <span className="reg-chip" title={CHIP_TIPS.total}>
          Total <strong>{rows.length}</strong>
        </span>
        <span className="reg-chip" title={CHIP_TIPS.enCurso}>
          En curso <strong>{enCurso}</strong>
        </span>
        <span className="reg-chip reg-chip-ok" title={CHIP_TIPS.tp}>
          ✓ TP <strong>{tp}</strong>
        </span>
        <span className="reg-chip reg-chip-bad" title={CHIP_TIPS.sl}>
          ✗ SL <strong>{sl}</strong>
        </span>
        <span className="reg-chip" title={CHIP_TIPS.expirados}>
          Expirados <strong>{expirados}</strong>
        </span>
        <span className="reg-chip muted" title={CHIP_TIPS.refresh}>
          actualiza cada 5s
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="muted">Aún no hay snapshots. Pulsa 📸 en el Panel para guardar el primero.</p>
      ) : (
        <div className="snap-scroll">
          <table className="snap-table">
            <thead>
              <tr>
                <th aria-label="desplegar" />
                {HEADERS.map(([label, tip]) => (
                  <Th key={label} label={label} tip={tip} />
                ))}
                <th aria-label="eliminar" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const t = r.tracking;
                const open = expanded.has(r.id);
                const dirClass =
                  r.direction === 'LONG'
                    ? 'wh-long'
                    : r.direction === 'SHORT'
                      ? 'wh-short'
                      : 'muted';
                const actClass =
                  r.action === 'BUY' ? 'wh-long' : r.action === 'SELL' ? 'wh-short' : 'muted';
                return (
                  <Fragment key={r.id}>
                    <tr className={open ? 'row-open' : ''}>
                      <td className="cell-toggle">
                        <button
                          type="button"
                          className={`row-arrow ${open ? 'open' : ''}`}
                          aria-label={open ? 'Contraer' : 'Desplegar'}
                          onClick={() => toggle(r.id)}
                        >
                          ⌄
                        </button>
                      </td>
                      <td>{new Date(r.captured_at).toLocaleString('es')}</td>
                      <td>{r.interval}</td>
                      <td className={actClass}>{r.action}</td>
                      <td className={dirClass}>{r.direction}</td>
                      <td>{pct(r.confidence)}</td>
                      <td className={t ? STATUS_CLASS[t.status] : ''}>
                        {t ? STATUS_LABEL[t.status] : '—'}
                        {t?.expired ? ' (exp)' : ''}
                      </td>
                      <td className={(t?.liveR ?? 0) >= 0 ? 'wh-long' : 'wh-short'}>
                        {num(t?.liveR ?? null)}
                      </td>
                      <td className="cell-del">
                        <button
                          type="button"
                          className="row-chart"
                          aria-label="Ver gráfico del momento"
                          title="Ver el gráfico de cuando se guardó (con pizarra)"
                          onClick={() => setChartFor(r)}
                        >
                          📈
                        </button>
                        <button
                          type="button"
                          className="row-del"
                          aria-label="Eliminar registro"
                          title="Eliminar registro"
                          onClick={() => setConfirmId(r.id)}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={COLS}>
                          <div className="det-grid">
                            <DetailField label="Régimen">{r.regime_label ?? '—'}</DetailField>
                            <DetailField label="Probabilidades B/H/S">
                              <ProbBar b={r.prob_buy} h={r.prob_hold} s={r.prob_sell} />
                            </DetailField>
                            <DetailField label="Precio de captura">{num(r.price)}</DetailField>
                            <DetailField label="Entrada">{num(r.plan_entry)}</DetailField>
                            <DetailField label="Stop de pérdida">{num(r.plan_stop)}</DetailField>
                            <DetailField label="Objetivo de ganancia">
                              {num(r.plan_take_profit)}
                            </DetailField>
                            <DetailField label="Riesgo : Beneficio">
                              {r.plan_rr ? `1:${r.plan_rr.toFixed(1)}` : '—'}
                            </DetailField>
                            <DetailField label="Resultado evaluado">
                              {r.outcome_result
                                ? `${r.outcome_result.toUpperCase()} (${num(r.outcome_return_r)}R)`
                                : '—'}
                            </DetailField>
                            <DetailField label="Sesgo macro">{num(r.macro_bias)}</DetailField>
                            <DetailField label="Válido hasta">
                              {r.valid_until
                                ? new Date(r.valid_until).toLocaleTimeString('es')
                                : '—'}
                            </DetailField>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {chartFor && (
        <div className="modal-overlay" onClick={() => setChartFor(null)}>
          <div
            className="modal modal-chart"
            role="dialog"
            aria-modal="true"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="chart-head">
              <strong>Gráfico del snapshot</strong>
              <span className="muted">
                · {chartFor.symbol} · {chartFor.interval} ·{' '}
                {new Date(chartFor.captured_at).toLocaleString('es')}
              </span>
              <button type="button" className="modal-x" aria-label="Cerrar" onClick={() => setChartFor(null)}>
                ✕
              </button>
            </div>
            <div className="modal-chart-body">
              {chartLoading ? (
                <p className="muted">Cargando gráfico…</p>
              ) : chartCandles.length === 0 ? (
                <p className="muted">No se pudo reconstruir el gráfico de ese momento.</p>
              ) : (
                <DrawingLayer>
                  <CandleChart
                    candles={chartCandles}
                    last={null}
                    levels={
                      chartFor.plan_entry !== null &&
                      chartFor.plan_stop !== null &&
                      chartFor.plan_take_profit !== null
                        ? {
                            entry: chartFor.plan_entry,
                            stop: chartFor.plan_stop,
                            tp: chartFor.plan_take_profit,
                          }
                        : null
                    }
                  />
                </DrawingLayer>
              )}
            </div>
            <p className="muted">
              Niveles del plan marcados (entrada/stop/objetivo). Usa el ✏️ para dibujar sobre el
              gráfico.
            </p>
          </div>
        </div>
      )}

      {confirmId && (
        <div className="modal-overlay" onClick={() => setConfirmId(null)}>
          <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <p className="modal-title">¿Eliminar este registro?</p>
            <p className="muted">Esta acción no se puede deshacer.</p>
            <div className="modal-actions">
              <button type="button" className="btn-ghost" onClick={() => setConfirmId(null)}>
                Cancelar
              </button>
              <button type="button" className="btn-danger" onClick={() => void doDelete()}>
                Eliminar
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

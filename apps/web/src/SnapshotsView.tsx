import { Fragment, useEffect, useState } from 'react';
import { deleteSnapshot, fetchCandlesUntil, fetchSnapshots } from './api';
import type { Candle, EstadoFinal, SnapshotRow, SnapshotStats } from './types';
import { CandleChart } from './CandleChart';
import { DrawingLayer } from './DrawingLayer';

const ESTADO_LABEL: Record<EstadoFinal, string> = {
  tp: '✓ TP',
  sl: '✗ SL',
  timeout: '⧖ Por tiempo',
  abierto: 'Abierta',
  sin_plan: '—',
};
const ESTADO_CLASS: Record<EstadoFinal, string> = {
  tp: 'wh-long',
  sl: 'wh-short',
  timeout: 'muted',
  abierto: '',
  sin_plan: 'muted',
};
const ESTADO_TIP: Record<EstadoFinal, string> = {
  tp: 'Cerrada: tocó el objetivo antes que el stop. Resultado definitivo.',
  sl: 'Cerrada: tocó el stop antes que el objetivo. Resultado definitivo.',
  timeout: 'Cerrada al agotarse el horizonte sin tocar ninguno de los dos niveles.',
  abierto: 'Aún sin evaluar. La columna «R en vivo» dice por dónde va el precio ahora mismo.',
  sin_plan: 'La decisión fue MANTENER: no hay operación que puntuar.',
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
  ['Entrada', 'Precio al que el plan propone entrar en la operación.'],
  ['Stop', 'Precio de salida con pérdida (protección). Distancia ≈ 1.5×ATR.'],
  ['Objetivo', 'Precio de salida con ganancia (take-profit), a 2R de la entrada.'],
  [
    'Estado',
    'Seguimiento en vivo comparando el precio actual con el plan: En curso, ✓ TP o ✗ SL. «(exp)» = validez vencida.',
  ],
  ['R en vivo', 'Resultado actual en múltiplos de R (unidad de riesgo). Positivo = a favor.'],
];

function Th({ label, tip, onSort }: { label: string; tip: string; onSort?: () => void }) {
  return (
    <th onClick={onSort} className={onSort ? 'th-sortable' : undefined}>
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
  precio: 'Precio de mercado actual del activo, con el que se sigue cada registro abierto.',
  total: 'Registros guardados para este activo. Las cifras se calculan sobre TODOS ellos, no solo sobre los que se listan abajo.',
  tp: 'Operaciones que tocaron su objetivo antes que su stop. Resultado ya evaluado, no provisional.',
  sl: 'Operaciones que tocaron su stop antes que su objetivo. Resultado ya evaluado.',
  timeout: 'Operaciones que se cerraron al agotarse el horizonte de evaluación sin tocar ninguno de los dos niveles. Ni acierto ni fallo: cuentan con el resultado parcial que llevaran.',
  abiertos: 'Registros que el evaluador aún no ha cerrado. Solo en estos tiene sentido el seguimiento en vivo.',
  sinPlan: 'Decisiones de MANTENER: no generan una operación con niveles, así que no puntúan.',
  refresh: 'La tabla vuelve a consultar el precio y el estado cada 5 segundos.',
};

/**
 * Veredicto del sistema. Es la pregunta que de verdad importa: perder más veces de las que se gana
 * NO es malo si el objetivo está más lejos que el stop. Con relación 2:1 basta con acertar más de
 * un tercio de las veces. Aquí se compara el acierto real con ese umbral.
 */
function Veredicto({ stats }: { stats: SnapshotStats }) {
  const { tp, sl, timeout, resueltos, winRate, expectancy } = stats;
  if (tp + sl < 10) {
    return (
      <div className="verdict verdict-wait">
        <strong>Muestra insuficiente todavía.</strong>{' '}
        <span className="muted">
          Llevas {tp + sl} operaciones cerradas en objetivo o stop. Con menos de una decena, cualquier
          conclusión sería ruido. El piloto sigue acumulando.
        </span>
      </div>
    );
  }
  // Umbral de equilibrio para la relación riesgo:beneficio configurada (2:1 → 33.3%).
  const rrObjetivo = 2;
  const umbral = 1 / (1 + rrObjetivo);
  const bueno = (expectancy ?? 0) > 0;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  return (
    <div className={`verdict ${bueno ? 'verdict-ok' : 'verdict-bad'}`}>
      <div className="verdict-main">
        <span className="verdict-badge">{bueno ? '✓ Con ventaja' : '✗ Sin ventaja'}</span>
        <span>
          Aciertas el <strong>{winRate === null ? '—' : pct(winRate)}</strong> de las veces y necesitas
          más del <strong>{pct(umbral)}</strong> para que salga a cuenta, porque el objetivo está al{' '}
          <strong>doble</strong> de distancia que el stop.
        </span>
      </div>
      <div className="verdict-detail muted">
        Ganancia media por operación:{' '}
        <strong className={bueno ? 'wh-long' : 'wh-short'}>
          {expectancy === null ? '—' : `${expectancy >= 0 ? '+' : ''}${expectancy.toFixed(3)} R`}
        </strong>{' '}
        sobre {resueltos} operaciones cerradas ({tp} en objetivo, {sl} en stop, {timeout} por tiempo).
        Una R es lo que arriesgas en cada entrada.{' '}
        {bueno
          ? 'Perder más veces de las que ganas es el comportamiento esperado de este ajuste: las ganancias son mayores que las pérdidas.'
          : 'Aquí sí conviene revisar los pesos: ni siquiera el tamaño de las ganancias compensa la frecuencia de los fallos.'}
      </div>
      <div className="verdict-note muted">
        Estas cifras no descuentan comisiones ni deslizamiento. Medirlos es justo el objetivo de la
        futura cuenta de papel.
      </div>
    </div>
  );
}

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
  const [total, setTotal] = useState<number>(0);
  const [stats, setStats] = useState<SnapshotStats | null>(null);
  const [fTf, setFTf] = useState('');
  const [fAct, setFAct] = useState('');
  const [fDir, setFDir] = useState('');
  const [fEst, setFEst] = useState('');
  const [sortKey, setSortKey] = useState<'fecha' | 'conf' | 'liveR'>('fecha');
  const [sortDesc, setSortDesc] = useState(true);
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
        setTotal(r.total ?? r.snapshots.length);
        setStats(r.stats ?? null);
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

  // El estado lo decide el servidor: manda el resultado evaluado sobre el seguimiento en vivo.
  const estadoDe = (r: SnapshotRow): string => r.estado;
  const tfs = [...new Set(rows.map((r) => r.interval))];
  const filtered = rows.filter(
    (r) =>
      (!fTf || r.interval === fTf) &&
      (!fAct || r.action === fAct) &&
      (!fDir || r.direction === fDir) &&
      (!fEst || estadoDe(r) === fEst),
  );
  const visible = [...filtered].sort((a, b) => {
    let d = 0;
    if (sortKey === 'fecha') d = Date.parse(a.captured_at) - Date.parse(b.captured_at);
    else if (sortKey === 'conf') d = (a.confidence ?? 0) - (b.confidence ?? 0);
    else d = (a.tracking?.liveR ?? -Infinity) - (b.tracking?.liveR ?? -Infinity);
    return sortDesc ? -d : d;
  });
  const filtering = !!(fTf || fAct || fDir || fEst);
  const clearFilters = () => {
    setFTf('');
    setFAct('');
    setFDir('');
    setFEst('');
  };
  const toggleSort = (k: 'fecha' | 'conf' | 'liveR') => {
    if (sortKey === k) setSortDesc((v) => !v);
    else {
      setSortKey(k);
      setSortDesc(true);
    }
  };

  const COLS = HEADERS.length + 1;

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
          Total <strong>{stats?.total ?? total}</strong>
          {total > rows.length ? (
            <span className="muted"> (se listan {rows.length})</span>
          ) : null}
        </span>
        {filtering && (
          <span className="reg-chip reg-chip-filter" title="Filas que pasan los filtros activos">
            Filtradas <strong>{visible.length}</strong>
          </span>
        )}
        <span className="reg-chip reg-chip-ok" title={CHIP_TIPS.tp}>
          ✓ TP <strong>{stats?.tp ?? 0}</strong>
        </span>
        <span className="reg-chip reg-chip-bad" title={CHIP_TIPS.sl}>
          ✗ SL <strong>{stats?.sl ?? 0}</strong>
        </span>
        <span className="reg-chip" title={CHIP_TIPS.timeout}>
          ⧖ Por tiempo <strong>{stats?.timeout ?? 0}</strong>
        </span>
        <span className="reg-chip" title={CHIP_TIPS.abiertos}>
          Abiertas <strong>{stats?.abiertos ?? 0}</strong>
        </span>
        {(stats?.sinPlan ?? 0) > 0 && (
          <span className="reg-chip muted" title={CHIP_TIPS.sinPlan}>
            Sin plan <strong>{stats?.sinPlan}</strong>
          </span>
        )}
        <span className="reg-chip muted" title={CHIP_TIPS.refresh}>
          actualiza cada 5s
        </span>
      </div>

      {stats && <Veredicto stats={stats} />}

      {rows.length > 0 && (
        <div className="reg-filters">
          <label>
            <span>Temporalidad</span>
            <select value={fTf} onChange={(e) => setFTf(e.target.value)}>
              <option value="">Todas</option>
              {tfs.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Acción</span>
            <select value={fAct} onChange={(e) => setFAct(e.target.value)}>
              <option value="">Todas</option>
              <option value="BUY">COMPRAR</option>
              <option value="SELL">VENDER</option>
              <option value="HOLD">MANTENER</option>
            </select>
          </label>
          <label>
            <span>Dirección</span>
            <select value={fDir} onChange={(e) => setFDir(e.target.value)}>
              <option value="">Todas</option>
              <option value="LONG">LONG</option>
              <option value="SHORT">SHORT</option>
              <option value="FLAT">FLAT</option>
            </select>
          </label>
          <label>
            <span>Estado</span>
            <select value={fEst} onChange={(e) => setFEst(e.target.value)}>
              <option value="">Todos</option>
              <option value="abierto">Abiertas</option>
              <option value="tp">✓ TP</option>
              <option value="sl">✗ SL</option>
              <option value="timeout">⧖ Por tiempo</option>
              <option value="sin_plan">Sin plan</option>
            </select>
          </label>
          {filtering && (
            <button type="button" className="reg-clear" onClick={clearFilters}>
              Limpiar filtros
            </button>
          )}
          <span className="reg-filters-hint">
            Ordena pulsando «Fecha y hora», «Confianza» o «R en vivo».
          </span>
        </div>
      )}

      {rows.length === 0 ? (
        <p className="muted">Aún no hay snapshots. Pulsa 📸 en el Panel para guardar el primero.</p>
      ) : visible.length === 0 ? (
        <p className="muted">Ningún registro pasa los filtros. Pulsa «Limpiar filtros».</p>
      ) : (
        <div className="snap-scroll">
          <table className="snap-table">
            <thead>
              <tr>
                {HEADERS.map(([label, tip]) => {
                  const key =
                    label === 'Fecha y hora'
                      ? ('fecha' as const)
                      : label === 'Confianza'
                        ? ('conf' as const)
                        : label === 'R en vivo'
                          ? ('liveR' as const)
                          : null;
                  return (
                    <Th
                      key={label}
                      label={key && sortKey === key ? `${label} ${sortDesc ? '↓' : '↑'}` : label}
                      tip={tip}
                      onSort={key ? () => toggleSort(key) : undefined}
                    />
                  );
                })}
                <th aria-label="acciones" />
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
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
                      <td>{new Date(r.captured_at).toLocaleString('es')}</td>
                      <td>{r.interval}</td>
                      <td className={actClass}>{r.action}</td>
                      <td className={dirClass}>{r.direction}</td>
                      <td>{pct(r.confidence)}</td>
                      <td>{num(r.plan_entry)}</td>
                      <td className="wh-short">{num(r.plan_stop)}</td>
                      <td className="wh-long">{num(r.plan_take_profit)}</td>
                      <td className={ESTADO_CLASS[r.estado]} title={ESTADO_TIP[r.estado]}>
                        {ESTADO_LABEL[r.estado]}
                        {r.estado === 'abierto' && t?.expired ? (
                          <span className="muted" title="La ventana de entrada ya venció"> (exp)</span>
                        ) : null}
                      </td>
                      <td
                        className={
                          r.estado === 'abierto'
                            ? (t?.liveR ?? 0) >= 0
                              ? 'wh-long'
                              : 'wh-short'
                            : (r.outcome_return_r ?? 0) >= 0
                              ? 'wh-long'
                              : 'wh-short'
                        }
                        title={
                          r.estado === 'abierto'
                            ? 'Recorrido actual, en múltiplos del riesgo. Cambia con el precio.'
                            : 'Resultado final de la operación, en múltiplos del riesgo.'
                        }
                      >
                        {r.estado === 'abierto' ? num(t?.liveR ?? null) : num(r.outcome_return_r)}
                      </td>
                      <td className="cell-actions">
                        <button
                          type="button"
                          className="row-btn"
                          aria-label="Ver gráfico del momento"
                          title="Ver el gráfico de cuando se guardó (con pizarra)"
                          onClick={() => setChartFor(r)}
                        >
                          📈
                        </button>
                        <button
                          type="button"
                          className={`row-btn row-arrow ${open ? 'open' : ''}`}
                          aria-label={open ? 'Contraer' : 'Desplegar'}
                          title={open ? 'Ocultar detalle' : 'Ver más datos'}
                          onClick={() => toggle(r.id)}
                        >
                          ⌄
                        </button>
                        <button
                          type="button"
                          className="row-btn row-del"
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
                          <details className="report-acc">
                            <summary>Informe completo de la decisión</summary>
                            <div className="report-acc-body">{buildReport(r, price)}</div>
                          </details>
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
            <p className="muted chart-legend">
              <span className="lg lg-entry" /> Entrada <span className="lg lg-stop" /> Stop
              <span className="lg lg-tp" /> Objetivo
              {chartFor.outcome_result
                ? ` · resultado: ${chartFor.outcome_result.toUpperCase()} (${num(chartFor.outcome_return_r)} R)`
                : ' · operación aún sin cerrar'}
              . Usa el ✏️ para dibujar sobre el gráfico.
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

function buildReport(r: SnapshotRow, price: number) {
  const t = r.tracking;
  const hasPlan =
    r.plan_entry !== null && r.plan_stop !== null && r.plan_take_profit !== null;
  let progress = 0;
  let toStop = 0;
  let toTp = 0;
  if (hasPlan) {
    const entry = r.plan_entry!;
    const stop = r.plan_stop!;
    const tp = r.plan_take_profit!;
    if (r.direction === 'LONG') {
      progress = (price - entry) / (tp - entry || 1);
      toStop = ((price - stop) / (entry - stop || 1)) * 100;
      toTp = ((tp - price) / (tp - entry || 1)) * 100;
    } else if (r.direction === 'SHORT') {
      progress = (entry - price) / (entry - tp || 1);
      toStop = ((stop - price) / (stop - entry || 1)) * 100;
      toTp = ((price - tp) / (entry - tp || 1)) * 100;
    }
  }
  const pctv = (n: number) => `${(n * 100).toFixed(0)}%`;
  const estado =
    r.outcome_result
      ? r.outcome_result === 'tp'
        ? 'Cerrada en objetivo (✓ TP)'
        : r.outcome_result === 'sl'
          ? 'Cerrada en stop (✗ SL)'
          : 'Cerrada por tiempo'
      : t?.status === 'tp'
        ? 'Alcanzó el objetivo (✓ TP)'
        : t?.status === 'sl'
          ? 'Tocó el stop (✗ SL)'
          : t?.status === 'en_curso'
            ? 'En curso'
            : 'Sin plan operable';

  let trayectoria: string;
  if (!hasPlan || r.direction === 'FLAT') {
    trayectoria = 'La decisión fue MANTENER/FLAT: no hay una operación con niveles que seguir.';
  } else if (r.outcome_result) {
    trayectoria = `La operación ya cerró con un resultado de ${num(r.outcome_return_r)} R.`;
  } else {
    const dir = progress >= 0 ? 'a favor' : 'en contra';
    trayectoria =
      `El precio va ${dir}: ha recorrido ${pctv(Math.max(0, Math.min(1, progress)))} del camino al objetivo. ` +
      `Queda ~${toTp.toFixed(0)}% hasta el objetivo y hay ~${toStop.toFixed(0)}% de margen antes del stop.` +
      (t?.expired ? ' Además, la validez de la entrada ya venció.' : '');
  }

  return (
    <div className="report-body">
      <div className="report-grid">
        <div>
          <span className="det-label">Acción / Dirección</span>
          <span className="det-value">
            {r.action} · {r.direction}
          </span>
        </div>
        <div>
          <span className="det-label">Confianza</span>
          <span className="det-value">{pct(r.confidence)}</span>
        </div>
        <div>
          <span className="det-label">Precio actual</span>
          <span className="det-value">{num(price)}</span>
        </div>
        <div>
          <span className="det-label">Entrada</span>
          <span className="det-value">{num(r.plan_entry)}</span>
        </div>
        <div>
          <span className="det-label">Stop</span>
          <span className="det-value wh-short">{num(r.plan_stop)}</span>
        </div>
        <div>
          <span className="det-label">Objetivo</span>
          <span className="det-value wh-long">{num(r.plan_take_profit)}</span>
        </div>
        <div>
          <span className="det-label">Resultado (R)</span>
          <span className={`det-value ${(t?.liveR ?? 0) >= 0 ? 'wh-long' : 'wh-short'}`}>
            {num(t?.liveR ?? null)}
          </span>
        </div>
        <div>
          <span className="det-label">Estado</span>
          <span className="det-value">{estado}</span>
        </div>
      </div>
      <div className="report-progress">
        <div
          className="report-progress-fill"
          style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
        />
      </div>
      <p className="report-text">{trayectoria}</p>
    </div>
  );
}

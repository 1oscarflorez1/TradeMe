import { useEffect, useState } from 'react';
import {
  fetchAutomation,
  fetchCalibration,
  fetchDatasetReport,
  fetchEnsemble,
  postAutomation,
  postReload,
  runCalibrate,
  trainMetamodel,
} from './api';
import type { AutomationStatus, DatasetReport, MetamodelResult } from './api';
import type { CalibrationMeta, EnsembleMeta, Interval, RegimeCalibrator, ReliabilityBin } from './types';

/** Laboratorio: todo lo que sirve para AFINAR el modelo (calibrar, optimizar, aprender). */
export function LabView({ symbol, interval }: { symbol: string; interval: Interval }) {
  return (
    <div className="bt-layout">
      <div className="bt-main">
        <CalibrationSection symbol={symbol} interval={interval} />
        <OptimizationSection symbol={symbol} interval={interval} />
        <DatasetSection />
        <AutomationSection />
      </div>
      <LabGuide />
    </div>
  );
}

function ReliabilityDiagram({ bins }: { bins: ReliabilityBin[] }) {
  const s = 150;
  const pad = 6;
  const X = (p: number) => pad + p * (s - 2 * pad);
  const Y = (p: number) => s - pad - p * (s - 2 * pad);
  return (
    <svg viewBox={`0 0 ${s} ${s}`} className="calib-plot">
      <rect x={pad} y={pad} width={s - 2 * pad} height={s - 2 * pad} fill="none" stroke="#232b38" />
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} stroke="#3a4658" strokeDasharray="3 3" />
      <polyline
        points={bins.map((b) => `${X(b.p_pred)},${Y(b.p_true)}`).join(' ')}
        fill="none"
        stroke="#4da3ff"
        strokeWidth="1.5"
      />
      {bins.map((b, i) => (
        <circle
          key={i}
          cx={X(b.p_pred)}
          cy={Y(b.p_true)}
          r={Math.max(1.5, Math.min(5, Math.sqrt(b.n)))}
          fill="#4da3ff"
        />
      ))}
    </svg>
  );
}

function CalibrationSection({ symbol, interval }: { symbol: string; interval: Interval }) {
  const [cal, setCal] = useState<CalibrationMeta | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [calibrating, setCalibrating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCalibration().then((r) => {
      if (!cancelled) {
        setCal(r);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded) return null;
  const regimes: Array<[string, RegimeCalibrator]> = cal ? Object.entries(cal.regimes) : [];
  const trained = regimes.some(([, c]) => c.method !== 'identity');

  return (
    <section className="panel calib-panel">
      <div className="chart-head">
        <strong>Calibración de probabilidades</strong>
        <span className="muted">
          · diagrama de fiabilidad{cal?.version ? ` · ${cal.version}` : ''}
        </span>
        <button
          type="button"
          className="bt-run bt-opt"
          style={{ marginLeft: 'auto' }}
          disabled={calibrating}
          title="Entrena los calibradores (isotónica/Platt por régimen) con el backtest de esta temporalidad y los aplica en caliente"
          onClick={() => {
            setCalibrating(true);
            void runCalibrate(symbol, interval)
              .then(async (r) => {
                if (r.ok) {
                  await postReload();
                  const fresh = await fetchCalibration();
                  setCal(fresh);
                }
              })
              .finally(() => setCalibrating(false));
          }}
        >
          {calibrating ? 'Calibrando…' : '🎯 Calibrar'}
        </button>
      </div>
      {!trained ? (
        <p className="muted">
          Aún sin calibrador entrenado. Pulsa <strong>🎯 Calibrar</strong> para entrenarlo con el
          backtest de esta temporalidad (ajusta la confianza a la frecuencia real de acierto).
        </p>
      ) : (
        <div className="calib-grid">
          {regimes.map(([name, c]) => (
            <div key={name} className="calib-card">
              <div className="calib-title">
                <strong>{name}</strong>
                <span className="muted">
                  {c.method} · n={c.n ?? 0} · Brier {c.brier != null ? c.brier.toFixed(3) : '—'}
                </span>
              </div>
              {c.reliability && c.reliability.length > 0 ? (
                <ReliabilityDiagram bins={c.reliability} />
              ) : (
                <p className="muted">sin datos suficientes</p>
              )}
            </div>
          ))}
        </div>
      )}
      <p className="muted calib-legend">
        La diagonal punteada es la calibración perfecta (probabilidad prevista = frecuencia real de
        acierto). Cuanto más pegados los puntos a ella, más honestas las probabilidades; un Brier más
        bajo es mejor.
      </p>
    </section>
  );
}

function fmtR(n: number | undefined): string {
  return n == null ? '—' : `${n.toFixed(3)} R`;
}

function OptimizationSection({ symbol, interval }: { symbol: string; interval: Interval }) {
  const [meta, setMeta] = useState<EnsembleMeta | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchEnsemble(symbol, interval).then((r) => {
      if (!cancelled) {
        setMeta(r);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [symbol, interval]);

  if (!loaded) return null;
  const report = meta?.report ?? null;

  return (
    <section className="panel opt-panel">
      <div className="chart-head">
        <strong>Optimización de pesos</strong>
        <span className="muted">
          · {interval} · Optuna + walk-forward{meta?.version ? ` · activo: ${meta.version}` : ''}
        </span>
      </div>
      {!report ? (
        <p className="muted">
          Aún sin optimización para esta temporalidad. El 🤖 piloto la hará solo cuando toque, o
          pulsa <strong>⚙ Optimizar</strong> arriba si la quieres ahora.
        </p>
      ) : (
        <>
          <div className="opt-verdict">
            {report.promoted ? (
              <span className="opt-badge opt-ok">✓ Promovido (gana en hold-out)</span>
            ) : (
              <span className="opt-badge opt-no">Base mantenido (no supera el hold-out)</span>
            )}
            <span className="muted">
              {report.n_trials} trials · score val. {report.validation_score.toFixed(3)}
            </span>
          </div>
          <table className="opt-table">
            <thead>
              <tr>
                <th>Hold-out</th>
                <th>Expectancy</th>
                <th>Trades</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Base</td>
                <td>{fmtR(report.holdout.base_expectancy)}</td>
                <td>{report.holdout.base_trades}</td>
              </tr>
              <tr className={report.promoted ? 'opt-win' : ''}>
                <td>Optimizado</td>
                <td>{fmtR(report.holdout.optimized_expectancy)}</td>
                <td>{report.holdout.optimized_trades}</td>
              </tr>
            </tbody>
          </table>
          <p className="muted calib-legend">
            El candidato solo se promociona si su expectancy en el tramo hold-out (nunca usado en la
            búsqueda) supera al base. Así se evita el sobreajuste.
          </p>
        </>
      )}
    </section>
  );
}

function DatasetSection() {
  const [rep, setRep] = useState<DatasetReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [training, setTraining] = useState(false);
  const [mm, setMm] = useState<MetamodelResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchDatasetReport().then((r) => {
      if (!cancelled) {
        setRep(r);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!loaded || !rep) return null;

  return (
    <section className="panel opt-panel">
      <div className="chart-head">
        <strong title="Estado del dataset de decisiones evaluadas con el que se entrenará el meta-modelo de ML (Módulo 2). Solo se entrena cuando hay datos suficientes y balanceados.">
          Dataset ML
        </strong>
        <span className="muted">· preparación para el meta-modelo</span>
        {rep.ready ? (
          <span className="opt-badge opt-ok" style={{ marginLeft: 'auto' }}>
            ✓ Listo para entrenar
          </span>
        ) : (
          <span className="opt-badge opt-no" style={{ marginLeft: 'auto' }}>
            Aún acumulando datos
          </span>
        )}
        <button
          type="button"
          className="bt-run bt-opt"
          disabled={training}
          title="¿QUÉ HACE? Reentrena el meta-modelo con TODOS tus registros ya evaluados (los que tocaron objetivo o stop) para que aprenda a distinguir señales fiables de falsos positivos. ¿CUÁNDO PULSARLO? No es necesario: el piloto lo reentrena cada 12 h. Púlsalo si acabas de acumular muchos registros nuevos y quieres ver el efecto ya, o después de cambiar la estrategia. Solo se publica si mejora la expectancy en validación temporal."
          onClick={() => {
            setTraining(true);
            void trainMetamodel()
              .then(setMm)
              .finally(() => setTraining(false));
          }}
        >
          {training ? 'Entrenando…' : '🧠 Entrenar ahora'}
        </button>
      </div>
      <div className="reg-summary" style={{ marginTop: '0.6rem' }}>
        <span className="reg-chip" title="Snapshots guardados en total">
          Total <strong>{rep.total}</strong>
        </span>
        <span
          className="reg-chip"
          title="Decisiones que ya tocaron TP o SL: son las que pueden enseñar al modelo"
        >
          Evaluadas <strong>{rep.evaluated}</strong> / {rep.criteria.min_evaluated}
        </span>
        <span className="reg-chip reg-chip-ok" title="Decisiones que alcanzaron el objetivo">
          ✓ TP <strong>{rep.tp}</strong>
        </span>
        <span className="reg-chip reg-chip-bad" title="Decisiones que tocaron el stop">
          ✗ SL <strong>{rep.sl}</strong>
        </span>
        <span className="reg-chip" title="Snapshots con todas las columnas clave completas">
          Features <strong>{(rep.feature_completeness * 100).toFixed(0)}%</strong>
        </span>
      </div>
      {mm && (
        <p className="bt-runmsg">
          {mm.trained
            ? `Entrenado con ${mm.n} decisiones · AUC ${mm.auc?.toFixed(2)} · umbral ${((mm.threshold ?? 0) * 100).toFixed(0)}% · expectancy ${mm.baseline_expectancy?.toFixed(3)}R → ${mm.filtered_expectancy?.toFixed(3)}R · ${mm.published ? '✓ publicado' : 'no publicado (no mejora)'}`
            : `No entrenado: ${mm.reason}`}
        </p>
      )}
      {!rep.ready && rep.reasons.length > 0 && (
        <ul className="ds-reasons">
          {rep.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
      <p className="muted calib-legend">
        <strong>🧠 Entrenar ahora:</strong> reentrena el meta-modelo con tus registros evaluados
        para filtrar falsos positivos. No hace falta pulsarlo —el piloto lo hace cada 12 h—; úsalo
        si acumulaste muchos registros nuevos o cambiaste la estrategia. Solo se publica si mejora
        la expectancy en validación.
      </p>
      <p className="muted calib-legend">
        El meta-modelo (Módulo 2) se entrenará <strong>solo</strong> cuando este panel esté en
        verde: exige suficientes decisiones evaluadas, ejemplos de ambos desenlaces (TP y SL) y
        features completas. Los snapshots automáticos alimentan este dataset; el botón ▶ evalúa
        los pendientes.
      </p>
    </section>
  );
}

function fmtH(h: number | null): string {
  if (h === null) return 'nunca';
  if (h < 1) return `hace ${Math.round(h * 60)} min`;
  if (h < 48) return `hace ${h.toFixed(0)} h`;
  return `hace ${(h / 24).toFixed(1)} días`;
}

const ALL_TFS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w', '1M'];

function AutomationSection() {
  const [st, setSt] = useState<AutomationStatus | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    enabled: true,
    backtest_every_h: 6,
    optimize_every_d: 7,
    cooldown_h: 48,
    intervals: [] as string[],
  });

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchAutomation().then((r) => {
        if (!cancelled) setSt(r);
      });
    void load();
    const id = setInterval(() => void load(), 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!st) return null;

  return (
    <section className="panel opt-panel">
      <div className="chart-head">
        <strong title="Worker en el servicio quant: mide cada pocas horas y optimiza solo por mantenimiento o degradación, con cooldown y gate de hold-out. Te avisa por la campana cuando promueve una config o detecta degradación sin mejora.">
          🤖 Piloto automático
        </strong>
        <span className="muted">
          · mide cada {st.backtest_every_h}h · optimiza cada {(st.optimize_every_h / 24).toFixed(0)}d
          o si se degrada · cooldown {st.cooldown_h}h
        </span>
        <span
          className={`opt-badge ${st.enabled ? 'opt-ok' : 'opt-no'}`}
          style={{ marginLeft: 'auto' }}
        >
          {st.enabled ? 'Activo' : 'Apagado'}
        </span>
        <button
          type="button"
          className="bt-run bt-opt"
          onClick={() => {
            setForm({
              enabled: st.enabled,
              backtest_every_h: st.backtest_every_h,
              optimize_every_d: Math.round(st.optimize_every_h / 24),
              cooldown_h: st.cooldown_h,
              intervals: st.intervals,
            });
            setEditing((v) => !v);
          }}
        >
          ⚙ Configurar
        </button>
      </div>
      {editing && (
        <div className="auto-form">
          <label className="auto-row">
            <input
              type="checkbox"
              checked={form.enabled}
              onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
            />
            <span>Piloto activo</span>
          </label>
          <label className="auto-row">
            <span className="auto-k">Medir cada</span>
            <input
              type="number"
              min={1}
              max={168}
              value={form.backtest_every_h}
              onChange={(e) => setForm({ ...form, backtest_every_h: Number(e.target.value) })}
            />
            <span className="muted">horas</span>
          </label>
          <label className="auto-row">
            <span className="auto-k">Optimizar cada</span>
            <input
              type="number"
              min={1}
              max={60}
              value={form.optimize_every_d}
              onChange={(e) => setForm({ ...form, optimize_every_d: Number(e.target.value) })}
            />
            <span className="muted">días (o antes si se degrada)</span>
          </label>
          <label className="auto-row">
            <span className="auto-k">Cooldown</span>
            <input
              type="number"
              min={1}
              max={720}
              value={form.cooldown_h}
              onChange={(e) => setForm({ ...form, cooldown_h: Number(e.target.value) })}
            />
            <span className="muted">horas mínimas entre optimizaciones</span>
          </label>
          <div className="auto-row auto-tfs">
            <span className="auto-k">Temporalidades</span>
            {ALL_TFS.map((tf) => (
              <label key={tf} className="auto-tf">
                <input
                  type="checkbox"
                  checked={form.intervals.includes(tf)}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      intervals: e.target.checked
                        ? [...form.intervals, tf]
                        : form.intervals.filter((x) => x !== tf),
                    })
                  }
                />
                {tf}
              </label>
            ))}
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-ghost" onClick={() => setEditing(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className="bt-run"
              disabled={saving || form.intervals.length === 0}
              onClick={() => {
                setSaving(true);
                void postAutomation({
                  enabled: form.enabled,
                  backtest_every_h: form.backtest_every_h,
                  optimize_every_h: form.optimize_every_d * 24,
                  cooldown_h: form.cooldown_h,
                  intervals: form.intervals,
                })
                  .then((r) => {
                    if (r) {
                      setSt(r);
                      setEditing(false);
                    }
                  })
                  .finally(() => setSaving(false));
              }}
            >
              {saving ? 'Guardando…' : 'Guardar política'}
            </button>
          </div>
          <p className="muted" style={{ fontSize: '0.72rem' }}>
            Los cambios se guardan en el servidor y el piloto los aplica en su siguiente ciclo
            (≤15 min), sin reiniciar nada.
          </p>
        </div>
      )}
      <table className="opt-table">
        <thead>
          <tr>
            <th>Temporalidad</th>
            <th>Última medición</th>
            <th>Última optimización</th>
          </tr>
        </thead>
        <tbody>
          {st.per_tf.map((t) => (
            <tr key={`${t.symbol}:${t.interval}`}>
              <td>{t.interval}</td>
              <td>{fmtH(t.hours_since_backtest)}</td>
              <td>{fmtH(t.hours_since_optimize)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="reg-summary" style={{ marginTop: '0.5rem' }}>
        <span className="reg-chip" title="El piloto recalibra siempre tras promover parámetros nuevos y por mantenimiento periódico">
          Calibración <strong>{fmtH(st.hours_since_calibration ?? null)}</strong>
        </span>
        <span className="reg-chip" title="Reentrenamiento del meta-modelo con los registros evaluados nuevos">
          Meta-modelo <strong>{fmtH(st.hours_since_metamodel ?? null)}</strong>
        </span>
        {st.meta_policy?.mode && (
          <span
            className="reg-chip"
            title="El sistema asciende solo este modo cuando el meta-modelo demuestra ventaja con tus propias decisiones: sombra (solo observa) → modular (ajusta la confianza) → veto (descarta señales poco fiables). Si empeora, retrocede."
          >
            Filtro ML <strong>{st.meta_policy.mode}</strong>
          </span>
        )}
      </div>
      {st.meta_policy?.reason && (
        <p className="bt-runmsg">
          🧠 <strong>Modo {st.meta_policy.mode}</strong> · {st.meta_policy.reason}
          {st.meta_policy.evidence?.n
            ? ` (${st.meta_policy.evidence.n} decisiones, mejora ${(st.meta_policy.evidence.lift ?? 0).toFixed(3)} R, AUC ${(st.meta_policy.evidence.auc ?? 0).toFixed(2)})`
            : ''}
        </p>
      )}
      <p className="muted calib-legend">
        Ya no necesitas vigilar ni decidir cuándo pulsar: el piloto mide, evalúa tus registros,
        optimiza solo cuando toca (nunca promueve sin ganar en hold-out), **recalibra** tras cada
        promoción y por mantenimiento, **reentrena el meta-modelo** con los registros nuevos, y te
        avisa por la campana 🔔. Los botones quedan para cuando quieras un resultado inmediato.
      </p>
    </section>
  );
}

function LabGuide() {
  return (
    <aside className="panel bt-guide">
      <details className="bt-acc" open>
        <summary>¿Qué es el Laboratorio?</summary>
        <div className="bt-acc-body">
          <p>
            Aquí se <strong>afina el modelo</strong>. El Panel decide, Registros comprueba en vivo y
            Backtest mide sobre el histórico; el Laboratorio es donde se ajusta la maquinaria:
            calibrar las probabilidades, optimizar los parámetros, entrenar el meta-modelo y
            supervisar al piloto que hace todo eso por ti.
          </p>
          <p>
            Regla de oro: <strong>ningún cambio se aplica si no gana en datos que no vio</strong>
            (hold-out / validación temporal). Por eso a veces verás «no promovido»: es el sistema
            protegiéndote del sobreajuste.
          </p>
        </div>
      </details>

      <div className="bt-acc-group">
        <h4>Meta-modelo (ML) · pulsa para desplegar</h4>
        <details className="bt-acc">
          <summary>¿Qué hace?</summary>
          <div className="bt-acc-body">
            <p>
              Aprende de tus decisiones ya evaluadas (las que tocaron objetivo o stop) a estimar qué
              probabilidad de éxito tiene cada señal nueva. Sirve de <strong>filtro
              anti-falsos-positivos</strong>: no cambia la dirección, ajusta la confianza.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>AUC y umbral</summary>
          <div className="bt-acc-body">
            <p>
              <strong>AUC</strong> mide su capacidad de distinguir aciertos de fallos: 0,5 es azar,
              1,0 perfecto; entre 0,6 y 0,7 ya aporta valor real en trading. El{' '}
              <strong>umbral</strong> es el corte elegido: por debajo de esa probabilidad, la señal
              se considera poco fiable.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>¿Cuándo entrenar?</summary>
          <div className="bt-acc-body">
            <p>
              No hace falta que lo hagas: el piloto reentrena cada 12 h con los registros nuevos.
              Pulsa <strong>🧠 Entrenar ahora</strong> solo si acabas de acumular muchos registros y
              quieres ver el efecto ya, o tras cambiar la estrategia. Publicar solo ocurre si mejora
              la expectancy en validación.
            </p>
          </div>
        </details>
      </div>

      <div className="bt-acc-group">
        <h4>Calibración de probabilidades · pulsa para desplegar</h4>
        <details className="bt-acc">
          <summary>¿Qué es calibrar?</summary>
          <div className="bt-acc-body">
            <p>
              Ajusta la confianza del modelo para que refleje la frecuencia real de acierto: que
              cuando diga «70%», acierte ~70% de las veces. Se hace por régimen (tendencia/rango).
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Diagrama de fiabilidad</summary>
          <div className="bt-acc-body">
            <p>
              Probabilidad prevista (eje X) frente a frecuencia real de acierto (eje Y). La diagonal
              es la calibración perfecta: cuanto más pegados los puntos a ella, más honestas las
              probabilidades.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Brier score</summary>
          <div className="bt-acc-body">
            <p>
              Error cuadrático medio entre la probabilidad y el resultado (0/1). Más bajo = mejor
              calibración. Se elige entre isotónica y Platt el de menor Brier.
            </p>
          </div>
        </details>
      </div>

      <div className="bt-acc-group">
        <h4>Optimización de pesos · pulsa para desplegar</h4>
        <details className="bt-acc">
          <summary>Optuna</summary>
          <div className="bt-acc-body">
            <p>
              Buscador bayesiano (TPE) que prueba combinaciones de pesos de los indicadores y
              multiplicadores de régimen para maximizar la ventaja, de forma más eficiente que
              probar al azar.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Walk-forward (purga/embargo)</summary>
          <div className="bt-acc-body">
            <p>
              Validación temporal por bloques hacia adelante. La «purga» descarta trades cuyo
              horizonte cruza el borde del bloque y el «embargo» separa bloques, evitando fuga
              temporal entre entrenamiento y prueba.
            </p>
          </div>
        </details>
        <details className="bt-acc">
          <summary>Hold-out y promoción</summary>
          <div className="bt-acc-body">
            <p>
              Se reserva un tramo final (nunca usado en la búsqueda). El candidato optimizado solo
              se promociona si supera al base en ese hold-out: así se evita el sobreajuste.
            </p>
          </div>
        </details>
      </div>
    </aside>
  );
}

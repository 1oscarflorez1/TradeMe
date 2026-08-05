import { useEffect, useState } from 'react';
import { fetchSustento, fetchSignal } from './api';
import type { Sustento } from './api';
import type { Interval, Signal } from './types';

const FAMILIA_COLOR: Record<string, string> = {
  tendencia: 'fam-trend',
  momentum: 'fam-mom',
  reversión: 'fam-rev',
};

/** Aguja sobre un arco de −1 a +1: la lectura instantánea de hacia dónde se inclina el motor. */
function Tacometro({ net, action, confidence }: { net: number; action: string; confidence: number }) {
  const v = Math.max(-1, Math.min(1, net));
  const ang = -90 + v * 90; // −1 → −180°, 0 → −90°, +1 → 0°
  const rad = ((ang - 90) * Math.PI) / 180;
  const cx = 150;
  const cy = 140;
  const r = 108;
  const color = action === 'BUY' ? 'var(--buy)' : action === 'SELL' ? 'var(--sell)' : 'var(--muted)';

  const arco = (desde: number, hasta: number) => {
    const p = (t: number) => {
      const a = ((-90 + t * 90 - 90) * Math.PI) / 180;
      return `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
    };
    return `M ${p(desde)} A ${r} ${r} 0 0 1 ${p(hasta)}`;
  };

  return (
    <svg viewBox="0 0 300 175" className="taco" role="img" aria-label={`Inclinación ${net.toFixed(2)}`}>
      <path d={arco(-1, -0.06)} fill="none" stroke="var(--sell)" strokeWidth="14" opacity="0.28" strokeLinecap="round" />
      <path d={arco(-0.06, 0.06)} fill="none" stroke="var(--muted)" strokeWidth="14" opacity="0.35" />
      <path d={arco(0.06, 1)} fill="none" stroke="var(--buy)" strokeWidth="14" opacity="0.28" strokeLinecap="round" />
      <line
        x1={cx}
        y1={cy}
        x2={cx + (r - 22) * Math.cos(rad)}
        y2={cy + (r - 22) * Math.sin(rad)}
        stroke={color}
        strokeWidth="3.5"
        strokeLinecap="round"
      />
      <circle cx={cx} cy={cy} r="7" fill={color} />
      <text x={cx} y={cy - 42} textAnchor="middle" className="taco-act" fill={color}>
        {action === 'BUY' ? 'COMPRAR' : action === 'SELL' ? 'VENDER' : 'MANTENER'}
      </text>
      <text x={cx} y={cy - 20} textAnchor="middle" className="taco-conf">
        {(confidence * 100).toFixed(0)}% de confianza
      </text>
      <text x={cx - r} y={cy + 22} textAnchor="middle" className="taco-eje">
        vender
      </text>
      <text x={cx + r} y={cy + 22} textAnchor="middle" className="taco-eje">
        comprar
      </text>
      <text x={cx} y={cy + 22} textAnchor="middle" className="taco-eje">
        {net >= 0 ? '+' : ''}
        {net.toFixed(3)}
      </text>
    </svg>
  );
}

/** Barra horizontal centrada en cero: aportación de un indicador al resultado. */
function BarraAporte({ valor, max }: { valor: number; max: number }) {
  const escala = max > 0 ? Math.abs(valor) / max : 0;
  const ancho = Math.min(50, escala * 50);
  return (
    <div className="aporte">
      <div className="aporte-eje" />
      <div
        className={`aporte-barra ${valor >= 0 ? 'pos' : 'neg'}`}
        style={valor >= 0 ? { left: '50%', width: `${ancho}%` } : { right: '50%', width: `${ancho}%` }}
      />
    </div>
  );
}

/**
 * Panel de decisión: por qué el motor dice lo que dice.
 *
 * Tres preguntas en orden: qué decide ahora (el tacómetro), quién lo empuja (la aportación de cada
 * indicador) y por qué ese indicador merece el peso que tiene (su evidencia histórica).
 */
export function SustentoView({ symbol, interval }: { symbol: string; interval: Interval }) {
  const [d, setD] = useState<Sustento | null>(null);
  const [sig, setSig] = useState<Signal | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    if (!symbol) return;
    let cancelado = false;
    const cargar = () => {
      void Promise.all([fetchSustento(symbol, interval), fetchSignal(symbol, interval)]).then(
        ([s, g]) => {
          if (cancelado) return;
          setD(s);
          setSig(g);
          setCargando(false);
        },
      );
    };
    cargar();
    const id = setInterval(cargar, 10_000);
    return () => {
      cancelado = true;
      clearInterval(id);
    };
  }, [symbol, interval]);

  if (cargando) return <p className="muted">Calculando el sustento…</p>;
  if (!d || !sig) return <p className="muted">No se pudo cargar el sustento de la decisión.</p>;

  const votos = new Map(sig.votes.map((v) => [v.key, v]));
  const enTendencia = (sig.regime?.label ?? '') === 'tendencia';
  const mult = enTendencia ? d.regimen.trend : d.regimen.range;

  const filas = d.evidencia.map((e) => {
    const voto = votos.get(e.clave)?.value ?? 0;
    const pesoBase = d.pesos[e.clave] ?? 0;
    const m = mult[e.familia === 'reversión' ? 'reversion' : e.familia] ?? 1;
    const pesoEfectivo = pesoBase * m;
    return { ...e, voto, pesoBase, multiplicador: m, pesoEfectivo, aporte: voto * pesoEfectivo };
  });
  const maxAporte = Math.max(0.001, ...filas.map((f) => Math.abs(f.aporte)));
  const sumaPesos = filas.reduce((a, f) => a + f.pesoEfectivo, 0);

  const pct = (n: number | null) => (n === null ? '—' : `${(n * 100).toFixed(0)}%`);

  return (
    <div className="bt-layout lab-layout">
      <p className="lab-intro">
        Esta pestaña responde a una sola pregunta: <strong>¿por qué el motor dice lo que dice?</strong>{' '}
        Arriba, la decisión actual. En medio, quién la empuja y con cuánta fuerza. Abajo, la evidencia
        que justifica el peso de cada indicador — porque un peso sin evidencia es una opinión.
      </p>

      <section className="panel sus-cabecera">
        <div className="sus-taco">
          <Tacometro net={sig.net} action={sig.action} confidence={sig.confidence} />
        </div>
        <div className="sus-ctx">
          <div className="sus-ctx-item">
            <span className="det-label">Configuración activa</span>
            <strong>{d.optimizado ? 'Optimizada para esta temporalidad' : 'Base común'}</strong>
            <span className="muted">{d.version}</span>
          </div>
          <div className="sus-ctx-item">
            <span className="det-label">Régimen detectado</span>
            <strong>{enTendencia ? 'Tendencia' : 'Rango'}</strong>
            <span className="muted">
              ADX {sig.regime?.adx?.toFixed(1) ?? '—'} · escala {d.regimen.adx_lo}–{d.regimen.adx_hi}
            </span>
          </div>
          <div className="sus-ctx-item">
            <span className="det-label">Banda neutra</span>
            <strong>±{d.holdBand}</strong>
            <span className="muted">
              Por debajo de esa inclinación se prefiere MANTENER
            </span>
          </div>
          <div className="sus-ctx-item">
            <span className="det-label">Riesgo por operación</span>
            <strong>{(d.riesgo.riskPct * 100).toFixed(1)}%</strong>
            <span className="muted">
              stop a {d.riesgo.atrStopMult}·ATR · objetivo a {d.riesgo.tpRMultiple}R
            </span>
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="chart-head">
          <strong>Quién empuja la decisión</strong>
          <span className="muted">
            · aportación = voto × peso efectivo · el régimen {enTendencia ? 'de tendencia' : 'de rango'}{' '}
            reescala cada familia
          </span>
        </div>

        <div className="snap-scroll">
          <table className="snap-table sus-tabla">
            <thead>
              <tr>
                <th>Indicador</th>
                <th title="Voto actual, entre −1 (vender) y +1 (comprar)">Voto</th>
                <th title="Peso base de la configuración activa">Peso</th>
                <th title="Multiplicador que aplica el régimen actual a esta familia">Régimen</th>
                <th title="Peso base × multiplicador de régimen">Peso efectivo</th>
                <th title="Voto × peso efectivo: lo que este indicador aporta a la inclinación final">
                  Aportación
                </th>
                <th>Empuje</th>
              </tr>
            </thead>
            <tbody>
              {[...filas]
                .sort((a, b) => Math.abs(b.aporte) - Math.abs(a.aporte))
                .map((f) => (
                  <tr key={f.clave}>
                    <td>
                      <strong>{f.etiqueta}</strong>
                      <span className={`sus-fam ${FAMILIA_COLOR[f.familia] ?? ''}`}>{f.familia}</span>
                    </td>
                    <td className={f.voto >= 0 ? 'wh-long' : 'wh-short'}>
                      {f.voto >= 0 ? '+' : ''}
                      {f.voto.toFixed(2)}
                    </td>
                    <td className="muted">{f.pesoBase.toFixed(2)}</td>
                    <td className={f.multiplicador > 1 ? 'wh-long' : f.multiplicador < 1 ? 'muted' : ''}>
                      ×{f.multiplicador.toFixed(2)}
                    </td>
                    <td>{f.pesoEfectivo.toFixed(2)}</td>
                    <td className={f.aporte >= 0 ? 'wh-long' : 'wh-short'}>
                      {f.aporte >= 0 ? '+' : ''}
                      {f.aporte.toFixed(3)}
                    </td>
                    <td>
                      <BarraAporte valor={f.aporte} max={maxAporte} />
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="muted calib-legend">
          La inclinación final es la media ponderada de estas aportaciones (suma de pesos efectivos:{' '}
          {sumaPesos.toFixed(2)}), pasada por una función que la convierte en probabilidades y por la
          banda neutra de ±{d.holdBand}. Por eso una mayoría de votos débiles puede quedarse en
          MANTENER.
        </p>
      </section>

      <section className="panel">
        <div className="chart-head">
          <strong>Por qué cada indicador merece su peso</strong>
          <span className="muted">· evidencia sobre decisiones ya evaluadas de {interval}</span>
        </div>

        <div className="snap-scroll">
          <table className="snap-table sus-tabla">
            <thead>
              <tr>
                <th>Indicador</th>
                <th title="Veces que el indicador apuntó en la misma dirección que la decisión">
                  Acompañó
                </th>
                <th title="Acierto cuando acompañaba">Acierto</th>
                <th title="Veces que apuntó en contra">Se opuso</th>
                <th title="Acierto cuando se oponía">Acierto</th>
                <th title="Diferencia entre ambos aciertos. Es el valor real que aporta el indicador">
                  Aporte real
                </th>
              </tr>
            </thead>
            <tbody>
              {[...d.evidencia]
                .sort((a, b) => (b.lift ?? -9) - (a.lift ?? -9))
                .map((e) => (
                  <tr key={e.clave}>
                    <td>
                      <strong>{e.etiqueta}</strong>
                    </td>
                    <td className="muted">{e.nAcuerdo}</td>
                    <td>{pct(e.aciertoAcuerdo)}</td>
                    <td className="muted">{e.nDesacuerdo}</td>
                    <td>{pct(e.aciertoDesacuerdo)}</td>
                    <td
                      className={
                        e.lift === null ? 'muted' : e.lift > 0.03 ? 'wh-long' : e.lift < -0.03 ? 'wh-short' : 'muted'
                      }
                    >
                      {e.lift === null
                        ? 'sin muestra'
                        : `${e.lift >= 0 ? '+' : ''}${(e.lift * 100).toFixed(1)} pts`}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>

        <p className="muted calib-legend">
          <strong>Cómo leerlo:</strong> «aporte real» compara el acierto cuando el indicador acompañaba
          a la decisión con el acierto cuando se oponía. Positivo significa que aporta información;
          cerca de cero, que está de adorno; negativo, que estorba. Hace falta un mínimo de diez casos
          en cada columna para dar una cifra — con menos, un porcentaje sería inventado.
        </p>
        <p className="muted calib-legend">
          <strong>Lo que esta tabla todavía no puede decirte:</strong> el peso de hoy lo eligió Optuna
          maximizando el resultado del backtest, no esta evidencia. Cuando haya muestra suficiente,
          estos números podrán fijar los pesos directamente, y distintos por régimen. Ese es el
          siguiente paso, y depende de acumular decisiones evaluadas.
        </p>
      </section>
    </div>
  );
}

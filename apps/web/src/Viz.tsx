/**
 * Piezas visuales reutilizables (SVG puro, sin dependencias).
 * Sirven para abrir la "caja negra": convertir números sueltos en algo que se entienda de un vistazo.
 */

/** Semicírculo tipo velocímetro. Útil para métricas acotadas (AUC, Brier, confianza…). */
export function Gauge({
  value,
  min = 0,
  max = 1,
  label,
  sublabel,
  good,
  size = 120,
}: {
  value: number | null | undefined;
  min?: number;
  max?: number;
  label: string;
  sublabel?: string;
  /** true = verde, false = rojo, undefined = azul neutro */
  good?: boolean;
  size?: number;
}) {
  const w = size;
  const h = size * 0.62;
  const cx = w / 2;
  const cy = h - 6;
  const r = w / 2 - 12;
  const v = value ?? min;
  const pct = Math.max(0, Math.min(1, (v - min) / (max - min || 1)));
  const angle = Math.PI * (1 - pct);
  const x = cx + r * Math.cos(angle);
  const y = cy - r * Math.sin(angle);
  const color = good === undefined ? '#4da3ff' : good ? '#2fbf6b' : '#e0645f';
  const arc = (from: number, to: number): string => {
    const a1 = Math.PI * (1 - from);
    const a2 = Math.PI * (1 - to);
    return `M ${cx + r * Math.cos(a1)} ${cy - r * Math.sin(a1)} A ${r} ${r} 0 0 1 ${
      cx + r * Math.cos(a2)
    } ${cy - r * Math.sin(a2)}`;
  };
  return (
    <div className="viz-gauge">
      <svg viewBox={`0 0 ${w} ${h + 4}`} width={w} height={h + 4} role="img" aria-label={label}>
        <path d={arc(0, 1)} stroke="#232b38" strokeWidth="9" fill="none" strokeLinecap="round" />
        {pct > 0.001 && (
          <path d={arc(0, pct)} stroke={color} strokeWidth="9" fill="none" strokeLinecap="round" />
        )}
        <circle cx={x} cy={y} r={4} fill={color} />
        <text x={cx} y={cy - 8} textAnchor="middle" className="viz-gauge-value" fill={color}>
          {value === null || value === undefined ? '—' : v.toFixed(2)}
        </text>
      </svg>
      <div className="viz-gauge-label">{label}</div>
      {sublabel && <div className="viz-gauge-sub">{sublabel}</div>}
    </div>
  );
}

/** Barra de progreso hacia un objetivo (p. ej. 24 de 40 decisiones necesarias). */
export function ProgressBar({
  value,
  target,
  label,
  unit = '',
  title,
}: {
  value: number;
  target: number;
  label: string;
  unit?: string;
  title?: string;
}) {
  const pct = Math.max(0, Math.min(1, target > 0 ? value / target : 0));
  const done = value >= target;
  return (
    <div className="viz-prog" title={title}>
      <div className="viz-prog-head">
        <span>{label}</span>
        <strong className={done ? 'wh-long' : ''}>
          {value}
          {unit} / {target}
          {unit} {done ? '✓' : ''}
        </strong>
      </div>
      <div className="viz-prog-track">
        <span
          className={`viz-prog-fill ${done ? 'is-done' : ''}`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  );
}

/** Barra comparativa entre dos valores (base vs optimizado, antes vs después…). */
export function CompareBars({
  items,
  unit = '',
}: {
  items: Array<{ label: string; value: number; good?: boolean }>;
  unit?: string;
}) {
  const max = Math.max(...items.map((i) => Math.abs(i.value)), 0.0001);
  return (
    <div className="viz-cmp">
      {items.map((i) => {
        const pct = (Math.abs(i.value) / max) * 100;
        const positive = i.value >= 0;
        return (
          <div key={i.label} className="viz-cmp-row">
            <span className="viz-cmp-label">{i.label}</span>
            <div className="viz-cmp-track">
              <span
                className={`viz-cmp-fill ${positive ? 'pos' : 'neg'} ${i.good ? 'is-best' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className={`viz-cmp-value ${positive ? 'wh-long' : 'wh-short'}`}>
              {i.value >= 0 ? '+' : ''}
              {i.value.toFixed(3)}
              {unit}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/** Anillo de proporción (TP vs SL, aciertos vs fallos…). */
export function Donut({
  parts,
  size = 96,
  center,
}: {
  parts: Array<{ label: string; value: number; color: string }>;
  size?: number;
  center?: string;
}) {
  const total = parts.reduce((a, p) => a + p.value, 0) || 1;
  const r = size / 2 - 9;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="viz-donut">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#232b38" strokeWidth="9" />
          {parts.map((p) => {
            const len = (p.value / total) * c;
            const el = (
              <circle
                key={p.label}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={p.color}
                strokeWidth="9"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </g>
        {center && (
          <text x={size / 2} y={size / 2 + 5} textAnchor="middle" className="viz-donut-center">
            {center}
          </text>
        )}
      </svg>
      <div className="viz-donut-legend">
        {parts.map((p) => (
          <span key={p.label}>
            <i style={{ background: p.color }} /> {p.label} <strong>{p.value}</strong>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Línea compacta de evolución (últimos valores de una métrica). */
export function Sparkline({
  values,
  height = 34,
  width = 130,
  good,
}: {
  values: number[];
  height?: number;
  width?: number;
  good?: boolean;
}) {
  if (values.length < 2) return <span className="muted">—</span>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * width},${height - ((v - min) / range) * height}`)
    .join(' ');
  const color = good === undefined ? '#4da3ff' : good ? '#2fbf6b' : '#e0645f';
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="viz-spark">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.8" />
    </svg>
  );
}

/** Semáforo de estado con texto (para "salud" de un proceso). */
export function StatusPill({ tone, children }: { tone: 'ok' | 'warn' | 'bad' | 'idle'; children: React.ReactNode }) {
  return <span className={`viz-pill viz-${tone}`}>{children}</span>;
}

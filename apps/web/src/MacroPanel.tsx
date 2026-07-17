import type { Macro } from './types';

function fnum(n: number | null | undefined, d = 2): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(d) : '—';
}

const CONFLUENCE_LABEL: Record<Macro['confluence'], string> = {
  aligned: 'Técnico + Macro alineados',
  conflict: 'Conflicto con la macro',
  neutral: 'Macro neutral',
};

export function MacroPanel({ macro }: { macro?: Macro }) {
  if (!macro) {
    return <p className="muted">Sesgo macro no disponible (requiere velas 1w).</p>;
  }
  const biasClass =
    (macro.bias ?? 0) > 0.05 ? 'wh-long' : (macro.bias ?? 0) < -0.05 ? 'wh-short' : 'wh-flat';
  return (
    <div className="macro">
      <div className="macro-bias">
        <span className={biasClass}>{macro.label.toUpperCase()}</span>
        <span className="macro-val">
          {typeof macro.bias === 'number' && macro.bias >= 0 ? '+' : ''}
          {fnum(macro.bias)}
        </span>
      </div>
      <div className={`macro-confluence conf-${macro.confluence}`}>
        {CONFLUENCE_LABEL[macro.confluence]}
      </div>
      <div className="macro-meta">
        <span>funding {fnum((macro.funding ?? 0) * 100, 4)}%</span>
        <span>tendencia 1w {fnum(macro.weekly_trend)}</span>
      </div>
    </div>
  );
}

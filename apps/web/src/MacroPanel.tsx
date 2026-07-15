import type { Macro } from './types';

const CONFLUENCE_LABEL: Record<Macro['confluence'], string> = {
  aligned: 'Técnico + Macro alineados',
  conflict: 'Conflicto con la macro',
  neutral: 'Macro neutral',
};

export function MacroPanel({ macro }: { macro?: Macro }) {
  if (!macro) {
    return <p className="muted">Sesgo macro no disponible (requiere velas 1w).</p>;
  }
  const biasClass = macro.bias > 0.05 ? 'wh-long' : macro.bias < -0.05 ? 'wh-short' : 'wh-flat';
  return (
    <div className="macro">
      <div className="macro-bias">
        <span className={biasClass}>{macro.label.toUpperCase()}</span>
        <span className="macro-val">
          {macro.bias >= 0 ? '+' : ''}
          {macro.bias.toFixed(2)}
        </span>
      </div>
      <div className={`macro-confluence conf-${macro.confluence}`}>
        {CONFLUENCE_LABEL[macro.confluence]}
      </div>
      <div className="macro-meta">
        <span>funding {(macro.funding * 100).toFixed(4)}%</span>
        <span>tendencia 1w {macro.weekly_trend.toFixed(2)}</span>
      </div>
    </div>
  );
}

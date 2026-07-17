import type { Probs } from './types';

const ROWS: Array<{ key: keyof Probs; color: string }> = [
  { key: 'BUY', color: '#2ecc71' },
  { key: 'HOLD', color: '#8b97a7' },
  { key: 'SELL', color: '#ff5c5c' },
];

export function ProbabilityBars({ probs }: { probs: Probs }) {
  return (
    <div className="probs">
      {ROWS.map((r) => (
        <div key={r.key} className="prob-row">
          <span className="prob-label">{r.key}</span>
          <div className="prob-track">
            <div
              className="prob-fill"
              style={{ width: `${probs[r.key] * 100}%`, background: r.color }}
            />
          </div>
          <span className="prob-val">{(probs[r.key] * 100).toFixed(0)}%</span>
        </div>
      ))}
    </div>
  );
}

import type { CSSProperties } from 'react';
import type { Vote } from './types';

function cellStyle(score: number, confidence: number): CSSProperties {
  const alpha = 0.15 + 0.75 * Math.min(1, Math.abs(score) * Math.max(0.3, confidence));
  if (Math.abs(score) < 0.02) {
    return { background: `rgba(139, 151, 167, ${0.12 + 0.2 * confidence})` };
  }
  const rgb = score > 0 ? '46, 204, 113' : '255, 92, 92';
  return { background: `rgba(${rgb}, ${alpha})` };
}

export function VotesHeatmap({ votes }: { votes: Vote[] }) {
  if (votes.length === 0) {
    return <p className="muted">Aún sin votos. Se calculan cuando llegan velas suficientes.</p>;
  }
  return (
    <div className="heatmap">
      {votes.map((v) => (
        <div
          key={`${v.source}:${v.key}`}
          className="vote-cell"
          style={cellStyle(v.score, v.confidence)}
        >
          <div className="vote-head">
            <span className="vote-label">{v.label}</span>
            {v.source !== 'internal' && (
              <span className="vote-src">{v.source === 'tradingview' ? 'TV' : v.source}</span>
            )}
          </div>
          <div className="vote-score">
            {v.score >= 0 ? '+' : ''}
            {v.score.toFixed(2)}
          </div>
          <div className="vote-meta">
            <span>{v.kind}</span>
            <span>conf {(v.confidence * 100).toFixed(0)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}

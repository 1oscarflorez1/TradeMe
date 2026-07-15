import type { Direction } from './types';

const COLORS: Record<Direction, string> = {
  LONG: '#2ecc71',
  SHORT: '#ff5c5c',
  FLAT: '#8b97a7',
};

export function ConfidenceRing({
  direction,
  confidence,
}: {
  direction: Direction;
  confidence: number;
}) {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, confidence));
  return (
    <svg
      viewBox="0 0 140 140"
      className="ring"
      role="img"
      aria-label={`${direction} ${Math.round(pct * 100)}%`}
    >
      <circle cx="70" cy="70" r={r} fill="none" stroke="#232b38" strokeWidth="12" />
      <circle
        cx="70"
        cy="70"
        r={r}
        fill="none"
        stroke={COLORS[direction]}
        strokeWidth="12"
        strokeDasharray={`${pct * circumference} ${circumference}`}
        strokeLinecap="round"
        transform="rotate(-90 70 70)"
      />
      <text x="70" y="66" textAnchor="middle" className="ring-action" fill={COLORS[direction]}>
        {direction}
      </text>
      <text x="70" y="92" textAnchor="middle" className="ring-pct">
        {(pct * 100).toFixed(0)}%
      </text>
    </svg>
  );
}

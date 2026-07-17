import { useState } from 'react';
import { postSnapshot } from './api';
import type { Interval } from './types';

export function SnapshotButton({ symbol, interval }: { symbol: string; interval: Interval }) {
  const [state, setState] = useState<'idle' | 'saving' | 'ok' | 'error'>('idle');

  const onClick = async () => {
    if (!symbol) return;
    setState('saving');
    const res = await postSnapshot(symbol, interval);
    setState(res?.saved ? 'ok' : 'error');
    setTimeout(() => setState('idle'), 2500);
  };

  const label =
    state === 'saving'
      ? 'Guardando…'
      : state === 'ok'
        ? '✓ Guardado'
        : state === 'error'
          ? '✗ Error'
          : '📸 Snapshot';

  return (
    <button type="button" className="snapshot-btn" onClick={onClick} disabled={state === 'saving'}>
      {label}
    </button>
  );
}

import type { Vote } from '../indicators/types.js';

interface Stored {
  vote: Vote;
  expiresAt: number;
}

/** Guarda la última señal externa por (symbol, key) y expira según ttlMs. */
export class ExternalSignalStore {
  private readonly bySymbol = new Map<string, Map<string, Stored>>();

  put(symbol: string, vote: Vote, now = Date.now()): void {
    const ttl = vote.ttlMs ?? 0;
    const expiresAt = ttl > 0 ? now + ttl : Number.POSITIVE_INFINITY;
    let map = this.bySymbol.get(symbol);
    if (!map) {
      map = new Map();
      this.bySymbol.set(symbol, map);
    }
    map.set(vote.key, { vote, expiresAt });
  }

  active(symbol: string, now = Date.now()): Vote[] {
    const map = this.bySymbol.get(symbol);
    if (!map) return [];
    const out: Vote[] = [];
    for (const [key, stored] of map) {
      if (stored.expiresAt <= now) {
        map.delete(key);
        continue;
      }
      out.push(stored.vote);
    }
    return out;
  }
}

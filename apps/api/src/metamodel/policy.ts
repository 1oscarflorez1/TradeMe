// Política del meta-modelo publicada por el piloto (artifacts/meta_policy.json).
// El env META_MODE actúa como TOPE de seguridad: la automatización nunca puede superarlo.
import { existsSync, readFileSync } from 'node:fs';

export type MetaMode = 'off' | 'shadow' | 'modulate' | 'veto';
const ORDER: MetaMode[] = ['off', 'shadow', 'modulate', 'veto'];

export interface MetaPolicyFile {
  mode?: MetaMode;
  reason?: string;
  updated_at?: string | null;
}

export class MetaPolicy {
  private data: MetaPolicyFile | null;
  constructor(
    private readonly path: string,
    private readonly cap: MetaMode,
    data: MetaPolicyFile | null,
  ) {
    this.data = data;
  }
  static load(path: string, cap: MetaMode): MetaPolicy {
    return new MetaPolicy(path, cap, read(path));
  }
  reload(): void {
    this.data = read(this.path);
  }
  /** Modo efectivo = min(modo automático, tope del env). */
  get mode(): MetaMode {
    const auto = this.data?.mode ?? 'shadow';
    const i = Math.min(idx(auto), idx(this.cap));
    return ORDER[i] ?? 'shadow';
  }
  get reason(): string | null {
    return this.data?.reason ?? null;
  }
}

function idx(m: MetaMode): number {
  const i = ORDER.indexOf(m);
  return i === -1 ? 1 : i;
}

function read(path: string): MetaPolicyFile | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as MetaPolicyFile;
  } catch {
    return null;
  }
}

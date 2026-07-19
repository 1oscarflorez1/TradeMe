// Carga (con recarga en caliente) del artefacto de calibradores producido por quant.
import { existsSync, readFileSync } from 'node:fs';
import type { Calibrator } from './apply.js';

export interface CalibratorSet {
  version: string;
  created_at?: string;
  regimes: Record<string, Calibrator>;
}

export class Calibrators {
  private set: CalibratorSet | null;
  private readonly path: string;

  constructor(path: string, set: CalibratorSet | null) {
    this.path = path;
    this.set = set;
  }

  static load(path: string): Calibrators {
    return new Calibrators(path, readSet(path));
  }

  /** Relee el artefacto desde disco (POST /reload). Devuelve true si cargó algo. */
  reload(): boolean {
    this.set = readSet(this.path);
    return this.set !== null;
  }

  get version(): string | null {
    return this.set?.version ?? null;
  }

  forRegime(label: string): Calibrator | undefined {
    return this.set?.regimes?.[label];
  }

  meta(): CalibratorSet | null {
    return this.set;
  }
}

function readSet(path: string): CalibratorSet | null {
  try {
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, 'utf8')) as CalibratorSet;
  } catch {
    return null;
  }
}

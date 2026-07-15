import type { Macro } from '../domain/signal.js';

/** Caché del sesgo macro por símbolo (se refresca periódicamente). */
export class MacroStore {
  private readonly bySymbol = new Map<string, Macro>();

  put(symbol: string, macro: Macro): void {
    this.bySymbol.set(symbol, macro);
  }

  get(symbol: string): Macro | undefined {
    return this.bySymbol.get(symbol);
  }
}

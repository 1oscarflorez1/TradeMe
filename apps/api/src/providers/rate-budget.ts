/**
 * Presupuesto de peticiones. Los planes gratuitos de datos de mercado limitan por minuto y por día;
 * esto evita que TradeMe los agote y quede bloqueado sin datos.
 */
export class RateBudget {
  private minuteHits: number[] = [];
  private dayHits: number[] = [];

  constructor(
    readonly perMinute: number,
    readonly perDay: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private prune(t: number): void {
    this.minuteHits = this.minuteHits.filter((h) => t - h < 60_000);
    this.dayHits = this.dayHits.filter((h) => t - h < 86_400_000);
  }

  /** Consume una petición si queda cupo. Devuelve false cuando toca esperar. */
  tryTake(): boolean {
    const t = this.now();
    this.prune(t);
    if (this.minuteHits.length >= this.perMinute) return false;
    if (this.dayHits.length >= this.perDay) return false;
    this.minuteHits.push(t);
    this.dayHits.push(t);
    return true;
  }

  status(): { minuto: number; dia: number; restanteMinuto: number; restanteDia: number } {
    this.prune(this.now());
    return {
      minuto: this.minuteHits.length,
      dia: this.dayHits.length,
      restanteMinuto: Math.max(0, this.perMinute - this.minuteHits.length),
      restanteDia: Math.max(0, this.perDay - this.dayHits.length),
    };
  }
}

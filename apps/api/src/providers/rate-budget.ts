/**
 * Presupuesto de peticiones. Los planes gratuitos de datos de mercado limitan por minuto y por día;
 * esto evita que TradeMe los agote y quede bloqueado sin datos.
 *
 * El cupo diario se cuenta **por día natural UTC**, no en ventana deslizante de 24 horas, porque es
 * así como lo cuentan los proveedores: Twelve Data repone a las 00:00 UTC. Con ventana deslizante
 * el presupuesto y el proveedor discrepaban —uno dejaba pasar peticiones que el otro ya rechazaba—
 * y el aviso de «se restablece a medianoche» habría sido mentira.
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
    const inicioDia = Date.UTC(
      new Date(t).getUTCFullYear(),
      new Date(t).getUTCMonth(),
      new Date(t).getUTCDate(),
    );
    this.dayHits = this.dayHits.filter((h) => h >= inicioDia);
  }

  /** Instante en que se repone el cupo diario: la próxima medianoche UTC. */
  resetAt(): string {
    const t = this.now();
    const d = new Date(t);
    return new Date(
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1),
    ).toISOString();
  }

  /** Sin cupo diario. Distinto de «sin cupo por minuto», que se resuelve solo en segundos. */
  get agotadoDia(): boolean {
    this.prune(this.now());
    return this.dayHits.length >= this.perDay;
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

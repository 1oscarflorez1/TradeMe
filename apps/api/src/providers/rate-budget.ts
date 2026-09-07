/**
 * Presupuesto de **créditos**. Los planes gratuitos de datos de mercado limitan por minuto y por
 * día; esto evita que TradeMe los agote y quede bloqueado sin datos.
 *
 * Contaba **peticiones**, no créditos, y no es lo mismo: Twelve Data cobra por endpoint y algunos
 * valen más de uno. Medido el 6-sep-2026, con un presupuesto local de 700 peticiones diarias el
 * proveedor había contabilizado **1.003 créditos** sobre un límite de 800 — el cupo se agotaba
 * mientras el guardia creía que sobraba margen, y ARQQ llevaba **17 días sin datos nuevos**.
 *
 * Es el mismo patrón que este proyecto ya ha corregido varias veces: un listón que mide algo
 * parecido a lo que dice medir, y la diferencia es justo por donde se escapa el fallo.
 *
 * La corrección no es afinar la estimación sino dejar de estimar: cada respuesta de Twelve Data
 * trae `Api-Credits-Request` con lo que costó **esa** petición, y `ajustar()` lo aplica. El
 * proveedor es la única fuente de verdad sobre su propia contabilidad.
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

  /** Reserva un crédito si queda cupo. Devuelve false cuando toca esperar.
   *
   * Reserva **uno** porque el coste real no se conoce hasta que responde el proveedor. Reservar de
   * menos y corregir después es preferible a reservar de más: lo segundo desperdiciaría cupo en
   * cada petición barata.
   */
  tryTake(): boolean {
    const t = this.now();
    this.prune(t);
    if (this.minuteHits.length >= this.perMinute) return false;
    if (this.dayHits.length >= this.perDay) return false;
    this.minuteHits.push(t);
    this.dayHits.push(t);
    return true;
  }

  /**
   * Corrige la reserva con el coste real que informa el proveedor.
   *
   * `tryTake` ya apuntó un crédito, así que aquí solo se añaden los que falten. Un coste de 0 o 1
   * no cambia nada; uno de 3 apunta los dos restantes. Sin esto, una petición que vale tres se
   * contaba como una y el desfase crecía en silencio hasta el 429.
   */
  ajustar(costeReal: number): void {
    const extra = Math.floor(costeReal) - 1;
    if (!Number.isFinite(extra) || extra <= 0) return;
    const t = this.now();
    for (let i = 0; i < extra; i += 1) {
      this.minuteHits.push(t);
      this.dayHits.push(t);
    }
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

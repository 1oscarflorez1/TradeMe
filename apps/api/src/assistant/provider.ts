/**
 * Proveedor de modelo de lenguaje para el asistente.
 *
 * Un solo adaptador cubre cinco servicios porque todos hablan el formato de chat de OpenAI: basta
 * cambiar la URL base y el modelo. Groq, Cerebras, Mistral, OpenRouter y un Ollama propio son la
 * misma integración con distinta configuración.
 *
 * La llamada vive en el servidor a propósito. Si el navegador hablara directamente con el
 * proveedor, la clave viajaría al cliente y cualquiera podría leerla desde las herramientas de
 * desarrollo. Aquí la clave no sale nunca de la máquina.
 */

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface AssistantMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface AssistantConfig {
  /** URL base compatible con OpenAI, sin `/chat/completions`. Vacía = asistente local. */
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  timeoutMs: number;
}

export interface AssistantReply {
  texto: string;
  modelo: string;
  /** Herramientas que consultó para responder. Se muestra al usuario: nada de caja negra. */
  consultas?: string[];
}

/**
 * Salud del modelo configurado.
 *
 * Existe por un fallo real: Groq retiró `llama-3.3-70b-versatile` y el asistente quedó respondiendo
 * desde su base local durante días. **Nadie se enteró hasta que alguien le preguntó algo.** Un
 * proveedor que devuelve 404 en cada consulta es indistinguible de un asistente sin configurar si
 * no se comprueba nunca.
 *
 * Los estados distinguen lo que se sabe de lo que no. `sin_catalogo` es importante: si el proveedor
 * no publica `/models`, **no se puede concluir que el modelo falte**, y decir que falta sería peor
 * que no decir nada.
 */
export type ModelStatus =
  | 'ok' // el modelo está en el catálogo del proveedor
  | 'modelo_ausente' // el proveedor responde, pero ese modelo ya no existe
  | 'clave_rechazada' // 401/403: la clave no vale
  | 'proveedor_caido' // no responde, o error del servidor
  | 'sin_catalogo' // no publica /models: no se puede verificar, y no se inventa
  | 'sin_cupo' // 429: el modelo existe y la clave vale; se agotó la cuota del minuto
  | 'sin_clave'
  | 'no_configurado';

export interface ModelHealth {
  status: ModelStatus;
  detail: string;
  /** Instante de la última comprobación real. `null` si todavía no se ha hecho ninguna. */
  checkedAt: string | null;
  /** Modelos que sí ofrece el proveedor. Solo se rellena cuando el configurado no está. */
  available?: string[];
}

/** Cada cuánto se recomprueba el catálogo. Un modelo no desaparece dos veces en una hora. */
const HEALTH_TTL_MS = 15 * 60 * 1000;

/**
 * Reintentos ante 429. La cuota de Groq se mide **por minuto**, así que esperar unos segundos suele
 * bastar: rendirse al instante convierte un tope temporal en una caída, que es lo que hacía antes.
 */
const REINTENTOS_429 = 2;
/** Tope de espera por reintento. Sin él, un `retry-after` largo bloquearía la petición del usuario. */
const ESPERA_MAX_MS = 8000;
const ESPERA_POR_DEFECTO_MS = 2000;

/** El proveedor existe y la clave vale; simplemente no queda cuota en esta ventana. */
export class SinCupoError extends Error {
  constructor(
    message: string,
    readonly esperaMs: number,
  ) {
    super(message);
    this.name = 'SinCupoError';
  }
}

/** Segundos que pide esperar el proveedor, acotados. `Retry-After` es estándar en 429. */
function esperaDe(res: { headers: { get(n: string): string | null } }): number {
  const cabecera = res.headers.get('retry-after') ?? res.headers.get('x-ratelimit-reset-tokens');
  if (!cabecera) return ESPERA_POR_DEFECTO_MS;
  const segundos = Number.parseFloat(cabecera.replace(/[^0-9.]/g, ''));
  if (!Number.isFinite(segundos) || segundos <= 0) return ESPERA_POR_DEFECTO_MS;
  return Math.min(ESPERA_MAX_MS, Math.ceil(segundos * 1000));
}

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class AssistantProvider {
  constructor(private readonly cfg: AssistantConfig) {}

  private health: ModelHealth = {
    status: 'no_configurado',
    detail: 'sin comprobar',
    checkedAt: null,
  };
  private comprobando: Promise<ModelHealth> | null = null;

  get enabled(): boolean {
    return this.cfg.baseUrl.trim().length > 0 && this.cfg.model.trim().length > 0;
  }

  /** Descripción para la pestaña Estado, sin revelar la clave. */
  describe(): { enabled: boolean; model: string; host: string } {
    let host = '';
    try {
      host = this.cfg.baseUrl ? new URL(this.cfg.baseUrl).host : '';
    } catch {
      host = 'configuración inválida';
    }
    return { enabled: this.enabled, model: this.cfg.model, host };
  }

  /**
   * Último veredicto conocido, sin llamar a nadie.
   *
   * `/health` tiene que ser barato: si consultara el catálogo en cada petición, el estado de la
   * plataforma dependería de la latencia de un tercero. Si la medición ha caducado se dispara una
   * comprobación en segundo plano y se devuelve la anterior, que sigue siendo la mejor que hay.
   */
  modelHealth(): ModelHealth {
    const vencida =
      this.health.checkedAt === null ||
      Date.now() - Date.parse(this.health.checkedAt) > HEALTH_TTL_MS;
    if (vencida) void this.checkModel();
    return this.health;
  }

  /**
   * Comprueba contra el proveedor que el modelo configurado existe.
   *
   * Una sola llamada en vuelo: al arrancar, varias peticiones a `/health` podrían dispararla a la
   * vez y gastar cupo en preguntar tres veces lo mismo.
   */
  async checkModel(): Promise<ModelHealth> {
    if (this.comprobando) return this.comprobando;
    this.comprobando = this.consultarCatalogo().finally(() => {
      this.comprobando = null;
    });
    return this.comprobando;
  }

  private async consultarCatalogo(): Promise<ModelHealth> {
    const ahora = () => new Date().toISOString();
    const modelo = this.cfg.model.trim();
    const base = this.cfg.baseUrl.trim().replace(/\/+$/, '');

    if (!base || !modelo) {
      this.health = {
        status: 'no_configurado',
        detail: 'ASSISTANT_BASE_URL o ASSISTANT_MODEL sin valor: el asistente usa su base local.',
        checkedAt: ahora(),
      };
      return this.health;
    }
    if (!this.cfg.apiKey) {
      this.health = {
        status: 'sin_clave',
        detail: 'ASSISTANT_API_KEY sin valor: no se puede consultar al proveedor.',
        checkedAt: ahora(),
      };
      return this.health;
    }

    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), Math.min(this.cfg.timeoutMs, 10_000));
      let res: Response;
      try {
        res = await fetch(`${base}/models`, {
          headers: { Authorization: `Bearer ${this.cfg.apiKey}` },
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(t);
      }

      if (res.status === 401 || res.status === 403) {
        this.health = {
          status: 'clave_rechazada',
          detail: `El proveedor rechazó la clave (HTTP ${res.status}).`,
          checkedAt: ahora(),
        };
        return this.health;
      }
      if (res.status === 429) {
        // Sin cuota para consultar el catálogo. No dice nada malo del modelo ni de la clave, así
        // que marcarlo como «proveedor caído» sería un diagnóstico inventado — y además pegajoso,
        // porque este resultado se cachea 15 minutos.
        this.health = {
          status: 'sin_cupo',
          detail:
            'Sin cupo en el proveedor para comprobar el catálogo. El modelo puede estar bien; ' +
            'se reintenta en la próxima comprobación.',
          checkedAt: ahora(),
        };
        return this.health;
      }
      if (!res.ok) {
        // Un 404 aquí es del *endpoint* de catálogo, no del modelo: hay proveedores que no lo
        // publican. Concluir que el modelo falta sería inventarse un diagnóstico.
        this.health = {
          status: res.status === 404 ? 'sin_catalogo' : 'proveedor_caido',
          detail:
            res.status === 404
              ? 'El proveedor no publica catálogo de modelos: no se puede verificar el configurado.'
              : `El proveedor respondió HTTP ${res.status}.`,
          checkedAt: ahora(),
        };
        return this.health;
      }

      const datos = (await res.json()) as { data?: Array<{ id?: string }> };
      const ids = (datos.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean);
      if (ids.length === 0) {
        this.health = {
          status: 'sin_catalogo',
          detail: 'El proveedor devolvió un catálogo vacío: no se puede verificar el modelo.',
          checkedAt: ahora(),
        };
        return this.health;
      }
      if (ids.includes(modelo)) {
        this.health = {
          status: 'ok',
          detail: `${modelo} disponible en el proveedor.`,
          checkedAt: ahora(),
        };
        return this.health;
      }
      this.health = {
        status: 'modelo_ausente',
        detail:
          `El proveedor ya no ofrece «${modelo}». El asistente responde desde su base local ` +
          `hasta que se configure uno de los disponibles en ASSISTANT_MODEL.`,
        checkedAt: ahora(),
        available: ids.sort(),
      };
      return this.health;
    } catch (err) {
      this.health = {
        status: 'proveedor_caido',
        detail: `No se pudo consultar el catálogo: ${String(err).slice(0, 120)}`,
        checkedAt: ahora(),
      };
      return this.health;
    }
  }

  /**
   * Conversación con herramientas.
   *
   * El modelo puede pedir datos que no le dimos de entrada. Cada petición se ejecuta contra la
   * plataforma y se le devuelve el resultado, hasta un máximo de vueltas: sin ese tope, un modelo
   * confundido podría encadenar llamadas indefinidamente y agotar el cupo. En la última vuelta se
   * le retiran las herramientas para forzar una respuesta en texto.
   */
  async askWithTools(
    messages: AssistantMessage[],
    tools: unknown[],
    ejecutar: (nombre: string, args: Record<string, unknown>) => Promise<unknown>,
    // Dos, no tres. Cada vuelta reenvía el hilo completo —que además ha crecido con los resultados
    // de las herramientas—, así que la tercera es la que suele reventar un cupo de 8000 tokens por
    // minuto. Con dos, el modelo consulta y responde, que es el caso real; la que se pierde es la
    // de encadenar una herramienta tras otra.
    maxVueltas = 2,
  ): Promise<AssistantReply> {
    if (!this.enabled) throw new Error('asistente sin proveedor configurado');
    const hilo = [...messages];
    const consultas: string[] = [];

    for (let vuelta = 0; vuelta < maxVueltas; vuelta += 1) {
      const ultima = vuelta === maxVueltas - 1;
      const res = await this.raw(hilo, ultima ? undefined : tools);
      const msg = res.choices?.[0]?.message;
      const llamadas = msg?.tool_calls ?? [];

      if (llamadas.length === 0) {
        const texto = msg?.content?.trim() ?? '';
        if (!texto) throw new Error('el proveedor devolvió una respuesta vacía');
        return { texto, modelo: res.model ?? this.cfg.model, consultas };
      }

      hilo.push({ role: 'assistant', content: msg?.content ?? '', tool_calls: llamadas });
      for (const c of llamadas) {
        let salida: unknown;
        try {
          const args = c.function.arguments ? (JSON.parse(c.function.arguments) as Record<string, unknown>) : {};
          consultas.push(c.function.name);
          salida = await ejecutar(c.function.name, args);
        } catch (err) {
          salida = { error: String(err instanceof Error ? err.message : err) };
        }
        hilo.push({
          role: 'tool',
          tool_call_id: c.id,
          // 6000 caracteres eran ~1500 tokens por herramienta, y el hilo entero se reenvía en la
          // vuelta siguiente: dos llamadas se comían la mitad del cupo del minuto antes de que el
          // modelo hubiera escrito una palabra. 2000 sigue siendo holgado para una respuesta útil.
          content: JSON.stringify(salida).slice(0, 2000),
        });
      }
    }
    throw new Error('el asistente no llegó a una respuesta');
  }

  async ask(messages: AssistantMessage[]): Promise<AssistantReply> {
    if (!this.enabled) throw new Error('asistente sin proveedor configurado');
    const body = await this.raw(messages);
    const texto = body.choices?.[0]?.message?.content?.trim() ?? '';
    if (!texto) throw new Error('el proveedor devolvió una respuesta vacía');
    return { texto, modelo: body.model ?? this.cfg.model };
  }

  /** Una única llamada al proveedor. Formato de chat de OpenAI, con o sin herramientas. */
  private async raw(
    messages: AssistantMessage[],
    tools?: unknown[],
    intento = 0,
  ): Promise<{
    choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
    model?: string;
  }> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          // Ollama no pide clave; el resto sí. Enviar una vacía no molesta a Ollama.
          ...(this.cfg.apiKey ? { Authorization: `Bearer ${this.cfg.apiKey}` } : {}),
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          max_tokens: this.cfg.maxTokens,
          temperature: 0.3, // explicativo, no creativo
          stream: false,
          ...(tools && tools.length > 0 ? { tools, tool_choice: 'auto' } : {}),
        }),
      });
      if (res.status === 429) {
        // No es una avería: el modelo está y la clave vale. La cuota se repone en la ventana
        // siguiente, así que se espera lo que pida el proveedor y se vuelve a intentar. Quien
        // agota el `intento` acaba en `SinCupoError`, que el portal sabe explicar sin mentir.
        const detalle = await res.text().catch(() => '');
        const espera = esperaDe(res);
        if (intento < REINTENTOS_429) {
          await dormir(espera);
          return this.raw(messages, tools, intento + 1);
        }
        throw new SinCupoError(
          `sin cupo tras ${REINTENTOS_429 + 1} intentos: ${detalle.slice(0, 160)}`,
          espera,
        );
      }
      if (!res.ok) {
        const detalle = await res.text().catch(() => '');
        throw new Error(`proveedor respondió ${res.status}: ${detalle.slice(0, 200)}`);
      }
      return (await res.json()) as {
        choices?: Array<{ message?: { content?: string; tool_calls?: ToolCall[] } }>;
        model?: string;
      };
    } finally {
      clearTimeout(t);
    }
  }
}

/**
 * Cupo por usuario. Los planes gratuitos tienen límites diarios y una pestaña abierta con el dedo
 * en el botón podría agotarlos en minutos, dejando al equipo sin asistente el resto del día.
 */
export class AssistantQuota {
  private readonly usos = new Map<string, number[]>();

  constructor(
    private readonly porMinuto = 6,
    private readonly porDia = 120,
    private readonly now: () => number = () => Date.now(),
  ) {}

  intentar(usuario: string): { ok: boolean; motivo?: string } {
    const t = this.now();
    const previos = (this.usos.get(usuario) ?? []).filter((x) => t - x < 86_400_000);
    if (previos.filter((x) => t - x < 60_000).length >= this.porMinuto) {
      return { ok: false, motivo: 'Demasiadas preguntas seguidas. Espera un minuto.' };
    }
    if (previos.length >= this.porDia) {
      return { ok: false, motivo: 'Has alcanzado el cupo diario de preguntas al modelo.' };
    }
    previos.push(t);
    this.usos.set(usuario, previos);
    return { ok: true };
  }
}

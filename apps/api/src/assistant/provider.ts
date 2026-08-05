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

export class AssistantProvider {
  constructor(private readonly cfg: AssistantConfig) {}

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
    maxVueltas = 3,
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
          content: JSON.stringify(salida).slice(0, 6000),
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

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

export interface AssistantMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
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

  async ask(messages: AssistantMessage[]): Promise<AssistantReply> {
    if (!this.enabled) throw new Error('asistente sin proveedor configurado');
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
        }),
      });
      if (!res.ok) {
        const detalle = await res.text().catch(() => '');
        throw new Error(`proveedor respondió ${res.status}: ${detalle.slice(0, 200)}`);
      }
      const body = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
      };
      const texto = body.choices?.[0]?.message?.content?.trim() ?? '';
      if (!texto) throw new Error('el proveedor devolvió una respuesta vacía');
      return { texto, modelo: body.model ?? this.cfg.model };
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

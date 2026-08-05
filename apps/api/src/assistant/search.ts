/**
 * Búsqueda en internet para el asistente.
 *
 * Dos proveedores con plan gratuito y la misma forma de respuesta: unos pocos resultados con
 * título, fragmento y enlace. No se descarga la página entera — el fragmento basta para que el
 * modelo se sitúe, y traer páginas completas llenaría la ventana de contexto de ruido.
 *
 * Desactivado mientras no haya clave. Sin ella, el asistente sigue respondiendo con los datos de
 * la plataforma, que es lo que de verdad no puede darle nadie más.
 */

export type SearchProviderId = 'tavily' | 'brave' | '';

export interface SearchHit {
  titulo: string;
  fragmento: string;
  url: string;
}

export interface SearchConfig {
  provider: SearchProviderId;
  apiKey: string;
  maxResultados: number;
  timeoutMs: number;
}

export class WebSearch {
  constructor(private readonly cfg: SearchConfig) {}

  get enabled(): boolean {
    return this.cfg.provider !== '' && this.cfg.apiKey.trim().length > 0;
  }

  describe(): { enabled: boolean; provider: string } {
    return { enabled: this.enabled, provider: this.cfg.provider };
  }

  async buscar(consulta: string): Promise<SearchHit[]> {
    if (!this.enabled) throw new Error('la búsqueda en internet no está configurada');
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs);
    try {
      return this.cfg.provider === 'tavily'
        ? await this.tavily(consulta, ctrl.signal)
        : await this.brave(consulta, ctrl.signal);
    } finally {
      clearTimeout(t);
    }
  }

  private async tavily(consulta: string, signal: AbortSignal): Promise<SearchHit[]> {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify({
        query: consulta,
        max_results: this.cfg.maxResultados,
        search_depth: 'basic',
      }),
    });
    if (!res.ok) throw new Error(`tavily respondió ${res.status}`);
    const body = (await res.json()) as {
      results?: Array<{ title?: string; content?: string; url?: string }>;
    };
    return (body.results ?? []).slice(0, this.cfg.maxResultados).map((r) => ({
      titulo: r.title ?? '',
      fragmento: (r.content ?? '').slice(0, 500),
      url: r.url ?? '',
    }));
  }

  private async brave(consulta: string, signal: AbortSignal): Promise<SearchHit[]> {
    const url = new URL('https://api.search.brave.com/res/v1/web/search');
    url.searchParams.set('q', consulta);
    url.searchParams.set('count', String(this.cfg.maxResultados));
    const res = await fetch(url, {
      signal,
      headers: { Accept: 'application/json', 'X-Subscription-Token': this.cfg.apiKey },
    });
    if (!res.ok) throw new Error(`brave respondió ${res.status}`);
    const body = (await res.json()) as {
      web?: { results?: Array<{ title?: string; description?: string; url?: string }> };
    };
    return (body.web?.results ?? []).slice(0, this.cfg.maxResultados).map((r) => ({
      titulo: r.title ?? '',
      fragmento: (r.description ?? '').slice(0, 500),
      url: r.url ?? '',
    }));
  }
}

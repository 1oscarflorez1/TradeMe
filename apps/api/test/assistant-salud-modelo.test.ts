import { describe, it, expect, vi, afterEach } from 'vitest';
import { AssistantProvider } from '../src/assistant/provider.js';

function provider(over: Partial<Record<string, string | number>> = {}): AssistantProvider {
  return new AssistantProvider({
    baseUrl: 'https://api.groq.com/openai/v1',
    apiKey: 'clave-de-prueba',
    model: 'llama-3.3-70b-versatile',
    maxTokens: 512,
    timeoutMs: 5000,
    ...over,
  } as never);
}

function respuesta(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('salud del modelo del asistente', () => {
  it('el caso real: el proveedor retiró el modelo configurado', async () => {
    // Groq dejó de ofrecer llama-3.3-70b-versatile y el asistente estuvo días respondiendo desde su
    // base local. Cada consulta devolvía 404 y el portal no distinguía eso de «sin configurar».
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respuesta(200, {
          data: [{ id: 'openai/gpt-oss-120b' }, { id: 'openai/gpt-oss-20b' }, { id: 'allam-2-7b' }],
        }),
      ),
    );
    const h = await provider().checkModel();
    expect(h.status).toBe('modelo_ausente');
    expect(h.detail).toContain('llama-3.3-70b-versatile');
    // Lo que de verdad resuelve el problema: saber qué poner en su lugar.
    expect(h.available).toEqual(['allam-2-7b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b']);
  });

  it('un modelo que sí está da ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuesta(200, { data: [{ id: 'openai/gpt-oss-120b' }] })),
    );
    const h = await provider({ model: 'openai/gpt-oss-120b' }).checkModel();
    expect(h.status).toBe('ok');
    expect(h.checkedAt).not.toBeNull();
  });

  it('sin catálogo NO se concluye que el modelo falte', async () => {
    // Hay proveedores compatibles con OpenAI que no publican /models. Decir «tu modelo no existe»
    // porque no se pudo comprobar sería inventarse un diagnóstico y mandar al usuario a cambiar
    // algo que funciona.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuesta(404, {})),
    );
    const h = await provider().checkModel();
    expect(h.status).toBe('sin_catalogo');
    expect(h.available).toBeUndefined();
  });

  it('catálogo vacío tampoco acusa al modelo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuesta(200, { data: [] })),
    );
    expect((await provider().checkModel()).status).toBe('sin_catalogo');
  });

  it('clave rechazada se distingue de modelo ausente', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuesta(401, {})),
    );
    expect((await provider().checkModel()).status).toBe('clave_rechazada');
  });

  it('proveedor caído se distingue de las dos anteriores', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respuesta(503, {})),
    );
    expect((await provider().checkModel()).status).toBe('proveedor_caido');
  });

  it('un fallo de red no revienta la comprobación', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );
    const h = await provider().checkModel();
    expect(h.status).toBe('proveedor_caido');
    expect(h.detail).toContain('ECONNREFUSED');
  });

  it('sin clave no se llama al proveedor', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await provider({ apiKey: '' }).checkModel()).status).toBe('sin_clave');
    expect(f).not.toHaveBeenCalled();
  });

  it('sin configurar tampoco', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect((await provider({ baseUrl: '', model: '' }).checkModel()).status).toBe('no_configurado');
    expect(f).not.toHaveBeenCalled();
  });
});

describe('coste de la comprobación', () => {
  it('modelHealth() no bloquea ni consulta: devuelve lo último que se supo', () => {
    const f = vi.fn(async () => respuesta(200, { data: [{ id: 'x' }] }));
    vi.stubGlobal('fetch', f);
    const p = provider();
    const h = p.modelHealth();
    // `/status` se pide cada 30 s desde el portal: no puede depender de la latencia de un tercero.
    expect(h.checkedAt).toBeNull();
    expect(h.status).toBe('no_configurado');
  });

  it('varias comprobaciones a la vez son una sola llamada', async () => {
    const f = vi.fn(async () => respuesta(200, { data: [{ id: 'openai/gpt-oss-120b' }] }));
    vi.stubGlobal('fetch', f);
    const p = provider({ model: 'openai/gpt-oss-120b' });
    const [a, b, c] = await Promise.all([p.checkModel(), p.checkModel(), p.checkModel()]);
    expect(f).toHaveBeenCalledTimes(1);
    expect([a.status, b.status, c.status]).toEqual(['ok', 'ok', 'ok']);
  });
});

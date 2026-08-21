import { describe, it, expect, vi, afterEach } from 'vitest';
import { AssistantProvider, SinCupoError } from '../src/assistant/provider.js';

const CFG = {
  baseUrl: 'https://proveedor.test/v1',
  apiKey: 'k',
  model: 'modelo-x',
  maxTokens: 200,
  timeoutMs: 5000,
};

function respuestaOk(texto = 'hola') {
  return new Response(JSON.stringify({ choices: [{ message: { content: texto } }], model: 'modelo-x' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function respuesta429(retryAfter?: string) {
  return new Response(JSON.stringify({ error: { message: 'Rate limit reached' } }), {
    status: 429,
    headers: retryAfter ? { 'retry-after': retryAfter } : {},
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cuota agotada del proveedor (429)', () => {
  it('reintenta y responde si la cuota se repone', async () => {
    // La ventana de Groq es de un minuto: rendirse al instante convertía un tope temporal en una
    // caída, y el usuario acababa leyendo «sin modelo configurado» con el modelo bien configurado.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuesta429('0.01'))
      .mockResolvedValueOnce(respuestaOk('respuesta buena'));
    vi.stubGlobal('fetch', fetchMock);

    const p = new AssistantProvider(CFG);
    const r = await p.ask([{ role: 'user', content: 'hola' }]);

    expect(r.texto).toBe('respuesta buena');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('deja de reintentar y lanza SinCupoError, no un error genérico', async () => {
    const fetchMock = vi.fn().mockResolvedValue(respuesta429('0.01'));
    vi.stubGlobal('fetch', fetchMock);

    const p = new AssistantProvider(CFG);
    await expect(p.ask([{ role: 'user', content: 'hola' }])).rejects.toBeInstanceOf(SinCupoError);
    // Un intento inicial + los reintentos. Sin tope, una cuota agotada colgaría la petición.
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('sin cabecera `retry-after` usa una espera por defecto en vez de fallar', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(respuesta429()).mockResolvedValueOnce(respuestaOk());
    vi.stubGlobal('fetch', fetchMock);

    const p = new AssistantProvider(CFG);
    const r = await p.ask([{ role: 'user', content: 'hola' }]);
    expect(r.texto).toBe('hola');
  }, 15000);

  it('un `retry-after` absurdo no bloquea al usuario indefinidamente', async () => {
    // El proveedor podría pedir minutos. La petición del usuario no puede quedarse ahí colgada.
    const fetchMock = vi.fn().mockResolvedValue(respuesta429('3600'));
    vi.stubGlobal('fetch', fetchMock);

    const p = new AssistantProvider(CFG);
    const t0 = Date.now();
    await expect(p.ask([{ role: 'user', content: 'hola' }])).rejects.toBeInstanceOf(SinCupoError);
    // Dos esperas acotadas a 8 s cada una: muy por debajo de la hora que pedía el proveedor.
    expect(Date.now() - t0).toBeLessThan(20_000);
  }, 30000);

  it('un error que NO es de cuota sigue siendo un error normal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('modelo no encontrado', { status: 404 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const p = new AssistantProvider(CFG);
    await expect(p.ask([{ role: 'user', content: 'hola' }])).rejects.not.toBeInstanceOf(SinCupoError);
    // Un 404 no se reintenta: el modelo no va a aparecer por esperar.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

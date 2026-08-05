import { describe, it, expect } from 'vitest';
import { AssistantProvider, AssistantQuota } from '../src/assistant/provider.js';
import { construirContexto } from '../src/assistant/context.js';

const base = { apiKey: 'k', model: 'm', maxTokens: 100, timeoutMs: 1000 };

describe('AssistantProvider', () => {
  it('queda desactivado sin URL o sin modelo: el asistente local sigue funcionando', () => {
    expect(new AssistantProvider({ ...base, baseUrl: '' }).enabled).toBe(false);
    expect(new AssistantProvider({ ...base, baseUrl: 'https://x/v1', model: '' }).enabled).toBe(false);
    expect(new AssistantProvider({ ...base, baseUrl: 'https://x/v1' }).enabled).toBe(true);
  });

  it('describe el proveedor sin filtrar la clave', () => {
    const d = new AssistantProvider({ ...base, baseUrl: 'https://api.groq.com/openai/v1' }).describe();
    expect(d).toEqual({ enabled: true, model: 'm', host: 'api.groq.com' });
    expect(JSON.stringify(d)).not.toContain('k');
  });

  it('no llama a nadie si no está configurado', async () => {
    await expect(new AssistantProvider({ ...base, baseUrl: '' }).ask([])).rejects.toThrow('sin proveedor');
  });
});

describe('AssistantQuota', () => {
  it('corta las ráfagas por minuto', () => {
    let t = 0;
    const q = new AssistantQuota(2, 100, () => t);
    expect(q.intentar('ana').ok).toBe(true);
    expect(q.intentar('ana').ok).toBe(true);
    expect(q.intentar('ana').ok).toBe(false);
    t += 61_000;
    expect(q.intentar('ana').ok).toBe(true);
  });

  it('el cupo es por usuario, no global', () => {
    const q = new AssistantQuota(1, 100, () => 0);
    expect(q.intentar('ana').ok).toBe(true);
    expect(q.intentar('ana').ok).toBe(false);
    expect(q.intentar('luis').ok).toBe(true);
  });

  it('respeta el tope diario', () => {
    let t = 0;
    const q = new AssistantQuota(100, 3, () => t);
    for (let i = 0; i < 3; i += 1) {
      t += 61_000;
      expect(q.intentar('ana').ok).toBe(true);
    }
    t += 61_000;
    expect(q.intentar('ana').ok).toBe(false);
  });
});

describe('contexto que se envía al modelo', () => {
  it('incluye las cifras reales y avisa cuando no hay decisión', () => {
    const c = construirContexto({
      symbol: 'BTCUSDT',
      interval: '15m',
      signal: null,
      stats: { total: 486, tp: 71, sl: 146, timeout: 237, abiertos: 32, winRate: 0.327, expectancy: -0.018 },
      sustento: null,
      version: '0.31.0',
      liveTrading: false,
    });
    expect(c).toContain('deshabilitada');
    expect(c).toContain('No hay decisión en vivo');
    expect(c).toContain('486');
    expect(c).toContain('32.7 %');
  });

  it('nunca declara habilitada la operación real si el flag está apagado', () => {
    const c = construirContexto({
      symbol: 'BTCUSDT', interval: '1h', signal: null, stats: null, sustento: null,
      version: '0.31.0', liveTrading: false,
    });
    expect(c).not.toContain('HABILITADA');
  });
});

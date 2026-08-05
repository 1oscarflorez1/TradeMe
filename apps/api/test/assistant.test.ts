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

import { TOOLS, resumirPrecios } from '../src/assistant/tools.js';
import { SYSTEM_PROMPT } from '../src/assistant/context.js';

describe('herramientas del asistente', () => {
  it('todas son de solo lectura: ninguna escribe, borra ni lanza procesos', () => {
    const prohibido = /crear|borrar|elimina|guardar|ejecutar_sql|actualizar|lanzar|optimiz|entrenar|orden/i;
    for (const t of TOOLS) {
      expect(t.function.name).not.toMatch(prohibido);
    }
    // Y no existe una herramienta genérica de consulta libre.
    expect(TOOLS.map((t) => t.function.name)).not.toContain('sql');
  });

  it('cada herramienta declara su esquema de parámetros', () => {
    for (const t of TOOLS) {
      expect(t.type).toBe('function');
      expect(t.function.description.length).toBeGreaterThan(40);
      expect(t.function.parameters).toHaveProperty('type', 'object');
    }
  });

  it('las temporalidades están acotadas por lista cerrada, no por texto libre', () => {
    const conIv = TOOLS.filter((t) =>
      Object.keys((t.function.parameters as { properties: object }).properties).includes('interval'),
    );
    expect(conIv.length).toBeGreaterThan(0);
    for (const t of conIv) {
      const props = (t.function.parameters as { properties: Record<string, { enum?: string[] }> }).properties;
      expect(props.interval?.enum).toContain('30m');
    }
  });

  it('el prompt le prohíbe inventar datos y actuar sobre la plataforma', () => {
    expect(SYSTEM_PROMPT).toContain('Nunca inventas números');
    expect(SYSTEM_PROMPT).toContain('No das asesoría financiera');
    expect(SYSTEM_PROMPT).toContain('SOLO LECTURA');
  });
});

describe('resumirPrecios', () => {
  it('resume en cifras en vez de volcar las velas', () => {
    const r = resumirPrecios([100, 102, 101, 105], [101, 103, 102, 106], [99, 101, 100, 104]) as Record<string, number>;
    expect(r.velas).toBe(4);
    expect(r.variacionPct).toBe(5);
    expect(r.maximo).toBe(106);
    expect(r.minimo).toBe(99);
    expect(r.velasAlcistas).toBe(2);
    expect(r.velasBajistas).toBe(1);
  });

  it('no revienta sin datos', () => {
    expect(resumirPrecios([], [], [])).toHaveProperty('error');
  });
});

import { describe, it, expect } from 'vitest';
import {
  FundamentalPolicy,
  type FundamentalPolicyFile,
} from '../src/ensemble/fundamental-policy.js';

function pol(data: FundamentalPolicyFile | null): FundamentalPolicy {
  return new FundamentalPolicy('(memoria)', data);
}

describe('el tope de configuración manda', () => {
  it('la automatización no puede subir por encima del tope', () => {
    // La asimetría es deliberada: si el artefacto se corrompe o alguien publica basura, el peor
    // caso posible es que el score influya MENOS de lo previsto, nunca más.
    expect(pol({ mode: 'active' }).effectiveMode('shadow')).toBe('shadow');
    expect(pol({ mode: 'active' }).effectiveMode('off')).toBe('off');
    expect(pol({ mode: 'shadow' }).effectiveMode('off')).toBe('off');
  });

  it('sí puede rebajar por debajo del tope', () => {
    expect(pol({ mode: 'shadow' }).effectiveMode('active')).toBe('shadow');
    expect(pol({ mode: 'off' }).effectiveMode('active')).toBe('off');
  });

  it('coincidiendo, se respeta', () => {
    expect(pol({ mode: 'active' }).effectiveMode('active')).toBe('active');
    expect(pol({ mode: 'shadow' }).effectiveMode('shadow')).toBe('shadow');
  });
});

describe('degradación', () => {
  it('sin artefacto manda la configuración, no se degrada por su ausencia', () => {
    // Es el estado anterior a que existiera el gobierno automático: no tiene por qué cambiar nada.
    expect(pol(null).effectiveMode('shadow')).toBe('shadow');
    expect(pol(null).effectiveMode('active')).toBe('active');
  });

  it('un artefacto sin modo tampoco altera la configuración', () => {
    expect(pol({ reason: 'a medio escribir' }).effectiveMode('active')).toBe('active');
  });

  it('un modo desconocido se trata como sombra, que no influye', () => {
    const p = pol({ mode: 'promociónate-solo' as unknown as 'active' });
    expect(p.effectiveMode('active')).toBe('shadow');
  });
});

describe('trazabilidad', () => {
  it('expone el motivo de la decisión', () => {
    const p = pol({ mode: 'shadow', reason: 'evidencia insuficiente (75/100)' });
    expect(p.reason).toContain('75/100');
  });

  it('sin artefacto no inventa un motivo', () => {
    expect(pol(null).reason).toBeNull();
  });
});

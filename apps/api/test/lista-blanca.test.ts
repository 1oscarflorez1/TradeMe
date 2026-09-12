import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import {
  DEFAULT_ENSEMBLE,
  forInterval,
  fueraDeListaBlanca,
  loadEnsemble,
  vetadaEfectiva,
} from '../src/ensemble/config.js';
import type { EnsembleConfig } from '../src/ensemble/config.js';

/**
 * La lista blanca concentra la operativa en las claves autorizadas, y lo único que no puede hacer
 * es habilitar nada. Si pudiera, sería una puerta trasera al gobierno de la cuarentena: bastaría
 * añadir una clave a una lista para levantar un veto que se puso con evidencia.
 */

function conLista(keys: string[]): EnsembleConfig {
  return { ...DEFAULT_ENSEMBLE, activeKeys: keys };
}

describe('fueraDeListaBlanca', () => {
  it('con la lista vacía no restringe a nadie', () => {
    // Es el comportamiento por defecto y el de todo el histórico anterior a 0.70.0.
    expect(fueraDeListaBlanca(conLista([]), 'BTCUSDT', '1d')).toBe(false);
    expect(fueraDeListaBlanca(DEFAULT_ENSEMBLE, 'CUALQUIERA', '5m')).toBe(false);
  });

  it('deja pasar lo que está y veta lo que no', () => {
    const cfg = conLista(['ETHUSDT:1d', 'SOLUSDT:1d']);
    expect(fueraDeListaBlanca(cfg, 'ETHUSDT', '1d')).toBe(false);
    expect(fueraDeListaBlanca(cfg, 'SOLUSDT', '1d')).toBe(false);
    expect(fueraDeListaBlanca(cfg, 'BTCUSDT', '1d')).toBe(true);
    expect(fueraDeListaBlanca(cfg, 'BNBUSDT', '1d')).toBe(true);
  });

  it('la clave incluye la temporalidad, no solo el símbolo', () => {
    // ETHUSDT:1d autorizado no autoriza ETHUSDT:15m, que además está en cuarentena estructural.
    const cfg = conLista(['ETHUSDT:1d']);
    expect(fueraDeListaBlanca(cfg, 'ETHUSDT', '1d')).toBe(false);
    expect(fueraDeListaBlanca(cfg, 'ETHUSDT', '15m')).toBe(true);
    expect(fueraDeListaBlanca(cfg, 'ETHUSDT', '4h')).toBe(true);
  });

  it('el símbolo se normaliza a mayúsculas', () => {
    expect(fueraDeListaBlanca(conLista(['ETHUSDT:1d']), 'ethusdt', '1d')).toBe(false);
  });
});

describe('la lista blanca restringe, nunca habilita', () => {
  it('estar en la lista no levanta una cuarentena', () => {
    // La propiedad que impide que la concentración se use para saltarse el gobierno. `forInterval`
    // recibe el veto ya combinado, y con `true` tiene que mandar el veto pase lo que pase.
    const cfg = conLista(['BTCUSDT:15m']);
    const especializada = forInterval(cfg, '15m', 1, true);
    expect(especializada.quarantined).toBe(true);
  });

  it('el veto combinado es un OR: basta uno de los dos', () => {
    const cfg = conLista(['ETHUSDT:1d']);
    // Fuera de la lista y sin cuarentena -> vetada por la lista.
    expect(vetadaEfectiva(cfg, 'BTCUSDT', '1d', false)).toBe(true);
    // En la lista pero en cuarentena -> sigue vetada. La lista no habilita.
    expect(vetadaEfectiva(cfg, 'ETHUSDT', '1d', true)).toBe(true);
    // En la lista y sin cuarentena -> opera.
    expect(vetadaEfectiva(cfg, 'ETHUSDT', '1d', false)).toBe(false);
    // Sin lista, manda solo la cuarentena.
    expect(vetadaEfectiva(conLista([]), 'BTCUSDT', '1d', false)).toBe(false);
    expect(vetadaEfectiva(conLista([]), 'BTCUSDT', '1d', true)).toBe(true);
  });
});

describe('el yaml desplegado', () => {
  it('el valor por defecto no restringe: la concentración se declara, no se hereda', () => {
    // Si alguien construye una configuración a mano y olvida `activeKeys`, el peor caso es que
    // opere de más, no que deje de operar en silencio.
    expect(DEFAULT_ENSEMBLE.activeKeys).toEqual([]);
  });

  it('sobre el ensemble.yaml real, solo emiten ETHUSDT:1d y SOLUSDT:1d', () => {
    // La comprobación de extremo a extremo: combina la lista blanca con la cuarentena tal y como lo
    // hace `getEnsembleFor`, sobre el fichero que se despliega. Fija el estado operativo completo,
    // así que cualquier cambio en cualquiera de las dos listas rompe este test y obliga a mirarlo.
    const cfg = loadEnsemble(join(__dirname, '..', '..', '..', 'artifacts', 'ensemble.yaml'));
    const emiten: string[] = [];
    for (const s of ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']) {
      for (const tf of ['1m', '5m', '15m', '30m', '1h', '4h', '1d']) {
        const vetada =
          (cfg.quarantineIntervals ?? []).includes(tf) || fueraDeListaBlanca(cfg, s, tf);
        if (!vetada) emiten.push(`${s}:${tf}`);
      }
    }
    expect(emiten.sort()).toEqual(['ETHUSDT:1d', 'SOLUSDT:1d']);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  VigilanteArtefactos,
  estadoDe,
  legible,
  type Recarga,
  type Vigilado,
} from '../src/artifacts/vigilancia.js';
import { QuarantinePolicy } from '../src/ensemble/quarantine.js';

/**
 * La api recoge sola lo que publica el piloto (0.73.0).
 *
 * Hasta 0.72.2 solo releía los artefactos al arrancar o con `POST /reload`, y el piloto nunca la
 * llamaba: una cuarentena decidida a las 12:30 no se aplicaba hasta el siguiente despliegue. Estos
 * tests usan ficheros reales y el cargador real de la cuarentena: lo que se comprueba es que un
 * cambio en disco llega a lo que la api decide, sin recarga manual ni reinicio.
 */

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vigilancia-'));
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(dir, { recursive: true, force: true });
});

function publicarCuarentena(ruta: string, clave: string, vetada: boolean, version: string): void {
  const set = {
    version,
    intervals: { [clave]: { interval: '1d', quarantined: vetada, reason: 'x' } },
  };
  writeFileSync(ruta, JSON.stringify(set, null, 2));
}

function montar(ruta: string): {
  policy: QuarantinePolicy;
  vigilante: VigilanteArtefactos;
  recargas: Recarga[][];
  omitidos: string[];
} {
  const policy = QuarantinePolicy.load(ruta);
  const recargas: Recarga[][] = [];
  const omitidos: string[] = [];
  const vigilados: Vigilado[] = [{ nombre: 'cuarentena', ruta, recargar: () => policy.reload() }];
  const vigilante = new VigilanteArtefactos(vigilados, {
    alRecargar: (r) => recargas.push(r),
    alOmitir: (n) => omitidos.push(n),
  });
  return { policy, vigilante, recargas, omitidos };
}

describe('la api aplica lo que el piloto publica', () => {
  it('una clave que entra en cuarentena queda vetada en la api sin POST /reload', () => {
    const ruta = join(dir, 'quarantine.json');
    publicarCuarentena(ruta, 'ETHUSDT:1d', false, 'qtn-1');
    const { policy, vigilante, recargas } = montar(ruta);
    expect(policy.isQuarantined('ETHUSDT', '1d', false)).toBe(false);

    publicarCuarentena(ruta, 'ETHUSDT:1d', true, 'qtn-2-entra');
    expect(policy.isQuarantined('ETHUSDT', '1d', false)).toBe(false); // aún no ha mirado

    const hechas = vigilante.comprobar();

    expect(hechas.map((r) => r.nombre)).toEqual(['cuarentena']);
    expect(policy.isQuarantined('ETHUSDT', '1d', false)).toBe(true);
    expect(policy.version).toBe('qtn-2-entra');
    expect(recargas).toHaveLength(1);
  });

  it('sin cambios en disco no recarga nada', () => {
    const ruta = join(dir, 'quarantine.json');
    publicarCuarentena(ruta, 'ETHUSDT:1d', false, 'qtn-1');
    const recargar = vi.fn();
    const vigilante = new VigilanteArtefactos([{ nombre: 'cuarentena', ruta, recargar }]);
    expect(vigilante.comprobar()).toEqual([]);
    expect(vigilante.comprobar()).toEqual([]);
    expect(recargar).not.toHaveBeenCalled();
  });

  it('cada cambio se aplica una vez, no en cada tick', () => {
    const ruta = join(dir, 'quarantine.json');
    publicarCuarentena(ruta, 'ETHUSDT:1d', false, 'qtn-1');
    const { vigilante, recargas } = montar(ruta);
    publicarCuarentena(ruta, 'ETHUSDT:1d', true, 'qtn-2-entra');
    vigilante.comprobar();
    vigilante.comprobar();
    vigilante.comprobar();
    expect(recargas).toHaveLength(1);
  });
});

describe('lo que no se aplica', () => {
  it('un JSON a medias no levanta ningún veto: se conserva el anterior y se reintenta', () => {
    // Es el caso que haría daño: el cargador convierte un fichero ilegible en «sin artefacto», y
    // sin artefacto una cuarentena decidida por expediente desaparece.
    const ruta = join(dir, 'quarantine.json');
    publicarCuarentena(ruta, 'ETHUSDT:1d', true, 'qtn-1-vetada');
    const { policy, vigilante, recargas, omitidos } = montar(ruta);

    writeFileSync(ruta, '{"version": "qtn-2", "intervals": {"ETHUSDT:1d": {"quar');
    vigilante.comprobar();
    vigilante.comprobar();

    expect(policy.isQuarantined('ETHUSDT', '1d', false)).toBe(true);
    expect(policy.version).toBe('qtn-1-vetada');
    expect(recargas).toHaveLength(0);
    expect(omitidos).toEqual(['cuarentena']); // se avisa una vez, no en cada tick

    // Cuando el fichero se completa, se aplica.
    publicarCuarentena(ruta, 'ETHUSDT:1d', false, 'qtn-3-sale');
    vigilante.comprobar();
    expect(policy.version).toBe('qtn-3-sale');
    expect(recargas).toHaveLength(1);
  });

  it('un artefacto borrado sí se aplica: sin artefacto manda la configuración', () => {
    const ruta = join(dir, 'quarantine.json');
    publicarCuarentena(ruta, 'ETHUSDT:1d', true, 'qtn-1');
    const { policy, vigilante } = montar(ruta);
    unlinkSync(ruta);
    vigilante.comprobar();
    expect(policy.version).toBeNull();
    expect(policy.isQuarantined('ETHUSDT', '1d', false)).toBe(false);
  });

  it('tras una recarga manual no se repite en el siguiente tick', () => {
    const ruta = join(dir, 'quarantine.json');
    publicarCuarentena(ruta, 'ETHUSDT:1d', false, 'qtn-1');
    const { policy, vigilante, recargas } = montar(ruta);
    publicarCuarentena(ruta, 'ETHUSDT:1d', true, 'qtn-2');
    policy.reload(); // POST /reload
    vigilante.sincronizar();
    expect(vigilante.comprobar()).toEqual([]);
    expect(recargas).toHaveLength(0);
  });
});

describe('directorios de artefactos', () => {
  it('un fundamental nuevo o modificado se recarga; un temporal de escritura no', () => {
    const fund = join(dir, 'fundamental');
    mkdirSync(fund);
    writeFileSync(join(fund, 'BTCUSDT.json'), '{"version": "fund-1"}');
    const recargar = vi.fn();
    const vigilante = new VigilanteArtefactos([
      { nombre: 'fundamentales', ruta: fund, directorio: true, recargar },
    ]);

    // El piloto escribe primero un temporal oculto: no es un artefacto publicado.
    writeFileSync(join(fund, '.ETHUSDT.json.42.tmp'), '{"version": "fund-a-me');
    expect(vigilante.comprobar()).toEqual([]);

    writeFileSync(join(fund, 'ETHUSDT.json'), '{"version": "fund-2"}');
    expect(vigilante.comprobar().map((r) => r.nombre)).toEqual(['fundamentales']);
    expect(recargar).toHaveBeenCalledTimes(1);
  });

  it('la firma de un directorio ignora los temporales y cambia con cualquier publicado', () => {
    const fund = join(dir, 'fundamental');
    mkdirSync(fund);
    writeFileSync(join(fund, 'BTCUSDT.json'), '{}');
    const antes = estadoDe(fund, true).firma;
    writeFileSync(join(fund, '.BTCUSDT.json.7.tmp'), '{');
    expect(estadoDe(fund, true).firma).toBe(antes);
    writeFileSync(join(fund, 'BTCUSDT.json'), '{"a": 1}');
    expect(estadoDe(fund, true).firma).not.toBe(antes);
  });

  it('legible: JSON y YAML completos sí, a medias no, ausente sí', () => {
    writeFileSync(join(dir, 'ok.json'), '{"a": 1}');
    writeFileSync(join(dir, 'roto.json'), '{"a": ');
    writeFileSync(join(dir, 'ok.yaml'), 'version: base\nweights:\n  ema: 1\n');
    writeFileSync(join(dir, 'roto.yaml'), 'version: [base\n');
    expect(legible(join(dir, 'ok.json'))).toBe(true);
    expect(legible(join(dir, 'roto.json'))).toBe(false);
    expect(legible(join(dir, 'ok.yaml'))).toBe(true);
    expect(legible(join(dir, 'roto.yaml'))).toBe(false);
    expect(legible(join(dir, 'no-existe.json'))).toBe(true);
  });
});

describe('el sondeo', () => {
  it('con el intervalo configurado recoge el cambio sin que nadie llame a comprobar()', () => {
    vi.useFakeTimers();
    const ruta = join(dir, 'quarantine.json');
    publicarCuarentena(ruta, 'ETHUSDT:1d', false, 'qtn-1');
    const { policy, vigilante } = montar(ruta);
    vigilante.iniciar(15_000);

    publicarCuarentena(ruta, 'ETHUSDT:1d', true, 'qtn-2-entra');
    vi.advanceTimersByTime(14_999);
    expect(policy.isQuarantined('ETHUSDT', '1d', false)).toBe(false);
    vi.advanceTimersByTime(1);
    expect(policy.isQuarantined('ETHUSDT', '1d', false)).toBe(true);

    vigilante.detener();
  });

  it('con intervalo 0 queda desactivado: solo la recarga manual', () => {
    vi.useFakeTimers();
    const ruta = join(dir, 'quarantine.json');
    publicarCuarentena(ruta, 'ETHUSDT:1d', false, 'qtn-1');
    const { policy, vigilante } = montar(ruta);
    vigilante.iniciar(0);
    publicarCuarentena(ruta, 'ETHUSDT:1d', true, 'qtn-2');
    vi.advanceTimersByTime(3_600_000);
    expect(policy.isQuarantined('ETHUSDT', '1d', false)).toBe(false);
  });

  it('el retraso informado es el tiempo desde que el fichero cambió', () => {
    const ruta = join(dir, 'quarantine.json');
    publicarCuarentena(ruta, 'ETHUSDT:1d', false, 'qtn-1');
    const policy = QuarantinePolicy.load(ruta);
    let reloj = 0;
    const vigilante = new VigilanteArtefactos(
      [{ nombre: 'cuarentena', ruta, recargar: () => policy.reload() }],
      { ahora: () => reloj },
    );
    publicarCuarentena(ruta, 'ETHUSDT:1d', true, 'qtn-2-entra');
    reloj = estadoDe(ruta).mtimeMs + 4_200;
    expect(vigilante.comprobar()).toEqual([{ nombre: 'cuarentena', retrasoMs: 4_200 }]);
  });

  it('medido con temporizadores reales, el cambio se aplica dentro de un intervalo', async () => {
    const ruta = join(dir, 'quarantine.json');
    publicarCuarentena(ruta, 'ETHUSDT:1d', false, 'qtn-1');
    const { policy, vigilante, recargas } = montar(ruta);
    const intervalo = 50;
    vigilante.iniciar(intervalo);

    const inicio = performance.now();
    publicarCuarentena(ruta, 'ETHUSDT:1d', true, 'qtn-2-entra');
    while (!policy.isQuarantined('ETHUSDT', '1d', false) && performance.now() - inicio < 2_000) {
      await new Promise((r) => setTimeout(r, 5));
    }
    const latencia = performance.now() - inicio;
    vigilante.detener();

    expect(policy.isQuarantined('ETHUSDT', '1d', false)).toBe(true);
    // Holgura amplia para una máquina de CI cargada; lo esperado es ≤ un intervalo.
    expect(latencia).toBeLessThan(intervalo * 20);
    expect(recargas.flat()[0]?.retrasoMs).toBeGreaterThanOrEqual(0);
  });
});

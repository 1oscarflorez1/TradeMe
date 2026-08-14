import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseChangelog, Releases } from '../src/releases/parse.js';

const here = dirname(fileURLToPath(import.meta.url));
const CHANGELOG = join(here, '../../../CHANGELOG.md');

const EJEMPLO = `# Changelog

Formato basado en Keep a Changelog.

## [0.34.0] — 2026-08-12

> Nota introductoria de la versión.

### Fixed — Un título con guion largo

- Primer punto con **negrita**.
- Segundo punto que continúa
  en la línea siguiente con sangría.

### Added — Otro título

- Un único punto.

## [0.23.1] — 2026-07-30

### Fixed

- Sección sin título, solo categoría.
`;

describe('parseChangelog', () => {
  const rs = parseChangelog(EJEMPLO);

  it('extrae versiones en orden, de la más nueva a la más vieja', () => {
    expect(rs.map((r) => r.version)).toEqual(['0.34.0', '0.23.1']);
  });

  it('extrae la fecha de la cabecera y nunca se la inventa', () => {
    expect(rs[0]!.fecha).toBe('2026-08-12');
    expect(parseChangelog('## [1.0.0]\n\n### Added — x\n\n- y\n')[0]!.fecha).toBeNull();
  });

  it('separa categoría y título de cada sección', () => {
    expect(rs[0]!.secciones.map((s) => [s.categoria, s.titulo])).toEqual([
      ['Fixed', 'Un título con guion largo'],
      ['Added', 'Otro título'],
    ]);
  });

  it('admite secciones sin título', () => {
    expect(rs[1]!.secciones[0]).toMatchObject({ categoria: 'Fixed', titulo: '' });
  });

  it('une las viñetas que continúan en la línea siguiente', () => {
    expect(rs[0]!.secciones[0]!.puntos).toEqual([
      'Primer punto con **negrita**.',
      'Segundo punto que continúa en la línea siguiente con sangría.',
    ]);
  });

  it('recoge la nota introductoria sin el signo de cita', () => {
    expect(rs[0]!.nota).toBe('Nota introductoria de la versión.');
    expect(rs[1]!.nota).toBeNull();
  });

  it('ignora el preámbulo del documento', () => {
    expect(rs.some((r) => r.version.includes('Changelog'))).toBe(false);
  });

  it('no revienta con entradas vacías o basura', () => {
    expect(parseChangelog('')).toEqual([]);
    expect(parseChangelog('texto suelto sin cabeceras')).toEqual([]);
  });
});

describe('el CHANGELOG real del repositorio', () => {
  const rs = parseChangelog(readFileSync(CHANGELOG, 'utf8'));

  it('se interpreta y tiene historial', () => {
    expect(rs.length).toBeGreaterThan(20);
  });

  it('todas las versiones tienen forma semver y fecha', () => {
    for (const r of rs) {
      expect(r.version, `versión mal formada: ${r.version}`).toMatch(/^\d+\.\d+\.\d+$/);
      expect(r.fecha, `${r.version} sin fecha`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('no hay versiones repetidas', () => {
    const vistas = rs.map((r) => r.version);
    expect(new Set(vistas).size).toBe(vistas.length);
  });

  it('está ordenado de la más nueva a la más vieja', () => {
    const clave = (v: string): number => {
      const [a, b, c] = v.split('.').map(Number);
      return a! * 1e6 + b! * 1e3 + c!;
    };
    for (let i = 1; i < rs.length; i += 1) {
      expect(clave(rs[i - 1]!.version)).toBeGreaterThan(clave(rs[i]!.version));
    }
  });

  it('ninguna versión se queda sin contenido', () => {
    for (const r of rs) {
      expect(r.secciones.length, `${r.version} sin secciones`).toBeGreaterThan(0);
      const puntos = r.secciones.reduce((n, s) => n + s.puntos.length, 0);
      expect(puntos, `${r.version} sin viñetas`).toBeGreaterThan(0);
    }
  });
});

describe('Releases', () => {
  const r = new Releases(CHANGELOG);

  it('latest() devuelve la primera entrada', () => {
    expect(r.latest()?.version).toBe(r.all()[0]?.version);
  });

  it('find() acepta la versión con y sin v inicial', () => {
    const v = r.all()[0]!.version;
    expect(r.find(v)?.version).toBe(v);
    expect(r.find(`v${v}`)?.version).toBe(v);
    expect(r.find('99.0.0')).toBeNull();
  });

  it('resumen() cabe en pocas líneas', () => {
    expect(r.resumen(3).split('\n')).toHaveLength(3);
  });

  it('un fichero que no existe no rompe nada', () => {
    const vacio = new Releases('/no/existe/CHANGELOG.md');
    expect(vacio.all()).toEqual([]);
    expect(vacio.latest()).toBeNull();
    expect(vacio.resumen()).toContain('No hay historial');
  });
});

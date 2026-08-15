import { describe, expect, it } from 'vitest';
import type { Release } from './api';
import { categoriaDe, filtra, formatea, recuento, textoDe, titularDe } from './news';

/** Primeras pruebas del portal (M10.7). Hasta aquí `apps/web` no tenía ninguna. */

const rel = (p: Partial<Release> = {}): Release => ({
  version: '0.35.0',
  fecha: '2026-08-13',
  nota: null,
  secciones: [],
  ...p,
});

describe('formatea', () => {
  it('da día corto y fecha larga', () => {
    const f = formatea('2026-08-13');
    expect(f.dia).toBe('13 ago');
    expect(f.largo).toContain('2026');
  });

  it('no se inventa una fecha que no hay', () => {
    expect(formatea(null).dia).toBe('—');
    expect(formatea(null).largo).toContain('sin fecha');
  });

  it('devuelve la cadena tal cual si no es una fecha válida', () => {
    expect(formatea('no-es-fecha').dia).toBe('no-es-fecha');
    expect(formatea('2026-13-01').dia).toBe('2026-13-01');
  });

  it('cubre los doce meses sin salirse del array', () => {
    for (let m = 1; m <= 12; m += 1) {
      const f = formatea(`2026-${String(m).padStart(2, '0')}-01`);
      expect(f.dia).not.toContain('undefined');
    }
  });
});

describe('titularDe', () => {
  it('usa el título de la primera sección que lo tenga', () => {
    const r = rel({
      secciones: [
        { categoria: 'Fixed', titulo: '', puntos: ['x'] },
        { categoria: 'Added', titulo: 'El título bueno', puntos: ['y'] },
      ],
    });
    expect(titularDe(r)).toBe('El título bueno');
  });

  it('cae a la nota si ninguna sección tiene título', () => {
    const r = rel({ nota: 'Una nota explicativa', secciones: [{ categoria: 'Fixed', titulo: '', puntos: [] }] });
    expect(titularDe(r)).toBe('Una nota explicativa');
  });

  it('siempre devuelve algo, aunque la versión venga vacía', () => {
    expect(titularDe(rel())).toBe('Versión 0.35.0');
  });
});

describe('recuento', () => {
  it('suma apartados y viñetas', () => {
    const r = rel({
      secciones: [
        { categoria: 'Added', titulo: 'a', puntos: ['1', '2', '3'] },
        { categoria: 'Fixed', titulo: 'b', puntos: ['4'] },
      ],
    });
    expect(recuento(r)).toEqual({ apartados: 2, cambios: 4 });
  });

  it('una versión sin secciones cuenta cero, no falla', () => {
    expect(recuento(rel())).toEqual({ apartados: 0, cambios: 0 });
  });
});

describe('filtra', () => {
  const lista = [
    rel({ version: '0.35.0', secciones: [{ categoria: 'Added', titulo: 'Cuarentena', puntos: ['sombra'] }] }),
    rel({ version: '0.34.0', secciones: [{ categoria: 'Fixed', titulo: 'Calibración', puntos: ['isotónica'] }] }),
  ];

  it('sin término devuelve todo', () => {
    expect(filtra(lista, '')).toHaveLength(2);
    expect(filtra(lista, '   ')).toHaveLength(2);
  });

  it('busca en título, viñetas y versión', () => {
    expect(filtra(lista, 'cuarentena')).toHaveLength(1);
    expect(filtra(lista, 'isotónica')).toHaveLength(1);
    expect(filtra(lista, '0.34')).toHaveLength(1);
  });

  it('no distingue mayúsculas', () => {
    expect(filtra(lista, 'CALIBRACIÓN')).toHaveLength(1);
  });

  it('devuelve vacío si nada coincide', () => {
    expect(filtra(lista, 'zzzz')).toHaveLength(0);
  });
});

describe('textoDe', () => {
  it('incluye la nota', () => {
    expect(textoDe(rel({ nota: 'Nota importante' }))).toContain('nota importante');
  });
});

describe('categoriaDe', () => {
  it('traduce las categorías conocidas', () => {
    expect(categoriaDe('Added').etiqueta).toBe('Novedades');
    expect(categoriaDe('Fixed').etiqueta).toBe('Correcciones');
  });

  it('una categoría desconocida se muestra tal cual, no se pierde', () => {
    expect(categoriaDe('Performance').etiqueta).toBe('Performance');
  });
});

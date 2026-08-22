import { describe, it, expect } from 'vitest';
import {
  ARTICULOS,
  FAQ,
  GLOSARIO,
  KB,
  KB_EXTRA,
  MANUAL,
  RESUMEN,
  RUTAS,
  buscarArticulo,
} from './contenido';

/**
 * Coherencia del Centro de ayuda.
 *
 * El contenido se referencia desde tres sitios —`RESUMEN` por título, `RUTAS` por título, y el
 * asistente mediante `buscarArticulo`—, y todos apuntan con cadenas de texto. Renombrar un artículo
 * rompe esos enlaces **sin que nada falle**: la ficha se queda sin resumen, la tarjeta de entrada no
 * lleva a ninguna parte, y el asistente remite a un sitio que ya no existe.
 *
 * Estos tests convierten esa disciplina en estructura, que es el principio del proyecto.
 */

describe('índice de artículos', () => {
  it('no hay títulos duplicados', () => {
    const titulos = ARTICULOS.map((a) => a.title);
    expect(new Set(titulos).size).toBe(titulos.length);
  });

  it('todo artículo tiene título y cuerpo', () => {
    for (const a of ARTICULOS) {
      expect(a.title.trim().length).toBeGreaterThan(0);
      expect(a.body).toBeTruthy();
    }
  });

  it('el índice reúne las cuatro secciones', () => {
    expect(ARTICULOS).toHaveLength(MANUAL.length + KB.length + KB_EXTRA.length + FAQ.length);
  });
});

describe('enlaces internos', () => {
  it('cada entrada de RUTAS apunta a un artículo que existe', () => {
    // Son las tarjetas de «acabo de entrar y no sé qué miro». Si el título cambia, la tarjeta lleva
    // a ninguna parte y el usuario se queda mirando una lista sin el artículo abierto.
    const titulos = new Set(ARTICULOS.map((a) => a.title));
    for (const r of RUTAS) {
      expect(titulos.has(r.art), `RUTA rota: "${r.art}"`).toBe(true);
    }
  });

  it('cada clave de RESUMEN corresponde a un artículo que existe', () => {
    const titulos = new Set(ARTICULOS.map((a) => a.title));
    for (const clave of Object.keys(RESUMEN)) {
      expect(titulos.has(clave), `RESUMEN huérfano: "${clave}"`).toBe(true);
    }
  });

  it('los artículos del manual tienen resumen', () => {
    // El resumen es lo que permite decidir si merece la pena abrir el artículo. Sin él, la lista
    // es solo una fila de títulos.
    for (const a of MANUAL) {
      expect(RESUMEN[a.title], `sin resumen: "${a.title}"`).toBeTruthy();
    }
  });
});

describe('lo que cita el asistente', () => {
  // Términos que la base local del asistente deriva al Centro de ayuda. Si un artículo se renombra
  // o desaparece, el asistente remitiría a un sitio inexistente — y esto lo caza antes.
  const CITADOS = ['cuarentena', 'fundamental', 'funding', 'correlación', 'meta-modelo'];

  for (const termino of CITADOS) {
    it(`encuentra dónde se explica "${termino}"`, () => {
      const art = buscarArticulo(termino);
      expect(art, `el asistente cita "${termino}" y no hay artículo que lo cubra`).not.toBeNull();
    });
  }

  it('un término inventado no devuelve nada, en vez de inventarse un artículo', () => {
    expect(buscarArticulo('kriptonita')).toBeNull();
    expect(buscarArticulo('')).toBeNull();
  });
});

describe('glosario', () => {
  it('cada entrada tiene término, categoría y definición', () => {
    for (const [termino, categoria, definicion] of GLOSARIO) {
      expect(termino.trim().length).toBeGreaterThan(0);
      expect(categoria.trim().length).toBeGreaterThan(0);
      expect(definicion.trim().length).toBeGreaterThan(10);
    }
  });

  it('no hay términos repetidos', () => {
    const terminos = GLOSARIO.map(([t]) => t.toLowerCase());
    expect(new Set(terminos).size).toBe(terminos.length);
  });
});

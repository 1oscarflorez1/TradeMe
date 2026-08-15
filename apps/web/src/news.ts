/**
 * Lógica pura de la pestaña Novedades (M10.7).
 *
 * Separada del componente para poder probarla. El portal no tenía ni una prueba, y el error de
 * recuento de la 0.28.0 —el mismo registro sumando a la vez en dos columnas— fue precisamente de
 * cálculo, no de pintado. Lo que se puede probar sin montar un navegador, se prueba aquí.
 */
import type { Release } from './api';

export const MESES = [
  'ene', 'feb', 'mar', 'abr', 'may', 'jun',
  'jul', 'ago', 'sep', 'oct', 'nov', 'dic',
];

/** Categorías del CHANGELOG traducidas a lo que el equipo lee en pantalla. */
export const CATEGORIAS: Record<string, { etiqueta: string; clase: string }> = {
  Added: { etiqueta: 'Novedades', clase: 'nv-add' },
  Changed: { etiqueta: 'Cambios', clase: 'nv-chg' },
  Fixed: { etiqueta: 'Correcciones', clase: 'nv-fix' },
  Removed: { etiqueta: 'Retirado', clase: 'nv-chg' },
  Deprecated: { etiqueta: 'En desuso', clase: 'nv-chg' },
  Security: { etiqueta: 'Seguridad', clase: 'nv-fix' },
};

export function categoriaDe(nombre: string): { etiqueta: string; clase: string } {
  return CATEGORIAS[nombre] ?? { etiqueta: nombre, clase: 'nv-chg' };
}

/** Fecha corta y larga. Una versión sin fecha se muestra como tal; no se inventa. */
export function formatea(fecha: string | null): { dia: string; largo: string } {
  if (!fecha) return { dia: '—', largo: 'sin fecha en el registro de cambios' };
  const [a, m, d] = fecha.split('-').map(Number);
  if (!a || !m || !d || m < 1 || m > 12) return { dia: fecha, largo: fecha };
  return {
    dia: `${d} ${MESES[m - 1]}`,
    largo: new Date(a, m - 1, d).toLocaleDateString('es', { dateStyle: 'full' }),
  };
}

/** Todo el texto de una versión, en minúsculas, para el buscador. */
export function textoDe(r: Release): string {
  return [
    r.version,
    r.nota ?? '',
    ...r.secciones.flatMap((s) => [s.categoria, s.titulo, ...s.puntos]),
  ]
    .join(' ')
    .toLowerCase();
}

/** Titular de una versión: el de su primera sección con título, o la nota. */
export function titularDe(r: Release): string {
  const conTitulo = r.secciones.find((s) => s.titulo.length > 0);
  if (conTitulo) return conTitulo.titulo;
  if (r.nota) return r.nota.slice(0, 120);
  return `Versión ${r.version}`;
}

/** Cuántos apartados y cuántos cambios trae una versión. */
export function recuento(r: Release): { apartados: number; cambios: number } {
  return {
    apartados: r.secciones.length,
    cambios: r.secciones.reduce((n, s) => n + s.puntos.length, 0),
  };
}

/** Filtra el historial por texto libre. Sin término devuelve la lista intacta. */
export function filtra(releases: Release[], q: string): Release[] {
  const busca = q.trim().toLowerCase();
  if (!busca) return releases;
  return releases.filter((r) => textoDe(r).includes(busca));
}

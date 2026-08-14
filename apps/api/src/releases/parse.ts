/**
 * Lectura del historial de versiones desde CHANGELOG.md (M10.6).
 *
 * Hasta 0.34.0 la pestaña Novedades era una **segunda copia** del registro de cambios, escrita a
 * mano dentro del código del portal: un array de 27 entradas cuya última era la 0.28.0 mientras la
 * plataforma ejecutaba la 0.34.0. Seis versiones invisibles para el equipo, y un asistente que no
 * podía explicar qué había cambiado porque nadie se lo contaba.
 *
 * La corrección no es acordarse mejor: es dejar de copiar y empezar a leer. Este módulo es el único
 * sitio donde se interpreta el CHANGELOG; la web lo consume por `GET /releases` y el asistente por
 * su herramienta `cambios_de_version`. Una sola fuente, un solo parser.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';

export interface ReleaseSection {
  /** Added · Changed · Fixed · Removed… tal cual aparece en el CHANGELOG. */
  categoria: string;
  /** Título tras el guion largo. Vacío si la sección no lo lleva. */
  titulo: string;
  /** Cada viñeta, con su markdown intacto: el portal ya sabe pintarlo. */
  puntos: string[];
}

export interface Release {
  version: string;
  /** AAAA-MM-DD, o null si la cabecera no la trae. Nunca se inventa. */
  fecha: string | null;
  /** Texto introductorio de la versión (la cita que abre el bloque), si lo hay. */
  nota: string | null;
  secciones: ReleaseSection[];
}

const CABECERA_VERSION = /^##\s*\[([^\]]+)\]\s*(?:—|-|–)?\s*(\d{4}-\d{2}-\d{2})?/;
const CABECERA_SECCION = /^###\s+(\S+)(?:\s*(?:—|-|–)\s*(.*))?$/;

/** Interpreta el texto de un CHANGELOG en formato Keep a Changelog. */
export function parseChangelog(texto: string): Release[] {
  const releases: Release[] = [];
  let actual: Release | null = null;
  let seccion: ReleaseSection | null = null;
  let nota: string[] = [];

  const cerrarSeccion = (): void => {
    if (actual && seccion) actual.secciones.push(seccion);
    seccion = null;
  };
  const cerrarRelease = (): void => {
    cerrarSeccion();
    if (actual) {
      const n = nota.join(' ').trim();
      actual.nota = n.length > 0 ? n : null;
      releases.push(actual);
    }
    nota = [];
    actual = null;
  };

  for (const linea of texto.replace(/\r\n/g, '\n').split('\n')) {
    const mv = CABECERA_VERSION.exec(linea);
    if (mv) {
      cerrarRelease();
      actual = { version: mv[1]!.trim(), fecha: mv[2] ?? null, nota: null, secciones: [] };
      continue;
    }
    if (!actual) continue; // preámbulo del documento

    const ms = CABECERA_SECCION.exec(linea);
    if (ms) {
      cerrarSeccion();
      seccion = { categoria: ms[1]!.trim(), titulo: (ms[2] ?? '').trim(), puntos: [] };
      continue;
    }

    // Viñeta: puede continuar en las líneas siguientes con sangría.
    const vinieta = /^\s*[-*]\s+(.*)$/.exec(linea);
    if (vinieta && seccion) {
      seccion.puntos.push(vinieta[1]!.trim());
      continue;
    }
    if (seccion && seccion.puntos.length > 0 && /^\s+\S/.test(linea)) {
      const i = seccion.puntos.length - 1;
      seccion.puntos[i] = `${seccion.puntos[i]!} ${linea.trim()}`;
      continue;
    }
    // Antes de la primera sección, el texto suelto es la nota de la versión.
    if (!seccion && linea.trim().length > 0) {
      nota.push(linea.replace(/^>\s?/, '').trim());
    }
  }
  cerrarRelease();
  return releases;
}

/**
 * Carga el CHANGELOG con caché por fecha de modificación.
 *
 * Se relee solo si el fichero cambió: en un contenedor no cambia nunca, así que en la práctica se
 * parsea una vez. Sin caché, cada visita a Novedades y cada pregunta al asistente reharían el
 * trabajo entero.
 */
export class Releases {
  private cache: Release[] | null = null;
  private mtime = 0;

  constructor(private readonly path: string) {}

  all(): Release[] {
    try {
      if (!existsSync(this.path)) return [];
      const m = statSync(this.path).mtimeMs;
      if (this.cache === null || m !== this.mtime) {
        this.cache = parseChangelog(readFileSync(this.path, 'utf8'));
        this.mtime = m;
      }
      return this.cache;
    } catch {
      return [];
    }
  }

  /** La más reciente, que es la que la plataforma debería estar ejecutando. */
  latest(): Release | null {
    return this.all()[0] ?? null;
  }

  find(version: string): Release | null {
    const v = version.trim().replace(/^v/i, '');
    return this.all().find((r) => r.version === v) ?? null;
  }

  /** Resumen compacto para el contexto del asistente: barato en tokens y suficiente. */
  resumen(limite = 3): string {
    const rs = this.all().slice(0, limite);
    if (rs.length === 0) return 'No hay historial de versiones disponible.';
    return rs
      .map((r) => {
        const titulos = r.secciones
          .map((s) => (s.titulo ? `${s.categoria}: ${s.titulo}` : s.categoria))
          .join(' · ');
        return `${r.version} (${r.fecha ?? 'sin fecha'}) — ${titulos || 'sin detalle'}`;
      })
      .join('\n');
  }
}

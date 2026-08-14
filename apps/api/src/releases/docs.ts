/**
 * Lectura de la documentación conceptual de `docs/` (M10.6).
 *
 * El asistente tenía su propia explicación de qué es la calibración, el meta-modelo o el régimen,
 * escrita a mano dentro del portal. Era una tercera copia que envejecía sola: cuando M10.5 añadió la
 * cuarentena y el desinflado por dependencia, ninguna de las copias se enteró.
 *
 * `docs/` ya existe, se mantiene en cada entrega y viaja dentro de la imagen (el Dockerfile copia el
 * repositorio entero). Esto solo lo expone al asistente, para que explique lo que hay escrito en vez
 * de recordar lo que había.
 *
 * **No sustituye al Centro de ayuda.** Ayuda es documentación pensada para leerse en pantalla, con
 * su navegación y sus resúmenes; esto es material de consulta para el asistente. Son cosas distintas
 * y se dejan separadas a propósito.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

export interface DocResumen {
  /** Nombre sin extensión: es el identificador que usa el asistente. */
  id: string;
  titulo: string;
  /** Primer párrafo, para que el modelo decida si le sirve sin leerlo entero. */
  entradilla: string;
}

/** Tope por documento entregado al modelo. Un `docs/` largo llenaría la ventana de contexto. */
const MAX_CARACTERES = 6000;

export class Docs {
  private indice: DocResumen[] | null = null;

  constructor(private readonly dir: string) {}

  private ficheros(): string[] {
    try {
      if (!existsSync(this.dir) || !statSync(this.dir).isDirectory()) return [];
      return readdirSync(this.dir)
        .filter((f) => f.toLowerCase().endsWith('.md'))
        .sort();
    } catch {
      return [];
    }
  }

  /** Índice de lo disponible: identificador, título y entradilla. */
  list(): DocResumen[] {
    if (this.indice) return this.indice;
    const out: DocResumen[] = [];
    for (const f of this.ficheros()) {
      try {
        const texto = readFileSync(join(this.dir, f), 'utf8');
        const lineas = texto.replace(/\r\n/g, '\n').split('\n');
        const h1 = lineas.find((l) => l.startsWith('# '));
        const entradilla =
          lineas.find((l) => l.trim().length > 0 && !l.startsWith('#') && !l.startsWith('>')) ?? '';
        out.push({
          id: basename(f, '.md'),
          titulo: (h1 ?? f).replace(/^#\s*/, '').trim(),
          entradilla: entradilla.trim().slice(0, 240),
        });
      } catch {
        // Un documento ilegible no debe tumbar el índice entero.
      }
    }
    this.indice = out;
    return out;
  }

  /** Contenido de un documento, recortado. `null` si no existe. */
  read(id: string): { id: string; titulo: string; contenido: string; truncado: boolean } | null {
    // Solo el nombre base: nada de rutas relativas ni de salir del directorio.
    const limpio = basename(String(id)).replace(/\.md$/i, '');
    if (!limpio || limpio.startsWith('.')) return null;
    const ruta = join(this.dir, `${limpio}.md`);
    if (!existsSync(ruta)) return null;
    try {
      const texto = readFileSync(ruta, 'utf8');
      const meta = this.list().find((d) => d.id === limpio);
      return {
        id: limpio,
        titulo: meta?.titulo ?? limpio,
        contenido: texto.slice(0, MAX_CARACTERES),
        truncado: texto.length > MAX_CARACTERES,
      };
    } catch {
      return null;
    }
  }

  /**
   * Busca un término y devuelve los documentos que lo mencionan, con su contexto.
   *
   * Búsqueda literal, sin índice invertido ni dependencias: `docs/` son dos docenas de ficheros
   * pequeños y montar algo más sofisticado sería resolver un problema que no existe.
   */
  search(termino: string, maxDocs = 3): Array<{ id: string; titulo: string; extractos: string[] }> {
    const q = termino.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: Array<{ id: string; titulo: string; extractos: string[] }> = [];
    for (const doc of this.list()) {
      const leido = this.read(doc.id);
      if (!leido) continue;
      const lineas = leido.contenido.split('\n');
      const extractos: string[] = [];
      for (let i = 0; i < lineas.length && extractos.length < 4; i += 1) {
        if (lineas[i]!.toLowerCase().includes(q)) {
          extractos.push(lineas.slice(Math.max(0, i - 1), i + 2).join(' ').trim().slice(0, 400));
        }
      }
      if (extractos.length > 0) out.push({ id: doc.id, titulo: doc.titulo, extractos });
      if (out.length >= maxDocs) break;
    }
    return out;
  }
}

// Recarga automática de los artefactos que publica el piloto (0.73.0).
//
// Hasta 0.72.2 la api leía `quarantine.json`, el meta-modelo, los calibradores y demás al arrancar,
// y solo los releía con `POST /reload`, que únicamente llamaba la web desde el Laboratorio. El
// piloto los republica cada ciclo sin avisar a nadie: una entrada en cuarentena decidida a las
// 12:30 no llegaba a la api hasta el siguiente despliegue. La regla era la misma en los dos lados
// —vectores de paridad desde 0.72.2— pero la api la aplicaba sobre una copia de hace horas.
//
// Por qué sondeo y no `fs.watch`
// ------------------------------
// Los artefactos llegan por un bind mount que comparten dos contenedores. `fs.watch` depende de
// que el sistema de ficheros propague eventos entre ellos, y eso varía con Docker Desktop, WSL2 o
// un volumen de red. Medido en producción el 14-sep-2026 sí los propagaba, pero la garantía no es
// del código sino del montaje. Comparar mtime y tamaño cada pocos segundos funciona en todos, cuesta
// una decena de `stat` por tick y acota la latencia al intervalo.
//
// Lo que no se recarga nunca
// --------------------------
// Un fichero que no se puede leer entero —JSON o YAML a medias— no se aplica: se conserva el estado
// anterior y se reintenta en el siguiente tick. Los cargadores de cada artefacto convierten un
// fichero ilegible en «sin artefacto», y para la cuarentena eso es levantar vetos durante un tick.
// El piloto escribe de forma atómica (`trademe_quant.publicacion`), así que esto no debería
// ocurrir; la comprobación está para que tampoco importe si ocurre.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

export interface Vigilado {
  /** Nombre corto para el log: `cuarentena`, `metamodelo`… */
  nombre: string;
  /** Fichero, o directorio de ficheros `.json` si `directorio` es true. */
  ruta: string;
  directorio?: boolean;
  /** Relee el artefacto en memoria. */
  recargar: () => void;
}

export interface Recarga {
  nombre: string;
  /** Milisegundos entre la última modificación en disco y la recarga. Es la latencia observable. */
  retrasoMs: number;
}

export interface OpcionesVigilante {
  /** Tras recargar uno o varios artefactos en el mismo tick. */
  alRecargar?: (recargas: Recarga[]) => void;
  /** Un artefacto cambió pero no se pudo leer entero: se conserva el estado anterior. */
  alOmitir?: (nombre: string) => void;
  ahora?: () => number;
}

interface Estado {
  firma: string;
  mtimeMs: number;
}

const AUSENTE: Estado = { firma: 'ausente', mtimeMs: 0 };

/** Firma de un fichero o de un directorio de artefactos. Cambia si cambia cualquier cosa leída. */
export function estadoDe(ruta: string, directorio = false): Estado {
  try {
    if (!directorio) {
      const s = statSync(ruta);
      // El inodo cambia con cada sustitución atómica aunque mtime y tamaño coincidieran, que en un
      // sistema de ficheros con resolución de segundos puede pasar.
      return { firma: `${s.ino}:${s.mtimeMs}:${s.size}`, mtimeMs: s.mtimeMs };
    }
    const partes: string[] = [];
    let ultimo = 0;
    for (const nombre of publicados(ruta)) {
      const s = statSync(join(ruta, nombre));
      partes.push(`${nombre}@${s.ino}:${s.mtimeMs}:${s.size}`);
      ultimo = Math.max(ultimo, s.mtimeMs);
    }
    return { firma: partes.join('|') || 'vacío', mtimeMs: ultimo };
  } catch {
    return AUSENTE;
  }
}

/** Los `.json` de un directorio, sin temporales de escritura (`.<nombre>.<pid>.tmp`). */
function publicados(dir: string): string[] {
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json') && !n.startsWith('.'))
    .sort();
}

/**
 * ¿Se puede aplicar lo que hay en disco? Un fichero ausente sí: es un estado válido —sin artefacto
 * manda la configuración— y los cargadores ya saben tratarlo.
 */
export function legible(ruta: string, directorio = false): boolean {
  try {
    const ficheros = directorio ? publicados(ruta).map((n) => join(ruta, n)) : [ruta];
    for (const f of ficheros) {
      const texto = readFileSync(f, 'utf8');
      if (extname(f) === '.yaml' || extname(f) === '.yml') parseYaml(texto);
      else JSON.parse(texto);
    }
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'ENOENT';
  }
}

export class VigilanteArtefactos {
  private readonly estados = new Map<string, Estado>();
  private readonly omitidos = new Set<string>();
  private temporizador: NodeJS.Timeout | null = null;

  constructor(
    private readonly vigilados: Vigilado[],
    private readonly opciones: OpcionesVigilante = {},
  ) {
    this.sincronizar();
  }

  /**
   * Toma lo que hay en disco como ya aplicado. Se llama al construir —los artefactos se acaban de
   * cargar— y tras una recarga manual, para no repetirla en el siguiente tick.
   */
  sincronizar(): void {
    for (const v of this.vigilados) this.estados.set(v.nombre, estadoDe(v.ruta, v.directorio));
    this.omitidos.clear();
  }

  /** Un tick: recarga lo que cambió y se puede leer. Devuelve lo recargado. */
  comprobar(): Recarga[] {
    const ahora = this.opciones.ahora ?? Date.now;
    const recargas: Recarga[] = [];
    for (const v of this.vigilados) {
      const actual = estadoDe(v.ruta, v.directorio);
      if (actual.firma === this.estados.get(v.nombre)?.firma) continue;
      if (!legible(v.ruta, v.directorio)) {
        // Sin actualizar la firma: el siguiente tick lo vuelve a intentar. Se avisa una vez.
        if (!this.omitidos.has(v.nombre)) this.opciones.alOmitir?.(v.nombre);
        this.omitidos.add(v.nombre);
        continue;
      }
      v.recargar();
      this.estados.set(v.nombre, actual);
      this.omitidos.delete(v.nombre);
      recargas.push({
        nombre: v.nombre,
        retrasoMs: actual.mtimeMs > 0 ? Math.max(0, Math.round(ahora() - actual.mtimeMs)) : 0,
      });
    }
    if (recargas.length > 0) this.opciones.alRecargar?.(recargas);
    return recargas;
  }

  /** Empieza a sondear. Con `intervaloMs <= 0` no hace nada: la recarga queda solo en manual. */
  iniciar(intervaloMs: number): void {
    this.detener();
    if (intervaloMs <= 0) return;
    this.temporizador = setInterval(() => {
      try {
        this.comprobar();
      } catch (err) {
        console.warn(`vigilancia de artefactos: ${String(err)}`);
      }
    }, intervaloMs);
    // No retiene el proceso: ni los tests ni un apagado ordenado tienen que esperar al sondeo.
    this.temporizador.unref();
  }

  detener(): void {
    if (this.temporizador) clearInterval(this.temporizador);
    this.temporizador = null;
  }
}

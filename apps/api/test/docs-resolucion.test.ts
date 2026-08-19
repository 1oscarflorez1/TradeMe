import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Docs } from '../src/releases/docs.js';

function conDocumentos(nombres: string[]): Docs {
  const dir = mkdtempSync(join(tmpdir(), 'trademe-docs-'));
  for (const n of nombres) {
    writeFileSync(join(dir, `${n}.md`), `# ${n}\n\nContenido de ${n}.\n`, 'utf8');
  }
  return new Docs(dir);
}

const DOCS = ['cuarentena', 'calibracion', 'metamodelo', 'datos-externos', 'indicadores'];

describe('el asistente encuentra el documento aunque no lo escriba igual', () => {
  it('en plural: «cuarentenas» → cuarentena.md', () => {
    // El fallo que originó esto. Preguntando «¿por qué las cuarentenas?», el modelo pide el tema
    // en plural y el fichero está en singular: la respuesta era «no hay documentación» teniéndola
    // delante.
    expect(conDocumentos(DOCS).read('cuarentenas')?.id).toBe('cuarentena');
  });

  it('en singular: «indicador» → indicadores.md', () => {
    expect(conDocumentos(DOCS).read('indicador')?.id).toBe('indicadores');
  });

  it('con tilde: «calibración» → calibracion.md', () => {
    expect(conDocumentos(DOCS).read('calibración')?.id).toBe('calibracion');
  });

  it('con guion: «meta-modelo» → metamodelo.md', () => {
    expect(conDocumentos(DOCS).read('meta-modelo')?.id).toBe('metamodelo');
  });

  it('con espacio: «datos externos» → datos-externos.md', () => {
    expect(conDocumentos(DOCS).read('datos externos')?.id).toBe('datos-externos');
  });

  it('en mayúsculas', () => {
    expect(conDocumentos(DOCS).read('CUARENTENA')?.id).toBe('cuarentena');
  });

  it('el nombre exacto sigue funcionando', () => {
    expect(conDocumentos(DOCS).read('cuarentena')?.id).toBe('cuarentena');
    expect(conDocumentos(DOCS).read('cuarentena.md')?.id).toBe('cuarentena');
  });
});

describe('lo que no debe resolver', () => {
  it('un tema que no existe sigue devolviendo null', () => {
    expect(conDocumentos(DOCS).read('criptografia-cuantica')).toBeNull();
  });

  it('vacío o basura', () => {
    const d = conDocumentos(DOCS);
    expect(d.read('')).toBeNull();
    expect(d.read('   ')).toBeNull();
    expect(d.read('.')).toBeNull();
  });

  it('no se sale del directorio', () => {
    // La resolución compara contra los ficheros que existen, así que no hay ruta que construir con
    // lo que llega de fuera. Aun así se comprueba: es una entrada de un modelo de lenguaje.
    const dir = mkdtempSync(join(tmpdir(), 'trademe-docs-'));
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'publico.md'), '# publico\n', 'utf8');
    writeFileSync(join(dir, 'sub', 'privado.md'), '# privado\n', 'utf8');
    const d = new Docs(dir);
    expect(d.read('../../etc/passwd')).toBeNull();
    expect(d.read('sub/privado')).toBeNull();
    expect(d.read('publico')?.id).toBe('publico');
  });
});

describe('directorio vacío o inexistente', () => {
  it('no revienta', () => {
    const d = new Docs(join(tmpdir(), 'no-existe-trademe-' + Date.now()));
    expect(d.read('cuarentena')).toBeNull();
    expect(d.list()).toEqual([]);
  });
});

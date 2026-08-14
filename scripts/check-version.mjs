#!/usr/bin/env node
/**
 * Puerta de versión (M10.6).
 *
 * Comprueba que la versión que declaran los `package.json` coincide con la primera entrada del
 * CHANGELOG, y que api y web van a la par.
 *
 * Por qué existe: hasta la 0.34.0 el registro de cambios se mantenía por disciplina y la pestaña
 * Novedades era una copia aparte. El resultado fue un portal mostrando la 0.28.0 mientras la
 * plataforma ejecutaba la 0.34.0, y un número de versión (0.34.0) reutilizado en dos ramas
 * distintas. Un ritual que depende de acordarse no es un proceso: esto lo convierte en un fallo de
 * CI, que es la única forma de que no se repita.
 *
 * Uso:  node scripts/check-version.mjs
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');

const leerVersion = (rel) => {
  try {
    return JSON.parse(readFileSync(join(raiz, rel), 'utf8')).version;
  } catch (err) {
    return { error: `no se pudo leer ${rel}: ${err.message}` };
  }
};

const problemas = [];
const api = leerVersion('apps/api/package.json');
const web = leerVersion('apps/web/package.json');

for (const [nombre, v] of [['apps/api', api], ['apps/web', web]]) {
  if (typeof v !== 'string') problemas.push(`${nombre}: ${v.error ?? 'sin versión'}`);
  else if (!/^\d+\.\d+\.\d+$/.test(v)) problemas.push(`${nombre}: «${v}» no es semver`);
}

if (typeof api === 'string' && typeof web === 'string' && api !== web) {
  problemas.push(`apps/api (${api}) y apps/web (${web}) declaran versiones distintas`);
}

// Primera cabecera de versión del CHANGELOG: es la que la plataforma debería estar ejecutando.
let changelog = null;
try {
  const texto = readFileSync(join(raiz, 'CHANGELOG.md'), 'utf8');
  const m = /^##\s*\[(\d+\.\d+\.\d+)\]/m.exec(texto);
  if (!m) problemas.push('CHANGELOG.md no tiene ninguna cabecera «## [X.Y.Z]»');
  else changelog = m[1];

  // Una versión repetida significa que dos entregas distintas comparten número, como pasó con la
  // 0.34.0 en agosto de 2026: una en una rama fusionada y otra en una que se quedó por el camino.
  const todas = [...texto.matchAll(/^##\s*\[(\d+\.\d+\.\d+)\]/gm)].map((x) => x[1]);
  const repetidas = todas.filter((v, i) => todas.indexOf(v) !== i);
  if (repetidas.length > 0) {
    problemas.push(`versiones repetidas en el CHANGELOG: ${[...new Set(repetidas)].join(', ')}`);
  }
} catch (err) {
  problemas.push(`no se pudo leer CHANGELOG.md: ${err.message}`);
}

if (changelog && typeof api === 'string' && changelog !== api) {
  problemas.push(
    `la versión del paquete (${api}) no coincide con la primera del CHANGELOG (${changelog}).\n` +
      `      Añade una entrada «## [${api}] — ${new Date().toISOString().slice(0, 10)}» al CHANGELOG,\n` +
      `      o corrige la versión de los package.json. La pestaña Novedades y el asistente leen el\n` +
      `      CHANGELOG: si no lo actualizas, el equipo no verá este cambio.`,
  );
}

if (problemas.length > 0) {
  console.error('\n✖ Puerta de versión: no pasa\n');
  for (const p of problemas) console.error(`  · ${p}`);
  console.error('');
  process.exit(1);
}

console.log(`✔ Puerta de versión: ${api} coincide en api, web y CHANGELOG.`);

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(here, '../schema/signal.schema.json'), 'utf8'));
const example = JSON.parse(readFileSync(join(here, '../schema/example.signal.json'), 'utf8'));

test('signal schema is valid JSON with required top-level keys', () => {
  assert.equal(schema.title, 'Signal');
  for (const k of [
    'version',
    'symbol',
    'ts',
    'price',
    'votes',
    'net',
    'probs',
    'action',
    'confidence',
  ]) {
    assert.ok(schema.required.includes(k), `required debe incluir ${k}`);
  }
});

test('example conforms to required keys and enums', () => {
  for (const k of schema.required) assert.ok(k in example, `falta ${k} en el ejemplo`);
  assert.ok(['BUY', 'HOLD', 'SELL'].includes(example.action));
  assert.ok(example.net >= -1 && example.net <= 1);
  const sum = example.probs.BUY + example.probs.HOLD + example.probs.SELL;
  assert.ok(Math.abs(sum - 1) < 1e-9, 'probs deben sumar ~1');
});

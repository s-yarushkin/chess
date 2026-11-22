import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
test('white chess pieces have real white fill and a thin dark outline',()=>{
  const override=css.split('v0.8 — Make White visually white')[1];
  assert.ok(override,'contrast override is present');
  assert.match(override,/\.piece\.white\s*\{[^}]*-webkit-text-fill-color:#ffffff/);
  assert.match(override,/\.piece\.white\s*\{[^}]*-webkit-text-stroke:0\.65px/);
  assert.match(override,/\.piece\.black\s*\{[^}]*-webkit-text-fill-color:#102631/);
  assert.match(override,/\.team\.white\s*\{[^}]*background:#ffffff/);
});

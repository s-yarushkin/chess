import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
const widget=readFileSync(new URL('../public/viewport.js',import.meta.url),'utf8');
const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
test('narrow Telegram webviews use available width and scroll for short windows',()=>{
  const latest=css.split('v0.7 — Telegram Desktop narrow webview')[1];
  assert.ok(latest);
  assert.match(latest,/overflow-y:auto/);
  assert.match(latest,/width:min\(100%,510px\)/);
  assert.match(latest,/overflow-x:auto/);
  assert.doesNotMatch(latest,/100dvh\s*-\s*(?:382|350|300)px/);
});
test('fullscreen control loads and supports Telegram plus native fallback',()=>{
  assert.match(html,/src="\/viewport\.js"/);
  assert.match(widget,/addEventListener\('click'/);
  assert.match(widget,/telegram\.requestFullscreen\(\)/);
  assert.match(widget,/telegram\.expand\?\.\(\)/);
  assert.match(widget,/requestFullscreen/);
});

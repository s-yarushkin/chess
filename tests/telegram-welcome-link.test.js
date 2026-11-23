import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');

test('unauthenticated website welcome explicitly links to verified Telegram bot',()=>{
 const dialog=html.match(/<dialog id="auth"[\s\S]*?<\/dialog>/)?.[0];
 assert.ok(dialog,'authentication dialog exists');
 assert.match(dialog,/Добро пожаловать!/);
 assert.match(dialog,/<a[^>]*class="auth-bot-link"[^>]*href="https:\/\/t\.me\/Chess_by_Alex_bot"/);
 assert.match(dialog,/target="_blank" rel="noopener noreferrer"/);
 assert.match(dialog,/Открыть бота в Telegram/);
 assert.match(dialog,/В боте нажми «Играть в шахматы»/);
 assert.match(css,/#auth \.auth-bot-link/);
});

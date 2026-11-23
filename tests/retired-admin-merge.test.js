import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('retired one-off admin interface, usernames, scripts and API are absent',()=>{
 const html=read('public/index.html'),api=read('api/index.js'),css=read('public/style.css');
 for(const key of ['adminMerge','admin-merge.js','@SergeyYarushkin','@N_Yarushkina'])
   assert.ok(!html.includes(key),key);
 assert.doesNotMatch(api,/admin\/merge|startAdminMerge|confirmAdminMerge/);
 assert.doesNotMatch(css,/\.admin-merge/);
 assert.equal(existsSync(new URL('../public/admin-merge.js',import.meta.url)),false);
 assert.equal(existsSync(new URL('../src/admin-account-merge.js',import.meta.url)),false);
});
test('already linked Telegram identities and audit history remain intact',()=>{
 const db=read('src/cloud-db.js'),login=read('src/cloud-learning.js');
 assert.match(db,/CREATE TABLE IF NOT EXISTS linked_telegram_identities/);
 assert.match(db,/CREATE TABLE IF NOT EXISTS admin_account_merges/);
 assert.match(login,/SELECT u\.\* FROM linked_telegram_identities/);
 assert.match(login,/ensureActiveIdentity/);
});

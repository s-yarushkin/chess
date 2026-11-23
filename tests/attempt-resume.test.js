import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {getPool,initDb} from '../src/cloud-db.js';
import {findActiveAttempt,findAttempt,startAttempt,submitMove} from '../src/cloud-learning.js';
import {getPuzzle} from '../src/cloud-catalog.js';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('API provides a private resume endpoint and typed stale-attempt conflict',()=>{
 const api=read('api/index.js'),app=read('public/app.js');
 assert.match(api,/path==='\/api\/attempts\/active'/);
 assert.match(api,/findActiveAttempt\(user\)/);
 assert.match(api,/code:'ATTEMPT_STALE'/);
 assert.match(api,/409\)/);
 assert.match(app,/await resumePuzzle\(\)/);
 assert.match(app,/async function recoverStaleAttempt\(\)/);
 assert.match(app,/e\.code==='ATTEMPT_STALE'/);
 assert.doesNotMatch(app,/notice\(e\.message,'error'\).*finally\{state\.busy=false;board\(\)/);
});

test('Neon-style PostgreSQL: resuming does not skip; stale attempt does not double score',
 {skip:!process.env.DATABASE_URL}, async()=>{
  await initDb();
  const db=getPool();
  const userId=randomUUID();
  const telegramId='resume-test-'+userId;
  await db.query('INSERT INTO users(id,telegram_id,display_name,created_at) VALUES($1,$2,$3,$4)',
    [userId,telegramId,'Ученик',Date.now()]);
  try {
   const user=(await db.query('SELECT * FROM users WHERE id=$1',[userId])).rows[0];
   assert.equal(await findActiveAttempt(user),null);
   const first=await startAttempt(user,'category','mate1');
   const active=await findActiveAttempt(user);
   assert.equal(active.id,first.id);
   // Reload must reuse the same attempt: resuming is a read-only operation.
   const again=await findActiveAttempt(user);
   assert.equal(again.id,first.id);
   assert.equal(again.status,'active');

   const second=await startAttempt(user,'category','mate1');
   assert.equal((await findAttempt(user,first.id)).status,'skipped');
   assert.equal((await findActiveAttempt(user)).id,second.id);
   await assert.rejects(()=>submitMove(user,first.id,'a1a2'),/Attempt already completed/);

   const puzzle=getPuzzle(second.puzzle_id);
   const final=await submitMove(user,second.id,puzzle.line[0]);
   assert.equal(final.correct,true);
   assert.equal(final.completed,true);
   assert.equal((await findAttempt(user,second.id)).status,'solved');
   assert.equal(await findActiveAttempt(user),null);
   await assert.rejects(()=>submitMove(user,second.id,puzzle.line[0]),/Attempt already completed/);

   const completed=await db.query('SELECT COUNT(*)::int AS n FROM completions WHERE user_id=$1',[userId]);
   assert.equal(completed.rows[0].n,1);
   const profile=await db.query('SELECT solved_count FROM users WHERE id=$1',[userId]);
   assert.equal(profile.rows[0].solved_count,1);
   const outsider={...user,id:randomUUID()};
   assert.equal(await findActiveAttempt(outsider),null);
  } finally {
   await db.query('DELETE FROM users WHERE id=$1',[userId]);
  }
 });

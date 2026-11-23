import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {initDb,getPool} from '../src/cloud-db.js';
import {authenticateTelegram,currentUser} from '../src/cloud-learning.js';
import {verifyMergeActor,mergeCodeValid,startAdminMerge,previewAdminMerge,confirmAdminMerge} from '../src/admin-account-merge.js';

const TOKEN='123456:TESTONLYtoken1234567890';
function sign(id,username,name){
 const params=new URLSearchParams({
  auth_date:String(Math.floor(Date.now()/1000)),query_id:'AAE',
  user:JSON.stringify({id,first_name:name,username})});
 const data=[...params.entries()].sort((a,b)=>a[0].localeCompare(b[0],'en'))
  .map(([k,v])=>k+'='+v).join('\n');
 const key=createHmac('sha256','WebAppData').update(TOKEN).digest();
 params.set('hash',createHmac('sha256',key).update(data).digest('hex'));
 return params.toString();
}
test('only matching signed Telegram usernames can initiate and confirm merge',()=>{
 const u={telegram_id:'111'};
 const correct=sign(111,'SergeyYarushkin','Сергей');
 assert.equal(verifyMergeActor(correct,TOKEN,'sergeyyarushkin',u),'111');
 assert.throws(()=>verifyMergeActor(sign(111,'Imposter','Сергей'),TOKEN,'sergeyyarushkin',u),/недоступна/);
 assert.throws(()=>verifyMergeActor(sign(222,'SergeyYarushkin','Сергей'),TOKEN,'sergeyyarushkin',u),/недоступна/);
 assert.throws(()=>verifyMergeActor(correct,'bad-secret','sergeyyarushkin',u),/authentication/);
 assert.ok(mergeCodeValid('AB'.repeat(12)));
 assert.equal(mergeCodeValid('not-a-valid-code'),false);
});
test('one-off merger in PostgreSQL: approval from both identities, unique points and safe rollback', {skip:!process.env.DATABASE_URL},async()=>{
 const previous=process.env.TG_BOT_TOKEN;
 process.env.TG_BOT_TOKEN=TOKEN;
 await initDb();const db=getPool();
 const random=Math.floor(Math.random()*90000000)+1000000;
 const srcSigned=sign(510000000+random,'SergeyYarushkin','Сергей');
 const dstSigned=sign(620000000+random,'N_Yarushkina','Наталья');
 const x=await authenticateTelegram(srcSigned),y=await authenticateTelegram(dstSigned);
 const src=await currentUser(x.token),dst=await currentUser(y.token);
 const f=async sql=>(await db.query(sql,[src.id,dst.id])).rows;
 try{
  await db.query("UPDATE users SET display_name='Сергей',points=3,solved_count=2 WHERE id=$1",[src.id]);
  await db.query("UPDATE users SET display_name='Наталья',points=5,solved_count=2 WHERE id=$1",[dst.id]);
  const rows=[
   [src.id,'m-test-src-'+random,1],[src.id,'m-test-common-'+random,2],
   [dst.id,'m-test-common-'+random,3],[dst.id,'m-test-dst-'+random,2]
  ];
  for(const [id,puzzle,pts] of rows)
    await db.query("INSERT INTO completions(user_id,puzzle_id,category,points,solved_at) VALUES($1,$2,'mate1',$3,$4)",
      [id,puzzle,pts,Date.now()]);
  const aid=randomUUID();
  await db.query("INSERT INTO attempts(id,user_id,puzzle_id,current_fen,hints,errors,status,started_at,updated_at) VALUES($1,$2,$3,$4,0,0,'solved',$5,$5)",
    [aid,src.id,'m-test-src-'+random,'8/8/8/8/8/8/8/4K2k w - - 0 1',Date.now()]);
  await assert.rejects(startAdminMerge(dst,dstSigned),/недоступна/);
  const started=await startAdminMerge(src,srcSigned);
  assert.ok(mergeCodeValid(started.code));
  await assert.rejects(previewAdminMerge(src,srcSigned,started.code),/недоступна/);
  await assert.rejects(previewAdminMerge(dst,dstSigned,'F'.repeat(24)),/Код истёк/);
  // Block automatic migration when the source has relationships.
  const friendInviteId=randomUUID();
  await db.query('INSERT INTO friend_invites(id,owner_id,code_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
    [friendInviteId,src.id,'admin-merge-test-'+random,Date.now(),Date.now()+300000]);
  await assert.rejects(previewAdminMerge(dst,dstSigned,started.code),/друзья или лиги/);
  await db.query('DELETE FROM friend_invites WHERE id=$1',[friendInviteId]);
  const preview=await previewAdminMerge(dst,dstSigned,started.code);
  assert.deepEqual([preview.sourceSolved,preview.targetSolved,preview.combinedSolved],[2,2,3]);
  await assert.rejects(confirmAdminMerge(dst,dstSigned,started.code,false),/подтвердить/);
  const merged=await confirmAdminMerge(dst,dstSigned,started.code,true);
  assert.equal(merged.ok,true);
  assert.deepEqual([merged.solved,merged.points],[3,6]);
  // Both freshly signed Telegram identities now enter the destination account.
  const newSourceSession=await authenticateTelegram(srcSigned);
  const newTargetSession=await authenticateTelegram(dstSigned);
  assert.equal((await currentUser(newSourceSession.token)).id,dst.id);
  assert.equal((await currentUser(newTargetSession.token)).id,dst.id);
  assert.equal((await currentUser(x.token)).id,dst.id);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM attempts WHERE user_id=$1',[dst.id])).rows[0].n,1);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM completions WHERE user_id=$1',[src.id])).rows[0].n,2);
  assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM admin_account_merges WHERE source_user_id=$1',[src.id])).rows[0].n,1);
  await assert.rejects(confirmAdminMerge(dst,dstSigned,started.code,true),/Код истёк/);
  await assert.rejects(startAdminMerge(src,srcSigned),/уже выполнено/);
 }finally{
  // CI's disposable Postgres database only.
  await db.query('DELETE FROM admin_account_merges WHERE source_user_id=$1',[src.id]);
  await db.query('DELETE FROM admin_merge_requests WHERE source_user_id=$1',[src.id]);
  await db.query('DELETE FROM linked_telegram_identities WHERE telegram_id=$1',[src.telegram_id]);
  await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[[src.id,dst.id]]);
  if(previous===undefined)delete process.env.TG_BOT_TOKEN;
  else process.env.TG_BOT_TOKEN=previous;
 }
});

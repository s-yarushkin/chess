// One-time administration-only two-party account consolidation.
//
// Security: both Telegram identities are verified with signed Mini App initData,
// a short-lived random code is required, and only the exact pair of user names
// may participate. Telegram account names are NOT sufficient by themselves.
// Keep the original source profile and records for recovery (archived, never deleted).
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {tx} from './cloud-db.js';
import {verifyTelegram} from './cloud-learning.js';

export const ADMIN_MERGE_SOURCE='sergeyyarushkin';
export const ADMIN_MERGE_TARGET='n_yarushkina';
const LIFE=15*60*1000;
const CODE=/^[A-F0-9]{24}$/i;
const hashCode=code=>createHash('sha256').update('chess-admin-merge-v1:'+code.toUpperCase()).digest('hex');
const denied=()=>{throw Error('Операция объединения недоступна');};
const count=async(db,sql,args)=>Number((await db.query(sql,args)).rows[0]?.n??0);

export function verifyMergeActor(raw,token,expected,user){
  const signed=verifyTelegram(raw,token);
  let telegramUser;try{telegramUser=JSON.parse(new URLSearchParams(raw).get('user')||'null');}catch{denied();}
  const handle=typeof telegramUser?.username==='string'?telegramUser.username.toLowerCase():'';
  if(handle!==expected||signed.telegramId!==String(user.telegram_id))denied();
  return signed.telegramId;
}
export function mergeCodeValid(value){return typeof value==='string'&&CODE.test(value.trim());}
const sourceSocialCount=async(db,id)=>{
 const r=await db.query(
  `SELECT
     (SELECT COUNT(*) FROM friend_invites WHERE owner_id=$1) +
     (SELECT COUNT(*) FROM friend_requests WHERE requester_id=$1 OR recipient_id=$1) +
     (SELECT COUNT(*) FROM friendships WHERE user_a=$1 OR user_b=$1) +
     (SELECT COUNT(*) FROM leagues WHERE owner_id=$1) +
     (SELECT COUNT(*) FROM league_members WHERE user_id=$1) +
     (SELECT COUNT(*) FROM league_requests WHERE user_id=$1) AS n`,[id]);
 return Number(r.rows[0]?.n||0);
};
const mergedSummary=async(db,source,target)=>{
 const r=await db.query(
  `SELECT
    (SELECT COUNT(*)::int FROM completions WHERE user_id=$1) AS source_solved,
    (SELECT COUNT(*)::int FROM completions WHERE user_id=$2) AS target_solved,
    (SELECT COUNT(DISTINCT puzzle_id)::int FROM completions WHERE user_id IN ($1,$2)) AS combined_solved,
    (SELECT COUNT(*)::int FROM attempts WHERE user_id=$1) AS source_attempts`,[source.id,target.id]);
 return {sourceName:source.display_name,targetName:target.display_name,
  sourceSolved:r.rows[0].source_solved,targetSolved:r.rows[0].target_solved,
  combinedSolved:r.rows[0].combined_solved,sourceAttempts:r.rows[0].source_attempts};
};
const lockIdentity=async(db,id)=>{
 await db.query('SELECT pg_advisory_xact_lock(85731,hashtext($1))',[String(id)]);
};
const lockBoth=async(db,a,b)=>{
 for(const id of [String(a),String(b)].sort())await lockIdentity(db,id);
};

export async function startAdminMerge(user,raw,now=Date.now()){
 verifyMergeActor(raw,process.env.TG_BOT_TOKEN,ADMIN_MERGE_SOURCE,user);
 return tx(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(85731,987)');
  const source=(await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
  if(!source||source.telegram_id!==user.telegram_id)denied();
  if(await count(db,'SELECT COUNT(*)::int AS n FROM admin_account_merges',[ ])>0)throw Error('Разовое объединение уже выполнено');
  if((await db.query('SELECT 1 FROM linked_telegram_identities WHERE telegram_id=$1',[user.telegram_id])).rowCount)
   throw Error('Аккаунт уже объединён');
  const n=await count(db,'SELECT COUNT(*)::int AS n FROM admin_merge_requests WHERE source_user_id=$1 AND created_at>$2',
   [source.id,now-24*60*60*1000]);
  if(n>=3)throw Error('Сегодня уже создано достаточно кодов');
  await db.query("UPDATE admin_merge_requests SET status='cancelled' WHERE source_user_id=$1 AND status='pending'",[source.id]);
  const code=randomBytes(12).toString('hex').toUpperCase();
  await db.query(
   "INSERT INTO admin_merge_requests(id,source_user_id,code_hash,created_at,expires_at,status) VALUES($1,$2,$3,$4,$5,'pending')",
   [randomUUID(),source.id,hashCode(code),now,now+LIFE]);
  return {code,expiresAt:now+LIFE,sourceName:source.display_name,targetHandle:'@N_Yarushkina'};
 });
}
async function requestByCode(db,code,now,lock=false){
 if(!mergeCodeValid(code))throw Error('Неверный код объединения');
 const r=await db.query(
  "SELECT * FROM admin_merge_requests WHERE code_hash=$1 AND status='pending' AND expires_at>$2"+
  (lock?' FOR UPDATE':''),
  [hashCode(code.trim()),now]);
 if(!r.rowCount)throw Error('Код истёк или уже использован');
 return r.rows[0];
}
export async function previewAdminMerge(user,raw,code,now=Date.now()){
 verifyMergeActor(raw,process.env.TG_BOT_TOKEN,ADMIN_MERGE_TARGET,user);
 return tx(async db=>{
  const req=await requestByCode(db,code,now);
  const r=await db.query('SELECT * FROM users WHERE id IN ($1,$2)',[req.source_user_id,user.id]);
  const source=r.rows.find(u=>u.id===req.source_user_id),target=r.rows.find(u=>u.id===user.id);
  if(!source||!target||source.id===target.id)denied();
  if(await sourceSocialCount(db,source.id)>0)
   throw Error('В исходном профиле есть друзья или лиги: требуется отдельная проверка перед объединением');
  const result=await mergedSummary(db,source,target);
  return {...result,sourceHandle:'@SergeyYarushkin',targetHandle:'@N_Yarushkina',
   note:'Основной профиль — @N_Yarushkina. Повторные решения не принесут двойных очков. Из обоих Telegram-аккаунтов будет доступен один профиль.'};
 });
}
export async function confirmAdminMerge(user,raw,code,confirmed,now=Date.now()){
 if(confirmed!==true)throw Error('Нужно подтвердить объединение');
 verifyMergeActor(raw,process.env.TG_BOT_TOKEN,ADMIN_MERGE_TARGET,user);
 return tx(async db=>{
  await db.query('SELECT pg_advisory_xact_lock(85731,987)');
  const request=await requestByCode(db,code,now,true);
  const sourceId=request.source_user_id,targetId=user.id;
  if(sourceId===targetId)denied();
  // Acquire identity locks BEFORE user row locks to match the login lock order.
  const pre=(await db.query('SELECT id,telegram_id FROM users WHERE id=ANY($1::uuid[])',
    [[sourceId,targetId]])).rows;
  if(pre.length!==2)denied();
  await lockBoth(db,pre[0].telegram_id,pre[1].telegram_id);
  const actors=(await db.query(
    'SELECT * FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[[sourceId,targetId]])).rows;
  const source=actors.find(u=>u.id===sourceId),target=actors.find(u=>u.id===targetId);
  if(!source||!target||target.telegram_id!==user.telegram_id)denied();
  if(await count(db,'SELECT COUNT(*)::int AS n FROM admin_account_merges',[])>0)
   throw Error('Разовое объединение уже выполнено');
  if((await db.query('SELECT 1 FROM linked_telegram_identities WHERE telegram_id IN ($1,$2)',
      [source.telegram_id,target.telegram_id])).rowCount)denied();
  if(await sourceSocialCount(db,source.id)>0)
   throw Error('В исходном профиле есть друзья или лиги: требуется отдельная проверка перед объединением');
  const before=await mergedSummary(db,source,target);

  // The source user's rows are deliberately retained as a recovery snapshot.
  // Move only *copies* of its learning history to the target identity.
  await db.query(
    `INSERT INTO completions(user_id,puzzle_id,category,points,solved_at)
      SELECT $1,puzzle_id,category,points,solved_at FROM completions WHERE user_id=$2
      ON CONFLICT(user_id,puzzle_id) DO UPDATE
      SET points=GREATEST(completions.points,EXCLUDED.points),
          solved_at=LEAST(completions.solved_at,EXCLUDED.solved_at)`,[target.id,source.id]);
  await db.query(
    `INSERT INTO attempts(id,user_id,puzzle_id,current_fen,cursor,hints,errors,status,started_at,updated_at)
      SELECT gen_random_uuid(),$1,puzzle_id,current_fen,cursor,hints,errors,
             CASE WHEN status='active' THEN 'skipped' ELSE status END,
             started_at,updated_at FROM attempts WHERE user_id=$2`,[target.id,source.id]);

  // Recompute actual score instead of summing aggregate counters (overlapping
  // positions must count once).
  const totals=(await db.query(
    "SELECT COUNT(*)::int AS n,COALESCE(SUM(points),0)::int AS points FROM completions WHERE user_id=$1",
    [target.id])).rows[0];
  const skill=Number(target.solved_count)>=Number(source.solved_count)?target.skill_rating:source.skill_rating;
  await db.query(
    `UPDATE users SET display_name=$1,points=$2,solved_count=$3,skill_rating=$4,
       clean_streak=0,best_streak=GREATEST(best_streak,$5)
       WHERE id=$6`,
    [target.display_name||source.display_name,totals.points,totals.n,skill,source.best_streak,target.id]);

  // Existing sessions and future verified logins from both accounts use one
  // canonical player profile. Legacy source user remains for audit/rollback.
  await db.query('UPDATE sessions SET user_id=$1 WHERE user_id=$2',[target.id,source.id]);
  await db.query('INSERT INTO linked_telegram_identities(telegram_id,user_id,linked_at) VALUES($1,$2,$3)',
   [source.telegram_id,target.id,now]);
  await db.query(
   'INSERT INTO admin_account_merges(source_user_id,target_user_id,source_telegram_id,target_telegram_id,merged_at,summary) VALUES($1,$2,$3,$4,$5,$6::jsonb)',
   [source.id,target.id,source.telegram_id,target.telegram_id,now,JSON.stringify({...before,afterSolved:totals.n,afterPoints:totals.points})]);
  await db.query("UPDATE admin_merge_requests SET status='used',used_at=$1 WHERE id=$2",[now,request.id]);

  return {ok:true,displayName:target.display_name||source.display_name,
   solved:totals.n,points:totals.points,
   message:'Готово: оба Telegram-аккаунта подключены к общему шахматному профилю.'};
 });
}

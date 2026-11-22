// Private friend circles backed by Neon. No public search, chat or contact sharing.
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {getPool,tx} from './cloud-db.js';
const DAY=86_400_000,EXPIRY=48*60*60*1000,MAX_FRIENDS=20;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE=/^[a-f0-9]{24}$/i;
export const inviteDigest=code=>createHash('sha256').update('chess-invite-v1:'+String(code).trim().toUpperCase()).digest('hex');
export const friendPair=(a,b)=>[a,b].sort();
export const validInviteCode=code=>typeof code==='string'&&CODE.test(code.trim());
const count=async(db,sql,args)=>Number((await db.query(sql,args)).rows[0]?.n??0);
const requireSharing=u=>{if(!u?.friends_opt_in||!u?.display_name)throw Error('Сначала включи обмен прогрессом в профиле');};
const countFriends=(db,id)=>count(db,'SELECT COUNT(*)::int AS n FROM friendships WHERE user_a=$1 OR user_b=$1',[id]);

export async function createInvite(user,now=Date.now()){
 return tx(async db=>{
  const u=(await db.query('SELECT id,display_name,friends_opt_in FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
  requireSharing(u);
  if(await countFriends(db,u.id)>=MAX_FRIENDS)throw Error('Список друзей заполнен');
  if(await count(db,'SELECT COUNT(*)::int AS n FROM friend_invites WHERE owner_id=$1 AND created_at>$2',[u.id,now-DAY])>=4)throw Error('Сегодня уже создано достаточно приглашений');
  const code=randomBytes(12).toString('hex').toUpperCase();
  await db.query('INSERT INTO friend_invites(id,owner_id,code_hash,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',
   [randomUUID(),u.id,inviteDigest(code),now,now+EXPIRY]);
  return {code,expiresAt:now+EXPIRY};
 });
}
export async function requestFriend(user,code,now=Date.now()){
 if(!validInviteCode(code))throw Error('Неверный код приглашения');
 return tx(async db=>{
  const u=(await db.query('SELECT id,display_name,friends_opt_in FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
  requireSharing(u);
  if(await countFriends(db,user.id)>=MAX_FRIENDS)throw Error('Список друзей заполнен');
  if(await count(db,'SELECT COUNT(*)::int AS n FROM friend_requests WHERE requester_id=$1 AND created_at>$2',[user.id,now-DAY])>=6)throw Error('Сегодня отправлено достаточно запросов');
  // One-time code: row lock serializes simultaneous claims.
  const invite=(await db.query(`SELECT i.*,u.friends_opt_in AS owner_opt_in,u.display_name AS owner_name
    FROM friend_invites i JOIN users u ON u.id=i.owner_id
    WHERE i.code_hash=$1 AND i.used_at IS NULL AND i.expires_at>$2 FOR UPDATE OF i`,
    [inviteDigest(code),now])).rows[0];
  if(!invite||invite.owner_id===user.id||!invite.owner_opt_in||!invite.owner_name)throw Error('Приглашение недействительно или уже использовано');
  if(await countFriends(db,invite.owner_id)>=MAX_FRIENDS)throw Error('Список друзей заполнен');
  const [a,b]=friendPair(user.id,invite.owner_id);
  if((await db.query('SELECT 1 FROM friendships WHERE user_a=$1 AND user_b=$2',[a,b])).rowCount)throw Error('Вы уже друзья');
  if((await db.query(`SELECT 1 FROM friend_requests WHERE status='pending'
    AND ((requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1))`,
    [user.id,invite.owner_id])).rowCount)throw Error('Запрос на дружбу уже отправлен');
  await db.query(`INSERT INTO friend_requests(id,requester_id,recipient_id,status,created_at)
    VALUES($1,$2,$3,'pending',$4)`,[randomUUID(),user.id,invite.owner_id,now]);
  await db.query('UPDATE friend_invites SET used_at=$1 WHERE id=$2',[now,invite.id]);
  return {ok:true,message:'Запрос отправлен. Друг должен подтвердить.'};
 });
}
export async function respondFriend(user,id,accept,now=Date.now()){
 if(typeof id!=='string'||!UUID.test(id))throw Error('Неверный запрос');
 return tx(async db=>{
  const req=(await db.query(`SELECT * FROM friend_requests WHERE id=$1 AND recipient_id=$2
    AND status='pending' FOR UPDATE`,[id,user.id])).rows[0];
  if(!req)throw Error('Запрос уже обработан или не найден');
  if(accept){
   const profiles=(await db.query('SELECT id,display_name,friends_opt_in FROM users WHERE id=ANY($1::uuid[]) FOR UPDATE',[[user.id,req.requester_id]])).rows;
   if(profiles.length!==2)throw Error('Аккаунт друга недоступен');
   for(const p of profiles)requireSharing(p);
   for(const id of [user.id,req.requester_id])if(await countFriends(db,id)>=MAX_FRIENDS)throw Error('Список друзей заполнен');
   const [a,b]=friendPair(user.id,req.requester_id);
   await db.query('INSERT INTO friendships(user_a,user_b,created_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[a,b,now]);
  }
  await db.query('UPDATE friend_requests SET status=$1,responded_at=$2 WHERE id=$3',[accept?'accepted':'rejected',now,id]);
  return {ok:true};
 });
}
export async function removeFriend(user,otherId){
 if(typeof otherId!=='string'||!UUID.test(otherId))throw Error('Неверный друг');
 const [a,b]=friendPair(user.id,otherId);
 const r=await getPool().query('DELETE FROM friendships WHERE user_a=$1 AND user_b=$2',[a,b]);
 return {removed:r.rowCount>0};
}
export async function friendsSnapshot(user,now=Date.now()){
 if(!user.friends_opt_in)return {enabled:false,friends:[],incoming:[],outgoing:[],privacy:'Обмен выключен. Друзья не видят твой прогресс.'};
 const since=now-7*DAY,db=getPool();
 const friends=await db.query(`SELECT u.id,u.display_name AS name,
   (SELECT COUNT(*)::int FROM completions c WHERE c.user_id=u.id AND c.solved_at>=$1) AS "weeklySolved",
   (SELECT COALESCE(SUM(c.points),0)::int FROM completions c WHERE c.user_id=u.id AND c.solved_at>=$1) AS "weeklyPoints",
   u.solved_count AS "solvedTotal"
   FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_a=$2 THEN f.user_b ELSE f.user_a END
   WHERE (f.user_a=$2 OR f.user_b=$2) AND u.friends_opt_in=TRUE AND length(u.display_name)>=2
   ORDER BY u.display_name LIMIT 20`,[since,user.id]);
 const incoming=await db.query(`SELECT r.id,u.display_name AS name FROM friend_requests r JOIN users u ON u.id=r.requester_id
   WHERE r.recipient_id=$1 AND r.status='pending' AND u.friends_opt_in=TRUE
   ORDER BY r.created_at DESC LIMIT 20`,[user.id]);
 const outgoing=await db.query(`SELECT u.display_name AS name FROM friend_requests r JOIN users u ON u.id=r.recipient_id
   WHERE r.requester_id=$1 AND r.status='pending' AND u.friends_opt_in=TRUE
   ORDER BY r.created_at DESC LIMIT 20`,[user.id]);
 return {enabled:true,friends:friends.rows,incoming:incoming.rows,outgoing:outgoing.rows,
   privacy:'Прогресс доступен только подтверждённым друзьям. Отключить можно в профиле.'};
}

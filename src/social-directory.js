// Pseudonymous directory with a hide option. Never expose Telegram IDs,
// contact information, other players' scores or private profile settings.
import {randomUUID} from 'node:crypto';
import {getPool,tx} from './cloud-db.js';
import {friendPair} from './cloud-friends.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY=86_400_000;
const count=async(db,sql,args)=>Number((await db.query(sql,args)).rows[0]?.n||0);
export function pageIndex(value){
 const n=Number(value??0);
 if(!Number.isInteger(n)||n<0||n>20)throw Error('Неверная страница');
 return n;
}
export async function playerDirectory(user,{page=0,q=''}={}){
 if(!user?.id||!user.display_name)throw Error('Сначала укажи никнейм');
 const p=pageIndex(page);
 if(typeof q!=='string'||q.length>24)throw Error('Неверный поиск');
 const search=q.trim().toLocaleLowerCase('ru-RU');
 const db=getPool();
 const rows=await db.query(
  `SELECT u.id,u.display_name AS name,
    EXISTS(SELECT 1 FROM friendships f WHERE
      (f.user_a=$1 AND f.user_b=u.id) OR (f.user_b=$1 AND f.user_a=u.id)) AS "isFriend",
    EXISTS(SELECT 1 FROM friend_requests r WHERE r.requester_id=$1
      AND r.recipient_id=u.id AND r.status='pending') AS "requestSent",
    EXISTS(SELECT 1 FROM friend_requests r WHERE r.requester_id=u.id
      AND r.recipient_id=$1 AND r.status='pending') AS "requestReceived"
    FROM users u
    WHERE u.id<>$1 AND u.directory_visible=TRUE
      AND u.nickname_key IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM admin_account_merges a WHERE a.source_user_id=u.id)
      AND ($2='' OR POSITION($2 IN u.nickname_key)>0)
    ORDER BY u.nickname_key,u.id
    LIMIT 31 OFFSET $3`,[user.id,search,p*30]);
 const hasMore=rows.rows.length>30;
 return {players:rows.rows.slice(0,30),page:p,hasMore,privacy:'Каталог содержит никнеймы игроков, не скрывших себя. Прогресс доступен только с разрешения.'};
}
export async function requestFriendById(user,otherId,now=Date.now()){
 if(typeof otherId!=='string'||!UUID.test(otherId)||otherId===user.id)throw Error('Неверный игрок');
 return tx(async db=>{
  const pair=friendPair(user.id,otherId);
  await db.query('SELECT pg_advisory_xact_lock(73521,hashtext($1))',[pair.join(':')]);
  const participants=(await db.query('SELECT id,display_name,friends_opt_in,directory_visible,nickname_key FROM users WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE',[pair])).rows;
  const me=participants.find(u=>u.id===user.id),target=participants.find(u=>u.id===otherId);
  if(!me?.display_name)throw Error('Укажи никнейм в профиле');
  if(!target?.directory_visible||!target.nickname_key)throw Error('Игрок больше не доступен в каталоге');
  if(await count(db,'SELECT COUNT(*)::int AS n FROM friendships WHERE user_a=$1 OR user_b=$1',[me.id])>=20)
    throw Error('Список друзей заполнен');
  if(await count(db,'SELECT COUNT(*)::int AS n FROM friendships WHERE user_a=$1 OR user_b=$1',[otherId])>=20)
    throw Error('Список друзей заполнен');
  if((await db.query('SELECT 1 FROM friendships WHERE user_a=$1 AND user_b=$2',pair)).rowCount)
    throw Error('Вы уже друзья');
  const pending=await db.query(
    `SELECT 1 FROM friend_requests WHERE status='pending' AND
       ((requester_id=$1 AND recipient_id=$2) OR (requester_id=$2 AND recipient_id=$1))`,
    [user.id,otherId]);
  if(pending.rowCount)throw Error('Запрос на дружбу уже отправлен');
  // A declined request cannot immediately be repeated: prevents pestering kids.
  const declined=await db.query(
    `SELECT 1 FROM friend_requests WHERE requester_id=$1 AND recipient_id=$2
      AND status='rejected' AND responded_at>$3 LIMIT 1`,[user.id,otherId,now-7*DAY]);
  if(declined.rowCount)throw Error('Повторный запрос можно отправить через неделю');
  if(await count(db,'SELECT COUNT(*)::int AS n FROM friend_requests WHERE requester_id=$1 AND created_at>$2',
    [user.id,now-DAY])>=6)throw Error('Лимит запросов в друзья на сегодня исчерпан');
  await db.query(
    "INSERT INTO friend_requests(id,requester_id,recipient_id,status,created_at) VALUES($1,$2,$3,'pending',$4)",
    [randomUUID(),user.id,otherId,now]);
  return {ok:true,message:'Запрос отправлен! Друг сможет принять или отклонить его в разделе «Друзья».'};
 });
}

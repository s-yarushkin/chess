// Owner-initiated invitations: recipients must explicitly accept before
// joining or sharing league scores. No messages, public contact graph or chat.
import {randomUUID} from 'node:crypto';
import {getPool,tx} from './cloud-db.js';
import {LEAGUE_MEMBER_LIMIT,LEAGUE_MAX_JOINED,LEAGUE_UUID} from './league-utils.js';
const DAY=86_400_000;
const valid=id=>typeof id==='string'&&LEAGUE_UUID.test(id);
const count=async(db,sql,args)=>Number((await db.query(sql,args)).rows[0]?.n||0);

export async function invitePlayersToLeague(owner,leagueId,userIds,now=Date.now()){
 if(!valid(leagueId)||!Array.isArray(userIds)||userIds.length<1||userIds.length>10||
   userIds.some(id=>!valid(id))||new Set(userIds).size!==userIds.length)
   throw Error('Выбери от 1 до 10 разных участников');
 return tx(async db=>{
  const league=(await db.query('SELECT * FROM leagues WHERE id=$1 FOR UPDATE',[leagueId])).rows[0];
  if(!league||!league.active||league.owner_id!==owner.id)throw Error('Приглашать может только создатель лиги');
  const self=(await db.query('SELECT friends_opt_in,display_name FROM users WHERE id=$1',[owner.id])).rows[0];
  if(!self?.friends_opt_in||!self.display_name)throw Error('Включи обмен прогрессом в профиле');
  const current=await count(db,
    'SELECT COUNT(*)::int AS n FROM league_direct_invitations d JOIN leagues l ON l.id=d.league_id WHERE l.owner_id=$1 AND d.created_at>$2',
    [owner.id,now-DAY]);
  if(current+userIds.length>10)throw Error('Можно пригласить не больше 10 игроков за сутки');
  const members=await count(db,'SELECT COUNT(*)::int AS n FROM league_members WHERE league_id=$1',[leagueId]);
  if(members>=LEAGUE_MEMBER_LIMIT)throw Error('Лига уже заполнена');
  const candidates=(await db.query(
    `SELECT id,display_name,nickname_key,directory_visible,friends_opt_in FROM users
     WHERE id=ANY($1::uuid[]) FOR UPDATE`,[userIds])).rows;
  if(candidates.length!==userIds.length||candidates.some(u=>u.id===owner.id||
    !u.directory_visible||!u.friends_opt_in||!u.nickname_key))
    throw Error('Некоторые игроки недоступны для приглашения');
  let sent=0,already=0;
  for(const id of userIds){
    if((await db.query('SELECT 1 FROM league_members WHERE league_id=$1 AND user_id=$2',
      [leagueId,id])).rowCount){already++;continue;}
    const prior=(await db.query('SELECT * FROM league_direct_invitations WHERE league_id=$1 AND user_id=$2 FOR UPDATE',
      [leagueId,id])).rows[0];
    if(prior?.status==='pending'){already++;continue;}
    if(prior?.status==='declined'&&prior.responded_at>now-7*DAY)
      throw Error('Игрок недавно отклонил приглашение. Повторить можно через неделю');
    await db.query(
      `INSERT INTO league_direct_invitations(id,league_id,user_id,status,created_at)
       VALUES($1,$2,$3,'pending',$4)
       ON CONFLICT(league_id,user_id) DO UPDATE SET
       status='pending',created_at=EXCLUDED.created_at,responded_at=NULL`,
      [randomUUID(),leagueId,id,now]);sent++;
  }
  return {ok:true,sent,already,message:sent?'Приглашения появятся у игроков в разделе «Лиги».':'Все выбранные игроки уже приглашены или участвуют.'};
 });
}
export async function leagueInvitationInbox(user){
 if(!user.friends_opt_in)return {enabled:false,invitations:[]};
 const data=await getPool().query(
  `SELECT d.id,d.league_id AS "leagueId",l.name AS "leagueName",u.display_name AS "ownerName"
   FROM league_direct_invitations d JOIN leagues l ON l.id=d.league_id
   JOIN users u ON u.id=l.owner_id
   WHERE d.user_id=$1 AND d.status='pending' AND l.active=TRUE
   ORDER BY d.created_at DESC LIMIT 20`,[user.id]);
 return {enabled:true,invitations:data.rows};
}
export async function respondLeagueInvitation(user,invitationId,accept,now=Date.now()){
 if(!valid(invitationId)||typeof accept!=='boolean')throw Error('Неверное приглашение');
 return tx(async db=>{
  // Read league id first, then lock the league to serialize with owner invitations.
  const ref=(await db.query('SELECT league_id FROM league_direct_invitations WHERE id=$1 AND user_id=$2',
    [invitationId,user.id])).rows[0];
  if(!ref)throw Error('Приглашение не найдено');
  const l=(await db.query('SELECT id,active FROM leagues WHERE id=$1 FOR UPDATE',[ref.league_id])).rows[0];
  const invite=(await db.query(
    "SELECT * FROM league_direct_invitations WHERE id=$1 AND user_id=$2 AND status='pending' FOR UPDATE",
    [invitationId,user.id])).rows[0];
  if(!l?.active||!invite)throw Error('Приглашение больше недействительно');
  if(accept){
    const profile=(await db.query('SELECT id,display_name,friends_opt_in FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
    if(!profile?.display_name||!profile.friends_opt_in)throw Error('Для лиги включи обмен прогрессом в профиле');
    const memberCount=await count(db,'SELECT COUNT(*)::int AS n FROM league_members WHERE league_id=$1',[l.id]);
    if(memberCount>=LEAGUE_MEMBER_LIMIT)throw Error('Лига уже заполнена');
    const leagueCount=await count(db,
      'SELECT COUNT(*)::int AS n FROM league_members lm JOIN leagues l ON l.id=lm.league_id WHERE lm.user_id=$1 AND l.active=TRUE',
      [user.id]);
    if(leagueCount>=LEAGUE_MAX_JOINED)throw Error('Можно участвовать максимум в трёх лигах');
    await db.query(
      `INSERT INTO league_members(league_id,user_id,role,joined_at)
       VALUES($1,$2,'member',$3) ON CONFLICT DO NOTHING`,[l.id,user.id,now]);
  }
  await db.query('UPDATE league_direct_invitations SET status=$1,responded_at=$2 WHERE id=$3',
    [accept?'accepted':'declined',now,invitationId]);
  return {ok:true,joined:accept};
 });
}
export async function socialPendingCounts(user){
 if(!user?.friends_opt_in)return {friends:0,leagues:0};
 const r=await getPool().query(
 `SELECT
   (SELECT COUNT(*)::int FROM friend_requests r WHERE r.recipient_id=$1 AND r.status='pending') AS friends,
   (SELECT COUNT(*)::int FROM league_direct_invitations d JOIN leagues l ON l.id=d.league_id
     WHERE d.user_id=$1 AND d.status='pending' AND l.active=TRUE) AS leagues`,[user.id]);
 return r.rows[0];
}

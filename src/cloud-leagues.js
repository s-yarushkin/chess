// Private weekly leagues for verified Telegram accounts.
// Admission requires a shareable code AND approval by the league owner.
// No public search, contacts, school data, chats, activity times or open ranking.
import {randomUUID,randomBytes} from 'node:crypto';
import {getPool,tx} from './cloud-db.js';
import {LEAGUE_WEEKLY_LIMIT,LEAGUE_MEMBER_LIMIT,LEAGUE_MAX_JOINED,LEAGUE_INVITE_DURATION,LEAGUE_UUID,normalizeLeagueName,isLeagueCode,leagueCodeHash} from './league-utils.js';
const DAY=86400_000;
const nowMs=()=>Date.now();
const numeric=async(db,sql,args)=>Number((await db.query(sql,args)).rows[0]?.n||0);
const requireEnabled=user=>{
  if(!user?.display_name)throw Error('Для лиги укажи никнейм в профиле');
};
const requireUuid=id=>{if(typeof id!=='string'||!LEAGUE_UUID.test(id))throw Error('Неверный идентификатор лиги');return id;};
const leagueCount=(db,userId)=>numeric(db,
  'SELECT COUNT(*)::int AS n FROM league_members lm JOIN leagues l ON l.id=lm.league_id WHERE lm.user_id=$1 AND l.active=TRUE',[userId]);
const memberCount=(db,id)=>numeric(db,'SELECT COUNT(*)::int AS n FROM league_members WHERE league_id=$1',[id]);

export async function createLeague(user,input,now=nowMs()){
  const name=normalizeLeagueName(input);
  return tx(async db=>{
    const owner=(await db.query('SELECT id,display_name,friends_opt_in FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
    requireEnabled(owner);
    if(await leagueCount(db,user.id)>=LEAGUE_MAX_JOINED)throw Error('Можно участвовать максимум в трёх лигах');
    if(await numeric(db,'SELECT COUNT(*)::int AS n FROM leagues WHERE owner_id=$1 AND active=TRUE',[user.id])>=2)throw Error('Можно создать не больше двух лиг');
    const id=randomUUID();
    await db.query('INSERT INTO leagues(id,name,owner_id,created_at) VALUES($1,$2,$3,$4)',[id,name,user.id,now]);
    await db.query("INSERT INTO league_members(league_id,user_id,role,joined_at) VALUES($1,$2,'owner',$3)",[id,user.id,now]);
    return {id,name,isOwner:true};
  });
}
export async function listLeagues(user){
  if(!user?.display_name)return {enabled:false,leagues:[]};
  const r=await getPool().query(
    'SELECT l.id,l.name,l.owner_id=$1 AS "isOwner",COUNT(m2.user_id)::int AS "memberCount" '+
    'FROM league_members mine JOIN leagues l ON l.id=mine.league_id '+
    'JOIN league_members m2 ON m2.league_id=l.id '+
    'WHERE mine.user_id=$1 AND l.active=TRUE GROUP BY l.id,l.name,l.owner_id,l.created_at ORDER BY l.created_at DESC LIMIT 3',[user.id]);
  return {enabled:true,leagues:r.rows};
}
export async function leagueDetails(user,id,now=nowMs()){
  requireUuid(id);requireEnabled(user);
  const db=getPool();
  const r=await db.query('SELECT l.id,l.name,l.owner_id,m.role FROM leagues l '+
    'JOIN league_members m ON m.league_id=l.id WHERE l.id=$1 AND m.user_id=$2 AND l.active=TRUE',[id,user.id]);
  if(!r.rowCount)throw Error('Лига недоступна');
  const l=r.rows[0],since=now-7*DAY;
  const members=await db.query(
    'SELECT u.id,u.display_name AS name, '+
    'CASE WHEN $3 AND u.friends_opt_in THEN COALESCE(scores.n,0)::int END AS "weeklySolved",CASE WHEN $3 AND u.friends_opt_in THEN COALESCE(scores.points,0)::int END AS "weeklyPoints" '+
    'FROM league_members lm JOIN users u ON u.id=lm.user_id '+
    'LEFT JOIN LATERAL (SELECT COUNT(*)::int AS n,COALESCE(SUM(s.points),0)::int AS points FROM '+
    '(SELECT points FROM completions WHERE user_id=u.id AND solved_at>=$2 ORDER BY solved_at ASC,puzzle_id ASC LIMIT 8) s) scores ON TRUE '+
    'WHERE lm.league_id=$1 AND length(u.display_name)>=2 '+
    'ORDER BY "weeklyPoints" DESC NULLS LAST,"weeklySolved" DESC NULLS LAST,u.display_name ASC LIMIT 20',[id,since,!!user.friends_opt_in]);
  let requests=[];
  if(l.owner_id===user.id){
    const rr=await db.query('SELECT r.id,u.display_name AS name FROM league_requests r '+
      'JOIN users u ON u.id=r.user_id WHERE r.league_id=$1 AND r.status=$2 '+
      'AND length(u.display_name)>=2 ORDER BY r.created_at ASC LIMIT 20',[id,'pending']);
    requests=rr.rows;
  }
  return {id:l.id,name:l.name,isOwner:l.owner_id===user.id,
    memberCount:await memberCount(db,id),memberLimit:LEAGUE_MEMBER_LIMIT,
    weeklyLimit:LEAGUE_WEEKLY_LIMIT,members:members.rows,requests};
}
export async function inviteToLeague(user,id,now=nowMs()){
  requireUuid(id);
  return tx(async db=>{
    const l=(await db.query('SELECT id,owner_id,active FROM leagues WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(!l||!l.active||l.owner_id!==user.id)throw Error('Только создатель лиги может приглашать');
    const owner=(await db.query('SELECT display_name,friends_opt_in FROM users WHERE id=$1',[user.id])).rows[0];
    requireEnabled(owner);
    if(await numeric(db,'SELECT COUNT(*)::int AS n FROM league_invites WHERE league_id=$1 AND created_at>=$2',[id,now-DAY])>=4)
      throw Error('Сегодня уже создано достаточно приглашений');
    const code=randomBytes(12).toString('hex').toUpperCase(),expiresAt=now+LEAGUE_INVITE_DURATION;
    await db.query('INSERT INTO league_invites(id,league_id,code_hash,created_at,expires_at,max_uses) VALUES($1,$2,$3,$4,$5,$6)',
      [randomUUID(),id,leagueCodeHash(code),now,expiresAt,LEAGUE_MEMBER_LIMIT]);
    return {code,expiresAt,message:'Передай код знакомым. Они отправят заявку, которую ты сможешь одобрить.'};
  });
}
export async function requestLeague(user,code,now=nowMs()){
  if(!isLeagueCode(code))throw Error('Неверный код лиги');
  return tx(async db=>{
    const member=(await db.query('SELECT id,display_name,friends_opt_in FROM users WHERE id=$1 FOR UPDATE',[user.id])).rows[0];
    requireEnabled(member);
    if(await leagueCount(db,user.id)>=LEAGUE_MAX_JOINED)throw Error('Можно участвовать максимум в трёх лигах');
    const invited=(await db.query('SELECT i.id,i.league_id,i.uses,i.max_uses,l.name,l.owner_id,l.active '+
      'FROM league_invites i JOIN leagues l ON l.id=i.league_id '+
      'WHERE i.code_hash=$1 AND i.expires_at>$2 AND i.uses<i.max_uses FOR UPDATE OF i',
      [leagueCodeHash(code),now])).rows[0];
    if(!invited||!invited.active)throw Error('Приглашение в лигу недействительно');
    if(invited.owner_id===user.id)throw Error('Ты уже создатель этой лиги');
    if((await db.query('SELECT 1 FROM league_members WHERE league_id=$1 AND user_id=$2',
      [invited.league_id,user.id])).rowCount)throw Error('Ты уже состоишь в этой лиге');
    const old=(await db.query('SELECT status FROM league_requests WHERE league_id=$1 AND user_id=$2',
      [invited.league_id,user.id])).rows[0];
    if(old?.status==='pending')throw Error('Заявка уже ожидает одобрения');
    if(await numeric(db,'SELECT COUNT(*)::int AS n FROM league_requests WHERE user_id=$1 AND created_at>=$2',[user.id,now-DAY])>=6)
      throw Error('Сегодня уже отправлено достаточно заявок');
    if(await memberCount(db,invited.league_id)>=LEAGUE_MEMBER_LIMIT)throw Error('Лига уже заполнена');
    const id=randomUUID();
    await db.query("INSERT INTO league_requests(id,league_id,user_id,status,created_at) VALUES($1,$2,$3,'pending',$4) "+
      "ON CONFLICT (league_id,user_id) DO UPDATE SET status='pending',created_at=EXCLUDED.created_at,decided_at=NULL",
      [id,invited.league_id,user.id,now]);
    await db.query('UPDATE league_invites SET uses=uses+1 WHERE id=$1',[invited.id]);
    return {ok:true,leagueName:invited.name,message:'Заявка отправлена создателю лиги'};
  });
}
export async function decideLeagueRequest(user,leagueId,requestId,accept,now=nowMs()){
  requireUuid(leagueId);requireUuid(requestId);
  return tx(async db=>{
    const l=(await db.query('SELECT id,owner_id,active FROM leagues WHERE id=$1 FOR UPDATE',[leagueId])).rows[0];
    if(!l||!l.active||l.owner_id!==user.id)throw Error('Заявки может обрабатывать только создатель');
    const req=(await db.query('SELECT id,user_id FROM league_requests WHERE id=$1 AND league_id=$2 AND status=$3 FOR UPDATE',
      [requestId,leagueId,'pending'])).rows[0];
    if(!req)throw Error('Заявка уже обработана');
    if(accept){
      const u=(await db.query('SELECT id,display_name,friends_opt_in FROM users WHERE id=$1',[req.user_id])).rows[0];
      requireEnabled(u);
      if(await memberCount(db,leagueId)>=LEAGUE_MEMBER_LIMIT)throw Error('Лига уже заполнена');
      if(await leagueCount(db,req.user_id)>=LEAGUE_MAX_JOINED)throw Error('У игрока уже три лиги');
      await db.query("INSERT INTO league_members(league_id,user_id,role,joined_at) VALUES($1,$2,'member',$3) ON CONFLICT DO NOTHING",
        [leagueId,req.user_id,now]);
    }
    await db.query('UPDATE league_requests SET status=$1,decided_at=$2 WHERE id=$3',[accept?'approved':'rejected',now,requestId]);
    return {ok:true};
  });
}
export async function leaveOrRemoveLeagueMember(user,leagueId,memberId){
  requireUuid(leagueId);requireUuid(memberId);
  return tx(async db=>{
    const l=(await db.query('SELECT id,owner_id,active FROM leagues WHERE id=$1 FOR UPDATE',[leagueId])).rows[0];
    if(!l||!l.active)throw Error('Лига недоступна');
    if(user.id!==memberId&&user.id!==l.owner_id)throw Error('Удалять игроков может только создатель');
    if(memberId===l.owner_id)throw Error('Создатель может закрыть лигу целиком');
    const result=await db.query('DELETE FROM league_members WHERE league_id=$1 AND user_id=$2',[leagueId,memberId]);
    return {removed:result.rowCount>0};
  });
}
export async function closeLeague(user,id){
  requireUuid(id);
  const result=await getPool().query('DELETE FROM leagues WHERE id=$1 AND owner_id=$2',[id,user.id]);
  if(!result.rowCount)throw Error('Закрыть лигу может только создатель');
  return {closed:true};
}

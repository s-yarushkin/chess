import {randomBytes,createHash,randomUUID} from 'node:crypto';
import {transaction} from './db.js';

const EXPIRY_MS=48*3600_000, MAX_FRIENDS=20;
const digest=code=>createHash('sha256').update('chess-invite-v1:'+String(code).trim().toUpperCase()).digest('hex');
const countFriends=(db,id)=>db.prepare('SELECT COUNT(*) AS n FROM friendships WHERE user_a=? OR user_b=?').get(id,id).n;
const requireOptIn=(user)=>{if(!user.friends_opt_in||!user.display_name)throw Error('Friends sharing is disabled');};
const pair=(a,b)=>[a,b].sort();
export function createInvite(db,user,now=Date.now()){
  requireOptIn(user);
  if(countFriends(db,user.id)>=MAX_FRIENDS)throw Error('Friend limit reached');
  return transaction(db,()=>{
    const recent=db.prepare('SELECT COUNT(*) AS n FROM friend_invites WHERE owner_id=? AND created_at>?').get(user.id,now-86400_000).n;
    if(recent>=4)throw Error('Too many invitations today');
    const code=randomBytes(12).toString('hex').toUpperCase();
    db.prepare('INSERT INTO friend_invites(id,owner_id,code_hash,created_at,expires_at) VALUES(?,?,?,?,?)').run(randomUUID(),user.id,digest(code),now,now+EXPIRY_MS);
    return {code,expiresAt:now+EXPIRY_MS,message:'Передай код лично другу с разрешения взрослого. Он действует один раз в течение двух дней.'};
  });
}
export function requestFriend(db,user,code,now=Date.now()){
  requireOptIn(user);
  if(typeof code!=='string'||!/^[A-Fa-f0-9]{24}$/.test(code.trim()))throw Error('Invalid invitation code');
  return transaction(db,()=>{
    if(countFriends(db,user.id)>=MAX_FRIENDS)throw Error('Friend limit reached');
    const recent=db.prepare('SELECT COUNT(*) AS n FROM friend_requests WHERE requester_id=? AND created_at>?').get(user.id,now-86400_000).n;
    if(recent>=6)throw Error('Too many requests today');
    const invite=db.prepare(`SELECT i.* FROM friend_invites i JOIN users u ON u.id=i.owner_id
      WHERE i.code_hash=? AND i.used_at IS NULL AND i.expires_at>? AND u.friends_opt_in=1`).get(digest(code),now);
    if(!invite||invite.owner_id===user.id)throw Error('Invitation not available');
    const [a,b]=pair(invite.owner_id,user.id);
    if(db.prepare('SELECT 1 FROM friendships WHERE user_a=? AND user_b=?').get(a,b))throw Error('Already friends');
    if(countFriends(db,invite.owner_id)>=MAX_FRIENDS)throw Error('Friend limit reached');
    const old=db.prepare('SELECT status FROM friend_requests WHERE requester_id=? AND recipient_id=?').get(user.id,invite.owner_id);
    if(old?.status==='pending')throw Error('Friend request already pending');
    const id=randomUUID();
    db.prepare('INSERT INTO friend_requests(id,requester_id,recipient_id,status,created_at) VALUES(?,?,?,?,?)').run(id,user.id,invite.owner_id,'pending',now);
    db.prepare('UPDATE friend_invites SET used_at=? WHERE id=?').run(now,invite.id);
    return {ok:true,message:'Запрос отправлен. Друг должен подтвердить.'};
  });
}
export function respondFriend(db,user,id,accept,now=Date.now()){
  if(!/^[0-9a-f-]{36}$/.test(id))throw Error('Invalid request');
  return transaction(db,()=>{
    const request=db.prepare('SELECT * FROM friend_requests WHERE id=? AND recipient_id=? AND status=?').get(id,user.id,'pending');
    if(!request)throw Error('Friend request not found');
    const owner=db.prepare('SELECT * FROM users WHERE id=?').get(request.requester_id);
    if(accept){requireOptIn(user);requireOptIn(owner);
      if(countFriends(db,user.id)>=MAX_FRIENDS||countFriends(db,owner.id)>=MAX_FRIENDS)throw Error('Friend limit reached');
      const [a,b]=pair(user.id,owner.id);
      db.prepare('INSERT OR IGNORE INTO friendships(user_a,user_b,created_at) VALUES(?,?,?)').run(a,b,now);
    }
    db.prepare('UPDATE friend_requests SET status=?,responded_at=? WHERE id=?').run(accept?'accepted':'rejected',now,id);
    return {ok:true};
  });
}
export function removeFriend(db,user,otherId){
  if(typeof otherId!=='string'||!/^[0-9a-f-]{36}$/.test(otherId))throw Error('Invalid friend');
  const [a,b]=pair(user.id,otherId);
  return {removed:db.prepare('DELETE FROM friendships WHERE user_a=? AND user_b=?').run(a,b).changes>0};
}
export function friendsSnapshot(db,user,now=Date.now()){
  if(!user.friends_opt_in)return {enabled:false,friends:[],incoming:[],outgoing:[],privacy:'Выключено. Никто не видит твой прогресс.'};
  const since=now-7*86400_000;
  const friends=db.prepare(`SELECT u.id, u.display_name AS name,
   (SELECT COUNT(*) FROM completions c WHERE c.user_id=u.id AND c.solved_at>=?) AS weeklySolved,
   (SELECT COALESCE(SUM(points),0) FROM completions c WHERE c.user_id=u.id AND c.solved_at>=?) AS weeklyPoints,
   u.solved_count AS solvedTotal
    FROM friendships f JOIN users u ON u.id=CASE WHEN f.user_a=? THEN f.user_b ELSE f.user_a END
    WHERE (f.user_a=? OR f.user_b=?) AND u.friends_opt_in=1 ORDER BY u.display_name COLLATE NOCASE`).all(since,since,user.id,user.id,user.id);
  const incoming=db.prepare(`SELECT r.id,u.display_name AS name FROM friend_requests r JOIN users u ON u.id=r.requester_id
    WHERE r.recipient_id=? AND r.status='pending' AND u.friends_opt_in=1 ORDER BY r.created_at DESC`).all(user.id);
  const outgoing=db.prepare(`SELECT u.display_name AS name FROM friend_requests r JOIN users u ON u.id=r.recipient_id
    WHERE r.requester_id=? AND r.status='pending' AND u.friends_opt_in=1 ORDER BY r.created_at DESC`).all(user.id);
  return {enabled:true,friends,incoming,outgoing,privacy:'Доступ только подтверждённым друзьям. Можно выключить в профиле и удалить любого друга.'};
}

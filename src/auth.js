import {createHmac,randomBytes,timingSafeEqual,createHash,randomUUID} from 'node:crypto';
import {transaction} from './db.js';

export function validateInitData(raw, botToken, nowSec=Math.floor(Date.now()/1000)) {
  if (!raw || typeof raw!=='string' || raw.length>8192 || !botToken) throw Error('Invalid authentication');
  const params=new URLSearchParams(raw);
  const hash=params.get('hash'),authDate=Number(params.get('auth_date'));
  if(!hash || !/^[a-f0-9]{64}$/i.test(hash) || !Number.isSafeInteger(authDate) || authDate>nowSec+60 || nowSec-authDate>3600) throw Error('Invalid or expired authentication');
  if([...params.keys()].length !== new Set(params.keys()).size) throw Error('Duplicate auth field');
  const check=[...params.entries()].filter(([k])=>k!=='hash').sort((a,b)=>a[0].localeCompare(b[0],'en')).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=createHmac('sha256','WebAppData').update(botToken).digest();
  const digest=createHmac('sha256',secret).update(check).digest();
  if(!timingSafeEqual(digest,Buffer.from(hash,'hex')))throw Error('Invalid authentication');
  let user;
  try{user=JSON.parse(params.get('user')||'null')}catch{throw Error('Invalid user');}
  if(!user || !Number.isSafeInteger(user.id)||user.id<=0)throw Error('Invalid user');
  return {telegramId:String(user.id), suggestion:String(user.first_name||'').slice(0,50)};
}
export function makeSession(db, userId, now=Date.now()) {
  const token=randomBytes(32).toString('base64url');
  const hash=createHash('sha256').update(token).digest('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(hash,userId,now+30*86400_000);
  return token;
}
export function findSession(db, bearer, now=Date.now()) {
  if(typeof bearer!=='string'||bearer.length>160||!bearer) return null;
  const hash=createHash('sha256').update(bearer).digest('hex');
  return db.prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(hash,now)||null;
}
export function loginTelegram(db, telegramId) {
  return transaction(db,()=>{
    let user=db.prepare('SELECT * FROM users WHERE telegram_id=?').get(telegramId);
    if(!user){const id=randomUUID();db.prepare('INSERT INTO users(id,telegram_id,created_at) VALUES(?,?,?)').run(id,telegramId,Date.now());user=db.prepare('SELECT * FROM users WHERE id=?').get(id);}
    return user;
  });
}
export function publicUser(u){return {id:u.id,displayName:u.display_name,leaderboardOptIn:false,friendsOptIn:!!u.friends_opt_in,points:u.points,solved:u.solved_count,skillRating:u.skill_rating};}
export function validName(s){if(typeof s!=='string')return false;const t=s.trim();return t.length>=2 && t.length<=30 && !/[<>\x00-\x1f]/.test(t);}

import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {dirname,join,extname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID,timingSafeEqual,createHash} from 'node:crypto';
import {openDb} from './db.js';
import {validateInitData,loginTelegram,makeSession,findSession,validName,publicUser} from './auth.js';
import {puzzleCounts,startAttempt,publicAttempt,submitMove,hint} from './puzzles.js';
import {progressSnapshot} from './gamification.js';
import {schoolProgress} from './school.js';
import {friendsSnapshot,createInvite,requestFriend,respondFriend,removeFriend} from './friends.js';

const staticDir=resolve(dirname(fileURLToPath(import.meta.url)),'../public');
const mimetypes={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'};
const success=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
function failure(res,code,message){success(res,{error:message},code);}
const equals=(a,b)=>{const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);};
async function body(req){let data='';for await(const chunk of req){data+=chunk;if(data.length>12000)throw Error('Request too large');}try{return JSON.parse(data||'{}')}catch{throw Error('Invalid JSON');}}
const featureConfig=()=>({demo:process.env.DEV_MODE==='1',botConfigured:!!process.env.TG_BOT_TOKEN,leaderboardOptIn:false,privateFriends:true});
async function botRespond(chatId,text,opts){const token=process.env.TG_BOT_TOKEN;if(!token)return;const response=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,...opts}),signal:AbortSignal.timeout(9000)});if(!response.ok)throw Error('Telegram API returned error');}
async function handleTelegramWebhook(req,res){
  const expected=process.env.TG_WEBHOOK_SECRET||'';
  if(!expected||!equals(req.headers['x-telegram-bot-api-secret-token'],expected))return failure(res,403,'Forbidden');
  const update=await body(req),msg=update.message;
  if(msg?.text?.trim().startsWith('/start')){
    const webapp=process.env.WEBAPP_URL;
    if(webapp){await botRespond(msg.chat.id,'♟ Шахматная академия. Решай задачи, зарабатывай очки и следи за прогрессом!',{reply_markup:{inline_keyboard:[[{text:'Играть',web_app:{url:webapp}}]]}});}
  }
  success(res,{ok:true});
}
function rateLimiter(){const records=new Map();return (ip)=>{
  const now=Date.now(),rec=records.get(ip);
  if(!rec||now-rec.t>60000){records.set(ip,{t:now,n:1});if(records.size>20000)records.clear();return true;}
  rec.n++;return rec.n<=180;
};}

export function makeHandler(db,{dev=process.env.DEV_MODE==='1'}={}){
  const limit=rateLimiter();
  return async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org");
    const ip=req.socket.remoteAddress||'unknown';if(!limit(ip))return failure(res,429,'Too many requests');
    let url;
    try {url=new URL(req.url,'http://localhost');}catch{return failure(res,400,'Bad URL');}
    const path=url.pathname,method=req.method;
    try{
      if(path==='/healthz'&&method==='GET')return success(res,{status:'ok',database:'connected'});
      if(path==='/api/config'&&method==='GET')return success(res,featureConfig());
      if(path==='/telegram/webhook'&&method==='POST')return await handleTelegramWebhook(req,res);
      if(path==='/api/auth/telegram'&&method==='POST'){
        const obj=await body(req),id=validateInitData(obj.initData,process.env.TG_BOT_TOKEN);
        const user=loginTelegram(db,id.telegramId);
        return success(res,{token:makeSession(db,user.id),user:publicUser(user),suggestedName:id.suggestion});
      }
      if(path==='/api/auth/dev'&&method==='POST'){
        if(!dev||!(ip==='127.0.0.1'||ip==='::1'||ip==='::ffff:127.0.0.1'))return failure(res,404,'Not found');
        const obj=await body(req);
        if(!validName(obj.name))return failure(res,400,'Имя от 2 до 30 символов');
        const alias='dev:'+createHash('sha256').update(obj.name.trim()).digest('hex').slice(0,18);
        const u=loginTelegram(db,alias);
        db.prepare('UPDATE users SET display_name=? WHERE id=?').run(obj.name.trim(),u.id);
        return success(res,{token:makeSession(db,u.id),user:publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id))});
      }
      if(path==='/api/catalog'&&method==='GET')return success(res,{counts:puzzleCounts(db),scoring:{mate1:1,mate2:2,mate3:3,draw:3},note:'Баллы только за новые задачи. Подсказка не лишает маленького шахматиста награды.'});
      if(method==='GET' && ['/', '/app.js','/fun.js','/style.css','/chess.js'].includes(path)){
        const file=path==='/'?'index.html':path==='/chess.js'?'../src/chess.js':path.slice(1);
        const bytes=await readFile(join(staticDir,file));res.writeHead(200,{'Content-Type':mimetypes[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});return res.end(bytes);
      }
      const token=(req.headers.authorization||'').replace(/^Bearer /,'');
      const user=findSession(db,token);
      if(!user)return failure(res,401,'Необходимо войти');
      if(path==='/api/me'&&method==='GET')return success(res,{...publicUser(user),game:progressSnapshot(db,user),school:schoolProgress(db,user)});
      if(path==='/api/me'&&method==='PATCH'){
        const obj=await body(req);
        if(obj.displayName!==undefined){if(!validName(obj.displayName))return failure(res,400,'Имя от 2 до 30 символов');db.prepare('UPDATE users SET display_name=? WHERE id=?').run(obj.displayName.trim(),user.id);}
        if(obj.leaderboardOptIn===true)return failure(res,400,'Public leaderboard is disabled for junior players');
        if(obj.friendsOptIn!==undefined){
          if(typeof obj.friendsOptIn!=='boolean')return failure(res,400,'friendsOptIn must be boolean');
          db.prepare('UPDATE users SET friends_opt_in=? WHERE id=?').run(Number(obj.friendsOptIn),user.id);
          if(!obj.friendsOptIn)db.prepare('UPDATE friend_invites SET used_at=? WHERE owner_id=? AND used_at IS NULL').run(Date.now(),user.id);
        }
        const updated=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
        return success(res,{...publicUser(updated),game:progressSnapshot(db,updated),school:schoolProgress(db,updated)});
      }
      // For 8–9 year old players there is no global child discovery or public ranking.
      if(path==='/api/leaderboard'&&method==='GET')return success(res,{users:[],private:true,note:'Используй закрытый круг друзей.'});
      if(path==='/api/friends'&&method==='GET')return success(res,friendsSnapshot(db,user));
      if(path==='/api/friends/invitations'&&method==='POST')return success(res,createInvite(db,user),201);
      if(path==='/api/friends/requests'&&method==='POST'){
        const data=await body(req);return success(res,requestFriend(db,user,data.code),201);
      }
      const response=path.match(/^\/api\/friends\/requests\/([0-9a-f-]{36})\/(accept|decline)$/);
      if(response&&method==='POST')return success(res,respondFriend(db,user,response[1],response[2]==='accept'));
      const remove=path.match(/^\/api\/friends\/([0-9a-f-]{36})$/);
      if(remove&&method==='DELETE')return success(res,removeFriend(db,user,remove[1]));
      if(!user.display_name)return failure(res,409,'Сначала укажи имя в профиле');
      if(path==='/api/attempts'&&method==='POST'){
        const obj=await body(req);
        const attempt=startAttempt(db,user,obj.mode||'progressive',obj.category);
        return success(res,publicAttempt(db,attempt),201);
      }
      const match=path.match(/^\/api\/attempts\/([0-9a-f-]{36})(?:\/(move|hint))?$/);
      if(match){
        const id=match[1],op=match[2];
        if(method==='GET'&&!op){const attempt=db.prepare('SELECT * FROM attempts WHERE id=? AND user_id=?').get(id,user.id);if(!attempt)return failure(res,404,'Attempt not found');return success(res,publicAttempt(db,attempt));}
        if(method==='POST'&&op==='move'){
          const data=await body(req);if(typeof data.uci!=='string'||!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(data.uci))return failure(res,400,'Invalid move');
          return success(res,submitMove(db,user,id,data.uci));
        }
        if(method==='POST'&&op==='hint')return success(res,hint(db,user,id));
      }
      return failure(res,404,'Not found');
    }catch(e){
      const isClient=/^(Unknown|All puzzles|No puzzles|Attempt|Illegal|No active|Broken puzzle|Trivial|Invalid|Duplicate|Необходимо|Puzzle did not|Request too large|No hint|Friends|Friend|Invitation|Already friends|Too many|Public leaderboard)/.test(e.message);
      if(!isClient)console.error('Server error:',e.message);
      return failure(res,isClient?400:500,isClient?e.message:'Internal server error');
    }
  };
}
export function makeServer(db,{dev}={}){return createServer(makeHandler(db,{dev}));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const port=Number(process.env.PORT||8094),host=process.env.HOST||'127.0.0.1';
  if(process.env.NODE_ENV==='production'&&!process.env.TG_BOT_TOKEN)throw Error('TG_BOT_TOKEN is required in production');
  const db=openDb();makeServer(db).listen(port,host,()=>console.log(`Chess Academy API listening on ${host}:${port} (dev=${process.env.DEV_MODE==='1'})`));
}

import {initDb} from '../src/cloud-db.js';
import {getCatalog} from '../src/cloud-catalog.js';
import {authenticateTelegram,currentUser,updateProfile,stats,startAttempt,findAttempt,publicAttempt,submitMove,hint,publicUser} from '../src/cloud-learning.js';
import {timingSafeEqual} from 'node:crypto';

function send(res,data,status=200){res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');res.statusCode=status;res.end(JSON.stringify(data));}
function matches(a,b){const x=Buffer.from(a||''),y=Buffer.from(b||'');return x.length===y.length&&timingSafeEqual(x,y);}
async function payload(req){
  if(req.body&&typeof req.body==='object')return req.body;
  let raw='';for await(const part of req){raw+=part.toString();if(raw.length>12000)throw Error('Request too large');}
  try{return JSON.parse(raw||'{}')}catch{throw Error('Invalid JSON')}
}
async function sendBot(chatId,text,extra){
  const result=await fetch(`https://api.telegram.org/bot${process.env.TG_BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:chatId,text,...extra}),signal:AbortSignal.timeout(9000)});
  if(!result.ok)throw Error('Telegram bot send failed');
}
export default async function handler(req,res){
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'self' https://web.telegram.org https://*.telegram.org");
  const parsed=new URL(req.url,'https://localhost');
  const route=parsed.searchParams.get('route')||String(req.query?.route||'');
  const path=route==='healthz'?'/healthz':route==='webhook'?'/telegram/webhook':route?'/api/'+route:parsed.pathname;
  const method=req.method;
  try{
    if(path==='/api/config'&&method==='GET')return send(res,{demo:false,botConfigured:!!process.env.TG_BOT_TOKEN,leaderboardOptIn:false,privateFriends:true,friendsEnabled:false,publicAccess:true});
    if(path==='/healthz'&&method==='GET'){
      await initDb();const catalog=getCatalog();return send(res,{status:'ok',database:'connected',catalog:catalog.counts,publicAccess:true});
    }
    if(path==='/telegram/webhook'&&method==='POST'){
      if(!process.env.TG_WEBHOOK_SECRET||!matches(req.headers['x-telegram-bot-api-secret-token'],process.env.TG_WEBHOOK_SECRET))return send(res,{error:'Forbidden'},403);
      const p=await payload(req);const m=p?.message;
      if(m?.text?.trim().startsWith('/start')&&process.env.WEBAPP_URL){
        await sendBot(m.chat.id,'♟ Шахматная академия. Открой тренажёр и решай задачи!',{reply_markup:{inline_keyboard:[[{text:'Играть',web_app:{url:process.env.WEBAPP_URL}}]]}});
      }
      return send(res,{ok:true});
    }
    await initDb();
    if(path==='/api/catalog'&&method==='GET')return send(res,{counts:getCatalog().counts,scoring:{mate1:1,mate2:2,mate3:3},note:'Баллы за первое решение задачи.'});
    if(path==='/api/auth/telegram'&&method==='POST')return send(res,await authenticateTelegram((await payload(req)).initData));
    if(path==='/api/auth/dev')return send(res,{error:'Тестовый вход отключён'},404);
    const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const user=await currentUser(bearer);
    if(!user)return send(res,{error:'Необходимо войти через Telegram'},401);
    if(path==='/api/me'&&method==='GET')return send(res,{...publicUser(user),...await stats(user)});
    if(path==='/api/me'&&method==='PATCH'){
      const u=await updateProfile(user,await payload(req));return send(res,{...publicUser(u),...await stats(u)});
    }
    if(path==='/api/leaderboard'&&method==='GET')return send(res,{users:[],private:true});
    if(path==='/api/friends'&&method==='GET')return send(res,{enabled:false,friends:[],incoming:[],outgoing:[],privacy:'Функция друзей пока не подключена.'});
    if(path.startsWith('/api/friends'))return send(res,{error:'Функция друзей пока не подключена'},403);
    if(!user.display_name)return send(res,{error:'Сначала укажи имя в профиле'},409);
    if(path==='/api/attempts'&&method==='POST'){
      const p=await payload(req);return send(res,await startAttempt(user,p.mode||'progressive',p.category),201);
    }
    const matched=path.match(/^\/api\/attempts\/([0-9a-f-]{36})(?:\/(move|hint))?$/);
    if(matched){
      if(method==='GET'&&!matched[2]){
        const a=await findAttempt(user,matched[1]);return a?send(res,publicAttempt(a)):send(res,{error:'Attempt not found'},404);
      }
      if(method==='POST'&&matched[2]==='hint')return send(res,await hint(user,matched[1]));
      if(method==='POST'&&matched[2]==='move')return send(res,await submitMove(user,matched[1],(await payload(req)).uci));
    }
    return send(res,{error:'Not found'},404);
  }catch(e){
    const client=/^(Invalid|Duplicate|No active|Attempt|Illegal|Puzzle|Все задачи|Категория|Неизвестная|Необходимо|Имя|Общий рейтинг|Режим друзей|Аккаунт|Сначала|Request too large)/.test(e.message);
    if(!client)console.error('Chess Academy cloud request failed:',e.message);
    return send(res,{error:client?e.message:'Server error'},client?400:503);
  }
}

import {initDb} from '../src/cloud-db.js';
import {getCatalog} from '../src/cloud-catalog.js';
import {authenticateTelegram,currentUser,updateProfile,stats,startAttempt,findAttempt,findActiveAttempt,publicAttempt,submitMove,hint,publicUser} from '../src/cloud-learning.js';
import {timingSafeEqual} from 'node:crypto';
import {createLeague,listLeagues,leagueDetails,inviteToLeague,requestLeague,decideLeagueRequest,leaveOrRemoveLeagueMember,closeLeague} from '../src/cloud-leagues.js';
import {createInvite,requestFriend,respondFriend,removeFriend,friendsSnapshot} from '../src/cloud-friends.js';
import {getDonationInfo,getDonationQr} from '../src/donation-api.js';
import {DEFAULT_DONATION_OZON_URL} from '../src/donation.js';
import {notifyRegistration,registeredCount,isRegistrationCommand,recipient} from '../src/registration-notifications.js';
import {webhookSecretFor,authorizedNotifier,activateWebhook,checkWebhook} from '../src/webhook-setup.js';

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
    if(path==='/api/donation'&&method==='GET'){
      const raw=process.env.DONATION_OZON_URL||DEFAULT_DONATION_OZON_URL;
      const data=getDonationInfo(raw);
      return send(res,{...data,
        qrDataUrl:data.qrAvailable?await getDonationQr(raw):null,
        paymentUrl:data.qrAvailable?raw:null});
    }
    if(path==='/api/config'&&method==='GET')return send(res,{demo:false,botConfigured:!!process.env.TG_BOT_TOKEN,leaderboardOptIn:false,privateFriends:true,friendsEnabled:true,publicAccess:true});
    if(path==='/healthz'&&method==='GET'){
      await initDb();const catalog=getCatalog();return send(res,{status:'ok',database:'connected',catalog:catalog.counts,publicAccess:true});
    }
    if(path==='/telegram/webhook'&&method==='POST'){
      const webhookSecret=webhookSecretFor();
      if(!webhookSecret||!matches(req.headers['x-telegram-bot-api-secret-token'],webhookSecret))return send(res,{error:'Forbidden'},403);
      const p=await payload(req);const m=p?.message;
      if(isRegistrationCommand(m)){
        await initDb();
        const total=await registeredCount();
        await sendBot(recipient().id,'♟ Всего зарегистрировано: '+total+'\nЛичные уведомления о регистрациях включены.',{protect_content:true});
        return send(res,{ok:true});
      }
      if(m?.chat?.type==='private'&&m?.text?.trim().startsWith('/start')){
        await sendBot(m.chat.id,'♟ Шахматная академия. Открой тренажёр и решай задачи!',{reply_markup:{inline_keyboard:[[{text:'Играть',web_app:{url:process.env.WEBAPP_URL||'https://chess-academy-theta.vercel.app'}}]]}});
      }
      return send(res,{ok:true});
    }
    await initDb();
    if(path==='/api/catalog'&&method==='GET')return send(res,{counts:getCatalog().counts,scoring:{mate1:1,mate2:2,mate3:3},note:'Баллы за первое решение задачи.'});
    if(path==='/api/auth/telegram'&&method==='POST')return send(res,await authenticateTelegram((await payload(req)).initData));
    if(path==='/api/auth/dev')return send(res,{error:'Тестовый вход отключён'},404);
    const bearer=(req.headers.authorization||'').replace(/^Bearer\s+/i,'');const user=await currentUser(bearer);
    if(!user)return send(res,{error:'Необходимо войти через Telegram'},401);
    if(path==='/api/admin/registrations/status'&&method==='POST'){
      const body=await payload(req);
      if(!await authorizedNotifier(user,body.initData))return send(res,{error:'Not found'},404);
      return send(res,{admin:true,...await checkWebhook()});
    }
    if(path==='/api/admin/registrations/activate'&&method==='POST'){
      const body=await payload(req);
      if(!await authorizedNotifier(user,body.initData))return send(res,{error:'Not found'},404);
      return send(res,{admin:true,...await activateWebhook()});
    }
    if(path.startsWith('/api/admin/'))return send(res,{error:'Not found'},404);
    if(path==='/api/me'&&method==='GET')return send(res,{...publicUser(user),...await stats(user)});
    if(path==='/api/me'&&method==='PATCH'){
      const u=await updateProfile(user,await payload(req));
      if(u.firstRegistration)await notifyRegistration();
      return send(res,{...publicUser(u),...await stats(u)});
    }
    if(path==='/api/leaderboard'&&method==='GET')return send(res,{users:[],private:true});
    if(path==='/api/friends'&&method==='GET')return send(res,await friendsSnapshot(user));
    if(path==='/api/friends/invitations'&&method==='POST')return send(res,await createInvite(user),201);
    if(path==='/api/friends/requests'&&method==='POST'){
      const data=await payload(req);return send(res,await requestFriend(user,data.code),201);
    }
    const action=path.match(/^\/api\/friends\/requests\/([0-9a-f-]{36})\/(accept|decline)$/i);
    if(action&&method==='POST')return send(res,await respondFriend(user,action[1],action[2]==='accept'));
    const friend=path.match(/^\/api\/friends\/([0-9a-f-]{36})$/i);
    if(friend&&method==='DELETE')return send(res,await removeFriend(user,friend[1]));
    if(path.startsWith('/api/friends'))return send(res,{error:'Неизвестная операция с друзьями'},404);
    if(path==='/api/leagues'&&method==='GET')return send(res,await listLeagues(user));
    if(path==='/api/leagues'&&method==='POST')return send(res,await createLeague(user,(await payload(req)).name),201);
    if(path==='/api/leagues/join'&&method==='POST')return send(res,await requestLeague(user,(await payload(req)).code),201);
    const league=path.match(/^\/api\/leagues\/([0-9a-f-]{36})(?:\/(invites))?$/i);
    if(league&&method==='GET'&&!league[2])return send(res,await leagueDetails(user,league[1]));
    if(league&&method==='POST'&&league[2]==='invites')return send(res,await inviteToLeague(user,league[1]),201);
    if(league&&method==='DELETE'&&!league[2])return send(res,await closeLeague(user,league[1]));
    const approval=path.match(/^\/api\/leagues\/([0-9a-f-]{36})\/requests\/([0-9a-f-]{36})\/(accept|decline)$/i);
    if(approval&&method==='POST')
      return send(res,await decideLeagueRequest(user,approval[1],approval[2],approval[3]==='accept'));
    const leagueMember=path.match(/^\/api\/leagues\/([0-9a-f-]{36})\/members\/([0-9a-f-]{36})$/i);
    if(leagueMember&&method==='DELETE')
      return send(res,await leaveOrRemoveLeagueMember(user,leagueMember[1],leagueMember[2]));
    if(path.startsWith('/api/leagues/'))return send(res,{error:'Неизвестная операция с лигой'},404);
    if(!user.display_name)return send(res,{error:'Сначала укажи имя в профиле'},409);
    if(path==='/api/attempts/active'&&method==='GET'){
      const a=await findActiveAttempt(user);
      return send(res,{attempt:a?publicAttempt(a):null});
    }
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
    const client=/^(Invalid|Duplicate|No active|Attempt|Illegal|Puzzle|Все задачи|Категория|Неизвестная|Неверный|Необходимо|Имя|Общий рейтинг|Режим друзей|Аккаунт|Сначала|Приглашение|Список друзей|Сегодня|Вы уже друзья|Запрос|Код истёк|Неверный код|Нужно подтвердить|Разовое объединение|Сегодня уже создано|В исходном профиле|Аккаунт уже объединён|Операция объединения|Лига|Приглашение|Только создатель|Для лиги|Название лиги|Можно участвовать|Можно создать|У игрока|Ты уже|Создатель|Заявка|Удалять игроков|Закрыть лигу|Request too large)/.test(e.message);
    const stale=['Attempt already completed','Attempt not found','No active attempt'].includes(e.message);
    if(!client)console.error('Chess Academy cloud request failed:',e.message);
    if(stale)return send(res,{error:'Эта задача уже завершена. Обновляем игровую позицию.',code:'ATTEMPT_STALE'},409);
    return send(res,{error:client?e.message:'Server error'},client?400:503);
  }
}

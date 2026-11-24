// Secure, one-time admin activation for Telegram webhook delivery.
// No token or numerical Telegram IDs are sent to the browser or stored in git.
import {createHmac} from 'node:crypto';
import {verifyTelegram} from './cloud-learning.js';
import {recipient} from './registration-notifications.js';
import {getPool} from './cloud-db.js';

export const WEBHOOK_URL='https://chess-academy-theta.vercel.app/telegram/webhook';

export function webhookSecretFor(env=process.env){
  const configured=String(env.TG_WEBHOOK_SECRET||'');
  if(configured){
    if(!/^[A-Za-z0-9_-]{1,256}$/.test(configured))return null;
    return configured;
  }
  if(!env.TG_BOT_TOKEN)return null;
  // Stable, high-entropy secret derived from the existing server-side bot token.
  return createHmac('sha256',env.TG_BOT_TOKEN)
    .update('chess-academy-webhook-secret-v1').digest('hex');
}

export async function authorizedNotifier(user,raw,{env=process.env,db=getPool()}={}){
  const admin=recipient(env);
  if(!admin||!user||!user.id||!raw)return false;
  try{
    const signed=verifyTelegram(raw,env.TG_BOT_TOKEN);
    if(signed.telegramId!==admin.id)return false;
    const telegramUser=JSON.parse(new URLSearchParams(raw).get('user')||'null');
    if(String(telegramUser?.username||'').toLowerCase()!==admin.username)return false;
    if(String(user.telegram_id)===admin.id)return true;
    const linked=await db.query('SELECT 1 FROM linked_telegram_identities WHERE telegram_id=$1 AND user_id=$2',[admin.id,user.id]);
    return linked.rowCount>0;
  }catch{return false;}
}

async function botCall(method,body,env,fetcher){
  if(!env.TG_BOT_TOKEN)throw Error('Не настроен токен шахматного бота');
  try{
    const response=await fetcher('https://api.telegram.org/bot'+env.TG_BOT_TOKEN+'/'+method,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
      signal:AbortSignal.timeout(8000)
    });
    if(!response.ok)throw Error('Telegram API error');
    const result=await response.json();
    if(!result.ok)throw Error('Telegram API error');
    return result.result;
  }catch{throw Error('Telegram не отвечает на запрос настройки. Проверь подключение бота.');}
}

export async function checkWebhook({env=process.env,fetcher=fetch}={}){
  const secret=webhookSecretFor(env);
  if(!secret)throw Error('Не настроен защищённый webhook');
  const info=await botCall('getWebhookInfo',{},env,fetcher);
  return {
    connected:info.url===WEBHOOK_URL,
    pending:Number(info.pending_update_count||0),
    lastError:typeof info.last_error_message==='string'?info.last_error_message.slice(0,250):null
  };
}
export async function activateWebhook({env=process.env,fetcher=fetch}={}){
  const admin=recipient(env);
  const secret=webhookSecretFor(env);
  if(!admin||!secret)throw Error('Не заполнены настройки администратора или webhook');
  const chat=await botCall('getChat',{chat_id:admin.id},env,fetcher);
  if(String(chat?.id)!==admin.id||chat?.type!=='private'||
     String(chat?.username||'').toLowerCase()!==admin.username)
    throw Error('Личный чат Telegram не совпадает с настройками администратора');
  await botCall('setWebhook',{
    url:WEBHOOK_URL,secret_token:secret,allowed_updates:['message'],
    drop_pending_updates:false,max_connections:3
  },env,fetcher);
  const result=await checkWebhook({env,fetcher});
  if(!result.connected)throw Error('Telegram не подтвердил подключение webhook');
  return result;
}

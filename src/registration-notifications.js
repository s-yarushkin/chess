// Server-only notifications. No player nicknames, Telegram IDs or other personal
// information are sent. Recipient configuration is private, never in public config.
import {getPool} from './cloud-db.js';
export function recipient(env=process.env){
 const id=String(env.REGISTRATION_ADMIN_CHAT_ID||'').trim();
 const username=String(env.REGISTRATION_ADMIN_USERNAME||'').trim().replace(/^@/,'').toLowerCase();
 if(!/^[1-9]\d{0,15}$/.test(id)||!Number.isSafeInteger(Number(id))||
    !/^[a-z0-9_]{5,32}$/.test(username)||!env.TG_BOT_TOKEN)return null;
 return {id,username,token:env.TG_BOT_TOKEN};
}
function matchingChat(chat,admin){
 return !!chat&&chat.type==='private'&&String(chat.id)===admin.id&&
  String(chat.username||'').toLowerCase()===admin.username;
}
export function isRegistrationCommand(message,env=process.env){
 const admin=recipient(env);
 return !!admin&&matchingChat(message?.chat,admin)&&
  String(message?.from?.id)===admin.id&&
  String(message?.from?.username||'').toLowerCase()===admin.username&&
  message?.text?.trim()==='/registrations';
}
export async function registeredCount(db=getPool()){
 const r=await db.query("SELECT COUNT(*)::int AS n FROM users u WHERE btrim(u.display_name)<>'' AND NOT EXISTS (SELECT 1 FROM admin_account_merges m WHERE m.source_user_id=u.id)");
 return r.rows[0].n;
}
async function callBot(admin,method,body,fetcher){
 const response=await fetcher('https://api.telegram.org/bot'+admin.token+'/'+method,{
  method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
  signal:AbortSignal.timeout(2500)
 });
 if(!response.ok)throw Error('Notification Telegram request failed');
 const data=await response.json();
 if(!data.ok)throw Error('Notification Telegram request failed');
 return data.result;
}
export async function notifyRegistration({env=process.env,fetcher=fetch,count=registeredCount,report=console.warn}={}){
 const admin=recipient(env);
 if(!admin)return 'disabled';
 try{
  // Verify the configured numeric ID still belongs to the exact private recipient.
  // Fail closed if the bot has not met them, the username changed, or the chat is not private.
  const chat=await callBot(admin,'getChat',{chat_id:admin.id},fetcher);
  if(!matchingChat(chat,admin)){report('Registration notification: recipient verification failed');return 'unverified';}
  const total=await count();
  await callBot(admin,'sendMessage',{chat_id:admin.id,text:'♟ Новый игрок зарегистрировался!\nВсего зарегистрировано: '+total,protect_content:true},fetcher);
  return 'sent';
 }catch{
  // Never log tokens, URLs, IDs, or player data; a Telegram outage must not break signup.
  report('Registration notification: delivery unavailable');return 'failed';
 }
}

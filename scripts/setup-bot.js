// Idempotent bot registration after HTTPS readiness; secrets never printed.
const token=process.env.TG_BOT_TOKEN,webapp=process.env.WEBAPP_URL,secret=process.env.TG_WEBHOOK_SECRET;
if(!/^\d{6,12}:[A-Za-z0-9_-]{20,}$/.test(token||'')||!/^https:\/\/[^/]+\/?$/.test(webapp||'')||!/^[A-Za-z0-9_-]{32,256}$/.test(secret||''))throw Error('Set valid TG_BOT_TOKEN, WEBAPP_URL and TG_WEBHOOK_SECRET');
const api=async(method,payload)=>{
 const response=await fetch('https://api.telegram.org/bot'+token+'/'+method,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
 const data=await response.json();
 if(!response.ok||!data.ok)throw Error(method+' failed: '+(data.description||response.status));
 return data.result;
};
const bot=await api('getMe',{});
if(!bot.is_bot)throw Error('Telegram token is not a bot');
console.log('Bot verified: @'+bot.username);
const url=new URL('/telegram/webhook',webapp).toString();
await api('setWebhook',{url,secret_token:secret,drop_pending_updates:false,allowed_updates:['message']});
await api('setChatMenuButton',{menu_button:{type:'web_app',text:'Играть в шахматы',web_app:{url:webapp}}});
if((await api('getWebhookInfo',{})).url!==url)throw Error('Webhook verification failed');
console.log('Telegram webhook verified: '+url+'. Adult pilot only.');

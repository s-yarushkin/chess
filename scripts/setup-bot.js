const token=process.env.TG_BOT_TOKEN,webapp=process.env.WEBAPP_URL,secret=process.env.TG_WEBHOOK_SECRET;
if(!token||!webapp?.startsWith('https://')||!secret)throw Error('Set TG_BOT_TOKEN, WEBAPP_URL (https), TG_WEBHOOK_SECRET');
for(const [action,data] of [
  ['setWebhook',{url:new URL('/telegram/webhook',webapp).toString(),secret_token:secret,drop_pending_updates:false}],
  ['setChatMenuButton',{menu_button:{type:'web_app',text:'Играть в шахматы',web_app:{url:webapp}}}]
]){
  const r=await fetch(`https://api.telegram.org/bot${token}/${action}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
  const body=await r.json();if(!body.ok)throw Error(`${action} failed: ${body.description}`);console.log(`${action}: OK`);
}

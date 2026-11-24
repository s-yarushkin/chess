import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {WEBHOOK_URL,webhookSecretFor,authorizedNotifier,recipientState,activateWebhook,checkWebhook} from '../src/webhook-setup.js';
const token='123456:FAKE-TEST-ONLY';
const env={TG_BOT_TOKEN:token,REGISTRATION_ADMIN_CHAT_ID:'157957670',REGISTRATION_ADMIN_USERNAME:'sergeyyarushkin'};
function sign(id,username){
 const data=new URLSearchParams({
  auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id,username,first_name:'Tester'})
 });
 const sorted=[...data.entries()].sort((a,b)=>a[0].localeCompare(b[0],'en')).map(([k,v])=>k+'='+v).join('\n');
 const key=createHmac('sha256','WebAppData').update(token).digest();
 data.set('hash',createHmac('sha256',key).update(sorted).digest('hex'));
 return data.toString();
}
test('webhook secret is derived from token but never equals token; explicit secret wins',()=>{
 const secret=webhookSecretFor(env);
 assert.match(secret,/^[a-f0-9]{64}$/);
 assert.notEqual(secret,token);
 assert.equal(secret,webhookSecretFor(env));
 assert.equal(webhookSecretFor({...env,TG_WEBHOOK_SECRET:'fixed_safe_123'}),'fixed_safe_123');
 assert.equal(webhookSecretFor({...env,TG_WEBHOOK_SECRET:'bad secret'}),null);
 assert.equal(webhookSecretFor({}),null);
});
test('one-off merged account identifies admin by signed original Telegram ID, even if notification env missing',async()=>{
 const user={id:'abc',telegram_id:'222'};
 const db={query:async(sql,args)=>{
   assert.match(sql,/admin_account_merges/);
   return {rowCount:args[0]==='157957670'&&args[1]==='abc'?1:0};
 }};
 const signed=sign(157957670,'SergeyYarushkin');
 assert.equal(await authorizedNotifier(user,signed,{env,db}),true);
 assert.equal(await authorizedNotifier(user,signed,{env:{TG_BOT_TOKEN:token},db}),true);
 assert.equal(await authorizedNotifier(user,sign(157957670,'ChangedUsername'),{env,db}),true);
 assert.equal(await authorizedNotifier(user,sign(157957671,'SergeyYarushkin'),{env,db}),false);
 assert.equal(await authorizedNotifier({...user,id:'different'},signed,{env,db}),false);
 assert.equal(await authorizedNotifier(user,'garbage',{env,db}),false);
 assert.equal(await authorizedNotifier(user,signed,{env:{},db}),false);
 assert.equal(recipientState(signed,env).recipientReady,true);
 assert.deepEqual(recipientState(signed,{TG_BOT_TOKEN:token}),{recipientReady:false,reason:'missing'});
 assert.deepEqual(recipientState(signed,{...env,REGISTRATION_ADMIN_CHAT_ID:'12345'}),{recipientReady:false,reason:'mismatch'});
 assert.deepEqual(recipientState(signed,{...env,REGISTRATION_ADMIN_USERNAME:'SomeoneElse'}),{recipientReady:false,reason:'mismatch'});
});
test('admin activation verifies chat and configures secret-token webhook',async()=>{
 const calls=[];
 const fetcher=async(url,request)=>{
  const method=url.split('/').at(-1),args=JSON.parse(request.body);
  calls.push({method,args});
  const result=method==='getChat'?{id:157957670,type:'private',username:'SergeyYarushkin'}:
   method==='getWebhookInfo'?{url:WEBHOOK_URL,pending_update_count:0}:true;
  return {ok:true,json:async()=>({ok:true,result})};
 };
 const result=await activateWebhook({env,fetcher,expectedRecipientId:'157957670'});
 assert.equal(result.connected,true);
 assert.deepEqual(calls.map(c=>c.method),['getChat','setWebhook','getWebhookInfo']);
 assert.equal(calls[1].args.url,WEBHOOK_URL);
 assert.equal(calls[1].args.secret_token,webhookSecretFor(env));
 assert.deepEqual(calls[1].args.allowed_updates,['message']);
 assert.equal(calls[1].args.drop_pending_updates,false);
 assert.equal(calls[1].args.max_connections,3);
});
test('wrong private recipient or wrong webhook URL fails closed',async()=>{
 const wrong=async(url)=>({ok:true,json:async()=>({ok:true,result:url.endsWith('/getChat')?
  {id:157957670,type:'group',username:'SergeyYarushkin'}:true})});
 await assert.rejects(activateWebhook({env,fetcher:wrong,expectedRecipientId:'157957670'}),/Личный чат/);
 await assert.rejects(activateWebhook({env,fetcher:wrong,expectedRecipientId:'999'}),/Получатель уведомлений/);
 const unavailable=async()=>{throw Error('Some private credentials');};
 await assert.rejects(activateWebhook({env,fetcher:unavailable,expectedRecipientId:'157957670'}),/Telegram не отвечает/);
 const wrongWebhook=async()=>({ok:true,json:async()=>({ok:true,result:{url:'https://example.org/wrong'}})});
 const status=await checkWebhook({env,fetcher:wrongWebhook});
 assert.equal(status.connected,false);
});
test('frontend code does not disclose admin account or tokens',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const ui=readFileSync(new URL('../public/registration-admin.js',import.meta.url),'utf8');
 const api=readFileSync(new URL('../api/index.js',import.meta.url),'utf8');
 assert.match(html,/src="\/registration-admin\.js"/);
 assert.doesNotMatch(ui,/157957670|SergeyYarushkin|123456:FAKE/);
 assert.match(ui,/\/api\/admin\/registrations\/'/);
 assert.match(api,/webhookSecretFor\(\)/);
 assert.match(api,/authorizedNotifier\(user,body\.initData\)/);
 assert.match(api,/recipientState\(body\.initData\)/);
 assert.match(ui,/REGISTRATION_ADMIN_CHAT_ID/);
 assert.match(api,/startsWith\('\/start'\)/);
});

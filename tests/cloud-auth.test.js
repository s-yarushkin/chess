import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyTelegram} from '../src/cloud-learning.js';

const BOT_TOKEN='123456:TESTONLYtoken1234567890';
function sign(user,secret=BOT_TOKEN,now=Math.floor(Date.now()/1000)){
 const params=new URLSearchParams({auth_date:String(now),user:JSON.stringify(user),query_id:'AAE'});
 const data=[...params.entries()].sort((a,b)=>a[0].localeCompare(b[0],'en')).map(([k,v])=>k+'='+v).join('\n');
 const key=createHmac('sha256','WebAppData').update(secret).digest();
 params.set('hash',createHmac('sha256',key).update(data).digest('hex'));
 return params.toString();
}
test('any genuine Telegram account can sign in without a pilot allowlist',()=>{
 const before=process.env.PILOT_TELEGRAM_IDS;
 try{
  process.env.PILOT_TELEGRAM_IDS='12345'; // Legacy allowlist must have no effect.
  const first=verifyTelegram(sign({id:12345,first_name:'Алексей'}),BOT_TOKEN);
  assert.deepEqual(first,{telegramId:'12345',suggestedName:'Алексей'});
  const second=verifyTelegram(sign({id:9999,first_name:'Сергей'}),BOT_TOKEN);
  assert.equal(second.telegramId,'9999');
  delete process.env.PILOT_TELEGRAM_IDS;
  assert.equal(verifyTelegram(sign({id:56789}),BOT_TOKEN).telegramId,'56789');
 }finally{if(before===undefined)delete process.env.PILOT_TELEGRAM_IDS;else process.env.PILOT_TELEGRAM_IDS=before;}
});
test('public sign-in still rejects forgery, stale payloads and invalid users',()=>{
 const signed=sign({id:12345,first_name:'Алексей'});
 assert.throws(()=>verifyTelegram(signed,'WRONG'),/authentication/);
 assert.throws(()=>verifyTelegram(signed.replace('12345','9999'),BOT_TOKEN),/authentication/);
 assert.throws(()=>verifyTelegram(sign({id:12345},BOT_TOKEN,Math.floor(Date.now()/1000)-3700),BOT_TOKEN),/expired/);
 assert.throws(()=>verifyTelegram(sign({id:0}),BOT_TOKEN),/Invalid user/);
});

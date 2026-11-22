import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {verifyTelegram} from '../src/cloud-learning.js';

function sign(user,secret='123456:TESTONLYtoken1234567890',now=Math.floor(Date.now()/1000)){
 const params=new URLSearchParams({auth_date:String(now),user:JSON.stringify(user),query_id:'AAE'});
 const data=[...params.entries()].sort((a,b)=>a[0].localeCompare(b[0],'en')).map(([a,b])=>a+'='+b).join('\n');
 const key=createHmac('sha256','WebAppData').update(secret).digest();
 params.set('hash',createHmac('sha256',key).update(data).digest('hex'));
 return params.toString();
}
test('Telegram pilot requires server-side adult allowlist and valid signature',()=>{
 const before=process.env.PILOT_TELEGRAM_IDS;
 try{
  process.env.PILOT_TELEGRAM_IDS='12345';
  const data=sign({id:12345,first_name:'Test'});
  assert.equal(verifyTelegram(data,'123456:TESTONLYtoken1234567890').telegramId,'12345');
  assert.throws(()=>verifyTelegram(data,'WRONG'),/authentication/);
  assert.throws(()=>verifyTelegram(sign({id:9999}),'123456:TESTONLYtoken1234567890'),/пилот/);
  process.env.PILOT_TELEGRAM_IDS='';
  assert.throws(()=>verifyTelegram(data,'123456:TESTONLYtoken1234567890'),/пилот/);
  assert.throws(()=>verifyTelegram(sign({id:12345},undefined,Math.floor(Date.now()/1000)-3700),'123456:TESTONLYtoken1234567890'),/expired/);
 }finally{if(before===undefined)delete process.env.PILOT_TELEGRAM_IDS;else process.env.PILOT_TELEGRAM_IDS=before;}
});

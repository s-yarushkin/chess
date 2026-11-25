import test from 'node:test';
import assert from 'node:assert/strict';
import {welcomeForMessage,WELCOME_TEXT} from '../src/telegram-welcome.js';
import handler from '../api/index.js';
import {webhookSecretFor} from '../src/webhook-setup.js';
const url='https://chess-academy-theta.vercel.app';
const chat={id:123,type:'private'};
test('welcome covers start, ordinary text and non-text private messages',()=>{
 for(const message of [{chat,text:'/start'},{chat,text:'Привет'},{chat,photo:[{}]}]){
  const reply=welcomeForMessage(message,url);
  assert.equal(reply.chatId,123);
  assert.equal(reply.text,WELCOME_TEXT);
  assert.deepEqual(reply.extra.reply_markup.inline_keyboard,[[{text:'Играть в шахматы',web_app:{url}}]]);
 }
 assert.match(WELCOME_TEXT,/восьмилетний Лёша/);
 assert.match(WELCOME_TEXT,/совершенно бесплатно/);
 assert.match(WELCOME_TEXT,/Сказать спасибо/);
 assert.match(WELCOME_TEXT,/но это совсем не обязательно/);
 assert.match(WELCOME_TEXT,/отзывам, замечаниям и новым идеям/);
 for(const message of [null,{}, {chat:{id:-1,type:'group'},text:'/start'},{chat,from:{is_bot:true},text:'hello'}])
  assert.equal(welcomeForMessage(message,url),null);
 assert.equal(welcomeForMessage({chat},undefined),null);
});
test('production webhook sends the welcome for ordinary messages and rejects forged requests',async()=>{
 const oldToken=process.env.TG_BOT_TOKEN,oldSecret=process.env.TG_WEBHOOK_SECRET,oldUrl=process.env.WEBAPP_URL,oldFetch=globalThis.fetch;
 process.env.TG_BOT_TOKEN='test-token';process.env.TG_WEBHOOK_SECRET='test_secret';process.env.WEBAPP_URL=url;
 const calls=[];
 globalThis.fetch=async(endpoint,options)=>{calls.push({endpoint,body:JSON.parse(options.body)});return {ok:true};};
 const response=()=>({setHeader(){},end(body){this.body=JSON.parse(body);}});
 try{
  const res=response();
  await handler({url:'/telegram/webhook',method:'POST',headers:{'x-telegram-bot-api-secret-token':webhookSecretFor()},body:{message:{chat,text:'Привет'}}},res);
  assert.equal(res.statusCode,200);assert.equal(calls.length,1);
  assert.equal(calls[0].body.text,WELCOME_TEXT);
  assert.equal(calls[0].body.chat_id,123);
  const forged=response();
  await handler({url:'/telegram/webhook',method:'POST',headers:{},body:{message:{chat,text:'Привет'}}},forged);
  assert.equal(forged.statusCode,403);assert.equal(calls.length,1);
 }finally{
  for(const [key,value] of [['TG_BOT_TOKEN',oldToken],['TG_WEBHOOK_SECRET',oldSecret],['WEBAPP_URL',oldUrl]]){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  globalThis.fetch=oldFetch;
 }
});

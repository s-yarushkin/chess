import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initDb,getPool} from '../src/cloud-db.js';
import {updateProfile} from '../src/cloud-learning.js';
import {recipient,notifyRegistration,isRegistrationCommand} from '../src/registration-notifications.js';

const env={TG_BOT_TOKEN:'test-token',REGISTRATION_ADMIN_CHAT_ID:'12345',REGISTRATION_ADMIN_USERNAME:'TestOwner'};
const chat={id:12345,type:'private',username:'testowner'};
const message={chat,from:{id:12345,username:'TestOwner'},text:'/registrations'};
const result=data=>({ok:true,json:async()=>({ok:true,result:data})});
test('notification recipient is fixed, private and verified; no player data',async()=>{
 const calls=[];
 const fetcher=async(url,opts)=>{
  const body=JSON.parse(opts.body);calls.push({method:url.split('/').at(-1),body});
  return result(calls.length===1?chat:{message_id:1});
 };
 assert.equal(await notifyRegistration({env,fetcher,count:async()=>24,report:()=>{}}),'sent');
 assert.deepEqual(calls,[{method:'getChat',body:{chat_id:'12345'}},
  {method:'sendMessage',body:{chat_id:'12345',text:'♟ Новый игрок зарегистрировался!\nВсего зарегистрировано: 24',protect_content:true}}]);
 assert.equal(isRegistrationCommand(message,env),true);
 assert.equal(isRegistrationCommand({...message,from:{id:456,username:'TestOwner'}},env),false);
 assert.equal(isRegistrationCommand({...message,chat:{...chat,type:'group'}},env),false);
 assert.equal(isRegistrationCommand({...message,chat:{...chat,username:'other'}},env),false);
 assert.equal(recipient({...env,REGISTRATION_ADMIN_CHAT_ID:'-123'}),null);
 assert.equal(recipient({...env,REGISTRATION_ADMIN_USERNAME:''}),null);
});
test('no notification if recipient cannot be verified or Telegram fails',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;return result({...chat,username:'other'});};
 assert.equal(await notifyRegistration({env,fetcher,count:()=>{throw Error('must not count')},report:()=>{}}),'unverified');
 assert.equal(calls,1);
 assert.equal(await notifyRegistration({env:{},fetcher,report:()=>{}}),'disabled');
 assert.equal(await notifyRegistration({env,fetcher:async()=>{throw Error('network')},report:()=>{}}),'failed');
 assert.equal(calls,1);
});
test('first saved nickname triggers registration once even with concurrent requests',{skip:!process.env.DATABASE_URL},async()=>{
 await initDb();const db=getPool(),id=randomUUID();
 await db.query('INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,$3)',[id,'registration-test-'+id,Date.now()]);
 try{
  const u=(await db.query('SELECT * FROM users WHERE id=$1',[id])).rows[0];
  const before=await updateProfile(u,{friendsOptIn:false});assert.equal(before.firstRegistration,false);
  const [a,b]=await Promise.all([updateProfile(u,{displayName:'ТестовыйИгрок'}),updateProfile(u,{displayName:'ДругойНик'})]);
  assert.equal(Number(a.firstRegistration)+Number(b.firstRegistration),1);
  assert.equal((await updateProfile(u,{displayName:'НовыйНик'})).firstRegistration,false);
 }finally{await db.query('DELETE FROM users WHERE id=$1',[id]);}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {initDb,getPool} from '../src/cloud-db.js';
import {TIPS,WEEK,allowedCron,daytimeMsk,reminderText,isStopMessage,runReminders,recordActivity,disableChatReminders} from '../src/practice-reminders.js';
test('36 distinct tips, safe time and authenticated cron',()=>{
 assert.equal(TIPS.length,36);assert.equal(new Set(TIPS).size,36);
 assert.match(reminderText(0),/\/stop/);
 assert.equal(reminderText(36),reminderText(0));
 const secret='x'.repeat(32);
 assert.equal(allowedCron('Bearer '+secret,secret),true);
 assert.equal(allowedCron('Bearer bad',secret),false);
 assert.equal(allowedCron('',undefined),false);
 assert.equal(daytimeMsk(Date.UTC(2026,10,26,9)),true);
 assert.equal(daytimeMsk(Date.UTC(2026,10,26,22)),false);
 assert.equal(isStopMessage({chat:{type:'private',id:123},from:{id:123},text:'/stop'}),true);
 assert.equal(isStopMessage({chat:{type:'group',id:123},from:{id:123},text:'/stop'}),false);
});
test('Postgres: only enabled inactive users, claim once, rotate, cap, reset and stop',{skip:!process.env.DATABASE_URL},async()=>{
 await initDb();const db=getPool(),ids=Array.from({length:3},()=>randomUUID()),now=Date.UTC(2026,10,26,9),chats=ids.map((_,i)=>String(8000000000000+Math.floor(Math.random()*1000000)*10+i));
 try{
 for(let i=0;i<3;i++)await db.query('INSERT INTO users(id,telegram_id,display_name,created_at,last_activity_at,reminders_enabled) VALUES($1,$2,$3,$4,$5,$6)',[ids[i],chats[i],'ReminderTest',now-3*WEEK,i===2?now:now-2*WEEK,i!==1]);
 const calls=[],env={TG_BOT_TOKEN:'fake'},fetcher=async(u,o)=>{calls.push(JSON.parse(o.body));return {ok:true}};
 const results=await Promise.all([runReminders({now,db,env,fetcher}),runReminders({now,db,env,fetcher})]);
 assert.equal(results.reduce((n,x)=>n+x.sent,0),1);
 assert.equal(calls[0].chat_id,chats[0]);
 await runReminders({now:now+WEEK+86400000,db,env,fetcher});
 assert.equal(calls.filter(c=>c.chat_id===chats[0]).length,2);
 assert.notEqual(calls[0].text,calls.find((c,i)=>i>0&&c.chat_id===chats[0]).text);
 await runReminders({now:now+3*WEEK,db,env,fetcher});
 assert.equal(calls.filter(c=>c.chat_id===chats[0]).length,2);
 await recordActivity(ids[0],now+3*WEEK,db);
 await runReminders({now:now+5*WEEK,db,env,fetcher});
 assert.equal(calls.filter(c=>c.chat_id===chats[0]).length,3);
 await disableChatReminders(chats[0],db);
 await runReminders({now:now+7*WEEK,db,env,fetcher});
 assert.equal(calls.filter(c=>c.chat_id===chats[0]).length,3);
 assert.equal(calls.filter(c=>c.chat_id===chats[1]).length,0);
 }finally{await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[ids]);}
});

test('Postgres: new accounts default to enabled and a saved opt-out survives subsequent activity',{skip:!process.env.DATABASE_URL},async()=>{
 await initDb();const db=getPool(),id=randomUUID(),chat='800000'+String(Date.now()).slice(-9),now=Date.now();
 try{
 const row=await db.query('INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,$3) RETURNING reminders_enabled',[id,chat,now]);
 assert.equal(row.rows[0].reminders_enabled,true);
 await disableChatReminders(chat,db);await recordActivity(id,now+120000,db);await initDb();
 const after=await db.query('SELECT reminders_enabled FROM users WHERE id=$1',[id]);
 assert.equal(after.rows[0].reminders_enabled,false);
 }finally{await db.query('DELETE FROM users WHERE id=$1',[id]);}
});

test('legacy backfill is one-time and initializes missing activity without resetting recorded preferences',()=>{
 const source=readFileSync(new URL('../src/cloud-db.js',import.meta.url),'utf8');
 assert.match(source,/reminders-existing-default-v1/);
 assert.match(source,/u\.reminders_enabled=FALSE AND u\.last_activity_at IS NULL/);
 assert.match(source,/u\.last_reminder_at IS NULL AND u\.reminder_count=0/);
 assert.match(source,/MAX\(a\.updated_at\)/);
 assert.match(source,/MAX\(s\.expires_at\)-2592000000/);
});

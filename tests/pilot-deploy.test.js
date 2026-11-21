import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHmac} from 'node:crypto';
import {openDb} from '../src/db.js';
import {makeServer} from '../src/server.js';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const token='123456789:'+('a'.repeat(32));
const env={APP_DOMAIN:'chess.example.org',WEBAPP_URL:'https://chess.example.org',TG_BOT_TOKEN:token,TG_WEBHOOK_SECRET:'A'.repeat(48),PILOT_TELEGRAM_IDS:'123456789',NODE_ENV:'production',DEV_MODE:'0',FRIENDS_ENABLED:'0'};
function check(input){
 const dir=mkdtempSync(join(tmpdir(),'chess-config-'));
 try{const path=join(dir,'pilot.conf');writeFileSync(path,Object.entries(input).map(([k,v])=>k+'='+v).join('\n'));
 return spawnSync('python3',['scripts/validate-deploy.py',path],{cwd:root,encoding:'utf8'});
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('pilot deploy rejects placeholders, development login and unapproved friends',()=>{
 assert.equal(check(env).status,0);
 assert.notEqual(check({...env,DEV_MODE:'1'}).status,0);
 assert.notEqual(check({...env,FRIENDS_ENABLED:'1'}).status,0);
 assert.notEqual(check({...env,TG_BOT_TOKEN:'REPLACE_ME'}).status,0);
 assert.notEqual(check({...env,APP_DOMAIN:'chess.example.com',WEBAPP_URL:'https://chess.example.com'}).status,0);
 assert.equal(check({...env,APP_DOMAIN:'chess.xn--80aclbmq1ath.xn--p1ai',WEBAPP_URL:'https://chess.xn--80aclbmq1ath.xn--p1ai'}).status,0);
});
function initData(id){
 const pairs=[['auth_date',String(Math.floor(Date.now()/1000))],['user',JSON.stringify({id,first_name:'Взрослый'})]];
 const h=createHmac('sha256','WebAppData').update(token).digest();
 const check=pairs.map(([k,v])=>k+'='+v).sort().join('\n');
 return new URLSearchParams([...pairs,['hash',createHmac('sha256',h).update(check).digest('hex')]]).toString();
}
test('adult Telegram allowlist and revocation, catalog readiness, social pilot lock',async()=>{
 const keys=['NODE_ENV','PILOT_TELEGRAM_IDS','TG_BOT_TOKEN','FRIENDS_ENABLED'];
 const old=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
 Object.assign(process.env,{NODE_ENV:'production',PILOT_TELEGRAM_IDS:'123456789',TG_BOT_TOKEN:token,FRIENDS_ENABLED:'0'});
 const db=openDb(':memory:');const server=makeServer(db,{dev:true});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 async function call(path,method='GET',data,bearer){
  const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},...(data?{body:JSON.stringify(data)}:{})});
  return {code:r.status,data:await r.json()};
 }
 try{
  assert.equal((await call('/healthz')).code,200);
  assert.equal((await call('/readyz')).code,503);
  assert.equal((await call('/api/config')).data.friendsEnabled,false);
  assert.equal((await call('/api/auth/dev','POST',{name:'Взрослый'})).code,404);
  assert.equal((await call('/api/auth/telegram','POST',{initData:initData(555555555)})).code,403);
  const login=await call('/api/auth/telegram','POST',{initData:initData(123456789)});
  assert.equal(login.code,200);
  assert.equal((await call('/api/me','GET',null,login.data.token)).code,200);
  assert.equal((await call('/api/friends','GET',null,login.data.token)).data.pilotRestricted,true);
  assert.equal((await call('/api/friends/invitations','POST',{},login.data.token)).code,403);
  process.env.PILOT_TELEGRAM_IDS='987654321';
  assert.equal((await call('/api/me','GET',null,login.data.token)).code,403);
 }finally{
  await new Promise(resolve=>server.close(resolve));db.close();
  for(const [k,v] of Object.entries(old))if(v===undefined)delete process.env[k];else process.env[k]=v;
 }
});
test('consistent SQLite online backup can be read and passes integrity checks',()=>{
 const folder=mkdtempSync(join(tmpdir(),'chess-db-')),dest='/tmp/chess-backup-test-'+process.pid+'.sqlite';
 try{
  const file=join(folder,'chess.sqlite'),db=openDb(file);
  db.prepare('INSERT INTO users(id,telegram_id,created_at) VALUES(?,?,?)').run('test','123',Date.now());db.close();
  const r=spawnSync(process.execPath,['scripts/backup-db.js',dest],{cwd:root,env:{...process.env,DB_PATH:file},encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);
  assert.ok(existsSync(dest));
  const copy=openDb(dest);assert.equal(copy.prepare('SELECT COUNT(*) AS n FROM users').get().n,1);copy.close();
 }finally{rmSync(folder,{recursive:true,force:true});rmSync(dest,{force:true});}
});

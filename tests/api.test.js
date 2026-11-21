import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {openDb} from '../src/db.js';
import {insertPuzzle} from '../src/puzzles.js';
import {makeServer} from '../src/server.js';

const fixture=JSON.parse(readFileSync(new URL('../data/legacy-demo.json',import.meta.url)));
test('full HTTP journey: login, profile, random task, score and private leaderboard',async()=>{
 const db=openDb(':memory:');insertPuzzle(db,fixture[0]);insertPuzzle(db,fixture[1]);
 const server=makeServer(db,{dev:true});
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 const base=`http://127.0.0.1:${server.address().port}`;let bearer='';
 const call=async(path,method='GET',data)=>{
  const r=await fetch(base+path,{method,headers:{'content-type':'application/json',...(bearer?{authorization:'Bearer '+bearer}:{})},...(data?{body:JSON.stringify(data)}:{})});return {status:r.status,data:await r.json()};
 };
 try{
  assert.equal((await call('/healthz')).data.status,'ok');
  assert.equal((await call('/api/me')).status,401);
  const login=await call('/api/auth/dev','POST',{name:'Лёша'});assert.equal(login.status,200);bearer=login.data.token;
  const me=await call('/api/me');assert.equal(me.data.displayName,'Лёша');
  const count=await call('/api/catalog');assert.equal(count.data.counts[0].count,2);
  const attempt=await call('/api/attempts','POST',{mode:'category',category:'mate1'});assert.equal(attempt.status,201);
  assert.equal(attempt.data.category,'mate1');assert.equal(attempt.data.errors,0);
  const chosen=fixture.find(p=>p.fen===attempt.data.position);
  assert.ok(chosen);
  const done=await call(`/api/attempts/${attempt.data.id}/move`,'POST',{uci:chosen.line[0]});
  assert.equal(done.status,200);assert.equal(done.data.completed,true);assert.equal(done.data.points,1);
  const afterSolve=(await call('/api/me')).data;
  assert.equal(afterSolve.points,1);
  assert.equal(afterSolve.game.streak,1);
  assert.equal(afterSolve.game.bestStreak,1);
  assert.ok(afterSolve.game.badges.find(b=>b.id==='first'&&b.earned));
  assert.deepEqual((await call('/api/leaderboard')).data.users,[]);
  assert.equal((await call('/api/me','PATCH',{leaderboardOptIn:true})).status,400);
  const friendsOpt=await call('/api/me','PATCH',{friendsOptIn:true});assert.equal(friendsOpt.data.friendsOptIn,true);
  assert.equal((await call('/api/friends')).data.friends.length,0);
  const already=await call(`/api/attempts/${attempt.data.id}/move`,'POST',{uci:chosen.line[0]});assert.equal(already.status,400);
  const second=await call('/api/attempts','POST',{mode:'category',category:'mate1'});assert.equal(second.status,201);
  assert.notEqual(second.data.position,attempt.data.position);
  const content=await fetch(base+'/');assert.equal(content.status,200);assert.match(await content.text(),/Шахматная академия/);
  const js=await fetch(base+'/chess.js');assert.equal(js.status,200);assert.match(await js.text(),/export \{/);
  const fun=await fetch(base+'/fun.js');assert.equal(fun.status,200);assert.match(await fun.text(),/attackersToKing/);
 } finally{await new Promise(ok=>server.close(ok));db.close();}
});

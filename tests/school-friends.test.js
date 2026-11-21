import test from 'node:test';
import assert from 'node:assert/strict';
import {openDb} from '../src/db.js';
import {loginTelegram} from '../src/auth.js';
import {schoolProgress,stageFor,chooseSchoolCategory} from '../src/school.js';
import {createInvite,requestFriend,respondFriend,removeFriend,friendsSnapshot} from '../src/friends.js';
import {insertPuzzle,startAttempt,submitMove} from '../src/puzzles.js';
import {readFileSync} from 'node:fs';
import {makeServer} from '../src/server.js';
const fixtures=JSON.parse(readFileSync(new URL('../data/legacy-demo.json',import.meta.url))).filter(p=>p.category==='mate1');
function profile(db,user,name,opt=0){db.prepare('UPDATE users SET display_name=?,friends_opt_in=? WHERE id=?').run(name,opt,user.id);return db.prepare('SELECT * FROM users WHERE id=?').get(user.id);}
test('junior learning starts with mate1 and advances only after meaningful practice',()=>{
 const db=openDb(':memory:');const u=profile(db,loginTelegram(db,'kid-school'),'Слонёнок');
 insertPuzzle(db,fixtures[0]);
 assert.equal(stageFor(db,u).name,'Шахматный следопыт');
 assert.equal(chooseSchoolCategory(db,u,()=>.9),'mate1');
 const p=schoolProgress(db,u);assert.equal(p.weekly.goal,8);assert.equal(p.weekly.solved,0);
 assert.equal(p.stage,1);assert.equal(p.sessionSize,5);db.close();
});
test('clean results unlock next stage; too many hints keep a beginner on familiar tasks',()=>{
 const db=openDb(':memory:');const u=profile(db,loginTelegram(db,'kid2'),'Ферзик');
 for(let i=0;i<12;i++){
  const id='learn:'+i;db.prepare(`INSERT INTO puzzles(id,fen,category,rating,line_json,source,created_at) VALUES(?,?,?,?,?,?,?)`)
   .run(id,'4k3/8/8/8/8/8/8/4K3 w - - 0 1','mate1',500,'["e1e2"]','test',Date.now());
  db.prepare('INSERT INTO completions(user_id,puzzle_id,points,solved_at) VALUES(?,?,?,?)').run(u.id,id,1,Date.now()-i*1000);
 }
 assert.equal(schoolProgress(db,u).stage,1,'missing successful attempts is not treated as clean practice');
 // For real completions, the server has corresponding solved attempts.
 for(let i=0;i<12;i++)db.prepare(`INSERT INTO attempts(id,user_id,puzzle_id,current_fen,errors,hints,status,started_at,updated_at)
  VALUES(?,?,?,?,?,?,?,?,?)`).run('learn-attempt:'+i,u.id,'learn:'+i,'4k3/8/8/8/8/8/8/4K3 w - - 0 1',0,0,'solved',Date.now()-i*1000,Date.now()-i*1000);
 assert.equal(schoolProgress(db,u).stage,2);db.close();
});
test('friends require two independent consents, one-use codes, privacy toggles and safe deletion',()=>{
 const db=openDb(':memory:');let a=profile(db,loginTelegram(db,'friendA'),'Белый конь');let b=profile(db,loginTelegram(db,'friendB'),'Чёрный слон');
 assert.throws(()=>createInvite(db,a),/disabled/);
 assert.equal(friendsSnapshot(db,a).enabled,false);
 a=profile(db,a,'Белый конь',1);b=profile(db,b,'Чёрный слон',1);
 const invitation=createInvite(db,a);assert.equal(invitation.code.length,24);
 assert.equal(requestFriend(db,b,invitation.code).ok,true);
 assert.throws(()=>requestFriend(db,b,invitation.code),/not available/);
 assert.equal(friendsSnapshot(db,a).friends.length,0,'request alone must not create a connection');
 assert.equal(friendsSnapshot(db,a).incoming[0].name,'Чёрный слон');
 const req=friendsSnapshot(db,a).incoming[0].id;
 assert.throws(()=>respondFriend(db,b,req,true),/not found/);
 respondFriend(db,a,req,true);
 assert.equal(friendsSnapshot(db,a).friends[0].name,'Чёрный слон');
 assert.equal(friendsSnapshot(db,b).friends[0].name,'Белый конь');
 const otherId=b.id;
 db.prepare('UPDATE users SET friends_opt_in=0 WHERE id=?').run(b.id);
 assert.deepEqual(friendsSnapshot(db,a).friends,[],'private profiles must be hidden immediately');
 db.prepare('UPDATE users SET friends_opt_in=1 WHERE id=?').run(b.id);
 assert.equal(removeFriend(db,a,otherId).removed,true);
 assert.equal(friendsSnapshot(db,b).friends.length,0);
 db.close();
});
test('weekly friend counts only reflect verified completions, with no global search',()=>{
 const db=openDb(':memory:');const a=profile(db,loginTelegram(db,'friendC'),'Алиса',1);const b=profile(db,loginTelegram(db,'friendD'),'Борис',1);
 const invite=createInvite(db,a);requestFriend(db,b,invite.code);respondFriend(db,a,friendsSnapshot(db,a).incoming[0].id,true);
 insertPuzzle(db,fixtures[0]);const attempt=startAttempt(db,b,'category','mate1');
 const result=submitMove(db,b,attempt.id,fixtures[0].line[0]);assert.ok(result.completed);
 assert.equal(friendsSnapshot(db,a).friends[0].weeklySolved,1);
 const expired=Date.now()-10*86400_000;
 db.prepare('UPDATE completions SET solved_at=? WHERE user_id=?').run(expired,b.id);
 assert.equal(friendsSnapshot(db,a).friends[0].weeklySolved,0);
 db.close();
});
test('HTTP friends protection and archived public ranking',async()=>{
 const db=openDb(':memory:');const server=makeServer(db,{dev:true});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const call=async(path,token,method='GET',payload)=>{const res=await fetch(base+path,{method,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(payload!==undefined?{body:JSON.stringify(payload)}:{})});return {status:res.status,data:await res.json()};};
 try{
  const token=(await call('/api/auth/dev','', 'POST',{name:'Новичок'})).data.token;
  assert.equal((await call('/api/friends')).status,401);
  assert.equal((await call('/api/friends',token)).data.enabled,false);
  assert.equal((await call('/api/friends/invitations',token,'POST',{})).status,400);
  assert.deepEqual((await call('/api/leaderboard',token)).data.users,[]);
  const me=await call('/api/me',token);assert.equal(me.data.school.weekly.goal,8);
  assert.equal((await call('/api/me',token,'PATCH',{leaderboardOptIn:true})).status,400);
  assert.equal((await call('/api/me',token,'PATCH',{friendsOptIn:true})).status,200);
  assert.equal((await call('/api/friends/invitations',token,'POST',{})).status,201);
 }finally{await new Promise(resolve=>server.close(resolve));db.close();}
});

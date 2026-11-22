import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {initDb,getPool} from '../src/cloud-db.js';
import {createLeague,listLeagues,leagueDetails,inviteToLeague,requestLeague,decideLeagueRequest,leaveOrRemoveLeagueMember,closeLeague} from '../src/cloud-leagues.js';

test('Postgres: approval-only entry, private standings, weekly cap, removal', {skip:!process.env.DATABASE_URL}, async()=>{
 await initDb();const db=getPool(),ids=[randomUUID(),randomUUID(),randomUUID()],now=Date.now();
 for(let i=0;i<ids.length;i++)await db.query(
  'INSERT INTO users(id,telegram_id,display_name,created_at,friends_opt_in) VALUES($1,$2,$3,$4,$5)',
  [ids[i],'test-league-'+ids[i],['Капитан','Конь','Посторонний'][i],now,i<2]);
 const owner={id:ids[0],display_name:'Капитан',friends_opt_in:true};
 const member={id:ids[1],display_name:'Конь',friends_opt_in:true};
 const outsider={id:ids[2],display_name:'Посторонний',friends_opt_in:false};
 try{
  await assert.rejects(createLeague(outsider,'Посторонние'),/включи обмен/);
  const l=await createLeague(owner,'Летающие кони');
  assert.equal((await listLeagues(member)).leagues.length,0);
  const invite=await inviteToLeague(owner,l.id);
  assert.match(invite.code,/^[A-F0-9]{24}$/);
  await requestLeague(member,invite.code);
  await assert.rejects(requestLeague(member,invite.code),/ожидает/);
  const requests=(await leagueDetails(owner,l.id)).requests;
  assert.equal(requests.length,1);
  await db.query('UPDATE users SET friends_opt_in=TRUE WHERE id=$1',[ids[2]]);
  await assert.rejects(leagueDetails({...outsider,friends_opt_in:true},l.id),/недоступна/);
  await assert.rejects(decideLeagueRequest(outsider,l.id,requests[0].id,true),/только создатель/);
  await decideLeagueRequest(owner,l.id,requests[0].id,true);
  assert.equal((await leagueDetails(owner,l.id)).members.length,2);
  assert.equal((await listLeagues(member)).leagues.length,1);
  for(let i=0;i<9;i++)await db.query(
   'INSERT INTO completions(user_id,puzzle_id,category,points,solved_at) VALUES($1,$2,$3,$4,$5)',
   [ids[1],'test-league-'+ids[1]+'-'+i,'mate1',i<8?2:99,now+i]);
  const standing=(await leagueDetails(owner,l.id)).members.find(x=>x.id===ids[1]);
  assert.equal(standing.weeklySolved,8);
  assert.equal(standing.weeklyPoints,16);
  await assert.rejects(leaveOrRemoveLeagueMember(outsider,l.id,ids[1]),/только создатель/);
  await db.query('UPDATE users SET friends_opt_in=FALSE WHERE id=$1',[ids[1]]);
  assert.ok(!(await leagueDetails(owner,l.id)).members.some(x=>x.id===ids[1]));
  assert.equal((await leaveOrRemoveLeagueMember(owner,l.id,ids[1])).removed,true);
  assert.deepEqual(await closeLeague(owner,l.id),{closed:true});
 }finally{
  await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[ids]);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {initDb,getPool} from '../src/cloud-db.js';
import {normalizeNickname,updateProfile} from '../src/cloud-learning.js';
import {playerDirectory,requestFriendById,pageIndex} from '../src/social-directory.js';
import {friendsSnapshot,respondFriend} from '../src/cloud-friends.js';
import {createLeague,leagueDetails,listLeagues} from '../src/cloud-leagues.js';
import {invitePlayersToLeague,leagueInvitationInbox,respondLeagueInvitation,socialPendingCounts} from '../src/league-direct-invites.js';

const text=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('nicknames are unique normalized pseudonyms with no contact names',()=>{
 assert.deepEqual(normalizeNickname(' ЛЁША_2 '),{name:'ЛЁША_2',key:'лёша_2'});
 for(const n of ['Иван Петров','@name','Ivan@example.com','John.Smith','x','a'.repeat(25)])
   assert.throws(()=>normalizeNickname(n),/Никнейм/);
 assert.equal(pageIndex('0'),0);
 assert.equal(pageIndex('20'),20);
 assert.throws(()=>pageIndex('21'),/Неверная страница/);
});
test('directory never exposes Telegram IDs, scores or contacts',()=>{
 const query=text('src/social-directory.js');
 assert.match(query,/directory_visible=TRUE/);
 assert.match(query,/friends_opt_in=TRUE/);
 assert.match(query,/nickname_key IS NOT NULL/);
 assert.match(query,/admin_account_merges/);
 assert.doesNotMatch(query,/SELECT u\\.\\*|u.telegram_id|u.points|u.solved_count/i);
});
test('UI and API connect nickname, friend requests, league invitation approval',()=>{
 const html=text('public/index.html'),app=text('public/app.js'),api=text('api/index.js'),db=text('src/cloud-db.js');
 for(const id of ['directoryVisible','playerSearch','directoryList','leagueInbox',
  'leaguePlayerCandidates','sendLeagueInvitations'])assert.match(html,new RegExp('id="'+id+'"'));
 for(const route of ['/api/players','/api/friends/requests/direct','/api/leagues/invitations',
  '/api/social/pending'])assert.ok(api.includes(route),route);
 assert.match(app,/loadPlayerDirectory/);
 assert.ok(app.includes('/api/leagues/invitations/'));
 assert.match(db,/users_unique_nickname/);
 assert.match(db,/league_direct_invitations/);
});
test('Postgres: unique nickname, opt-in directory, requests, league invitations and privacy',
 {skip:!process.env.DATABASE_URL},async()=>{
 await initDb();
 const db=getPool(),ids=Array.from({length:4},()=>randomUUID()),suffix=ids[0].slice(0,7);
 const users=[];
 for(let i=0;i<4;i++){
  await db.query('INSERT INTO users(id,telegram_id,created_at) VALUES($1,$2,$3)',
   [ids[i],'social-directory-test-'+ids[i],Date.now()-i]);
  users.push((await db.query('SELECT * FROM users WHERE id=$1',[ids[i]])).rows[0]);
 }
 const [a,b,c,hidden]=users;
 const alice='Alpha_'+suffix,bob='Beta_'+suffix,cory='Cory_'+suffix,quiet='Quiet_'+suffix;
 try{
  const first=await updateProfile(a,{displayName:alice,friendsOptIn:true,directoryVisible:true});
  assert.equal(first.firstRegistration,true);
  assert.equal(first.directory_visible,true);
  const sameNick=await updateProfile(b,{displayName:alice.toUpperCase(),friendsOptIn:true,directoryVisible:true})
   .then(()=>null,e=>e);
  assert.match(sameNick?.message||'',/уже занят/);
  await updateProfile(b,{displayName:bob,friendsOptIn:true,directoryVisible:true});
  await updateProfile(c,{displayName:cory,friendsOptIn:true,directoryVisible:true});
  await updateProfile(hidden,{displayName:quiet,friendsOptIn:true,directoryVisible:false});
  const activeA=(await db.query('SELECT * FROM users WHERE id=$1',[a.id])).rows[0];
  await assert.rejects(requestFriendById(a,hidden.id),/не доступен|недоступен/);
  const listed=await playerDirectory(activeA,{page:0,q:suffix});
  assert.deepEqual(new Set(listed.players.map(x=>x.name)),new Set([bob,cory]));
  assert.equal('points' in listed.players[0],false);
  assert.equal('telegram_id' in listed.players[0],false);

  await requestFriendById(a,b.id);
  await assert.rejects(requestFriendById(a,b.id),/уже отправлен/);
  let incoming=await friendsSnapshot((await db.query('SELECT * FROM users WHERE id=$1',[b.id])).rows[0]);
  assert.equal(incoming.incoming.length,1);
  assert.equal(incoming.incoming[0].name,alice);
  await respondFriend(b,incoming.incoming[0].id,true);
  assert.equal((await playerDirectory(activeA,{q:bob})).players[0].isFriend,true);
  assert.equal((await friendsSnapshot((await db.query('SELECT * FROM users WHERE id=$1',[a.id])).rows[0])).friends.length,1);
  await requestFriendById(a,c.id);
  const cUser=(await db.query('SELECT * FROM users WHERE id=$1',[c.id])).rows[0];
  const refusal=await friendsSnapshot(cUser);
  await respondFriend(c,refusal.incoming[0].id,false);
  await assert.rejects(requestFriendById(a,c.id),/через неделю/);

  const league=await createLeague(a,'Команда '+suffix);
  const sent=await invitePlayersToLeague(a,league.id,[b.id,c.id]);
  assert.equal(sent.sent,2);
  const before=await listLeagues(b);
  assert.equal(before.leagues.length,0,'An invitation must never join automatically');
  const bInv=(await leagueInvitationInbox((await db.query('SELECT * FROM users WHERE id=$1',[b.id])).rows[0])).invitations;
  assert.equal(bInv.length,1);
  assert.equal(bInv[0].leagueName,'Команда '+suffix);
  assert.equal((await socialPendingCounts((await db.query('SELECT * FROM users WHERE id=$1',[b.id])).rows[0])).leagues,1);
  assert.equal((await respondLeagueInvitation(b,bInv[0].id,true)).joined,true);
  assert.equal((await listLeagues(b)).leagues.length,1);
  await assert.rejects(respondLeagueInvitation(b,bInv[0].id,true),/недействительно/);
  const cInv=(await leagueInvitationInbox(cUser)).invitations;
  assert.equal(cInv.length,1);
  await respondLeagueInvitation(c,cInv[0].id,false);
  assert.equal((await listLeagues(cUser)).leagues.length,0);
  await assert.rejects(invitePlayersToLeague(a,league.id,[c.id]),/через неделю/);
  assert.equal((await leagueDetails(a,league.id)).memberCount,2);
  await updateProfile(b,{friendsOptIn:false});
  assert.equal((await playerDirectory(activeA,{q:bob})).players.length,0);
  assert.equal((await friendsSnapshot((await db.query('SELECT * FROM users WHERE id=$1',[a.id])).rows[0])).friends.length,0);
  await assert.rejects(invitePlayersToLeague(a,league.id,[hidden.id]),/недоступны/);
 }finally{
  await db.query('DELETE FROM users WHERE id=ANY($1::uuid[])',[ids]);
 }
});

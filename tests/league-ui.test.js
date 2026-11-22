import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('private league UI provides codes and creator approvals',()=>{
 const html=read('public/index.html'),app=read('public/app.js');
 for(const token of ['data-mode="leagues"','id="leagueRequests"','id="leagueCode"','id="createLeague"','id="joinLeague"'])
   assert.ok(html.includes(token),token);
 assert.match(app,/openLeagues/);
 assert.match(app,/showLeague/);
 assert.match(app,/\/api\/leagues\/join/);
 assert.match(app,/for\(const \[action,label,kind\]/);
 assert.match(html,/подтверждёнными друзьями и участниками моих лиг/);
});

test('league API requires approval and never offers public search',()=>{
 const api=read('api/index.js'),db=read('src/cloud-db.js'),league=read('src/cloud-leagues.js');
 assert.match(api,/requestLeague/);
 assert.match(api,/decideLeagueRequest/);
 assert.match(league,/owner_id!==user.id/);
 assert.match(league,/LEAGUE_WEEKLY_LIMIT/);
 assert.match(league,/ORDER BY solved_at ASC,puzzle_id ASC LIMIT 8/);
 assert.match(db,/CREATE TABLE IF NOT EXISTS league_members/);
 assert.doesNotMatch(api,/\/api\/leagues\/search/);
});

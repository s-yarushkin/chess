import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeLeagueName,isLeagueCode,leagueCodeHash,LEAGUE_MEMBER_LIMIT,LEAGUE_WEEKLY_LIMIT,LEAGUE_MAX_JOINED} from '../src/league-utils.js';

test('league names and invite codes are bounded',()=>{
 assert.equal(normalizeLeagueName('  Летающие    кони  '),'Летающие кони');
 assert.throws(()=>normalizeLeagueName('<script>'),/Название/);
 assert.throws(()=>normalizeLeagueName('x'.repeat(37)),/Название/);
 assert.equal(isLeagueCode('A'.repeat(24)),true);
 assert.equal(isLeagueCode('A'.repeat(23)),false);
 assert.equal(leagueCodeHash('A'.repeat(24)),leagueCodeHash('a'.repeat(24)));
 assert.equal(leagueCodeHash('A'.repeat(24)).length,64);
 assert.equal(LEAGUE_MEMBER_LIMIT,20);
 assert.equal(LEAGUE_WEEKLY_LIMIT,8);
 assert.equal(LEAGUE_MAX_JOINED,3);
});

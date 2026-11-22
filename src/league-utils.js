import {createHash} from 'node:crypto';
export const LEAGUE_WEEKLY_LIMIT=8;
export const LEAGUE_MEMBER_LIMIT=20;
export const LEAGUE_MAX_JOINED=3;
export const LEAGUE_INVITE_DURATION=7*86400_000;
export const LEAGUE_UUID=/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export const LEAGUE_CODE=/^[a-f\d]{24}$/i;
export function normalizeLeagueName(input){
  if(typeof input!=='string')throw Error('Название лиги должно быть текстом');
  const name=input.normalize('NFC').trim().replace(/\s+/g,' ');
  if(name.length<2||name.length>36||/[<>\u0000-\u001f]/.test(name))throw Error('Название лиги: от 2 до 36 символов');
  return name;
}
export const isLeagueCode=code=>typeof code==='string'&&LEAGUE_CODE.test(code.trim());
export const leagueCodeHash=code=>createHash('sha256').update('chess-league-v1:'+String(code).trim().toUpperCase()).digest('hex');

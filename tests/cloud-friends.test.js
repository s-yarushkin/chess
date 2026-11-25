import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {inviteDigest,friendPair,validInviteCode,friendsSnapshot} from '../src/cloud-friends.js';

test('friend invite codes are high entropy, normalized and not stored raw',()=>{
 assert.equal(validInviteCode('0123456789abcdef01234567'),true);
 assert.equal(validInviteCode('AABBCCDDEEFF001122334455'),true);
 for(const bad of ['','one','a'.repeat(23),'a'.repeat(25),'x'.repeat(24)])assert.equal(validInviteCode(bad),false);
 const digest=inviteDigest('AABBCCDDEEFF001122334455');
 assert.match(digest,/^[0-9a-f]{64}$/);
 assert.equal(digest,inviteDigest('aabbccddeeff001122334455'));
 assert.notEqual(digest,'AABBCCDDEEFF001122334455');
});
test('friend pairs have stable ordering',()=>{
 assert.deepEqual(friendPair('b','a'),friendPair('a','b'));
});
test('disabled progress sharing reveals no friends, requests or activity',async()=>{
 assert.deepEqual(await friendsSnapshot({friends_opt_in:false}),{
  enabled:false,friends:[],incoming:[],outgoing:[],privacy:'Обмен выключен. Друзья не видят твой прогресс.'
 });
});
test('friend routes, opt-in and storage wired without public search',()=>{
 const api=readFileSync(new URL('../api/index.js',import.meta.url),'utf8');
 const db=readFileSync(new URL('../src/cloud-db.js',import.meta.url),'utf8');
 const profile=readFileSync(new URL('../src/cloud-learning.js',import.meta.url),'utf8');
 assert.ok(api.includes('friendsEnabled:true'));
 assert.ok(api.includes("path==='/api/friends/invitations'"));
 assert.ok(api.includes('respondFriend(user'));
 assert.ok(api.includes('friendsSnapshot(user'));
 assert.ok(db.includes('CREATE TABLE IF NOT EXISTS friend_invites'));
 assert.ok(db.includes('CREATE TABLE IF NOT EXISTS friendships'));
 assert.ok(profile.includes('friendsOptIn:!!u.friends_opt_in'));
 assert.ok(profile.includes('friends_opt_in=$3'));
 assert.equal(api.includes('/api/users/search'),false);
});

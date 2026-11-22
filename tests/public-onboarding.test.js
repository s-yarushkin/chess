import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('onboarding welcomes all players and asks them to choose a name',()=>{
 const html=read('public/index.html'),client=read('public/app.js');
 assert.match(html,/8-летний Алексей и его папа Сергей/);
 assert.match(html,/Напиши своё имя или никнейм/);
 assert.doesNotMatch(html,/Закрытый тест|приглашённых взрослых|Детские аккаунты пока/);
 assert.match(client,/firstTimeWelcome/);
});
test('Vercel API advertises public access and keeps friendships private',()=>{
 const api=read('api/index.js'),auth=read('src/cloud-learning.js');
 assert.match(api,/publicAccess:true/);
 assert.match(api,/friendsEnabled:true/);
 assert.doesNotMatch(api,/pilot:true|закрытом пилоте|родительского управления/);
 assert.doesNotMatch(auth,/PILOT_TELEGRAM_IDS/);
 assert.match(auth,/timingSafeEqual/);
});

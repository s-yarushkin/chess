import {parseFen,legal,key,side,apply} from '/chess.js';
import {attackersToKing,encouragement} from '/fun.js';

const $=id=>document.getElementById(id);
const GLYPHS={K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟︎',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟︎'};
const PIECES={k:'король',q:'ферзь',r:'ладья',b:'слон',n:'конь',p:'пешка'};
const labels={progressive:'Школьный путь',mate1:'Мат в один ход',mate2:'Мат в два хода',mate3:'Мат в три хода',draw:'Спаси ничью'};
const points={mate1:1,mate2:2,mate3:3,draw:3};
const state={token:sessionStorage.getItem('chess_session')||'',me:null,attempt:null,selected:-1,mode:'progressive',busy:false,lastMove:[],hints:0,sessionDone:0};
const tg=window.Telegram?.WebApp;
const prefersReduce=window.matchMedia?.('(prefers-reduced-motion: reduce)');
const setting=(k,otherwise)=>{try{return localStorage.getItem(k)===null?otherwise:localStorage.getItem(k)==='true';}catch{return otherwise;}};
const prefs={sound:setting('chess_sound',false),effects:setting('chess_effects',true)};
let audio=null,toastTimer,fxTimer,fxSequence=0;
try{tg?.ready();tg?.expand();}catch{}

async function api(path,options={}){
 const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(state.token?{'Authorization':'Bearer '+state.token}:{}),...options.headers}});
 let data;try{data=await res.json();}catch{throw Error('Не удалось получить ответ сервера');}
 if(!res.ok)throw Error(data.error||'Ошибка соединения');return data;
}
function setPreference(name,on){prefs[name]=on;try{localStorage.setItem('chess_'+name,String(on));}catch{}renderPreferences();}
function renderPreferences(){
 const b=$('soundButton');b.textContent=prefs.sound?'♫':'♪';b.setAttribute('aria-pressed',String(prefs.sound));b.setAttribute('aria-label',prefs.sound?'Выключить звук':'Включить звук');b.title=prefs.sound?'Звук включён':'Звук выключен';
 const f=$('effectsButton');f.textContent=prefs.effects?'✨':'✧';f.setAttribute('aria-pressed',String(prefs.effects));f.setAttribute('aria-label',prefs.effects?'Отключить эффекты':'Включить эффекты');f.title=prefs.effects?'Эффекты включены':'Эффекты выключены';
}
function sound(type){
 if(!prefs.sound)return;
 try{
  audio=audio||new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')void audio.resume();
  const tones=type==='success'?[392,523,659,784]:type==='error'?[180,145]:[390];
  tones.forEach((hz,i)=>{const o=audio.createOscillator(),g=audio.createGain();o.type='sine';o.frequency.value=hz;const t=audio.currentTime+i*.11;
   g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.032,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+.19);
   o.connect(g).connect(audio.destination);o.start(t);o.stop(t+.2);});
 }catch{}
}
function haptic(type){try{tg?.HapticFeedback?.notificationOccurred(type);}catch{}}
function notice(message,type=''){const b=$('notice');b.className='notice '+type;b.textContent=message;}
function toast(message){const b=$('toast');b.textContent=message;b.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>b.classList.remove('show'),2700);}
function sqName(i){return 'abcdefgh'[i&7]+(8-(i>>4));}
function buttonStatus(){const active=state.attempt?.status==='active';$('hint').disabled=state.busy||!active;$('skip').disabled=state.busy||!active;$('next').disabled=state.busy||!state.attempt||active;}

function board(){
 const s=state.attempt?parseFen(state.attempt.position):parseFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
 const moves=state.attempt?.status==='active'?legal(s):[];
 const targets=new Set(moves.filter(m=>m[0]===state.selected).map(m=>m[1]));const frag=document.createDocumentFragment();
 for(let rank=0;rank<8;rank++)for(let file=0;file<8;file++){
  const i=rank*16+file,p=s.b[i],white=side(p)===1,btn=document.createElement('button');btn.type='button';
  btn.className='square '+((rank+file)%2===0?'light':'dark');btn.setAttribute('role','gridcell');
  if(i===state.selected)btn.classList.add('selected');if(state.lastMove.includes(i))btn.classList.add('last-move');
  if(targets.has(i))btn.classList.add(p==='.'?'target':'capture');
  if(p!=='.'){
   const span=document.createElement('span');span.textContent=GLYPHS[p];span.className='piece '+(white?'white':'black');btn.append(span);
   const mark=document.createElement('span');mark.textContent=white?'Б':'Ч';mark.className='team '+(white?'white':'black');btn.append(mark);
  }
  if(file===0){const co=document.createElement('span');co.className='coord';co.textContent=8-rank;btn.append(co);}
  if(rank===7){const co=document.createElement('span');co.className='coord file';co.textContent='abcdefgh'[file];btn.append(co);}
  btn.setAttribute('aria-label',`${p==='.'?'Пустая клетка':(white?'Белая ':'Чёрная ')+PIECES[p.toLowerCase()]} ${sqName(i)}`);
  btn.addEventListener('click',()=>choose(i));frag.append(btn);
 }
 $('board').replaceChildren(frag);$('turnDisc').style.background=s.t===1?'#fff':'#18333f';
 $('turnLabel').textContent=s.t===1?'Ход белых':'Ход чёрных';buttonStatus();
}
function resetFx(){clearTimeout(fxTimer);const fx=$('effects');fx.replaceChildren();fx.className='fx';$('boardWrap').classList.remove('bad-move');}
function svgEl(name,attrs={}){const e=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,String(v));return e;}
function successFX(category,displayPoints){
 resetFx();if(!prefs.effects||prefersReduce?.matches)return;
 const fx=$('effects');fx.classList.add('celebrate');
 const s=parseFen(state.attempt.position),king=s.b.indexOf(s.t===1?'K':'k');
 if(category!=='draw'&&king>=0){
  const attackers=attackersToKing(s).slice(0,5),svg=svgEl('svg',{viewBox:'0 0 800 800',preserveAspectRatio:'none'});
  attackers.forEach((from,i)=>{
   const beam=svgEl('line',{x1:(from&7)*100+50,y1:(from>>4)*100+50,x2:(king&7)*100+50,y2:(king>>4)*100+50});
   beam.style.animationDelay=`${i*.12}s`;svg.append(beam);
  });
  if(attackers.length){const ring=document.createElement('span');ring.className='king-ring';ring.style.left=`${((king&7)+.5)*12.5}%`;ring.style.top=`${((king>>4)+.5)*12.5}%`;fx.append(ring);}fx.append(svg);
 }
 const title=document.createElement('div');title.className='victory-banner';
 const big=document.createElement('strong');big.textContent=category==='draw'?'НИЧЬЯ СПАСЕНА!':'ШАХ И МАТ!';
 const small=document.createElement('small');small.textContent=`+${displayPoints} ★ · ${category==='draw'?'Отличная защита!':encouragement[fxSequence++%encouragement.length]}`;
 title.append(big,small);fx.append(title);
 for(let i=0;i<18;i++){
  const dot=document.createElement('span');dot.className='spark';dot.style.left=`${7+Math.random()*86}%`;dot.style.top=`${5+Math.random()*75}%`;
  dot.style.setProperty('--dx',`${Math.round((Math.random()-.5)*130)}px`);dot.style.setProperty('--dy',`${Math.round(35+Math.random()*95)}px`);
  dot.style.setProperty('--delay',`${Math.random()*.32}s`);dot.style.background=['#ffcd5b','#7ed9df','#ff89a7','#aab0ff'][i%4];fx.append(dot);
 }
 fxTimer=setTimeout(resetFx,2100);
}
function wrongMoveFX(){if(prefs.effects&&!prefersReduce?.matches){$('boardWrap').classList.remove('bad-move');void $('boardWrap').offsetWidth;$('boardWrap').classList.add('bad-move');setTimeout(()=>$('boardWrap').classList.remove('bad-move'),450);}sound('error');haptic('error');}
function victoryText(result){
 if(!result.firstSolve)return 'Задача пройдена! Повторные баллы не начисляются.';
 return `${result.category==='draw'?'Отличная защита!':'Мат найден!'} +${result.points} ★. Главное — понял идею!`; 
}
async function choose(i){
 if(!state.attempt||state.busy||state.attempt.status!=='active')return;
 const s=parseFen(state.attempt.position),moves=legal(s);
 if(side(s.b[i])===s.t){state.selected=state.selected===i?-1:i;board();return;}
 const candidates=moves.filter(m=>m[0]===state.selected&&m[1]===i);
 if(!candidates.length){state.selected=-1;board();return;}
 let m=candidates[0];
 if(candidates.length>1){const choice=window.prompt('Превращение: q — ферзь, r — ладья, b — слон, n — конь','q');
  if(choice===null)return;m=candidates.find(move=>move[2]===choice.trim().toLowerCase());if(!m){toast('Выбери q, r, b или n');return;}}
 const from=m[0],to=m[1],attemptId=state.attempt.id;state.busy=true;buttonStatus();
 try{
  const result=await api(`/api/attempts/${attemptId}/move`,{method:'POST',body:JSON.stringify({uci:key(m)})});
  if(state.attempt?.id!==attemptId)return;
  state.selected=-1;
  if(!result.correct){state.attempt.errors=result.errors;notice(result.message+' Попробуй другой план.','error');wrongMoveFX();return;}
  state.attempt.position=result.position;state.attempt.status=result.completed?'solved':'active';
  state.lastMove=result.defense?[result.defense.slice(0,2),result.defense.slice(2,4)].map(sq=>{const f='abcdefgh'.indexOf(sq[0]),r=8-Number(sq[1]);return r*16+f;}):[from,to];
  if(result.completed){
   if(result.firstSolve){state.sessionDone=Math.min(5,state.sessionDone+1);$('sessionCount').textContent=state.sessionDone+'/5';}
   notice(victoryText(result),'success');
   if(result.lesson?.reflection)$('description').textContent='Урок: '+result.lesson.focus+'. '+result.lesson.reflection;
   board();successFX(result.category,result.points);sound('success');haptic('success');
   const oldBadges=new Set(state.me?.game?.badges.filter(b=>b.earned).map(b=>b.id)||[]);
   try{await refreshMe();const newly=state.me.game.badges.filter(b=>b.earned&&!oldBadges.has(b.id));
    if(newly.length)toast(`Новая награда: ${newly.map(b=>b.title).join(', ')}!`);
    else if(state.sessionDone===5)toast('🏅 Миссия из пяти задач выполнена! Можно отдохнуть.');
    else if(state.me.game.streak>=3)toast(`⚡ ${state.me.game.streak} чистых решений — отличный расчёт!`);
   }catch{toast('Задача решена. Не удалось обновить профиль.');}
  }else{notice(`Хорошо! ${result.defense?'Соперник ответил '+result.defense+'. Твой ход!':'Продолжай комбинацию!'}`);sound('step');}
 }catch(e){notice(e.message,'error');}finally{state.busy=false;board();}
}
function displayBadges(){
 const badges=state.me?.game?.badges||[],container=$('medals');container.replaceChildren();
 for(const badge of badges){
  const item=document.createElement('div');item.className='medal '+(badge.earned?'earned':'locked');
  const symbol=document.createElement('span');symbol.className='medal-symbol';symbol.textContent=badge.earned?badge.icon:'🔒';
  const info=document.createElement('div');const head=document.createElement('strong');head.textContent=badge.title;
  const detail=document.createElement('small');detail.textContent=badge.description;
  const meter=document.createElement('span');meter.className='medal-count';meter.textContent=badge.earned?'Получено':`${badge.progress}/${badge.target}`;
  info.append(head,detail);item.append(symbol,info,meter);container.append(item);
 }
 $('badgeCount').textContent=badges.filter(b=>b.earned).length;
}
async function refreshMe(){
 const me=await api('/api/me');state.me=me;
 $('points').textContent=me.points;$('solved').textContent=me.solved;
 $('status').textContent=me.displayName||'Заполни профиль';$('name').value=me.displayName;
 $('friendsOptIn').checked=me.friendsOptIn;
 $('streak').textContent=me.game.streak;
 const p=me.game.progress;$('levelName').textContent=`Уровень ${me.game.level} · ${me.game.levelName}`;
 $('levelCount').textContent=p.target?`${p.current}/${p.target}`:'Максимальный уровень';
 const pct=p.target?Math.round(p.current/p.target*100):100;
 $('levelFill').style.width=`${pct}%`;
 $('levelBar').setAttribute('aria-valuemax',String(p.target||1));$('levelBar').setAttribute('aria-valuenow',String(p.target?p.current:1));
 const week=me.school?.weekly;if(week){$('schoolStage').textContent=me.school.name;
  $('weekMission').textContent=`За 7 дней: ${week.solved}/${week.goal} задач${week.completed?' — цель достигнута!':''}`;
  $('weeklyFill').style.width=Math.min(100,week.solved/week.goal*100)+'%';
 }
 $('sessionCount').textContent=state.sessionDone+'/5';
 displayBadges();
}
async function syncCatalog(){
 try{const catalog=await api('/api/catalog');const counts=Object.fromEntries(catalog.counts.map(c=>[c.category,c.count]));
  for(const b of document.querySelectorAll('.tab[data-mode]')){
   if(['mate1','mate2','mate3','draw'].includes(b.dataset.mode)){
    b.disabled=!counts[b.dataset.mode];b.title=b.disabled?'Этот раздел появится после проверки задач.':'';
   }
  }
 }catch{/* Availability is checked again on the server. */}
}
async function newPuzzle(){
 if(state.busy)return;state.busy=true;state.selected=-1;state.lastMove=[];state.hints=0;
 $('hintMessage').hidden=true;resetFx();$('challenge').textContent=labels[state.mode];buttonStatus();
 try{
  const params=state.mode==='progressive'?{mode:'progressive'}:{mode:'category',category:state.mode};
  const a=await api('/api/attempts',{method:'POST',body:JSON.stringify(params)});state.attempt=a;
  $('title').textContent=labels[a.category];$('description').textContent=a.lesson?.prompt||'Найди шах и ответ соперника. Затем выбирай ход.';
  $('difficulty').textContent=a.rating<650?'Начальный':a.rating<900?'Знакомый':a.rating<1200?'Интересный':'Сложный';$('reward').textContent='★ '+(points[a.category]||0);
  notice(a.lesson?.prompt||'Твой ход! Выбери свою фигуру — увидишь доступные клетки.');
 }catch(e){state.attempt=null;notice(e.message,'error');$('title').textContent='Задачи пока не загружены';
  $('description').textContent='Эта категория откроется после наполнения проверенными шахматными позициями.';
 }finally{state.busy=false;board();}
}
async function hint(){
 if(!state.attempt||state.busy||state.attempt.status!=='active')return;
 state.busy=true;buttonStatus();
 try{const data=await api(`/api/attempts/${state.attempt.id}/hint`,{method:'POST',body:'{}'}),h=data.hint;
  $('hintMessage').hidden=false;$('hintMessage').textContent=h.kind==='piece'?`Посмотри на фигуру ${h.square}.`:`Попробуй ${h.from} → ${h.to}.`;
  $('reward').textContent='★ '+Math.max(1,(points[state.attempt.category]||0)-1);toast('Подсказка помогает учиться. Хотя бы 1 ★ останется!');
 }catch(e){toast(e.message);}finally{state.busy=false;buttonStatus();}
}
async function changeMode(mode){
 if(state.busy)return;
 if(mode==='friends'){await openFriends();return;}
 state.mode=mode;
 for(const el of document.querySelectorAll('.tab'))el.classList.toggle('selected',el.dataset.mode===mode);
 await newPuzzle();
}
const messageNode=(tag,text,cls='')=>{const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;};
async function openFriends(){
 $('friends').showModal();await refreshFriends();
}
async function refreshFriends(){
 try{
  const result=await api('/api/friends');
  $('friendActions').hidden=!result.enabled;
  $('friendStatus').textContent=result.enabled?'✅ Закрытый круг включён. Показываются только подтверждённые друзья.':'В профиле включи «делиться прогрессом» с разрешения взрослого.';
  const list=$('friendsList');list.replaceChildren();
  for(const friend of result.friends){
   const row=messageNode('div','','friend-row');
   const description=messageNode('div',`${friend.name} · за неделю ${friend.weeklySolved}/8 задач`);
   const remove=messageNode('button','Удалить','button outline');remove.type='button';
   remove.addEventListener('click',async()=>{if(!window.confirm('Убрать друга из отряда?'))return;
    try{await api('/api/friends/'+friend.id,{method:'DELETE'});await refreshFriends();}catch(e){toast(e.message);}});
   row.append(description,remove);list.append(row);
  }
  if(!result.friends.length)list.append(messageNode('p','Пока друзей нет. Можно пригласить одноклассника лично.'));
  const requests=$('friendRequests');requests.replaceChildren();
  for(const request of result.incoming){
   const row=messageNode('div','','friend-row');row.append(messageNode('span',request.name+' хочет дружить'));
   for(const [action,label] of [['accept','Принять'],['decline','Отклонить']]){
    const b=messageNode('button',label,'button '+(action==='accept'?'primary':'outline'));b.type='button';
    b.addEventListener('click',async()=>{try{await api(`/api/friends/requests/${request.id}/${action}`,{method:'POST',body:'{}'});await refreshFriends();}catch(e){toast(e.message);}});row.append(b);
   }requests.append(row);
  }
  for(const outgoing of result.outgoing)requests.append(messageNode('p',`⏳ Запрос для «${outgoing.name}» ожидает подтверждения.`));
  if(!result.incoming.length&&!result.outgoing.length)requests.append(messageNode('p','Новых запросов нет.'));
 }catch(e){$('friendStatus').textContent=e.message;}
}
async function begin(){
 try{const config=await api('/api/config');
  if(!state.token){if(tg?.initData){const login=await api('/api/auth/telegram',{method:'POST',body:JSON.stringify({initData:tg.initData})});
   state.token=login.token;sessionStorage.setItem('chess_session',state.token);
  }else{if(config.demo)$('devLogin').hidden=false;$('auth').showModal();return;}}
  await refreshMe();await syncCatalog();if(!state.me.displayName){$('profile').showModal();return;}await newPuzzle();
 }catch(e){sessionStorage.removeItem('chess_session');state.token='';$('authError').textContent=e.message;$('auth').showModal();}
}
$('devEnter').addEventListener('click',async()=>{try{const login=await api('/api/auth/dev',{method:'POST',body:JSON.stringify({name:$('devName').value})});
 state.token=login.token;sessionStorage.setItem('chess_session',state.token);$('auth').close();await refreshMe();await newPuzzle();
 }catch(e){$('authError').textContent=e.message;}});
$('saveProfile').addEventListener('click',async()=>{try{await api('/api/me',{method:'PATCH',body:JSON.stringify({displayName:$('name').value,friendsOptIn:$('friendsOptIn').checked})});
 $('profile').close();await refreshMe();if(!state.attempt)await newPuzzle();}catch(e){$('profileError').textContent=e.message;}});
$('createFriendCode').addEventListener('click',async()=>{try{const d=await api('/api/friends/invitations',{method:'POST',body:'{}'});
  const code=$('inviteResult');code.hidden=false;code.textContent='Код для друга: '+d.code+' · 48 часов. Передавай только знакомым.';
  if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(d.code).then(()=>toast('Код скопирован')).catch(()=>{});}
 }catch(e){toast(e.message);}});
$('joinFriend').addEventListener('click',async()=>{try{await api('/api/friends/requests',{method:'POST',body:JSON.stringify({code:$('friendCode').value.trim()})});
 $('friendCode').value='';toast('Запрос отправлен!');await refreshFriends();}catch(e){toast(e.message);}});
$('profileButton').addEventListener('click',()=>{if(state.me)$('profile').showModal();});
const openMedals=()=>{if(state.me){displayBadges();$('achievements').showModal();}};
$('achievementsButton').addEventListener('click',openMedals);$('badgesLink').addEventListener('click',openMedals);
$('soundButton').addEventListener('click',()=>{setPreference('sound',!prefs.sound);if(prefs.sound)sound('success');});
$('effectsButton').addEventListener('click',()=>{setPreference('effects',!prefs.effects);if(!prefs.effects)resetFx();});
$('hint').addEventListener('click',hint);$('skip').addEventListener('click',newPuzzle);$('next').addEventListener('click',newPuzzle);
for(const b of document.querySelectorAll('.tab'))b.addEventListener('click',()=>changeMode(b.dataset.mode));
renderPreferences();buttonStatus();void begin();

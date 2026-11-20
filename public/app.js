import {parseFen,legal,key,side,index,apply,fenOf} from '/chess.js';
const $=id=>document.getElementById(id);
const GLYPHS={K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞',P:'♟︎',k:'♚',q:'♛',r:'♜',b:'♝',n:'♞',p:'♟︎'};
const labels={progressive:'По порядку',mate1:'Мат в один ход',mate2:'Мат в два хода',mate3:'Мат в три хода',draw:'Спаси ничью'};
const state={token:sessionStorage.getItem('chess_session')||'',me:null,attempt:null,selected:-1,mode:'progressive',busy:false,hint:null};
let lastSound=null;
const tg=window.Telegram?.WebApp;
try{tg?.ready();tg?.expand();}catch{}
async function api(path,options={}){
 const res=await fetch(path,{...options,headers:{'Content-Type':'application/json',...(state.token?{'Authorization':'Bearer '+state.token}:{}),...options.headers}});
 const data=await res.json();if(!res.ok)throw Error(data.error||'Ошибка соединения');return data;
}
function notice(text,type=''){const box=$('notice');box.className='notice '+type;box.textContent=text;}
let toastTimer;
function toast(s){const box=$('toast');box.textContent=s;box.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>box.classList.remove('show'),2000);}
function board(){
 const s=state.attempt?parseFen(state.attempt.position):parseFen('4k3/8/8/8/8/8/8/4K3 w - - 0 1');
 const moves=legal(s),targets=new Set(moves.filter(m=>m[0]===state.selected).map(m=>m[1]));const frag=document.createDocumentFragment();
 for(let rank=0;rank<8;rank++)for(let file=0;file<8;file++){
  const i=rank*16+file,p=s.b[i],white=side(p)===1,btn=document.createElement('button');btn.type='button';btn.className='square '+((rank+file)%2===0?'light':'dark');btn.setAttribute('role','gridcell');
  if(i===state.selected)btn.classList.add('selected');if(targets.has(i))btn.classList.add(p==='.'?'target':'capture');
  if(p!=='.'){const span=document.createElement('span');span.textContent=GLYPHS[p];span.className='piece '+(white?'white':'black');btn.append(span);const mark=document.createElement('span');mark.textContent=white?'Б':'Ч';mark.className='team '+(white?'white':'black');btn.append(mark);}
  if(file===0){const co=document.createElement('span');co.className='coord';co.textContent=8-rank;btn.append(co);}if(rank===7){const co=document.createElement('span');co.className='coord file';co.textContent='abcdefgh'[file];btn.append(co);}
  btn.setAttribute('aria-label',`${p==='.'?'Пустая клетка':(white?'Белая ':'Чёрная ')+p} ${'abcdefgh'[file]}${8-rank}`);btn.addEventListener('click',()=>choose(i));frag.append(btn);
 }
 $('board').replaceChildren(frag);$('turnDisc').style.background=s.t===1?'#fff':'#18333f';$('turnLabel').textContent=s.t===1?'Ход белых':'Ход чёрных';
}
function music(){try{const audio=lastSound||new(window.AudioContext||window.webkitAudioContext)();lastSound=audio;[470,670,930].forEach((hz,i)=>{const o=audio.createOscillator(),g=audio.createGain();o.frequency.value=hz;g.gain.setValueAtTime(.035,audio.currentTime+i*.12);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+i*.12+.2);o.connect(g).connect(audio.destination);o.start(audio.currentTime+i*.12);o.stop(audio.currentTime+i*.12+.2);});}catch{}}
function successFX(s){
 const fx=$('effects');fx.replaceChildren();fx.className='fx '+(s==='draw'?'draw':'show');
 if(s==='draw')fx.classList.add('show');
 else if(state.attempt){const position=parseFen(state.attempt.position),king=position.b.indexOf(position.t===-1?'k':'K');const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 800 800');let count=0;
  for(let i=0;i<128;i++){if((i&0x88)||side(position.b[i])!==-position.t||count>=3)continue;const opponent=position.b[i];if(opponent==='.')continue;const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1',(i&7)*100+50);line.setAttribute('y1',(i>>4)*100+50);line.setAttribute('x2',(king&7)*100+50);line.setAttribute('y2',(king>>4)*100+50);svg.append(line);count++;}
  fx.append(svg);}
 setTimeout(()=>{fx.className='fx';fx.replaceChildren();},1600);music();
}
async function choose(i){
 if(!state.attempt||state.busy||state.attempt.status!=='active')return;
 const s=parseFen(state.attempt.position),moves=legal(s);
 if(side(s.b[i])===s.t){state.selected=state.selected===i?-1:i;board();return;}
 const candidates=moves.filter(m=>m[0]===state.selected&&m[1]===i);
 if(!candidates.length){state.selected=-1;board();return;}
 let m=candidates[0];if(candidates.length>1){const opt=window.prompt('Превращение пешки: q ферзь, r ладья, b слон, n конь','q');m=candidates.find(m=>m[2]===(opt||'q').toLowerCase());if(!m)return;}
 state.busy=true;
 try{const result=await api(`/api/attempts/${state.attempt.id}/move`,{method:'POST',body:JSON.stringify({uci:key(m)})});state.selected=-1;
  if(!result.correct){notice(result.message,'error');return;}
  state.attempt.position=result.position;state.attempt.status=result.completed?'solved':'active';
  if(result.completed){notice(`Отлично! ${result.category==='draw'?'Ничья':'Шах и мат'}! +${result.points} очков.`,'success');successFX(result.category);await refreshMe();}
  else notice(`Верно! ${result.defense?'Соперник ответил '+result.defense+'. Твой ход!':'Продолжай комбинацию!'}`,'');
 }catch(e){notice(e.message,'error')}finally{state.busy=false;board();}
}
async function refreshMe(){const me=await api('/api/me');state.me=me;$('points').textContent=me.points;$('solved').textContent=me.solved;$('skill').textContent=me.skillRating;$('status').textContent=me.displayName||'Заполни профиль';$('name').value=me.displayName;$('publicRank').checked=me.leaderboardOptIn;}
async function newPuzzle(){
 state.selected=-1;state.hint=null;$('hintMessage').hidden=true;$('effects').className='fx';
 $('challenge').textContent=labels[state.mode];
 try{const params=state.mode==='progressive'?{mode:'progressive'}:{mode:'category',category:state.mode};
  const a=await api('/api/attempts',{method:'POST',body:JSON.stringify(params)});state.attempt=a;state.busy=false;
  $('title').textContent=labels[a.category];$('description').textContent=a.category==='draw'?'Защитись и спаси ничью.':(a.source==='lichess'?'Реальная позиция из партии Lichess. Найди сильнейшие ходы.':'Учебная позиция из прежнего тренажёра. Найди мат.');$('difficulty').textContent=a.rating;$('reward').textContent='★ '+({mate1:1,mate2:2,mate3:3,draw:3}[a.category]||0);
  notice('Твой ход. Выбери фигуру и подходящую клетку.');board();
 }catch(e){state.attempt=null;board();notice(e.message,'error');$('title').textContent='Нужны новые задачи';$('description').textContent='Добавь шахматную базу на сервер. Уровни будут открываться по мере тренировок.';}
}
async function hint(){if(!state.attempt||state.busy)return;try{const data=await api(`/api/attempts/${state.attempt.id}/hint`,{method:'POST',body:'{}'});const h=data.hint;$('hintMessage').hidden=false;$('hintMessage').textContent=h.kind==='piece'?`Начни с фигуры на ${h.square}.`:`Попробуй ${h.from} → ${h.to}.`;toast('Подсказка снижает награду на 1 балл');}catch(e){toast(e.message)}}
async function changeMode(mode){if(mode==='leaderboard'){await openRanking();return;}state.mode=mode;for(const el of document.querySelectorAll('.tab'))el.classList.toggle('selected',el.dataset.mode===mode);await newPuzzle();}
async function openRanking(){try{const result=await api('/api/leaderboard');$('rankings').replaceChildren(...result.users.map((u,i)=>{const row=document.createElement('div');row.className='rank-row';const name=document.createElement('span');name.textContent=`${i+1}. ${u.name}`;const score=document.createElement('b');score.textContent=`★ ${u.points}`;row.append(name,score);return row;}));if(!result.users.length)$('rankings').textContent='Пока никого нет. Можно первым вступить в рейтинг через профиль.';$('leaderboard').showModal();}catch(e){toast(e.message)}}
async function begin(){
 try{const config=await api('/api/config');
  if(!state.token){if(tg?.initData){const login=await api('/api/auth/telegram',{method:'POST',body:JSON.stringify({initData:tg.initData})});state.token=login.token;sessionStorage.setItem('chess_session',state.token);}
   else {if(config.demo)$('devLogin').hidden=false;$('auth').showModal();return;}}
  await refreshMe();if(!state.me.displayName){$('profile').showModal();return;}
  await newPuzzle();
 }catch(e){sessionStorage.removeItem('chess_session');state.token='';$('authError').textContent=e.message;$('auth').showModal();}
}
$('devEnter').addEventListener('click',async()=>{try{const login=await api('/api/auth/dev',{method:'POST',body:JSON.stringify({name:$('devName').value})});state.token=login.token;sessionStorage.setItem('chess_session',state.token);$('auth').close();await refreshMe();await newPuzzle();}catch(e){$('authError').textContent=e.message;}});
$('saveProfile').addEventListener('click',async()=>{try{await api('/api/me',{method:'PATCH',body:JSON.stringify({displayName:$('name').value,leaderboardOptIn:$('publicRank').checked})});$('profile').close();await refreshMe();if(!state.attempt)await newPuzzle();}catch(e){$('profileError').textContent=e.message;}});
$('profileButton').addEventListener('click',()=>{if(!state.me)return;$('profile').showModal();});
$('hint').addEventListener('click',hint);
$('skip').addEventListener('click',()=>{if(!state.attempt)return;newPuzzle();});
$('next').addEventListener('click',newPuzzle);
for(const b of document.querySelectorAll('.tab'))b.addEventListener('click',()=>changeMode(b.dataset.mode));
begin();

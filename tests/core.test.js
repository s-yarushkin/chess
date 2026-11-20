import test from 'node:test';
import assert2 from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHmac} from 'node:crypto';
import {openDb} from '../src/db.js';
import {parseFen,fenOf,legal,key,apply,checkmate,stalemate} from '../src/chess.js';
import {validateInitData,loginTelegram,makeSession,findSession,validName} from '../src/auth.js';
import {validatePuzzle,insertPuzzle,selectPuzzle,startAttempt,submitMove,hint} from '../src/puzzles.js';
const eq=assert2.equal,ok=assert2.ok;
const examples=JSON.parse(readFileSync(new URL('../data/legacy-demo.json',import.meta.url)));

test('all 80 non-draw legacy positions have legal moves and a genuine checkmate',()=>{
 for(const p of examples){let b=parseFen(p.fen);const count=p.line.length;eq(count,p.category==='mate1'?1:3);for(const uci of p.line){const m=legal(b).find(m=>key(m)===uci);ok(m,`${p.id} ${uci}`);b=apply(b,m);}ok(checkmate(b),p.id);validatePuzzle(p);}
});
test('FEN persists side to move, castling, ep and clocks',()=>{
 const fen='r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 12 31';eq(fenOf(parseFen(fen)),fen);
 const ep='4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 29';eq(fenOf(parseFen(ep)),ep);
});
test('Telegram authentication validates official HMAC and freshness',()=>{
 const token='123456:ABC',user={id:123456,first_name:'Alex'};
 const params=new URLSearchParams({auth_date:'1730000000',user:JSON.stringify(user)});
 const check=[...params.entries()].sort(([a],[b])=>a.localeCompare(b,'en')).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token).digest();const hash=createHmac('sha256',secret).update(check).digest('hex');params.set('hash',hash);
 eq(validateInitData(params.toString(),token,1730000300).telegramId,'123456');
 assert2.throws(()=>validateInitData(params.toString(),token,1730005000),/Invalid/);
 const tampered=new URLSearchParams(params);tampered.set('user',JSON.stringify({id:2}));assert2.throws(()=>validateInitData(tampered.toString(),token,1730000300),/Invalid/);
});
test('points once per puzzle; hints and errors reduce reward; no duplicate rewards',()=>{
 const db=openDb(':memory:');const usr=loginTelegram(db,'1200');db.prepare('UPDATE users SET display_name=? WHERE id=?').run('Алексей',usr.id);
 const p=examples.find(p=>p.category==='mate1');insertPuzzle(db,p);
 const a=startAttempt(db,usr,'category','mate1');eq(a.puzzle_id,p.id);
 assert2.throws(()=>submitMove(db,usr,a.id,'e1e3'),/Illegal/);
 const res=submitMove(db,usr,a.id,p.line[0]);eq(res.completed,true);eq(res.points,1);eq(db.prepare('SELECT points FROM users WHERE id=?').get(usr.id).points,1);
 assert2.throws(()=>submitMove(db,usr,a.id,p.line[0]),/completed/);
 assert2.throws(()=>startAttempt(db,usr,'category','mate1'),/solved/);
 db.close();
});
test('hint reduces score but never invents a move',()=>{
 const db=openDb(':memory:');const usr=loginTelegram(db,'1200');insertPuzzle(db,examples.find(p=>p.category==='mate1'));
 const a=startAttempt(db,usr,'category','mate1');const h=hint(db,usr,a.id);eq(h.hint.kind,'piece');const done=submitMove(db,usr,a.id,examples[0].line[0]);eq(done.points,0);db.close();
});
test('verified draw cannot use one-move last pawn capture or unproven equality',()=>{
 const p={id:'fake-draw',fen:'4k3/8/8/8/8/8/8/4K3 w - - 0 1',line:['e1e2','e8e7','e2e3'],rating:800,category:'draw'};
 assert2.throws(()=>validatePuzzle(p),/Trivial|too early/);
});
test('session persistence uses hash and name input validation',()=>{
 const db=openDb(':memory:');const usr=loginTelegram(db,'1'),session=makeSession(db,usr.id);
 eq(findSession(db,session).id,usr.id);eq(findSession(db,'bogus'),null);ok(validName('Лёша'));eq(validName('A'),false);db.close();
});
test('castling, en passant, underpromotion and black turn are legal',()=>{
 let s=parseFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
 ok(legal(s).some(m=>key(m)==='e1g1'));ok(legal(s).some(m=>key(m)==='e1c1'));
 s=parseFen('4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 29');ok(legal(s).some(m=>key(m)==='e5d6'));
 s=parseFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1');
 for(const letter of ['q','r','b','n'])ok(legal(s).some(m=>key(m)==='a7a8'+letter));
 s=parseFen('4k3/8/8/8/8/8/8/4K3 b - - 0 1');ok(legal(s).every(m=>s.b[m[0]]==='k'));
});

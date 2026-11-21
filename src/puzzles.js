import {randomUUID} from 'node:crypto';
import {parseFen,fenOf,legal,key,apply,checkmate,stalemate,insufficient,outcome,checked} from './chess.js';
import {transaction} from './db.js';
import {coachingFor} from './coach.js';

export const BASE_POINTS=Object.freeze({mate1:1,mate2:2,mate3:3,draw:3});
const MAX_LINE=10;
export function validatePuzzle(p){
  if(!p || typeof p.id!=='string'||!p.id||p.id.length>100||!BASE_POINTS[p.category])throw Error('Unknown puzzle or category');
  if(!Array.isArray(p.line)||!p.line.length||p.line.length>MAX_LINE||p.line.some(x=>typeof x!=='string'||!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x)))throw Error('Invalid solution line');
  if(!Number.isInteger(p.rating)||p.rating<100||p.rating>4000)throw Error('Invalid puzzle rating');
  let state=parseFen(p.fen);
  if(state.b.filter(p=>p==='K').length!==1||state.b.filter(p=>p==='k').length!==1||state.t!==1&&state.t!==-1 || checked(state,-state.t))throw Error('Invalid kings');
  const first=state.t;
  if(p.category.startsWith('mate') && p.line.length!==Number(p.category.slice(4))*2-1)throw Error('Wrong mate line length');
  for(const [idx,uci] of p.line.entries()){
    if(state.t!==(idx%2? -first:first))throw Error('Unexpected side to move');
    const m=legal(state).find(m=>key(m)===uci);
    if(!m)throw Error('Illegal solution move: '+uci);
    state=apply(state,m);
    if(idx!==p.line.length-1 && outcome(state))throw Error('Line terminates too early');
  }
  if(p.category.startsWith('mate') && (!checkmate(state)||state.t===first))throw Error('Line does not end with mate');
  if(p.category==='draw') {
    // Do not equate an engine 0.00 position with forced draw. Requires a legally terminal draw.
    if(!(stalemate(state)||insufficient(state)))throw Error('Draw not proved by final position');
    if(p.line.length<3)throw Error('Trivial one-move draw is prohibited');
    if(p.approval!=='reviewed' || !/^https:\/\//.test(p.proof_url||''))throw Error('Draw needs expert review and proof URL');
    const start=parseFen(p.fen);
    if(start.b.filter(x=>x!=='.').length<5)throw Error('Trivial material draw is prohibited');
  }
  return {...p,source:p.source||'curated',source_url:p.source_url||'',quality:p.quality||'verified',theme:p.theme||''};
}
export function insertPuzzle(db,p){
  const item=validatePuzzle(p);
  return db.prepare(`INSERT OR IGNORE INTO puzzles(id,fen,category,rating,line_json,source,source_url,quality,theme,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(item.id,item.fen,item.category,item.rating,JSON.stringify(item.line),item.source,item.source_url,item.quality,item.theme,Date.now()).changes;
}
export function puzzleCounts(db){return db.prepare('SELECT category,COUNT(*) AS count FROM puzzles GROUP BY category ORDER BY category').all();}
function pickCategory(db, user, mode, category){
  if(mode==='category') {if(!BASE_POINTS[category])throw Error('Unknown category'); return category;}
  const n=user.solved_count;
  const ranges=n<15?['mate1']:n<35?['mate1','mate2']:n<70?['mate1','mate2','mate3']:['mate1','mate2','mate3','draw'];
  const options=db.prepare(`SELECT category,COUNT(*) AS count FROM puzzles WHERE category IN (${ranges.map(()=>'?').join(',')}) GROUP BY category`).all(...ranges).filter(x=>x.count>0);
  if(!options.length)throw Error('No puzzles imported');
  const preferred=options.filter(o=>o.category!=='mate1');
  const pool=preferred.length && Math.random()<.65?preferred:options;
  return pool[Math.floor(Math.random()*pool.length)].category;
}
export function selectPuzzle(db,user,mode='progressive',category){
  const chosen=pickCategory(db,user,mode,category);
  function poolFor(cat, avoidRecent){
    const recent=avoidRecent?`AND p.id NOT IN (SELECT puzzle_id FROM attempts WHERE user_id=? AND started_at>?)`:'';
    const params=[user.id,cat,...(avoidRecent?[user.id,Date.now()-7*86400_000]:[]),user.skill_rating];
    return db.prepare(`SELECT p.* FROM puzzles p LEFT JOIN completions c ON c.puzzle_id=p.id AND c.user_id=? WHERE p.category=? AND c.puzzle_id IS NULL ${recent} ORDER BY CASE WHEN p.source='lichess' THEN 0 ELSE 1 END, ABS(p.rating-?) LIMIT 250`).all(...params);
  }
  let unseen=poolFor(chosen,true);
  if(!unseen.length)unseen=poolFor(chosen,false);
  if(!unseen.length && mode==='progressive'){
    for(const alt of ['mate1','mate2','mate3','draw']){
      if(alt===chosen)continue;
      unseen=poolFor(alt,true);if(!unseen.length)unseen=poolFor(alt,false);
      if(unseen.length)break;
    }
  }
  if(!unseen.length)throw Error('All puzzles in this category have been solved');
  const window=unseen.filter(p=>Math.abs(p.rating-user.skill_rating)<=350);
  const pool=window.length?window:unseen.slice(0,Math.min(unseen.length,40));
  return pool[Math.floor(Math.random()*Math.min(pool.length,80))];
}
export function startAttempt(db,user,mode,category){
  return transaction(db,()=>{
    const p=selectPuzzle(db,user,mode,category);
    const id=randomUUID(),now=Date.now();
    // The previous task may be revisited later; skipped tasks cannot grant points.
    const skipped=db.prepare("UPDATE attempts SET status='skipped',updated_at=? WHERE user_id=? AND status='active'").run(now,user.id);
    if(skipped.changes) db.prepare('UPDATE users SET clean_streak=0 WHERE id=?').run(user.id);
    db.prepare("INSERT INTO attempts(id,user_id,puzzle_id,current_fen,started_at,updated_at) VALUES(?,?,?,?,?,?)").run(id,user.id,p.id,p.fen,now,now);
    return db.prepare("SELECT attempts.*,puzzles.category,puzzles.rating,puzzles.source FROM attempts JOIN puzzles ON puzzles.id=attempts.puzzle_id WHERE attempts.id=?").get(id);
  });
}
export function publicAttempt(db,attempt){
  const puzzle=db.prepare('SELECT fen,category,rating,source,theme FROM puzzles WHERE id=?').get(attempt.puzzle_id);
  const {title,prompt,method}=coachingFor(puzzle);
  return {id:attempt.id,position:attempt.current_fen,category:puzzle.category,rating:puzzle.rating,source:puzzle.source,startedPosition:puzzle.fen,errors:attempt.errors,hints:attempt.hints,status:attempt.status,lesson:{title,prompt,method}};
}
export function submitMove(db,user,attemptId,uci){
  return transaction(db,()=>{
    const a=db.prepare('SELECT * FROM attempts WHERE id=? AND user_id=?').get(attemptId,user.id);
    if(!a)throw Error('Attempt not found');
    if(a.status!=='active')throw Error('Attempt already completed');
    const p=db.prepare('SELECT * FROM puzzles WHERE id=?').get(a.puzzle_id);
    const line=JSON.parse(p.line_json),position=parseFen(a.current_fen);
    const played=legal(position).find(m=>key(m)===uci);
    if(!played)throw Error('Illegal move');
    const alternateMate=p.category.startsWith('mate') && (p.category==='mate1'||a.cursor===line.length-1) && checkmate(apply(position,played));
    if(line[a.cursor]!==uci && !alternateMate){
      db.prepare('UPDATE attempts SET errors=errors+1,updated_at=? WHERE id=?').run(Date.now(),a.id);
      return {correct:false,message:'Это законный ход, но он не решает заданную комбинацию.',position:a.current_fen,errors:a.errors+1};
    }
    let next=apply(position,played),cursor=a.cursor+1,defense=null;
    if(cursor<line.length){
      const enemy=legal(next).find(m=>key(m)===line[cursor]);
      if(!enemy)throw Error('Broken puzzle defense');
      defense=line[cursor];next=apply(next,enemy);cursor++;
    }
    let completed=cursor===line.length,earned=0,firstSolve=false;
    if(completed){
      if(p.category.startsWith('mate')&&!checkmate(next))throw Error('Puzzle did not end in checkmate');
      if(p.category==='draw'&&!(stalemate(next)||insufficient(next)))throw Error('Puzzle did not end in draw');
      earned=Math.max(0,BASE_POINTS[p.category]-(a.hints>0?1:0)-(a.errors>1?1:0));
      const done=db.prepare('INSERT OR IGNORE INTO completions(user_id,puzzle_id,points,solved_at) VALUES(?,?,?,?)').run(user.id,p.id,earned,Date.now());
      if(done.changes){
        firstSolve=true;
        const clean=+(a.errors===0 && a.hints===0);
        db.prepare(`UPDATE users SET clean_streak=CASE WHEN ?=1 THEN clean_streak+1 ELSE 0 END,
          best_streak=MAX(best_streak,CASE WHEN ?=1 THEN clean_streak+1 ELSE 0 END) WHERE id=?`).run(clean,clean,user.id);
        const expected=1/(1+Math.pow(10,(p.rating-user.skill_rating)/400));
        const performance=a.hints?0.7:a.errors>1?0.6:1;
        const delta=Math.round(24*(performance-expected));
        db.prepare('UPDATE users SET points=points+?,solved_count=solved_count+1,skill_rating=MAX(600,MIN(2400,skill_rating+?)) WHERE id=?').run(earned,delta,user.id);
      }
    }
    db.prepare('UPDATE attempts SET current_fen=?,cursor=?,status=?,updated_at=? WHERE id=?').run(fenOf(next),cursor,completed?'solved':'active',Date.now(),a.id);
    return {correct:true,completed,position:fenOf(next),defense,points:firstSolve?earned:0,category:p.category,firstSolve,lesson:completed?coachingFor(p):undefined};
  });
}
export function hint(db,user,attemptId){
  return transaction(db,()=>{
    const a=db.prepare('SELECT * FROM attempts WHERE id=? AND user_id=?').get(attemptId,user.id);
    if(!a||a.status!=='active')throw Error('No active attempt');
    const p=db.prepare('SELECT line_json FROM puzzles WHERE id=?').get(a.puzzle_id),line=JSON.parse(p.line_json),next=line[a.cursor];
    if(!next)throw Error('No hint');
    const hints=Math.min(2,a.hints+1);
    db.prepare('UPDATE attempts SET hints=?,updated_at=? WHERE id=?').run(hints,Date.now(),a.id);
    return {hint:hints===1?{kind:'piece',square:next.slice(0,2)}:{kind:'move',from:next.slice(0,2),to:next.slice(2,4)},hints};
  });
}

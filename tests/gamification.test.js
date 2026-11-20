import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {openDb} from '../src/db.js';
import {loginTelegram} from '../src/auth.js';
import {BADGES,progressSnapshot} from '../src/gamification.js';
import {insertPuzzle,startAttempt,submitMove,hint} from '../src/puzzles.js';
import {attackersToKing} from '../public/fun.js';
import {parseFen,moveUci} from '../src/chess.js';

const fixtures=JSON.parse(readFileSync(new URL('../data/legacy-demo.json',import.meta.url))).filter(p=>p.category==='mate1');
function setup(){const db=openDb(':memory:');const user=loginTelegram(db,'test:gamification');fixtures.slice(0,6).forEach(p=>insertPuzzle(db,p));return {db,user};}
function solve(db,user,p){const a=startAttempt(db,user,'category','mate1');const picked=fixtures.find(x=>x.id===a.puzzle_id);return submitMove(db,user,a.id,picked.line[0]);}
test('real attacking pieces only: rook beams cannot pass through blockers',()=>{
 const after=moveUci(parseFen(fixtures[0].fen),fixtures[0].line[0]);
 const a=attackersToKing(after);
 assert.ok(a.length>0,'Mated king must be attacked');
 assert.ok(a.includes(1),'Rook on b8 directly attacks f8');
 const blocked=parseFen('4k3/4p3/8/8/8/8/8/4R1K1 b - - 0 1');
 assert.deepEqual(attackersToKing(blocked),[],'A rook cannot shoot a laser through a pawn');
});
test('server achievements follow unique solves and clean streaks, not inflated points',()=>{
 const {db,user}=setup();
 let g=progressSnapshot(db,user);assert.equal(g.badges.filter(x=>x.earned).length,0);assert.equal(g.levelName,'Разведчик');
 for(let i=0;i<3;i++){
  const completed=solve(db,user);assert.equal(completed.completed,true);assert.equal(completed.points,1);
 }
 let fresh=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);g=progressSnapshot(db,fresh);
 assert.equal(g.streak,3);assert.equal(g.bestStreak,3);assert.equal(g.counts.mate1,3);
 assert.ok(g.badges.find(x=>x.id==='streak_3').earned);
 assert.ok(g.badges.find(x=>x.id==='first').earned);
 assert.equal(g.badges.find(x=>x.id==='five').earned,false);
 const a=startAttempt(db,user,'category','mate1');hint(db,user,a.id);
 const picked=fixtures.find(p=>p.id===a.puzzle_id);submitMove(db,user,a.id,picked.line[0]);
 fresh=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);g=progressSnapshot(db,fresh);
 assert.equal(g.streak,0);assert.equal(g.bestStreak,3);assert.equal(g.counts.mate1,4);
 const fifth=solve(db,user);assert.equal(fifth.points,1);
 fresh=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);g=progressSnapshot(db,fresh);
 assert.equal(g.level,2);assert.ok(g.badges.find(x=>x.id==='five').earned);
 assert.equal(g.bestStreak,3);assert.equal(g.streak,1);
 assert.throws(()=>submitMove(db,user,a.id,picked.line[0]),/completed/);
 db.close();
});
test('skipping active task resets streak, but preserves completed scores and earned badges',()=>{
 const {db,user}=setup();solve(db,user);let before=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);assert.equal(before.clean_streak,1);
 const a=startAttempt(db,user,'category','mate1');const b=startAttempt(db,user,'category','mate1');
 const after=db.prepare('SELECT * FROM users WHERE id=?').get(user.id);
 assert.equal(after.clean_streak,0);assert.equal(after.best_streak,1);assert.equal(after.points,1);
 assert.equal(db.prepare('SELECT status FROM attempts WHERE id=?').get(a.id).status,'skipped');
 db.close();
});
test('additive migration preserves v0.1 users and remains idempotent',()=>{
 const folder=mkdtempSync(join(tmpdir(),'chess-v02-')),file=join(folder,'old.sqlite');
 try{
  const old=new DatabaseSync(file);old.exec("CREATE TABLE users (id TEXT PRIMARY KEY, telegram_id TEXT UNIQUE, display_name TEXT NOT NULL DEFAULT '', leaderboard_opt_in INTEGER NOT NULL DEFAULT 0, points INTEGER NOT NULL DEFAULT 0, solved_count INTEGER NOT NULL DEFAULT 0, skill_rating INTEGER NOT NULL DEFAULT 800, created_at INTEGER NOT NULL)");
  old.prepare('INSERT INTO users(id,display_name,points,solved_count,created_at) VALUES(?,?,?,?,?)').run('u1','Алексей',21,15,Date.now());old.close();
  for(let i=0;i<2;i++){
   const db=openDb(file),user=db.prepare("SELECT * FROM users WHERE id='u1'").get();
   assert.equal(user.points,21);assert.equal(user.solved_count,15);assert.equal(user.clean_streak,0);assert.equal(user.best_streak,0);db.close();
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});

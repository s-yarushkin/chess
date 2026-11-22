import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseFen,apply,legal,key,checkmate} from '../src/chess.js';

// Vercel deployment must ship the exact curated catalog and valid mating lines.
for(const [cat,n] of [['mate1',900],['mate2',1100],['mate3',1000]]){
 test('cloud catalog '+cat+' contains '+n+' validated tasks',()=>{
  const rows=readFileSync(new URL('../data/school-v1/'+cat+'.jsonl',import.meta.url),'utf8').trim().split(/\r?\n/);
  assert.equal(rows.length,n);
  for(const line of rows){const p=JSON.parse(line);assert.equal(p.category,cat);assert.equal(p.line.length,2*Number(cat.slice(4))-1);
   let s=parseFen(p.fen);for(const uci of p.line){const m=legal(s).find(m=>key(m)===uci);assert.ok(m,p.id+': illegal '+uci);s=apply(s,m);}
   assert.ok(checkmate(s),p.id+': no mate');
  }
 });
}

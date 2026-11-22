import {readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomInt} from 'node:crypto';

const directory=join(dirname(fileURLToPath(import.meta.url)),'../data/school-v1');
let cache;
export function getCatalog(){
  if(cache)return cache;
  const groups={mate1:[],mate2:[],mate3:[]},byId=new Map();
  for(const category of Object.keys(groups)){
    const rows=readFileSync(join(directory,category+'.jsonl'),'utf8').trim().split(/\r?\n/);
    for(const row of rows){
      const puzzle=JSON.parse(row);
      if(puzzle.category!==category||!Array.isArray(puzzle.line)||!puzzle.id?.startsWith('lichess-')||byId.has(puzzle.id))throw Error('Invalid curated catalog');
      const item={id:puzzle.id,category,fen:puzzle.fen,line:puzzle.line,rating:puzzle.rating,theme:puzzle.theme||'',source:'lichess'};
      groups[category].push(item);byId.set(item.id,item);
    }
  }
  if(groups.mate1.length!==900||groups.mate2.length!==1100||groups.mate3.length!==1000)throw Error('Curated catalog missing');
  cache={groups,byId,counts:Object.entries(groups).map(([category,puzzles])=>({category,count:puzzles.length}))};
  return cache;
}
export function getPuzzle(id){return getCatalog().byId.get(id);}
export function pickPuzzle({category,stage=0,skill=800,completed=[],recent=[]}){
  const {groups}=getCatalog();
  const mixes=[{mate1:1},{mate1:.7,mate2:.3},{mate1:.25,mate2:.7,mate3:.05},{mate1:.15,mate2:.55,mate3:.30}];
  const ranges=[[400,850],[500,1050],[650,1300],[800,1550]];
  const mix=category?{[category]:1}:mixes[Math.min(3,Math.max(0,stage))];
  const available=Object.entries(mix).filter(([cat])=>groups[cat]?.length);
  if(!available.length)throw Error('Категория пока недоступна');
  const total=available.reduce((n,[,weight])=>n+weight,0);let ticket=randomInt(1_000_000)/1_000_000*total;
  let chosen=available.at(-1)[0];for(const [cat,weight] of available){ticket-=weight;if(ticket<0){chosen=cat;break;}}
  const solved=new Set(completed),excluded=new Set(recent);
  const unsolved=groups[chosen].filter(p=>!solved.has(p.id));
  if(!unsolved.length)throw Error('Все задачи этого раздела уже решены');
  const fresh=unsolved.filter(p=>!excluded.has(p.id));
  const candidates=fresh.length?fresh:unsolved;
  const [low,high]=ranges[Math.min(3,Math.max(0,stage))];
  const inBand=candidates.filter(p=>p.rating>=low && p.rating<=high);
  const pool=inBand.length?inBand:candidates;
  const sorted=pool.toSorted((a,b)=>Math.abs(a.rating-skill)-Math.abs(b.rating-skill));
  return sorted[randomInt(Math.min(120,sorted.length))];
}

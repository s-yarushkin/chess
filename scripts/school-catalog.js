import {readFileSync} from 'node:fs';
import {parseFen,legal,key,apply,fenOf} from '../src/chess.js';
import {validatePuzzle,insertPuzzle,puzzleCounts} from '../src/puzzles.js';
import {openDb,transaction} from '../src/db.js';
import {coachingFor} from '../src/coach.js';

const counts={mate1:900,mate2:1100,mate3:1000};
const ids=new Set(),positions=new Set(),all=[],report={},problems=[];
for(const [category,expected] of Object.entries(counts)){
  const file=new URL('../data/school-v1/'+category+'.jsonl',import.meta.url);
  const lines=readFileSync(file,'utf8').trim().split(/\r?\n/);
  let white=0,black=0,bands=new Set();
  for(let i=0;i<lines.length;i++){
    let p;
    try{
      p=JSON.parse(lines[i]);
      if(p.category!==category || !p.id.startsWith('lichess-'))throw Error('Wrong category or id');
      if(ids.has(p.id))throw Error('Duplicate id');
      ids.add(p.id);
      const signature=p.fen.split(/\s+/).slice(0,4).join(' ');
      if(positions.has(signature))throw Error('Duplicate position');
      positions.add(signature);
      if(p.source!=='lichess'||p.quality!=='verified')throw Error('Wrong source');
      if(!p.source_url.startsWith('https://lichess.org/'))throw Error('Invalid source URL');
      if(p.puzzle_url!=='https://lichess.org/training/'+p.id.slice(8))throw Error('Invalid puzzle URL');
      if(p.popularity<85||p.plays<200||p.ratingDeviation>125)throw Error('Below quality gate');
      if(!p.theme.split(' ').includes('mateIn'+category.slice(4)))throw Error('Wrong Lichess theme');
      const original=p.originMoves.trim().split(/\s+/),state=parseFen(p.originFen);
      const first=legal(state).find(m=>key(m)===original[0]);
      if(!first)throw Error('Invalid originating game move');
      if(fenOf(apply(state,first))!==p.fen)throw Error('Wrong exported position');
      if(original.slice(1).join(' ')!==p.line.join(' '))throw Error('Wrong exported move line');
      validatePuzzle(p);
      const lesson=coachingFor(p);
      if(!lesson.prompt||!lesson.reflection)throw Error('Missing pedagogical prompt');
      if(parseFen(p.fen).t===1)white++;else black++;
      bands.add(Math.floor(p.rating/300));
      all.push(p);
    }catch(e){problems.push(category+' line '+(i+1)+': '+e.message);}
  }
  report[category]={count:lines.length,white,black,ratingBands:bands.size};
  if(lines.length!==expected)problems.push(category+' must contain '+expected);
  if(Math.min(white,black)<expected*.35)problems.push(category+' color imbalance');
  if(bands.size<4)problems.push(category+' too few difficulty bands');
}
console.log(JSON.stringify({total:all.length,source:'Lichess CC0',filters:{popularity:85,minPlays:200,maxRatingDeviation:125},categories:report,errors:problems.slice(0,20)},null,2));
if(problems.length||all.length!==3000)process.exit(1);
if(process.argv.includes('--import')){
  const db=openDb();
  try{
    let added=0;
    for(let i=0;i<all.length;i+=100){
      added+=transaction(db,()=>all.slice(i,i+100).reduce((n,p)=>n+insertPuzzle(db,p),0));
    }
    const totals=Object.fromEntries(puzzleCounts(db).map(p=>[p.category,p.count]));
    for(const [cat,n] of Object.entries(counts))if((totals[cat]||0)<n)throw Error('Incomplete database: '+cat);
    console.log(JSON.stringify({imported:added,dbCounts:totals,ready:true}));
  }finally{db.close();}
}

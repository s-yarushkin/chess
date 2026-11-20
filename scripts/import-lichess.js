import {createReadStream} from 'node:fs';
import readline from 'node:readline';
import {openDb,transaction} from '../src/db.js';
import {parseFen,legal,key,apply,fenOf} from '../src/chess.js';
import {insertPuzzle,puzzleCounts} from '../src/puzzles.js';

// Official Lichess puzzle export: https://database.lichess.org/#puzzles
// Requires decompressed CSV (stream it: zstd -dc lichess_db_puzzle.csv.zst | node scripts/import-lichess.js -).
function csvRow(line){const fields=[];let item='',quoted=false;for(let i=0;i<line.length;i++){const c=line[i];if(c==='"'){if(quoted&&line[i+1]==='"'){item+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){fields.push(item);item='';}else item+=c;}fields.push(item);return fields;}
const input=process.argv[2]||'-';
const limit=Math.max(100,Number(process.env.LIMIT_PER_CATEGORY||750));
const minPopularity=Number(process.env.MIN_POPULARITY||75);
const minPlays=Number(process.env.MIN_PLAYS||150);
const maxima={mate1:limit,mate2:limit,mate3:limit};
const totals={mate1:0,mate2:0,mate3:0};
let scanned=0,rejected=0,added=0;
const db=openDb();
const stream=input==='-'?process.stdin:createReadStream(input,{encoding:'utf8'});
const rl=readline.createInterface({input:stream,crlfDelay:Infinity});
let first=true;
for await(const l of rl){
  if(first){first=false;if(l.startsWith('PuzzleId,'))continue;}
  scanned++;
  if(Object.keys(maxima).every(c=>totals[c]>=maxima[c]))break;
  const columns=csvRow(l);
  if(columns.length<9){rejected++;continue;}
  const [id,startFen,moves,rating,rd,pop,plays,themes,sourceUrl]=columns;
  const tags=themes.split(' '),categories=['mateIn1','mateIn2','mateIn3'].filter(t=>tags.includes(t));
  if(categories.length!==1||Number(pop)<minPopularity||Number(plays)<minPlays||Number(rd)>140){rejected++;continue;}
  const cat=categories[0].toLowerCase(),category={matein1:'mate1',matein2:'mate2',matein3:'mate3'}[cat];
  if(totals[category]>=maxima[category]||!Number.isFinite(Number(rating))){rejected++;continue;}
  const uci=moves.split(' ');
  if(uci.length!==1+2*Number(category.slice(4))-1){rejected++;continue;}
  try{
    // The Lichess FEN is before an opponent move; display after the first move.
    const state=parseFen(startFen);
    const opponent=legal(state).find(m=>key(m)===uci[0]);if(!opponent)throw Error('illegal setup');
    const p={id:'lichess-'+id,fen:fenOf(apply(state,opponent)),category,rating:Number(rating),line:uci.slice(1),source:'lichess',source_url:sourceUrl,quality:'verified',theme:themes};
    if(insertPuzzle(db,p))added++;totals[category]++;
  }catch{rejected++;}
  if(scanned%200000===0)console.log({scanned,rejected,added,totals});
}
console.log(JSON.stringify({scanned,added,rejected,accepted:totals,dbCounts:puzzleCounts(db)},null,2));db.close();

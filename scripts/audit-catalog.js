import {openDb} from '../src/db.js';
const db=openDb();
const required={mate1:300,mate2:500,mate3:300,draw:200};
const rows=db.prepare("SELECT category,COUNT(*) count FROM puzzles WHERE quality='verified' AND source!='legacy-demo' GROUP BY category").all();
const counts=Object.fromEntries(rows.map(x=>[x.category,x.count]));
let ready=true;
for(const [category,min] of Object.entries(required)){
  const got=counts[category]||0,ok=got>=min;
  console.log(`${ok?'PASS':'NOT READY'}  ${category.padEnd(5)}  ${got} / ${min}`);
  if(!ok)ready=false;
}
const duplicates=db.prepare('SELECT COUNT(*) as count FROM (SELECT fen,category FROM puzzles GROUP BY fen,category HAVING COUNT(*)>1)').get().count;
if(duplicates){console.log('DUPLICATES',duplicates);ready=false;}
console.log(ready?'CATALOG_READY':'CATALOG_NOT_READY — do not launch as a complete school product');
db.close();if(!ready)process.exitCode=1;

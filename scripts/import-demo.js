import {readFileSync} from 'node:fs';
import {openDb} from '../src/db.js';
import {insertPuzzle,puzzleCounts} from '../src/puzzles.js';
const data=JSON.parse(readFileSync(new URL('../data/legacy-demo.json',import.meta.url),'utf8'));
const db=openDb();let imported=0;
for(const p of data)imported+=insertPuzzle(db,p);
console.log(JSON.stringify({imported,counts:puzzleCounts(db),warning:'Legacy puzzles are for local demos only. Replace with Lichess positions before public launch.'},null,2));
db.close();

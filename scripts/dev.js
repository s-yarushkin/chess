// Local test server, reachable only from this computer.
import {openDb} from '../src/db.js';
import {makeServer} from '../src/server.js';
const port=Number(process.env.PORT||8094);
const db=openDb();
makeServer(db,{dev:true}).listen(port,'127.0.0.1',()=>console.log(`Chess Academy local dev on http://127.0.0.1:${port}`));

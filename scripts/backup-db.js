// SQLite online backup protects the WAL database against torn copies.
import {DatabaseSync,backup} from 'node:sqlite';
import {existsSync,statSync} from 'node:fs';
const sourcePath=process.env.DB_PATH||'/app/storage/chess.sqlite';
const target=process.argv[2];
if(!target||!target.startsWith('/tmp/')||target.includes('..'))throw Error('Backup output must be inside /tmp');
if(!existsSync(sourcePath))throw Error('Database file does not exist');
const db=new DatabaseSync(sourcePath,{readOnly:true});
try{
 if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Source integrity check failed');
 await backup(db,target);
}finally{db.close();}
const check=new DatabaseSync(target,{readOnly:true});
try{
 if(check.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw Error('Backup integrity check failed');
 const users=check.prepare('SELECT COUNT(*) AS n FROM users').get().n;
 console.log('Verified SQLite backup: users='+users+' bytes='+statSync(target).size);
}finally{check.close();}

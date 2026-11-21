import {spawn} from 'node:child_process';
const child=spawn(process.execPath,['src/server.js'],{env:{...process.env,DEV_MODE:'1'},stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>process.exit(code||0));

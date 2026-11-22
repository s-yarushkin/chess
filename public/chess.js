// Chess rules: 0x88 engine, derived from the verified standalone trainer.
const dirs={n:[-33,-31,-18,-14,14,18,31,33],b:[-17,-15,15,17],r:[-16,-1,1,16],k:[-17,-16,-15,-1,1,15,16,17]};
const on=i=>i>=0&&i<128&&!(i&0x88);
const side=p=>!p||p==='.'?0:p===p.toUpperCase()?1:-1;
const sq=i=>'abcdefgh'[i&7]+(8-(i>>4));
const index=s=>(8-Number(s[1]))*16+'abcdefgh'.indexOf(s[0]);
const key=m=>sq(m[0])+sq(m[1])+m[2];
function parseFen(fen){const f=fen.trim().split(/\s+/),rows=f[0].split('/'),b=Array(128).fill('.');if(rows.length!==8)throw Error('bad FEN');rows.forEach((row,r)=>{let c=0;for(const p of row){if(/[1-8]/.test(p))c+=+p;else b[r*16+c++]=p}if(c!==8)throw Error('bad row')});return{b,t:f[1]==='w'?1:-1,c:(f[2].includes('K')?1:0)|(f[2].includes('Q')?2:0)|(f[2].includes('k')?4:0)|(f[2].includes('q')?8:0),ep:f[3]==='-'?-1:index(f[3]),half:+(f[4]||0),full:+(f[5]||1)};}
function fenOf(s){const rows=[];for(let r=0;r<8;r++){let row='',n=0;for(let c=0;c<8;c++){const p=s.b[r*16+c];if(p==='.')n++;else{if(n)row+=n;n=0;row+=p;}}if(n)row+=n;rows.push(row);}return rows.join('/')+' '+(s.t===1?'w':'b')+' '+(s.c?(['K','Q','k','q'].filter((k,i)=>s.c&(1<<i)).join('')):'-')+' '+(s.ep<0?'-':sq(s.ep))+' '+s.half+' '+s.full;}
function attacked(s,target,by){for(let f=0;f<128;f++){if(!on(f)||side(s.b[f])!==by)continue;const p=s.b[f].toLowerCase();if(p==='p'){if(target===f-16*by-1||target===f-16*by+1)return true;continue;}for(const d of (dirs[p]||dirs.k)){for(let t=f+d;on(t);t+=d){if(t===target)return true;if(s.b[t]!=='.'||p==='n'||p==='k')break;}}}return false;}
const checked=(s,color=s.t)=>attacked(s,s.b.indexOf(color===1?'K':'k'),-color);
function apply(s,m){const[f,t,promo,flag]=m,b=s.b.slice(),piece=b[f],captured=b[t];let c=s.c;b[f]='.';b[t]=promo?(s.t===1?promo.toUpperCase():promo):piece;if(flag==='ep')b[t+16*s.t]='.';if(flag==='castle'){const rf=t>f?f+3:f-4,rt=t>f?f+1:f-1;b[rt]=b[rf];b[rf]='.';}if(piece==='K')c&=~3;if(piece==='k')c&=~12;const rookBit={119:1,112:2,7:4,0:8};if(piece.toLowerCase()==='r')c&=~(rookBit[f]||0);if(captured.toLowerCase()==='r')c&=~(rookBit[t]||0);return{b,t:-s.t,c,ep:piece.toLowerCase()==='p'&&Math.abs(t-f)===32?(t+f)/2:-1,half:piece.toLowerCase()==='p'||captured!=='.'||flag==='ep'?0:s.half+1,full:s.full+(s.t===-1?1:0)};}
function pseudo(s){const out=[];for(let f=0;f<128;f++){if(!on(f)||side(s.b[f])!==s.t)continue;const p=s.b[f].toLowerCase();const add=(t,flag='')=>{if(s.b[t].toLowerCase()==='k')return;if(p==='p'&&(t>>4===0||t>>4===7))for(const q of ['q','r','b','n'])out.push([f,t,q,flag]);else out.push([f,t,'',flag]);};if(p==='p'){const t=f-16*s.t;if(on(t)&&s.b[t]==='.'){add(t);const u=t-16*s.t;if(f>>4===(s.t===1?6:1)&&s.b[u]==='.')add(u);}for(const d of[-1,1]){const u=t+d;if(!on(u))continue;if(side(s.b[u])===-s.t)add(u);else if(u===s.ep&&s.b[u]==='.'&&s.b[u+16*s.t]===(s.t===1?'p':'P'))add(u,'ep');}}else{for(const d of(dirs[p]||dirs.k))for(let t=f+d;on(t);t+=d){if(side(s.b[t])===s.t)break;add(t);if(s.b[t]!=='.'||p==='n'||p==='k')break;}const home=s.t===1?116:4,rook=s.t===1?'R':'r',bits=s.t===1?[1,2]:[4,8];if(p==='k'&&f===home&&!checked(s)){if((s.c&bits[0])&&s.b[f+3]===rook&&s.b[f+1]==='.'&&s.b[f+2]==='.'&&!attacked(s,f+1,-s.t)&&!attacked(s,f+2,-s.t))add(f+2,'castle');if((s.c&bits[1])&&s.b[f-4]===rook&&s.b[f-1]==='.'&&s.b[f-2]==='.'&&s.b[f-3]==='.'&&!attacked(s,f-1,-s.t)&&!attacked(s,f-2,-s.t))add(f-2,'castle');}}}return out;}
const legal=s=>pseudo(s).filter(m=>!checked(apply(s,m),s.t));
const checkmate=s=>checked(s)&&legal(s).length===0;
const stalemate=s=>!checked(s)&&legal(s).length===0;
function insufficient(s){const pieces=[];for(let i=0;i<128;i++)if(on(i)&&s.b[i]!=='.'&&s.b[i].toLowerCase()!=='k')pieces.push([s.b[i].toLowerCase(),((i>>4)+(i&7))%2]);return pieces.length===0||(pieces.length===1&&['b','n'].includes(pieces[0][0]))||(pieces.every(p=>p[0]==='b')&&new Set(pieces.map(p=>p[1])).size===1);}

export { parseFen, fenOf, checked, apply, legal, checkmate, stalemate, insufficient, key, index, sq, side };
export function moveUci(s, uci) {const move=legal(s).find(m=>key(m)===uci);if(!move)throw Error(`Illegal UCI: ${uci}`);return apply(s,move)}
export function outcome(s){return checkmate(s)?"checkmate":stalemate(s)?"stalemate":insufficient(s)?"insufficient":null}
export function getPiece(s,square){return s.b[index(square)]}

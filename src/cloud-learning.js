import {randomBytes,createHash,createHmac,timingSafeEqual,randomUUID} from 'node:crypto';
import {getPool,tx} from './cloud-db.js';
import {getCatalog,getPuzzle,pickPuzzle} from './cloud-catalog.js';
import {parseFen,fenOf,apply,legal,key,checkmate} from './chess.js';
import {coachingFor} from './coach.js';

export const BASE={mate1:1,mate2:2,mate3:3};
export function verifyTelegram(raw,token,now=Math.floor(Date.now()/1000)){
  if(typeof raw!=='string'||!raw||raw.length>8192||typeof token!=='string'||!token)throw Error('Invalid authentication');
  const params=new URLSearchParams(raw),hash=params.get('hash'),auth=Number(params.get('auth_date'));
  if(!hash||!/^[a-f\d]{64}$/i.test(hash)||!Number.isSafeInteger(auth)||auth>now+60||now-auth>3600)throw Error('Invalid or expired authentication');
  if([...params.keys()].length!==new Set(params.keys()).size)throw Error('Duplicate auth field');
  const data=[...params.entries()].filter(([k])=>k!=='hash').sort((a,b)=>a[0].localeCompare(b[0],'en')).map(([k,v])=>k+'='+v).join('\n');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  const actual=createHmac('sha256',secret).update(data).digest();
  if(!timingSafeEqual(actual,Buffer.from(hash,'hex')))throw Error('Invalid authentication');
  let u;try{u=JSON.parse(params.get('user')||'null');}catch{throw Error('Invalid user');}
  if(!u||!Number.isSafeInteger(u.id)||u.id<=0)throw Error('Invalid user');
  // A closed pilot must not silently become public when the allowlist is unset.
  const allowed=(process.env.PILOT_TELEGRAM_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
  if(!allowed.includes(String(u.id)))throw Error('Аккаунт не включён в закрытый пилот');
  return {telegramId:String(u.id),suggestedName:String(u.first_name||'').slice(0,50)};
}
export function validName(s){return typeof s==='string'&&s.trim().length>=2&&s.trim().length<=30&&!/[<>\x00-\x1f]/.test(s);}
export const publicUser=u=>({id:u.id,displayName:u.display_name,leaderboardOptIn:false,friendsOptIn:false,points:u.points,solved:u.solved_count,skillRating:u.skill_rating});
export async function authenticateTelegram(raw){
  const {telegramId,suggestedName}=verifyTelegram(raw,process.env.TG_BOT_TOKEN);
  const now=Date.now(),userId=randomUUID();
  const r=await getPool().query(`INSERT INTO users (id,telegram_id,created_at) VALUES ($1,$2,$3)
   ON CONFLICT (telegram_id) DO UPDATE SET telegram_id=EXCLUDED.telegram_id RETURNING *`,[userId,telegramId,now]);
  const user=r.rows[0],token=randomBytes(32).toString('base64url'),hash=createHash('sha256').update(token).digest('hex');
  await getPool().query('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES ($1,$2,$3)',[hash,user.id,now+30*86400000]);
  return {token,user:publicUser(user),suggestedName};
}
export async function currentUser(bearer){
  if(typeof bearer!=='string'||!bearer||bearer.length>160)return null;
  const hash=createHash('sha256').update(bearer).digest('hex');
  const r=await getPool().query(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id
   WHERE s.token_hash=$1 AND s.expires_at>$2`,[hash,Date.now()]);return r.rows[0]||null;
}
export async function updateProfile(user,body){
  if(body.displayName!==undefined && !validName(body.displayName))throw Error('Имя от 2 до 30 символов');
  if(body.friendsOptIn===true)throw Error('Режим друзей недоступен в закрытом пилоте');
  if(body.leaderboardOptIn===true)throw Error('Общий рейтинг отключён');
  const name=body.displayName===undefined?user.display_name:body.displayName.trim();
  const r=await getPool().query('UPDATE users SET display_name=$1,friends_opt_in=FALSE,leaderboard_opt_in=FALSE WHERE id=$2 RETURNING *',[name,user.id]);return r.rows[0];
}
export async function stats(user){
  const r=await getPool().query(`SELECT category,COUNT(*)::int AS n FROM completions WHERE user_id=$1 GROUP BY category`,[user.id]);
  const counts=Object.fromEntries(r.rows.map(x=>[x.category,x.n]));
  const rr=await getPool().query(`SELECT c.category,c.points,a.hints,a.errors FROM completions c
    LEFT JOIN LATERAL (SELECT hints,errors FROM attempts WHERE user_id=c.user_id AND puzzle_id=c.puzzle_id AND status='solved' ORDER BY updated_at LIMIT 1) a ON true
    WHERE c.user_id=$1 ORDER BY c.solved_at DESC LIMIT 12`,[user.id]);
  const clean=rr.rows.filter(x=>x.hints===0&&x.errors===0).length;const accuracy=rr.rows.length?Math.round(clean/rr.rows.length*100):100;
  const mate1=counts.mate1||0,mate2=counts.mate2||0,mate3=counts.mate3||0;
  const stage=mate2>=25&&mate3>=5&&accuracy>=50?3:mate2>=15&&accuracy>=50?2:mate1>=12&&accuracy>=50?1:0;
  const names=['Шахматный следопыт','Ловец комбинаций','Маленький тактик','Капитан шахмат'];
  const descriptions=['Смотри, где король и куда он может убежать','Ищи первый ход и проверь ответ','Сравни два хода-кандидата','Считай несколько вариантов'];
  const weekly=await getPool().query('SELECT COUNT(*)::int AS n,COALESCE(SUM(points),0)::int AS points FROM completions WHERE user_id=$1 AND solved_at>=$2',[user.id,Date.now()-7*86400000]);
  const week=weekly.rows[0];
  const targets=[{done:mate1,total:12},{done:mate2,total:15},{done:mate2+mate3,total:30},{done:mate2+mate3,total:60}];
  const current=targets[stage];
  const school={stage:stage+1,name:names[stage],description:descriptions[stage],lastTwelveClean:accuracy,weekly:{solved:week.n,points:week.points,goal:8,completed:week.n>=8},nextStage:{current:Math.min(current.done,current.total),target:current.total},recommended:'progressive',sessionSize:5,categoryCounts:counts};
  const specs=[['first','Первый мат','♟',1],['five','Юный тактик','⚔',5],['twenty','Исследователь','✦',20],['fifty','Стратег','♜',50],['hundred','Шахматный герой','♛',100]];
  const badges=specs.map(([id,title,icon,target])=>({id,title,icon,description:`Реши ${target} разных задач`,type:'total',target,progress:Math.min(target,user.solved_count),earned:user.solved_count>=target}));
  for(const [cat,n,title,icon] of [['mate1',10,'Острый глаз','◎'],['mate2',10,'На два шага вперёд','♞'],['mate3',5,'Комбинатор','♝']])badges.push({id:cat+'_'+n,title,icon,description:`Реши ${n} задач`,type:cat,target:n,progress:Math.min(n,counts[cat]||0),earned:(counts[cat]||0)>=n});
  for(const n of [3,5])badges.push({id:'streak_'+n,title:'Безошибочная серия',icon:'⚡',description:`Реши ${n} без ошибок`,type:'bestStreak',target:n,progress:Math.min(n,user.best_streak),earned:user.best_streak>=n});
  const ladder=[5,20,50,100,250,500];let index=ladder.findIndex(n=>user.solved_count<n);if(index<0)index=ladder.length;
  const prev=index?ladder[Math.min(index-1,ladder.length-1)]:0,next=ladder[index];
  const game={streak:user.clean_streak,bestStreak:user.best_streak,counts, badges,level:index+1,levelName:['Разведчик','Искатель','Тактик','Стратег','Мастер задач','Легенда доски'][Math.min(index,5)],progress:{current:Math.max(0,user.solved_count-prev),target:next?next-prev:0,remaining:next?next-user.solved_count:0}};
  return {school,game,stage};
}
export async function startAttempt(user,mode,category){
  const profile=await stats(user);
  if(mode==='category'&&!BASE[category])throw Error('Неизвестная категория');
  const [completed,recent]=await Promise.all([
    getPool().query('SELECT puzzle_id FROM completions WHERE user_id=$1',[user.id]),
    getPool().query('SELECT puzzle_id FROM attempts WHERE user_id=$1 AND started_at>=$2',[user.id,Date.now()-7*86400000])]);
  const puzzle=pickPuzzle({category:mode==='category'?category:null,stage:profile.stage,skill:user.skill_rating,completed:completed.rows.map(x=>x.puzzle_id),recent:recent.rows.map(x=>x.puzzle_id)});
  const id=randomUUID(),now=Date.now();
  await tx(async db=>{
    const old=await db.query("UPDATE attempts SET status='skipped',updated_at=$1 WHERE user_id=$2 AND status='active'",[now,user.id]);
    if(old.rowCount)await db.query('UPDATE users SET clean_streak=0 WHERE id=$1',[user.id]);
    await db.query(`INSERT INTO attempts(id,user_id,puzzle_id,current_fen,started_at,updated_at)
      VALUES($1,$2,$3,$4,$5,$6)`,[id,user.id,puzzle.id,puzzle.fen,now,now]);
  });
  return publicAttempt({id,puzzle_id:puzzle.id,current_fen:puzzle.fen,errors:0,hints:0,status:'active'});
}
export function publicAttempt(a){
  const p=getPuzzle(a.puzzle_id);if(!p)throw Error('Puzzle unavailable');const {title,prompt,method}=coachingFor(p);
  return {id:a.id,position:a.current_fen,category:p.category,rating:p.rating,source:p.source,startedPosition:p.fen,errors:a.errors,hints:a.hints,status:a.status,lesson:{title,prompt,method}};
}
export async function findAttempt(user,id){const r=await getPool().query('SELECT * FROM attempts WHERE id=$1 AND user_id=$2',[id,user.id]);return r.rows[0]||null;}
export async function hint(user,id){return tx(async db=>{
  const result=await db.query('SELECT * FROM attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]);const a=result.rows[0];
  if(!a||a.status!=='active')throw Error('No active attempt');const p=getPuzzle(a.puzzle_id);if(!p)throw Error('Puzzle unavailable');
  const next=p.line[a.cursor];if(!next)throw Error('No hint');const hints=Math.min(2,a.hints+1);
  await db.query('UPDATE attempts SET hints=$1,updated_at=$2 WHERE id=$3',[hints,Date.now(),id]);
  return {hint:hints===1?{kind:'piece',square:next.slice(0,2)}:{kind:'move',from:next.slice(0,2),to:next.slice(2,4)},hints};
});}
export async function submitMove(user,id,uci){
  if(!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci||''))throw Error('Invalid move');
  return tx(async db=>{
    const result=await db.query('SELECT * FROM attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',[id,user.id]),a=result.rows[0];
    if(!a)throw Error('Attempt not found');if(a.status!=='active')throw Error('Attempt already completed');
    const p=getPuzzle(a.puzzle_id);if(!p)throw Error('Puzzle unavailable');
    const board=parseFen(a.current_fen),move=legal(board).find(m=>key(m)===uci);if(!move)throw Error('Illegal move');
    const alternate=(p.category==='mate1'||a.cursor===p.line.length-1)&&checkmate(apply(board,move));
    if(p.line[a.cursor]!==uci&&!alternate){
      await db.query('UPDATE attempts SET errors=errors+1,updated_at=$1 WHERE id=$2',[Date.now(),id]);
      return {correct:false,message:'Это законный ход, но он не решает заданную комбинацию.',position:a.current_fen,errors:a.errors+1};
    }
    let next=apply(board,move),cursor=a.cursor+1,defense=null;
    if(cursor<p.line.length){
      const enemy=legal(next).find(m=>key(m)===p.line[cursor]);if(!enemy)throw Error('Broken puzzle defense');
      defense=p.line[cursor];next=apply(next,enemy);cursor++;
    }
    const completed=cursor===p.line.length;let points=0,firstSolve=false;
    if(completed){
      if(!checkmate(next))throw Error('Puzzle did not end in checkmate');
      points=Math.max(1,BASE[p.category]-(a.hints>0?1:0)-(a.errors>0?1:0));
      const insert=await db.query(`INSERT INTO completions(user_id,puzzle_id,category,points,solved_at)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING puzzle_id`,[user.id,p.id,p.category,points,Date.now()]);
      firstSolve=insert.rowCount>0;
      if(firstSolve){
        const clean=+(a.hints===0&&a.errors===0),expected=1/(1+Math.pow(10,(p.rating-user.skill_rating)/400));
        const performance=a.hints?0.7:a.errors>0?0.6:1,delta=Math.round(24*(performance-expected));
        await db.query(`UPDATE users SET points=points+$1,solved_count=solved_count+1,
          skill_rating=GREATEST(600,LEAST(2400,skill_rating+$2)),
          clean_streak=CASE WHEN $3::int=1 THEN clean_streak+1 ELSE 0 END,
          best_streak=GREATEST(best_streak,CASE WHEN $3::int=1 THEN clean_streak+1 ELSE 0 END) WHERE id=$4`,[points,delta,clean,user.id]);
      }
    }
    const finalFen=fenOf(next);
    await db.query('UPDATE attempts SET current_fen=$1,cursor=$2,status=$3,updated_at=$4 WHERE id=$5',[finalFen,cursor,completed?'solved':'active',Date.now(),id]);
    return {correct:true,completed,position:finalFen,defense,points:firstSolve?points:0,category:p.category,firstSolve,lesson:completed?coachingFor(p):undefined};
  });
}

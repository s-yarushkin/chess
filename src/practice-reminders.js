import {getPool} from './cloud-db.js';
import {timingSafeEqual} from 'node:crypto';
export const TIPS=[
  "Шахматная разминка: попробуй найти все шахи, прежде чем выбрать лучший ход.",
  "Мат в один ход — отличный способ потренировать внимание. Можно решить пару задач в удобное время.",
  "Перед атакой проверь, есть ли у короля соперника свободная клетка.",
  "Шахматный совет: прежде чем ходить, посмотри на ответ соперника.",
  "Конь ходит буквой Г. Попробуй заметить вилку в очередной задаче.",
  "При поиске мата проверь три способа защиты: уйти королём, закрыться или взять атакующую фигуру.",
  "Небольшая разминка: найди фигуру, которая защищает сразу две важные клетки.",
  "Три–пять задач за неделю — вполне подходящий небольшой учебный план, если тебе удобно.",
  "Ладьи особенно полезны на открытых вертикалях. Поищи их возможности в задачах.",
  "Ферзь сочетает ходы ладьи и слона. Попробуй использовать оба направления атаки.",
  "Шахматный секрет: иногда тихий ход сильнее шаха.",
  "Если первый вариант не работает, попробуй найти другой. Ошибка помогает заметить новую идею.",
  "В задаче на мат важно видеть не только шах, но и все пути отступления короля.",
  "Попробуй решить одну задачу без подсказки, а если понадобится — воспользуйся ею.",
  "Связка: фигура не может уйти, если за ней находится король. Узнаёшь этот мотив?",
  "Двойной шах — особый случай: король должен уйти с атакованной клетки или взять одну из фигур безопасным ходом.",
  "Перед ходом проверь, не оставляешь ли свою фигуру под ударом.",
  "Угол доски ограничивает королю пространство. Это часто помогает найти матовую комбинацию.",
  "Хорошее упражнение: сначала посчитать вариант, а потом сделать ход.",
  "Пешка на последней горизонтали превращается в другую фигуру. Иногда выбор коня удивляет!",
  "В задачах на ничью иногда помогает пат: ходов нет, но король не под шахом.",
  "Попробуй увидеть, какие клетки контролируют твои слоны.",
  "Мат в два хода — это ещё и поиск ответа соперника. Не торопись с первым ходом.",
  "Если король открыт, посмотри, какие фигуры могут работать вместе.",
  "Шахматы учат замечать варианты. Выбери задачу по своему настроению.",
  "Две ладьи могут устроить мат лесенкой. Поищи этот мотив.",
  "Когда фигуры защищают друг друга, атака становится надёжнее.",
  "Иногда выгодно начать с взятия защищающей фигуры. Проверь, что получится дальше.",
  "Задачи на мат помогают знакомиться с типичными комбинациями.",
  "Шахматная минутка: найди самый безопасный ход короля.",
  "Проверь диагонали: слон может угрожать цели с другого края доски.",
  "Смотри на всю доску, а не только на фигуру, которой собираешься ходить.",
  "Полезно разобрать неудачный вариант и понять, почему он не сработал.",
  "В шахматах не обязательно спешить. У каждого свой темп решения.",
  "Хочется немного другой задачи? В академии есть мат в один, два и три хода, а также спасение ничьей.",
  "Маленькая шахматная пауза: одна задача, один интересный замысел. Играй, когда удобно."
];
export const WEEK=7*86400000;
export function allowedCron(header,secret=process.env.CRON_SECRET){
 if(typeof secret!=='string'||secret.length<24||typeof header!=='string')return false;
 const a=Buffer.from(header),b=Buffer.from('Bearer '+secret);
 return a.length===b.length&&timingSafeEqual(a,b);
}
export function daytimeMsk(now=Date.now()){
 const hour=(new Date(now).getUTCHours()+3)%24;
 return hour>=10&&hour<19;
}
export function reminderText(index){return '♟ '+TIPS[index%TIPS.length]+'\n\nОтключить напоминания: /stop';}
export async function recordActivity(userId,now=Date.now(),db=getPool()){
 await db.query('UPDATE users SET last_activity_at=$2,reminder_count=0 WHERE id=$1 AND (last_activity_at IS NULL OR last_activity_at<$2-60000)',[userId,now]);
}
export function isStopMessage(m){return m?.chat?.type==='private'&&Number.isSafeInteger(m.chat.id)&&m.chat.id>0&&m.from?.id===m.chat.id&&typeof m.text==='string'&&/^\/(stop|reminders_off)(?:@Chess_by_Alex_bot)?$/i.test(m.text.trim());}
export async function disableChatReminders(chatId,db=getPool()){
 await db.query('UPDATE users SET reminders_enabled=FALSE WHERE telegram_id=$1 OR id IN (SELECT user_id FROM linked_telegram_identities WHERE telegram_id=$1)',[String(chatId)]);
}
export async function runReminders({now=Date.now(),db=getPool(),fetcher=fetch,env=process.env}={}){
 if(!daytimeMsk(now)||!env.TG_BOT_TOKEN)return {claimed:0,sent:0,failed:0};
 // Claim before delivery: duplicate cron invocations cannot send the same reminder.
 // A failed/uncertain delivery is not retried immediately.
 const result=await db.query(`WITH due AS (
 SELECT u.id FROM users u WHERE u.reminders_enabled=TRUE AND u.display_name<>''
 AND u.last_activity_at<$1 AND u.reminder_count<2
 AND (u.last_reminder_at IS NULL OR u.last_reminder_at<$1)
 AND u.telegram_id ~ '^[1-9][0-9]{0,15}$'
 AND NOT EXISTS(SELECT 1 FROM admin_account_merges m WHERE m.source_user_id=u.id)
 ORDER BY u.last_activity_at,u.id LIMIT 20 FOR UPDATE SKIP LOCKED
 ) UPDATE users u SET last_reminder_at=$2,reminder_count=u.reminder_count+1,
 reminder_index=u.reminder_index+1 FROM due WHERE u.id=due.id
 RETURNING u.id,u.telegram_id,u.reminder_index-1 AS tip_index`,[now-WEEK,now]);
 let sent=0,failed=0;
 await Promise.all(result.rows.map(async row=>{
  try{
   const still=await db.query('SELECT 1 FROM users WHERE id=$1 AND reminders_enabled=TRUE AND last_activity_at<$2 AND last_reminder_at=$3',[row.id,now-WEEK,now]);
   if(!still.rowCount)return;
   const response=await fetcher('https://api.telegram.org/bot'+env.TG_BOT_TOKEN+'/sendMessage',{
    method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(3500),
    body:JSON.stringify({chat_id:row.telegram_id,text:reminderText(row.tip_index),reply_markup:{inline_keyboard:[[{text:'Открыть задачи',web_app:{url:env.WEBAPP_URL||'https://chess-academy-theta.vercel.app'}}]]}})
   });
   if(response.ok){sent++;return;}
   if(response.status===403)await db.query('UPDATE users SET reminders_enabled=FALSE WHERE id=$1',[row.id]);
   failed++;
  }catch{failed++;}
 }));
 return {claimed:result.rows.length,sent,failed};
}

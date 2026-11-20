/** Achievement definitions deliberately reward learning, not daily attendance. */
export const BADGES = Object.freeze([
  {id:'first',title:'Первый мат',icon:'♟',description:'Реши первую задачу',type:'total',target:1},
  {id:'five',title:'Юный тактик',icon:'⚔',description:'Реши 5 разных задач',type:'total',target:5},
  {id:'twenty',title:'Исследователь',icon:'✦',description:'Реши 20 разных задач',type:'total',target:20},
  {id:'fifty',title:'Стратег',icon:'♜',description:'Реши 50 разных задач',type:'total',target:50},
  {id:'hundred',title:'Шахматный герой',icon:'♛',description:'Реши 100 разных задач',type:'total',target:100},
  {id:'mate1_10',title:'Острый глаз',icon:'◎',description:'10 матов в один ход',type:'mate1',target:10},
  {id:'mate2_10',title:'На два шага вперёд',icon:'♞',description:'10 матов в два хода',type:'mate2',target:10},
  {id:'mate3_5',title:'Комбинатор',icon:'♝',description:'5 матов в три хода',type:'mate3',target:5},
  {id:'draw_5',title:'Защитник',icon:'◇',description:'Спаси 5 трудных позиций',type:'draw',target:5},
  {id:'streak_3',title:'Безошибочная тройка',icon:'⚡',description:'3 чистых решения подряд',type:'bestStreak',target:3},
  {id:'streak_5',title:'Уверенный мастер',icon:'★',description:'5 чистых решений подряд',type:'bestStreak',target:5}
]);

export function progressSnapshot(db,user){
  const counts=Object.fromEntries(db.prepare(`SELECT p.category,COUNT(*) AS n FROM completions c
    JOIN puzzles p ON p.id=c.puzzle_id WHERE c.user_id=? GROUP BY p.category`).all(user.id).map(r=>[r.category,r.n]));
  const values={total:user.solved_count, mate1:counts.mate1||0,mate2:counts.mate2||0,
    mate3:counts.mate3||0,draw:counts.draw||0,bestStreak:user.best_streak||0};
  const badges=BADGES.map(b=>({...b,earned:values[b.type]>=b.target,progress:Math.min(b.target,values[b.type]||0)}));
  const ladder=[{target:5,name:'Разведчик'}, {target:20,name:'Искатель'}, {target:50,name:'Тактик'},
    {target:100,name:'Стратег'}, {target:250,name:'Мастер задач'}, {target:500,name:'Легенда доски'}];
  const found=ladder.find(l=>user.solved_count<l.target);
  const currentIndex=found?ladder.indexOf(found):ladder.length;
  const prev=currentIndex===0?0:ladder[Math.min(currentIndex-1,ladder.length-1)].target;
  return {streak:user.clean_streak||0,bestStreak:values.bestStreak,
    counts:{mate1:values.mate1,mate2:values.mate2,mate3:values.mate3,draw:values.draw},
    badges, level:currentIndex+1,levelName:found?.name||'Легенда доски',
    progress:{current:Math.max(0,user.solved_count-prev),target:found?found.target-prev:0,remaining:found?found.target-user.solved_count:0}};
}

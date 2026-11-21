/** Calm, age-appropriate progression: two short sessions a week, no attendance penalties. */
export const WEEKLY_GOAL=8;
export const STAGES=Object.freeze([
  {name:'Шахматный следопыт',description:'Смотри, где король и куда он может убежать',rating:[400,850],mix:{mate1:1},target:12},
  {name:'Ловец комбинаций',description:'Ищи первый ход и обязательно проверяй ответ соперника',rating:[500,1050],mix:{mate1:.7,mate2:.3},target:15},
  {name:'Маленький тактик',description:'Сравни два хода-кандидата перед решением',rating:[650,1300],mix:{mate1:.25,mate2:.7,mate3:.05},target:25},
  {name:'Капитан шахмат',description:'Считай варианты на три хода без спешки',rating:[800,1550],mix:{mate1:.15,mate2:.55,mate3:.3},target:40}
]);
export function schoolProgress(db,user,now=Date.now()) {
  const byCategory=Object.fromEntries(db.prepare(`SELECT p.category, COUNT(*) AS n FROM completions c JOIN puzzles p ON p.id=c.puzzle_id
    WHERE c.user_id=? GROUP BY p.category`).all(user.id).map(x=>[x.category,x.n]));
  const recent=db.prepare(`SELECT a.hints,a.errors,p.category FROM completions c
    JOIN puzzles p ON p.id=c.puzzle_id
    LEFT JOIN attempts a ON a.id=(SELECT a2.id FROM attempts a2 WHERE a2.user_id=c.user_id AND a2.puzzle_id=c.puzzle_id AND a2.status='solved' ORDER BY a2.updated_at LIMIT 1)
    WHERE c.user_id=? ORDER BY c.solved_at DESC LIMIT 12`).all(user.id);
  const clean=recent.filter(x=>x.hints===0&&x.errors===0).length;
  const accuracy=recent.length?Math.round(clean/recent.length*100):100;
  const mate1=byCategory.mate1||0,mate2=byCategory.mate2||0,mate3=byCategory.mate3||0;
  const stage=mate2>=25&&mate3>=5&&accuracy>=50?3:mate2>=15&&accuracy>=50?2:mate1>=12&&accuracy>=50?1:0;
  const requirements=[{done:mate1,total:12},{done:mate2,total:15},{done:mate2+mate3,total:30},{done:mate2+mate3,total:60}];
  const current=requirements[stage];
  const week=db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(points),0) AS points FROM completions WHERE user_id=? AND solved_at>=?').get(user.id,now-7*86400_000);
  return {stage:stage+1,name:STAGES[stage].name,description:STAGES[stage].description,
    lastTwelveClean:accuracy,weekly:{solved:week.n,points:week.points,goal:WEEKLY_GOAL,completed:week.n>=WEEKLY_GOAL},
    nextStage:{current:Math.min(current.done,current.total),target:current.total},
    recommended:'progressive',sessionSize:5,categoryCounts:byCategory};
}
export function stageFor(db,user){return STAGES[schoolProgress(db,user).stage-1];}
export function chooseSchoolCategory(db,user,random=Math.random){
  const stage=stageFor(db,user),weights=Object.entries(stage.mix);
  const available=db.prepare('SELECT category FROM puzzles GROUP BY category').all().map(x=>x.category);
  const choices=weights.filter(([cat])=>available.includes(cat));
  if(!choices.length)throw Error('No puzzles imported');
  const total=choices.reduce((n,x)=>n+x[1],0);let r=random()*total;
  for(const [cat,weight] of choices){r-=weight;if(r<=0)return cat;}
  return choices[choices.length-1][0];
}

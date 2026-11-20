/** Pure chess-position helpers for authentic (not decorative) attack effects. */
export function attackersToKing(position){
  const victim=position.t;
  const target=position.b.indexOf(victim===1?'K':'k');
  if(target<0)return [];
  const out=[];
  const on=i=>i>=0&&i<128&&!(i&0x88);
  for(let from=0;from<128;from++){
    if(!on(from))continue;
    const p=position.b[from];if(p==='.')continue;
    const color=p===p.toUpperCase()?1:-1;if(color===victim)continue;
    const kind=p.toLowerCase();
    const dx=(target&7)-(from&7),dy=(target>>4)-(from>>4);
    let reaches=false;
    if(kind==='p')reaches=dy===-color && Math.abs(dx)===1;
    else if(kind==='n')reaches=(Math.abs(dx)===1&&Math.abs(dy)===2)||(Math.abs(dx)===2&&Math.abs(dy)===1);
    else if(kind==='k')reaches=Math.max(Math.abs(dx),Math.abs(dy))===1;
    else {
      const diagonal=Math.abs(dx)===Math.abs(dy)&&dx!==0;
      const straight=(dx===0)!==(dy===0);
      if((kind==='b'&&diagonal)||(kind==='r'&&straight)||(kind==='q'&&(diagonal||straight))){
        const step=(Math.sign(dy)*16)+Math.sign(dx);
        reaches=true;
        for(let i=from+step;i!==target;i+=step){if(!on(i)||position.b[i]!=='.'){reaches=false;break;}}
      }
    }
    if(reaches)out.push(from);
  }
  return out;
}

export const encouragement=Object.freeze([
  'Отличный расчёт!', 'Сильная комбинация!', 'Шахматный удар!',
  'Вот это тактика!', 'Точный ход!', 'Король пойман!'
]);

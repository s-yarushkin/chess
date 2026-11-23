// Temporary UI for a single administrator-authorized Telegram identity merge.
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const tg=()=>window.Telegram?.WebApp;
 let verifiedCode='';
 const status=s=>{ $('adminMergeStatus').textContent=s; };
 async function call(path,body){
  const signed=tg()?.initData;
  if(!signed)throw Error('Открой Шахматную академию через Telegram');
  // Always authenticate the *current* signed Telegram identity, even when the
  // browser retains a session from another Telegram login.
  const auth=await fetch('/api/auth/telegram',{method:'POST',
   headers:{'Content-Type':'application/json'},body:JSON.stringify({initData:signed})});
  const a=await auth.json();
  if(!auth.ok)throw Error(a.error||'Ошибка авторизации');
  const res=await fetch('/api/admin/merge/'+path,{method:'POST',
   headers:{'Content-Type':'application/json',Authorization:'Bearer '+a.token},
   body:JSON.stringify({...body,initData:signed})});
  const result=await res.json();
  if(!res.ok)throw Error(result.error||'Ошибка объединения');
  return result;
 }
 function init(){
  const user=tg()?.initDataUnsafe?.user;
  const handle=String(user?.username||'').toLowerCase();
  const isSource=handle==='sergeyyarushkin';
  const isTarget=handle==='n_yarushkina';
  const box=$('adminMerge');
  if(!box)return;
  box.hidden=!(isSource||isTarget);
  $('adminMergeSource').hidden=!isSource;
  $('adminMergeTarget').hidden=!isTarget;
  $('adminMergeCreate').addEventListener('click',async()=>{
   const b=$('adminMergeCreate');b.disabled=true;
   try{
    const out=await call('start',{});
    $('adminMergeCode').textContent='Код: '+out.code+' · действует 15 минут';
    status('Отправь этот код только владельцу @N_Yarushkina.');
   }catch(e){status(e.message);}finally{b.disabled=false;}
  });
  $('adminMergePreview').addEventListener('click',async()=>{
   const b=$('adminMergePreview');b.disabled=true;verifiedCode='';
   $('adminMergePreviewText').hidden=true;$('adminMergeConfirm').hidden=true;
   try{
    const code=$('adminMergeInput').value.trim().toUpperCase();
    const out=await call('preview',{code});
    $('adminMergePreviewText').textContent=
     '@SergeyYarushkin: '+out.sourceSolved+' задач; @N_Yarushkina: '+
     out.targetSolved+' задач. После объединения: '+out.combinedSolved+
     ' уникальных решений. Главный профиль — @N_Yarushkina. Оба аккаунта будут видеть одни результаты.';
    $('adminMergePreviewText').hidden=false;verifiedCode=code;
    $('adminMergeConfirm').hidden=false;status('Проверь результаты и подтверди.');
   }catch(e){status(e.message);}finally{b.disabled=false;}
  });
  $('adminMergeInput').addEventListener('input',()=>{
   verifiedCode='';$('adminMergeConfirm').hidden=true;$('adminMergePreviewText').hidden=true;
  });
  $('adminMergeConfirm').addEventListener('click',async()=>{
   if(!verifiedCode)return;
   if(!window.confirm('Объединить два Telegram-аккаунта в профиль @N_Yarushkina? Это разовая операция.'))return;
   const b=$('adminMergeConfirm');b.disabled=true;
   try{
    const out=await call('confirm',{code:verifiedCode,confirm:true});
    $('adminMergePreviewText').textContent='Объединено: '+out.solved+' задач, '+out.points+' баллов.';
    $('adminMergeConfirm').hidden=true;verifiedCode='';$('adminMergeInput').value='';
    status('Готово! Теперь открой игру заново через любой из двух аккаунтов.');
   }catch(e){status(e.message);}finally{b.disabled=false;}
  });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();

// Voluntary thank-you. No direct charges, no paywalls, no automatic payment confirmation.
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 const PHONE='+79211282845',BANK='Ozon Банк';
 let selected=null,custom=false,loaded=false;
 const format=n=>n.toLocaleString('ru-RU')+' ₽';
 function amount(){
  if(custom){
   const n=Number($('donateCustomAmount').value);
   return Number.isInteger(n)&&n>=10&&n<=10000?n:null;
  }
  return selected;
 }
 function render(){
  const n=amount();
  $('donateSummary').textContent=n?'Выбранная сумма: '+format(n):'Выбери сумму для перевода';
 }
 function choose(kind){
  custom=kind==='custom';
  selected=custom?null:Number(kind);
  $('donateCustomWrap').hidden=!custom;
  document.querySelectorAll('.donate-choice').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.amount===kind)));
  render();
  if(custom)$('donateCustomAmount').focus();
 }
 function message(s){$('donateMessage').textContent=s;}
 async function copy(value){
  try{
   await navigator.clipboard.writeText(value);
   message('Скопировано! Открой приложение своего банка.');
  }catch{message('Не удалось скопировать автоматически. Номер указан выше.');}
 }
 async function load(){
  if(loaded)return;
  try{
   const res=await fetch('/api/donation',{cache:'no-store'});
   if(!res.ok)throw Error('Unavailable');
   const config=await res.json();
   if(config.phone===PHONE&&config.bank===BANK&&config.qrAvailable&&
      typeof config.qrDataUrl==='string'&&config.qrDataUrl.startsWith('data:image/png;base64,')&&
      typeof config.paymentUrl==='string'){
      const u=new URL(config.paymentUrl);
      const allowed=['ozon.ru','ozonbank.ru','nspk.ru'];
      if(u.protocol==='https:'&&allowed.some(d=>u.hostname===d||u.hostname.endsWith('.'+d))){
       $('donateQrImage').src=config.qrDataUrl;
       $('donateQrLink').href=u.href;
       $('donateQrReady').hidden=false;
       $('donateQrPending').hidden=true;
      }
   }
   loaded=true;
  }catch{
   $('donateQrPending').textContent='Платёжный QR ещё не настроен. Можно перевести по номеру СБП выше.';
  }
 }
 function init(){
  const dialog=$('donateDialog');
  if(!dialog)return;
  $('donateOpen').addEventListener('click',()=>{
   if(!dialog.open)dialog.showModal();
   message('');
   void load();
  });
  for(const b of document.querySelectorAll('.donate-choice'))
   b.addEventListener('click',()=>choose(b.dataset.amount));
  $('donateCustomAmount').addEventListener('input',render);
  $('donateCopyPhone').addEventListener('click',()=>void copy(PHONE));
  $('donateCopyAll').addEventListener('click',()=>{
   const n=amount();
   const value='Благодарность Chess Academy\nБанк: '+BANK+
    '\nТелефон СБП: '+PHONE+
    '\nСумма: '+(n?format(n):'укажите самостоятельно');
   void copy(value);
  });
  // Nothing selected by default. No donation tracking or rewards.
  render();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();

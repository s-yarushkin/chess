// Simple voluntary thank-you UI: direct bank link + QR, no phone-number transfer.
(function(){
 'use strict';
 const $=id=>document.getElementById(id);
 let selected=null,custom=false,loaded=false;
 const format=n=>n.toLocaleString('ru-RU')+' ₽';
 function amount(){
  if(custom){
   const raw=$('donateCustomAmount').value.trim();
   const n=Number(raw);
   return raw!==''&&Number.isInteger(n)&&n>=10&&n<=10000?n:null;
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
  document.querySelectorAll('.donate-choice').forEach(b=>{
   b.setAttribute('aria-pressed',String(b.dataset.amount===kind));
  });
  render();
  if(custom)$('donateCustomAmount').focus();
 }
 async function load(){
  if(loaded)return;
  try{
   const res=await fetch('/api/donation',{cache:'no-store'});
   if(!res.ok)throw Error('Bank link unavailable');
   const cfg=await res.json();
   if(!cfg.qrAvailable||typeof cfg.qrDataUrl!=='string'||!cfg.qrDataUrl.startsWith('data:image/png;base64,')
     ||typeof cfg.paymentUrl!=='string')throw Error('Bank link unavailable');
   const url=new URL(cfg.paymentUrl);
   const allowed=['ozon.ru','ozonbank.ru','nspk.ru'];
   if(url.protocol!=='https:'||!allowed.some(d=>url.hostname===d||url.hostname.endsWith('.'+d)))
    throw Error('Untrusted bank URL');
   $('donateQrLink').href=url.href;
   $('donateQrImage').src=cfg.qrDataUrl;
   $('donateQrReady').hidden=false;
   $('donateQrPending').hidden=true;
   loaded=true;
  }catch{
   $('donateQrPending').textContent='Не удалось загрузить банковскую ссылку. Закрой окно и открой снова.';
  }
 }
 function init(){
  const dialog=$('donateDialog');
  if(!dialog)return;
  $('donateOpen').addEventListener('click',()=>{
   if(!dialog.open)dialog.showModal();
   void load();
  });
  for(const b of document.querySelectorAll('.donate-choice'))
   b.addEventListener('click',()=>choose(b.dataset.amount));
  $('donateCustomAmount').addEventListener('input',render);
  // No default donation, no direct charge, no payment tracking.
  render();
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});
 else init();
})();

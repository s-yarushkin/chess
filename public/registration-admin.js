// Admin-only controls are created AFTER a signed, server-verified Telegram session.
// No Telegram IDs, usernames or bot secrets are shipped to the browser.
(function(){
  'use strict';
  let checking=false;
  const tg=()=>window.Telegram?.WebApp;
  async function request(operation){
    const signed=tg()?.initData;
    const token=sessionStorage.getItem('chess_session');
    if(!signed||!token)return null;
    const response=await fetch('/api/admin/registrations/'+operation,{
      method:'POST',headers:{
        'Content-Type':'application/json',
        Authorization:'Bearer '+token
      },
      body:JSON.stringify({initData:signed})
    });
    if(response.status===403||response.status===404)return null;
    let body;
    try{body=await response.json();}catch{throw Error('Сервер не вернул ответ');}
    if(!response.ok)throw Error(body.error||'Не удалось подключить уведомления');
    return body;
  }
  function render(info){
    if(!info?.admin)return;
    const form=document.querySelector('#profile form');
    if(!form)return;
    let box=document.getElementById('registrationAdminControls');
    if(!box){
      box=document.createElement('section');
      box.id='registrationAdminControls';
      box.className='reg-admin-controls';
      const title=document.createElement('h3');
      title.textContent='Служебные уведомления';
      const status=document.createElement('p');
      status.id='registrationAdminStatus';
      status.setAttribute('role','status');
      const button=document.createElement('button');
      button.type='button';
      button.className='button soft';
      button.textContent='Подключить сообщения от бота';
      button.id='registrationAdminActivate';
      button.addEventListener('click',async()=>{
        button.disabled=true;
        status.textContent='Проверяем личный чат и настраиваем Telegram…';
        try{
          const result=await request('activate');
          if(!result)throw Error('Нет доступа к управлению уведомлениями');
          render(result);
        }catch(e){status.textContent=e.message;}
        finally{button.disabled=false;}
      });
      box.append(title,status,button);
      form.appendChild(box);
    }
    const status=box.querySelector('#registrationAdminStatus');
    const button=box.querySelector('#registrationAdminActivate');
    if(info.recipientReady===false){
      status.textContent=info.reason==='missing'?
        'В Production Vercel не найдены настройки получателя. Проверь REGISTRATION_ADMIN_CHAT_ID и REGISTRATION_ADMIN_USERNAME, затем сделай Redeploy.':
        'Настройки получателя в Vercel не совпадают с текущим Telegram-аккаунтом. Проверь обе переменные и Production Redeploy.';
      button.hidden=true;
      return;
    }
    status.textContent=info.connected?
      'Telegram подключён. Напиши боту /registrations для проверки.':
      'Telegram ещё не доставляет команды на сервер.';
    if(info.lastError)status.textContent+=' Ошибка: '+String(info.lastError).slice(0,150);
    button.hidden=!!info.connected;
  }
  async function inspect(){
    if(checking||!tg()?.initData)return;
    checking=true;
    try{
      const result=await request('status');
      if(result)render(result);
    }catch{/* Do not show internal admin information to unauthorized users. */}
    finally{checking=false;}
  }
  document.addEventListener('click',e=>{
    if(e.target?.closest?.('#profileButton'))void inspect();
  });
})();

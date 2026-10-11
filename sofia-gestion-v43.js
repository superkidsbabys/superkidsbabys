(function(){
  'use strict';
  const API='https://superkids-pagos-api.superkids-babys.workers.dev/sofia/equipo';
  const ALLOWED=new Set(['F2SHGFQYSuMWlkbQKV8yrKAXgaH3','MtQpryHLGYab5v3UjhRZw88CAD63']);
  const DEVICE_KEY='superkids-sofia-device-v44';
  let deviceToken='',unsubscribe=null,sessionVersion=0,refreshVersion=0;
  try {deviceToken=localStorage.getItem(DEVICE_KEY)||'';}catch{}
  const uid=()=>window.usuarioActual?.uid;
  const authorized=()=>ALLOWED.has(uid());
  function checkSession(expected,version){if(!authorized()||uid()!==expected||sessionVersion!==version)throw Error('La sesión cambió. Vuelve a abrir Gestión.');}
  function stopForeground(){if(unsubscribe){unsubscribe();unsubscribe=null;}}
  function paintDeviceButton(busy=false){
    const button=document.getElementById('sofia-device-toggle-v44');if(!button)return;
    const active=Boolean(deviceToken);
    button.disabled=busy;
    button.textContent=busy?'Guardando…':active?'✓ Activados · Desactivar':'○ Desactivados · Activar';
    button.setAttribute('aria-pressed',String(active));
    button.title='Registro de avisos de Sofía en este navegador';
    button.style.cssText='margin:0 0 0 auto;padding:5px 9px;min-height:30px;border:1px solid '+(active?'#166534':'#991b1b')+';border-radius:16px;background:'+(active?'#dcfce7':'#fee2e2')+';color:'+(active?'#166534':'#991b1b')+';font:700 12px Nunito,Segoe UI,sans-serif;cursor:'+(busy?'wait':'pointer')+';opacity:'+(busy?'.7':'1');
  }
  async function revokeDevice(){
    if(!deviceToken)return;
    await window.sofiaEquipoV43({action:'quitar-dispositivo',token:deviceToken});
    deviceToken='';try{localStorage.removeItem(DEVICE_KEY);}catch{}
    stopForeground();
    paintDeviceButton();
  }
  function installLogout(){
    const original=window.fbLogout;if(typeof original!=='function'||original.sofiaWrappedV44)return;
    const wrapped=async function(...args){try{if(authorized())await revokeDevice();}catch(e){alert('No se pudo desactivar este dispositivo. Revisa la conexión antes de cerrar sesión. '+e.message);return;}return original.apply(this,args);};
    wrapped.sofiaWrappedV44=true;window.fbLogout=wrapped;
  }
  window.sofiaEquipoV43=async function(body){
    const expected=uid(),version=sessionVersion;if(!authorized())throw Error('Integrante no autorizada');
    const token=await window.obtenerTokenSesion();checkSession(expected,version);if(!token)throw Error('Inicia sesión en Gestión');
    const response=await fetch(API,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(20000)});
    const result=await response.json();checkSession(expected,version);if(!response.ok||!result.ok)throw Error(result.error||'No se pudo completar la operación');return result;
  };
  function panel(){
    let root=document.getElementById('sofia-alertas-v43');if(root)return root;
    root=document.createElement('section');root.id='sofia-alertas-v43';root.style.cssText='margin:12px;padding:14px;background:#fff6fc;border:1px solid #edcce5;border-radius:12px';
    const header=document.createElement('div');header.style.cssText='display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap';
    const title=document.createElement('strong');title.textContent='Sofía · avisos del equipo';header.append(title);
    const enable=document.createElement('button');enable.type='button';enable.id='sofia-device-toggle-v44';
    const status=document.createElement('p');status.setAttribute('role','status');
    enable.onclick=async()=>{
      if(enable.disabled)return;
      if(deviceToken){await disable.onclick();return;}
      paintDeviceButton(true);
      try {
        const expected=uid(),version=sessionVersion;if(!authorized())throw Error('Integrante no autorizada');
        if(!('Notification' in window))throw Error('Este navegador no admite avisos. En iPhone abre Gestión instalada en la pantalla de inicio.');
        if(await Notification.requestPermission()!=='granted')throw Error('Debes permitir las notificaciones en este dispositivo');
        const settings=await window.sofiaEquipoV43();if(!settings.vapidKey)throw Error('Falta configurar la clave pública Web Push en el servidor');
        const mod=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging.js');
        if(!await mod.isSupported())throw Error('Instala Gestión en la pantalla de inicio o usa un navegador compatible');
        const app=await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js');
        const messaging=mod.getMessaging(app.getApps()[0]);const registration=await navigator.serviceWorker.ready;
        checkSession(expected,version);
        await mod.deleteToken(messaging);
        checkSession(expected,version);
        const nextToken=await mod.getToken(messaging,{vapidKey:settings.vapidKey,serviceWorkerRegistration:registration});
        checkSession(expected,version);
        await window.sofiaEquipoV43({action:'registrar-dispositivo',token:nextToken});
        checkSession(expected,version);deviceToken=nextToken;try{localStorage.setItem(DEVICE_KEY,deviceToken);}catch{}
        stopForeground();unsubscribe=mod.onMessage(messaging,payload=>{
          if(uid()!==expected||sessionVersion!==version||!authorized())return;
          status.textContent=payload.notification?.body||'Hay casos pendientes de Sofía';
          registration.showNotification(payload.notification?.title||'SuperKids · Sofía',{body:status.textContent,tag:'sofia-equipo',renotify:true}).catch(()=>{});
        });
        status.textContent='Dispositivo registrado. Falta comprobar un aviso real con Gestión en segundo plano.';
      }catch(error){status.textContent=error.message;}finally{paintDeviceButton();}
    };
    const disable=document.createElement('button');disable.type='button';disable.textContent='Desactivar avisos de este dispositivo';disable.onclick=async()=>{
      paintDeviceButton(true);
      try{if(!deviceToken)throw Error('No hay un dispositivo registrado en este navegador');await revokeDevice();status.textContent='Avisos desactivados';}catch(e){status.textContent=e.message;}finally{paintDeviceButton();}
    };
    header.append(enable);root.append(header,status);const list=document.createElement('div');list.id='sofia-casos-v43';root.append(list);
    document.getElementById('fp-sofia')?.parentElement.insertAdjacentElement('afterend',root);
    paintDeviceButton();return root;
  }
  async function refresh(){
    installLogout();const requestVersion=++refreshVersion,expected=uid(),version=sessionVersion;
    const root=panel();if(!ALLOWED.has(window.usuarioActual?.uid)){root.hidden=true;return;}root.hidden=false;
    try {
      const result=await window.sofiaEquipoV43();checkSession(expected,version);if(requestVersion!==refreshVersion)return;const list=root.querySelector('#sofia-casos-v43');list.replaceChildren();
      for(const notice of result.avisos){
        const row=document.createElement('div');row.style.cssText='padding:8px;border-top:1px solid #eee';
        const text=document.createElement('span');text.textContent=notice.tipo==='pedido'?'Pedido #SK-'+notice.numeroPedido+' pendiente':(notice.motivo==='envio-1kg'?'Envío supera 1 kg: terminar de cotizar (más de 6 prendas) · WhatsApp ':'Cliente solicita una asesora · WhatsApp ')+String(notice.telefono||'');
        const button=document.createElement('button');button.type='button';button.style.marginLeft='10px';button.textContent='Tomar caso · detener avisos';
        button.onclick=async()=>{try{
          checkSession(expected,version);if(notice.tipo==='asesora') {
            const token=await window.obtenerTokenSesion();checkSession(expected,version);
            const response=await fetch(API.replace('/sofia/equipo','/equipo/whatsapp'),{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({action:'take',conversation:notice.conversationId})});
            const result=await response.json();checkSession(expected,version);if(!response.ok||!result.ok)throw Error(result.error||'No se pudo tomar la conversación');
            alert('Conversación tomada. Abre la bandeja WhatsApp para atender al '+String(notice.telefono||''));
          } else {await window.sofiaEquipoV43({action:'tomar',id:notice.id});window.filtrarVistaPedidos('sofia');}
          await refresh();
        }catch(e){alert(e.message);}};
        row.append(text,button);list.append(row);
      }
      if(!result.avisos.length)list.textContent='No hay casos sin atender.';
    }catch(e){if(uid()===expected&&sessionVersion===version&&requestVersion===refreshVersion)root.querySelector('[role="status"]').textContent=e.message;}
  }
  window.addEventListener('superkids-session-change',()=>{
    sessionVersion++;refreshVersion++;stopForeground();
    const root=document.getElementById('sofia-alertas-v43');if(root){root.hidden=true;root.querySelector('#sofia-casos-v43')?.replaceChildren();const status=root.querySelector('[role="status"]');if(status)status.textContent='';}
    refresh();
  });
  installLogout();document.addEventListener('DOMContentLoaded',refresh);setInterval(refresh,30000);
})();

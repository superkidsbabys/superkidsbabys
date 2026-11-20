/* SuperKids: decoración estacional. No escribe datos ni cambia fotos o precios. */
(function () {
  'use strict';
  if (window.superkidsNavidadV212) return;
  window.superkidsNavidadV212 = true;
  const palettes = {
    pink: { color: '#cf386e', light: '#f9a6bd', dark: '#9f2453', wash: '#fff0f5' },
    blue: { color: '#246bb4', light: '#8ec6ed', dark: '#184c86', wash: '#edf6ff' }
  };
  function pinkSection(id) { return id === 'btn-gen-ninas' || id === 'btn-gen-junior-ninas'; }
  const assetRoot = new URL('./navidad-assets/', document.currentScript?.src || location.href);
  function asset(name) { return 'url("' + new URL(name + '.png', assetRoot).href + '")'; }
  const style = document.createElement('style'); style.id = 'sk-navidad-style-v212';
  style.textContent = `
    body.sk-navidad-v211 { position:relative;isolation:isolate;background-color:#fffaf2!important;background-image:none!important; }
    body.sk-navidad-v211::before { content:'';position:absolute;top:var(--sk-edge-start,420px);bottom:0;left:0;right:0;z-index:-1;pointer-events:none;background-image:var(--sk-edge-left),var(--sk-edge-right);background-position:left top,right top;background-repeat:repeat-y;background-size:clamp(30px,11vw,150px) auto; }
    .sk-navidad-v211 .logo-contenedor { overflow:visible!important; }
    .sk-logo-navidad { display:none;position:absolute;inset:-24% -24% -24%;pointer-events:none;z-index:3;background:var(--sk-wreath) center/100% 100% no-repeat; }
    .sk-navidad-v211 .sk-logo-navidad { display:block; }
    .sk-navidad-v211 #contenedor-productos .producto { border:1.4px solid var(--sk-color)!important;background:#fff!important;box-shadow:0 5px 18px #976e4c14; }
    .sk-navidad-v211 #contenedor-productos .producto .btn-agregar:not(:disabled) { background:var(--sk-color)!important;color:white!important; }
    .sk-navidad-v211 .selector-genero .btn-genero.activo { background:var(--sk-light)!important;color:#26313d!important; }
    .sk-navidad-v211 #btn-flotante-carrito { border-color:var(--sk-color)!important;color:var(--sk-dark)!important;background:white!important; }
    .sk-navidad-v211 .filtros-accordion>.btn-compartir,.sk-navidad-v211 .filtros-row-toggle .btn-compartir { border-color:var(--sk-color)!important;color:var(--sk-dark)!important; }
    #sk-navidad-heading-v211 { display:none;text-align:center;margin:22px auto 12px;padding:0 26px;color:var(--sk-color);font-family:Georgia,serif;font-size:clamp(22px,3vw,36px);font-style:italic;line-height:1.35; }
    .sk-navidad-v211 #sk-navidad-heading-v211 { display:block; }
    #sk-navidad-heading-v211::after { content:'✧  ♥  ✧';display:block;font:18px Georgia,serif;color:var(--sk-color);margin-top:7px; }
    @media(max-width:700px) { body.sk-navidad-v211::before{background-size:30px auto;background-repeat:no-repeat;opacity:.85}.sk-navidad-v211 .sk-logo-navidad{inset:-22% -22% -22%}#sk-navidad-heading-v211{margin:14px auto 10px;font-size:22px} }
    @media print { .sk-logo-navidad,#sk-navidad-heading-v211,body.sk-navidad-v211::before{display:none!important} }
  `;
  document.head.append(style);
  let lastTheme = '', queued = false;
  function update() {
    queued = false;
    const header = document.querySelector('.header-tienda'), nav = document.querySelector('.selector-genero');
    const visible = Boolean(header && nav && header.getClientRects().length && nav.getClientRects().length);
    document.body.classList.toggle('sk-navidad-v211', visible);
    if (!visible) return;
    const selected = nav.querySelector('.btn-genero.activo');
    const theme = pinkSection(selected?.id || 'btn-gen-ninas') ? 'pink' : 'blue';
    if (lastTheme !== theme) {
      const p = palettes[theme], root = document.documentElement;
      root.style.setProperty('--sk-color', p.color);root.style.setProperty('--sk-light', p.light);root.style.setProperty('--sk-dark', p.dark);
      root.style.setProperty('--sk-edge-left', asset(theme === 'pink' ? 'borde-rosa' : 'borde-azul'));root.style.setProperty('--sk-edge-right', asset(theme === 'pink' ? 'borde-rosa' : 'borde-azul'));root.style.setProperty('--sk-wreath', asset(theme === 'pink' ? 'corona-rosa' : 'corona-azul'));
      root.dataset.skChristmas = theme;lastTheme = theme;
    }
    const top = Math.round(nav.getBoundingClientRect().top + window.scrollY);
    document.documentElement.style.setProperty('--sk-edge-start', top + 'px');
    const logo = document.querySelector('.logo-contenedor');
    if (logo && !logo.querySelector('.sk-logo-navidad')) { const frame = document.createElement('span'); frame.className='sk-logo-navidad';frame.setAttribute('aria-hidden','true');logo.append(frame); }
    if (!document.getElementById('sk-navidad-heading-v211')) { const heading=document.createElement('div');heading.id='sk-navidad-heading-v211';heading.textContent='Una Navidad llena de ternura';nav.after(heading); }
  }
  function schedule() { if (!queued) {queued=true;requestAnimationFrame(update);} }
  function init() {
    update();
    const nav=document.querySelector('.selector-genero');
    if (nav) new MutationObserver(schedule).observe(nav,{subtree:true,attributes:true,attributeFilter:['class','style']});
    const header=document.querySelector('.header-tienda');
    if(header)new MutationObserver(schedule).observe(header,{attributes:true,attributeFilter:['style','class']});
    if(typeof ResizeObserver!=='undefined') {const observer=new ResizeObserver(schedule);if(header)observer.observe(header);if(nav)observer.observe(nav);}
    window.addEventListener('resize',schedule);window.addEventListener('superkids-session-change',schedule);
    document.addEventListener('click',e=>{if(e.target.closest('.btn-genero,.btn-toggle-admin,.btn-tab'))schedule();});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();


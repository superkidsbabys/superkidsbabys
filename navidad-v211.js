/* SuperKids: decoración estacional. No escribe datos ni cambia fotos o precios. */
(function () {
  'use strict';
  if (window.superkidsNavidadV211) return;
  window.superkidsNavidadV211 = true;
  const palettes = {
    pink: { color: '#cf386e', light: '#f9a6bd', dark: '#9f2453', wash: '#fff0f5' },
    blue: { color: '#246bb4', light: '#8ec6ed', dark: '#184c86', wash: '#edf6ff' }
  };
  function pinkSection(id) { return id === 'btn-gen-ninas' || id === 'btn-gen-junior-ninas'; }
  function definitions(p) {
    return `<defs>
      <linearGradient id="r" x2="1" y2="1"><stop stop-color="${p.light}"/><stop offset=".5" stop-color="${p.color}"/><stop offset="1" stop-color="${p.dark}"/></linearGradient>
      <linearGradient id="g" x2="1" y2="1"><stop stop-color="#b5c38a"/><stop offset=".55" stop-color="#7b9859"/><stop offset="1" stop-color="#456f47"/></linearGradient>
      <linearGradient id="gold" x2="1" y2="1"><stop stop-color="#fff0b2"/><stop offset=".5" stop-color="#e7ae3c"/><stop offset="1" stop-color="#bb8127"/></linearGradient>
      <radialGradient id="bauble" cx=".3" cy=".25"><stop stop-color="${p.light}"/><stop offset=".65" stop-color="${p.color}"/><stop offset="1" stop-color="${p.dark}"/></radialGradient>
      <g id="star"><path d="M0-13 3.8-4.2 13-4 6 2 8.3 12 0 6.5-8.3 12-6 2-13-4-3.8-4.2Z" fill="url(#gold)" stroke="#c58e2e" stroke-width=".6"/><path d="M0-10 0 4-10-3-3-3Z" fill="#fff5cc" opacity=".75"/></g>
      <g id="bow"><path d="M0 0C-15-27-39-22-33-4Q-21 9 0 0M0 0C15-27 39-22 33-4Q21 9 0 0" fill="url(#r)" stroke="${p.dark}" stroke-width=".6"/><path d="M-4 1-19 31-7 26 0 34 7 6 19 31 25 20 32 21 6 0" fill="url(#r)"/><ellipse rx="7" ry="8" fill="${p.color}" stroke="${p.light}"/></g>
      <g id="tree"><rect x="-5" y="-5" width="10" height="27" rx="2" fill="#9b7049"/>
        <path d="M0-115C-5-91-19-70-34-63L-23-63Q-35-42-49-34L-32-36Q-43-12-62-4Q-32 8 0-2Q32 8 62-4Q43-12 32-36L49-34Q35-42 23-63L34-63Q9-87 0-115Z" fill="url(#g)" stroke="#728752" stroke-width="1.3"/>
        <path d="M-22-65Q0-52 24-65M-34-36Q0-21 35-36M-46-6Q0 7 47-6" fill="none" stroke="#d0d8aa" stroke-width="4" opacity=".75"/>
        <path d="M-19-77Q24-63 21-52Q-33-40-29-24Q36-7 42-12" fill="none" stroke="#efdc9c" stroke-width="1.7"/>
        <g fill="#fff1b0" stroke="#e3b84e"><circle cx="-18" cy="-76" r="3"/><circle cx="21" cy="-52" r="3"/><circle cx="-28" cy="-25" r="3"/><circle cx="41" cy="-12" r="3"/></g>
        <g fill="${p.color}"><circle cx="-9" cy="-51" r="4"/><circle cx="23" cy="-19" r="4"/><circle cx="-36" cy="-5" r="4"/></g><use href="#star" transform="translate(0 -116) scale(.8)"/>
      </g>
      <g id="gift"><rect x="-32" y="0" width="64" height="55" rx="3" fill="#f4e4c9" stroke="#d8be96"/><path d="M-30 4 28 4M-29 49 29 49" stroke="#fff6e6" stroke-width="3"/><rect x="-6" width="12" height="55" fill="url(#r)"/><rect x="-35" y="-5" width="70" height="12" rx="2" fill="#f9edda" stroke="#d8be96"/><path d="M-34 1H34" stroke="${p.color}" stroke-width="4"/><use href="#bow" transform="translate(0 -6) scale(.63)"/></g>
    </defs>`;
  }
  function edge(p, mirrored) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 950">${definitions(p)}<g ${mirrored ? 'transform="translate(150 0) scale(-1 1)"' : ''}>
      <g fill="none" stroke="#d6af62" stroke-width="1.2"><path d="M44 0v72M107 0v112"/></g>
      <g><circle cx="44" cy="99" r="25" fill="url(#bauble)"/><rect x="38" y="69" width="12" height="7" rx="2" fill="url(#gold)"/><path d="M44 83v32M28 99h32M33 88l22 22M33 110l22-22" stroke="#fff8ef" fill="none" opacity=".85"/><circle cx="107" cy="135" r="21" fill="url(#bauble)"/><rect x="102" y="109" width="10" height="7" rx="2" fill="url(#gold)"/><path d="M97 133q10-16 20 0M97 143q10-16 20 0" stroke="#fff4e4" fill="none"/></g>
      <use href="#star" transform="translate(20 193) scale(.65)"/><use href="#star" transform="translate(114 245) scale(.55)"/>
      <use href="#tree" transform="translate(66 398) scale(.9)"/>
      <use href="#star" transform="translate(23 457) scale(.55)"/><use href="#star" transform="translate(120 505) scale(.8)"/>
      <g transform="translate(18 605) rotate(-25)"><path d="M0 70Q20 20 20-10" fill="none" stroke="#637f45" stroke-width="2"/><g fill="url(#g)"><ellipse cx="12" cy="4" rx="5" ry="13" transform="rotate(-35 12 4)"/><ellipse cx="29" cy="13" rx="5" ry="13" transform="rotate(35 29 13)"/><ellipse cx="5" cy="27" rx="5" ry="14" transform="rotate(-40 5 27)"/><ellipse cx="23" cy="38" rx="5" ry="13" transform="rotate(35 23 38)"/></g><g fill="${p.color}"><circle cx="15" cy="-10" r="5"/><circle cx="27" cy="-3" r="4"/></g></g>
      <use href="#gift" transform="translate(75 757) scale(1.1)"/><use href="#gift" transform="translate(35 822) scale(.8)"/>
      <use href="#star" transform="translate(113 883) scale(.65)"/><use href="#star" transform="translate(31 930) scale(.45)"/>
    </g></svg>`;
  }
  function wreath(p) {
    let leaves = '';
    for (let side of [-1, 1]) for (let i = 0; i < 12; i++) {
      const a = (42 + i * 10) * Math.PI / 180, x = 100 + side * 83 * Math.sin(a), y = 96 - 83 * Math.cos(a);
      leaves += `<ellipse cx="${x}" cy="${y}" rx="4" ry="11" fill="url(#g)" stroke="#6b8349" stroke-width=".4" transform="rotate(${side * (40 + i * 9)} ${x} ${y})"/>`;
      if (i % 3 === 0) leaves += `<circle cx="${x + side * 6}" cy="${y + 8}" r="3.3" fill="${p.color}"/>`;
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 220">${definitions(p)}<path d="M82 181Q-16 119 46 30M118 181Q216 119 154 30" fill="none" stroke="#849461" stroke-width="1.5"/>${leaves}<use href="#bow" transform="translate(100 179) scale(1.12)"/></svg>`;
  }
  const image = svg => 'url("data:image/svg+xml,' + encodeURIComponent(svg) + '")';
  const style = document.createElement('style'); style.id = 'sk-navidad-style-v211';
  style.textContent = `
    body.sk-navidad-v211 { background-color:#fffaf2!important;background-image:var(--sk-edge-left),var(--sk-edge-right)!important;background-position:left var(--sk-edge-start,420px),right var(--sk-edge-start,420px)!important;background-repeat:repeat-y!important;background-size:clamp(30px,11vw,150px) auto!important; }
    .sk-navidad-v211 .logo-contenedor { overflow:visible!important; }
    .sk-logo-navidad { display:none;position:absolute;inset:-24% -24% -38%;pointer-events:none;z-index:3;background:var(--sk-wreath) center/100% 100% no-repeat; }
    .sk-navidad-v211 .sk-logo-navidad { display:block; }
    .sk-navidad-v211 #contenedor-productos .producto { border:1.4px solid var(--sk-color)!important;background:#fff!important;box-shadow:0 5px 18px #976e4c14; }
    .sk-navidad-v211 #contenedor-productos .producto .btn-agregar:not(:disabled) { background:var(--sk-color)!important;color:white!important; }
    .sk-navidad-v211 .selector-genero .btn-genero.activo { background:var(--sk-light)!important;color:#26313d!important; }
    .sk-navidad-v211 #btn-flotante-carrito { border-color:var(--sk-color)!important;color:var(--sk-dark)!important;background:white!important; }
    .sk-navidad-v211 .filtros-accordion>.btn-compartir,.sk-navidad-v211 .filtros-row-toggle .btn-compartir { border-color:var(--sk-color)!important;color:var(--sk-dark)!important; }
    #sk-navidad-heading-v211 { display:none;text-align:center;margin:22px auto 12px;padding:0 26px;color:var(--sk-color);font-family:Georgia,serif;font-size:clamp(22px,3vw,36px);font-style:italic;line-height:1.35; }
    .sk-navidad-v211 #sk-navidad-heading-v211 { display:block; }
    #sk-navidad-heading-v211::after { content:'✧  ♥  ✧';display:block;font:18px Georgia,serif;color:var(--sk-color);margin-top:7px; }
    @media(max-width:700px) { body.sk-navidad-v211{background-size:24px auto!important}.sk-navidad-v211 .sk-logo-navidad{inset:-20% -20% -33%}#sk-navidad-heading-v211{margin:14px auto 10px;font-size:22px} }
    @media print { .sk-logo-navidad,#sk-navidad-heading-v211{display:none!important}body.sk-navidad-v211{background-image:none!important} }
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
      root.style.setProperty('--sk-edge-left', image(edge(p, false)));root.style.setProperty('--sk-edge-right', image(edge(p, true)));root.style.setProperty('--sk-wreath', image(wreath(p)));
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

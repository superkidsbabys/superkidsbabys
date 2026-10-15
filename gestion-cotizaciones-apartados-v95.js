/* SuperKids Gestión V95 — filtros funcionales para cotizaciones y apartados. */
(() => {
  const API = 'https://superkids-pagos-api.superkids-babys.workers.dev';
  const money = n => new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(Number(n)||0);
  const esc = s => String(s ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fecha = v => { try { return v ? new Date(v).toLocaleString('es-CO',{dateStyle:'medium',timeStyle:'short'}) : 'Sin fecha'; } catch { return 'Sin fecha'; } };
  let cargando = false;

  async function token() {
    if (typeof window.obtenerTokenSesion !== 'function') throw new Error('Inicia sesión nuevamente para consultar las cotizaciones.');
    const value = await window.obtenerTokenSesion();
    if (!value) throw new Error('Tu sesión venció. Inicia sesión nuevamente.');
    return value;
  }
  async function consultar() {
    const t = await token();
    const r = await fetch(API + '/gestion/cotizaciones-apartados', { headers: { Authorization:'Bearer ' + t }, cache:'no-store' });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.error || 'No fue posible cargar las cotizaciones.');
    return datos;
  }
  function itemsHtml(items) {
    const lista = Array.isArray(items) ? items : [];
    if (!lista.length) return '<p class="sk95-muted">No hay prendas registradas.</p>';
    return '<ul class="sk95-items">' + lista.map(i => '<li><b>' + esc(i.nom || i.nombre || i.cod || 'Prenda') + '</b> · Talla ' + esc(i.talla || '—') + ' × ' + Number(i.cant || i.cantidad || 1) + '</li>').join('') + '</ul>';
  }
  function estilos() {
    return `<style id="sk95-style">
      #sk95-panel{grid-column:1/-1;background:#fff;border:1.5px solid #e9d5ff;border-radius:16px;padding:18px;margin:0 0 14px;color:#32204a;box-shadow:0 5px 18px #6b217114}
      #sk95-panel h2{margin:0;color:#6b21a8;font-size:1.2rem}.sk95-head{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.sk95-head p{margin:5px auto 0 0;color:#6b5a78;font-size:.9rem}
      .sk95-back{border:1px solid #a855f7;background:#fff;color:#6b21a8;border-radius:9px;padding:9px 12px;cursor:pointer;font-weight:800}.sk95-back:hover{background:#faf5ff}
      .sk95-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(265px,1fr));gap:12px;margin-top:14px}.sk95-card{border:1px solid #ead8f7;border-radius:12px;padding:13px;background:#fefcff}.sk95-card h3{margin:0 0 8px;color:#6b21a8;font-size:.98rem}.sk95-meta{font-size:.82rem;color:#716278;margin:4px 0}.sk95-total{font-size:1.05rem;font-weight:900;color:#16723a;margin-top:8px}.sk95-items{margin:9px 0 0;padding-left:19px;font-size:.84rem;line-height:1.55}.sk95-muted{color:#766b80;margin:17px 0 5px}.sk95-error{background:#fff1f2;border:1px solid #fecdd3;color:#9f1239;border-radius:10px;padding:12px;font-weight:700;margin-top:14px}.sk95-loading{color:#6b21a8;font-weight:800;margin:17px 0 5px}
    </style>`;
  }
  function panelHtml(tipo, datos) {
    const lista = Array.isArray(datos[tipo]) ? datos[tipo] : [];
    const titulo = tipo === 'cotizaciones' ? 'Cotizaciones' : 'Apartados';
    const descripcion = tipo === 'cotizaciones'
      ? 'Son consultas guardadas. No reservan prendas ni descuentan inventario.'
      : 'Son prendas con abono confirmado. Estas sí descuentan inventario.';
    const cards = lista.sort((a,b)=>Number(b.timestamp||0)-Number(a.timestamp||0)).map(x => {
      const cliente = tipo === 'apartados' ? '<p class="sk95-meta"><b>Cliente:</b> ' + esc(x.cliente || 'Sin nombre') + ' · ' + esc(x.telefono || '') + '</p>' : '<p class="sk95-meta">Código: <b>' + esc(x.id || '—') + '</b>' + (x.origen === 'carrito-publico' ? ' · Guardada desde la tienda' : '') + '</p>';
      const pago = tipo === 'apartados' ? '<p class="sk95-meta">Abono: <b>' + money(x.abono) + '</b> · Saldo: <b>' + money(x.saldo) + '</b></p>' : '<p class="sk95-meta">Estado: <b>' + esc(x.estado || 'cotización') + '</b></p>';
      return '<article class="sk95-card"><h3>' + (tipo === 'cotizaciones' ? '📋 Cotización' : '🧷 Apartado') + '</h3>' + cliente + pago + '<p class="sk95-meta">' + fecha(x.creadoEn || x.actualizadoEn) + '</p>' + itemsHtml(x.items) + '<p class="sk95-total">Total: ' + money(x.total) + '</p></article>';
    }).join('');
    return estilos() + '<section id="sk95-panel"><div class="sk95-head"><div><h2>' + titulo + '</h2><p>' + descripcion + '</p></div><button type="button" id="sk95-volver" class="sk95-back">← Volver a pedidos</button></div>' + (cards ? '<div class="sk95-grid">' + cards + '</div>' : '<p class="sk95-muted">No hay ' + titulo.toLowerCase() + ' todavía.</p>') + '</section>';
  }
  function activarBoton(tipo) {
    document.querySelectorAll('.btn-filtro-ped').forEach(b => b.classList.remove('activo'));
    const id = tipo === 'cotizaciones' ? 'fp-cotizaciones-v95' : 'fp-apartados-v95';
    const b = document.getElementById(id); if (b) b.classList.add('activo');
  }
  async function abrir(tipo) {
    const cont = document.getElementById('contenedor-historial-pedidos');
    if (!cont || cargando) return;
    cargando = true; activarBoton(tipo);
    cont.innerHTML = estilos() + '<div class="sk95-loading">Cargando ' + tipo + '…</div>';
    try { cont.innerHTML = panelHtml(tipo, await consultar()); }
    catch (e) { cont.innerHTML = estilos() + '<section id="sk95-panel"><div class="sk95-head"><h2>' + (tipo === 'cotizaciones' ? 'Cotizaciones' : 'Apartados') + '</h2><button type="button" id="sk95-volver" class="sk95-back">← Volver a pedidos</button></div><p class="sk95-error">' + esc(e.message || 'No fue posible cargar la información.') + '</p></section>'; }
    finally { cargando = false; const volver=document.getElementById('sk95-volver'); if(volver) volver.onclick=volverAPedidos; }
  }
  function volverAPedidos() { const b = document.getElementById('fp-nuevo') || document.getElementById('fp-todos'); if (b) b.click(); }
  function instalar() {
    const anulado = document.getElementById('fp-cancelado');
    if (!anulado || document.getElementById('fp-cotizaciones-v95')) return;
    const crear = (id, texto, tipo) => { const b=document.createElement('button'); b.id=id; b.type='button'; b.className='btn-filtro-ped'; b.textContent=texto; b.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); abrir(tipo); }); return b; };
    anulado.insertAdjacentElement('afterend', crear('fp-cotizaciones-v95','Cotizaciones','cotizaciones'));
    document.getElementById('fp-cotizaciones-v95').insertAdjacentElement('afterend', crear('fp-apartados-v95','Apartados','apartados'));
    document.addEventListener('click', e => { const b=e.target.closest('.btn-filtro-ped'); if (b && !['fp-cotizaciones-v95','fp-apartados-v95'].includes(b.id)) { const panel=document.getElementById('sk95-panel'); if(panel) panel.remove(); } }, true);
  }
  window.addEventListener('load', () => setTimeout(instalar, 700));
})();
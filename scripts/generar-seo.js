#!/usr/bin/env node
/**
 * generar-seo.js
 * ---------------------------------------------------------------
 * Genera una pagina HTML estatica por cada producto y categoria de
 * SuperKids&Babys, mas el sitemap.xml (con extension de imagenes) y
 * el robots.txt.
 *
 * Por que existe: superkidsbabys.com es una SPA (todo el catalogo se
 * pinta con JavaScript desde Firestore), asi que Google solo conocia
 * 1 pagina (el home). Este script crea una URL real y permanente por
 * cada prenda, con su <title>, meta description, Open Graph,
 * Twitter Card, Schema.org (Product/Offer) y su <img alt="..."> ya
 * escritos en el HTML - sin depender de JavaScript para que Google
 * (o ChatGPT/Gemini/Perplexity) puedan leerlos.
 *
 * Se ejecuta con: node scripts/generar-seo.js
 * (Node 18+ trae fetch nativo, no hace falta instalar nada.)
 * ---------------------------------------------------------------
 */
 
const fs = require('fs');
const path = require('path');
 
// ============================ CONFIG ============================
const FIREBASE_PROJECT_ID = 'superkidsbabys-222b0';
const SITE_URL = 'https://superkidsbabys.com';
const OUT_DIR = path.join(__dirname, '..');
const PRODUCTO_DIR = path.join(OUT_DIR, 'producto');
const CATEGORIA_DIR = path.join(OUT_DIR, 'categoria');
const SITEMAP_PATH = path.join(OUT_DIR, 'sitemap.xml');
const ROBOTS_PATH = path.join(OUT_DIR, 'robots.txt');
const MARCA = "SuperKids & Babys";
// ==================================================================
 
function limpiarTexto(valor) {
  return String(valor || '').replace(/\s+/g, ' ').trim();
}
 
function crearSlug(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quitar tildes
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'producto';
}
 
function escaparHTML(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
 
function formatearPrecio(valor) {
  const num = Number(valor) || 0;
  return num.toLocaleString('es-CO');
}
 
// ---------------------- Descripcion natural ----------------------
// Antes esta funcion pegaba siempre el mismo texto robotico:
// "Nombre - Categoria. Ropa importada... Precio: $X COP."
// Ahora arma la frase usando la descripcion real del producto (si la
// tiene cargada en el inventario) y varia la estructura de la frase
// entre varias plantillas, para que no se repita igualita en las 427
// paginas. Cada producto siempre cae en la misma plantilla (se elige
// segun su id), asi el texto no cambia cada vez que se regenera.
function generarDescripcion(producto, nombre, categoria, precio) {
  const detalle = limpiarTexto(producto.desc).replace(/\.+$/, '');
  const generoTexto = limpiarTexto(producto.genero || '').toLowerCase();
  const publico = generoTexto.includes('niñ') ? generoTexto : 'bebés y niños';
  const categoriaTexto = categoria ? categoria.toLowerCase() : 'ropa infantil importada';
 
  const plantillas = [
    () => `${nombre}.${detalle ? ' ' + detalle + '.' : ''} Disponible para ${publico}, con envío a toda Colombia y pago contra entrega.`,
    () => `Descubre ${nombre.toLowerCase()}, parte de nuestra colección de ${categoriaTexto}.${detalle ? ' ' + detalle + '.' : ''} Precio: $${precio} COP, envíos a todo el país.`,
    () => `${detalle ? detalle + '. ' : ''}${nombre}, ideal para ${publico}. Hace parte de nuestra línea de ${categoriaTexto}, disponible por $${precio} COP.`,
    () => `${nombre} — ${categoriaTexto} para ${publico}.${detalle ? ' ' + detalle + '.' : ''} Compra segura y pago contra entrega en toda Colombia.`
  ];
 
  const idTexto = String(producto.id || nombre || '');
  let suma = 0;
  for (let i = 0; i < idTexto.length; i++) suma += idTexto.charCodeAt(i);
  const plantilla = plantillas[suma % plantillas.length];
 
  return limpiarTexto(plantilla());
}
 
// ---------------------- Lectura de Firestore ----------------------
// Las colecciones 'productos' y 'categorias' ya se leen sin login
// desde index.html (el catalogo publico), asi que este script lee
// exactamente igual, via la API REST publica de Firestore, sin
// necesitar ninguna clave ni secreto.
 
function valorFirestore(valor) {
  if (!valor || typeof valor !== 'object') return null;
  if ('nullValue' in valor) return null;
  if ('stringValue' in valor) return valor.stringValue;
  if ('integerValue' in valor) return Number(valor.integerValue);
  if ('doubleValue' in valor) return Number(valor.doubleValue);
  if ('booleanValue' in valor) return Boolean(valor.booleanValue);
  if (valor.arrayValue) return (valor.arrayValue.values || []).map(valorFirestore);
  if (valor.mapValue) {
    const salida = {};
    const campos = valor.mapValue.fields || {};
    Object.keys(campos).forEach(clave => { salida[clave] = valorFirestore(campos[clave]); });
    return salida;
  }
  return null;
}
 
function convertirDocumento(doc) {
  const datos = { id: doc.name.split('/').pop() };
  const campos = doc.fields || {};
  Object.keys(campos).forEach(clave => { datos[clave] = valorFirestore(campos[clave]); });
  return datos;
}
 
async function leerColeccion(nombre) {
  const base = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${nombre}`;
  let documentos = [];
  let pageToken = '';
  do {
    const url = base + '?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
    const respuesta = await fetch(url);
    if (!respuesta.ok) {
      throw new Error(`No se pudo leer la coleccion "${nombre}" (status ${respuesta.status}). Revisa que sea de lectura publica en las reglas de Firestore.`);
    }
    const datos = await respuesta.json();
    documentos = documentos.concat((datos.documents || []).map(convertirDocumento));
    pageToken = datos.nextPageToken || '';
  } while (pageToken);
  return documentos;
}
 
// ------------------------- Datos de producto -------------------------
 
function obtenerImagenProducto(producto) {
  if (Array.isArray(producto.imagenes) && producto.imagenes.length) return producto.imagenes[0];
  if (producto.img) return producto.img;
  return '';
}
 
function obtenerTodasLasImagenes(producto) {
  if (Array.isArray(producto.imagenes) && producto.imagenes.length) return producto.imagenes;
  if (producto.img) return [producto.img];
  return [];
}
 
function calcularStockTotal(producto) {
  if (Array.isArray(producto.tallasObj)) {
    return producto.tallasObj.reduce((suma, t) => suma + (Math.max(0, Number(t.stock) || 0)), 0);
  }
  return Math.max(0, Number(producto.stockTotal) || 0);
}
 
// ----------------------------- Plantillas -----------------------------
 
function paginaProducto(producto, slug) {
  const nombre = limpiarTexto(producto.nombre) || 'Prenda para bebé';
  const categoria = limpiarTexto(producto.categoria);
  const precio = formatearPrecio(producto.precio);
  const precioNumerico = Number(producto.precio) || 0;
  const imagenes = obtenerTodasLasImagenes(producto);
  const imagenPrincipal = imagenes[0] || '';
  const codigo = limpiarTexto(producto.codigo);
  const stock = calcularStockTotal(producto);
  const disponible = stock > 0;
  const url = `${SITE_URL}/producto/${slug}/`;
  const titulo = `${nombre} | ${MARCA}`;
  const descripcion = generarDescripcion(producto, nombre, categoria, precio);
  const tallasDisponibles = Array.isArray(producto.tallasObj)
    ? producto.tallasObj.filter(t => (Number(t.stock) || 0) > 0).map(t => escaparHTML(t.nombre))
    : [];
 
  const galeriaHTML = imagenes.map((img, i) => (
    `<img src="${escaparHTML(img)}" alt="${escaparHTML(nombre)}${categoria ? ' - ' + escaparHTML(categoria) : ''}${i > 0 ? ' (foto ' + (i + 1) + ')' : ''}" loading="${i === 0 ? 'eager' : 'lazy'}" style="width:100%;max-width:420px;border-radius:16px;border:1.5px solid #f0d6fb;display:block;margin:0 auto 12px;">`
  )).join('\n');
 
  const schema = {
    "@context": "https://schema.org/",
    "@type": "Product",
    "name": nombre,
    "image": imagenes,
    "description": descripcion,
    "sku": codigo || undefined,
    "brand": { "@type": "Brand", "name": MARCA },
    "offers": {
      "@type": "Offer",
      "url": url,
      "priceCurrency": "COP",
      "price": precioNumerico,
      "availability": disponible ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
      "itemCondition": "https://schema.org/NewCondition"
    }
  };
 
  const breadcrumb = {
    "@context": "https://schema.org/",
    "@type": "BreadcrumbList",
    "itemListElement": [
      { "@type": "ListItem", "position": 1, "name": "Inicio", "item": SITE_URL + "/" },
      categoria ? { "@type": "ListItem", "position": 2, "name": categoria, "item": `${SITE_URL}/categoria/${crearSlug(categoria)}/` } : null,
      { "@type": "ListItem", "position": categoria ? 3 : 2, "name": nombre, "item": url }
    ].filter(Boolean)
  };
 
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escaparHTML(titulo)}</title>
<meta name="description" content="${escaparHTML(descripcion)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta property="og:type" content="product">
<meta property="og:title" content="${escaparHTML(titulo)}">
<meta property="og:description" content="${escaparHTML(descripcion)}">
<meta property="og:image" content="${escaparHTML(imagenPrincipal)}">
<meta property="og:url" content="${url}">
<meta property="og:locale" content="es_CO">
<meta property="product:price:amount" content="${precioNumerico}">
<meta property="product:price:currency" content="COP">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escaparHTML(titulo)}">
<meta name="twitter:description" content="${escaparHTML(descripcion)}">
<meta name="twitter:image" content="${escaparHTML(imagenPrincipal)}">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>
<style>
  body{font-family:Nunito,sans-serif;background:#fff9fc;color:#4a3540;margin:0;padding:0;}
  .envolt{max-width:720px;margin:0 auto;padding:24px 20px 60px;}
  a.volver{color:#c0557a;text-decoration:none;font-weight:700;font-size:0.9em;}
  h1{font-family:Quicksand,sans-serif;color:#a3336b;font-size:1.5em;margin:18px 0 6px;}
  .cat{display:inline-block;background:#f5e6f8;color:#8e44ad;font-size:0.78em;font-weight:700;padding:4px 12px;border-radius:20px;margin-bottom:10px;}
  .precio{font-size:1.4em;font-weight:800;color:#8e44ad;margin:10px 0;}
  .tallas{margin:14px 0;}
  .talla-chip{display:inline-block;background:#fdf3ff;border:1.5px solid #e8b8f5;color:#7e22ce;font-weight:700;font-size:0.85em;padding:5px 12px;border-radius:10px;margin:0 6px 6px 0;}
  .btn-comprar{display:inline-block;margin-top:18px;background:linear-gradient(135deg,#c0557a,#e8a0b4);color:white;font-weight:800;padding:13px 28px;border-radius:14px;text-decoration:none;font-size:1em;}
  .agotado{color:#b04040;font-weight:700;}
  footer{margin-top:40px;font-size:0.8em;color:#b0778a;text-align:center;}
</style>
</head>
<body>
<div class="envolt">
  <a class="volver" href="${SITE_URL}/">← Volver al catálogo</a>
  ${galeriaHTML}
  ${categoria ? `<div class="cat">${escaparHTML(categoria)}</div>` : ''}
  <h1>${escaparHTML(nombre)}</h1>
  <div class="precio">$${precio} COP</div>
  ${tallasDisponibles.length ? `<div class="tallas">${tallasDisponibles.map(t => `<span class="talla-chip">${t}</span>`).join('')}</div>` : ''}
  <p>${escaparHTML(descripcion)}</p>
  ${disponible
    ? `<a class="btn-comprar" href="${SITE_URL}/?producto=${producto.id}">Comprar ahora</a>`
    : `<p class="agotado">Agotado por ahora — vuelve pronto.</p>`}
  <footer>${MARCA} · Envíos a toda Colombia · <a class="volver" href="${SITE_URL}/">Ver todo el catálogo</a></footer>
</div>
</body>
</html>`;
}
 
function paginaCategoria(nombreCategoria, productos, slug) {
  const url = `${SITE_URL}/categoria/${slug}/`;
  const titulo = `${nombreCategoria} | ${MARCA}`;
  const descripcion = `Explora ${nombreCategoria.toLowerCase()} para bebés y niños en ${MARCA}. Envíos a toda Colombia con pago contra entrega.`;
 
  const tarjetas = productos.map(p => {
    const nombre = limpiarTexto(p.nombre) || 'Prenda';
    const img = obtenerImagenProducto(p);
    const precio = formatearPrecio(p.precio);
    return `<a href="${SITE_URL}/producto/${p.__slug}/" style="text-decoration:none;color:inherit;display:block;background:#fff;border:1.5px solid #f5e6f8;border-radius:14px;overflow:hidden;">
      <img src="${escaparHTML(img)}" alt="${escaparHTML(nombre)}" loading="lazy" style="width:100%;aspect-ratio:1;object-fit:cover;display:block;">
      <div style="padding:10px 12px;">
        <div style="font-size:0.88em;font-weight:700;color:#4a3540;">${escaparHTML(nombre)}</div>
        <div style="font-size:0.9em;font-weight:800;color:#8e44ad;margin-top:4px;">$${precio}</div>
      </div>
    </a>`;
  }).join('\n');
 
  const schema = {
    "@context": "https://schema.org/",
    "@type": "CollectionPage",
    "name": titulo,
    "url": url
  };
 
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escaparHTML(titulo)}</title>
<meta name="description" content="${escaparHTML(descripcion)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta property="og:type" content="website">
<meta property="og:title" content="${escaparHTML(titulo)}">
<meta property="og:description" content="${escaparHTML(descripcion)}">
<meta property="og:url" content="${url}">
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<style>
  body{font-family:Nunito,sans-serif;background:#fff9fc;color:#4a3540;margin:0;padding:0;}
  .envolt{max-width:960px;margin:0 auto;padding:24px 20px 60px;}
  a.volver{color:#c0557a;text-decoration:none;font-weight:700;font-size:0.9em;}
  h1{font-family:Quicksand,sans-serif;color:#a3336b;font-size:1.6em;margin:16px 0;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:14px;margin-top:18px;}
  footer{margin-top:40px;font-size:0.8em;color:#b0778a;text-align:center;}
</style>
</head>
<body>
<div class="envolt">
  <a class="volver" href="${SITE_URL}/">← Volver al catálogo</a>
  <h1>${escaparHTML(nombreCategoria)}</h1>
  <p>${escaparHTML(descripcion)}</p>
  <div class="grid">${tarjetas}</div>
  <footer>${MARCA} · Envíos a toda Colombia · <a class="volver" href="${SITE_URL}/">Ver todo el catálogo</a></footer>
</div>
</body>
</html>`;
}
 
// ------------------------------- Sitemap -------------------------------
 
function construirSitemap(entradas) {
  const urls = entradas.map(e => {
    const imagenes = (e.imagenes || []).map(img =>
      `    <image:image><image:loc>${escaparHTML(img)}</image:loc></image:image>`
    ).join('\n');
    return `  <url>
    <loc>${escaparHTML(e.loc)}</loc>
    <changefreq>${e.changefreq || 'weekly'}</changefreq>
    <priority>${e.priority || '0.7'}</priority>${imagenes ? '\n' + imagenes : ''}
  </url>`;
  }).join('\n');
 
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls}
</urlset>
`;
}
 
function asegurarRobots() {
  const lineaSitemap = `Sitemap: ${SITE_URL}/sitemap.xml`;
  let contenido = '';
  if (fs.existsSync(ROBOTS_PATH)) {
    contenido = fs.readFileSync(ROBOTS_PATH, 'utf8');
  } else {
    contenido = 'User-agent: *\nAllow: /\n';
  }
  if (!contenido.includes('Sitemap:')) {
    contenido = contenido.trim() + '\n\n' + lineaSitemap + '\n';
  } else {
    contenido = contenido.replace(/Sitemap:.*/g, lineaSitemap);
  }
  fs.writeFileSync(ROBOTS_PATH, contenido);
  console.log('✅ robots.txt actualizado con el sitemap.');
}
 
// --------------------------------- Main ---------------------------------
 
async function main() {
  console.log('📦 Leyendo productos desde Firestore...');
  const productos = await leerColeccion('productos');
  console.log(`   ${productos.length} productos encontrados.`);
 
  // Slugs unicos: nombre -> slug, si hay choque se agrega el codigo o el id
  const slugsUsados = new Set();
  productos.forEach(p => {
    let base = crearSlug(p.nombre || p.codigo || p.id);
    let slug = base;
    let sufijo = 1;
    while (slugsUsados.has(slug)) {
      sufijo += 1;
      slug = `${base}-${sufijo}`;
    }
    slugsUsados.add(slug);
    p.__slug = slug;
  });
 
  fs.mkdirSync(PRODUCTO_DIR, { recursive: true });
  fs.mkdirSync(CATEGORIA_DIR, { recursive: true });
 
  const sitemapEntradas = [
    { loc: `${SITE_URL}/`, changefreq: 'daily', priority: '1.0' }
  ];
 
  // ---- Paginas de producto ----
  let generados = 0;
  for (const producto of productos) {
    if (!limpiarTexto(producto.nombre)) {
      console.warn(`   ⚠️  Producto ${producto.id} sin nombre — se omite (publícalo con nombre desde el panel primero).`);
      continue;
    }
    const dirProducto = path.join(PRODUCTO_DIR, producto.__slug);
    fs.mkdirSync(dirProducto, { recursive: true });
    fs.writeFileSync(path.join(dirProducto, 'index.html'), paginaProducto(producto, producto.__slug));
    sitemapEntradas.push({
      loc: `${SITE_URL}/producto/${producto.__slug}/`,
      changefreq: 'weekly',
      priority: '0.8',
      imagenes: obtenerTodasLasImagenes(producto)
    });
    generados += 1;
  }
  console.log(`✅ ${generados} páginas de producto generadas en /producto/`);
 
  // ---- Paginas de categoria ----
  const porCategoria = new Map();
  productos.forEach(p => {
    const cat = limpiarTexto(p.categoria);
    if (!cat || !limpiarTexto(p.nombre)) return;
    if (!porCategoria.has(cat)) porCategoria.set(cat, []);
    porCategoria.get(cat).push(p);
  });
 
  let categoriasGeneradas = 0;
  for (const [nombreCategoria, listaProductos] of porCategoria.entries()) {
    const slugCat = crearSlug(nombreCategoria);
    const dirCategoria = path.join(CATEGORIA_DIR, slugCat);
    fs.mkdirSync(dirCategoria, { recursive: true });
    fs.writeFileSync(path.join(dirCategoria, 'index.html'), paginaCategoria(nombreCategoria, listaProductos, slugCat));
    sitemapEntradas.push({ loc: `${SITE_URL}/categoria/${slugCat}/`, changefreq: 'weekly', priority: '0.6' });
    categoriasGeneradas += 1;
  }
  console.log(`✅ ${categoriasGeneradas} páginas de categoría generadas en /categoria/`);
 
  // ---- Sitemap + robots ----
  fs.writeFileSync(SITEMAP_PATH, construirSitemap(sitemapEntradas));
  console.log(`✅ sitemap.xml generado con ${sitemapEntradas.length} URLs.`);
  asegurarRobots();
 
  console.log('\n🎉 Listo. Sube (o deja que GitHub Actions suba) los cambios a GitHub Pages.');
}
 
main().catch(err => {
  console.error('❌ Error generando el SEO:', err.message);
  process.exit(1);
});
 

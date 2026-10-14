// Consulta mínima para WhatsApp. No genera enlaces privados ni escribe pedidos.
function telefonoSeguimientoWA(valor) {
  const texto = String(valor || '').trim();
  if (!/^[+0-9().\s-]{10,25}$/.test(texto)) return '';
  const digitos = texto.replace(/\D/g, '');
  if (/^3\d{9}$/.test(digitos)) return '57' + digitos;
  return /^573\d{9}$/.test(digitos) ? digitos : '';
}

async function firmaSeguimientoWA(secreto, texto) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto),
    {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const bytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2,'0')).join('');
}

function respuestaSeguimientoWA(datos, status = 200) {
  return new Response(JSON.stringify(datos), {status, headers:{
    'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store',
    'Referrer-Policy':'no-referrer'
  }});
}

async function consultarPedidosWA(request, env) {
  // Sin CORS: no es una ruta para el navegador. El bot firma el teléfono del webhook.
  if (request.method !== 'POST') return respuestaSeguimientoWA({ok:false},405);
  if (request.headers.has('Origin')) return respuestaSeguimientoWA({ok:false},403);
  const secret = String(env.WHATSAPP_PEDIDOS_SECRET || '');
  if (secret.length < 32) return respuestaSeguimientoWA({ok:false},503);
  const timestamp = request.headers.get('X-WA-Time') || '';
  const signature = request.headers.get('X-WA-Signature') || '';
  if (!/^\d{13}$/.test(timestamp) || Math.abs(Date.now()-Number(timestamp)) > 120000 ||
      !/^[a-f0-9]{64}$/.test(signature)) return respuestaSeguimientoWA({ok:false},401);
  const raw = await request.text();
  if (raw.length > 512) return respuestaSeguimientoWA({ok:false},400);
  const expected = await firmaSeguimientoWA(secret, 'wa-pedidos-v1\n'+timestamp+'\n'+raw);
  if (!comparacionSegura(signature, expected)) return respuestaSeguimientoWA({ok:false},401);
  let body;
  try { body = JSON.parse(raw); } catch { return respuestaSeguimientoWA({ok:false},400); }
  const telefono = telefonoSeguimientoWA(body?.telefono);
  const numero = body?.numero == null ? null : body.numero;
  if (!telefono || (numero !== null && (!Number.isSafeInteger(numero) || numero < 1 || numero > 999999999)))
    return respuestaSeguimientoWA({ok:false},400);
  try {
    let pedidos = [];
    if (numero !== null) {
      const documento = await leerDocumentoFirebaseAdmin(env,'pedidos','pedido-'+numero);
      if (documento) pedidos = [documento.data];
    } else {
      // Consulta acotada al teléfono; nunca descarga la colección completa.
      const local = telefono.slice(2);
      const variants = [telefono, '+'+telefono, local];
      const token = await obtenerTokenFirebaseAdmin(env);
      const response = await fetch('https://firestore.googleapis.com/v1/projects/'+FIREBASE_PROJECT_ID+
        '/databases/(default)/documents:runQuery', {
        method:'POST', headers:{Authorization:'Bearer '+token, 'Content-Type':'application/json'},
        body:JSON.stringify({structuredQuery:{from:[{collectionId:'pedidos'}],
          select:{fields:['num','numOrden','tel','estado','transportadora','guia'].map(fieldPath=>({fieldPath}))},
          where:{compositeFilter:{op:'OR',filters:variants.flatMap(v=>[
            {fieldFilter:{field:{fieldPath:'tel'},op:'EQUAL',value:{stringValue:v}}},
            ...(v[0]!=='+'?[{fieldFilter:{field:{fieldPath:'tel'},op:'EQUAL',value:{integerValue:v}}}]:[])
          ])}},limit:21}}), signal:AbortSignal.timeout(10000)
      });
      if (!response.ok) return respuestaSeguimientoWA({ok:false},503);
      const rows = await response.json();
      if (!Array.isArray(rows)) return respuestaSeguimientoWA({ok:false},503);
      pedidos = rows.filter(row=>row.document).map(row=>convertirDocumentoFirestore(row.document));
      if (pedidos.length > 20) return respuestaSeguimientoWA({ok:true,requiereNumero:true,pedidos:[]});
    }
    // Número inexistente y número ajeno tienen exactamente la misma respuesta.
    const propios = pedidos.filter(p=>telefonoSeguimientoWA(p.tel) === telefono)
      .filter(p=>Number.isSafeInteger(Number(p.num)) && Number(p.num)>0)
      .map(p=>({numero:Number(p.num), estado:textoPedido(p.estado,30).toLowerCase(),
        transportadora:textoPedido(p.transportadora,60),
        guia:['enviado','entregado'].includes(textoPedido(p.estado,30).toLowerCase()) ? textoPedido(p.guia,100) : ''}));
    propios.sort((a,b)=>b.numero-a.numero);
    return respuestaSeguimientoWA({ok:true,pedidos:propios});
  } catch {
    // No registrar teléfono, documento, guía ni errores de Firebase con datos personales.
    return respuestaSeguimientoWA({ok:false},503);
  }
}

const ORIGENES_PERMITIDOS = new Set([
  'https://superkidsbabys.com',
  'https://www.superkidsbabys.com'
]);
const WOMPI_PUBLIC_KEY_TEST = 'pub_test_IOwvTNIDN3nF3dw6exTVb89AhkVfdspO';
const FIREBASE_PROJECT_ID = 'superkidsbabys-222b0';
const MONEDA = 'COP';
// Admite pedidos mayoristas amplios sin dejar la ruta abierta a cargas ilimitadas.
const MAX_ITEMS_PAGO = 300;
// Plazo de acceso al seguimiento, independiente de la conservación del pedido.
const SEGUIMIENTO_VIGENCIA_MS = 30 * 24 * 60 * 60 * 1000;
const VERSION_POLITICA_DATOS = '2026-10-07-v1';
const TEXTO_AUTORIZACION_DATOS = 'Autorizo el uso de mis datos por Superkids&Babys para gestionar mi pedido, pago, entrega y atención posventa, según la Política de privacidad. Esta autorización no incluye publicidad.';
function registrarAutorizacionDatos(datos, origin) {
  if (!datos || datos.aceptada !== true || datos.version !== VERSION_POLITICA_DATOS) return null;
  return {
    aceptada: true,
    version: VERSION_POLITICA_DATOS,
    texto: TEXTO_AUTORIZACION_DATOS,
    politicaUrl: 'https://superkidsbabys.com/politica-privacidad.html',
    registradaEn: new Date().toISOString(),
    canal: 'checkout-web',
    origen: origin,
    incluyePublicidad: false
  };
}
let cacheTokenFirebase = null;
const ASESORAS_PERMITIDAS = new Set(['Yohana', 'Bibiana', 'Ángela', 'Sin asesora']);

function validarAsesora(valor) {
  const asesora = textoPedido(valor, 30);
  return ASESORAS_PERMITIDAS.has(asesora) ? asesora : 'Sin asesora';
}

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ORIGENES_PERMITIDOS.has(origin) ? origin : 'https://superkidsbabys.com',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin'
  };
}

function responder(origin, datos, estado = 200) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: {
      ...cors(origin),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    }
  });
}

async function sha256(texto) {
  const bytes = new TextEncoder().encode(texto);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function validarTurnstile(env, token, origin) {
  const respuesta = String(token || '').trim();
  if (
    !env.TURNSTILE_SECRET_KEY ||
    !ORIGENES_PERMITIDOS.has(origin) ||
    !respuesta ||
    respuesta.length > 2048
  ) {
    return false;
  }

  let hostname;
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }

  const verificacion = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: respuesta
      }).toString()
    }
  );
  const datos = await verificacion.json().catch(() => ({}));
  return Boolean(
    verificacion.ok &&
    datos.success === true
  );
}

function base64Url(datos) {
  const bytes = typeof datos === 'string'
    ? new TextEncoder().encode(datos)
    : new Uint8Array(datos);
  let binario = '';
  for (const byte of bytes) binario += String.fromCharCode(byte);
  return btoa(binario)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function leerCuentaServicioFirebase(env) {
  if (!env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    throw new Error('Falta FIREBASE_SERVICE_ACCOUNT_JSON');
  }
  let cuenta;
  try {
    cuenta = JSON.parse(env.FIREBASE_SERVICE_ACCOUNT_JSON);
  } catch {
    throw new Error('El secreto de Firebase no contiene un JSON valido');
  }
  if (
    cuenta.project_id !== FIREBASE_PROJECT_ID ||
    !String(cuenta.client_email || '').endsWith('.iam.gserviceaccount.com') ||
    !String(cuenta.private_key || '').includes('BEGIN PRIVATE KEY')
  ) {
    throw new Error('La cuenta de servicio de Firebase no corresponde al proyecto');
  }
  return cuenta;
}

async function importarClavePrivadaFirebase(privateKey) {
  const contenido = String(privateKey)
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binario = atob(contenido);
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i += 1) bytes[i] = binario.charCodeAt(i);
  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

async function obtenerTokenFirebaseAdmin(env) {
  const ahora = Math.floor(Date.now() / 1000);
  if (
    cacheTokenFirebase &&
    cacheTokenFirebase.token &&
    cacheTokenFirebase.expiraEn > ahora + 60
  ) {
    return cacheTokenFirebase.token;
  }

  const cuenta = leerCuentaServicioFirebase(env);
  const encabezado = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const contenido = base64Url(JSON.stringify({
    iss: cuenta.client_email,
    sub: cuenta.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    iat: ahora,
    exp: ahora + 3600,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.messaging'
  }));
  const sinFirmar = encabezado + '.' + contenido;
  const clave = await importarClavePrivadaFirebase(cuenta.private_key);
  const firma = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    clave,
    new TextEncoder().encode(sinFirmar)
  );
  const assertion = sinFirmar + '.' + base64Url(firma);

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    }).toString()
  });
  const datos = await response.json().catch(() => ({}));
  if (!response.ok || !datos.access_token) {
    console.error('Firebase OAuth', response.status, datos.error || 'sin detalle');
    throw new Error('Firebase rechazo la cuenta de servicio');
  }
  cacheTokenFirebase = {
    token: datos.access_token,
    expiraEn: ahora + Math.max(300, Number(datos.expires_in) || 3600)
  };
  return cacheTokenFirebase.token;
}

async function diagnosticarFirebaseAdmin(env) {
  const token = await obtenerTokenFirebaseAdmin(env);
  const endpoint =
    'https://firestore.googleapis.com/v1/projects/' +
    FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/productos?pageSize=1&mask.fieldPaths=id';
  const response = await fetch(endpoint, {
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token
    }
  });
  if (!response.ok) {
    console.error('Diagnostico Firestore', response.status);
    throw new Error('La cuenta no pudo consultar Firestore');
  }
  return true;
}

function leerValorFirestore(valor) {
  if (!valor || typeof valor !== 'object') return null;
  if ('nullValue' in valor) return null;
  if ('stringValue' in valor) return valor.stringValue;
  if ('integerValue' in valor) return Number(valor.integerValue);
  if ('doubleValue' in valor) return Number(valor.doubleValue);
  if ('booleanValue' in valor) return Boolean(valor.booleanValue);
  if ('timestampValue' in valor) return valor.timestampValue;
  if (valor.arrayValue) {
    return (valor.arrayValue.values || []).map(leerValorFirestore);
  }
  if (valor.mapValue) {
    const salida = {};
    const campos = valor.mapValue.fields || {};
    Object.keys(campos).forEach(clave => {
      salida[clave] = leerValorFirestore(campos[clave]);
    });
    return salida;
  }
  return null;
}

function convertirDocumentoFirestore(documento) {
  const producto = {};
  const campos = (documento && documento.fields) || {};
  Object.keys(campos).forEach(clave => {
    producto[clave] = leerValorFirestore(campos[clave]);
  });
  return producto;
}

function valorFirestore(valor) {
  if (valor === null || valor === undefined) return { nullValue: null };
  if (typeof valor === 'boolean') return { booleanValue: valor };
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) return { nullValue: null };
    return Number.isInteger(valor)
      ? { integerValue: String(valor) }
      : { doubleValue: valor };
  }
  if (typeof valor === 'string') return { stringValue: valor };
  if (Array.isArray(valor)) {
    return { arrayValue: { values: valor.map(valorFirestore) } };
  }
  if (typeof valor === 'object') {
    return { mapValue: { fields: camposFirestore(valor) } };
  }
  return { stringValue: String(valor) };
}

function camposFirestore(objeto) {
  const campos = {};
  Object.keys(objeto || {}).forEach(clave => {
    if (objeto[clave] !== undefined) campos[clave] = valorFirestore(objeto[clave]);
  });
  return campos;
}

function nombreDocumentoFirestore(coleccion, id) {
  return 'projects/' + FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/' + coleccion + '/' + id;
}

async function leerDocumentoFirebaseAdmin(env, coleccion, id) {
  const token = await obtenerTokenFirebaseAdmin(env);
  const nombre = nombreDocumentoFirestore(coleccion, encodeURIComponent(id));
  const response = await fetch('https://firestore.googleapis.com/v1/' + nombre, {
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token
    }
  });
  if (response.status === 404) return null;
  const documento = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error('Lectura Firestore Admin', coleccion, id, response.status);
    throw new Error('No fue posible leer Firebase de forma segura');
  }
  return {
    name: documento.name,
    updateTime: documento.updateTime,
    data: convertirDocumentoFirestore(documento)
  };
}

async function commitFirebaseAdmin(env, writes) {
  const token = await obtenerTokenFirebaseAdmin(env);
  const endpoint =
    'https://firestore.googleapis.com/v1/projects/' +
    FIREBASE_PROJECT_ID +
    '/databases/(default)/documents:commit';
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ writes })
  });
  const datos = await response.json().catch(() => ({}));
  if (!response.ok) {
    const codigo = String(datos && datos.error && datos.error.status || '');
    const reintentable = response.status === 409 ||
      response.status === 412 ||
      codigo === 'ABORTED' ||
      codigo === 'FAILED_PRECONDITION';
    const error = new Error('Firebase rechazo la operacion atomica');
    Object.defineProperty(error, 'reintentable', { value: reintentable });
    console.error(
      'Commit Firestore Admin',
      response.status,
      codigo,
      String(datos && datos.error && datos.error.message || '').slice(0, 300)
    );
    throw error;
  }
  return datos;
}

async function cargarProductoFirebase(id) {
  const endpoint =
    'https://firestore.googleapis.com/v1/projects/' +
    FIREBASE_PROJECT_ID +
    '/databases/(default)/documents/productos/' +
    encodeURIComponent(id);
  const response = await fetch(endpoint, {
    headers: { Accept: 'application/json' }
  });
  if (response.status === 404) return null;
  if (!response.ok) {
    console.error('Firebase producto', id, response.status);
    throw new Error('No fue posible consultar el inventario');
  }
  return convertirDocumentoFirestore(await response.json());
}

function normalizarTalla(talla) {
  return String(talla || '').trim().toUpperCase();
}

function textoPedido(valor, maximo) {
  return String(valor || '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximo);
}

function validarClientePago(datos) {
  const cliente = datos && typeof datos === 'object' ? datos : {};
  const limpio = {
    nombre: textoPedido(cliente.nombre, 100),
    documento: textoPedido(cliente.documento, 30),
    direccion: textoPedido(cliente.direccion, 160),
    barrio: textoPedido(cliente.barrio, 80),
    departamento: textoPedido(cliente.departamento, 80),
    ciudad: textoPedido(cliente.ciudad, 80),
    telefono: textoPedido(cliente.telefono, 30),
    correo: textoPedido(cliente.correo, 120).toLowerCase(),
    observaciones: textoPedido(cliente.observaciones, 500)
  };
  if (
    limpio.nombre.length < 2 ||
    limpio.direccion.length < 4 ||
    limpio.departamento.length < 2 ||
    limpio.ciudad.length < 2 ||
    !/^[0-9+().\s-]{7,30}$/.test(limpio.telefono)
  ) {
    throw new Error('Los datos de envio estan incompletos');
  }
  if (
    limpio.correo &&
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(limpio.correo)
  ) {
    throw new Error('El correo electronico no es valido');
  }
  return limpio;
}

function stockDisponible(producto, talla) {
  const tallas = Array.isArray(producto.tallasObj) ? producto.tallasObj : [];
  if (tallas.length) {
    const buscada = normalizarTalla(talla);
    const encontrada = tallas.find(item => normalizarTalla(item.nombre) === buscada);
    return encontrada ? Math.max(0, Number(encontrada.stock) || 0) : 0;
  }
  return Math.max(0, Number(producto.stockTotal) || 0);
}

function calcularPromocionMamelucos(items) {
  let bruto = 0;
  let cantidadPromo = 0;
  items.forEach(item => {
    bruto += item.precio * item.cantidad;
    const categoria = String(item.categoria || '').toLowerCase();
    const nombre = String(item.nombre || '').toLowerCase();
    if (
      item.precio === 25000 &&
      (categoria.includes('mameluco') || nombre.includes('mameluco'))
    ) {
      cantidadPromo += item.cantidad;
    }
  });
  const grupos = Math.floor(cantidadPromo / 4);
  const resto = cantidadPromo % 4;
  const preciosResto = [0, 25000, 45000, 65000];
  const valorPromo = (grupos * 85000) + preciosResto[resto];
  const descuento = Math.max(0, (cantidadPromo * 25000) - valorPromo);
  return {
    bruto,
    cantidadPromo,
    descuento,
    total: bruto - descuento
  };
}

const CIUDADES_23MYM_URBANO = new Set(
  'BOGOTA|COTA|FUNZA|MOSQUERA|SOACHA|CHIA|MADRID'.split('|')
);
const CIUDADES_23MYM_REGIONAL = new Set(
  'CAJICA|SOPO|TABIO|TENJO|TOCANCIPA|FACATATIVA|ZIPAQUIRA|EL ROSAL|GRANADA|UBATE'.split('|')
);
const CIUDADES_23MYM_NACIONAL = new Set(
  ('CALI|DOSQUEBRADAS|MEDELLIN|PEREIRA|YUMBO|ARMENIA|ENVIGADO|ITAGUI|MANIZALES|SABANETA|' +
   'BARRANQUILLA|BELLO|CALARCA|CARTAGENA|SANTA MARTA|SANTA ROSA DE CABAL|VILLAMARIA|' +
   'CARTAGO|CHINCHINA|GIRARDOTA|LA CALERA|PALMIRA|TUNJA').split('|')
);
const CIUDADES_23MYM_NACIONAL_2 = new Set(
  ('MALAMBO|LA ESTRELLA|RIONEGRO|SOLEDAD|PIEDECUESTA|TURBACO|CANDELARIA|FLORIDA|JAMUNDI|LA CEJA|' +
   'LA TEBAIDA|MARINILLA|PRADERA|RETIRO|BARANOA|BARBOSA|CALDAS|CALOTO|CIRCASIA|DAGUA|' +
   'EL CARMEN DE VIBORAL|GACHANCIPA|GALAPA|GINEBRA|GUACARI|LA CUMBRE|LEBRIJA|MONTENEGRO|' +
   'OBANDO|POLONUEVO|PUERTO COLOMBIA|PUERTO TEJADA').split('|')
);
const CIUDADES_REGIONALES_ALTERNAS = new Set(
  'VILLETA|FUSAGASUGA|GIRARDOT|VILLAVICENCIO|IBAGUE'.split('|')
);

function normalizarCiudadEnvio(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\b(DISTRITO CAPITAL|D C|DC)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarDepartamentoEnvio(valor) {
  return String(valor || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function claveTarifaEnvio(departamento, ciudad) {
  return normalizarDepartamentoEnvio(departamento) + '::' + normalizarCiudadEnvio(ciudad);
}

const TARIFAS_INICIALES_V49 = [{"ciudad": "BOGOTA", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 8158, "contraentrega": true}, {"ciudad": "COTA", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 8158, "contraentrega": true}, {"ciudad": "FUNZA", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 8158, "contraentrega": true}, {"ciudad": "MOSQUERA", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 8158, "contraentrega": true}, {"ciudad": "SOACHA", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 8158, "contraentrega": true}, {"ciudad": "CHIA", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 8158, "contraentrega": true}, {"ciudad": "MADRID", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 8158, "contraentrega": true}, {"ciudad": "CAJICA", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 10315, "contraentrega": true}, {"ciudad": "SIBATE", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 10315, "contraentrega": true}, {"ciudad": "SOPO", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 10315, "contraentrega": true}, {"ciudad": "TABIO", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 10315, "contraentrega": true}, {"ciudad": "TENJO", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 10315, "contraentrega": true}, {"ciudad": "TOCANCIPA", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 10315, "contraentrega": true}, {"ciudad": "FACATATIVA", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 10315, "contraentrega": true}, {"ciudad": "ZIPAQUIRA", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 10315, "contraentrega": true}, {"ciudad": "BARRANQUILLA", "departamento": "ATLANTICO", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "BELLO", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "BUCARAMANGA", "departamento": "SANTANDER", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "CALARCA", "departamento": "QUINDIO", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "CALI", "departamento": "VALLE DEL CAUCA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "CARTAGENA", "departamento": "BOLIVAR", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "CUCUTA", "departamento": "NORTE DE SANTANDER", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "DOSQUEBRADAS", "departamento": "RISARALDA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "FLORIDABLANCA", "departamento": "SANTANDER", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "MEDELLIN", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "PEREIRA", "departamento": "RISARALDA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "SANTA MARTA", "departamento": "MAGDALENA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "SANTA ROSA DE CABAL", "departamento": "RISARALDA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "VILLAMARIA", "departamento": "CALDAS", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "VILLAVICENCIO", "departamento": "META", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "YUMBO", "departamento": "VALLE DEL CAUCA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "ARMENIA", "departamento": "QUINDIO", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "ENVIGADO", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "IBAGUE", "departamento": "TOLIMA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "ITAGUI", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "LA CALERA", "departamento": "CUNDINAMARCA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "MANIZALES", "departamento": "CALDAS", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "MONTERIA", "departamento": "CORDOBA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "NEIVA", "departamento": "HUILA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "PALMIRA", "departamento": "VALLE DEL CAUCA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "PASTO", "departamento": "NARINO", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "RIOHACHA", "departamento": "LA GUAJIRA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "SABANETA", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "SANTA MARTA", "departamento": "MAGDALENA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "SANTA ROSA DE CABAL", "departamento": "RISARALDA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "SINCELEJO", "departamento": "SUCRE", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "TUNJA", "departamento": "BOYACA", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "VALLEDUPAR", "departamento": "CESAR", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "YOPAL", "departamento": "CASANARE", "transportadora": "23M&M", "valor": 17104, "contraentrega": true}, {"ciudad": "GUARNE", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 18817, "contraentrega": true}, {"ciudad": "JAMUNDI", "departamento": "VALLE DEL CAUCA", "transportadora": "23M&M", "valor": 18817, "contraentrega": true}, {"ciudad": "LA CEJA", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 18817, "contraentrega": true}, {"ciudad": "LA ESTRELLA", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 18817, "contraentrega": true}, {"ciudad": "LA TEBAIDA", "departamento": "QUINDIO", "transportadora": "23M&M", "valor": 18817, "contraentrega": true}, {"ciudad": "MALAMBO", "departamento": "ATLANTICO", "transportadora": "23M&M", "valor": 18817, "contraentrega": true}, {"ciudad": "MARINILLA", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 18817, "contraentrega": true}, {"ciudad": "RETIRO", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 18817, "contraentrega": true}, {"ciudad": "RIONEGRO", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 18817, "contraentrega": true}, {"ciudad": "SOLEDAD", "departamento": "ATLANTICO", "transportadora": "23M&M", "valor": 18817, "contraentrega": true}, {"ciudad": "CALDAS", "departamento": "ANTIOQUIA", "transportadora": "23M&M", "valor": 18817, "contraentrega": true}, {"ciudad": "Agustín Codazzi", "departamento": "Cesar", "transportadora": "Interrapidísimo", "valor": 20900, "contraentrega": false}];
const RESPUESTAS_SOFIA_V52 = {"saludo": "¡Hola! 💕 Qué gusto saludarte.", "anticipado": "El envío hasta allá vale {envio} si pagas las prendas por anticipado. Si prefieres contraentrega, se suma el {porcentaje}% sobre el valor de la compra por gastos operativos de la transportadora.", "contraentrega": "El envío hasta allá vale {envio} + el {porcentaje}% sobre el valor de la compra por gastos operativos de la transportadora. 💕", "asesora": "Registré tu solicitud de asesora 💕 Nuestro equipo la revisará.", "confirmacion": "¡Gracias por comprar con nosotras! 💕"};
const MATRIZ_CIERRE_V52 = {"source": "Matriz_MYM_envios_SuperKids_analizada.xlsx", "date": "2026-10-04", "origin": "BOGOTA", "sha256": "d9d36f4a53163e121b7c96577732199157aceb1adb5056de0a970bc425288dd7", "assumptions": {"declaredMinimum": 45000, "handling": 0.02, "discount": 0.2}, "routes": [["1_URBANO", "Urbano", 9288, 3299, 502, "SI"], ["2_REGIONAL", "Regional", 11876, 3934, 502, "SI"], ["3_NACIONAL", "Nacional principal", 20023, 4441, 502, "SI"], ["4_NACIONAL 2", "Nacional secundaria", 22079, 6599, 502, "SI"], ["5_REEXPEDICION", "Reexpedición 1", 34565, 8882, 931, "NO"], ["6_REEXPEDICION 2", "Reexpedición 2", 48725, 15226, 931, "NO"]], "destinations": [["BOGOTA", "CUNDINAMARCA", "1_URBANO", 1, "SI"], ["COTA", "CUNDINAMARCA", "1_URBANO", 1, "SI"], ["FUNZA", "CUNDINAMARCA", "1_URBANO", 1, "SI"], ["MOSQUERA", "CUNDINAMARCA", "1_URBANO", 1, "SI"], ["SOACHA", "CUNDINAMARCA", "1_URBANO", 1, "SI"], ["CHIA", "CUNDINAMARCA", "1_URBANO", 1, "SI"], ["MADRID", "CUNDINAMARCA", "1_URBANO", 1, "SI"], ["CAJICA", "CUNDINAMARCA", "2_REGIONAL", 1, "SI"], ["SIBATE", "CUNDINAMARCA", "2_REGIONAL", 3, "SI"], ["SOPO", "CUNDINAMARCA", "2_REGIONAL", 1, "SI"], ["TABIO", "CUNDINAMARCA", "2_REGIONAL", 1, "SI"], ["TENJO", "CUNDINAMARCA", "2_REGIONAL", 1, "SI"], ["TOCANCIPA", "CUNDINAMARCA", "2_REGIONAL", 1, "SI"], ["EL ROSAL", "CUNDINAMARCA", "2_REGIONAL", 2, "NO"], ["FACATATIVA", "CUNDINAMARCA", "2_REGIONAL", 1, "SI"], ["FUSAGASUGA", "CUNDINAMARCA", "2_REGIONAL", 3, "NO"], ["GIRARDOT", "CUNDINAMARCA", "2_REGIONAL", 3, "NO"], ["GRANADA", "CUNDINAMARCA", "2_REGIONAL", 2, "NO"], ["SUBACHOQUE", "CUNDINAMARCA", "2_REGIONAL", 3, "NO"], ["UBATE", "CUNDINAMARCA", "2_REGIONAL", 2, "NO"], ["ZIPAQUIRA", "CUNDINAMARCA", "2_REGIONAL", 1, "SI"], ["BARRANQUILLA", "ATLANTICO", "3_NACIONAL", 1, "SI"], ["BELLO", "ANTIOQUIA", "3_NACIONAL", 2, "SI"], ["BUCARAMANGA", "SANTANDER", "3_NACIONAL", 3, "SI"], ["CALARCA", "QUINDIO", "3_NACIONAL", 2, "SI"], ["CALI", "VALLE DEL CAUCA", "3_NACIONAL", 1, "SI"], ["CARTAGENA", "BOLIVAR", "3_NACIONAL", 2, "SI"], ["CUCUTA", "NORTE DE SANTANDER", "3_NACIONAL", 3, "SI"], ["DOSQUEBRADAS", "RISARALDA", "3_NACIONAL", 1, "SI"], ["FLORIDABLANCA", "SANTANDER", "3_NACIONAL", 3, "SI"], ["MEDELLIN", "ANTIOQUIA", "3_NACIONAL", 1, "SI"], ["PEREIRA", "RISARALDA", "3_NACIONAL", 1, "SI"], ["SANTA MARTA", "MAGDALENA", "3_NACIONAL", 2, "SI"], ["SANTA ROSA DE CABAL", "RISARALDA", "3_NACIONAL", 1, "SI"], ["VILLAMARIA", "CALDAS", "3_NACIONAL", 2, "SI"], ["VILLAVICENCIO", "META", "3_NACIONAL", 2, "SI"], ["YUMBO", "VALLE DEL CAUCA", "3_NACIONAL", 1, "SI"], ["ARMENIA", "QUINDIO", "3_NACIONAL", 1, "SI"], ["BUENAVENTURA", "VALLE DEL CAUCA", "3_NACIONAL", 3, "NO"], ["CARTAGO", "VALLE DEL CAUCA", "3_NACIONAL", 2, "NO"], ["CHINCHINA", "CALDAS", "3_NACIONAL", 2, "NO"], ["DUITAMA", "BOYACA", "3_NACIONAL", "2 a 3", "NO"], ["ENVIGADO", "ANTIOQUIA", "3_NACIONAL", 1, "SI"], ["ESPINAL", "TOLIMA", "3_NACIONAL", 3, "NO"], ["GIRARDOTA", "ANTIOQUIA", "3_NACIONAL", 2, "NO"], ["IBAGUE", "TOLIMA", "3_NACIONAL", 1, "SI"], ["IPIALES", "NARINO", "3_NACIONAL", 3, "NO"], ["ITAGUI", "ANTIOQUIA", "3_NACIONAL", 1, "SI"], ["LA CALERA", "CUNDINAMARCA", "3_NACIONAL", 2, "SI"], ["MANIZALES", "CALDAS", "3_NACIONAL", 1, "SI"], ["MONTERIA", "CORDOBA", "3_NACIONAL", 3, "SI"], ["NEIVA", "HUILA", "3_NACIONAL", "2 a 3", "SI"], ["PALMIRA", "VALLE DEL CAUCA", "3_NACIONAL", 2, "SI"], ["PASTO", "NARINO", "3_NACIONAL", "2 a 3", "SI"], ["POPAYAN", "CAUCA", "3_NACIONAL", 3, "NO"], ["RIOHACHA", "LA GUAJIRA", "3_NACIONAL", 3, "SI"], ["SABANETA", "ANTIOQUIA", "3_NACIONAL", 1, "SI"], ["SANTA MARTA", "MAGDALENA", "3_NACIONAL", 3, "SI"], ["SANTA ROSA DE CABAL", "RISARALDA", "3_NACIONAL", 1, "SI"], ["SINCELEJO", "SUCRE", "3_NACIONAL", 3, "SI"], ["SOGAMOSO", "BOYACA", "3_NACIONAL", "2 a 3", "NO"], ["TULUA", "VALLE DEL CAUCA", "3_NACIONAL", 3, "NO"], ["TUNJA", "BOYACA", "3_NACIONAL", 2, "SI"], ["VALLEDUPAR", "CESAR", "3_NACIONAL", "2 a 3", "SI"], ["YOPAL", "CASANARE", "3_NACIONAL", 3, "SI"], ["CANDELARIA", "VALLE DEL CAUCA", "4_NACIONAL 2", 2, "NO"], ["CANDELARIA", "ATLANTICO", "4_NACIONAL 2", 2, "NO"], ["COPACABANA", "ANTIOQUIA", "4_NACIONAL 2", 3, "NO"], ["FLORIDA", "VALLE DEL CAUCA", "4_NACIONAL 2", 2, "NO"], ["GUARNE", "ANTIOQUIA", "4_NACIONAL 2", 3, "SI"], ["JAMUNDI", "VALLE DEL CAUCA", "4_NACIONAL 2", 2, "SI"], ["LA CEJA", "ANTIOQUIA", "4_NACIONAL 2", 2, "SI"], ["LA ESTRELLA", "ANTIOQUIA", "4_NACIONAL 2", 1, "SI"], ["LA TEBAIDA", "QUINDIO", "4_NACIONAL 2", 2, "SI"], ["MALAMBO", "ATLANTICO", "4_NACIONAL 2", 1, "SI"], ["MARINILLA", "ANTIOQUIA", "4_NACIONAL 2", 2, "SI"], ["PRADERA", "VALLE DEL CAUCA", "4_NACIONAL 2", 2, "NO"], ["RETIRO", "ANTIOQUIA", "4_NACIONAL 2", 2, "SI"], ["RIONEGRO", "ANTIOQUIA", "4_NACIONAL 2", 1, "SI"], ["SOLEDAD", "ATLANTICO", "4_NACIONAL 2", 1, "SI"], ["ACACIAS", "META", "4_NACIONAL 2", 3, "NO"], ["AGUA DE DIOS", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["ALBAN", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["ANAPOIMA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["ANDALUCIA", "VALLE DEL CAUCA", "4_NACIONAL 2", 3, "NO"], ["ANOLAIMA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["APULO", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["ARAUCA", "ARAUCA", "4_NACIONAL 2", 4, "NO"], ["ARBELAEZ", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["BARANOA", "ATLANTICO", "4_NACIONAL 2", 2, "NO"], ["BARBOSA", "ANTIOQUIA", "4_NACIONAL 2", 2, "NO"], ["BARRANCABERMEJA", "SANTANDER", "4_NACIONAL 2", 3, "NO"], ["BOJACA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["BUGALAGRANDE", "VALLE DEL CAUCA", "4_NACIONAL 2", 3, "NO"], ["CACHIPAY", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["CALDAS", "ANTIOQUIA", "4_NACIONAL 2", 2, "SI"], ["CALIMA", "VALLE DEL CAUCA", "4_NACIONAL 2", 3, "NO"], ["CALOTO", "CAUCA", "4_NACIONAL 2", 2, "NO"], ["CAQUEZA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["CARMEN DE CARUPA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["CHICORAL", "TOLIMA", "4_NACIONAL 2", 3, "NO"], ["CHIPAQUE", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["CHOACHI", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["CHOCONTA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["CIRCASIA", "QUINDIO", "4_NACIONAL 2", 2, "NO"], ["COGUA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["COMBITA", "BOYACA", "4_NACIONAL 2", 3, "NO"], ["CUMARAL", "META", "4_NACIONAL 2", 3, "NO"], ["DAGUA", "VALLE DEL CAUCA", "4_NACIONAL 2", 2, "NO"], ["EL CARMEN DE VIBORAL", "ANTIOQUIA", "4_NACIONAL 2", 2, "NO"], ["EL PENON", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["EL SANTUARIO", "ANTIOQUIA", "4_NACIONAL 2", 3, "NO"], ["FLANDES", "TOLIMA", "4_NACIONAL 2", 3, "NO"], ["FLORENCIA", "CAQUETA", "4_NACIONAL 2", 3, "NO"], ["FOMEQUE", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["FUQUENE", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["GACHANCIPA", "CUNDINAMARCA", "4_NACIONAL 2", 2, "NO"], ["GACHETA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["GALAPA", "ATLANTICO", "4_NACIONAL 2", 2, "NO"], ["GINEBRA", "VALLE DEL CAUCA", "4_NACIONAL 2", 2, "NO"], ["GIRON", "SANTANDER", "4_NACIONAL 2", 3, "NO"], ["GUACARI", "VALLE DEL CAUCA", "4_NACIONAL 2", 2, "NO"], ["GUACHENE", "CAUCA", "4_NACIONAL 2", 3, "NO"], ["GUADALAJARA DE BUGA", "VALLE DEL CAUCA", "4_NACIONAL 2", 3, "NO"], ["GUADUAS", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["GUASCA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["GUATAVITA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["GUAYABETAL", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["JUNIN", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["LA CUMBRE", "VALLE DEL CAUCA", "4_NACIONAL 2", 2, "NO"], ["LA DORADA", "CALDAS", "4_NACIONAL 2", 3, "NO"], ["LA MESA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["LEBRIJA", "SANTANDER", "4_NACIONAL 2", 2, "NO"], ["LOS PATIOS", "NORTE DE SANTANDER", "4_NACIONAL 2", 3, "NO"], ["MELGAR", "TOLIMA", "4_NACIONAL 2", 3, "NO"], ["MONTENEGRO", "QUINDIO", "4_NACIONAL 2", 2, "NO"], ["NEMOCON", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["NILO", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["NIMAIMA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["NOBSA", "BOYACA", "4_NACIONAL 2", 3, "NO"], ["NOCAIMA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["OBANDO", "VALLE DEL CAUCA", "4_NACIONAL 2", 2, "NO"], ["PACHO", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["PAIPA", "BOYACA", "4_NACIONAL 2", 3, "NO"], ["PASCA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["PIEDECUESTA", "SANTANDER", "4_NACIONAL 2", 1, "NO"], ["PITALITO", "HUILA", "4_NACIONAL 2", 3, "NO"], ["POLONUEVO", "ATLANTICO", "4_NACIONAL 2", 2, "NO"], ["PUEBLO TAPAO", "QUINDIO", "4_NACIONAL 2", 3, "NO"], ["PUERTO COLOMBIA", "ATLANTICO", "4_NACIONAL 2", 2, "NO"], ["PUERTO TEJADA", "CAUCA", "4_NACIONAL 2", 2, "NO"], ["PULI", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["QUETAME", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["QUIBDO", "CHOCO", "4_NACIONAL 2", 3, "NO"], ["QUIMBAYA", "QUINDIO", "4_NACIONAL 2", 3, "NO"], ["QUIPILE", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["RESTREPO", "VALLE DEL CAUCA", "4_NACIONAL 2", 3, "NO"], ["RESTREPO", "META", "4_NACIONAL 2", 3, "NO"], ["RIOFRIO", "VALLE DEL CAUCA", "4_NACIONAL 2", 4, "NO"], ["ROLDANILLO", "VALLE DEL CAUCA", "4_NACIONAL 2", 3, "NO"], ["SABANAGRANDE", "ATLANTICO", "4_NACIONAL 2", 3, "NO"], ["SAN ANTONIO DEL TEQUENDAM", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["SAN PEDRO", "VALLE DEL CAUCA", "4_NACIONAL 2", 4, "NO"], ["SANTANDER DE QUILICHAO", "CAUCA", "4_NACIONAL 2", 3, "NO"], ["SASAIMA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["SESQUILE", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["SILVANIA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["SORACA", "BOYACA", "4_NACIONAL 2", 3, "NO"], ["SUESCA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["SUSA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["SUTATAUSA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["TAUSA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["TENA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["TIBACUY", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["TIBASOSA", "BOYACA", "4_NACIONAL 2", 3, "NO"], ["TIBIRITA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["TOCAIMA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["TRUJILLO", "VALLE DEL CAUCA", "4_NACIONAL 2", 4, "NO"], ["TURBACO", "BOLIVAR", "4_NACIONAL 2", 1, "NO"], ["TUTA", "BOYACA", "4_NACIONAL 2", 3, "NO"], ["UBAQUE", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["UNE", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["VERGARA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["VIANI", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["VIJES", "VALLE DEL CAUCA", "4_NACIONAL 2", 3, "NO"], ["VILLA DE SAN DIEGO DE UBA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["VILLA DEL ROSARIO", "NORTE DE SANTANDER", "4_NACIONAL 2", 3, "NO"], ["VILLA RICA", "CAUCA", "4_NACIONAL 2", 3, "NO"], ["VILLAPINZON", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["VILLETA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["VIOTA", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["ZARZAL", "VALLE DEL CAUCA", "4_NACIONAL 2", 3, "NO"], ["ZIPACON", "CUNDINAMARCA", "4_NACIONAL 2", 3, "NO"], ["ABREGO", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["ACEVEDO", "HUILA", "5_REEXPEDICION", 7, "NO"], ["ACHI", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["AGRADO", "HUILA", "5_REEXPEDICION", 7, "NO"], ["AGUACHICA", "CESAR", "5_REEXPEDICION", 3, "NO"], ["AGUADA", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["AGUADAS", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["AGUAZUL", "CASANARE", "5_REEXPEDICION", 3, "NO"], ["AGUSTIN CODAZZI", "CESAR", "5_REEXPEDICION", 3, "NO"], ["AIPE", "HUILA", "5_REEXPEDICION", 7, "NO"], ["ALBAN", "NARINO", "5_REEXPEDICION", 4, "NO"], ["ALBANIA", "CAQUETA", "5_REEXPEDICION", 6, "NO"], ["ALBANIA", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["ALBANIA", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["ALCALA", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["ALCALA", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["ALDANA", "NARINO", "5_REEXPEDICION", 4, "NO"], ["ALGARROBO", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["ALGECIRAS", "HUILA", "5_REEXPEDICION", 7, "NO"], ["ALMAGUER", "CAUCA", "5_REEXPEDICION", 7, "NO"], ["ALMEIDA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["ALPUJARRA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["ALTAMIRA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["ALTOS DEL ROSARIO", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["ALVARADO", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["AMAGA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["AMAIME", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["AMALFI", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["AMBALEMA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["ANCUYA", "NARINO", "5_REEXPEDICION", 4, "NO"], ["ANDES", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["ANIMAS", "CHOCO", "5_REEXPEDICION", 5, "NO"], ["ANSERMA", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["ANSERMANUEVO", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["ANSERMANUEVO", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["ANZOATEGUI", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["APARTADO", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["APIA", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["APIAY", "META", "5_REEXPEDICION", 5, "NO"], ["AQUITANIA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["ARACATACA", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["ARANZAZU", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["ARATOCA", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["ARBOLEDA", "NARINO", "5_REEXPEDICION", 4, "NO"], ["ARBOLEDAS", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["ARBOLETES", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["ARCABUCO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["ARENAL", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["ARGELIA", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["ARGELIA", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["ARIGUANI", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["ARJONA", "BOLIVAR", "5_REEXPEDICION", 4, "NO"], ["ARMERO GUAYABAL", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["ARROYOHONDO", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["ASTREA", "CESAR", "5_REEXPEDICION", 5, "NO"], ["ATACO", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["AYAPEL", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["BALBOA", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["BALBOA", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["BARAYA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["BARBACOAS", "NARINO", "5_REEXPEDICION", 4, "NO"], ["BARBOSA", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["BARICHARA", "SANTANDER", "5_REEXPEDICION", 3, "NO"], ["BARRANCA DE UPIA", "META", "5_REEXPEDICION", 5, "NO"], ["BARRANCAS", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["BARRANCO DE LOBA", "BOLIVAR", "5_REEXPEDICION", 7, "NO"], ["BECERRIL", "CESAR", "5_REEXPEDICION", 5, "NO"], ["BELALCAZAR", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["BELEN", "NARINO", "5_REEXPEDICION", 4, "NO"], ["BELEN", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["BELEN DE LOS ANDAQUIES", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["BELEN DE UMBRIA", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["BELMIRA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["BELTRAN", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["BERBEO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["BETEITIVA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["BETULIA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["BITUIMA", "CUNDINAMARCA", "5_REEXPEDICION", 3, "NO"], ["BOAVITA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["BOCHALEMA", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["BOLIVAR", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["BOLIVAR", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["BOLIVAR", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["BOLIVAR", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["BORDON", "NARINO", "5_REEXPEDICION", 4, "NO"], ["BOSCONIA", "CESAR", "5_REEXPEDICION", 4, "NO"], ["BOYACA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["BRICENO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["BRICENO", "CUNDINAMARCA", "5_REEXPEDICION", 4, "NO"], ["BRICENO", "ANTIOQUIA", "5_REEXPEDICION", 4, "NO"], ["BUENAVISTA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["BUENAVISTA", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["BUENAVISTA", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["BUENOS AIRES", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["BUESACO", "NARINO", "5_REEXPEDICION", 4, "NO"], ["BURITICA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["BUSBANZA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CABRERA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["CABUYARO", "META", "5_REEXPEDICION", 5, "NO"], ["CACERES", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["CAICEDONIA", "VALLE DEL CAUCA", "5_REEXPEDICION", 5, "NO"], ["CAICEDONIA", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["CAIMITO", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["CAJAMARCA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["CAJIBIO", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["CALAMAR", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["CALDAS", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CALDONO", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["CALIFORNIA", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["CAMPO DE LA CRUZ", "ATLANTICO", "5_REEXPEDICION", 4, "NO"], ["CAMPOALEGRE", "HUILA", "5_REEXPEDICION", 7, "NO"], ["CAMPOHERMOSO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CANALETE", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["CANASGORDAS", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["CANTAGALLO", "BOLIVAR", "5_REEXPEDICION", 4, "NO"], ["CAPARRAPI", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["CAPITANEJO", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["CARCASI", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["CAREPA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["CARMEN DE APICALA", "TOLIMA", "5_REEXPEDICION", 3, "NO"], ["CARMEN DEL DARIEN", "CHOCO", "5_REEXPEDICION", 5, "NO"], ["CAROLINA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["CARTAGENA DEL CHAIRA", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["CASTILLA LA NUEVA", "META", "5_REEXPEDICION", 5, "NO"], ["CAUCASIA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["CEPITA", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["CERETE", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["CERINZA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CERRITO", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["CERRO DE SAN ANTONIO", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["CERTEGUI", "CHOCO", "5_REEXPEDICION", 5, "NO"], ["CHACHAGUI", "NARINO", "5_REEXPEDICION", 4, "NO"], ["CHAGUANI", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["CHALAN", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["CHAMEZA", "CASANARE", "5_REEXPEDICION", 9, "NO"], ["CHAPARRAL", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["CHARALA", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["CHARTA", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["CHIGORODO", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["CHIMA", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["CHIMICHAGUA", "CESAR", "5_REEXPEDICION", 5, "NO"], ["CHINACOTA", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["CHINAUTA", "CUNDINAMARCA", "5_REEXPEDICION", 5, "NO"], ["CHINAVITA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CHINU", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["CHIQUINQUIRA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CHIQUIZA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CHIRIGUANA", "CESAR", "5_REEXPEDICION", 5, "NO"], ["CHISCAS", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CHITA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CHITAGA", "NORTE DE SANTANDER", "5_REEXPEDICION", 8, "NO"], ["CHITARAQUE", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CHIVATA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CHIVOLO", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["CHIVOR", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CICUCO", "BOLIVAR", "5_REEXPEDICION", 8, "NO"], ["CIENAGA", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["CIENAGA DE ORO", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["CIENEGA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CIMITARRA", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["CISNEROS", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["CIUDAD BOLIVAR", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["CLEMENCIA", "BOLIVAR", "5_REEXPEDICION", 4, "NO"], ["COELLO", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["COLOMBIA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["COLON", "NARINO", "5_REEXPEDICION", 4, "NO"], ["COLON", "PUTUMAYO", "5_REEXPEDICION", 8, "NO"], ["COLOSO", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["CONCEPCION", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["CONCORDIA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["CONDOTO", "CHOCO", "5_REEXPEDICION", 4, "NO"], ["CONFINES", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["CONSACA", "NARINO", "5_REEXPEDICION", 4, "NO"], ["CONTADERO", "NARINO", "5_REEXPEDICION", 4, "NO"], ["CONTRATACION", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["CONVENCION", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["COPER", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CORDOBA", "NARINO", "5_REEXPEDICION", 4, "NO"], ["CORDOBA", "BOLIVAR", "5_REEXPEDICION", 8, "NO"], ["COROZAL", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["CORRALES", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["COTORRA", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["COVARACHIA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["COVENAS", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["COYAIMA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["COYAIMA", "TOLIMA", "5_REEXPEDICION", 6, "NO"], ["CUASPUD", "NARINO", "5_REEXPEDICION", 4, "NO"], ["CUBARA", "BOYACA", "5_REEXPEDICION", 10, "NO"], ["CUCAITA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CUCUNUBA", "CUNDINAMARCA", "5_REEXPEDICION", 5, "NO"], ["CUCUTILLA", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["CUITIVA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["CUMBAL", "NARINO", "5_REEXPEDICION", 4, "NO"], ["CUMBITARA", "NARINO", "5_REEXPEDICION", 4, "NO"], ["CUNDAY", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["CURILLO", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["CURITI", "SANTANDER", "5_REEXPEDICION", 3, "NO"], ["CURUMANI", "CESAR", "5_REEXPEDICION", 5, "NO"], ["DABEIBA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["DIBULLA", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["DISTRACCION", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["DOLORES", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["DONMATIAS", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["DURANIA", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["EL AGUILA", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["EL BAGRE", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["EL BANCO", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["EL BORDO", "CAUCA", "5_REEXPEDICION", 6, "NO"], ["EL CAIRO", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["EL CALVARIO", "META", "5_REEXPEDICION", 6, "NO"], ["EL CARMEN", "NORTE DE SANTANDER", "5_REEXPEDICION", 7, "NO"], ["EL CARMEN DE ATRATO", "CHOCO", "5_REEXPEDICION", 5, "NO"], ["EL CARMEN DE BOLIVAR", "BOLIVAR", "5_REEXPEDICION", 3, "NO"], ["EL CASTILLO", "META", "5_REEXPEDICION", 6, "NO"], ["EL CERRITO", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["EL CHARCO", "NARINO", "5_REEXPEDICION", 4, "NO"], ["EL COCUY", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["EL COLEGIO", "CUNDINAMARCA", "5_REEXPEDICION", 5, "NO"], ["EL COPEY", "CESAR", "5_REEXPEDICION", 5, "NO"], ["EL DIFICIL", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["EL DONCELLO", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["EL DORADO", "META", "5_REEXPEDICION", 6, "NO"], ["EL DOVIO", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["EL ESPINO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["EL GUAMO", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["EL MOLINO", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["EL PASO", "CESAR", "5_REEXPEDICION", 5, "NO"], ["EL PAUJIL", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["EL PENOL", "NARINO", "5_REEXPEDICION", 4, "NO"], ["EL PENOL", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["EL PENON", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["EL PENON", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["EL PINON", "MAGDALENA", "5_REEXPEDICION", 7, "NO"], ["EL PLAYON", "SANTANDER", "5_REEXPEDICION", 3, "NO"], ["EL RETEN", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["EL RETORNO", "GUAVIARE", "5_REEXPEDICION", 9, "NO"], ["EL ROBLE", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["EL ROSARIO", "NARINO", "5_REEXPEDICION", 4, "NO"], ["EL TABLON DE GOMEZ", "NARINO", "5_REEXPEDICION", 4, "NO"], ["EL TAMBO", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["EL TAMBO", "NARINO", "5_REEXPEDICION", 4, "NO"], ["EL TARRA", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["EL ZULIA", "NORTE DE SANTANDER", "5_REEXPEDICION", 4, "NO"], ["ELIAS", "HUILA", "5_REEXPEDICION", 7, "NO"], ["ENCINO", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["ENTRERRIOS", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["FALAN", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["FILADELFIA", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["FILANDIA", "QUINDIO", "5_REEXPEDICION", 8, "NO"], ["FIRAVITOBA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["FLORENCIA", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["FLORESTA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["FLORIAN", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["FONSECA", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["FOSCA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["FREDONIA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["FRESNO", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["FRONTINO", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["FUENTE DE ORO", "META", "5_REEXPEDICION", 5, "NO"], ["FUNDACION", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["FUNES", "NARINO", "5_REEXPEDICION", 4, "NO"], ["GACHALA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["GACHANTIVA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["GALAN", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["GALERAS", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["GAMA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["GAMARRA", "CESAR", "5_REEXPEDICION", 5, "NO"], ["GAMBITA", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["GAMEZA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["GARAGOA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["GARZON", "HUILA", "5_REEXPEDICION", 7, "NO"], ["GARZON", "PUTUMAYO", "5_REEXPEDICION", 8, "NO"], ["GENOVA", "QUINDIO", "5_REEXPEDICION", 8, "NO"], ["GIGANTE", "HUILA", "5_REEXPEDICION", 7, "NO"], ["GOMEZ PLATA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["GONZALEZ", "CESAR", "5_REEXPEDICION", 5, "NO"], ["GRANADA", "META", "5_REEXPEDICION", 6, "NO"], ["GUACA", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["GUACAMAYAS", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["GUACHETA", "CUNDINAMARCA", "5_REEXPEDICION", 5, "NO"], ["GUACHUCAL", "NARINO", "5_REEXPEDICION", 5, "NO"], ["GUADALUPE", "HUILA", "5_REEXPEDICION", 7, "NO"], ["GUADALUPE", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["GUADALUPE", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["GUAITARILLA", "NARINO", "5_REEXPEDICION", 4, "NO"], ["GUALMATAN", "NARINO", "5_REEXPEDICION", 4, "NO"], ["GUAMAL", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["GUAMO", "TOLIMA", "5_REEXPEDICION", 3, "NO"], ["GUAPOTA", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["GUARANDA", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["GUATAPE", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["GUATAQUI", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["GUATEQUE", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["GUATICA", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["GUAYABAL DE SIQUIMA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["GUAYATA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["GUEPSA", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["GUICAN", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["GUTIERREZ", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["HATILLO DE LOBA", "BOLIVAR", "5_REEXPEDICION", 6, "NO"], ["HATO COROZAL", "CASANARE", "5_REEXPEDICION", 5, "NO"], ["HATONUEVO", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["HISPANIA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["HOBO", "HUILA", "5_REEXPEDICION", 7, "NO"], ["HONDA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["ICONONZO", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["ILES", "NARINO", "5_REEXPEDICION", 5, "NO"], ["IMUES", "NARINO", "5_REEXPEDICION", 5, "NO"], ["INZA", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["IQUIRA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["ISNOS", "HUILA", "5_REEXPEDICION", 7, "NO"], ["ISTMINA", "CHOCO", "5_REEXPEDICION", 4, "NO"], ["IZA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["JAMBALO", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["JARDIN", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["JENESANO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["JERICO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["JERUSALEN", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["JESUS MARIA", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["JUAN DE ACOSTA", "ATLANTICO", "5_REEXPEDICION", 3, "NO"], ["JUAN MINA", "ATLANTICO", "5_REEXPEDICION", 4, "NO"], ["JUAN MINA", "ATLANTICO", "5_REEXPEDICION", 5, "NO"], ["LA APARTADA", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["LA ARGENTINA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["LA BELLEZA", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["LA CAPILLA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["LA CELIA", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["LA CRUZ", "NARINO", "5_REEXPEDICION", 5, "NO"], ["LA FLORIDA", "NARINO", "5_REEXPEDICION", 5, "NO"], ["LA GLORIA", "CESAR", "5_REEXPEDICION", 5, "NO"], ["LA JAGUA DEL PILAR", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["LA LLANADA", "NARINO", "5_REEXPEDICION", 5, "NO"], ["LA MACARENA", "META", "5_REEXPEDICION", 6, "NO"], ["LA MERCED", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["LA MONTANITA", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["LA PALMA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["LA PAZ", "CESAR", "5_REEXPEDICION", 5, "NO"], ["LA PAZ", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["LA PENA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["LA PINTADA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["LA PLATA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["LA PLAYA", "NORTE DE SANTANDER", "5_REEXPEDICION", 4, "NO"], ["LA SALINA", "CASANARE", "5_REEXPEDICION", 9, "NO"], ["LA SIERRA", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["LA TOLA", "NARINO", "5_REEXPEDICION", 5, "NO"], ["LA UNION", "VALLE DEL CAUCA", "5_REEXPEDICION", 3, "NO"], ["LA UNION", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["LA UNION", "ANTIOQUIA", "5_REEXPEDICION", 2, "NO"], ["LA UVITA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["LA VEGA", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["LA VEGA", "CUNDINAMARCA", "5_REEXPEDICION", 4, "NO"], ["LA VICTORIA", "VALLE DEL CAUCA", "5_REEXPEDICION", 3, "NO"], ["LA VICTORIA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["LA VIRGINIA", "RISARALDA", "5_REEXPEDICION", 2, "NO"], ["LABATECA", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["LANDAZURI", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["LENGUAZAQUE", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["LERIDA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["LIBANO", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["LIBANO", "TOLIMA", "5_REEXPEDICION", 6, "NO"], ["LINARES", "NARINO", "5_REEXPEDICION", 5, "NO"], ["LORICA", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["LORICA", "CORDOBA", "5_REEXPEDICION", 4, "NO"], ["LOS ANDES", "NARINO", "5_REEXPEDICION", 5, "NO"], ["LOS CORDOBAS", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["LOS PALMITOS", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["LOS SANTOS", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["LURUACO", "ATLANTICO", "5_REEXPEDICION", 3, "NO"], ["MACANAL", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["MACHETA", "CUNDINAMARCA", "5_REEXPEDICION", 6, "NO"], ["MAGANGUE", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["MAGUI", "NARINO", "5_REEXPEDICION", 5, "NO"], ["MAHATES", "BOLIVAR", "5_REEXPEDICION", 4, "NO"], ["MAICAO", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["MAJAGUAL", "SUCRE", "5_REEXPEDICION", 4, "NO"], ["MALAGA", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["MANATI", "ATLANTICO", "5_REEXPEDICION", 4, "NO"], ["MANAURE", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["MANAURE BALCON DEL CESAR", "CESAR", "5_REEXPEDICION", 5, "NO"], ["MANI", "CASANARE", "5_REEXPEDICION", 4, "NO"], ["MANTA", "CUNDINAMARCA", "5_REEXPEDICION", 6, "NO"], ["MANZANARES", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["MARGARITA", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["MARIA LA BAJA", "BOLIVAR", "5_REEXPEDICION", 4, "NO"], ["MARIPI", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["MARIQUITA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["MARMATO", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["MARQUETALIA", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["MARSELLA", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["MARULANDA", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["MEDINA", "CUNDINAMARCA", "5_REEXPEDICION", 6, "NO"], ["MERCADERES", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["MESETAS", "META", "5_REEXPEDICION", 5, "NO"], ["MILAN", "CUNDINAMARCA", "5_REEXPEDICION", 9, "NO"], ["MILAN", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["MIRAFLORES", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["MIRANDA", "CAUCA", "5_REEXPEDICION", 5, "NO"], ["MISTRATO", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["MOCOA", "PUTUMAYO", "5_REEXPEDICION", 8, "NO"], ["MOGOTES", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["MOMIL", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["MONGUA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["MONGUI", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["MONIQUIRA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["MONITOS", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["MONTECRISTO", "BOLIVAR", "5_REEXPEDICION", 4, "NO"], ["MONTELIBANO", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["MONTERREY", "CASANARE", "5_REEXPEDICION", 3, "NO"], ["MORALES", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["MORALES", "BOLIVAR", "5_REEXPEDICION", 8, "NO"], ["MORELIA", "RISARALDA", "5_REEXPEDICION", 9, "NO"], ["MORROA", "SUCRE", "5_REEXPEDICION", 4, "NO"], ["MOTAVITA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["MURILLO", "TOLIMA", "5_REEXPEDICION", 6, "NO"], ["MURINDO", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["MUTATA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["MUTIS", "CHOCO", "5_REEXPEDICION", 5, "NO"], ["MUTISCUA", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["NARINO", "NARINO", "5_REEXPEDICION", 5, "NO"], ["NARINO", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["NATAGA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["NATAGAIMA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["NECHI", "ANTIOQUIA", "5_REEXPEDICION", 4, "NO"], ["NECOCLI", "ANTIOQUIA", "5_REEXPEDICION", 4, "NO"], ["NEIRA", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["NORCASIA", "CALDAS", "5_REEXPEDICION", 6, "NO"], ["NUEVA GRANADA", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["NUEVO COLON", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["NUNCHIA", "CASANARE", "5_REEXPEDICION", 5, "NO"], ["OCAMONTE", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["OCANA", "NORTE DE SANTANDER", "5_REEXPEDICION", 3, "NO"], ["OIBA", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["OICATA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["OLAYA HERRERA", "NARINO", "5_REEXPEDICION", 5, "NO"], ["ONZAGA", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["OPORAPA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["OROCUE", "CASANARE", "5_REEXPEDICION", 5, "NO"], ["ORTEGA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["OSPINA", "NARINO", "5_REEXPEDICION", 5, "NO"], ["OTANCHE", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["OVEJAS", "SUCRE", "5_REEXPEDICION", 4, "NO"], ["PACHAVITA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["PACORA", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["PADILLA", "CAUCA", "5_REEXPEDICION", 5, "NO"], ["PAEZ", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["PAEZ", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["PAICOL", "HUILA", "5_REEXPEDICION", 7, "NO"], ["PAILITAS", "CESAR", "5_REEXPEDICION", 5, "NO"], ["PAIME", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["PAJARITO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["PALERMO", "HUILA", "5_REEXPEDICION", 7, "NO"], ["PALESTINA", "CALDAS", "5_REEXPEDICION", 3, "NO"], ["PALESTINA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["PALMAR DE VARELA", "ATLANTICO", "5_REEXPEDICION", 3, "NO"], ["PALMAS DEL SOCORRO", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["PALMITO", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["PAMPLONA", "NORTE DE SANTANDER", "5_REEXPEDICION", 3, "NO"], ["PANDI", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["PANQUEBA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["PARAMO", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["PARATEBUENO", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["PATIA", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["PAUNA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["PAYA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["PAZ DE ARIPORO", "CASANARE", "5_REEXPEDICION", 4, "NO"], ["PAZ DE RIO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["PELAYA", "CESAR", "5_REEXPEDICION", 5, "NO"], ["PENOL", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["PESCA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["PIAMONTE", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["PIEDRANCHA", "CUNDINAMARCA", "5_REEXPEDICION", 7, "NO"], ["PIEDRAS", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["PIENDAMO", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["PIJAO", "QUINDIO", "5_REEXPEDICION", 8, "NO"], ["PIJINO DEL CARMEN", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["PINCHOTE", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["PINILLOS", "BOLIVAR", "5_REEXPEDICION", 4, "NO"], ["PIOJO", "ATLANTICO", "5_REEXPEDICION", 3, "NO"], ["PITAL", "HUILA", "5_REEXPEDICION", 7, "NO"], ["PIVIJAY", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["PLANETA RICA", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["PLATO", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["PONEDERA", "ATLANTICO", "5_REEXPEDICION", 3, "NO"], ["PORE", "CASANARE", "5_REEXPEDICION", 4, "NO"], ["POTOSI", "NARINO", "5_REEXPEDICION", 5, "NO"], ["PUEBLO BELLO", "CESAR", "5_REEXPEDICION", 5, "NO"], ["PUEBLO NUEVO", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["PUEBLO RICO", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["PUEBLOVIEJO", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["PUENTE NACIONAL", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["PUERRES", "NARINO", "5_REEXPEDICION", 5, "NO"], ["PUERTO ASIS", "PUTUMAYO", "5_REEXPEDICION", 8, "NO"], ["PUERTO BERRIO", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["PUERTO BOYACA", "BOYACA", "5_REEXPEDICION", 8, "NO"], ["PUERTO CAICEDO", "PUTUMAYO", "5_REEXPEDICION", 8, "NO"], ["PUERTO CONCORDIA", "META", "5_REEXPEDICION", 6, "NO"], ["PUERTO ESCONDIDO", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["PUERTO GAITAN", "META", "5_REEXPEDICION", 5, "NO"], ["PUERTO GUZMAN", "PUTUMAYO", "5_REEXPEDICION", 10, "NO"], ["PUERTO LIBERTADOR", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["PUERTO LLERAS", "META", "5_REEXPEDICION", 5, "NO"], ["PUERTO SALGAR", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["PUERTO SANTANDER", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["PUERTO WILCHES", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["PUPIALES", "NARINO", "5_REEXPEDICION", 5, "NO"], ["PURACE", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["PURIFICACION", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["PURISIMA DE LA CONCEPCION", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["QUEBRADANEGRA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["QUINCHIA", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["QUIPAMA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["RAMIRIQUI", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["RAQUIRA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["RECETOR", "CASANARE", "5_REEXPEDICION", 9, "NO"], ["REGIDOR", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["REMEDIOS", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["REMOLINO", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["REPELON", "ATLANTICO", "5_REEXPEDICION", 3, "NO"], ["RICAURTE", "NARINO", "5_REEXPEDICION", 5, "NO"], ["RIO DE ORO", "CESAR", "5_REEXPEDICION", 4, "NO"], ["RIO VIEJO", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["RIOBLANCO", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["RIONEGRO", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["RIOSUCIO", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["RIOSUCIO", "CHOCO", "5_REEXPEDICION", 4, "NO"], ["RISARALDA", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["RIVERA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["RONCESVALLES", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["RONDON", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["ROSAS", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["ROVIRA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["SABANA DE TORRES", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["SABANALARGA", "ATLANTICO", "5_REEXPEDICION", 8, "NO"], ["SABANAS DE SAN ANGEL", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["SABOYA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SACAMA", "CASANARE", "5_REEXPEDICION", 9, "NO"], ["SACHICA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SAHAGUN", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["SALADOBLANCO", "HUILA", "5_REEXPEDICION", 7, "NO"], ["SALAMINA", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["SALAZAR", "NORTE DE SANTANDER", "5_REEXPEDICION", 8, "NO"], ["SALDANA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["SALENTO", "QUINDIO", "5_REEXPEDICION", 8, "NO"], ["SALGAR", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["SAMACA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SAMANA", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["SAMPUES", "SUCRE", "5_REEXPEDICION", 4, "NO"], ["SAN AGUSTIN", "HUILA", "5_REEXPEDICION", 7, "NO"], ["SAN ALBERTO", "CESAR", "5_REEXPEDICION", 5, "NO"], ["SAN ANDRES", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["SAN ANDRES DE SOTAVENTO", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["SAN ANDRES DE TUMACO", "NARINO", "5_REEXPEDICION", 5, "NO"], ["SAN ANTERO", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["SAN ANTONIO", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["SAN BENITO ABAD", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["SAN BERNARDO", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["SAN BERNARDO", "NARINO", "5_REEXPEDICION", 5, "NO"], ["SAN BERNARDO DEL VIENTO", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["SAN CALIXTO", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["SAN CARLOS", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["SAN CARLOS", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["SAN CARLOS DE GUAROA", "META", "5_REEXPEDICION", 4, "NO"], ["SAN CAYETANO", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["SAN CAYETANO", "NORTE DE SANTANDER", "5_REEXPEDICION", 8, "NO"], ["SAN CRISTOBAL", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["SAN DIEGO", "CESAR", "5_REEXPEDICION", 5, "NO"], ["SAN EDUARDO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SAN ESTANISLAO", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["SAN FERNANDO", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["SAN FRANCISCO", "CUNDINAMARCA", "5_REEXPEDICION", 4, "NO"], ["SAN FRANCISCO", "PUTUMAYO", "5_REEXPEDICION", 8, "NO"], ["SAN GIL", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["SAN JACINTO DEL CAUCA", "BOLIVAR", "5_REEXPEDICION", 6, "NO"], ["SAN JERONIMO", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["SAN JOAQUIN", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["SAN JOSE", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["SAN JOSE DE ISNOS", "HUILA", "5_REEXPEDICION", 6, "NO"], ["SAN JOSE DE PARE", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SAN JOSE DE URE", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["SAN JOSE DEL FRAGUA", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["SAN JOSE DEL GUAVIARE", "GUAVIARE", "5_REEXPEDICION", 5, "NO"], ["SAN JUAN BETULIA", "SUCRE", "5_REEXPEDICION", 4, "NO"], ["SAN JUAN DE ARAMA", "META", "5_REEXPEDICION", 4, "NO"], ["SAN JUAN DE BETULIA", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["SAN JUAN DE RIOSECO", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["SAN JUAN DEL CESAR", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["SAN JUANITO", "META", "5_REEXPEDICION", 5, "NO"], ["SAN LORENZO", "NARINO", "5_REEXPEDICION", 5, "NO"], ["SAN LUIS", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["SAN LUIS DE CUBARRAL", "META", "5_REEXPEDICION", 5, "NO"], ["SAN LUIS DE GACENO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SAN LUIS DE PALENQUE", "CASANARE", "5_REEXPEDICION", 5, "NO"], ["SAN LUIS DE SINCE", "SUCRE", "5_REEXPEDICION", 4, "NO"], ["SAN MARCOS", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["SAN MARTIN", "CESAR", "5_REEXPEDICION", 5, "NO"], ["SAN MARTIN DE LOBA", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["SAN MATEO", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SAN MIGUEL DE SEMA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SAN ONOFRE", "SUCRE", "5_REEXPEDICION", 4, "NO"], ["SAN PABLO", "BOLIVAR", "5_REEXPEDICION", 7, "NO"], ["SAN PABLO", "NARINO", "5_REEXPEDICION", 5, "NO"], ["SAN PABLO DE BORBUR", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SAN PEDRO", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["SAN PEDRO DE CARTAGO", "NARINO", "5_REEXPEDICION", 5, "NO"], ["SAN PEDRO DE LOS MILAGROS", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["SAN PELAYO", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["SAN RAFAEL", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["SAN ROQUE", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["SAN SEBASTIAN", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["SAN SEBASTIAN DE BUENAVIS", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["SAN SEBASTIAN DE MARIQUIT", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["SAN VICENTE DE CHUCURI", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["SAN VICENTE DEL CAGUAN", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["SAN VICENTE FERRER", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["SAN ZENON", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["SANDONA", "NARINO", "5_REEXPEDICION", 5, "NO"], ["SANTA ANA", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["SANTA BARBARA", "NARINO", "5_REEXPEDICION", 5, "NO"], ["SANTA CATALINA", "BOLIVAR", "5_REEXPEDICION", 3, "NO"], ["SANTA FE DE ANTIOQUIA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["SANTA HELENA DEL OPON", "SANTANDER", "5_REEXPEDICION", 5, "NO"], ["SANTA ISABEL", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["SANTA LUCIA", "ATLANTICO", "5_REEXPEDICION", 3, "NO"], ["SANTA MARIA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["SANTA MARIA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SANTA ROSA", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["SANTA ROSA DE LIMA", "BOLIVAR", "5_REEXPEDICION", 8, "NO"], ["SANTA ROSA DE OSOS", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["SANTA ROSA DE VITERBO", "BOYACA", "5_REEXPEDICION", 5, "NO"], ["SANTA ROSA DEL SUR", "BOLIVAR", "5_REEXPEDICION", 8, "NO"], ["SANTA SOFIA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SANTACRUZ", "NARINO", "5_REEXPEDICION", 5, "NO"], ["SANTANA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SANTIAGO", "PUTUMAYO", "5_REEXPEDICION", 8, "NO"], ["SANTIAGO DE TOLU", "SUCRE", "5_REEXPEDICION", 4, "NO"], ["SANTO TOMAS", "ATLANTICO", "5_REEXPEDICION", 3, "NO"], ["SANTUARIO", "RISARALDA", "5_REEXPEDICION", 8, "NO"], ["SAPUYES", "NARINO", "5_REEXPEDICION", 5, "NO"], ["SARAVENA", "ARAUCA", "5_REEXPEDICION", 9, "NO"], ["SARDINATA", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["SATIVANORTE", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SATIVASUR", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SEGOVIA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["SEVILLA", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["SIACHOQUE", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SILOS", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["SILVIA", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["SIMACOTA", "SANTANDER", "5_REEXPEDICION", 7, "NO"], ["SIMIJACA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["SIMITI", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["SITIONUEVO", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["SOATA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SOCHA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SOCORRO", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["SOCOTA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["SOLANO", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["SOLITA", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["SOMONDOCO", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["SOPETRAN", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["SOPLAVIENTO", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["SORA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["SOTAQUIRA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["SOTARA", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["SUAITA", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["SUAN", "ATLANTICO", "5_REEXPEDICION", 3, "NO"], ["SUAREZ", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["SUAREZ", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["SUAZA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["SUCRE", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["SUCRE", "SUCRE", "5_REEXPEDICION", 5, "NO"], ["SUPATA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["SUPIA", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["SURATA", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["SUSACON", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["SUTAMARCHAN", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["SUTATENZA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TADO", "CHOCO", "5_REEXPEDICION", 5, "NO"], ["TALAIGUA NUEVO", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["TAMALAMEQUE", "CESAR", "5_REEXPEDICION", 5, "NO"], ["TAMARA", "CASANARE", "5_REEXPEDICION", 5, "NO"], ["TAME", "ARAUCA", "5_REEXPEDICION", 9, "NO"], ["TAMINANGO", "NARINO", "5_REEXPEDICION", 5, "NO"], ["TANGUA", "NARINO", "5_REEXPEDICION", 5, "NO"], ["TARAZA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["TARQUI", "HUILA", "5_REEXPEDICION", 7, "NO"], ["TASCO", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TAURAMENA", "CASANARE", "5_REEXPEDICION", 4, "NO"], ["TELLO", "HUILA", "5_REEXPEDICION", 7, "NO"], ["TENERIFE", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["TENZA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TEORAMA", "NORTE DE SANTANDER", "5_REEXPEDICION", 8, "NO"], ["TERUEL", "HUILA", "5_REEXPEDICION", 7, "NO"], ["TESALIA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["TIBANA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TIBU", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["TIERRALTA", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["TIMANA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["TIMBIO", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["TIMBIQUI", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["TINJACA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TIPACOQUE", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TIQUISIO", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["TOCA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TOGUI", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TOLEDO", "NORTE DE SANTANDER", "5_REEXPEDICION", 5, "NO"], ["TOLU VIEJO", "SUCRE", "5_REEXPEDICION", 4, "NO"], ["TONA", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["TOPAGA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TOPAIPI", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["TORIBIO", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["TORO", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["TOTA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TOTORO", "CAUCA", "5_REEXPEDICION", 4, "NO"], ["TRINIDAD", "CASANARE", "5_REEXPEDICION", 4, "NO"], ["TUBARA", "ATLANTICO", "5_REEXPEDICION", 3, "NO"], ["TUCHIN", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["TUNUNGUA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TUQUERRES", "NARINO", "5_REEXPEDICION", 5, "NO"], ["TURBANA", "BOLIVAR", "5_REEXPEDICION", 3, "NO"], ["TURBO", "ANTIOQUIA", "5_REEXPEDICION", 4, "NO"], ["TURMEQUE", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["TUTAZA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["UBALA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["ULLOA", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["UMBITA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["URAMITA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["URIBE", "META", "5_REEXPEDICION", 6, "NO"], ["URIBIA", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["URRAO", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["URUMITA", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["USIACURI", "ATLANTICO", "5_REEXPEDICION", 3, "NO"], ["UTICA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["VALDIVIA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["VALENCIA", "CORDOBA", "5_REEXPEDICION", 5, "NO"], ["VALLE DE SAN JOSE", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["VALLE DE SAN JUAN", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["VALPARAISO", "CAQUETA", "5_REEXPEDICION", 9, "NO"], ["VEGACHI", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["VELEZ", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["VENADILLO", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["VENECIA", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["VENTAQUEMADA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["VERSALLES", "VALLE DEL CAUCA", "5_REEXPEDICION", 4, "NO"], ["VETAS", "SANTANDER", "5_REEXPEDICION", 8, "NO"], ["VICTORIA", "CALDAS", "5_REEXPEDICION", 8, "NO"], ["VILLA DE LEYVA", "BOYACA", "5_REEXPEDICION", 7, "NO"], ["VILLA HERMOSA", "ANTIOQUIA", "5_REEXPEDICION", 5, "NO"], ["VILLAGARZON", "PUTUMAYO", "5_REEXPEDICION", 4, "NO"], ["VILLAGOMEZ", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["VILLAHERMOSA", "TOLIMA", "5_REEXPEDICION", 7, "NO"], ["VILLANUEVA", "CASANARE", "5_REEXPEDICION", 3, "NO"], ["VILLANUEVA", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["VILLANUEVA", "LA GUAJIRA", "5_REEXPEDICION", 5, "NO"], ["VILLANUEVA", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["VILLAVIEJA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["VIRACACHA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["VITERBO", "CALDAS", "5_REEXPEDICION", 3, "NO"], ["YACOPI", "CUNDINAMARCA", "5_REEXPEDICION", 8, "NO"], ["YACUANQUER", "NARINO", "5_REEXPEDICION", 5, "NO"], ["YAGUARA", "HUILA", "5_REEXPEDICION", 7, "NO"], ["YALI", "ANTIOQUIA", "5_REEXPEDICION", 5, "NO"], ["YARUMAL", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["YOLOMBO", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["YONDO", "ANTIOQUIA", "5_REEXPEDICION", 5, "NO"], ["YOTOCO", "VALLE DEL CAUCA", "5_REEXPEDICION", 3, "NO"], ["YUTO", "CHOCO", "5_REEXPEDICION", 5, "NO"], ["ZAMBRANO", "BOLIVAR", "5_REEXPEDICION", 5, "NO"], ["ZAPATOCA", "SANTANDER", "5_REEXPEDICION", 4, "NO"], ["ZARAGOZA", "ANTIOQUIA", "5_REEXPEDICION", 3, "NO"], ["ZETAQUIRA", "BOYACA", "5_REEXPEDICION", 6, "NO"], ["ZONA BANANERA", "MAGDALENA", "5_REEXPEDICION", 5, "NO"], ["ABEJORRAL", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["ABRIAQUI", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["ALEJANDRIA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["ANGELOPOLIS", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["ANGOSTURA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["ANORI", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["ANZA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["ARAUQUITA", "ARAUCA", "6_REEXPEDICION 2", 9, "NO"], ["ARGELIA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["ARIGUANI", "MAGDALENA", "6_REEXPEDICION 2", 8, "NO"], ["ARROYO DE PIEDRA", "ATLANTICO", "6_REEXPEDICION 2", 7, "NO"], ["BAGADO", "CHOCO", "6_REEXPEDICION 2", 11, "NO"], ["BAHIA SOLANO", "CHOCO", "6_REEXPEDICION 2", 11, "NO"], ["BAJO BAUDO", "CHOCO", "6_REEXPEDICION 2", 7, "NO"], ["BELMIRA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["BETANIA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["BETULIA", "SANTANDER", "6_REEXPEDICION 2", 8, "NO"], ["BOJAYA", "CHOCO", "6_REEXPEDICION 2", 11, "NO"], ["CACHIRA", "NORTE DE SANTANDER", "6_REEXPEDICION 2", 8, "NO"], ["CAICEDO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["CAIDEDO", "ANTIOQUIA", "6_REEXPEDICION 2", 8, "NO"], ["CAMPAMENTO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["CAMPECHE", "ATLANTICO", "6_REEXPEDICION 2", 5, "NO"], ["CARACOLI", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["CARAMANTA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["CASABIANCA", "TOLIMA", "6_REEXPEDICION 2", 8, "NO"], ["CIUDAD BOLIVAR", "ANTIOQUIA", "6_REEXPEDICION 2", 8, "NO"], ["COCORNA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["CONCEPCION", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["CORINTO", "CAUCA", "6_REEXPEDICION 2", 8, "NO"], ["CRAVO NORTE", "ARAUCA", "6_REEXPEDICION 2", 9, "NO"], ["CUMARIBO", "VICHADA", "6_REEXPEDICION 2", 9, "NO"], ["EBEJICO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["EL CARMEN DE CHUCURI", "SANTANDER", "6_REEXPEDICION 2", 8, "NO"], ["EL CARMEN DE CHUCURI", "SANTANDER", "6_REEXPEDICION 2", 8, "NO"], ["FORTUL", "ARAUCA", "6_REEXPEDICION 2", 9, "NO"], ["FRANCISCO PIZARRO", "NARINO", "6_REEXPEDICION 2", 8, "NO"], ["GIRALDO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["GRANADA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["GUAMAL", "META", "6_REEXPEDICION 2", 5, "NO"], ["GUAPI", "CAUCA", "6_REEXPEDICION 2", 8, "NO"], ["GUARINOCITO", "CALDAS", "6_REEXPEDICION 2", 4, "NO"], ["HACARI", "NORTE DE SANTANDER", "6_REEXPEDICION 2", 8, "NO"], ["HELICONIA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["HERVEO", "TOLIMA", "6_REEXPEDICION 2", 8, "NO"], ["INIRIDA", "GUAINIA", "6_REEXPEDICION 2", 9, "NO"], ["ITUANGO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["JERICO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["LA ESPERANZA", "NORTE DE SANTANDER", "6_REEXPEDICION 2", 8, "NO"], ["LA HORMIGA", "PUTUMAYO", "6_REEXPEDICION 2", 9, "NO"], ["LA HORMIGA", "PUTUMAYO", "6_REEXPEDICION 2", 8, "NO"], ["LA JAGUA DE IBIRICO", "CESAR", "6_REEXPEDICION 2", 5, "NO"], ["LA LOMA", "CESAR", "6_REEXPEDICION 2", 8, "NO"], ["LA MESA DE LOS SANTOS", "SANTANDER", "6_REEXPEDICION 2", 4, "NO"], ["LA PRIMAVERA", "VICHADA", "6_REEXPEDICION 2", 9, "NO"], ["LA UNION", "NARINO", "6_REEXPEDICION 2", 8, "NO"], ["LEIVA", "NARINO", "6_REEXPEDICION 2", 8, "NO"], ["LEIVA", "NARINO", "6_REEXPEDICION 2", 8, "NO"], ["LEJANIAS", "META", "6_REEXPEDICION 2", 6, "NO"], ["LETICIA", "AMAZONAS", "6_REEXPEDICION 2", 4, "NO"], ["LIBORINA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["LOPEZ DE MICAY", "CAUCA", "6_REEXPEDICION 2", 8, "NO"], ["LOURDES", "NORTE DE SANTANDER", "6_REEXPEDICION 2", 8, "NO"], ["MACEO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["MAPIRIPAN", "META", "6_REEXPEDICION 2", 6, "NO"], ["MEDIO BAUDO", "CHOCO", "6_REEXPEDICION 2", 7, "NO"], ["MITU", "VAUPES", "6_REEXPEDICION 2", 9, "NO"], ["MOMPOS", "BOLIVAR", "6_REEXPEDICION 2", 5, "NO"], ["MONTEBELLO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["MUZO", "BOYACA", "6_REEXPEDICION 2", 7, "NO"], ["NARINO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["NOVITA", "CHOCO", "6_REEXPEDICION 2", 11, "NO"], ["OLAYA", "ANTIOQUIA", "6_REEXPEDICION 2", 4, "NO"], ["ORITO", "PUTUMAYO", "6_REEXPEDICION 2", 9, "NO"], ["PALOCABILDO", "TOLIMA", "6_REEXPEDICION 2", 8, "NO"], ["PENSILVANIA", "CALDAS", "6_REEXPEDICION 2", 8, "NO"], ["PEQUE", "ANTIOQUIA", "6_REEXPEDICION 2", 4, "NO"], ["PLANADAS", "TOLIMA", "6_REEXPEDICION 2", 8, "NO"], ["POLICARPA", "NARINO", "6_REEXPEDICION 2", 8, "NO"], ["PRADO", "TOLIMA", "6_REEXPEDICION 2", 8, "NO"], ["PROVIDENCIA", "SAN ANDRES", "6_REEXPEDICION 2", 4, "NO"], ["PUEBLORRICO", "ANTIOQUIA", "6_REEXPEDICION 2", 4, "NO"], ["PUERTO CARRENO", "VICHADA", "6_REEXPEDICION 2", 9, "NO"], ["PUERTO LEGUIZAMO", "PUTUMAYO", "6_REEXPEDICION 2", 8, "NO"], ["PUERTO LOPEZ", "META", "6_REEXPEDICION 2", 5, "NO"], ["PUERTO NACIONAL", "SANTANDER", "6_REEXPEDICION 2", 8, "NO"], ["PUERTO NARE", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["PUERTO NARINO", "AMAZONAS", "6_REEXPEDICION 2", 9, "NO"], ["PUERTO PARRA", "SANTANDER", "6_REEXPEDICION 2", 8, "NO"], ["PUERTO RICO", "CAQUETA", "6_REEXPEDICION 2", 9, "NO"], ["PUERTO RICO", "META", "6_REEXPEDICION 2", 8, "NO"], ["PUERTO RONDON", "ARAUCA", "6_REEXPEDICION 2", 9, "NO"], ["PUERTO TRIUNFO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["RICAURTE", "CUNDINAMARCA", "6_REEXPEDICION 2", 9, "NO"], ["SABANALARGA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["SABANALARGA", "CASANARE", "6_REEXPEDICION 2", 8, "NO"], ["SALAMINA", "MAGDALENA", "6_REEXPEDICION 2", 8, "NO"], ["SAMANIEGO", "NARINO", "6_REEXPEDICION 2", 8, "NO"], ["SAN ANDRES", "SAN ANDRES", "6_REEXPEDICION 2", 4, "NO"], ["SAN ANDRES", "ANTIOQUIA", "6_REEXPEDICION 2", 8, "NO"], ["SAN ANDRES DE CUERQUIA", "ANTIOQUIA", "6_REEXPEDICION 2", 4, "NO"], ["SAN FRANCISCO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["SAN JACINTO", "BOLIVAR", "6_REEXPEDICION 2", 5, "NO"], ["SAN JOSE DE LA MONTANA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["SAN JUAN DE URABA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["SAN JUAN NEPOMUCENO", "BOLIVAR", "6_REEXPEDICION 2", 5, "NO"], ["SAN LUIS", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["SAN MARTIN DE LOS LLANOS", "META", "6_REEXPEDICION 2", 8, "NO"], ["SAN MIGUEL", "PUTUMAYO", "6_REEXPEDICION 2", 12, "NO"], ["SAN PEDRO DE URABA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["SANTA BARBARA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["SANTA ROSALIA", "VICHADA", "6_REEXPEDICION 2", 9, "NO"], ["SANTO DOMINGO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["SIBUNDOY", "PUTUMAYO", "6_REEXPEDICION 2", 8, "NO"], ["SINCE", "SUCRE", "6_REEXPEDICION 2", 7, "NO"], ["SONSON", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["TAMESIS", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["TARSO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["TITIRIBI", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["TOLEDO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["TUCURINCA", "MAGDALENA", "6_REEXPEDICION 2", 8, "NO"], ["TUMACO", "NARINO", "6_REEXPEDICION 2", 7, "NO"], ["VALLE DEL GUAMUEZ", "PUTUMAYO", "6_REEXPEDICION 2", 5, "NO"], ["VALPARAISO", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["VENECIA", "ANTIOQUIA", "6_REEXPEDICION 2", 3, "NO"], ["VIGIA DEL FUERTE", "ANTIOQUIA", "6_REEXPEDICION 2", 8, "NO"], ["VILLA CARO", "NORTE DE SANTANDER", "6_REEXPEDICION 2", 8, "NO"], ["VILLARRICA", "TOLIMA", "6_REEXPEDICION 2", 8, "NO"], ["VISTAHERMOSA", "META", "6_REEXPEDICION 2", 5, "NO"]]};

const CLAVE_RESPUESTAS_V52='config/respuestas-sofia-v52.json';
async function respuestasSofiaV52(request,env,origin) {
  if(!ORIGENES_PERMITIDOS.has(origin))return responder(origin,{error:'Origen no autorizado'},403);
  if(!env.PAGOS)return responder(origin,{error:'Almacenamiento no configurado'},503);
  let stored={};const obj=await env.PAGOS.get(CLAVE_RESPUESTAS_V52);if(obj)try{stored=await obj.json();}catch{}
  if(request.method==='GET')return responder(origin,{ok:true,respuestas:{...RESPUESTAS_SOFIA_V52,...stored}});
  const actor=await autenticarStaff(request);
  if(actor?.uid!=='F2SHGFQYSuMWlkbQKV8yrKAXgaH3')return responder(origin,{error:'Sólo Yohana puede editar las respuestas'},403);
  let body;try{body=await request.json();}catch{return responder(origin,{error:'JSON inválido'},400);}
  const next={};
  for(const [key,def]of Object.entries(RESPUESTAS_SOFIA_V52)) {
    const value=body.restaurar===true?def:body.respuestas?.[key];
    if(typeof value!=='string'||!value.trim()||value.length>800)return responder(origin,{error:'Texto inválido: '+key},400);
    const required=[...def.matchAll(/\{([a-z]+)\}/g)].map(m=>m[1]);
    const variables=[...value.matchAll(/\{([^{}]+)\}/g)].map(m=>m[1]);
    if(required.some(v=>!variables.includes(v))||variables.some(v=>!required.includes(v))||/[0-9]|<|>/.test(value))return responder(origin,{error:'Conserva los campos entre llaves; las cifras se calculan automáticamente: '+key},400);
    next[key]=value.trim();
  }
  await env.PAGOS.put(CLAVE_RESPUESTAS_V52,JSON.stringify(next),{httpMetadata:{contentType:'application/json; charset=utf-8'}});
  return responder(origin,{ok:true,respuestas:next});
}
function carrierCierreV52(value) {
  const q=normalizarCiudadEnvio(value).replace(/ /g,'');
  return ['23MM','23MYM'].includes(q)?'23M&M':q==='INTERRAPIDISIMO'?'Interrapidísimo':null;
}
async function cotizarCierreV52(env,cliente,subtotal,modo) {
  if(!['anticipado','contraentrega'].includes(modo))throw Error('Selecciona pago anticipado o contraentrega.');
  if(/\b(VEREDA|RURAL|FINCA)\b/.test(normalizarCiudadEnvio(cliente.ciudad+' '+cliente.direccion)))throw Error('Una asesora debe cotizar el envío a vereda.');
  const city=normalizarCiudadEnvio(cliente.ciudad),dept=normalizarDepartamentoEnvio(cliente.departamento);
  const rows=MATRIZ_CIERRE_V52.destinations.filter(r=>normalizarCiudadEnvio(r[0])===city&&normalizarDepartamentoEnvio(r[1])===dept);
  const row=rows.length&&rows.every(r=>r[2]===rows[0][2]&&r[4]===rows[0][4])?rows[0]:null;
  const eligible=row&&!/^5_|^6_/.test(String(row[2]))&&(modo==='anticipado'||row[4]==='SI');
  const rates=await cargarTarifasEnvioPersonalizadas(env),custom=rates[claveTarifaEnvio(dept,city)],options=[];
  if(eligible&&!(custom&&carrierCierreV52(custom.transportadora)==='23M&M'&&custom.contraentrega===false&&modo==='contraentrega')) {
    const route=MATRIZ_CIERRE_V52.routes.find(r=>r[0]===row[2]),divisor=route[5]==='SI'?1.20:1;
    options.push({transportadora:'23M&M',envio:Math.round(Number(route[2])/divisor)+Math.round(Math.max(300,Number(route[4]))/divisor)});
  }
  if(custom&&carrierCierreV52(custom.transportadora)&&(modo==='anticipado'||custom.contraentrega===true)) {
    const envio=Number(custom.valor);
    if(!Number.isSafeInteger(envio)||envio<0||envio>100000)throw Error('La tarifa necesita revisión.');
    const carrier=carrierCierreV52(custom.transportadora);
    const prior=options.findIndex(o=>o.transportadora===carrier);if(prior>=0)options.splice(prior,1);
    options.push({transportadora:carrier,envio});
  }
  if(!options.length)throw Error('Una asesora debe confirmar tarifa y cobertura para este destino.');
  const quotes=options.map(option=>{
    const porcentaje=modo==='contraentrega'?(option.transportadora==='Interrapidísimo'?0.07:0.014):0;
    const comision=Math.round(subtotal*porcentaje);
    return {...option,porcentaje,comision,subtotal,total:subtotal+option.envio+comision,modo};
  });
  quotes.sort((a,b)=>a.total-b.total);
  return quotes[0];
}

const CLAVE_TARIFAS_ENVIO = 'config/tarifas-envio.json';
const TRANSPORTADORAS_PERMITIDAS = new Set(['23M&M', 'Envía', 'Interrapidísimo']);

async function cargarTarifasEnvioPersonalizadas(env) {
  if (!env.PAGOS) return {};
  const objeto = await env.PAGOS.get(CLAVE_TARIFAS_ENVIO);
  if (!objeto) return {};
  try {
    const datos = await objeto.json();
    return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {};
  } catch {
    return {};
  }
}

async function calcularEnvioSeguro(ciudadIngresada, departamentoIngresado, env) {
  const ciudad = normalizarCiudadEnvio(ciudadIngresada);
  const departamento = normalizarDepartamentoEnvio(departamentoIngresado);
  if (!ciudad) throw new Error('La ciudad de envio es obligatoria');
  if (!departamento) throw new Error('El departamento de envio es obligatorio');
  const tarifasPersonalizadas = await cargarTarifasEnvioPersonalizadas(env);
  const personalizada = tarifasPersonalizadas[claveTarifaEnvio(departamento, ciudad)];
  if (personalizada) {
    const valor = Number(personalizada.valor);
    const transportadora = String(personalizada.transportadora || '');
    if (Number.isSafeInteger(valor) && valor >= 0 && valor <= 100000 &&
        TRANSPORTADORAS_PERMITIDAS.has(transportadora)) {
      return {
        ciudad,
        departamento,
        transportadora,
        trayecto: 'Tarifa personalizada',
        valor,
        personalizada: true
      };
    }
  }
  if (CIUDADES_23MYM_URBANO.has(ciudad)) {
    return { ciudad, departamento, transportadora: '23M&M', trayecto: 'Urbano', valor: 9000 };
  }
  if (CIUDADES_23MYM_REGIONAL.has(ciudad)) {
    return { ciudad, departamento, transportadora: '23M&M', trayecto: 'Regional', valor: 11500 };
  }
  if (CIUDADES_23MYM_NACIONAL.has(ciudad)) {
    return { ciudad, departamento, transportadora: '23M&M', trayecto: 'Nacional principal', valor: 18500 };
  }
  if (CIUDADES_23MYM_NACIONAL_2.has(ciudad)) {
    return { ciudad, departamento, transportadora: '23M&M', trayecto: 'Nacional secundaria', valor: 20900 };
  }
  if (CIUDADES_REGIONALES_ALTERNAS.has(ciudad)) {
    return { ciudad, departamento, transportadora: 'Envía o Interrapidísimo', trayecto: 'Regional', valor: 11500 };
  }
  return { ciudad, departamento, transportadora: 'Interrapidísimo', trayecto: 'Nacional por confirmar', valor: 18500 };
}

async function administrarTarifasEnvio(request, env, origin) {
  if (!ORIGENES_PERMITIDOS.has(origin)) {
    return responder(origin, { error: 'Origen no autorizado' }, 403);
  }
  if (!env.PAGOS || !env.TARIFAS_ADMIN_SECRET) {
    return responder(origin, { error: 'La administración de tarifas no está configurada' }, 503);
  }
  const secreto = request.headers.get('X-Admin-Secret') || '';
  if (!comparacionSegura(secreto, env.TARIFAS_ADMIN_SECRET)) {
    return responder(origin, { error: 'Clave administrativa incorrecta' }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return responder(origin, { error: 'Solicitud JSON inválida' }, 400);
  }

  const accion = String(body.accion || 'guardar');
  if(accion==='completar-base') {
    const tarifas=await cargarTarifasEnvioPersonalizadas(env);
    let agregadas=0;
    for(const tarifa of TARIFAS_INICIALES_V49) {
      const clave=claveTarifaEnvio(tarifa.departamento,tarifa.ciudad);
      if(Object.hasOwn(tarifas,clave))continue;
      tarifas[clave]={...tarifa,actualizadoEn:new Date().toISOString()};agregadas++;
    }
    await env.PAGOS.put(CLAVE_TARIFAS_ENVIO,JSON.stringify(tarifas),{httpMetadata:{contentType:'application/json; charset=utf-8'}});
    return responder(origin,{ok:true,tarifas,agregadas});
  }

  if (accion === 'eliminar-anterior') {
    const claveAnterior = normalizarCiudadEnvio(body.claveAnterior);
    if (!claveAnterior) {
      return responder(origin, { error: 'Registro anterior inválido' }, 400);
    }
    const tarifasAnteriores = await cargarTarifasEnvioPersonalizadas(env);
    delete tarifasAnteriores[claveAnterior];
    await env.PAGOS.put(CLAVE_TARIFAS_ENVIO, JSON.stringify(tarifasAnteriores), {
      httpMetadata: { contentType: 'application/json; charset=utf-8' }
    });
    return responder(origin, { ok: true, tarifas: tarifasAnteriores });
  }
  const ciudad = normalizarCiudadEnvio(body.ciudad);
  const departamento = normalizarDepartamentoEnvio(body.departamento);
  if (!ciudad || ciudad.length > 80) {
    return responder(origin, { error: 'Ciudad inválida' }, 400);
  }
  if (!departamento || departamento.length > 80) {
    return responder(origin, { error: 'Departamento inválido' }, 400);
  }
  const claveTarifa = claveTarifaEnvio(departamento, ciudad);

  const tarifas = await cargarTarifasEnvioPersonalizadas(env);
  if (accion === 'eliminar') {
    delete tarifas[claveTarifa];
  } else {
    const transportadora = String(body.transportadora || '').trim();
    const valor = Number(body.valor);
    if (!TRANSPORTADORAS_PERMITIDAS.has(transportadora)) {
      return responder(origin, { error: 'Transportadora inválida' }, 400);
    }
    if (!Number.isSafeInteger(valor) || valor < 0 || valor > 100000) {
      return responder(origin, { error: 'Valor de envío inválido' }, 400);
    }
    tarifas[claveTarifa] = {
      ciudad: String(body.ciudad || ciudad).trim().slice(0, 80),
      departamento: String(body.departamento || departamento).trim().slice(0, 80),
      transportadora,
      valor,
      contraentrega: body.contraentrega === true,
      actualizadoEn: new Date().toISOString()
    };
  }

  await env.PAGOS.put(CLAVE_TARIFAS_ENVIO, JSON.stringify(tarifas), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' }
  });
  return responder(origin, { ok: true, tarifas });
}

function crearReferenciaPago() {
  const aleatorio = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  return ('SK' + Date.now().toString(36) + aleatorio).toUpperCase();
}

async function crearTokenSeguimiento(env, identificador) {
  if (!env.SEGUIMIENTO_SECRET || String(env.SEGUIMIENTO_SECRET).length < 32) {
    throw new Error('Falta configurar SEGUIMIENTO_SECRET');
  }
  const clave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(String(env.SEGUIMIENTO_SECRET)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const firma = await crypto.subtle.sign(
    'HMAC', clave,
    new TextEncoder().encode('seguimiento:' + String(identificador))
  );
  return base64Url(firma);
}

function enlaceSeguimiento(token) {
  return 'https://superkidsbabys.com/?seguimiento=' + encodeURIComponent(token);
}

function crearTokenSeguimientoAleatorio() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function prepararPagoSeguro(request, env, origin) {
  if (!ORIGENES_PERMITIDOS.has(origin)) {
    return responder(origin, { error: 'Origen no autorizado' }, 403);
  }
  if (
    !env.PAGOS ||
    !env.WOMPI_INTEGRITY_PROD ||
    !env.WOMPI_PUBLIC_KEY_PROD ||
    !env.WOMPI_INTEGRITY_PROD.startsWith('prod_integrity_') ||
    !env.WOMPI_PUBLIC_KEY_PROD.startsWith('pub_prod_')
  ) {
    return responder(origin, { error: 'El servicio de pagos de produccion no esta listo' }, 503);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return responder(origin, { error: 'Solicitud JSON invalida' }, 400);
  }

  const autorizacionDatos = registrarAutorizacionDatos(body.autorizacionDatos, origin);
  if (!autorizacionDatos) return responder(origin, { error: 'Debes aceptar la autorización de datos vigente para continuar.' }, 400);
  if (!await validarTurnstile(env, body.turnstileToken, origin)) {
    return responder(origin, {
      error: 'Verifica que eres una persona e intenta de nuevo'
    }, 403);
  }

  let cliente;
  try {
    cliente = validarClientePago(body.cliente);
  } catch (errorCliente) {
    return responder(origin, {
      error: errorCliente.message || 'Datos de envio invalidos'
    }, 400);
  }

  const solicitados = Array.isArray(body.items) ? body.items : [];
  if (!solicitados.length || solicitados.length > MAX_ITEMS_PAGO) {
    return responder(origin, { error: 'Cantidad de prendas invalida' }, 400);
  }

  const acumulados = new Map();
  for (const item of solicitados) {
    const id = String(item && item.id || '').trim();
    const talla = normalizarTalla(item && item.talla);
    const cantidad = Number(item && item.cantidad || 1);
    if (!/^p[0-9]{8,25}$/.test(id) || !Number.isSafeInteger(cantidad) ||
        cantidad < 1 || cantidad > 20 || talla.length > 30) {
      return responder(origin, { error: 'Una prenda del carrito es invalida' }, 400);
    }
    const clave = id + '::' + talla;
    const previo = acumulados.get(clave);
    if (previo) previo.cantidad += cantidad;
    else acumulados.set(clave, { id, talla, cantidad });
  }

  const productosPorId = new Map();
  await Promise.all([...new Set([...acumulados.values()].map(i => i.id))].map(async id => {
    productosPorId.set(id, await cargarProductoFirebase(id));
  }));

  const validados = [];
  for (const item of acumulados.values()) {
    const producto = productosPorId.get(item.id);
    if (!producto) {
      return responder(origin, { error: 'Una prenda ya no esta disponible' }, 409);
    }
    const precio = Number(producto.precio);
    if (!Number.isSafeInteger(precio) || precio < 1000 || precio > 5000000) {
      return responder(origin, { error: 'Una prenda tiene un precio invalido' }, 409);
    }
    const disponible = stockDisponible(producto, item.talla);
    if (item.cantidad > disponible) {
      return responder(origin, {
        error: 'Stock insuficiente para ' + String(producto.nombre || producto.codigo || item.id),
        disponible
      }, 409);
    }
    validados.push({
      id: item.id,
      talla: item.talla,
      cantidad: item.cantidad,
      precio,
      nombre: String(producto.nombre || ''),
      codigo: String(producto.codigo || ''),
      categoria: String(producto.categoria || ''),
      imagen: String(
        (Array.isArray(producto.imagenes) && producto.imagenes[0]) ||
        producto.img ||
        ''
      )
    });
  }

  let envio;
  try {
    envio = await calcularEnvioSeguro(body.ciudad, body.departamento, env);
  } catch (errorEnvio) {
    return responder(origin, { error: errorEnvio.message || 'Ciudad de envio invalida' }, 400);
  }
  const totalesPrendas = calcularPromocionMamelucos(validados);
  const totales = {
    ...totalesPrendas,
    totalPrendas: totalesPrendas.total,
    valorEnvio: envio.valor,
    total: totalesPrendas.total + envio.valor
  };
  const amountInCents = totales.total * 100;
  if (!Number.isSafeInteger(amountInCents) ||
      amountInCents < 100000 || amountInCents > 500000000) {
    return responder(origin, { error: 'El total calculado es invalido' }, 409);
  }

  const reference = crearReferenciaPago();
  let seguimientoToken;
  try {
    seguimientoToken = await crearTokenSeguimiento(env, 'wompi:' + reference);
  } catch {
    return responder(origin, { error: 'El seguimiento privado no está configurado' }, 503);
  }
  const seguimientoHash = await sha256(seguimientoToken);
  const integrity = await sha256(
    reference + amountInCents + MONEDA + env.WOMPI_INTEGRITY_PROD
  );
  const creadoEn = new Date().toISOString();
  const intencion = {
    autorizacionDatos,
    version: 2,
    ambiente: 'production',
    estado: 'CREATED',
    reference,
    amountInCents,
    currency: MONEDA,
    cliente,
    items: validados,
    totales,
    envio,
    asesora: validarAsesora(body.asesora),
    seguimientoHash,
    creadoEn,
    expiraEn: new Date(Date.now() + 30 * 60 * 1000).toISOString()
  };
  await env.PAGOS.put(
    'intenciones/' + reference + '.json',
    JSON.stringify(intencion),
    {
      httpMetadata: { contentType: 'application/json; charset=utf-8' },
      customMetadata: { ambiente: 'production', estado: 'CREATED' }
    }
  );

  return responder(origin, {
    ok: true,
    environment: 'production',
    publicKey: env.WOMPI_PUBLIC_KEY_PROD,
    reference,
    amountInCents,
    currency: MONEDA,
    integrity,
    items: validados,
    totales,
    envio,
    seguimientoToken,
    seguimientoUrl: enlaceSeguimiento(seguimientoToken)
  });
}

function valorPropiedad(objeto, ruta) {
  return String(ruta || '')
    .split('.')
    .reduce((valor, parte) => (
      valor !== null &&
      valor !== undefined &&
      Object.prototype.hasOwnProperty.call(Object(valor), parte)
        ? valor[parte]
        : undefined
    ), objeto);
}

function comparacionSegura(a, b) {
  const izquierda = String(a || '').toLowerCase();
  const derecha = String(b || '').toLowerCase();
  if (!izquierda || izquierda.length !== derecha.length) return false;
  let diferencia = 0;
  for (let i = 0; i < izquierda.length; i += 1) {
    diferencia |= izquierda.charCodeAt(i) ^ derecha.charCodeAt(i);
  }
  return diferencia === 0;
}

async function cargarIntencionPago(env, referencia) {
  const objeto = await env.PAGOS.get(
    'intenciones/' + encodeURIComponent(referencia) + '.json'
  );
  if (!objeto) return null;
  try {
    return JSON.parse(await objeto.text());
  } catch {
    throw new Error('La intencion privada del pago esta danada');
  }
}

function crearPedidoWompi(intencion, registro, numero, incidenciaPago = '') {
  const cliente = intencion.cliente || {};
  const totales = intencion.totales || {};
  const envio = intencion.envio || {};
  const ahora = new Date().toISOString();
  const pedido = {
    ...(intencion.autorizacionDatos ? { autorizacionDatos: intencion.autorizacionDatos } : {}),
    num: numero,
    numOrden: 'SK' + String(numero).padStart(5, '0'),
    nom: String(cliente.nombre || ''),
    cc: String(cliente.documento || ''),
    dir: String(cliente.direccion || ''),
    barrio: String(cliente.barrio || ''),
    departamento: String(cliente.departamento || ''),
    ciudad: String(cliente.ciudad || ''),
    tel: String(cliente.telefono || ''),
    correo: String(cliente.correo || ''),
    observaciones: String(cliente.observaciones || ''),
    tipoVenta: 'Pago Wompi',
    canalPago: 'Wompi',
    estado: 'nuevo',
    estadoPago: 'APPROVED',
    stockDescontado: true,
    stockDevuelto: false,
    tot: Number(totales.total || 0),
    totalPrendas: Number(totales.totalPrendas || totales.total || 0),
    valorEnvio: Number(totales.valorEnvio || 0),
    transportadora: String(envio.transportadora || ''),
    trayectoEnvio: String(envio.trayecto || ''),
    asesora: validarAsesora(intencion.asesora),
    seguimientoHash: String(intencion.seguimientoHash || ''),
    subtotalBruto: Number(totales.bruto || 0),
    cantidadPromoMamelucos: Number(totales.cantidadPromo || 0),
    descuentoPromocion: Number(totales.descuento || 0),
    items: (intencion.items || []).map(item => ({
      id_prod: String(item.id || ''),
      cant: Number(item.cantidad || 0),
      talla: String(item.talla || ''),
      nom: String(item.nombre || ''),
      cod: String(item.codigo || ''),
      precio: Number(item.precio || 0),
      categoria: String(item.categoria || ''),
      imagen: String(item.imagen || '')
    })),
    fecha: new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }),
    creadoEn: ahora,
    pagoVerificadoEn: ahora,
    wompiTransactionId: registro.id,
    referenciaPago: registro.referencia,
    metodoPago: registro.metodoPago,
    ambientePago: 'production'
  };
  if (incidenciaPago) return { ...pedido, incidenciaPago };
  return pedido;
}

function writeActualizarDocumento(coleccion, id, datos, updateTime, campos) {
  return {
    update: {
      name: nombreDocumentoFirestore(coleccion, id),
      fields: camposFirestore(datos)
    },
    updateMask: { fieldPaths: campos },
    currentDocument: { updateTime }
  };
}

function writeCrearDocumento(coleccion, id, datos) {
  return {
    update: {
      name: nombreDocumentoFirestore(coleccion, id),
      fields: camposFirestore(datos)
    },
    currentDocument: { exists: false }
  };
}

async function completarPagoAprobado(env, registro) {
  const intencion = await cargarIntencionPago(env, registro.referencia);
  if (!intencion) {
    throw new Error('No existe la intencion privada asociada al pago');
  }

  // Sandbox nunca toca pedidos ni inventario real.
  if (intencion.ambiente !== 'production') {
    return { completado: false, motivo: 'sandbox' };
  }
  if (
    intencion.estado !== 'CREATED' ||
    Number(intencion.amountInCents) !== registro.monto ||
    String(intencion.currency || '') !== registro.moneda ||
    String(intencion.reference || '') !== registro.referencia
  ) {
    throw new Error('El pago no coincide con la intencion privada');
  }

  const marcadorId = encodeURIComponent(registro.id);
  for (let intento = 1; intento <= 4; intento += 1) {
    const marcador = await leerDocumentoFirebaseAdmin(
      env, 'pagos_wompi', marcadorId
    );
    if (marcador) {
      return {
        completado: true,
        duplicado: true,
        numero: Number(marcador.data.numeroPedido || 0)
      };
    }

    const contador = await leerDocumentoFirebaseAdmin(
      env, 'contadores', 'pedidos'
    );
    const productosUnicos = [...new Set(
      (intencion.items || []).map(item => String(item.id || ''))
    )];
    const documentosProducto = new Map();
    await Promise.all(productosUnicos.map(async id => {
      documentosProducto.set(
        id,
        await leerDocumentoFirebaseAdmin(env, 'productos', id)
      );
    }));

    const porProducto = new Map();
    for (const item of intencion.items || []) {
      const id = String(item.id || '');
      if (!porProducto.has(id)) porProducto.set(id, []);
      porProducto.get(id).push(item);
    }

    let incidencia = '';
    const productosActualizados = new Map();
    for (const [id, items] of porProducto.entries()) {
      const documento = documentosProducto.get(id);
      if (!documento) {
        incidencia = 'PAGO_APROBADO_PRODUCTO_NO_ENCONTRADO';
        break;
      }
      const producto = documento.data;
      const tallas = Array.isArray(producto.tallasObj)
        ? producto.tallasObj.map(talla => ({ ...talla }))
        : [];
      for (const item of items) {
        const talla = tallas.find(
          actual => normalizarTalla(actual.nombre) === normalizarTalla(item.talla)
        );
        const cantidad = Number(item.cantidad || 0);
        if (!talla || cantidad < 1 || Number(talla.stock || 0) < cantidad) {
          incidencia = 'PAGO_APROBADO_SIN_STOCK';
          break;
        }
        talla.stock = Number(talla.stock || 0) - cantidad;
      }
      if (incidencia) break;
      productosActualizados.set(id, {
        tallasObj: tallas,
        stockTotal: tallas.reduce(
          (suma, talla) => suma + Math.max(0, Number(talla.stock || 0)), 0
        ),
        actualizadoEn: new Date().toISOString()
      });
    }

    const actual = Number(contador && contador.data.ultimo || 0);
    let numero = Math.max(0, Number.isSafeInteger(actual) ? actual : 0) + 1;

    // El contador puede quedar atrasado si antes se creó un pedido desde una
    // versión anterior del panel. Busca el siguiente número realmente libre
    // para que el commit atómico no repita cuatro veces el mismo documento.
    let numeroDisponible = false;
    for (let salto = 0; salto < 1000; salto += 1) {
      const pedidoConNumero = await leerDocumentoFirebaseAdmin(
        env,
        'pedidos',
        'pedido-' + numero
      );
      if (!pedidoConNumero) {
        numeroDisponible = true;
        break;
      }
      numero += 1;
    }
    if (!numeroDisponible) {
      return responder(origin, {
        error: 'No fue posible asignar un numero al pedido'
      }, 503);
    }
    const pedido = crearPedidoWompi(intencion, registro, numero, incidencia);
    const writes = [];

    if (!incidencia) {
      for (const [id, datos] of productosActualizados.entries()) {
        const documento = documentosProducto.get(id);
        writes.push(writeActualizarDocumento(
          'productos',
          id,
          datos,
          documento.updateTime,
          ['tallasObj', 'stockTotal', 'actualizadoEn']
        ));
      }
    }

    if (contador) {
      writes.push(writeActualizarDocumento(
        'contadores',
        'pedidos',
        { ultimo: numero },
        contador.updateTime,
        ['ultimo']
      ));
    } else {
      writes.push(writeCrearDocumento('contadores', 'pedidos', { ultimo: numero }));
    }
    writes.push(writeCrearDocumento(
      'pedidos',
      'pedido-' + numero,
      pedido
    ));
    if (pedido.seguimientoHash) {
      writes.push(writeCrearDocumento('seguimiento_pedidos', pedido.seguimientoHash, {
        numeroPedido: numero,
        creadoEn: new Date().toISOString()
      }));
    }
    writes.push(writeCrearDocumento('pagos_wompi', marcadorId, {
      transactionId: registro.id,
      referencia: registro.referencia,
      numeroPedido: numero,
      estado: incidencia ? 'INCIDENCIA' : 'COMPLETADO',
      incidenciaPago: incidencia,
      creadoEn: new Date().toISOString()
    }));

    try {
      await commitFirebaseAdmin(env, writes);
      await actualizarProductosCatalogoPublico(env, [...productosActualizados.keys()]);
      await env.PAGOS.put(
        'intenciones/' + encodeURIComponent(registro.referencia) + '.json',
        JSON.stringify({
          ...intencion,
          estado: incidencia ? 'INCIDENCIA' : 'COMPLETED',
          numeroPedido: numero,
          wompiTransactionId: registro.id,
          incidenciaPago: incidencia,
          completadoEn: new Date().toISOString()
        }),
        {
          httpMetadata: { contentType: 'application/json; charset=utf-8' },
          customMetadata: {
            ambiente: 'production',
            estado: incidencia ? 'INCIDENCIA' : 'COMPLETED'
          }
        }
      );
      return { completado: true, duplicado: false, numero, incidencia };
    } catch (error) {
      const reintentable = error instanceof Error &&
        Boolean(Reflect.get(error, 'reintentable'));
      if (!reintentable || intento === 4) throw error;
    }
  }
  throw new Error('No fue posible completar el pago de forma atomica');
}

async function recibirEventoWompi(request, env) {
  if (!env.WOMPI_EVENTS_PROD || !env.WOMPI_EVENTS_PROD.startsWith('prod_events_')) {
    return responder('', { error: 'El secreto de eventos de produccion no esta configurado' }, 503);
  }
  if (!env.PAGOS) {
    return responder('', { error: 'El almacenamiento privado de pagos no esta conectado' }, 503);
  }

  let evento;
  try {
    evento = await request.json();
  } catch {
    return responder('', { error: 'Evento JSON invalido' }, 400);
  }

  const firma = evento && evento.signature;
  const propiedades = firma && firma.properties;
  const checksumRecibido = String(
    request.headers.get('X-Event-Checksum') ||
    (firma && firma.checksum) ||
    ''
  ).trim();

  if (!evento || !evento.data || !Array.isArray(propiedades) ||
      !propiedades.length || !Number.isSafeInteger(evento.timestamp) ||
      !/^[a-fA-F0-9]{64}$/.test(checksumRecibido)) {
    return responder('', { error: 'Estructura de evento invalida' }, 400);
  }

  let concatenado = '';
  for (const propiedad of propiedades) {
    const valor = valorPropiedad(evento.data, propiedad);
    if (valor === undefined || valor === null) {
      return responder('', { error: 'Propiedad firmada ausente' }, 400);
    }
    concatenado += String(valor);
  }

  concatenado += String(evento.timestamp);
  concatenado += env.WOMPI_EVENTS_PROD;
  const checksumCalculado = await sha256(concatenado);

  if (!comparacionSegura(checksumCalculado, checksumRecibido)) {
    return responder('', { error: 'Firma de evento invalida' }, 401);
  }

  const transaccion = evento.data.transaction || {};
  const registro = {
    tipo: 'evento_wompi_verificado',
    evento: String(evento.event || ''),
    id: String(transaccion.id || ''),
    referencia: String(transaccion.reference || ''),
    estado: String(transaccion.status || ''),
    monto: Number(transaccion.amount_in_cents || 0),
    moneda: String(transaccion.currency || ''),
    metodoPago: String(transaccion.payment_method_type || ''),
    creadoEnWompi: String(transaccion.created_at || ''),
    finalizadoEnWompi: String(transaccion.finalized_at || ''),
    recibidoEn: new Date().toISOString(),
    timestampEvento: evento.timestamp
  };

  if (!registro.id || !registro.referencia) {
    return responder('', { error: 'La transaccion del evento esta incompleta' }, 400);
  }

  const clave = 'eventos/' + encodeURIComponent(registro.id) + '.json';
  await env.PAGOS.put(clave, JSON.stringify(registro), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
    customMetadata: {
      estado: registro.estado.slice(0, 32),
      referencia: registro.referencia.slice(0, 80)
    }
  });

  console.log(JSON.stringify(registro));

  /** @type {any} */
  let resultado = { completado: false, motivo: 'estado_no_aprobado' };
  if (registro.estado === 'APPROVED') {
    try {
      resultado = await completarPagoAprobado(env, registro);
    } catch (error) {
      console.error('Finalizacion segura Wompi', registro.id, error);
      // Un 500 hace que Wompi vuelva a intentar el evento. La operacion en
      // Firestore es atomica e idempotente, por lo que nunca duplica pedidos.
      return responder('', {
        error: 'No fue posible completar el pedido de forma segura'
      }, 500);
    }
  }
  return responder('', {
    ok: true,
    verified: true,
    stored: true,
    fulfillment: resultado
  });
}

async function crearPedidoContraentregaSeguro(request, env, origin, actorBot = null) {
  if (!actorBot && !ORIGENES_PERMITIDOS.has(origin)) {
    return responder(origin, { error: 'Origen no autorizado' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return responder(origin, { error: 'Solicitud JSON invalida' }, 400);
  }

  // El catálogo público usa Turnstile. El panel interno usa el token de
  // Firebase de cada integrante del equipo y entra a la misma transacción.
  const actorEquipo = actorBot || (request.headers.get('Authorization')
    ? await autenticarStaff(request)
    : null);
  const autorizacionDatos = actorEquipo ? null : registrarAutorizacionDatos(body.autorizacionDatos, origin);
  if (!actorEquipo && !autorizacionDatos) return responder(origin, { error: 'Debes aceptar la autorización de datos vigente para continuar.' }, 400);
  if (!actorEquipo && !await validarTurnstile(env, body.turnstileToken, origin)) {
    return responder(origin, {
      error: 'Verifica que eres una persona e intenta de nuevo'
    }, 403);
  }

  let cliente;
  try {
    cliente = validarClientePago(body.cliente);
  } catch (error) {
    return responder(origin, {
      error: error.message || 'Datos de envio invalidos'
    }, 400);
  }

  const requestId = String(body.requestId || '').trim();
  if (!/^[a-f0-9-]{20,64}$/i.test(requestId)) {
    return responder(origin, { error: 'Identificador de solicitud invalido' }, 400);
  }
  let seguimientoToken;
  try {
    seguimientoToken = await crearTokenSeguimiento(env, 'contraentrega:' + requestId);
  } catch {
    return responder(origin, { error: 'El seguimiento privado no está configurado' }, 503);
  }
  const seguimientoHash = await sha256(seguimientoToken);

  const solicitados = Array.isArray(body.items) ? body.items : [];
  if (!solicitados.length || solicitados.length > MAX_ITEMS_PAGO) {
    return responder(origin, { error: 'Cantidad de prendas invalida' }, 400);
  }

  const acumulados = new Map();
  for (const item of solicitados) {
    const id = String(item && item.id || '').trim();
    const talla = normalizarTalla(item && item.talla);
    const cantidad = Number(item && item.cantidad || 1);
    if (!/^p[0-9]{8,25}$/.test(id) || !Number.isSafeInteger(cantidad) ||
        cantidad < 1 || cantidad > 20 || talla.length > 30) {
      return responder(origin, { error: 'Una prenda del carrito es invalida' }, 400);
    }
    const clave = id + '::' + talla;
    const previo = acumulados.get(clave);
    if (previo) previo.cantidad += cantidad;
    else acumulados.set(clave, { id, talla, cantidad });
  }

  const marcadorId = encodeURIComponent(requestId);
  for (let intento = 1; intento <= 4; intento += 1) {
    const marcador = await leerDocumentoFirebaseAdmin(
      env, 'solicitudes_pedido', marcadorId
    );
    if (marcador) {
      // Un requestId identifica una operación, pero no acredita al comprador.
      // No devolver datos ni regenerar el enlace a un visitante anónimo.
      if (!actorEquipo) {
        return responder(origin, {
          ok: false,
          duplicado: true,
          error: 'Esta solicitud ya fue registrada. Usa tu enlace privado de seguimiento o contacta al equipo. No vuelvas a crear el pedido.'
        }, 409);
      }
      const numeroExistente = Number(marcador.data.numeroPedido || 0);
      const pedidoExistente = await leerDocumentoFirebaseAdmin(
        env, 'pedidos', 'pedido-' + numeroExistente
      );
      return responder(origin, {
        ok: true,
        duplicado: true,
        pedido: pedidoExistente ? pedidoExistente.data : null,
        seguimientoToken,
        seguimientoUrl: enlaceSeguimiento(seguimientoToken)
      });
    }

    const contador = await leerDocumentoFirebaseAdmin(env, 'contadores', 'pedidos');
    const ids = [...new Set([...acumulados.values()].map(item => item.id))];
    const documentos = new Map();
    await Promise.all(ids.map(async id => {
      documentos.set(id, await leerDocumentoFirebaseAdmin(env, 'productos', id));
    }));

    const validados = [];
    const productosActualizados = new Map();
    for (const id of ids) {
      const documento = documentos.get(id);
      if (!documento) {
        return responder(origin, { error: 'Una prenda ya no esta disponible' }, 409);
      }
      const producto = documento.data;
      const precio = Number(producto.precio);
      if(actorBot && [...acumulados.values()].filter(i=>i.id===id).some(i=>
        !body.items.some(b=>b.id===id&&normalizarTalla(b.talla)===i.talla&&b.precio===precio)))
        return responder(origin,{error:'El precio cambió o esta prenda necesita revisión. No se reservó inventario.'},409);
      if (!Number.isSafeInteger(precio) || precio < 1000 || precio > 5000000) {
        return responder(origin, { error: 'Una prenda tiene un precio invalido' }, 409);
      }
      const tallas = Array.isArray(producto.tallasObj)
        ? producto.tallasObj.map(talla => ({ ...talla }))
        : [];
      const itemsProducto = [...acumulados.values()].filter(item => item.id === id);
      for (const item of itemsProducto) {
        const talla = tallas.find(
          actual => normalizarTalla(actual.nombre) === normalizarTalla(item.talla)
        );
        if (!talla || Number(talla.stock || 0) < item.cantidad) {
          return responder(origin, {
            error: 'Stock insuficiente para ' +
              String(producto.nombre || producto.codigo || item.id)
          }, 409);
        }
        talla.stock = Number(talla.stock || 0) - item.cantidad;
        validados.push({
          id: item.id,
          talla: item.talla,
          cantidad: item.cantidad,
          precio,
          nombre: String(producto.nombre || ''),
          codigo: String(producto.codigo || ''),
          categoria: String(producto.categoria || ''),
          imagen: String(
            (Array.isArray(producto.imagenes) && producto.imagenes[0]) ||
            producto.img ||
            ''
          )
        });
      }
      productosActualizados.set(id, {
        tallasObj: tallas,
        stockTotal: tallas.reduce(
          (suma, talla) => suma + Math.max(0, Number(talla.stock || 0)), 0
        ),
        actualizadoEn: new Date().toISOString()
      });
    }

    const totales = calcularPromocionMamelucos(validados);
    let cierre=null;
    if(actorBot) {
      if(validados.reduce((n,item)=>n+item.cantidad,0)>6)return responder(origin,{error:'Una asesora debe revisar el envío de este pedido.'},409);
      try{cierre=await cotizarCierreV52(env,cliente,Number(totales.total||0),body.modoPago);}catch(error){return responder(origin,{error:error.message},409);}
      const expires=Number(body.resumenVence);
      if(!Number.isSafeInteger(expires)||expires<=Date.now()||expires>Date.now()+15*60*1000)return responder(origin,{error:'El resumen venció. Revisa uno nuevo antes de confirmar.'},409);
      const fingerprint=await sha256(JSON.stringify({cliente,items:validados.map(i=>({id:i.id,talla:i.talla,cantidad:i.cantidad,precio:i.precio})),cierre,expires}));
      if(body.soloCotizar===true)return responder(origin,{ok:true,resumen:{...cierre,fingerprint,expires,items:validados.map(i=>({nombre:i.nombre,talla:i.talla,cantidad:i.cantidad,precio:i.precio})),cliente}});
      if(body.resumenHash!==fingerprint)return responder(origin,{error:'El carrito, los datos o la tarifa cambiaron. Revisa el resumen actualizado; no se reservó inventario.'},409);
    }

    const actual = Number(contador && contador.data.ultimo || 0);
    let numero = Math.max(0, Number.isSafeInteger(actual) ? actual : 0) + 1;

    // También protege los pedidos contraentrega cuando el contador quedó
    // detrás de documentos creados por una versión anterior del sistema.
    let numeroDisponible = false;
    for (let salto = 0; salto < 1000; salto += 1) {
      const pedidoConNumero = await leerDocumentoFirebaseAdmin(
        env,
        'pedidos',
        'pedido-' + numero
      );
      if (!pedidoConNumero) {
        numeroDisponible = true;
        break;
      }
      numero += 1;
    }
    if (!numeroDisponible) {
      return responder(origin, {
        error: 'No fue posible asignar un numero al pedido'
      }, 503);
    }
    const ahora = new Date();
    const transportadora = textoPedido(body.transportadora, 50);
    const pedido = {
      ...(autorizacionDatos ? { autorizacionDatos } : {}),
      num: numero,
      numOrden: 'SK' + String(numero).padStart(5, '0'),
      nom: cliente.nombre,
      cc: cliente.documento,
      dir: cliente.direccion,
      barrio: cliente.barrio,
      departamento: cliente.departamento,
      ciudad: cliente.ciudad,
      tel: cliente.telefono,
      correo: cliente.correo,
      observaciones: cliente.observaciones,
      tipoVenta: actorBot ? (cierre.modo==='contraentrega'?'Contraentrega':'Pago anticipado') : 'Contraentrega',
      estado: actorBot ? 'sofia' : 'nuevo',
      ...(actorBot ? {origen:'sofia-bot',sofiaCasoId:body.requestId,sofiaAtendido:false,estadoPago:cierre.modo==='anticipado'?'PENDIENTE_REVISION':'PENDIENTE_RECAUDO'} : {}),
      stockDescontado: true,
      stockDevuelto: false,
      tot: cierre?cierre.total:Number(totales.total || 0),
      ...(cierre?{subtotalPrendas:cierre.subtotal,comisionRecaudo:cierre.comision,comisionTransportadora:cierre.comision,porcentajeRecaudo:cierre.porcentaje,modoPago:cierre.modo,resumenConfirmado:body.resumenHash,confirmacionCliente:'CONFIRMADO',confirmacionClienteEn:ahora.toISOString()}:{}),
      subtotalBruto: Number(totales.bruto || 0),
      cantidadPromoMamelucos: Number(totales.cantidadPromo || 0),
      descuentoPromocion: Number(totales.descuento || 0),
      descuentoPorcentaje: 0,
      descuentoPorcentajeValor: 0,
      valorEnvio: cierre?cierre.envio:'',
      transportadora: cierre?cierre.transportadora:transportadora,
      asesora: actorEquipo ? actorEquipo.nombre : validarAsesora(body.asesora),
      seguimientoHash,
      items: validados.map(item => ({
        id_prod: item.id,
        cant: item.cantidad,
        talla: item.talla,
        nom: item.nombre,
        cod: item.codigo,
        precio: item.precio,
        categoria: item.categoria,
        imagen: item.imagen
      })),
      fecha: ahora.toLocaleString('es-CO', {
        timeZone: 'America/Bogota',
        hour12: true
      }),
      timestampPedido: ahora.getTime(),
      creadoEn: ahora.toISOString(),
      creadoPor: actorEquipo ? 'equipo:' + actorEquipo.uid : 'worker-contraentrega'
    };

    const writes = [];
    for (const [id, datos] of productosActualizados.entries()) {
      writes.push(writeActualizarDocumento(
        'productos',
        id,
        datos,
        documentos.get(id).updateTime,
        ['tallasObj', 'stockTotal', 'actualizadoEn']
      ));
    }
    if (contador) {
      writes.push(writeActualizarDocumento(
        'contadores',
        'pedidos',
        { ultimo: numero },
        contador.updateTime,
        ['ultimo']
      ));
    } else {
      writes.push(writeCrearDocumento('contadores', 'pedidos', { ultimo: numero }));
    }
    writes.push(writeCrearDocumento('pedidos', 'pedido-' + numero, pedido));
    if(actorBot)writes.push(writeCrearDocumento('sofia_avisos',body.requestId,{tipo:'pedido',numeroPedido:numero,pendiente:true,creadoEn:ahora.toISOString(),ultimoAviso:0}));
    writes.push(writeCrearDocumento('seguimiento_pedidos', seguimientoHash, {
      numeroPedido: numero,
      creadoEn: ahora.toISOString()
    }));
    writes.push(writeCrearDocumento('solicitudes_pedido', marcadorId, {
      numeroPedido: numero,
      tipo: 'Contraentrega',
      creadoEn: ahora.toISOString()
    }));
    writes.push(writeCrearDocumento('movimientos_inventario', 'venta-' + requestId, {
      tipo: 'venta',
      requestId,
      numeroPedido: numero,
      creadoEn: ahora.toISOString(),
      origen: actorEquipo ? 'panel-equipo' : 'catalogo-publico',
      usuarioUid: actorEquipo ? actorEquipo.uid : '',
      usuaria: actorEquipo ? actorEquipo.nombre : pedido.asesora,
      items: validados.map(item => ({
        productoId: item.id,
        talla: item.talla,
        cantidad: -item.cantidad,
        referencia: item.codigo,
        nombre: item.nombre
      }))
    }));

    try {
      await commitFirebaseAdmin(env, writes);
      await actualizarProductosCatalogoPublico(env, [...productosActualizados.keys()]);
      return responder(origin, {
        ok: true,
        duplicado: false,
        pedido,
        seguimientoToken,
        seguimientoUrl: enlaceSeguimiento(seguimientoToken)
      });
    } catch (error) {
      const reintentable = error instanceof Error &&
        Boolean(Reflect.get(error, 'reintentable'));
      if (!reintentable || intento === 4) {
        console.error('Pedido contraentrega seguro', error);
        return responder(origin, {
          error: 'No fue posible crear el pedido de forma segura'
        }, 503);
      }
    }
  }
  return responder(origin, { error: 'No fue posible completar el pedido' }, 503);
}

function estadoSeguimientoPublico(estado) {
  const normalizado = String(estado || '').toLowerCase();
  if (normalizado === 'enviado') return { clave: 'enviado', titulo: 'Tu pedido fue enviado', mensaje: 'Lo recibirás aproximadamente entre 1 y 3 días hábiles.' };
  if (normalizado === 'entregado') return { clave: 'entregado', titulo: 'Pedido entregado', mensaje: 'Esperamos que disfrutes mucho tu compra.' };
  if (normalizado === 'cancelado' || normalizado === 'anulado') return { clave: 'anulado', titulo: 'Pedido anulado', mensaje: 'Comunícate con nuestro equipo si necesitas ayuda.' };
  if (normalizado === 'pagado') return { clave: 'preparando', titulo: 'Pago recibido', mensaje: 'Estamos preparando tu pedido.' };
  return { clave: 'recibido', titulo: 'Pedido recibido', mensaje: 'Estamos verificando y preparando tu compra.' };
}

function writeEliminarDocumento(coleccion, id) {
  return { delete: nombreDocumentoFirestore(coleccion, id) };
}

function numeroMonedaPedido(valor) {
  if (typeof valor === 'number' && Number.isFinite(valor)) return Math.max(0, valor);
  const digitos = String(valor == null ? '' : valor).replace(/[^0-9]/g, '');
  return Math.max(0, Number(digitos) || 0);
}

function pedidoParaCliente(pedido) {
  const telefono = String(pedido.tel || '').replace(/\D/g, '');
  const valorEnvio = numeroMonedaPedido(pedido.valorEnvio);
  const total = numeroMonedaPedido(pedido.tot);
  const totalPrendas = total > 0
    ? Math.max(0, total - valorEnvio)
    : numeroMonedaPedido(pedido.totalPrendas);
  return {
    num: Number(pedido.num || 0),
    numOrden: String(pedido.numOrden || ''),
    nombre: textoPedido(pedido.nom, 100).split(' ')[0],
    departamento: textoPedido(pedido.departamento, 80),
    ciudad: textoPedido(pedido.ciudad, 80),
    fecha: textoPedido(pedido.fecha, 80),
    estado: estadoSeguimientoPublico(pedido.estado),
    transportadora: textoPedido(pedido.transportadora, 60),
    guia: textoPedido(pedido.guia, 100),
    valorEnvio,
    total,
    totalPrendas,
    confirmacionCliente: textoPedido(pedido.confirmacionCliente, 30),
    confirmacionClienteEn: textoPedido(pedido.confirmacionClienteEn, 60),
    items: (Array.isArray(pedido.items) ? pedido.items : []).slice(0, MAX_ITEMS_PAGO).map(item => ({
      nombre: textoPedido(item && (item.nom || item.nombre), 120),
      referencia: textoPedido(item && (item.cod || item.codigo), 60),
      talla: textoPedido(item && item.talla, 30),
      cantidad: Math.max(1, Number(item && (item.cant || item.cantidad)) || 1),
      precio: Math.max(0, Number(item && item.precio) || 0),
      imagen: textoPedido(item && item.imagen, 500)
    }))
  };
}

async function cargarSeguimientoPrivado(env, token) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const hash = await sha256(token);
  const acceso = await leerDocumentoFirebaseAdmin(env, 'seguimiento_pedidos', hash);
  if (!acceso) return null;
  // También aplica a enlaces antiguos: una fecha ausente o inválida no habilita acceso.
  const creadoEn = Date.parse(String(acceso.data.creadoEn || ''));
  if (!Number.isFinite(creadoEn) || creadoEn > Date.now() ||
      Date.now() >= creadoEn + SEGUIMIENTO_VIGENCIA_MS) return null;
  const numero = Number(acceso.data.numeroPedido || 0);
  if (!Number.isSafeInteger(numero) || numero < 1) return null;
  const documento = await leerDocumentoFirebaseAdmin(env, 'pedidos', 'pedido-' + numero);
  // Si se reemplazó el enlace, el anterior deja de servir incluso si quedó su índice.
  if (!documento || !comparacionSegura(String(documento.data.seguimientoHash || ''), hash)) return null;
  return { hash, numero, documento };
}

async function consultarSeguimiento(request, env, origin) {
  if (!ORIGENES_PERMITIDOS.has(origin)) return responder(origin, { error: 'Origen no autorizado' }, 403);
  const url = new URL(request.url);
  const token = String(url.searchParams.get('t') || '').trim();
  const resultado = await cargarSeguimientoPrivado(env, token);
  if (!resultado) return responder(origin, { error: 'Enlace de seguimiento inválido o vencido' }, 404);
  return responder(origin, { ok: true, pedido: pedidoParaCliente(resultado.documento.data) });
}

async function confirmarSeguimiento(request, env, origin) {
  if (!ORIGENES_PERMITIDOS.has(origin)) return responder(origin, { error: 'Origen no autorizado' }, 403);
  const body = await request.json().catch(() => ({}));
  const token = String(body.token || '').trim();
  const respuesta = body.recibido === true ? 'recibido' : (body.recibido === false ? 'no_recibido' : '');
  if (!respuesta) return responder(origin, { error: 'Respuesta inválida' }, 400);
  const resultado = await cargarSeguimientoPrivado(env, token);
  if (!resultado) return responder(origin, { error: 'Enlace de seguimiento inválido o vencido' }, 404);
  const pedido = resultado.documento.data || {};
  const estado = String(pedido.estado || '').toLowerCase();
  if (estado === 'cancelado' || estado === 'anulado') {
    return responder(origin, { error: 'Un pedido anulado no puede confirmar entrega' }, 409);
  }
  const confirmadoEn = new Date().toISOString();
  const cambios = { confirmacionCliente: respuesta, confirmacionClienteEn: confirmadoEn, actualizadoEn: confirmadoEn };
  const campos = ['confirmacionCliente', 'confirmacionClienteEn', 'actualizadoEn'];
  if (respuesta === 'recibido') {
    cambios.estado = 'entregado';
    campos.push('estado');
  }
  await commitFirebaseAdmin(env, [writeActualizarDocumento(
    'pedidos', 'pedido-' + resultado.numero,
    cambios,
    resultado.documento.updateTime,
    campos
  )]);
  return responder(origin, { ok: true, confirmacionCliente: respuesta, confirmacionClienteEn: confirmadoEn, estado: cambios.estado || estado });
}

async function administrarEnlaceSeguimiento(request, env, origin) {
  if (!ORIGENES_PERMITIDOS.has(origin)) return responder(origin, { error: 'Origen no autorizado' }, 403);
  const actor = await autenticarStaff(request);
  if (!actor) return responder(origin, { error: 'Sesión no autorizada' }, 401);
  if (actor.uid !== UID_ADMIN_AUDITORIA) return responder(origin, { error: 'Solo Yohana puede generar enlaces privados' }, 403);
  const body = await request.json().catch(() => ({}));
  const numero = Number(body.num);
  if (!Number.isSafeInteger(numero) || numero < 1) return responder(origin, { error: 'Número de pedido inválido' }, 400);
  const documento = await leerDocumentoFirebaseAdmin(env, 'pedidos', 'pedido-' + numero);
  if (!documento) return responder(origin, { error: 'No se encontró el pedido' }, 404);
  const anterior = String(documento.data.seguimientoHash || '');
  const token = crearTokenSeguimientoAleatorio();
  const hash = await sha256(token);
  const actualizadoEn = new Date().toISOString();
  /** @type {Array<object>} */
  const writes = [];
  writes.push(writeActualizarDocumento('pedidos', 'pedido-' + numero, { seguimientoHash: hash, actualizadoEn }, documento.updateTime, ['seguimientoHash', 'actualizadoEn']));
  writes.push(writeCrearDocumento('seguimiento_pedidos', hash, { numeroPedido: numero, creadoEn: actualizadoEn, creadoPor: actor.uid }));
  if (/^[a-f0-9]{64}$/.test(anterior) && anterior !== hash) writes.push(writeEliminarDocumento('seguimiento_pedidos', anterior));
  await commitFirebaseAdmin(env, writes);
  try {
    await registrarAuditoria(env, actor, 'generar_enlace_seguimiento', 'pedido', numero, { enlaceAnteriorInvalidado: Boolean(anterior) });
  } catch (error) {
    console.error(JSON.stringify({ mensaje: 'No se pudo registrar auditoría de seguimiento', numero, error: String(error) }));
  }
  return responder(origin, { ok: true, seguimientoToken: token, seguimientoUrl: enlaceSeguimiento(token) });
}

async function anularPedidoSeguro(request, env, origin) {
  if (!ORIGENES_PERMITIDOS.has(origin)) {
    return responder(origin, { error: 'Origen no autorizado' }, 403);
  }
  const actor = await autenticarStaff(request);
  if (!actor) {
    return responder(origin, { error: 'Sesión no autorizada' }, 401);
  }
  if (!['admin', 'inventario'].includes(actor.rol) && !SOFIA_STAFF_V43.has(actor.uid)) {
    return responder(origin, { error: 'Tu usuario no puede anular pedidos' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return responder(origin, { error: 'Solicitud JSON inválida' }, 400);
  }
  const numero = Number(body.num);
  if (!Number.isSafeInteger(numero) || numero < 1 || numero > 999999999) {
    return responder(origin, { error: 'Número de pedido inválido' }, 400);
  }
  const motivoAnulacion = typeof body.motivoAnulacion === 'string' ? body.motivoAnulacion.trim() : '';
  if (!motivoAnulacion || motivoAnulacion.length > 500) {
    return responder(origin, { error: 'El motivo de anulación es obligatorio y no puede superar 500 caracteres.' }, 400);
  }

  for (let intento = 1; intento <= 4; intento += 1) {
    try {
      const documentoPedido = await leerDocumentoFirebaseAdmin(
        env, 'pedidos', 'pedido-' + numero
      );
      if (!documentoPedido) {
        return responder(origin, { error: 'No se encontró el pedido' }, 404);
      }
      const pedido = documentoPedido.data || {};
      if(pedido.origen==='sofia-bot'&&!SOFIA_STAFF_V43.has(actor.uid))return responder(origin,{error:'Sólo Yohana o Bibiana revisan pedidos Sofía'},403);
      if(!['admin','inventario'].includes(actor.rol)&&pedido.origen!=='sofia-bot')return responder(origin,{error:'Tu usuario no puede anular este pedido'},403);
      if (pedido.stockDevuelto === true) {
        return responder(origin, { ok: true, duplicado: true, pedido });
      }

      const acumulados = new Map();
      if (pedido.stockDescontado === true) {
        const items = Array.isArray(pedido.items) ? pedido.items : [];
        if (!items.length || items.length > MAX_ITEMS_PAGO) {
          return responder(origin, { error: 'El pedido no tiene prendas válidas para devolver' }, 409);
        }
        for (const item of items) {
          const id = String(item && item.id_prod || '').trim();
          const talla = normalizarTalla(item && item.talla);
          const cantidad = Number(item && item.cant || 1);
          if (!/^p[0-9]{8,25}$/.test(id) || !Number.isSafeInteger(cantidad) ||
              cantidad < 1 || cantidad > 20 || !talla || talla.length > 30) {
            return responder(origin, { error: 'El pedido contiene una prenda inválida' }, 409);
          }
          const clave = id + '::' + talla;
          const previo = acumulados.get(clave);
          if (previo) previo.cantidad += cantidad;
          else acumulados.set(clave, { id, talla, cantidad });
        }
      }

      const ids = [...new Set([...acumulados.values()].map(item => item.id))];
      const documentosProducto = new Map();
      await Promise.all(ids.map(async id => {
        documentosProducto.set(id, await leerDocumentoFirebaseAdmin(env, 'productos', id));
      }));

      const productosActualizados = new Map();
      for (const id of ids) {
        const documento = documentosProducto.get(id);
        if (!documento) {
          return responder(origin, { error: 'No se encontró una prenda del pedido' }, 409);
        }
        const tallas = Array.isArray(documento.data.tallasObj)
          ? documento.data.tallasObj.map(talla => ({ ...talla }))
          : [];
        for (const item of [...acumulados.values()].filter(actual => actual.id === id)) {
          const talla = tallas.find(actual =>
            normalizarTalla(actual.nombre) === item.talla
          );
          if (!talla) {
            return responder(origin, { error: 'No se encontró una talla del pedido' }, 409);
          }
          talla.stock = Math.max(0, Number(talla.stock) || 0) + item.cantidad;
        }
        productosActualizados.set(id, {
          tallasObj: tallas,
          stockTotal: tallas.reduce(
            (suma, talla) => suma + Math.max(0, Number(talla.stock) || 0), 0
          ),
          actualizadoEn: new Date().toISOString()
        });
      }

      const devueltoEn = new Date().toISOString();
      const datosPedido = {
        estado: 'cancelado',
        stockDevuelto: true,
        stockDevueltoEn: devueltoEn,
        motivoAnulacion,
        anuladoPorUid: actor.uid,
        anuladoPorNombre: actor.nombre,
        anuladoEn: devueltoEn,
        actualizadoEn: devueltoEn
      };
      const writes = [];
      for (const [id, datos] of productosActualizados.entries()) {
        writes.push(writeActualizarDocumento(
          'productos', id, datos, documentosProducto.get(id).updateTime,
          ['tallasObj', 'stockTotal', 'actualizadoEn']
        ));
      }
      writes.push(writeActualizarDocumento(
        'pedidos', 'pedido-' + numero, datosPedido, documentoPedido.updateTime,
        ['estado', 'stockDevuelto', 'stockDevueltoEn', 'motivoAnulacion', 'anuladoPorUid', 'anuladoPorNombre', 'anuladoEn', 'actualizadoEn']
      ));
      writes.push(writeCrearDocumento(
        'movimientos_inventario', 'anulacion-pedido-' + numero,
        {
          tipo: 'anulacion',
          motivoAnulacion,
          numeroPedido: numero,
          creadoEn: devueltoEn,
          usuarioUid: actor.uid,
          usuaria: actor.nombre,
          items: [...acumulados.values()].map(item => ({
            productoId: item.id,
            talla: item.talla,
            cantidad: item.cantidad
          }))
        }
      ));
      await commitFirebaseAdmin(env, writes);
      await actualizarProductosCatalogoPublico(env, [...productosActualizados.keys()]);
      return responder(origin, {
        ok: true,
        duplicado: false,
        pedido: { ...pedido, ...datosPedido }
      });
    } catch (error) {
      const reintentable = error instanceof Error && Boolean(Reflect.get(error, 'reintentable'));
      if (!reintentable || intento === 4) {
        console.error('Anulación segura', numero, error);
        return responder(origin, {
          error: 'No fue posible anular el pedido y devolver el inventario'
        }, 503);
      }
    }
  }
  return responder(origin, { error: 'No fue posible anular el pedido' }, 503);
}

// ===== CATÁLOGO PÚBLICO Y AUDITORÍA =====
const CLAVE_CATALOGO_PUBLICO = 'catalogo/publico-v1.json';
const FIREBASE_WEB_API_KEY = 'AIzaSyBn5zp89TGHUj6OkA8jyKm_ROfEazCRgUc';
const UID_ADMIN_AUDITORIA = 'F2SHGFQYSuMWlkbQKV8yrKAXgaH3';
const USUARIOS_STAFF = new Map([
  ['F2SHGFQYSuMWlkbQKV8yrKAXgaH3', { nombre: 'Yohana', rol: 'admin' }],
  ['MtQpryHLGYab5v3UjhRZw88CAD63', { nombre: 'Bibiana', rol: 'asesora' }],
  ['IEB65uKdgldevmgRuenCj7pPwc12', { nombre: 'Ángela', rol: 'inventario' }]
]);

async function autenticarStaff(request) {
  const auth = String(request.headers.get('Authorization') || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (!token) return null;
  const response = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_WEB_API_KEY,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }) }
  );
  const datos = await response.json().catch(() => ({}));
  const uid = datos && datos.users && datos.users[0] && datos.users[0].localId;
  const perfil = USUARIOS_STAFF.get(String(uid || ''));
  return perfil ? { uid, ...perfil } : null;
}

async function listarProductosFirebaseAdmin(env) {
  const token = await obtenerTokenFirebaseAdmin(env);
  const productos = [];
  let pageToken = '';
  do {
    const endpoint = new URL('https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/productos');
    endpoint.searchParams.set('pageSize', '300');
    if (pageToken) endpoint.searchParams.set('pageToken', pageToken);
    const response = await fetch(endpoint.toString(), { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
    const datos = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error('No fue posible reconstruir el catálogo público');
    (datos.documents || []).forEach(documento => {
      const producto = convertirDocumentoFirestore(documento);
      if (!producto.id) producto.id = decodeURIComponent(documento.name.split('/').pop());
      productos.push(producto);
    });
    pageToken = String(datos.nextPageToken || '');
  } while (pageToken);
  return productos;
}

async function guardarCatalogoPublico(env, productos) {
  if (!env.PAGOS) throw new Error('Falta el almacenamiento PAGOS');
  const payload = { version: Date.now(), actualizadoEn: new Date().toISOString(), total: productos.length, productos };
  await env.PAGOS.put(CLAVE_CATALOGO_PUBLICO, JSON.stringify(payload), { httpMetadata: { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=60' } });
  return payload;
}

async function actualizarProductosCatalogoPublico(env, ids) {
  if (!env.PAGOS || !ids || !ids.length) return;
  const objeto = await env.PAGOS.get(CLAVE_CATALOGO_PUBLICO);
  if (!objeto) return;
  const payload = await objeto.json();
  const mapa = new Map((payload.productos || []).map(p => [String(p.id), p]));
  await Promise.all([...new Set(ids)].map(async id => {
    const doc = await leerDocumentoFirebaseAdmin(env, 'productos', id);
    if (doc) mapa.set(String(id), { ...doc.data, id: doc.data.id || id });
    else mapa.delete(String(id));
  }));
  await guardarCatalogoPublico(env, [...mapa.values()]);
}

async function registrarAuditoria(env, actor, accion, recurso, recursoId, detalle, resultado = 'exitoso') {
  const id = crypto.randomUUID();
  const evento = { uid: actor.uid, usuaria: actor.nombre, rol: actor.rol, accion, recurso, recursoId: String(recursoId || ''), detalle: detalle || {}, resultado, fecha: new Date().toISOString(), timestamp: Date.now() };
  await commitFirebaseAdmin(env, [writeCrearDocumento('auditoria', id, evento)]);
  return evento;
}

async function rutaCatalogoPublico(request, env, origin) {
  if (request.method === 'GET') {
    const objeto = env.PAGOS && await env.PAGOS.get(CLAVE_CATALOGO_PUBLICO);
    if (!objeto) return responder(origin, { error: 'Catálogo público no inicializado' }, 404);
    return new Response(objeto.body, { headers: { ...cors(origin), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' } });
  }
  const actor = await autenticarStaff(request);
  if (!actor || actor.rol !== 'admin') return responder(origin, { error: 'Solo Yohana puede reconstruir el catálogo' }, 403);
  const productos = await listarProductosFirebaseAdmin(env);
  const payload = await guardarCatalogoPublico(env, productos);
  await registrarAuditoria(env, actor, 'reconstruir_catalogo', 'catalogo_publico', 'v1', { total: productos.length });
  return responder(origin, { ok: true, total: payload.total, version: payload.version });
}

async function rutaAuditoria(request, env, origin) {
  const actor = await autenticarStaff(request);
  if (!actor) return responder(origin, { error: 'Sesión no autorizada' }, 401);
  if (request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const evento = await registrarAuditoria(env, actor, textoPedido(body.accion, 80), textoPedido(body.recurso, 80), textoPedido(body.recursoId, 120), body.detalle || {}, textoPedido(body.resultado || 'exitoso', 30));
    if (body.recurso === 'producto' && body.recursoId) await actualizarProductosCatalogoPublico(env, [String(body.recursoId)]);
    return responder(origin, { ok: true, evento });
  }
  if (actor.uid !== UID_ADMIN_AUDITORIA) return responder(origin, { error: 'Solo Yohana puede ver la auditoría' }, 403);
  const token = await obtenerTokenFirebaseAdmin(env);
  const endpoint = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/auditoria?pageSize=200&orderBy=timestamp%20desc';
  const response = await fetch(endpoint, { headers: { Authorization: 'Bearer ' + token } });
  const datos = await response.json().catch(() => ({}));
  const eventos = (datos.documents || []).map(convertirDocumentoFirestore);
  return responder(origin, { ok: true, eventos });
}

async function bandejaEquipo(request,env,origin) {
  if(!ORIGENES_PERMITIDOS.has(origin))return responder(origin,{error:'Origen no autorizado'},403);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(origin)});
  if(request.method!=='POST')return responder(origin,{error:'Método no permitido'},405);
  const actor=await autenticarStaff(request);
  if(!actor||!['F2SHGFQYSuMWlkbQKV8yrKAXgaH3','MtQpryHLGYab5v3UjhRZw88CAD63'].includes(actor.uid))return responder(origin,{error:'Bandeja reservada a las cuentas autorizadas para pruebas'},403);
  if(!env.WHATSAPP_INBOX_API||String(env.WHATSAPP_PEDIDOS_SECRET||'').length<32)return responder(origin,{error:'Bandeja no conectada todavía'},503);
  const raw=await request.text();if(raw.length>5000)return responder(origin,{error:'Solicitud demasiado grande'},400);
  let body;try{body=JSON.parse(raw);}catch{return responder(origin,{error:'JSON inválido'},400);}
  // No confiar en identidad enviada por navegador: construirla tras verificar Firebase.
  const payload=JSON.stringify({action:body.action,conversation:body.conversation,text:body.text,requestId:body.requestId,actor:{uid:actor.uid,nombre:actor.nombre}});
  const time=String(Date.now()),signature=await firmaSeguimientoWA(env.WHATSAPP_PEDIDOS_SECRET,'wa-inbox-v23\n'+time+'\n'+payload);
  const r=await env.WHATSAPP_INBOX_API.fetch(new Request('https://whatsapp-inbox/internal/inbox',{method:'POST',headers:{'Content-Type':'application/json','X-WA-Time':time,'X-WA-Signature':signature},body:payload}));
  if(body.action==='list'&&r.ok) {
    const data=await r.json();
    if(data.ok&&Array.isArray(data.conversations)) {
      try {
        const pending=(await listarColeccionSofiaV43(env,'sofia_avisos')).filter(d=>d.data.tipo==='asesora'&&d.data.pendiente);
        const ids=new Set(pending.map(d=>d.data.conversationId));
        data.conversations=data.conversations.map(c=>({...c,advisor_pending:ids.has(c.id)}));
      }catch{data.attentionUnavailable=true;}
    }
    return responder(origin,data);
  }
  return new Response(r.body,{status:r.status,headers:{...cors(origin),'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
const SOFIA_STAFF_V43=new Set(['F2SHGFQYSuMWlkbQKV8yrKAXgaH3','MtQpryHLGYab5v3UjhRZw88CAD63','IEB65uKdgldevmgRuenCj7pPwc12']);
async function internoSofiaV43(request,env) {
  if(request.method!=='POST'||request.headers.has('Origin'))return respuestaSeguimientoWA({ok:false},403);
  const secret=String(env.WHATSAPP_PEDIDOS_SECRET||''),stamp=request.headers.get('X-WA-Time')||'',raw=await request.text();
  if(secret.length<32||raw.length>18000||!/^\d{13}$/.test(stamp)||Math.abs(Date.now()-Number(stamp))>120000)return respuestaSeguimientoWA({ok:false},401);
  const expected=await firmaSeguimientoWA(secret,'sofia-v43\n'+stamp+'\n'+raw);
  if(!comparacionSegura(request.headers.get('X-WA-Signature')||'',expected))return respuestaSeguimientoWA({ok:false},401);
  let body;try{body=JSON.parse(raw);}catch{return respuestaSeguimientoWA({ok:false},400);}
  if(!/^[a-f0-9]{64}$/.test(body.requestId||''))return respuestaSeguimientoWA({ok:false},400);
  if(body.action==='pedido'||body.action==='cotizar-pedido') {
    const enabledValue=env.SOFIA_PEDIDOS_ENABLED;
    const enabled=enabledValue===true||(typeof enabledValue==='string'&&enabledValue.trim()==='true');
    if(!enabled){
      console.error('SOFIA_PEDIDO_CONFIG_V52_R5',JSON.stringify({presente:Object.hasOwn(env,'SOFIA_PEDIDOS_ENABLED'),tipo:typeof enabledValue,valor:typeof enabledValue==='string'?enabledValue.slice(0,24):enabledValue===undefined?'ausente':String(enabledValue)}));
      return respuestaSeguimientoWA({ok:false,error:'Registro directo desactivado'},503);
    }
    const internal=new Request(request.url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,soloCotizar:body.action==='cotizar-pedido'})});
    const result=await crearPedidoContraentregaSeguro(internal,env,'',{uid:'sofia-bot',nombre:'Sofía bot'});
    if(!result.ok){
      const diagnostic=await result.clone().json().catch(()=>({}));
      const configErrors=['El seguimiento privado no está configurado','No fue posible asignar un numero al pedido','No fue posible completar el pedido'];
      console.error('SOFIA_PEDIDO_FALLO',JSON.stringify({status:result.status,action:body.action,motivo:configErrors.includes(diagnostic.error)?diagnostic.error:'Consultar SOFIA_COTIZACION_V52 en WhatsApp'}));
    }
    return result;
  }
  if(body.action==='asesora') {
    if(!telefonoSeguimientoWA(body.telefono))return respuestaSeguimientoWA({ok:false},400);
    const prior=await leerDocumentoFirebaseAdmin(env,'sofia_avisos',body.requestId);
    if(!prior)await commitFirebaseAdmin(env,[writeCrearDocumento('sofia_avisos',body.requestId,{tipo:'asesora',motivo:body.motivo==='envio-1kg'?'envio-1kg':'asesora',telefono:body.telefono,conversationId:body.conversationId,pendiente:true,creadoEn:new Date().toISOString(),ultimoAviso:0})]);
    else if(!prior.data.pendiente||body.motivo==='envio-1kg'&&prior.data.motivo!=='envio-1kg')await commitFirebaseAdmin(env,[writeActualizarDocumento('sofia_avisos',body.requestId,{pendiente:true,ultimoAviso:0,motivo:body.motivo==='envio-1kg'?'envio-1kg':'asesora'},prior.updateTime,['pendiente','ultimoAviso','motivo'])]);
    return respuestaSeguimientoWA({ok:true});
  }
  if(body.action==='atendida') {
    const doc=await leerDocumentoFirebaseAdmin(env,'sofia_avisos',body.requestId);
    if(doc?.data.pendiente)await commitFirebaseAdmin(env,[writeActualizarDocumento('sofia_avisos',body.requestId,{pendiente:false},doc.updateTime,['pendiente'])]);
    return respuestaSeguimientoWA({ok:true});
  }
  return respuestaSeguimientoWA({ok:false},400);
}
async function listarColeccionSofiaV43(env,collection) {
  const token=await obtenerTokenFirebaseAdmin(env),result=[];let page='';
  do {
    const url=new URL('https://firestore.googleapis.com/v1/projects/'+FIREBASE_PROJECT_ID+'/databases/(default)/documents/'+collection);
    url.searchParams.set('pageSize','100');if(page)url.searchParams.set('pageToken',page);
    const response=await fetch(url,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw Error('No se pudo consultar la cola');const data=await response.json();
    for(const doc of data.documents||[])result.push({id:doc.name.split('/').pop(),updateTime:doc.updateTime,data:convertirDocumentoFirestore(doc)});
    page=data.nextPageToken||'';if(result.length>3000)throw Error('La cola necesita mantenimiento');
  }while(page);return result;
}
async function avisarAprobacionSofiaV61(env,pedido) {
  const telefono=telefonoSeguimientoWA(pedido?.tel);
  const numero=Number(pedido?.num);
  const transportadora=textoPedido(pedido?.transportadora,60);
  if(!telefono||!Number.isSafeInteger(numero)||numero<1||!transportadora||!env.WHATSAPP_INBOX_API) {
    return {ok:false,estado:'sin-datos'};
  }
  const payload=JSON.stringify({action:'pedido-aprobado',numero,telefono,transportadora});
  const time=String(Date.now());
  const signature=await firmaSeguimientoWA(env.WHATSAPP_PEDIDOS_SECRET,'wa-inbox-v23\n'+time+'\n'+payload);
  const response=await env.WHATSAPP_INBOX_API.fetch(new Request('https://whatsapp-inbox/internal/inbox',{
    method:'POST',headers:{'Content-Type':'application/json','X-WA-Time':time,'X-WA-Signature':signature},body:payload
  }));
  const result=await response.json().catch(()=>({}));
  return {ok:response.ok&&result.ok,estado:String(result.estado||result.error||'no-confirmado').slice(0,80)};
}
async function equipoSofiaV43(request,env,origin) {
  if(request.method==='OPTIONS')return ORIGENES_PERMITIDOS.has(origin)?new Response(null,{status:204,headers:cors(origin)}):responder(origin,{ok:false},403);
  if(!ORIGENES_PERMITIDOS.has(origin))return responder(origin,{ok:false},403);
  const actor=await autenticarStaff(request);if(!actor||!SOFIA_STAFF_V43.has(actor.uid))return responder(origin,{error:'Acceso no autorizado'},403);
  if(request.method==='GET')return responder(origin,{ok:true,vapidKey:env.FCM_VAPID_PUBLIC_KEY||'',avisos:(await listarColeccionSofiaV43(env,'sofia_avisos')).filter(d=>d.data.pendiente).map(d=>({id:d.id,...d.data}))});
  if(request.method!=='POST')return responder(origin,{ok:false},405);
  const body=await request.json();
  if(body.action==='registrar-dispositivo'||body.action==='quitar-dispositivo') {
    const token=String(body.token||'');if(token.length<40||token.length>4096)return responder(origin,{ok:false},400);
    const id=await sha256(actor.uid+':'+token),doc=await leerDocumentoFirebaseAdmin(env,'sofia_dispositivos',id);
    const data={uid:actor.uid,token,activo:body.action==='registrar-dispositivo',actualizadoEn:Date.now()};
    await commitFirebaseAdmin(env,[doc?writeActualizarDocumento('sofia_dispositivos',id,data,doc.updateTime,Object.keys(data)):writeCrearDocumento('sofia_dispositivos',id,data)]);
    return responder(origin,{ok:true});
  }
  if(body.action==='aprobar') {
    const num=Number(body.num);if(!Number.isSafeInteger(num)||num<1)return responder(origin,{ok:false},400);
    for(let retry=0;retry<4;retry++) {
      const doc=await leerDocumentoFirebaseAdmin(env,'pedidos','pedido-'+num);
      if(!doc||doc.data.origen!=='sofia-bot'||doc.data.stockDevuelto)return responder(origin,{error:'Pedido no aprobable'},409);
      if(doc.data.estado==='nuevo') {
        const aviso=await avisarAprobacionSofiaV61(env,doc.data).catch(()=>({ok:false,estado:'no-confirmado'}));
        return responder(origin,{ok:true,pedido:doc.data,duplicado:true,avisoCliente:aviso});
      }
      if(doc.data.estado!=='sofia')return responder(origin,{error:'El pedido ya cambió'},409);
      const avis=await leerDocumentoFirebaseAdmin(env,'sofia_avisos',doc.data.sofiaCasoId),change={estado:'nuevo',sofiaAtendido:true,asesora:actor.nombre,sofiaAprobadoPor:actor.uid,sofiaAprobadoEn:new Date().toISOString()};
      const writes=[writeActualizarDocumento('pedidos','pedido-'+num,change,doc.updateTime,Object.keys(change))];
      if(avis)writes.push(writeActualizarDocumento('sofia_avisos',doc.data.sofiaCasoId,{pendiente:false},avis.updateTime,['pendiente']));
      try{
        await commitFirebaseAdmin(env,writes);
        const pedido={...doc.data,...change};
        const aviso=await avisarAprobacionSofiaV61(env,pedido).catch(()=>({ok:false,estado:'no-confirmado'}));
        return responder(origin,{ok:true,pedido,avisoCliente:aviso});
      }catch(e){if(retry===3)throw e;}
    }
  }
  if(body.action==='tomar') {
    const id=String(body.id||'');if(!/^[a-f0-9]{64}$/.test(id))return responder(origin,{ok:false},400);
    const doc=await leerDocumentoFirebaseAdmin(env,'sofia_avisos',id);if(!doc)return responder(origin,{ok:false},404);
    if(doc.data.tipo==='asesora')return responder(origin,{error:'Toma la conversación desde la bandeja WhatsApp'},409);
    if(!doc.data.pendiente)return responder(origin,{ok:true,duplicado:true});
    await commitFirebaseAdmin(env,[writeActualizarDocumento('sofia_avisos',id,{pendiente:false,atendidoPor:actor.uid},doc.updateTime,['pendiente','atendidoPor'])]);
    return responder(origin,{ok:true});
  }
  return responder(origin,{ok:false},400);
}
async function recordarSofiaV43(env) {
  if(env.SOFIA_PUSH_ENABLED!=='true')return;
  const pending=(await listarColeccionSofiaV43(env,'sofia_avisos')).filter(d=>d.data.pendiente&&Date.now()-Number(d.data.ultimoAviso||0)>=120000);
  if(!pending.length)return;
  const devices=(await listarColeccionSofiaV43(env,'sofia_dispositivos')).filter(d=>d.data.activo&&SOFIA_STAFF_V43.has(d.data.uid)&&Date.now()-d.data.actualizadoEn<30*86400000);
  if(!devices.length)return;
  for(const notice of pending) {
    if(notice.data.tipo==='pedido') {
      const order=await leerDocumentoFirebaseAdmin(env,'pedidos','pedido-'+notice.data.numeroPedido);
      if(!order||order.data.estado!=='sofia'){await commitFirebaseAdmin(env,[writeActualizarDocumento('sofia_avisos',notice.id,{pendiente:false},notice.updateTime,['pendiente'])]);continue;}
    }
    // Precondición evita que dos cron simultáneos envíen el mismo recordatorio.
    try{await commitFirebaseAdmin(env,[writeActualizarDocumento('sofia_avisos',notice.id,{ultimoAviso:Date.now()},notice.updateTime,['ultimoAviso'])]);}catch{continue;}
    const access=await obtenerTokenFirebaseAdmin(env);
    for(const device of devices) {
      if(!device.data.activo)continue;
      const response=await fetch('https://fcm.googleapis.com/v1/projects/'+FIREBASE_PROJECT_ID+'/messages:send',{method:'POST',headers:{Authorization:'Bearer '+access,'Content-Type':'application/json'},body:JSON.stringify({message:{token:device.data.token,notification:{title:'SuperKids · Sofía',body:notice.data.tipo==='pedido'?'Hay un pedido pendiente de revisión.':notice.data.motivo==='envio-1kg'?'Envío supera 1 kg: terminar de cotizar (más de 6 prendas).':'Un cliente solicita una asesora.'},webpush:{headers:{TTL:'120',Urgency:'high'},notification:{tag:'sofia-'+notice.id,renotify:true},fcm_options:{link:'https://www.superkidsbabys.com/pedidos.html'}}}}),signal:AbortSignal.timeout(15000)});
      if(!response.ok) {
        let failure={};try{failure=await response.json();}catch{}
        const codes=(Array.isArray(failure?.error?.details)?failure.error.details:[])
          .map(d=>d?.errorCode).filter(c=>typeof c==='string'&&/^[A-Z_]{1,60}$/.test(c));
        const status=String(failure?.error?.status||'').replace(/[^A-Z_]/g,'').slice(0,60);
        console.error('Sofía push: entrega rechazada',JSON.stringify({http:response.status,status,codes}));
        if(response.status===404&&codes.includes('UNREGISTERED')) {
          try {
            await commitFirebaseAdmin(env,[writeActualizarDocumento('sofia_dispositivos',device.id,
              {activo:false},device.updateTime,['activo'])]);
            device.data.activo=false;
          }catch{console.error('Sofía push: no se confirmó la desactivación del registro inválido');}
        }
      }
    }
  }
}

// V77: Cotizaciones (prefacturas sin reserva) y Apartados (reserva pagada).
function puedeGestionarV77(actor) {
  return actor && (['admin', 'inventario', 'asesora'].includes(actor.rol) || SOFIA_STAFF_V43.has(actor.uid));
}
function validarItemsGestionV77(items) {
  if (!Array.isArray(items) || !items.length || items.length > MAX_ITEMS_PAGO) throw new Error('Agrega al menos una prenda válida.');
  const acumulados = new Map();
  for (const item of items) {
    const id = String(item && item.id || '').trim();
    const talla = normalizarTalla(item && item.talla);
    const cantidad = Number(item && item.cantidad || 1);
    if (!/^p[0-9]{8,25}$/.test(id) || !talla || talla.length > 30 || !Number.isSafeInteger(cantidad) || cantidad < 1 || cantidad > 20) throw new Error('Hay una prenda, talla o cantidad inválida.');
    const clave = id + '::' + talla;
    const previo = acumulados.get(clave);
    if (previo) previo.cantidad += cantidad;
    else acumulados.set(clave, { id, talla, cantidad });
  }
  return [...acumulados.values()];
}
async function resolverItemsGestionV77(env, items, descontar) {
  const pedidos = validarItemsGestionV77(items);
  const docs = new Map();
  await Promise.all([...new Set(pedidos.map(x => x.id))].map(async id => docs.set(id, await leerDocumentoFirebaseAdmin(env, 'productos', id))));
  const productosActualizados = new Map(), resueltos = [];
  for (const pedido of pedidos) {
    const documento = docs.get(pedido.id);
    if (!documento) throw new Error('Una prenda ya no existe en el catálogo.');
    const producto = documento.data || {};
    const precio = Number(producto.precio);
    if (!Number.isSafeInteger(precio) || precio < 0) throw new Error('Una prenda tiene un precio inválido.');
    const tallas = Array.isArray(producto.tallasObj) ? producto.tallasObj.map(x => ({...x})) : [];
    const talla = tallas.find(x => normalizarTalla(x.nombre) === pedido.talla);
    if (!talla) throw new Error('La talla solicitada ya no está disponible.');
    if (descontar) {
      if (Number(talla.stock || 0) < pedido.cantidad) throw new Error('Stock insuficiente para ' + String(producto.nombre || producto.codigo || pedido.id) + '.');
      talla.stock = Number(talla.stock || 0) - pedido.cantidad;
      productosActualizados.set(pedido.id, { tallasObj: tallas, stockTotal: tallas.reduce((n, x) => n + Math.max(0, Number(x.stock) || 0), 0), actualizadoEn: new Date().toISOString() });
    }
    resueltos.push({ id_prod: pedido.id, talla: pedido.talla, cant: pedido.cantidad, nom: textoPedido(producto.nombre, 160), cod: textoPedido(producto.codigo, 80), categoria: textoPedido(producto.categoria, 80), precio, imagen: textoPedido((Array.isArray(producto.imagenes) && producto.imagenes[0]) || producto.img, 600) });
  }
  const total = resueltos.reduce((n, x) => n + (x.precio * x.cant), 0);
  return { resueltos, total, docs, productosActualizados };
}
function clienteApartadoV77(datos) {
  const nombre = textoPedido(datos && datos.nombre, 100), telefono = textoPedido(datos && datos.telefono, 30);
  const medioPago = textoPedido(datos && datos.medioPago, 60), referenciaPago = textoPedido(datos && datos.referenciaPago, 100);
  const abono = Number(datos && datos.abono);
  if (nombre.length < 2 || !/^[0-9+().\s-]{7,30}$/.test(telefono)) throw new Error('El Apartado requiere nombre y teléfono válidos.');
  if (!Number.isSafeInteger(abono) || abono < 1 || abono > 50000000) throw new Error('Indica un abono válido.');
  if (!medioPago) throw new Error('Indica el medio de pago.');
  return { nombre, telefono, medioPago, referenciaPago, abono };
}
async function listarColeccionGestionV77(env, coleccion) {
  const token = await obtenerTokenFirebaseAdmin(env);
  const endpoint = 'https://firestore.googleapis.com/v1/projects/' + FIREBASE_PROJECT_ID + '/databases/(default)/documents/' + coleccion + '?pageSize=100';
  const response = await fetch(endpoint, { headers: { Accept: 'application/json', Authorization: 'Bearer ' + token } });
  const datos = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error('No fue posible leer ' + coleccion);
  return (datos.documents || []).map(convertirDocumentoFirestore).sort((a,b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
}
async function gestionCotizacionesApartadosV77(request, env, origin, ruta) {
  if (!ORIGENES_PERMITIDOS.has(origin)) return responder(origin, { error:'Origen no autorizado' }, 403);
  const actor = await autenticarStaff(request);
  if (!puedeGestionarV77(actor)) return responder(origin, { error:'Tu sesión no puede gestionar cotizaciones o apartados.' }, 403);
  if (request.method === 'GET' && ruta === 'listar') {
    const [cotizaciones, apartados] = await Promise.all([listarColeccionGestionV77(env,'cotizaciones'), listarColeccionGestionV77(env,'apartados')]);
    return responder(origin, { ok:true, cotizaciones, apartados });
  }
  const body = await request.json().catch(() => null);
  if (!body) return responder(origin, { error:'Solicitud JSON inválida.' }, 400);
  try {
    if (ruta === 'crear-cotizacion') {
      const resultado = await resolverItemsGestionV77(env, body.items, false);
      const ahora = new Date().toISOString(), id = 'cot-' + crypto.randomUUID();
      const cotizacion = { id, tipo:'prefactura', estado:'cotizacion', items:resultado.resueltos, total:resultado.total, stockDescontado:false, creadoEn:ahora, actualizadoEn:ahora, timestamp:Date.now(), creadoPorUid:actor.uid, creadoPor:actor.nombre };
      await commitFirebaseAdmin(env, [writeCrearDocumento('cotizaciones', id, cotizacion)]);
      await registrarAuditoria(env, actor, 'crear_cotizacion', 'cotizacion', id, { total:resultado.total, items:resultado.resueltos.length });
      return responder(origin, { ok:true, cotizacion });
    }
    if (ruta === 'crear-apartado' || ruta === 'agregar-apartado') {
      const datosCliente = ruta === 'crear-apartado' ? clienteApartadoV77(body) : null;
      let apartadoDoc = null;
      if (ruta === 'agregar-apartado') { apartadoDoc = await leerDocumentoFirebaseAdmin(env, 'apartados', textoPedido(body.id,100)); if (!apartadoDoc || apartadoDoc.data.estado !== 'apartado') throw new Error('No se encontró un Apartado activo.'); }
      const resultado = await resolverItemsGestionV77(env, body.items, true);
      const ahora = new Date().toISOString();
      const id = apartadoDoc ? textoPedido(body.id,100) : 'apartado-' + crypto.randomUUID();
      const previo = apartadoDoc ? apartadoDoc.data : {};
      const nuevosItems = apartadoDoc ? [...(Array.isArray(previo.items) ? previo.items : []), ...resultado.resueltos] : resultado.resueltos;
      const total = Number(previo.total || 0) + resultado.total;
      const nuevoAbono = apartadoDoc ? Number(body.abonoAdicional || 0) : datosCliente.abono;
      if (!Number.isSafeInteger(nuevoAbono) || nuevoAbono < 0 || nuevoAbono > 50000000) throw new Error('El abono adicional no es válido.');
      const abono = Number(previo.abono || 0) + nuevoAbono;
      const apartado = { ...previo, id, estado:'apartado', items:nuevosItems, total, abono, saldo:Math.max(0,total-abono), stockDescontado:true, actualizadoEn:ahora, timestamp: apartadoDoc ? Number(previo.timestamp || Date.now()) : Date.now(), ...(datosCliente ? { cliente:datosCliente.nombre, telefono:datosCliente.telefono, medioPago:datosCliente.medioPago, referenciaPago:datosCliente.referenciaPago, creadoEn:ahora, creadoPorUid:actor.uid, creadoPor:actor.nombre } : {}) };
      const writes=[];
      for (const [productoId, datos] of resultado.productosActualizados.entries()) writes.push(writeActualizarDocumento('productos', productoId, datos, resultado.docs.get(productoId).updateTime, ['tallasObj','stockTotal','actualizadoEn']));
      if (apartadoDoc) writes.push(writeActualizarDocumento('apartados', id, apartado, apartadoDoc.updateTime, ['items','total','abono','saldo','stockDescontado','actualizadoEn'])); else writes.push(writeCrearDocumento('apartados', id, apartado));
      writes.push(writeCrearDocumento('movimientos_inventario', 'apartado-' + crypto.randomUUID(), { tipo: apartadoDoc ? 'agregar_apartado' : 'apartado', apartadoId:id, creadoEn:ahora, usuarioUid:actor.uid, usuaria:actor.nombre, items:resultado.resueltos.map(x=>({productoId:x.id_prod,talla:x.talla,cantidad:-x.cant,nombre:x.nom,referencia:x.cod})) }));
      await commitFirebaseAdmin(env,writes); await actualizarProductosCatalogoPublico(env,[...resultado.productosActualizados.keys()]); await registrarAuditoria(env,actor, apartadoDoc?'agregar_apartado':'crear_apartado','apartado',id,{total,abono});
      return responder(origin,{ok:true,apartado});
    }
    if (ruta === 'convertir-cotizacion') {
      const id = textoPedido(body.id,100), cotizacionDoc = await leerDocumentoFirebaseAdmin(env,'cotizaciones',id);
      if (!cotizacionDoc || cotizacionDoc.data.estado !== 'cotizacion') throw new Error('No se encontró una cotización activa.');
      const solicitud = textoPedido(body.solicitudPedidoId,100);
      if (!/^pedido-[0-9]+$/.test(solicitud)) throw new Error('Primero crea el pedido nuevo y luego vincula la cotización.');
      const actualizadoEn = new Date().toISOString();
      await commitFirebaseAdmin(env,[writeActualizarDocumento('cotizaciones',id,{estado:'convertida',pedidoId:solicitud,convertidaEn:actualizadoEn,convertidaPor:actor.nombre,actualizadoEn},cotizacionDoc.updateTime,['estado','pedidoId','convertidaEn','convertidaPor','actualizadoEn'])]);
      return responder(origin,{ok:true});
    }
    return responder(origin,{error:'Ruta de gestión no reconocida.'},404);
  } catch (error) { return responder(origin,{error:error.message || 'No fue posible guardar el cambio.'},400); }
}
export default {
  async scheduled(controller,env) {await recordarSofiaV43(env);},
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';
    if(url.pathname==='/sofia/internal')return internoSofiaV43(request,env);
    if(url.pathname==='/sofia/equipo')return equipoSofiaV43(request,env,origin);
    if(url.pathname==='/equipo/whatsapp')return bandejaEquipo(request,env,origin);

    if (url.pathname === '/whatsapp/pedidos') return consultarPedidosWA(request, env);
    if (url.pathname === '/gestion/cotizaciones-apartados') return gestionCotizacionesApartadosV77(request, env, origin, 'listar');
    if (request.method === 'POST' && url.pathname === '/gestion/cotizaciones') return gestionCotizacionesApartadosV77(request, env, origin, 'crear-cotizacion');
    if (request.method === 'POST' && url.pathname === '/gestion/apartados') return gestionCotizacionesApartadosV77(request, env, origin, 'crear-apartado');
    if (request.method === 'POST' && url.pathname === '/gestion/apartados/agregar') return gestionCotizacionesApartadosV77(request, env, origin, 'agregar-apartado');
    if (request.method === 'POST' && url.pathname === '/gestion/cotizaciones/convertir') return gestionCotizacionesApartadosV77(request, env, origin, 'convertir-cotizacion');

    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/catalogo-publico') {
      return rutaCatalogoPublico(request, env, origin);
    }
    if ((request.method === 'GET' || request.method === 'POST') && url.pathname === '/auditoria') {
      return rutaAuditoria(request, env, origin);
    }
    if (request.method === 'GET' && url.pathname === '/seguimiento') {
      return consultarSeguimiento(request, env, origin);
    }
    if (request.method === 'POST' && url.pathname === '/seguimiento/confirmar') {
      return confirmarSeguimiento(request, env, origin);
    }
    if (request.method === 'POST' && url.pathname === '/seguimiento/admin') {
      return administrarEnlaceSeguimiento(request, env, origin);
    }

    if (request.method === 'POST' && url.pathname === '/eventos-wompi') {
      return recibirEventoWompi(request, env);
    }

    if(['GET','POST'].includes(request.method)&&url.pathname==='/respuestas-sofia')return respuestasSofiaV52(request,env,origin);

    if (request.method === 'GET' && url.pathname === '/tarifas-envio') {
      if (!ORIGENES_PERMITIDOS.has(origin)) {
        return responder(origin, { error: 'Origen no autorizado' }, 403);
      }
      return responder(origin, {
        ok: true,
        tarifas: await cargarTarifasEnvioPersonalizadas(env)
      });
    }

    if (request.method === 'POST' && url.pathname === '/tarifas-envio') {
      return administrarTarifasEnvio(request, env, origin);
    }

    if (request.method === 'POST' && url.pathname === '/preparar-pago') {
      return prepararPagoSeguro(request, env, origin);
    }

    if (request.method === 'POST' && url.pathname === '/crear-pedido-contraentrega') {
      return crearPedidoContraentregaSeguro(request, env, origin);
    }

    if (request.method === 'POST' && url.pathname === '/anular-pedido') {
      return anularPedidoSeguro(request, env, origin);
    }

    if (request.method === 'OPTIONS') {
      if (!ORIGENES_PERMITIDOS.has(origin)) return new Response(null, { status: 403 });
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    if (request.method === 'GET' && url.pathname === '/') {
      let firebaseAdminConfigurado = false;
      try {
        leerCuentaServicioFirebase(env);
        firebaseAdminConfigurado = true;
      } catch (_) {}
      return responder(origin, {
        ok: true,
        servicio: 'SuperKids Pagos',
        inventarioSeguroVersion: 'v37-20261003',
        ambienteTienda: 'production',
        produccionPreparada: Boolean(
          env.WOMPI_EVENTS_PROD &&
          env.WOMPI_INTEGRITY_PROD &&
          env.WOMPI_PUBLIC_KEY_PROD
        ),
        almacenPagosConectado: Boolean(env.PAGOS),
        firebaseAdminConfigurado,
        finalizacionAutomaticaPreparada: firebaseAdminConfigurado && Boolean(env.PAGOS)
      });
    }

    if (request.method === 'POST' && url.pathname === '/verificar') {
      if (!ORIGENES_PERMITIDOS.has(origin)) {
        return responder(origin, { error: 'Origen no autorizado' }, 403);
      }

      let body;
      try {
        body = await request.json();
      } catch {
        return responder(origin, { error: 'Solicitud JSON invalida' }, 400);
      }

      const transactionId = String(body.transactionId || '').trim();
      const expectedReference = String(body.reference || '').trim();
      const expectedAmount = Number(body.amountInCents);
      if (!/^[A-Za-z0-9_-]{8,80}$/.test(transactionId)) {
        return responder(origin, { error: 'ID de transaccion invalido' }, 400);
      }
      if (!/^SK[A-Z0-9_-]{4,32}$/.test(expectedReference)) {
        return responder(origin, { error: 'Referencia de pedido invalida' }, 400);
      }
      if (!Number.isSafeInteger(expectedAmount) || expectedAmount < 100000 || expectedAmount > 500000000) {
        return responder(origin, { error: 'Monto esperado invalido' }, 400);
      }

      const wompiResponse = await fetch(
        'https://production.wompi.co/v1/transactions/' + encodeURIComponent(transactionId),
        { headers: { Authorization: 'Bearer ' + env.WOMPI_PUBLIC_KEY_PROD } }
      );
      const wompiPayload = await wompiResponse.json().catch(() => ({}));
      const tx = wompiPayload && wompiPayload.data;
      if (!wompiResponse.ok || !tx) {
        return responder(origin, { error: 'Wompi no pudo confirmar la transaccion' }, 502);
      }

      const referenceMatches = String(tx.reference || '') === expectedReference;
      const amountMatches = Number(tx.amount_in_cents) === expectedAmount;
      const currencyMatches = String(tx.currency || '') === 'COP';
      const verified = referenceMatches && amountMatches && currencyMatches;

      return responder(origin, {
        ok: verified,
        verified,
        id: String(tx.id || ''),
        reference: String(tx.reference || ''),
        amountInCents: Number(tx.amount_in_cents || 0),
        currency: String(tx.currency || ''),
        status: String(tx.status || ''),
        paymentMethodType: String(tx.payment_method_type || ''),
        statusMessage: String(tx.status_message || ''),
        checks: { referenceMatches, amountMatches, currencyMatches }
      }, verified ? 200 : 409);
    }

    if (request.method !== 'POST' || url.pathname !== '/firma') {
      return responder(origin, { error: 'Ruta no encontrada' }, 404);
    }

    if (!ORIGENES_PERMITIDOS.has(origin)) {
      return responder(origin, { error: 'Origen no autorizado' }, 403);
    }

    if (!env.WOMPI_INTEGRITY_TEST || !env.WOMPI_INTEGRITY_TEST.startsWith('test_integrity_')) {
      return responder(origin, { error: 'El secreto Sandbox no esta configurado correctamente' }, 500);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return responder(origin, { error: 'Solicitud JSON invalida' }, 400);
    }

    const reference = String(body.reference || '').trim();
    const amountInCents = Number(body.amountInCents);

    if (!/^SK[A-Z0-9_-]{4,32}$/.test(reference)) {
      return responder(origin, { error: 'Referencia de pedido invalida' }, 400);
    }

    if (!Number.isSafeInteger(amountInCents) || amountInCents < 100000 || amountInCents > 500000000) {
      return responder(origin, { error: 'Monto de prueba invalido' }, 400);
    }

    const currency = 'COP';
    const integrity = await sha256(reference + amountInCents + currency + env.WOMPI_INTEGRITY_TEST);

    return responder(origin, {
      ok: true,
      environment: 'sandbox',
      reference,
      amountInCents,
      currency,
      integrity
    });
  }
};

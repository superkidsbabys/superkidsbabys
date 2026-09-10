const ORIGENES_PERMITIDOS = new Set([
  'https://superkidsbabys.com',
  'https://www.superkidsbabys.com'
]);
const WOMPI_PUBLIC_KEY_TEST = 'pub_test_IOwvTNIDN3nF3dw6exTVb89AhkVfdspO';
const FIREBASE_PROJECT_ID = 'superkidsbabys-222b0';
const MONEDA = 'COP';
// Admite pedidos mayoristas amplios sin dejar la ruta abierta a cargas ilimitadas.
const MAX_ITEMS_PAGO = 300;
let cacheTokenFirebase = null;
const ASESORAS_PERMITIDAS = new Set(['Yohana', 'Gina', 'Bibiana', 'Ángela', 'Sin asesora']);

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
    scope: 'https://www.googleapis.com/auth/datastore'
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
  if (incidenciaPago) pedido.incidenciaPago = incidenciaPago;
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

async function crearPedidoContraentregaSeguro(request, env, origin) {
  if (!ORIGENES_PERMITIDOS.has(origin)) {
    return responder(origin, { error: 'Origen no autorizado' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return responder(origin, { error: 'Solicitud JSON invalida' }, 400);
  }

  if (!await validarTurnstile(env, body.turnstileToken, origin)) {
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
      tipoVenta: 'Contraentrega',
      estado: 'nuevo',
      stockDescontado: true,
      stockDevuelto: false,
      tot: Number(totales.total || 0),
      subtotalBruto: Number(totales.bruto || 0),
      cantidadPromoMamelucos: Number(totales.cantidadPromo || 0),
      descuentoPromocion: Number(totales.descuento || 0),
      descuentoPorcentaje: 0,
      descuentoPorcentajeValor: 0,
      valorEnvio: '',
      transportadora,
      asesora: validarAsesora(body.asesora),
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
      creadoPor: 'worker-contraentrega'
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
    writes.push(writeCrearDocumento('seguimiento_pedidos', seguimientoHash, {
      numeroPedido: numero,
      creadoEn: ahora.toISOString()
    }));
    writes.push(writeCrearDocumento('solicitudes_pedido', marcadorId, {
      numeroPedido: numero,
      tipo: 'Contraentrega',
      creadoEn: ahora.toISOString()
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

function pedidoParaCliente(pedido) {
  const telefono = String(pedido.tel || '').replace(/\D/g, '');
  return {
    num: Number(pedido.num || 0),
    numOrden: String(pedido.numOrden || ''),
    nombre: textoPedido(pedido.nom, 100),
    direccion: textoPedido(pedido.dir, 160),
    barrio: textoPedido(pedido.barrio, 80),
    departamento: textoPedido(pedido.departamento, 80),
    ciudad: textoPedido(pedido.ciudad, 80),
    telefonoFinal: telefono.slice(-4),
    fecha: textoPedido(pedido.fecha, 80),
    estado: estadoSeguimientoPublico(pedido.estado),
    transportadora: textoPedido(pedido.transportadora, 60),
    guia: textoPedido(pedido.guia, 100),
    valorEnvio: Math.max(0, Number(pedido.valorEnvio) || 0),
    total: Math.max(0, Number(pedido.tot) || 0),
    totalPrendas: Math.max(0, (Number(pedido.tot) || 0) > 0
      ? (Number(pedido.tot) || 0) - (Number(pedido.valorEnvio) || 0)
      : (Number(pedido.totalPrendas) || 0)),
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
  const numero = Number(acceso.data.numeroPedido || 0);
  if (!Number.isSafeInteger(numero) || numero < 1) return null;
  const documento = await leerDocumentoFirebaseAdmin(env, 'pedidos', 'pedido-' + numero);
  return documento ? { hash, numero, documento } : null;
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
  await commitFirebaseAdmin(env, [writeActualizarDocumento(
    'pedidos', 'pedido-' + resultado.numero,
    { confirmacionCliente: respuesta, confirmacionClienteEn: confirmadoEn, actualizadoEn: confirmadoEn },
    resultado.documento.updateTime,
    ['confirmacionCliente', 'confirmacionClienteEn', 'actualizadoEn']
  )]);
  return responder(origin, { ok: true, confirmacionCliente: respuesta, confirmacionClienteEn: confirmadoEn });
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
  if (actor.uid !== UID_ADMIN_AUDITORIA) {
    return responder(origin, { error: 'Solo Yohana puede anular pedidos' }, 403);
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

  for (let intento = 1; intento <= 4; intento += 1) {
    try {
      const documentoPedido = await leerDocumentoFirebaseAdmin(
        env, 'pedidos', 'pedido-' + numero
      );
      if (!documentoPedido) {
        return responder(origin, { error: 'No se encontró el pedido' }, 404);
      }
      const pedido = documentoPedido.data || {};
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
        ['estado', 'stockDevuelto', 'stockDevueltoEn', 'actualizadoEn']
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
  ['yI067cx29zbmiBOd9wyKcwp0HpF2', { nombre: 'Gina', rol: 'asesora' }],
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

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

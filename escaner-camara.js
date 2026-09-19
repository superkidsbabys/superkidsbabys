/* ============================================================
   escaner-camara.js  ·  SuperKids&Babys
   Agrega un botón 📷 al modal "Conteo rápido" de pedidos.html
   para leer el código de barras de la etiqueta con la cámara
   del celular o del iPad.

   - La pistola lectora sigue funcionando igual que siempre.
   - Al leer un código, lo escribe en el mismo campo del Conteo
     rápido y busca la prenda, como si lo hubiera escrito la pistola.
   - No modifica Firestore ni ningún otro módulo.
   ============================================================ */
(function () {
  'use strict';

  var LIB_URL = 'https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/html5-qrcode.min.js';
  var lector = null;
  var camaraAbierta = false;
  var leyendo = false;

  /* ---------- Carga de la librería (solo la primera vez que se usa) ---------- */
  function cargarLibreria() {
    if (window.Html5Qrcode) return Promise.resolve();
    if (window._cargaLibEscaner) return window._cargaLibEscaner;
    window._cargaLibEscaner = new Promise(function (ok, fallo) {
      var s = document.createElement('script');
      s.src = LIB_URL;
      s.onload = function () {
        if (window.Html5Qrcode) ok();
        else { window._cargaLibEscaner = null; fallo(new Error('El lector no se cargó bien.')); }
      };
      s.onerror = function () {
        window._cargaLibEscaner = null;
        fallo(new Error('No se pudo descargar el lector. Revisa tu conexión a Internet.'));
      };
      document.head.appendChild(s);
    });
    return window._cargaLibEscaner;
  }

  /* ---------- Utilidades de interfaz ---------- */
  function mensaje(texto, esError) {
    var m = document.getElementById('conteo-rapido-camara-msg');
    if (!m) return;
    m.textContent = texto || '';
    m.style.color = esError ? '#b42318' : '#166534';
  }

  function actualizarBoton() {
    var b = document.getElementById('conteo-rapido-btn-camara');
    if (!b) return;
    b.style.background = camaraAbierta ? '#b42318' : '#168d55';
    b.textContent = camaraAbierta ? '✕' : '📷';
    b.title = camaraAbierta ? 'Cerrar la cámara' : 'Escanear con la cámara';
    b.setAttribute('aria-label', b.title);
  }

  function textoDeError(e) {
    var t = String((e && (e.message || e.name)) || e || '');
    if (/permission|denied|NotAllowed/i.test(t)) {
      return 'No hay permiso para usar la cámara. Actívalo en los permisos del navegador (o de la app instalada) y vuelve a intentar.';
    }
    if (/NotFound|no camera|Requested device not found/i.test(t)) {
      return 'No se encontró ninguna cámara en este dispositivo.';
    }
    if (/NotReadable|in use|Could not start video/i.test(t)) {
      return 'La cámara está ocupada por otra aplicación. Ciérrala e inténtalo de nuevo.';
    }
    if (/Internet|descargar|cargó/i.test(t)) return t;
    return 'No se pudo abrir la cámara: ' + t;
  }

  /* ---------- Control de la cámara ---------- */
  function detenerLector() {
    var l = lector;
    lector = null;
    if (!l) return Promise.resolve();
    return Promise.resolve()
      .then(function () { return l.stop(); })
      .catch(function () {})
      .then(function () { try { return Promise.resolve(l.clear()).catch(function () {}); } catch (e) {} });
  }

  function cerrarCamara() {
    camaraAbierta = false;
    return detenerLector().then(function () {
      var panel = document.getElementById('conteo-rapido-camara');
      if (panel) panel.style.display = 'none';
      actualizarBoton();
    });
  }

  function alDetectar(texto) {
    if (leyendo) return;
    leyendo = true;
    var codigo = String(texto || '').trim();
    try { if (navigator.vibrate) navigator.vibrate(80); } catch (e) {}
    cerrarCamara().then(function () {
      var input = document.getElementById('conteo-rapido-codigo');
      if (input) input.value = codigo;
      if (typeof window.buscarConteoRapido === 'function') window.buscarConteoRapido();
      leyendo = false;
    });
  }

  function abrirCamara() {
    if (camaraAbierta) { cerrarCamara(); return; }
    var panel = document.getElementById('conteo-rapido-camara');
    if (!panel) return;
    camaraAbierta = true;
    panel.style.display = 'block';
    actualizarBoton();
    mensaje('Abriendo cámara…', false);

    cargarLibreria()
      .then(function () {
        if (!camaraAbierta) return;
        var F = window.Html5QrcodeSupportedFormats;
        lector = new window.Html5Qrcode('conteo-rapido-lector', {
          formatsToSupport: [F.CODE_128, F.CODE_39, F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.ITF, F.QR_CODE],
          useBarCodeDetectorIfSupported: true,
          verbose: false
        });
        return lector.start(
          { facingMode: 'environment' },
          {
            fps: 12,
            // Recuadro ancho: los códigos de barras son horizontales.
            qrbox: function (ancho) {
              var w = Math.max(120, Math.min(ancho - 20, 320));
              return { width: w, height: Math.max(60, Math.round(w * 0.5)) };
            }
          },
          alDetectar,
          function () { /* sin código en este cuadro: ignorar */ }
        ).then(function () {
          if (camaraAbierta) mensaje('Apunta al código de barras de la etiqueta.', false);
        });
      })
      .catch(function (e) {
        camaraAbierta = false;
        detenerLector().then(function () {
          actualizarBoton();
          mensaje(textoDeError(e), true);
        });
      });
  }

  /* ---------- Inserta el botón y el visor dentro del modal ---------- */
  function instalarBoton() {
    var input = document.getElementById('conteo-rapido-codigo');
    if (!input || document.getElementById('conteo-rapido-btn-camara')) return;

    var fila = document.createElement('div');
    fila.style.cssText = 'display:flex;gap:8px;align-items:stretch;margin:18px 0 12px;';
    input.parentNode.insertBefore(fila, input);
    fila.appendChild(input);
    input.style.margin = '0';
    input.style.width = 'auto';
    input.style.flex = '1';
    input.style.minWidth = '0';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.id = 'conteo-rapido-btn-camara';
    btn.style.cssText = 'flex:0 0 auto;border:0;border-radius:11px;color:#fff;font-size:1.35em;padding:0 16px;cursor:pointer;box-shadow:0 3px 10px rgba(22,141,85,.25);';
    btn.addEventListener('click', abrirCamara);
    fila.appendChild(btn);

    var panel = document.createElement('div');
    panel.id = 'conteo-rapido-camara';
    panel.style.cssText = 'display:none;margin:0 0 12px;border:2px solid #8ee0b6;border-radius:12px;padding:8px;background:#f4fff9;';
    panel.innerHTML =
      '<div id="conteo-rapido-lector" style="width:100%;overflow:hidden;border-radius:9px;background:#000;min-height:120px;"></div>' +
      '<div id="conteo-rapido-camara-msg" style="text-align:center;font-size:.82em;font-weight:800;color:#166534;margin-top:7px;"></div>' +
      '<button type="button" id="conteo-rapido-cerrar-camara" style="display:block;margin:8px auto 0;border:0;background:#eee;color:#555;border-radius:8px;padding:7px 14px;font-weight:800;cursor:pointer;">Cerrar cámara</button>';
    fila.parentNode.insertBefore(panel, fila.nextSibling);
    document.getElementById('conteo-rapido-cerrar-camara').addEventListener('click', cerrarCamara);

    actualizarBoton();
  }

  /* ---------- Engancha las funciones existentes del Conteo rápido ---------- */
  function envolver(nombre, antes, despues) {
    var original = window[nombre];
    if (typeof original !== 'function') return false;
    if (original.__camara) return true;
    var nueva = function () {
      if (antes) antes();
      var r = original.apply(this, arguments);
      if (despues) despues();
      return r;
    };
    nueva.__camara = true;
    window[nombre] = nueva;
    return true;
  }

  function iniciar(intento) {
    var a = envolver('abrirConteoRapido', cerrarCamara, instalarBoton);
    var b = envolver('cerrarConteoRapido', cerrarCamara, null);
    var c = envolver('editarConteoRapido', cerrarCamara, null);
    if (!(a && b && c) && intento < 40) setTimeout(function () { iniciar(intento + 1); }, 250);
  }

  iniciar(0);
})();

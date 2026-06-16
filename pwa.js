(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./service-worker.js')
        .catch(function (error) {
          console.log('Service worker no registrado:', error);
        });
    });
  }

  var deferredInstallPrompt = null;
  var installButton = null;
  var BACK_GUARD_STATE = '__superkidsBackGuard';
  var BACK_INITIAL_STATE = '__superkidsInitial';
  var BACK_INTERNAL_STATE = '__superkidsInternal';
  var backExitRequested = false;
  var backDialog = null;
  var restaurandoEstadoInterno = false;
  var funcionesNavegacionPreparadas = false;
  var clicksInternosPreparados = false;

  function estaEnModoPwa() {
    return window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
  }

  function crearDialogoSalida() {
    if (backDialog) return backDialog;

    var overlay = document.createElement('div');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Salir de SuperKids&Babys');
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:100000',
      'display:none',
      'align-items:center',
      'justify-content:center',
      'padding:22px',
      'background:rgba(46,32,41,0.38)',
      'font-family:Nunito,Arial,sans-serif'
    ].join(';');

    overlay.innerHTML = [
      '<div style="width:100%;max-width:340px;background:#fff;border-radius:18px;padding:22px 20px;box-shadow:0 18px 48px rgba(46,32,41,0.22);text-align:center;">',
      '<div style="font-size:1.02rem;font-weight:900;color:#4a3a44;margin-bottom:16px;">¿Deseas salir de SuperKids&amp;Babys?</div>',
      '<div style="display:flex;gap:10px;">',
      '<button type="button" data-sk-back-cancel style="flex:1;border:none;border-radius:12px;padding:12px 10px;background:#f4edf2;color:#5c4a55;font-weight:800;font-family:Nunito,Arial,sans-serif;">Cancelar</button>',
      '<button type="button" data-sk-back-exit style="flex:1;border:none;border-radius:12px;padding:12px 10px;background:#c0557a;color:#fff;font-weight:900;font-family:Nunito,Arial,sans-serif;">Salir</button>',
      '</div>',
      '</div>'
    ].join('');

    overlay.querySelector('[data-sk-back-cancel]').addEventListener('click', function () {
      ocultarDialogoSalida();
      activarProteccionAtras();
    });

    overlay.querySelector('[data-sk-back-exit]').addEventListener('click', function () {
      backExitRequested = true;
      ocultarDialogoSalida();
      setTimeout(function () {
        history.back();
        setTimeout(function () { window.close(); }, 180);
      }, 0);
    });

    document.body.appendChild(overlay);
    backDialog = overlay;
    return overlay;
  }

  function mostrarDialogoSalida() {
    crearDialogoSalida().style.display = 'flex';
  }

  function ocultarDialogoSalida() {
    if (backDialog) backDialog.style.display = 'none';
  }

  function textoActivo(selector, fallback) {
    var el = document.querySelector(selector);
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : fallback;
  }

  function textoPortadaSubcategoria(el) {
    if (!el) return '';
    var titulo = el.querySelector('.portada-subcategoria-titulo');
    return (titulo || el).textContent.replace(/\s+/g, ' ').trim();
  }

  function leerSubcategoriasAbiertas() {
    var abiertas = [];
    var elementos = document.querySelectorAll('.portada-subcategoria.activa');
    for (var i = 0; i < elementos.length; i += 1) {
      var texto = textoPortadaSubcategoria(elementos[i]);
      if (texto) abiertas.push(texto);
    }
    return abiertas;
  }

  function listasIguales(a, b) {
    a = Array.isArray(a) ? a : [];
    b = Array.isArray(b) ? b : [];
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }

  function leerEstadoInterno() {
    var genero = 'Niñas';
    if (document.getElementById('btn-gen-ninos') && document.getElementById('btn-gen-ninos').classList.contains('activo')) genero = 'Niños';
    if (document.getElementById('btn-gen-junior') && document.getElementById('btn-gen-junior').classList.contains('activo')) genero = 'Junior';

    var categoria = textoActivo('#menu-categorias .btn-categoria.activo', 'Todos');
    var talla = textoActivo('#menu-tallas .btn-talla-f.activo', 'Todas');
    var promo = !!document.querySelector('#menu-tallas .btn-promo-especial.activo-promo');
    var tabActivo = document.querySelector('.seccion-tab.activo');
    var filtroPedido = document.querySelector('.btn-filtro-ped.activo');

    return {
      genero: genero,
      categoria: categoria || 'Todos',
      talla: talla || 'Todas',
      promo: promo,
      subcategoriasAbiertas: leerSubcategoriasAbiertas(),
      tab: tabActivo && tabActivo.id ? tabActivo.id.replace('tab-', '') : '',
      pedido: filtroPedido && filtroPedido.id ? filtroPedido.id.replace('fp-', '') : 'nuevo'
    };
  }

  function construirEstado(tipo) {
    var estado = leerEstadoInterno();
    estado[tipo] = true;
    return estado;
  }

  function estadosIguales(a, b) {
    if (!a || !b) return false;
    return a.genero === b.genero &&
      a.categoria === b.categoria &&
      a.talla === b.talla &&
      a.promo === b.promo &&
      listasIguales(a.subcategoriasAbiertas, b.subcategoriasAbiertas) &&
      a.tab === b.tab &&
      a.pedido === b.pedido &&
      !!a[BACK_INITIAL_STATE] === !!b[BACK_INITIAL_STATE] &&
      !!a[BACK_INTERNAL_STATE] === !!b[BACK_INTERNAL_STATE] &&
      !!a[BACK_GUARD_STATE] === !!b[BACK_GUARD_STATE];
  }

  function agregarEstadoInterno() {
    if (!estaEnModoPwa()) {
      return;
    }
    if (restaurandoEstadoInterno) {
      return;
    }

    setTimeout(function () {
      try {
        var nuevoEstado = construirEstado(BACK_INTERNAL_STATE);
        if (history.state && estadosIguales(history.state, nuevoEstado)) {
          return;
        }
        history.pushState(nuevoEstado, '', window.location.href);
      } catch (error) {
      }
    }, 0);
  }

  function restaurarEstadoInterno(estado) {
    if (!estado) return;

    restaurandoEstadoInterno = true;
    try {
      clickGenero(estado.genero || 'Niñas');
      if (estado.categoria && estado.categoria !== 'Todos') clickPorTexto('#menu-categorias .btn-categoria', estado.categoria);
      if (estado.promo) {
        clickSelector('#menu-tallas .btn-promo-especial');
      } else if (estado.talla && estado.talla !== 'Todas') {
        clickPorTexto('#menu-tallas .btn-talla-f', estado.talla);
      }
      if (estado.tab) clickSelector('.btn-tab[onclick*="' + estado.tab + '"]');
      if (estado.pedido) clickSelector('#fp-' + estado.pedido);
    } catch (error) {
      console.log('No se pudo restaurar navegación interna:', error);
    } finally {
      restaurarSubcategoriasAbiertas(estado.subcategoriasAbiertas, function () {
        restaurandoEstadoInterno = false;
      });
    }
  }

  function clickSelector(selector) {
    var el = document.querySelector(selector);
    if (el) el.click();
  }

  function clickPorTexto(selector, texto) {
    var buscado = (texto || '').replace(/\s+/g, ' ').trim();
    var elementos = document.querySelectorAll(selector);
    for (var i = 0; i < elementos.length; i += 1) {
      var actual = elementos[i].textContent.replace(/\s+/g, ' ').trim();
      if (actual === buscado) {
        elementos[i].click();
        return;
      }
    }
  }

  function restaurarSubcategoriasAbiertas(abiertas, terminado) {
    abiertas = Array.isArray(abiertas) ? abiertas : [];
    if (!abiertas.length) {
      setTimeout(function () { if (terminado) terminado(); }, 0);
      return;
    }

    var indice = 0;
    function abrirSiguiente() {
      if (indice >= abiertas.length) {
        if (terminado) terminado();
        return;
      }
      var buscado = abiertas[indice];
      var portadas = document.querySelectorAll('.portada-subcategoria');
      for (var j = 0; j < portadas.length; j += 1) {
        var portada = portadas[j];
        if (textoPortadaSubcategoria(portada) === buscado && !portada.classList.contains('activa')) {
          portada.click();
          break;
        }
      }
      indice += 1;
      setTimeout(abrirSiguiente, 0);
    }

    setTimeout(abrirSiguiente, 0);
  }

  function clickGenero(genero) {
    if (genero === 'Niños') return clickSelector('#btn-gen-ninos');
    if (genero === 'Junior') return clickSelector('#btn-gen-junior');
    return clickSelector('#btn-gen-ninas');
  }

  function envolverFuncionNavegacion(nombre) {
    var original = window[nombre];
    if (typeof original !== 'function') {
      return false;
    }
    if (original.__superkidsBackWrapped) {
      return false;
    }

    var envuelta = function () {
      var resultado = original.apply(this, arguments);
      agregarEstadoInterno();
      return resultado;
    };
    envuelta.__superkidsBackWrapped = true;
    window[nombre] = envuelta;
    return true;
  }

  function prepararHistorialInterno() {
    if (!estaEnModoPwa() || funcionesNavegacionPreparadas) return;

    var nombres = [
      'cambiarGenero',
      'filtrarCatalogo',
      'filtrarPorTalla',
      'togglePromociones',
      'filtrarVistaPedidos',
      'cambiarTab'
    ];
    var listas = nombres.map(envolverFuncionNavegacion);
    funcionesNavegacionPreparadas = listas.every(Boolean);
  }

  function prepararClicksInternos() {
    if (!estaEnModoPwa() || clicksInternosPreparados) return;

    document.addEventListener('click', function (event) {
      if (restaurandoEstadoInterno) return;
      var objetivo = event.target && event.target.closest ? event.target.closest([
        '#btn-gen-ninas',
        '#btn-gen-ninos',
        '#btn-gen-junior',
        '#menu-categorias .btn-categoria',
        '#menu-tallas .btn-talla-f',
        '#menu-tallas .btn-promo-especial',
        '#btn-volver-collage',
        '.portada-subcategoria',
        '.btn-filtro-ped',
        '.btn-tab'
      ].join(',')) : null;

      if (objetivo) {
        agregarEstadoInterno();
      }
    }, true);

    clicksInternosPreparados = true;
  }

  function marcarEstadoInicial() {
    try {
      var state = history.state;
      var base = state && typeof state === 'object' ? state : {};
      if (!base[BACK_INITIAL_STATE]) {
        var nuevoEstado = Object.assign({}, base, leerEstadoInterno());
        nuevoEstado[BACK_INITIAL_STATE] = true;
        history.replaceState(nuevoEstado, '', window.location.href);
      }
    } catch (error) {
    }
  }

  function activarProteccionAtras() {
    if (!estaEnModoPwa()) return;

    try {
      marcarEstadoInicial();
      var state = history.state;
      if (!state || !state[BACK_GUARD_STATE]) {
        var guardState = construirEstado(BACK_GUARD_STATE);
        history.pushState(guardState, '', window.location.href);
      }
    } catch (error) {
    }
  }

  function crearBotonInstalar() {
    if (installButton) return installButton;

    installButton = document.createElement('div');
    installButton.style.cssText = [
      'position:fixed',
      'left:50%',
      'top:10px',
      'transform:translateX(-50%)',
      'z-index:99998',
      'display:none',
      'align-items:center',
      'gap:8px',
      'background:#c0557a',
      'border-radius:999px',
      'padding:10px 8px 10px 18px',
      'box-shadow:0 8px 24px rgba(192,85,122,0.28)',
      'font-family:Nunito,Arial,sans-serif'
    ].join(';');

    var textoBtn = document.createElement('button');
    textoBtn.type = 'button';
    textoBtn.textContent = 'Agregar a pantalla de inicio';
    textoBtn.setAttribute('aria-label', 'Agregar SuperKids a pantalla de inicio');
    textoBtn.style.cssText = [
      'border:none',
      'background:transparent',
      'color:#fff',
      'font-family:Nunito,Arial,sans-serif',
      'font-weight:800',
      'font-size:14px',
      'cursor:pointer',
      'padding:0'
    ].join(';');

    var cerrarBtn = document.createElement('button');
    cerrarBtn.type = 'button';
    cerrarBtn.textContent = '✕';
    cerrarBtn.setAttribute('aria-label', 'Cerrar aviso de instalar app');
    cerrarBtn.style.cssText = [
      'border:none',
      'background:rgba(255,255,255,0.25)',
      'color:#fff',
      'border-radius:50%',
      'width:24px',
      'height:24px',
      'font-size:13px',
      'font-weight:700',
      'cursor:pointer',
      'flex-shrink:0',
      'padding:0'
    ].join(';');

    textoBtn.addEventListener('click', function () {
      if (!deferredInstallPrompt) return;
      installButton.style.display = 'none';
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.finally(function () {
        deferredInstallPrompt = null;
      });
    });

    cerrarBtn.addEventListener('click', function () {
      installButton.style.display = 'none';
    });

    installButton.appendChild(textoBtn);
    installButton.appendChild(cerrarBtn);
    document.body.appendChild(installButton);
    return installButton;
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    crearBotonInstalar().style.display = 'flex';
  });

  window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    if (installButton) installButton.style.display = 'none';
  });

  window.addEventListener('load', function () {
    setTimeout(function () {
      activarProteccionAtras();
      prepararClicksInternos();
      prepararHistorialInterno();
      var intentos = 0;
      var timer = setInterval(function () {
        prepararClicksInternos();
        prepararHistorialInterno();
        intentos += 1;
        if (funcionesNavegacionPreparadas || intentos > 20) clearInterval(timer);
      }, 250);
    }, 350);
  });

  window.addEventListener('popstate', function (event) {
    if (!estaEnModoPwa() || backExitRequested) return;

    if (event.state && (event.state[BACK_INTERNAL_STATE] || event.state[BACK_GUARD_STATE])) {
      ocultarDialogoSalida();
      restaurarEstadoInterno(event.state);
      return;
    }

    if (!event.state || event.state[BACK_INITIAL_STATE]) {
      mostrarDialogoSalida();
    }
  });
})();

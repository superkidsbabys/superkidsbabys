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
  var backExitRequested = false;
  var backDialog = null;

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

  function marcarEstadoInicial() {
    try {
      var state = history.state;
      var base = state && typeof state === 'object' ? state : {};
      if (!base[BACK_INITIAL_STATE]) {
        var nuevoEstado = Object.assign({}, base);
        nuevoEstado[BACK_INITIAL_STATE] = true;
        history.replaceState(nuevoEstado, '', window.location.href);
      }
    } catch (error) {}
  }

  function activarProteccionAtras() {
    if (!estaEnModoPwa()) return;

    try {
      marcarEstadoInicial();
      var state = history.state;
      if (!state || !state[BACK_GUARD_STATE]) {
        var guardState = {};
        guardState[BACK_GUARD_STATE] = true;
        history.pushState(guardState, '', window.location.href);
      }
    } catch (error) {}
  }

  function crearBotonInstalar() {
    if (installButton) return installButton;

    installButton = document.createElement('button');
    installButton.type = 'button';
    installButton.textContent = 'Agregar a pantalla de inicio';
    installButton.setAttribute('aria-label', 'Agregar SuperKids a pantalla de inicio');
    installButton.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:18px',
      'transform:translateX(-50%)',
      'z-index:99998',
      'display:none',
      'border:none',
      'border-radius:999px',
      'padding:12px 18px',
      'background:#c0557a',
      'color:#fff',
      'font-family:Nunito,Arial,sans-serif',
      'font-weight:800',
      'font-size:14px',
      'box-shadow:0 8px 24px rgba(192,85,122,0.28)',
      'cursor:pointer'
    ].join(';');

    installButton.addEventListener('click', function () {
      if (!deferredInstallPrompt) return;
      installButton.style.display = 'none';
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.finally(function () {
        deferredInstallPrompt = null;
      });
    });

    document.body.appendChild(installButton);
    return installButton;
  }

  window.addEventListener('beforeinstallprompt', function (event) {
    event.preventDefault();
    deferredInstallPrompt = event;
    crearBotonInstalar().style.display = 'block';
  });

  window.addEventListener('appinstalled', function () {
    deferredInstallPrompt = null;
    if (installButton) installButton.style.display = 'none';
  });

  window.addEventListener('load', function () {
    setTimeout(activarProteccionAtras, 350);
  });

  window.addEventListener('popstate', function (event) {
    if (!estaEnModoPwa() || backExitRequested) return;

    if (!event.state || event.state[BACK_INITIAL_STATE]) {
      mostrarDialogoSalida();
    }
  });
})();

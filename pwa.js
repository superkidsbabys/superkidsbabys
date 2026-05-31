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
})();

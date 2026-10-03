(function () {
  'use strict';

  function crearIndicadorConexion() {
    if (document.getElementById('superkids-estado-conexion')) return;
    var indicador = document.createElement('div');
    indicador.id = 'superkids-estado-conexion';
    indicador.setAttribute('role', 'status');
    indicador.setAttribute('aria-live', 'polite');
    indicador.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483000;padding:9px 15px;border-radius:999px;font:800 13px Nunito,Segoe UI,sans-serif;box-shadow:0 5px 18px rgba(0,0,0,.2);transition:.25s;max-width:90vw;text-align:center;';
    document.body.appendChild(indicador);

    function actualizar() {
      if (navigator.onLine) {
        indicador.textContent = '☁️ Con conexión · sincronizando cambios';
        indicador.style.background = '#dcfce7';
        indicador.style.color = '#166534';
        indicador.style.border = '1px solid #86efac';
        setTimeout(function () {
          if (navigator.onLine) indicador.style.opacity = '0';
        }, 3500);
      } else {
        indicador.textContent = '📴 Sin internet · los cambios quedan guardados en este equipo';
        indicador.style.background = '#fff7ed';
        indicador.style.color = '#9a3412';
        indicador.style.border = '1px solid #fdba74';
        indicador.style.opacity = '1';
      }
    }

    window.addEventListener('online', function () {
      indicador.style.opacity = '1';
      actualizar();
      window.dispatchEvent(new CustomEvent('superkids-conexion-restaurada'));
    });
    window.addEventListener('offline', actualizar);
    actualizar();
  }

  document.addEventListener('DOMContentLoaded', crearIndicadorConexion);

  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js?v=20261002-v36', { scope: './' })
        .then(async function (registro) {
          registro.update().catch(function () {});
          // Guardar la dirección exacta que abrió la usuaria. En algunos
          // servidores pedidos.html se publica con otro nombre o ruta.
          var listo = await navigator.serviceWorker.ready;
          var trabajador = listo.active || registro.active || registro.waiting;
          if (trabajador) trabajador.postMessage({ tipo: 'GUARDAR_PANTALLA', url: location.href });
        })
        .catch(function (error) { console.warn('Modo offline no pudo instalarse:', error.message); });
    });
  }
})();

# Sofía V73 — candidato de producción

Este paquete crea un Worker de producción **separado** del Worker `superkids-whatsapp-test`. No reemplaza el Worker de prueba ni utiliza su base D1.

## Antes de activar

1. Crea una base D1 nueva, por ejemplo `superkids-whatsapp-produccion`.
2. En esa base, ejecuta una sola vez `D1-PRODUCCION.sql`.
3. Crea un Worker nuevo para producción; conserva el Worker de prueba tal como está.
4. Copia `worker-whatsapp.mjs` al Worker nuevo.
5. Vincula la nueva base D1 con el nombre exacto `WHATSAPP_PROD_DB`.
6. Configura inicialmente `WHATSAPP_MODE=disabled`. Así Meta puede verificar el webhook sin que Sofía responda todavía.
7. Agrega los secretos existentes, sin pegarlos en el código: `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `OPENAI_API_KEY` y `WHATSAPP_PEDIDOS_SECRET`. Conserva el binding de servicio `SUPERKIDS_PAGOS_API`.
8. Establece `SOFIA_PEDIDOS_ENABLED=true` solamente después de hacer una conversación real de verificación con un número interno. Para la bandeja del equipo: `INBOX_ENABLED=true`.
9. Configura un cron cada minuto. Es necesario para que, tras dos minutos sin actividad, Sofía pregunte si desea continuar comprando o pasar a los datos de envío.
10. Verifica el webhook de Meta con esta nueva URL y el número real. Cuando todo esté comprobado, cambia únicamente `WHATSAPP_MODE` a `production`.

## Alcance inicial

- Recibe texto normal: las clientas no necesitan escribir `IA PRUEBA:`.
- Conserva el carrito y la memoria por conversación, incluidos mensajes como “la que escogí arriba”.
- Crea pedidos y descuenta existencias solo cuando el flujo llega a la confirmación final.
- El flujo de foto queda fuera del lanzamiento inicial; no procesa imágenes hasta hacer una prueba separada.
- Las notificaciones fuera de la ventana de atención de WhatsApp requieren una plantilla aprobada por Meta.

## Validado localmente

- Sintaxis JavaScript.
- Aislamiento de binding y tablas de producción.
- Esquema D1 de las tablas usadas por el Worker.

No se ha conectado este paquete a Meta ni se ha cambiado el Worker de pruebas.


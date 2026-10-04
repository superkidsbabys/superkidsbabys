# SuperKids inventario seguro v37

Esta carpeta es una copia de trabajo. No modifica el sitio publicado ni los datos reales por sí sola.

## Qué corrige

- Todas las sesiones leen las existencias desde el catálogo generado por Firebase Admin.
- Si no se puede verificar el inventario, se bloquean las compras en vez de mostrar stock viejo.
- Las ventas del catálogo y del panel de Gestión usan la misma transacción del servidor.
- Pedido, descuento de tallas, consecutivo, idempotencia y movimiento de inventario se guardan juntos.
- Las anulaciones autentican a Yohana o Ángela y devuelven stock una sola vez, en un único commit.
- Las colas locales antiguas de devolución se archivan sin ejecutarse.
- El historial ya no ofrece botones para volver a sumar stock manualmente.
- La caché se actualizó a v37 para desalojar páginas antiguas en otros equipos.

## Orden seguro de publicación

1. Exportar/respaldar las colecciones `productos`, `pedidos`, `auditoria` y `contadores`.
2. Publicar primero `superkids-pagos-api.js` en el Worker.
3. Probar con una referencia de prueba: venta de una unidad, recarga en dos sesiones y anulación.
4. Confirmar en Firebase el movimiento `venta-*` y luego `anulacion-pedido-*`.
5. Publicar `index.html`, `pedidos.html`, `pwa.js`, `sw.js` y `sw-gestion.js`.
6. Aplicar `firestore.rules.proposed` solo después de revisar que coincide con las reglas completas actuales; el archivo es una propuesta, no debe reemplazar reglas desconocidas a ciegas.
7. Reconstruir una vez el catálogo público desde Gestión.

## Prueba técnica local

```powershell
node --check superkids-pagos-api.js
node tests/inventory-safety.test.cjs
```

La corrección de cantidades históricas no se automatiza sin inventario físico: primero se genera una comparación y se aprueba referencia por referencia. Esto evita repetir el error de sumar desde el historial.

# Códigos internos por talla

## Base de trabajo
Copia de superkids-v15-etiqueta-remitente con el último ajuste de etiqueta de envío: menos espacio inferior y remitente más grande.

## Funcionamiento acordado
- Cada color tiene su propia referencia.
- El catálogo conserva una publicación por referencia con sus tallas.
- Cada combinación de referencia y talla tendrá un código de barras interno único, persistente y generado automáticamente.
- Las unidades de una misma referencia y talla compartirán el código.
- Las reposiciones reutilizarán el código existente.
- El código interno no creará publicaciones adicionales en el catálogo.
- La etiqueta mantendrá el código de barras, la referencia y debajo la talla bien visible.
- Al escanear se identificará la referencia y la talla exactas.
- La verificación de pedidos avisará si la talla escaneada no corresponde.

## Pendiente de implementación
Revisar el registro de productos, las tallas, la impresión y los lectores actuales. Definir el formato interno y su compatibilidad con etiquetas existentes antes de implementar.

Estado: carpeta preparada; funcionalidad nueva todavía no implementada.
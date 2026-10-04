const fs = require('fs');
const path = require('path');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const pedidos = fs.readFileSync(path.join(root, 'pedidos.html'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'superkids-pagos-api.js'), 'utf8');

assert(index.includes('inventarioAutoritativoDisponible = false'));
assert(/productosDB = \[\];\r?\n\s+renderizarCatalogo\(\);/.test(index));
assert(index.includes('/crear-pedido-contraentrega'));
assert(pedidos.includes("'Authorization': 'Bearer ' + tokenSesion"));
assert(pedidos.includes('const pedidoActualizado = await anularPedidoEnServidor(pedido)'));
assert(!pedidos.includes('await persistirPedidoEnFirebase(pedido, null, true);\n                    await devolverStockPedido(pedido)'));
assert(!pedidos.includes('id="restaurar-referencias"'));
assert(!pedidos.includes('id="corregir-ref-100014"'));
assert(worker.includes("writeCrearDocumento('movimientos_inventario', 'venta-' + requestId"));
assert(worker.includes("'movimientos_inventario', 'anulacion-pedido-' + numero"));
assert(worker.includes("const actor = await autenticarStaff(request)"));
assert(worker.includes("['admin', 'despachos'].includes(actor.rol)"));
assert(worker.includes("IEB65uKdgldevmgRuenCj7pPwc12"));

console.log('OK: invariantes de inventario seguro verificadas.');

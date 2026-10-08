# Base PCM para el mostrador

## Decisión vigente · 8 de octubre de 2026

El usuario pidió mantener la aplicación anterior como base, con su estética, recomendaciones y flujo de vendedor/cliente. La aplicación principal es la de la raíz (`server/`, `src/`); el prototipo de `app/` no la reemplaza. La propuesta de migración de abajo queda suspendida. Los cambios futuros deben conservar las funciones existentes del mostrador.

Para pruebas locales con catálogo real y facturación simulada, en PowerShell:

```powershell
$env:FACTURACION = 'simulada'
npm run dev
```

Vendedor: `http://localhost:5173/vendedor`. Cliente: `http://localhost:5173/cliente`. Ajustes: `http://localhost:5173/admin`. La variable se aplica a esa sesión; no cambia la configuración de facturación del archivo `.env`.

Revisión: 7 de octubre de 2026. Referencia: https://github.com/PCMIDIDEV/pcm-boilerplate, commit `52f88f129cefecc06bc0fc58cfed40d8b41a8490`.

El repositorio se clonó en `referencias/pcm-boilerplate` para revisarlo. No se modificó su código ni se reemplazó la aplicación actual. Esta revisión es de código y documentación; el boilerplate no se instaló ni se ejecutó.

## Qué aprovechar

La base usa Next.js, TypeScript, PostgreSQL/Drizzle y un worker pg-boss. Incluye autenticación, permisos por espacio de trabajo, auditoría y conectores de Contabilium y Tiendanube. Su conector de Contabilium ya separa los datos del proveedor de la lógica de cada aplicación, sincroniza catálogo y stock, y controla las solicitudes desde una base de datos compartida.

Conviene construir el negocio del mostrador como un módulo propio en `src/server/modules/mostrador`, con pantallas en `src/features/mostrador`. Las integraciones reutilizan los conectores existentes; las ventas, sus pagos y la configuración de las pantallas pertenecen al módulo del mostrador.

## Diferencias que hay que resolver

| Función actual | Adaptación en la base |
| --- | --- |
| Vendedor y pantalla de cliente sincronizados por Socket.IO | Implementar un canal entre ambas pantallas, con venta y revisión persistentes. La base revisada no trae este flujo. |
| MercadoPago: débito/crédito completo y cobranza automática | Ampliar el conector: su transporte actual rechaza `emitirFECobrada`. Conservar la condición MercadoPago y el destino automático existente. |
| Efectivo: efectivo, transferencia o combinación de ambos | Agregar cobranza manual después de emitir, con varios medios e importes que sumen el total autorizado. |
| Otros: tarjeta combinada con efectivo o transferencia | Mantener etiqueta «Otros» y condición real «Otro»; registrar los medios por separado. |
| Guardado de cobranza | Ampliar el conector: no implementa `/comprobantes/cobrar`. Conservar lectura del saldo antes de enviar y revisión ante una respuesta incierta. |
| Facturación directa desde el mostrador | Adaptar la orquestación: la base propone dos clics, crear borrador y emitir. Mantener el flujo solicitado para cada condición de venta. |
| Historial JSON y recuperación de una cobranza pendiente | Llevarlos a tablas propias, con operaciones persistentes y estados que sobrevivan a un reinicio. |
| Ofertas, ahorro destacado, videos y QR de opiniones | Portar las pantallas y su configuración sin alterar las reglas comerciales. |

## Orden propuesto

1. Preparar una aplicación nueva sobre la base, definir la marca y el acceso de los vendedores, y crear el módulo del mostrador. La aplicación actual sigue disponible mientras se hace la transición.
2. Incorporar catálogo, carrito y sincronización vendedor/cliente. Reutilizar las reglas actuales de precios, descuentos y documentos del cliente.
3. Ampliar Contabilium para los tres flujos de venta. Todas las llamadas fiscales de una misma conexión deben compartir la coordinación del conector, incluida la cobranza automática, para evitar emisiones simultáneas.
4. Incorporar cobranza manual, sus destinos y recuperación. Los destinos leídos para esta cuenta son Almagro (caja 1326), BBVA pesos (banco 2068) y MercadoPago pesos (banco 2075); deben ser configuración de la conexión, no constantes universales.
5. Portar pantalla de cliente, ofertas, videos, QR de opiniones y administración. Verificar los recorridos con proveedores simulados antes de cambiar el servicio real.

No modificar las condiciones globales de Contabilium usadas por Mercado Libre. No reenviar automáticamente una emisión o una cobranza cuyo resultado sea incierto. La cobranza implementada actualmente cubre el pago completo de una factura en pesos con varios medios; pagos parciales, retenciones y otras monedas requieren trabajo adicional.

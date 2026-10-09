# Mostrador · PC MIDI Center

Sistema de mostrador con **pantalla para el cliente** (estilo Clover), **recomendaciones con descuento** (cross-selling) y **facturación electrónica en Contabilium** ingresando DNI o CUIT y condición frente al IVA.

- **Pantalla del vendedor** (`/vendedor`): busca y agrega productos, ve las sugerencias, elige medio de pago y factura.
- **Pantalla del cliente** (`/cliente`, segundo monitor): ve en vivo lo que se le cobra, las sugerencias con descuento y, al final, un QR para dejar una opinión en Google. Sin venta en curso, pasa ofertas, productos destacados y videos.
- **Ajustes** (`/admin`): reglas de recomendación, productos destacados, descuentos, topes y métricas (cuántas veces se mostró y aceptó cada sugerencia).

## Instalar en otra computadora

Requisitos (Windows):

- **Node.js 22 LTS** o superior: descargalo de [nodejs.org](https://nodejs.org) e instalalo con las opciones por defecto.
- **Git**: [git-scm.com](https://git-scm.com/download/win).
- **Google Chrome** instalado en la ruta normal (`C:\Program Files\Google\Chrome\Application\chrome.exe`). Solo lo usa `iniciar-mostrador.bat` para abrir las pantallas.

Pasos:

1. Abrí una terminal (PowerShell o Git Bash) en la carpeta donde lo quieras guardar y descargá el proyecto:

   ```bash
   git clone https://github.com/luchimbo/mostrador.git
   cd mostrador
   ```

2. Instalá las dependencias:

   ```bash
   npm install
   ```

3. Creá el archivo de configuración copiando el ejemplo:

   ```bash
   copy .env.example .env
   ```

   (En Git Bash: `cp .env.example .env`). Así como viene arranca en **modo prueba** (`CONTABILIUM_MODE=mock`): catálogo de ejemplo y facturas falsas, sin tocar Contabilium. Para usar el catálogo y la facturación reales, completá las credenciales y los IDs como se explica en [Puesta en marcha con Contabilium](#puesta-en-marcha-con-contabilium). El `.env` **no se sube a GitHub**: hay que crearlo (o copiarlo a mano, por un medio seguro) en cada computadora.

4. Iniciá el mostrador:
   - **Uso en el local:** doble clic en `iniciar-mostrador.bat`. La primera vez arma la versión de producción y después abre la pantalla del vendedor y la del cliente (ver [Uso diario](#uso-diario)).
   - **Solo probar en el navegador:** `npm run build` y luego `npm start`, y abrí <http://localhost:3000/vendedor>, <http://localhost:3000/cliente> y <http://localhost:3000/admin>.
   - **Para programar:** `npm run dev` y abrí <http://localhost:5173/vendedor> (se recarga solo al editar).

5. Opcional: `npm test` corre los tests para confirmar que todo quedó bien instalado.

**Datos que no viajan con GitHub.** La carpeta `data/` (reglas de recomendación, ajustes, destinos de cobranza, facturas emitidas y registro de ventas) queda solo en cada computadora. En una instalación nueva se arranca con las reglas de ejemplo. Para llevarte la configuración de la compu actual, copiá la carpeta `data/real/` (o `data/mock/`) a la misma ubicación en la nueva, con el servidor cerrado.

**Actualizar a la última versión** en una computadora ya instalada:

```bash
git pull
npm install
npm run build
```

El `npm run build` es necesario porque `iniciar-mostrador.bat` solo arma la versión de producción si no existe la carpeta `dist`.

## Uso diario

### Pantalla en reposo y opiniones

En **Ajustes → Pantalla en reposo** se configura la vidriera del cliente:

- **Ofertas automáticas** (predeterminado): productos con precio de lista mayor al precio actual, foto y stock. Muestra precio anterior, precio actual y ahorro. Si no hay ofertas, usa los destacados; si tampoco hay productos disponibles, muestra el logo.
- **Selección manual** o **ofertas y selección manual**: usa los destacados elegidos abajo. Los productos excluidos no aparecen en la rotación.
- **Videos de YouTube**: pegá enlaces, elegí título, inicio y final opcional, y asociá un producto para mostrar su nombre y precio al costado. Podés activarlos, quitarlos y cambiar el orden. Siempre se reproducen sin sonido. Por defecto pasan tres productos de 10 segundos y un fragmento de 30 segundos. Requieren conexión y que el video permita reproducción insertada; si fallan o se bloquea la reproducción automática, la pantalla sigue con productos.
- **Opiniones**: ya está cargado el enlace del QR de Google de PC MIDI. Podés cambiarlo o dejarlo vacío para ocultarlo. Al finalizar una venta aparece con cinco estrellas decorativas durante 45 segundos.

Guardá los cambios con **Guardar pantalla**. La selección manual se guarda al agregar o quitar productos. Al comenzar una venta se interrumpe la vidriera y se muestra la compra inmediatamente.

Para probar con un producto de Contabilium que no está publicado en la tienda, agregá su ID en `PRODUCTOS_PRUEBA_IDS` del `.env` y reiniciá el servidor. Se muestra como **Producto de prueba**, usando su precio de Contabilium, tanto con facturación simulada como real. No aparece en la vidriera ni como sugerencia. En esta cuenta, **PRODUCTO DEMO** tiene ID `26604` y código `1`. En modo real, este producto también genera una factura real al confirmar el cobro.

Doble clic en **`iniciar-mostrador.bat`**. Levanta el servidor y abre las dos pantallas (la del cliente en pantalla completa en el segundo monitor). Si el monitor principal no mide 1920 px de ancho, editá `SEGUNDO_MONITOR_X` en el `.bat`. Para salir de la pantalla del cliente: `Alt+F4`.

## Cómo funciona una venta

1. El vendedor agrega productos; el cliente los ve con precio final (IVA incluido, precio de la tienda online).
2. Si hay reglas que aplican, el cliente ve "Para completar tu equipo" con el descuento. Si acepta, el vendedor toca **+ Agregar** en la sugerencia. El descuento vale mientras el producto que lo disparó siga en la venta.
3. Medio de pago: **efectivo o transferencia aplican 5%** de descuento (configurable). Mientras no se elija, el cliente ve ambos totales.
   - **Transferencia**: se cobra con la condición **MercadoPago** eligiendo *Forma de pago → Transferencia*. Lleva el descuento de contado y la cobranza se registra automáticamente, como con tarjeta.
   - **Total a cobrar** (opcional): después de elegir la condición de venta, el vendedor puede escribir un total menor para redondear (por ejemplo $235.500), o usar los botones que redondean a miles. Enter aplica el ajuste, no factura. El cliente lo ve como "Redondeo". La factura suma exactamente ese total: cada producto lleva su parte del precio final, sin bonificación. El ajuste se borra si cambian los productos o la condición de venta, y no puede superar el total de la venta.
4. Ingresá el DNI o CUIT (obligatorio) y después elegí la condición frente al IVA:
   - Consumidor Final o Exento → Factura B, identificada con el documento ingresado
   - Responsable Inscripto o Monotributista → CUIT obligatorio y Factura A
   - Cliente existente → la condición elegida debe coincidir con su registro en Contabilium
   - CUIT nuevo → pide razón social, lo da de alta con la condición elegida y factura
5. Se emite según la condición de venta: MercadoPago registra cobranza automática; Efectivo y Otros quedan para cobranza manual. La pantalla del cliente agradece la compra, muestra el QR para dejar una opinión en Google y vuelve al reposo a los 45 segundos.

## Catálogo: Contabilium + tienda online

El mostrador muestra **solo los productos publicados en la tienda online** (Tiendanube), emparejando el SKU de la tienda con el código del producto en Contabilium:

| Dato | De dónde sale |
|---|---|
| Precio (pantalla y factura) | Tienda online |
| Nombre que ve el cliente | Tienda online |
| Categoría y subcategoría (para las reglas) | Tienda online |
| Foto | Tienda online (si Contabilium tiene foto, esa tiene prioridad) |
| Id del producto (stock), IVA, costo, nombre en la factura | Contabilium |

La tienda se lee del sitemap público y de los datos de cada página de producto, sin claves. Las páginas de producto de la tienda quedan hasta 24 horas en el caché de Cloudflare, así que los **precios** se leen del listado de productos (`/productos/?page=N` con un parámetro que evita el caché): unas 30 páginas, con el precio de venta y el tachado de cada SKU. Se actualizan al iniciar, **cada 30 minutos** o con **Actualizar precios** en la pantalla del vendedor (unos 20 segundos). Las variantes con SKU propio que no aparecen en el listado (por ejemplo, otro color) conservan el precio de la lectura completa. La **lectura completa** de las páginas de producto (categorías, fotos y productos nuevos) se hace una vez por día o a mano desde **Ajustes → Tienda online**, donde también figuran los productos publicados que no tienen un código igual en Contabilium. El costo interno de Contabilium está en dólares, así que se pasa a pesos usando la rentabilidad cargada (precio neto ÷ (1 + rentabilidad)).

En modo real, la primera vez se precargan reglas de ejemplo (controladores, pianos, sintes, micrófonos, interfaces, cuerdas) con productos reales; se editan en **Ajustes → Recomendaciones**.

Los descuentos nunca superan el **tope** ni dejan el precio por debajo de **costo + margen mínimo** (usa el costo interno de Contabilium).

## Puesta en marcha con Contabilium

1. Copiá `.env.example` como `.env` y completá `CONTABILIUM_CLIENT_ID` (email de API) y `CONTABILIUM_CLIENT_SECRET` (API Key), de *Contabilium → Configuración → API → Credenciales*. **No compartas este archivo.**
2. Corré `npm run probar-contabilium`. Es de **solo lectura** y muestra: condición IVA de la empresa, puntos de venta, el cliente "Consumidor Final" y los primeros productos tal como los va a ver el mostrador.
3. Completá `CONTABILIUM_PUNTO_VENTA` y `CONTABILIUM_ID_CLIENTE_CF` con los Id que mostró el paso anterior.
4. Probá el formato de la factura sin efecto fiscal: `npm run probar-borrador` muestra el comprobante que armaría el mostrador (un afinador, Consumidor Final, efectivo) y con `npm run probar-borrador -- --confirmar` lo guarda en Contabilium como **borrador** (no va a ARCA). Revisalo y eliminalo.
5. Para ver el mostrador con el catálogo real sin emitir nada, usá `CONTABILIUM_MODE=real` con `FACTURACION=simulada`: las facturas son de prueba y aparece el cartel "FACTURACIÓN SIMULADA". Para facturar de verdad, borrá la línea `FACTURACION`.
   Cambiá `CONTABILIUM_MODE=real` y reiniciá. Arriba de la pantalla del vendedor desaparece el cartel "MODO PRUEBA".
6. Revisá las reglas en `/admin`: en modo real se precargan con productos reales la primera vez (las de prueba quedan en `data/mock/`).

### Facturación y cobranza reales

El formato se basa en la [documentación oficial de Contabilium](https://documenter.getpostman.com/view/27097926/2sBYHNWNCj). Los códigos de factura son FCA y FCB.

El vendedor elige una de tres condiciones: MercadoPago, Efectivo u Otros. MercadoPago es para pagos completos con débito/crédito; usa emitirFECobrada con Pagos: null para tomar el destino de la condición existente. Efectivo incluye efectivo, transferencia o ambos. Otros es para tarjeta combinada con efectivo/transferencia; se envía con el nombre exacto "Otro" de la cuenta. Ambas condiciones manuales crean un borrador con Pagos: null y lo emiten con /comprobantes/emitirFE. Aunque emitirFE usa GET, tiene efecto fiscal y nunca se reintenta automáticamente.

Completá CONTABILIUM_INVENTARIO con el ID del depósito. Los nombres de las condiciones se pueden ajustar con las variables *_CONDICION de .env.example. El servidor verifica que MercadoPago tenga cobranza automática y cuenta de destino, y que Efectivo/Otros sean manuales. No cambia las condiciones compartidas de Contabilium. Efectivo mantiene el descuento de contado; MercadoPago y Otros no aplican ese descuento.

Tras recibir CAE, MercadoPago muestra la cobranza automática. Efectivo y Otros pasan a un formulario manual en la app: agregar medios, seleccionar la caja/cuenta, asignar importes y referencias y guardar. Los importes deben cubrir el total. Efectivo admite efectivo/transferencia; Otros admite también la parte de tarjeta por MercadoPago. Los destinos en pesos verificados en la sesión del usuario se guardan en data/real/destinos-cobranza.json; no se ofrecen cuentas en dólares.

La cobranza manual consulta primero la factura por ID y verifica CAE, total y saldo completo pendiente. Si existe un cobro previo, incluso parcial, se requiere revisar en Contabilium para evitar que /comprobantes/cobrar reemplace el recibo. No se reintenta un POST ni se repite una factura para corregir el cobro. Si no se puede confirmar la respuesta del cobro, el estado queda para revisión. Este flujo cubre una factura en pesos, con cobro completo repartido entre medios; cobranzas parciales, retenciones y otras monedas se gestionan en Contabilium.

### Efectivo sin factura (cotización)

Con condición **Efectivo**, el vendedor puede elegir **Sin factura (cotización)**. Se crea el comprobante como en *Ventas → Facturación* con tipo de comprobante **Cotización** (`TipoFc: "COT"`, solo `/comprobantes/crear`, no va a ARCA ni tiene CAE). El resto es igual a Efectivo: condición de venta Efectivo, descuento de contado y cobranza manual con los mismos medios y destinos. El DNI/CUIT es opcional; sin documento se usa el cliente `CONTABILIUM_ID_CLIENTE_CF`. Antes de cobrar se verifica que el comprobante siga siendo una cotización sin CAE, con el total y el saldo completos. Para ver el formato: `npm run probar-borrador -- --cotizacion` (con `--confirmar` la crea en Contabilium; revisala y eliminala).

La factura y su estado de cobranza sobreviven a un reinicio en factura-en-cobranza.json. La condición y modalidad quedan en ventas.jsonl, y la cobranza registrada o incierta en cobranzas.jsonl. El agradecimiento y QR de opiniones aparecen después de guardar la cobranza manual. También se puede dejar pendiente y retomarla desde Ajustes → Facturas emitidas. Las cobranzas automáticas con CAE y error conservan la factura y requieren revisar el cobro.

En **Ajustes → Facturas emitidas → Informe de ventas en Excel**, el botón **Guardar Excel** guarda un `.xlsx` en la carpeta `informes` del mostrador (por ejemplo `D:\Mostrador\informes`), en la computadora donde corre el servidor. Cada informe lleva en el nombre el rango y la hora en que se generó. La carpeta no se sube a GitHub. El archivo tiene una fila por venta: fecha, comprobante, producto principal, productos agregados (los que entraron por una recomendación aceptada), precio total y precio de los agregados, más una fila de totales. Se puede filtrar por rango de fechas; sin fechas incluye todas. Los precios son lo cobrado: con Efectivo, el descuento de contado se reparte en proporción entre los productos.

Las facturas quedan disponibles en Ajustes → Facturas emitidas, incluso después de iniciar otra venta. Ese historial se actualiza con cobranzas hechas desde la app; no comprueba cobros cargados posteriormente en Contabilium hasta que se intenta retomar la cobranza.

Si falla la emisión después de crear el borrador, su ID se conserva en el error y en data/real/facturas-pendientes.jsonl. Revisalo en Contabilium antes de iniciar otra emisión. Una factura con CAE no se vuelve a emitir aunque haya una advertencia.

Verificá el total final de Contabilium frente al mostrador; el redondeo de precios netos puede producir diferencias de centavos.

## Desarrollo

```bash
npm install
npm run dev        # servidor con recarga + Vite en http://localhost:5173
npm test           # tests de precios, descuentos, recomendaciones y armado de factura
npm run build && npm start   # versión de producción en http://localhost:3000
```

Estructura:

- `server/index.js`: servidor, sincronización en vivo (Socket.IO) y API de ajustes
- `server/sale.js`: estado de la venta en curso
- `server/pricing.js`: precios, descuento contado, topes y margen
- `server/recommendations.js`: motor de reglas de cross-selling
- `server/invoice.js`: armado del comprobante y letra de factura
- `server/contabilium.js`: cliente de la API de Contabilium
- `server/tiendanube.js`: precios, categorías y fotos desde la tienda online
- `server/mock.js`: catálogo (productos reales de la tienda) y Contabilium simulados para el modo prueba
- `src/`: pantallas (React)
- `data/<modo>/`: catálogo en caché, reglas, ajustes y registro de ventas

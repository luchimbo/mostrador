# Cross-selling online: estado y puesta en marcha

Implementación preparatoria en Mostrador y Logitrack. Las reglas comerciales están desactivadas. Se comprobó un descuento temporal de $1 y su retirada en la demo, y se dejó esa promoción desactivada al terminar.

## Implementado

- Motor común en `shared/`: reglas, nombres/exclusiones, orden, límite de sugerencias y descuentos con margen mínimo. Mostrador lo utiliza mediante sus exports anteriores.
- Adaptador de catálogo por SKU y variante. Descarta SKUs ambiguos, productos despublicados, sin precio, sin stock y de prueba.
- Evaluador puro de comandos de descuentos: aceptación por tienda/carrito/variante/regla/versión, vencimiento, retirada del principal, desactivación y cantidades. Usa el precio autoritativo del callback para recalcular el margen.
- Publicación HMAC SHA-256 por tienda, ventana de cinco minutos, versión de contenido y protección contra publicaciones anteriores. La clave permanece en los servidores.
- Recepción persistente en Logitrack con esquema propio. Las fallas no reemplazan la última configuración válida. El estado público no incluye costos ni tokens.
- Panel **Ajustes → Cross-selling online** para elegir reglas, publicar y consultar estado. Los cambios guardados en reglas, ajustes y catálogo vuelven a publicar si se configuró la conexión.
- Cliente de TN ampliado para catálogo, promociones y registro del callback. El guardado de configuración no registra callbacks ni crea promociones.

## Verificación real realizada el 16 de octubre de 2026

- PC MIDI: tienda `78394`, tema **Amazonas**.
- `logitrackprueba.mitiendanube.com`: tienda `7570182`, tema **Morelia**.
- La demo quedó vinculada al workspace 2 en el servidor real. El diagnóstico autenticado confirmó tienda, catálogo y promociones accesibles. Scopes efectivos: `read_discounts`, `write_discounts`, `write_scripts`, además de los permisos de logística existentes. **No repetir OAuth ni cambiar permisos.**
- Las credenciales locales de Logitrack conservan una base inaccesible y otra con datos antiguos. No representan el estado actual de la conexión desplegada.
- El proyecto Vercel asociado localmente es `logitrack-tan`; el proyecto de la app pública es `logitrack` (`geomodi.ai`). Verificar el destino antes de desplegar. Los valores sensibles exportados de Vercel no estuvieron disponibles para una comprobación adicional.

## Configuración de servidores

Se verificaron guardados **Edit Discounts** y **Add Scripts** en LogiTrack2 (`30102`); la autorización nueva de la demo funciona. PC MIDI (`78394`) no se utilizó como sustituto de la demo ni se modificaron sus promociones.

Se corrigió el recorrido OAuth de Logitrack: el callback regresa a `/app`, el login/registro conservan un destino interno validado con el ID de tienda y las URLs antiguas de la portada se recuperan. También se corrigieron la doble decodificación de errores y la comparación de vencimientos ISO en SQLite. La publicación aislada de estas correcciones se detalla abajo.

### Despliegue de la corrección de conexión

La corrección OAuth y el acceso inicial a módulos de proveedores se publicaron en el proyecto correcto `logitrack`. Se partió de la misma revisión que estaba publicada (`6281210d9175668887b8831130474e10c9c1df2e`) y se preparó un checkout aislado en `C:\Users\PC Midi\AppData\Local\Temp\logitrack-tn-20261016`, sin incluir los cambios pendientes de logística/finanzas ni el cross-selling completo.

- Nuevo despliegue: `dpl_Bi7bNSYkFReXC3Ws8m9qzu4dkDiA`, `https://logitrack-g94aln90g-lucio-tamborinis-projects.vercel.app`, promovido a `www.geomodi.ai`.
- Despliegue anterior para reversión: `dpl_FzqzBaAVCy7mSjuiq4VdRzymgyfM`.
- Comprobaciones del checkout aislado: 42 pruebas, lint y compilación correctos; HTTP 307 del regreso antiguo al módulo TN conservando el ID y HTTP 401 del diagnóstico sin sesión.
- Diagnóstico autenticado de sólo lectura: `/api/admin/tiendanube/cross-selling/status?storeId=7570182`. Verifica la conexión del workspace del usuario, catálogo, promociones y scopes sin mostrar credenciales.
- Se confirmó el problema de navegación publicado: los módulos de proveedores sin conexión previa eran desviados a Subir Etiquetas. Se habilitó su apertura para usuarios autenticados, conservando la autorización de sus APIs.
- Las verificaciones locales con `.env.local` siguen mostrando una autorización antigua. No usarlas como prueba de que una autorización nueva en el despliegue real haya fallado: comprobar el diagnóstico autenticado del servidor.
- Se comprobó en Chrome el módulo TN publicado. El intento de consumir la autorización anterior devolvió «Sesión de autorización no encontrada o expirada». Se solicitó renovar únicamente la autorización de la demo tras publicar las correcciones; no volver a cambiar scopes de Partners. El usuario confirmó que el regreso de su última autorización incluía `7570182`.

En Mostrador, completar las variables de `.env.example`:

```dotenv
CROSS_SELLING_LOGITRACK_URL=https://<dominio-real-de-logitrack>
CROSS_SELLING_STORE_ID=7570182
CROSS_SELLING_PUBLISH_KEY=<clave-aleatoria-de-32-o-mas-caracteres>
```

En el entorno de Logitrack, asignar a la tienda la misma clave:

```dotenv
CROSS_SELLING_PUBLISH_KEYS={"7570182":"<misma-clave-aleatoria>"}
```

No usar variables `NEXT_PUBLIC_*`, tokens OAuth ni contraseñas de usuarios como clave de publicación.
No se generaron claves de publicación entre Mostrador y Logitrack. Sólo se desplegaron las correcciones de conexión, el diagnóstico y la sonda limitada a la demo.

`PUT /api/cross-selling/config?storeId=7570182` recibe `{ snapshot, revision }`; `GET` devuelve sólo estado.
Ambos requieren `x-mostrador-timestamp` y `x-mostrador-signature`. La firma cubre método, ruta con query, timestamp y hash SHA-256 del cuerpo.
La recepción admite como máximo 8 MiB. Cada tienda requiere una conexión activa en Logitrack.
Todas las respuestas mantienen `ready: false`, `enabled: false` y `stage: requires-tiendanube-test` en esta etapa, aunque Mostrador publique la intención de habilitar reglas.

## Comandos de comprobación

Desde Mostrador:

```powershell
npm test
npm run build
node scripts/sync-crossselling-engine.js 'D:\Logística' --check
```

Desde Logitrack:

```powershell
npm test
npm run build
node --env-file=.env.local scripts/probar-crossselling.mjs --store=7570182 --production --inspect-pending
```

El diagnóstico es sólo lectura y no imprime tokens. `--production` selecciona las variables `TURSO_*_PROD` del entorno local; no selecciona un proyecto Vercel.
`--inspect-pending` permite diagnosticar una autorización pendiente sin vincularla ni modificarla.

Al modificar el motor canónico, volver a distribuirlo con `node scripts/sync-crossselling-engine.js 'D:\Logística'`.
El manifest registra hashes y la prueba de Logitrack verifica la integridad de sus copias. Cada despliegue incluye sus propios archivos; no hay dependencia de rutas locales.

## Trabajo pendiente tras resolver el acceso

1. Acceso y prueba básica resueltos: catálogo/promociones/scripts verificados; aplicación y retirada real comprobadas. No volver a solicitar autorización.
2. Confirmar autenticación del callback con TN (IP/WAF o firma realmente disponible), tiempo de respuesta de 800 ms y combinación con promociones existentes. No inventar cabeceras de firma.
3. Probar en un checkout real: aplicación, retirada, cantidades, centavos, transferencia y cupón. TN agrupa medios de pago y cupones en una opción; el evaluador excluye carritos con cupones.
4. Implementar el callback HTTP, persistencia de carritos/aceptaciones, autenticación de identidad del carrito y aceptación validada en servidor. El evaluador puro existente no sustituye esas interfaces. Publicar y aceptar ofertas requiere una identidad de carrito verificable, no un ID enviado sin validación por el navegador.
5. Implementar el módulo visual al agregar y en el carrito, selección de variante, refresco de catálogo TN, manejo de información vencida y métricas por canal a partir de pedidos confirmados.
6. Hecho el 19/10/2026: interruptor «Activo en la tienda online» en Ajustes → Cross-selling online. Usa `PUT/GET /api/cross-selling/module` en Logitrack con la misma firma HMAC que la publicación; por ahora sólo admite la demo. Probado: desactivar y reactivar contra la demo (promoción `cd9be1bb-…` inactiva y otra vez activa). Despliegue vigente: `dpl_3TEed6hH81SYi6kk7WDGL1neASYC`.
7. Habilitar una selección piloto en la tienda de prueba. Sólo después extender a PC MIDI y verificar su tema Amazonas por separado.

No hay endpoints comerciales públicos de sugerencias o aceptaciones ni cambios en el tema en esta etapa. Existe un callback exclusivamente de prueba. Tampoco se implementó aún la medición de ventas online o la activación en producción.

## Prueba real de descuentos completada

- Principal: MIDIPLUS AK490, variante `1503397959`, precio $162.985,80.
- Accesorio: MIDILINK MINI, variante `1503397906`, precio online promocional $30.673,20. Se conservó su descuento de precio previo.
- Sin aceptación: subtotal y total iguales, sin beneficio de la app.
- Aceptación administrativa limitada al carrito de prueba: dos accesorios y un principal sumaron $224.332,20; la app aplicó $1 y el carrito y checkout mostraron **$224.331,20**.
- Al eliminar el principal: el callback recibió la promoción aplicada y respondió `remove_discount`; subtotal y total del accesorio quedaron en **$61.346,40**, sin el beneficio de la app.
- La promoción `3ad5cdaf-facf-4f1c-a074-9c3f30a56c12` quedó `active:false` y la aceptación `enabled:false` al terminar. No se generó un pedido ni un pago.
- Evidencia en `docs/evidence/`: demo conectada, carrito sin aceptación, carrito con descuento, checkout con descuento y descuento retirado.

### Resultado técnico y límites

La sonda usa una configuración compacta firmada, vinculada a una única tienda/carrito/pareja de variantes y con vencimiento. El callback evalúa en 0–1 ms sin consultar la base; persiste la evidencia después de responder mediante `after()`. No es la implementación comercial de aceptaciones ni puede ampliarse a todos los carritos cambiando un ID.

La consulta a Turso desde el callback dio entre 475 y 1229 ms, además de la latencia de red de TN. Superó el presupuesto total de 800 ms en pruebas reales. La lectura HTTP directa con límite de 600 ms también venció. No incorporar consultas a esa base al camino crítico del callback comercial sin resolver su latencia.

Falta el módulo de compra, las aceptaciones comerciales verificables, el almacenamiento/evaluación de baja latencia, la medición y la matriz completa de transferencia/cupones/redondeos/pedido. Antes de producción falta confirmar la autenticación de callbacks de TN (IP/WAF o firma oficial), sin inventar cabeceras.

La sonda y sus interfaces están en Logitrack: `/cross-selling-test`, `/api/admin/tiendanube/cross-selling/probe` y `/api/cross-selling/demo-callback/[token]`. El panel requiere administrador del workspace y sólo opera con la demo `7570182`; las rutas no aceptan elegir una tienda de producción.

Despliegue final de mantenimiento: `dpl_2m81wKohyMqjwBMZmNoUiwrYXzkF`, promovido al proyecto correcto `logitrack`, desde el checkout aislado. No incluye las modificaciones pendientes ajenas de logística/finanzas ni activa cross-selling comercial.

Validación: Mostrador 88 tests aprobados y uno omitido por falta de base de pruebas; Logitrack 63 aprobados, checkout aislado 45 aprobados. Lint sin errores (un warning previo en `CarrierPortalClient.js`); las compilaciones desplegadas pasaron.

## Módulo «Completá tu equipo» (demo 7570182, sin desplegar)

Implementado en Logitrack, limitado a LogiTrack Prueba:

- `public/cross-selling/completa-tu-equipo.js`: al disparar `productAddedToCart` muestra hasta 3 accesorios con precio con descuento, ahorro y botón **Agregar con descuento**; también los inserta en el carrito lateral (`.js-ajax-cart-panel`). Al aceptar registra la aceptación, agrega el accesorio con `/comprar/` y abre el carrito para que TN recalcule.
- `scripts/tiendanube/completa-tu-equipo-loader.js`: archivo para subir en Partners (LogiTrack2, **sin instalación automática**, para no cargarlo en PC MIDI). Sólo carga el script publicado en geomodi.ai si la tienda es 7570182.
- `GET /api/cross-selling/storefront/offers`: ofertas calculadas con el motor de Mostrador sobre la última publicación. No expone costos. Sólo responde al origen de la demo.
- `POST /api/cross-selling/storefront/accept`: valida `cart_id` y la línea del principal contra el último carrito que TN envió al callback (no contra el navegador), recalcula la oferta y el margen y actualiza el callback.
- `POST /api/cross-selling/offer-callback/[token]`: evalúa sin base de datos. Las aceptaciones viajan en la URL firmada (TN admite 255 caracteres), por eso se conservan las 3 más recientes, con vencimiento de 2 horas. El descuento se limita a la cantidad del principal y se retira si cambia el carrito, aparece un cupón o baja el precio.
- Panel: `/cross-selling-test` → **Completá tu equipo** (activar, desactivar, instalar o quitar el script por su ID). Activar reemplaza el callback de la sonda de $1.

Límite: guardar aceptaciones en la URL sirve para la demo, no para producción. Para producción sigue pendiente un almacenamiento de baja latencia.

Puesta en marcha: clave de publicación en ambos servidores, despliegue en `logitrack` desde un checkout aislado, publicación de reglas desde Mostrador, script en Partners e instalación en la demo.

Estado al 16/10/2026:

- Clave de publicación generada: `CROSS_SELLING_PUBLISH_KEYS` (Production, sensible) en Vercel `logitrack` y las tres variables `CROSS_SELLING_*` en el `.env` de Mostrador. Una consulta firmada de estado respondió 200 (`published:false`).
- Despliegue `dpl_Bqycxxdp1BmjtvgL4QVtq785efd7` en `www.geomodi.ai`. Para revertir, usar `dpl_2m81wKohyMqjwBMZmNoUiwrYXzkF`. Desde el mismo checkout aislado se agregaron el receptor `/api/cross-selling/config`, el motor y el módulo. No incluye los cambios de logística/finanzas.
- Comprobación pública: script 200; ofertas sin origen de la demo 403; ofertas con el módulo inactivo 404; callback con firma inválida 404.

Prueba real del 19/10/2026 (módulo activo en el espacio 2, promoción `cd9be1bb-4133-4f95-9719-0c172b10b2ae`, despliegue `dpl_H6V3CpxZ4gv4rWmJnG2Y73Uqng3x`). El script se inyectó en el navegador porque el script 11451 de Partners no tenía una versión activa (`current_version: null`):

- Al agregar el AK490 aparecieron 2 ofertas de las reglas reales de Mostrador: banqueta Meike y Arturia Minifuse 1, ambas con 10%.
- **Agregar con descuento** registró la aceptación, agregó la banqueta y abrió el carrito: «Completá tu equipo: -$3.625,28», total $195.613,32 sobre $199.238,60.
- Al quitar el AK490 se retiró el descuento.
- Script de Partners: v.2 en «Probando (tienda demo)». LogiTrack Prueba es la tienda demo de Partners, así que Tiendanube ya lo carga solo (`apps-scripts.tiendanube.com/logitrack2/complet-tu-equipo/2.js`). No pasarlo a producción mientras el módulo sea sólo para la demo. Despliegue vigente: `dpl_BWknKBAScmMW4LmUDCG8JD79tmue`.
- Al cargar la página, los ítems de `LS.cart` no traen `cart_id` (sí `LS.cart.id`); el script usa ese valor como alternativa.
- Correcciones descubiertas: `/comprar/` requiere `X-Requested-With: XMLHttpRequest` para responder JSON, y TN tarda unos segundos en usar el callback actualizado (el script espera 4 s antes de agregar). La lista `/scripts` de TN llega como `{ result, total }` e incluye scripts no asociados a la tienda.

## Producción: decisión sobre aceptaciones y autenticación (19/10/2026)

Datos:
- Las funciones de Logitrack corren en `gru1` (São Paulo).
- TN da 800 ms para responder; si se pasa o la respuesta es inválida, retira los descuentos.
- La consulta a Turso desde el callback tardó entre 475 y 1229 ms.
- Documentación de TN: la autenticación actual es una lista de IPs permitidas que comparte TN («WAF»). La «comunicación firmada» con un secreto por app está anunciada, sin cabeceras ni algoritmo publicados. No hay política de reintentos documentada.

Recomendación:
1. **Aceptaciones en Upstash Redis** (Vercel Marketplace, región `sa-east-1`, junto a `gru1`). El callback hace una sola lectura por carrito (~1–5 ms). La aceptación se escribe con vencimiento de 2 h. Los eventos del callback también van ahí, para que la aceptación no espere a Turso. Se descarta Edge Config: lecturas rápidas, pero escrituras lentas y limitadas, no apta para datos por carrito. Turso queda para la configuración publicada, cacheada en memoria fuera del camino crítico.
2. **Callback con URL fija y secreta** (token HMAC en la ruta, sin aceptaciones), más **lista de IPs de TN** aplicada en el Firewall de Vercel sólo para esa ruta. Pedir las IPs a soporte de Partners. Cuando TN publique la firma, validarla y quitar la lista de IPs.
Implementado el 19/10/2026 (Logitrack `97fd8ee`, despliegue `dpl_G39XBkTdyWaLYve3WvKKJQPL5Ba3`):
- Upstash Redis conectado a `logitrack` (`KV_REST_API_*`). URL del callback fija y aceptaciones en Redis.
- Prueba real: aceptar la banqueta con el AK490 aplicó «Completá tu equipo: -$3.625,28» unos 2,9 s después del clic, sin la espera de propagación. Al quitar el AK490 se retiró. Sin Redis, el código vuelve solo al modo URL.
- Lista de IPs de TN en el Firewall de Vercel: **postergada por decisión del usuario (19/10/2026)**, para priorizar que quede funcional. Protección actual: URL secreta firmada y validación contra el carrito real de TN. Retomarla antes o después del piloto en PC MIDI, pidiendo las IPs a soporte de Partners.

3. Riesgo residual mientras tanto: con la URL secreta se podría enviar un carrito falso al callback. No aplica descuentos (sólo TN los aplica), pero podría ensuciar los eventos que validan aceptaciones. La lista de IPs lo cierra.

Referencias: [Discount API](https://tiendanube.github.io/api-documentation/v1/resources/discounts), [Scripts](https://tiendanube.github.io/api-documentation/v1/resources/script).

## Preparación para PC MIDI (19/10/2026)

Logitrack `4a6f8a7`, despliegue `dpl_Ez8wNXfVdCzN7hju5DZR4PYX1j1V`:
- Tiendas habilitadas en `src/lib/crossselling/stores.js`: demo 7570182 y PC MIDI 78394 (`www.pcmidi.com.ar`, `pcmidi.com.ar`, `tiendahsr.mitiendanube.com`). Habilitarla no la activa.
- Estado, Redis, publicación, firma del callback (`&st=78394`) y cliente TN por tienda. La URL de la demo no cambió y se volvió a probar: -$3.625,28 aplicado.
- Tema Amazonas: no tiene carrito lateral. Usa el mismo evento `productAddedToCart`; las ofertas se muestran en la ventana al agregar y en `/comprar/` dentro de `form.cart-body`, antes de los totales.
- Cargador para Partners actualizado para aceptar 78394: subir como nueva versión (v.3) y pasarla a producción, porque PC MIDI no es la tienda demo de Partners.

Falta: conexión de PC MIDI en Logitrack con permisos de descuentos y scripts, clave de publicación de 78394, Mostrador apuntando a 78394, script asociado a PC MIDI, activación y compra chica de prueba.

## PC MIDI conectada (19/10/2026)

- PC MIDI no estaba conectada a GeoModi en ningún espacio. Se conectó desde el espacio 2 (`luciopcmidi@gmail.com`) con todos los permisos, incluidos `write_discounts` y `write_scripts`. Efectos: 11 webhooks de pedidos hacia GeoModi y PC MIDI como tienda principal del espacio 2.
- Clave de publicación propia de 78394 en Vercel (`CROSS_SELLING_PUBLISH_KEYS`) y en Mostrador. Mostrador apunta a 78394 (`.env`; la clave de la demo quedó en `CROSS_SELLING_PUBLISH_KEY_7570182`). Primera publicación: 282 productos vinculados, 74 excluidos. Se subió la espera de publicación a 90 s.
- Script 11451: v.3 (cargador para 7570182 y 78394) activa en producción y asociada a 78394. Hubo que quitar y volver a instalar la asociación después de activar la versión. Tiendanube tardó unos minutos en incluirla y las páginas de producto cacheadas pueden tardar más; `/comprar/` la incluyó primero.
- Estado: el script carga y, con el módulo apagado, no muestra nada. Falta activar desde Mostrador y probar con un carrito real.

## Activo en PC MIDI (19/10/2026)

- `main` en GitHub con el cross-selling online (`f262da6`), desplegado en Railway con las variables `CROSS_SELLING_*`. Railway publicó sus reglas (10 reglas, 282 productos) y el módulo se activó desde su interruptor (promoción `9a1ad522-…`).
- Prueba real en `pcmidi.com.ar`, sin comprar: con el teclado MK2083 en el carrito, `/comprar/` mostró «Completá tu equipo» con la funda Meike chica, el soporte tijera y los auriculares, al 10%. Aceptar la funda la agregó y Tiendanube aplicó **-$705,59**. El carrito de prueba quedó vacío.
- Pendiente: las páginas de producto de PC MIDI salen del caché de Tiendanube anterior a la instalación del script. Hasta que se renueve, la ventana al agregar al carrito no aparece; en el carrito sí.

## Informe por canal (19/10/2026)

- Logitrack (`4719acf`, `dpl_9XVZoQFkxmuCAZXQoQs8KasZUX32`) registra las ofertas mostradas en la tienda (aviso `sendBeacon` por bloque y página; contadores diarios por regla en Redis), cada aceptación (Turso) y los pedidos de las tiendas habilitadas desde el webhook. Atribuye un accesorio al cross-selling cuando el pedido trae el descuento de nuestra promoción, el principal está en el pedido y hubo una aceptación de ese par en las 6 h anteriores.
- `GET /api/cross-selling/report?storeId&from&to`, firmado igual que la publicación: pedidos y facturado online (pagados y no cancelados), ventas con cross-selling, vendido, descuento otorgado, por regla (mostradas, aceptadas, vendidas, vendido) y por producto.
- Mostrador: en **Informes**, «Cross-selling por canal» con Mostrador, Tienda online y Total para el período elegido. En **Recomendaciones**, cada regla muestra «Mostrador: …» y «Online: …».
- Límites: el facturado online cuenta desde que PC MIDI quedó conectada (19/10/2026). Falta confirmar con un pedido real cómo informa Tiendanube `promotional_discount.promotions_applied`; sin ese detalle alcanza con que haya descuento promocional. El Excel sigue siendo sólo del mostrador.

## Aceptación con carrito sin confirmar (22/10/2026)

- Síntoma: «Tiendanube todavía no confirmó este carrito» al tocar **Agregar con descuento** (409 en `/storefront/accept`). En los logs del 22/10, cada 409 no tenía un callback de TN previo para ese carrito; cada 200 sí.
- Causa, comprobada en `pcmidi.com.ar`: TN llama al callback de descuentos cuando cambia el carrito (agregar, `/cart/update/`), no al mostrarlo. Cargar `/comprar/` no lo dispara. Un carrito sin cambios desde hace más de 2 h (vence el evento en Redis) o recién mostrado no tiene carrito confirmado.
- Corrección (Logitrack `230a19c`, `dpl_3m6RGLTK35jLvMnyPB66gdZ5MX3G`): el accept responde `code: "cart_pending"` (también cuando el carrito guardado no tiene el principal). El script vuelve a guardar la misma cantidad del principal en `/cart/update/`, lo que dispara el callback en ~1,5 s, y reintenta (hasta 2 veces).
- Prueba en PC MIDI con el primer accept forzado a `cart_pending` en el navegador: recálculo → callback → accept 200 → funda agregada y «Completá tu equipo: -$740,84». El carrito de prueba quedó vacío. La aceptación de prueba quedó registrada (sin pedido).
- En el navegador, el script de Partners se carga con la primera interacción (`onfirstinteraction`), no al cargar la página.

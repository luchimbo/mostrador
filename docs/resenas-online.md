# Reseñas de productos en la tienda online

Estado: **implementado y probado en local, sin desplegar ni activar**. Tiendanube no tiene reseñas propias ni un endpoint de reviews en su API; las apps del rubro (Trusty, Lily Reviews, Avalia, MeuReview) hacen lo mismo que acá: un script en la tienda que lee de un backend propio.

## Criterio
Sólo opiniones **reales** con su origen visible («Opinión en MercadoLibre», «Opinión en Google», «Opinión de Cliente de PC MIDI», con link cuando existe). No se cargan opiniones inventadas: en Argentina es publicidad engañosa (Ley 24.240 y Ley 22.802).

No se agrega JSON-LD (`AggregateRating`): las reseñas importadas de otros sitios no cumplen las pautas de Google para estrellas en los resultados, y la ficha del tema Amazonas ya trae sus propios bloques `Product`. Se puede evaluar más adelante sólo para opiniones de origen `cliente` recogidas directamente.

## Flujo
1. **Mostrador → Ajustes → Reseñas online**: cargar a mano o importar un CSV (`sku, rating, autor, texto, fecha, origen, link`; acepta `,` o `;`). Entran como *pendientes*; los SKU que no están en el catálogo se omiten con aviso.
2. Aprobar u ocultar cada una, y **Publicar ahora**. El interruptor «Activo en la tienda online» viaja dentro de la publicación: apagado, la tienda no muestra nada.
3. Mostrador firma la publicación (HMAC, misma clave `CROSS_SELLING_PUBLISH_KEY` y misma tienda `CROSS_SELLING_STORE_ID` que el cross-selling) hacia `PUT /api/reviews/config` de Logitrack.
4. Logitrack la guarda en Turso (`reviews_config`) y la sirve en `GET /api/reviews/storefront?store=&skus=` (sólo desde los dominios de la tienda; CDN 5 min).
5. `public/reviews/opiniones.js` (Logitrack) dibuja las estrellas bajo el título y el bloque «Opiniones de clientes» después de la ficha. La carga `completa-tu-equipo.js`, así que **no hace falta una versión nueva del script en Partners**.

## Dónde está
- Mostrador: `shared/reviews.js` (validación, CSV, snapshot), `server/reviews-publisher.js`, endpoints `/api/resenas*` en `server/index.js`, pantalla `src/ReviewsOnline.jsx`, pruebas `server/reviews.test.js`. Los datos viven en el documento `resenas.json` (PostgreSQL o `data/`).
- Logitrack (rama `feat/resenas-online`, worktree `D:\Logística-resenas`): `src/lib/reviews/*`, `src/app/api/reviews/{config,storefront}`, `public/reviews/opiniones.js`, rutas habilitadas en `src/proxy.js`, copia del motor en `src/lib/crossselling/engine/reviews.js` (`node scripts/sync-crossselling-engine.js <Logitrack>`), pruebas `tests/reviews.test.js`.

## Pendiente para activarlo
1. Revisar y commitear ambas ramas (no se commiteó nada).
2. Desplegar Logitrack con `npm run deploy:production` (procedimiento en `docs/deployment-crossselling.md` de Logitrack).
3. Probar primero con la tienda demo 7570182, luego PC MIDI 78394.
4. Cargar las primeras opiniones reales y recién ahí activar el interruptor.

## Verificado
- `npm test` de Mostrador y las pruebas de Logitrack (88 + las 3 que necesitan `node_modules`), eslint de lo nuevo, `vite build`.
- Script de la tienda probado sobre una ficha real de pcmidi.com.ar con datos simulados: estrellas, bloque, «Ver más», HTML del texto escapado.
- **No** se probó contra el Logitrack desplegado ni la publicación firmada de punta a punta (la ruta nueva todavía no existe en producción).

## Importador de MercadoLibre
- Mostrador pide a Logitrack `GET /api/reviews/meli` (firmado). Logitrack usa la cuenta de MercadoLibre vinculada al espacio de la tienda: lista las publicaciones activas, toma el SKU (`seller_custom_field` o atributo `SELLER_SKU`) y lee `GET /reviews/item/{id}` (si la publicación no tiene opiniones y es de catálogo, prueba con el producto de catálogo).
- Entran como **pendientes**, con autor «Comprador de MercadoLibre» (MercadoLibre ofusca al comprador), el link de la publicación y el id de la opinión para no repetirlas. Se omiten: publicaciones sin SKU, SKU que no están en el catálogo, calificaciones sin texto y opiniones no publicadas.
- Corre solo una vez por día (y 2 minutos después de arrancar el servidor, sólo en modo real) y con el botón «Buscar en MercadoLibre». El resultado de la última búsqueda se ve en la pantalla.
- Nunca aprueba solas: la aprobación sigue siendo manual. Aprobar sólo las de 4 y 5 estrellas distorsiona el promedio.
- **Sin verificar contra MercadoLibre real**: probado con un cliente simulado. Falta confirmar la respuesta real del endpoint, que las publicaciones tengan SKU cargado y que los términos de MercadoLibre permitan mostrar sus opiniones en la tienda.

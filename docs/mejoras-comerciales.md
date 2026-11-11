# Vista previa local y mejoras comerciales

Para revisar sin usar credenciales de producción:

```powershell
npm run build
npm run preview:local
```

Abrir http://127.0.0.1:3100/admin#informes y http://127.0.0.1:3100/vendedor.
El proceso se vincula solo a 127.0.0.1, ignora `.env`, elimina credenciales heredadas y usa `data/preview`. Al primer arranque carga 36 operaciones ficticias; siguientes arranques conservan los cambios de la vista previa. No emite comprobantes reales ni publica reglas online. El catálogo puede leer información pública de la tienda.

## Disponible

- Informe comercial del mostrador con fechas argentinas: vendido, facturado, cobrado por fecha de pago, pendientes actuales, combinaciones y reposición.
- Descarga de Excel comercial con cobertura de datos.
- Comparación nominal contra período anterior de igual duración, descompuesta en operaciones y ticket.
- Carritos internos persistentes: guardar, recuperar, renombrar, buscar y eliminar. Sin datos fiscales ni reserva de stock. Si un producto no está disponible, se conserva la venta actual y se solicita resolverlo antes de recuperar.
- Seguimiento local de recomendaciones por sesión: mostradas, agregadas, retiradas y compras vinculadas a la venta. Costos, IVA y nombre de regla se guardan para ventas nuevas. Las exposiciones se registran al generar sugerencias del estado compartido; aún no representan confirmación de visualización física en pantalla.
- Parámetros de reposición: ventana de demanda y días objetivo, ambos de 1 a 365.

## Límites pendientes antes de producción

- Importación de pedidos/pagos completos de Tiendanube, vinculación de comprobantes de Contabilium y conciliación manual. La integración existente solo ofrece catálogo público e informes agregados de cross-selling.
- Sincronización comercial automática y cobertura completa de notas de crédito, cancelaciones y devoluciones.
- Reposición usa demanda local; no hay todavía demanda consolidada de ambos canales.
- Validación de persistencia con una base PostgreSQL de prueba y revisión de escritorio y móvil completa.
- Las cobranzas automáticas nuevas guardan fecha de confirmación local. No se inventan fechas para cobros históricos.
- Una sugerencia agregada no acredita una compra incremental. Margen estimado sin gastos ni comisiones y solo para unidades con costo guardado.

Las rutas anteriores siguen disponibles. Nuevas rutas: GET /api/comercial (formato=xlsx para Excel), POST /api/comercial/actualizar, PUT /api/comercial/reposicion y GET/POST/PATCH/DELETE /api/carritos con POST /api/carritos/:id/recuperar.

## Cambio de alcance

Reposición sugerida queda postergada por decisión del usuario. No se muestra en Informes ni se exporta en Excel; el cálculo interno se conserva para una futura revisión.

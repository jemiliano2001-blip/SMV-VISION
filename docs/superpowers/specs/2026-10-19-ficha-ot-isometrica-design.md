# Ficha OT: foto isométrica grande, sin ruta de fabricación

Fecha: 2026-10-19 · Estado: pendiente de revisión

## Objetivo

En la ficha de pizarrón y viajera que sale al imprimir una OT, quitar la tabla de ruta de fabricación y usar ese espacio para una foto grande de la pieza. La foto es siempre una isométrica real, un render 3D del STL, o un dibujo de línea generado por IA. El plano acotado sigue en la segunda hoja. Todo lo impreso va en blanco y negro.

Referencia de impresión: los reportes de SMV Hub usan encabezado negro y texto blanco. Esta ficha copia esa disciplina de láser (negro, blanco, sin badges de color). No migra tokens de pantalla de Hub ni toca esa app.

## Decisiones ya tomadas

- Enfoque elegido: foto grande en las dos tarjetas (pizarrón y viajera, media carta) y plano acotado intacto en la segunda hoja.
- Orden de la foto: PDF ISO del catálogo, luego STL en blanco y negro, luego IA de línea, luego recuadro "Sin isométrica".
- La miniatura deja de ser la primera página del plano CAD.
- La ruta de fabricación (los seis pasos y sus columnas) desaparece de la ficha.
- Si la IA no devuelve imagen, la OT se imprime igual. La orden no se traba.
- La imagen de IA no sirve para maquinar. Las cotas viven en la segunda hoja.
- El cambio de prompt aplica a todos los que llaman `generateIsometricImageFromDrawing` (ficha y reporte). Es el mismo generador; el render de metal sombreado deja de ser el pedido por defecto.
- Fuera de alcance: quitar la segunda hoja, unir pizarrón y viajera en una sola tarjeta, cambiar qué plano se imprime como CAD (`printDrawingForGroup` sigue devolviendo el CAD), rediseñar el reporte de facturación, y tocar SMV Hub.

## 1. De dónde sale la foto

Resolver antes de sellar, en los flujos que ya arman la ficha: `ToolcribPrintModal`, `ToolcribBatchPrintModal`, `useBatchPrintOts` y el juego (`openStampedPlanoOtSet`). Cada pieza de un juego resuelve su propia foto.

La resolución corre solo cuando el modo es `board_ticket` o `both`. En modo `blueprint` no hay ficha y no se busca foto.

`chooseFichaPhotoKind` es pura y no descarga nada. Recibe si hay PDF ISO, si hay `stlUrl` y si hay plano CAD. Devuelve `iso` | `stl` | `ai` | `none`.

`resolveFichaPhoto` ejecuta ese orden y se detiene en el primero que salga:

1. **ISO.** Si el grupo tiene `iso.pdfUrl`, `fetchPdfAsDataUrl` baja ese PDF y la ficha usa su primera página (el mismo embed de página que hoy usa la miniatura del CAD). El caller ya tiene el catálogo en memoria y pasa la URL del hermano ISO; esta función no lee Firestore.
2. **STL.** Si no hay ISO y el grupo tiene `stlUrl`, `renderStlToDataUrl` produce un PNG sombreado en escala de grises: fondo blanco, material oscuro, sin cotas ni rejilla. Sigue siendo una foto del sólido, no un dibujo de línea. Un fallo de render no aborta: sigue al paso 3.
3. **IA.** Si no hay ISO ni STL, y hay plano CAD rasterizable, se llama `generateIsometricImageFromDrawing` con el prompt nuevo. La caché existente `readCachedValue` / `writeCachedValue` con kind `iso-gen` y `ISOMETRIC_GEN_PROMPT_VERSION` evita otra llamada por el mismo plano. Un fallo o una respuesta sin imagen sigue al paso 4.
4. **Vacío.** La ficha se imprime con el recuadro "Sin isométrica".

El sello (`PlanoOtStamp`) recibe la foto ya resuelta: página embebida del ISO, o un dataURL de imagen, más el origen `iso` | `stl` | `ai` | `none`. `stampPlanoOt` no descarga catálogo ni llama a Gemini.

La máscara de cantidad (`quantityMask`) se aplica solo a la segunda hoja (el plano acotado). La foto no lleva cotas que ocultar.

## 2. Cómo se ve cada tarjeta

`addFichaPizarronPage` en `src/lib/planoOt.ts` conserva las dos tarjetas y la línea de corte a media carta. De arriba hacia abajo, solo negro y blanco:

1. Encabezado negro, texto blanco: "SMV" y el tipo, PIZARRÓN o VIAJERA. Sin azul marino, naranja ni verde.
2. SO, cantidad, PO y fecha, en negro. La cantidad deja de ir en rojo.
3. Número de parte, cliente y notas, en un bloque corto.
4. La foto, el recuadro más grande de la tarjeta, en el espacio que ocupaban la miniatura chica y la ruta. Origen `ai`: una línea "Isométrica generada". Origen `none`: "Sin isométrica".
5. Pie: folio y "Firma de recibido".

Se eliminan el título "RUTA DE FABRICACIÓN Y LIBERACIÓN EN TALLER", las filas de proceso y las columnas operador / fecha / liberación.

La segunda hoja (modo `blueprint` y la página de plano de `both`) conserva el plano acotado y la franja slim de SO, cantidad y fecha. Esa franja ya es negra sobre blanco; no se le agrega color.

## 3. IA de línea

En `src/lib/generateIsometricImage.ts`:

- `ISOMETRIC_GEN_PROMPT_VERSION` pasa de `iso-gen-v2` a `iso-gen-v3`. Las imágenes sombreadas en IndexedDB dejan de usarse.
- El prompt pide vista isométrica de la misma pieza, fondo blanco, línea negra, barrenos y chaflanes visibles en el plano, sin cotas, sin cajetín, sin texto y sin fondo de estudio.
- Sigue el comentario de que la geometría no es confiable para maquinado. El caller marca origen `ai`.

## 4. Fallos

Ningún paso de la foto lanza hacia el operador de impresión. ISO que no descarga, STL que no renderiza, Gemini caído o sin imagen: se baja al siguiente paso y, al final, al recuadro vacío. Se registra con `log.warn`. El PDF de la OT sale.

## 5. Pruebas

- `chooseFichaPhotoKind`: con ISO gana `iso`; sin ISO y con STL gana `stl`; sin ambos y con CAD toca `ai`; sin nada, `none`.
- La ficha generada en `src/lib/__tests__/planoOt.test.ts` ya no contiene el texto de la ruta de fabricación, y sí dibuja el recuadro de foto (origen vacío y origen `ai` con su leyenda).
- Un fallo simulado de IA no impide armar el PDF.
- El prompt nuevo y `iso-gen-v3` se cubren sin llamar a Gemini.
- `npm test` de `planoOt` y de la selección de foto. Al implementar, la triple validación del proyecto (`npm test`, `npm run lint`, `npm run build`) corre al cierre de la fase.

## Archivos previstos

- `src/lib/planoOt.ts` — ficha en blanco y negro, foto grande, sin ruta; el sello acepta la foto resuelta.
- `src/lib/fichaOtPhoto.ts` (nuevo) — decisión pura y resolución async (ISO, STL, IA, vacío).
- `src/lib/generateIsometricImage.ts` — prompt de línea y versión `iso-gen-v3`.
- `src/lib/stlImageRenderer.ts` — opción de render para impresión en blanco y negro, sin cambiar el default que ya usan factura y correo.
- Callers de impresión: `ToolcribPrintModal.tsx`, `ToolcribBatchPrintModal.tsx`, `useBatchPrintOts.ts`.
- Pruebas junto a esos módulos.

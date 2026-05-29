# Diseño — Control de Órdenes (capa de trazabilidad)

**Fecha:** 2026-05-29
**Estado:** Aprobado para planeación
**Autor:** José (SMV) + Claude

## Problema

En Suprajit, los torneros a veces dicen "no me diste el dibujo" o no hacen la
pieza. Hoy SMV-VISION es un **generador de reporte de una sola pasada**: subes el
PDF de pedidos, la IA extrae las órdenes, las empareja con el catálogo del Tool
Crib, recorta la isométrica y exporta un PDF — pero **no recuerda nada** después
de exportar. No hay forma de saber, semanas después, a quién se le entregó qué
plano y cuándo.

Se necesita una **capa de control y rendición de cuentas** que viva *encima* del
generador actual (sin reemplazarlo): un registro vivo de órdenes que crece
conforme entran las POs, con prueba de entrega del plano por tornero y fecha.

## Decisiones tomadas (brainstorm)

| Tema | Decisión |
|---|---|
| Quién usa el control | **Solo el operador** (José). Sin login por tornero ni pantalla en piso. |
| Estados de la orden | Binario: **Pendiente → Entregada** a [tornero] + fecha-hora. Nada de "en proceso"/"terminada" en v1. |
| Insumo | **PDF multi-hoja, una PO por hoja.** Se sube **cada que entra una orden nueva**; las órdenes se **acumulan**. |
| De cada hoja la IA lee | Número de **PO** · número de **SO** · fecha de la OT · piezas (pieza, número de parte, cantidad, prioridad). PO y SO son **distintos** y ambos vienen en el PDF. |
| Persistencia | **Firestore (nube).** Prueba con sello de tiempo del servidor, respaldada, consultable desde cualquier PC. |
| Deliverable al tornero | **Plano-OT** = el **blueprint original completo (con las medidas), NO el recorte**, sellado con **SO · cantidad · fecha**. La PO se guarda solo para trazabilidad interna. El recorte isométrico se queda solo para identificación en la lista/reporte. |
| Marcado de entrega | El operador marca **al momento de repartir**, desde la lista de control. |
| Fecha de la OT | La que **viene escrita en el PDF de la PO** (la lee la IA). |

## Flujo de uso

1. **Entra una PO nueva** → subes el PDF. La app corre el pipeline existente:
   lee cada hoja, saca número de PO + número de SO + fecha de OT + piezas,
   empareja cada pieza con su plano del Tool Crib y recorta la isométrica.
2. **Las piezas se guardan como órdenes "Pendientes"** en Firestore, ligadas a su
   PO y SO. Re-subir la misma orden **no duplica** (dedup por SO + número de
   parte) y **no borra** entregas ya marcadas.
3. **Imprimes/entregas el plano-OT y lo marcas.** El plano-OT es el **blueprint
   original completo con las medidas** (no el recorte), sellado con **SO ·
   cantidad · fecha**. Desde la lista de control, cada orden tiene
   **"Entregar a ▾"** (tus torneros). Al elegir, se graba quién/qué/cuándo con
   sello del servidor.
4. **La lista de control es la fuente de verdad.** Pestaña "Control de Órdenes"
   con filtros (pendientes / entregadas / por PO / por tornero / urgentes),
   búsqueda, y respuesta inmediata a "¿le di el plano de la parte X a alguien?".
5. **Cuando un tornero reclame:** abres la orden y ahí está el registro — o no
   está, y entonces sabes que de verdad falta entregarlo.

## Arquitectura

La capa de control reutiliza el pipeline de análisis existente
(`extractInfo()` en `App.tsx`, matching en `src/lib/matching.ts`, capa Firebase
en `src/lib/firebase/`) y agrega persistencia + una vista nueva.

### Modelo de datos (Firestore)

**Colección `workOrders`** — una orden por pieza-PO:

```ts
interface WorkOrderDoc {
  id: string;                         // auto
  dedupeKey: string;                  // `${soNumber||poNumber}::${normalizedPartNumber||normalizedPieza}`
  poNumber: string;                   // orden de compra (cliente) — trazabilidad interna
  soNumber: string;                   // sales order — se sella en el plano-OT
  otDate: string;                     // leída del PDF de la PO
  customer: string;                   // "SUPRAJIT"
  pieza: string;
  numeroParte: string;
  cantidad: string;
  prioridad: 'URGENTE' | 'Normal';
  status: 'pendiente' | 'entregada';
  matchedPartId: string | null;       // del catálogo Tool Crib
  matchedDrawingId: string | null;
  matchScore: number | null;
  deliveredToTornero: string | null;
  deliveredAtUTC: Timestamp | null;   // serverTimestamp() al entregar
  deliveredByUid: string | null;      // resuelto desde Auth, no spoofeable
  sourcePdfName: string;
  sourcePage: number | null;
  archived: boolean;                  // default false (ocultar de la lista activa)
  createdAtUTC: Timestamp;
  updatedAtUTC: Timestamp;
}
```

**Colección `torneros`** — lista chica editable:

```ts
interface TorneroDoc {
  id: string;
  name: string;
  active: boolean;
  createdAtUTC: Timestamp;
}
```

Reglas de seguridad (`firestore.rules`): mismas que las colecciones actuales —
cualquier usuario autenticado lee/escribe. La validación de forma vive en
TypeScript. **Nota:** para que `deliveredByUid` y el sello de tiempo sirvan como
prueba, el operador debe estar **firmado** (no usar el bypass de auth).

### Capa Firebase: nuevo módulo `src/lib/firebase/workOrders.ts`

Sigue el patrón existente: **result type, nunca lanza**
(`ToolcribResult<T>`), uid resuelto en el writer, `serverTimestamp()` para
fechas persistidas.

- `upsertWorkOrders(extracted, source)` — carga las órdenes no-archivadas a un
  `Map` por `dedupeKey` (1 read), luego batch-write: crea las nuevas como
  `pendiente`, actualiza campos mutables (cantidad, prioridad, plano emparejado)
  de las existentes **sin tocar** `status`/campos de entrega. Devuelve
  `{created, updated}`.
- `listWorkOrders(filter?)` — filtros por `status`, `tornero`, `poNumber`,
  `soNumber`, `prioridad`, `archived`. Límite duro defensivo como en `toolcrib.ts`.
- `markDelivered(orderId, torneroName)` — `status='entregada'`,
  `deliveredToTornero`, `deliveredAtUTC=serverTimestamp()`, `deliveredByUid` del
  Auth. Idempotente y registrable.
- `archiveWorkOrder(orderId, archived)` — ocultar/mostrar.
- `listTorneros()`, `addTornero(name)`, `setTorneroActive(id, active)`.

### Pipeline de extracción (cambios en `App.tsx`)

- El prompt de extracción de órdenes cambia para leer **PDFs de PO multi-hoja**:
  por hoja captura **número de PO**, **número de SO** y **fecha de OT**, y por
  pieza la info habitual. Se agregan `poNumber`, `soNumber` y `otDate` a la forma
  extraída.
- **Bump `ORDER_PROMPT_VERSION`** para invalidar caché vieja de IndexedDB.
- Al terminar el análisis con éxito, **upsert automático** a `workOrders`
  (seguro por el dedup). El generador de reporte PDF actual sigue igual.

### Vista nueva: `Control de Órdenes`

- Navegación por pestañas en `App`: **"Generar Reporte"** (lo actual) y
  **"Control de Órdenes"** (nuevo). Componente nuevo p. ej.
  `src/components/WorkOrdersPanel.tsx`.
- Tabla/lista de lo acumulado: columnas SO · PO · fecha OT · pieza · parte ·
  cantidad · prioridad · estado · plano · acción.
- Filtros (pendientes / entregadas / por SO o PO / por tornero / urgentes) +
  búsqueda.
- Por fila: ver/imprimir **plano-OT** + **"Entregar a ▾"** (torneros activos).
- Mini-gestión de torneros (agregar/desactivar).

### Plano-OT (deliverable sellado)

- El plano-OT es el **blueprint original completo con las medidas** (no el
  recorte), porque el tornero necesita las dimensiones para maquinar. Se sella
  con un encabezado: **SO · cantidad · fecha** (la PO no se sella; se guarda solo
  para trazabilidad interna).
- Fuente del blueprint original: el PDF del plano del Tool Crib emparejado
  (vía `matchedDrawingId` → `fetchPdfAsDataUrl`). El raster completo de página 1
  (`sourceImageDataUrl`) es solo respaldo visual.
- El sello debe **preservar la legibilidad de las medidas** → preferir overlay de
  texto sobre el PDF original a resolución completa (p. ej. `pdf-lib`) en vez de
  sellar sobre el raster comprimido. (Librería exacta a decidir en el plan.)
- El **recorte isométrico no se sella ni se entrega**: sigue usándose solo para
  identificación visual de la pieza en la lista de control y en el reporte.

## Aislamiento y límites

- `workOrders.ts` encapsula todo acceso a Firestore de la capa de control; la UI
  no toca Firestore directo (igual que `toolcrib.ts` hoy).
- El dedup vive en una función pura testeable (`buildDedupeKey`,
  `mergeUpsert`) separada de la I/O de Firestore.
- `WorkOrdersPanel` consume solo tipos de dominio (`types.ts`), no validadores de
  Firebase.

## Fuera de alcance (v1) — ideas para después

- Reimpresión con registro (segunda copia anotada).
- Reporte semanal de entregas por tornero.
- Alerta de pendientes viejos (X días sin repartir → rojo).
- Acuse del tornero (firma en pantalla / foto al recibir).
- Estado "Terminada" para cerrar el ciclo de maquinado.

## Criterios de éxito

1. Subo un PDF de PO multi-hoja → las piezas quedan guardadas como Pendientes,
   con su PO, SO y fecha de OT, sin duplicar si re-subo.
2. Marco "Entregar a [tornero]" → queda registrado quién/cuándo con sello del
   servidor.
3. Busco por parte/SO/PO/tornero y obtengo en segundos el estado y la prueba de
   entrega.
4. El plano que imprimo es el **blueprint original completo con medidas**, sellado
   con SO · cantidad · fecha (no el recorte, no la PO).
5. El generador de reporte PDF actual sigue funcionando sin cambios de
   comportamiento.

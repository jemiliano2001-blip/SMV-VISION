# Impresión OT: cantidad original y encabezado — 2026-09-10

- La impresión individual de Biblioteca/Órdenes pasa por una vista previa. El operador selecciona la cantidad original con un recuadro, puede quitarlo, usar zoom o ajustar sus coordenadas con teclado. Debe seleccionar una zona o indicar explícitamente que no hace falta ocultar ninguna.
- «Ver resultado» genera la misma primera página que se imprime: cubierta blanca en la zona seleccionada, SO/cantidad grandes y fecha/notas debajo. La fuente del catálogo permanece intacta. La cubierta es visual para impresión, no una redacción segura de información confidencial.
- El generador normaliza la orientación y CropBox antes de aplicar el recuadro. Conserva el contenido vectorial del plano y las páginas posteriores. La selección se aplica únicamente a la primera página y no se guarda en Firestore.
- El encabezado ampliado también se usa al imprimir lotes. La selección interactiva se ofrece en la impresión individual; los lotes no seleccionan ni reutilizan máscaras automáticamente.
- Revisión defensiva: rechazo de coordenadas no finitas/fuera de página, cantidad positiva, aislamiento de renders y respuestas tardías, controles accesibles con teclado, notas largas envueltas, páginas vacías admitidas y sin borrados por posición fija.

## Validación

- `npm test`: 29 archivos, 325 pruebas aprobadas; nueve casos nuevos del generador.
- `npm run lint`: aprobado.
- `npm run build`: aprobado; advertencia de tamaño de chunks de Vite.
- Navegador local con componente real y PDF local `90-1012-06.pdf`; consulta de órdenes simulada, sin escrituras a Firebase: arrastre, vista final y generación de un PDF válido desde «Imprimir OT».
- Comprobación por píxeles para 0/90/180/270 grados con CropBox desplazado: interior seleccionado blanco y borde exterior negro conservado.
- Vista móvil 390 × 844: sin desbordamiento horizontal; ajuste por teclado, quitar recuadro y omisión explícita funcionan.
- No se verificó impresión física ni producción. Sin commit, push ni despliegue.

# Rediseño UI/UX del espacio de trabajo — 2026-09-10

- Se reemplazó la jerarquía brutalista uniforme por una mesa de trabajo industrial más clara: superficies gris acero, paneles suaves, naranja SMV reservado para selección y acciones principales, y equivalencia completa entre temas claro y oscuro.
- La navegación ahora agrupa `Operación` y `Recursos`, usa nombres más breves, objetivos táctiles de 44 px y un estado activo legible. El shell móvil conserva menú, título de vista y selector de tema.
- Inicio se orientó a prioridades: título descriptivo, acceso directo a un reporte nuevo, KPIs compactos, carga por responsable, antigüedad y estado de sesión con menor ruido tipográfico.
- Órdenes, Biblioteca, Compras, Entregas sin OC y Reporte recibieron encabezados, acciones, estados vacíos y contenedores alineados con el mismo sistema visual.
- Se corrigió el valor cero de órdenes en Inicio, se protegieron cantidades no finitas y arreglos ausentes, y el ordenamiento de Compras ahora es operable con teclado y expone `aria-sort`.

## Validación

- `npm test`: 29 archivos y 325 pruebas aprobadas.
- `npm run lint`: aprobado, sin errores TypeScript.
- `npm run build`: aprobado. Vite mantiene la advertencia conocida por chunks mayores de 800 kB.
- Navegador local: Inicio y Órdenes verificadas en modo oscuro y claro; navegación, estados vacíos, foco semántico y cambio de tema operativos. La carga remota falló en modo debug, por lo que se verificaron los estados de error/vacío, no órdenes reales.
- Responsive revisado por estructura y breakpoints existentes; no se hizo una captura con viewport móvil en esta sesión. Sin commit, push ni despliegue.

# Auditoría post-fase del rediseño UI/UX — 2026-09-10

- `ComprasPanel.tsx` había quedado a medio migrar: la tabla (chip de tipo, botones de link/editar/borrar) y el modal completo de "Nuevo Material" seguían en el dialecto brutalista viejo (`rounded-none`, `border-2`, sombras duras `shadow-[2px_2px_0px...]`, `text-bg` sobre acento) mientras el encabezado ya tenía el look nuevo. Migrado a `rounded-lg`/`rounded-xl`, bordes de 1px y `text-white` sobre acento.
- Indentación rota en el estado vacío de compañías de `OdooOrdersPanel.tsx` (cosmético, sin efecto funcional).
- Revisado y descartado como bug: `text-bg` en el chip de compañía seleccionada de `OdooOrdersPanel` (mismo patrón de inversión bg/accent que su badge de conteo, funciona en ambos temas) y el header navy fijo (`bg-[#0D2B4D]`) del modal de Compras — acento intencional, confirmado por el usuario, se deja tal cual.
- Null-safety de `InicioView.tsx` (`?? []`, `Number.isFinite` en agregados de `order_lines`) ya estaba bien resuelta en el rediseño; no requirió cambios.
- De paso: `AGENTS.md` y `README.md` estaban desincronizados de la arquitectura real (describían llamadas directas a Gemini con `VITE_GEMINI_API_KEY` y login con Google) — actualizados para reflejar el proxy `analyzeGemini` y el login por email/password actuales. Se borraron `docs/superpowers/plans/` y `docs/superpowers/specs/` (15 archivos, bitácoras de fases ya cerradas, recuperables por git history).

## Validación

- `npm test`: 29 archivos, 325 pruebas aprobadas.
- `npm run lint`: aprobado, sin errores TypeScript.
- `npm run build`: aprobado; misma advertencia conocida de chunks de Vite.
- Navegador local en modo debug (sin datos reales de Firestore): modal de "Nuevo Material" verificado visualmente, bordes y botones consistentes con el resto de la app.
- Sin commit, push ni despliegue.

# Cierre de brechas funcionales y consistencia UI — 2026-09-11

- El botón `Actualizar` de Biblioteca ahora refresca únicamente el catálogo. Ya no borra la caché de análisis de Gemini ni la última sesión recuperable almacenada en IndexedDB.
- Una nueva auditoría conserva el reporte anterior mientras valida la lectura inicial de Odoo. El estado editable se sustituye solo después de obtener órdenes correctamente, evitando pérdida de trabajo por fallos transitorios.
- La suscripción de `syncMeta/odoo` distingue `loading`, `ready`, `empty`, `unavailable` y `error`. Inicio, Reporte y NavRail dejan de presentar ceros o conexión positiva cuando el estado no está confirmado.
- La Biblioteca embebida en Reporte mantiene buscador y acciones dentro de la columna de 420 px; sus botones se apilan en esa variante y conservan 44 px de alto.
- Herramental usa el encabezado del workspace, iconos Lucide, pestañas `tablist`/`tab`/`tabpanel`, superficies suaves y controles táctiles de 44 px. Tool Crib, tarjetas Odoo, acceso y ErrorBoundary recibieron la misma adaptación visual.
- Los formularios de acceso, Compras, compra rápida, Biblioteca, impresión, facturación y Herramental ahora asocian etiquetas con sus controles. Los botones de icono principales tienen nombres accesibles explícitos.
- `scratch/` quedó fuera del typecheck de producción y el patrón radial del Reporte usa el token `--color-accent`.

## Validación

- `npm test`: 30 archivos, 327 pruebas aprobadas.
- `npm run lint`: aprobado, sin errores TypeScript.
- `npm run build`: aprobado. El primer intento paralelo encontró un bloqueo temporal `EBUSY` de Windows sobre un WASM de pdf.js; el build aislado terminó correctamente. Permanece la advertencia conocida de `react-vendor` mayor de 800 kB.
- Navegador local en modo debug: Acceso, Inicio, Reporte y Herramental verificados en 1280 × 800 y 390 × 844. El overflow embebido quedó resuelto, los estados de Odoo muestran fallo/desconocido correctamente y las pestañas exponen semántica accesible.
- Las lecturas remotas fallaron en el entorno debug, por lo que no se verificaron datos reales, Gemini, escritura Firestore, impresión física ni producción.
- Sin commit, push ni despliegue.

# Auditor�a post-fase Herramental CNC (Fases 1�3) � 2026-09-11

- Null-safety: parseInputNumber en inputs de ThreadingAdvisorTab y precio de ToolingVaultTab (antes Number('') ? NaN / Infinity en TPI).
- 	oolingValidators.num ahora usa Number.isFinite (rechaza Infinity/NaN).
- B�squeda defensiva con `?? ''` en Blueprint Advisor y B�veda; arrays opcionales con `?? []` en holders/paquete de herramientas.
- Cronograma G76: acceso seguro a infeedScheduleMm[i] / percent; TPI con piso anti divisi�n por cero.
- Comentario incorrecto en ormatters.ts (estado can�nico) corregido.
- UI: tablas de machuelos/b�veda ya ten�an overflow-x-auto; vault th/td = 7 columnas alineadas; sin print:hidden desalineado en tooling.

## Validaci�n

- `npm test`: 34 archivos, 358 pruebas aprobadas.
- `npm run lint`: aprobado (tsc --noEmit).
- `npm run build`: aprobado; advertencia conocida de chunks >800 kB.
- Sin commit, push ni despliegue.

# Encabezado Slim de OT y Ficha de Pizarrón (Auditoría Post-Fase) - 2026-09-28

- **Encabezado Slim Ultra-Compacto**: Se redujo la altura del sello de OT en el plano de taller de ~135-150 pt a ~40-48 pt, recuperando la escala del dibujo técnico de ~78% al ~93%. Ofrece selector visual de estilo (slim vs classic) en modal individual y de lote.
- **Ficha de Pizarrón (Viajera Media Carta x2)**: Generación de hoja complementaria con 2 tarjetas (Media Carta): Tarjeta 1 (Pizarrón / Kanban) y Tarjeta 2 (Viajera de Piso), miniatura vectorial del plano original (con máscara blanca si aplica), datos de impacto (SO, CANTIDAD, PO, CLIENTE) y tabla checklist con 6 procesos del taller con casillas y firmas.
- **Soporte de Modos de Impresión**: oth (Ficha pizarrón pág 1 + Plano de taller pág 2), lueprint (solo plano slim) y oard_ticket (solo ficha pizarrón).
- **Navegación Multi-Página en Preview**: PlanoOtPreview.tsx ahora incluye controles de paginación (← Ant / Sig →) con etiquetas semánticas para previsualizar todas las páginas generadas antes de imprimir.
- **Null-Safety y Programación Defensiva (Auditoría)**:
  - Sanitización WinAnsi (sanitizeWinAnsi): Reemplazo automático de comillas tipográficas (“ ”), apóstrofes curvados (‘ ’), guiones largos (—), viñetas (•), checks (✓) y emojis para evitar errores de codificación en pdf-lib al procesar notas libres o descripciones de Odoo.
  - Sanitización de descargas (cleanFilename): Eliminación de plecas /, dos puntos :, comillas y caracteres ilegales en nombres de archivo descargables (plano-ot-2026-S01991.pdf).
  - Arrays opcionales con order.order_lines ?? [] en useBatchPrintOts.ts y ToolcribPrintModal.tsx.
  - Protección de notas excesivas: rechazo controlado si las notas encogen el plano por debajo de escala 0.85 o superan 300 caracteres en modo Slim.

## Validación Técnica

- npm test: 37 archivos, 392 pruebas aprobadas (100% de éxito, 18 pruebas en planoOt.test.ts).
- npm run lint: Aprobado sin errores (tsc --noEmit, 0 errores).
- npm run build: Compilación de producción limpia en 30.36s (Vite v6.4.3). Chunks divididos correctamente.
- Sin commit, push ni despliegue.

# Piezas en Par, Dos Hojas y Planos Complementarios de OT - 2026-09-28

- **Módulo de Planos Complementarios (src/lib/companionDrawings.ts)**:
  - Detección automática y precisa de piezas del taller que se venden en pares o requieren múltiples hojas de planos técnicos:
    - 90-1012-06: Vinculación automática con Hoja 2 (90-1012-06-2).
    - 90-1012-05: Detección de pares por mitad chica (1012-05-CHICO) y mitad grande (1012-05-GRANDE).
    - 90-4150-06: Detección de pares de gavilanes (4150-06-CORTO / -A y 4150-06-LARGO / -B).
    - 143272 (Navajas Artos): Detección de cuchillas complementarias en juegos de corte.
  - Reglas heurísticas de normalización para piezas futuras basadas en sufijos de SolidWorks (-2, HOJA 2, _2, -A/-B, CHICO/GRANDE, CORTO/LARGO, COMPLEMENTO) y aislamiento de raíces de piezas.
- **Tipado y Puente de Dibujos (src/types.ts, src/lib/orderDrawingBridge.ts)**:
  - OrderDrawingLink extendido con companionDrawings?: OrderDrawingSnapshot[].
  - Resolución determinista en esolveOrderDrawingLink y en asignación manual pplyManualDrawingToLink.
  - Función utilitaria getAllCadDrawingSnapshotsForPrint(link) que recopila el plano CAD base junto con todos sus complementos ordenados.
- **Generación Multi-Página de Sets de OT (src/lib/planoOt.ts)**:
  - createStampedPlanoOtSet(items: PlanoOtSetItem[], baseStamp: PlanoOtStamp):
    - Página 1: Ficha de pizarrón / viajera que indica el juego completo ([JUEGO X PLANOS: Incluye ...]), evitando duplicar fichas innecesarias para cada componente secundario.
    - Páginas 2+: Planos técnicos individuales estampados con el encabezado Slim ultra-compacto, identificando el componente exacto (COMPONENTE: ...).
  - openStampedPlanoOtSet: Descarga o visualización directa de juegos completos en una sola acción con nombres de archivo sanitizados.
- **Interacción y Modal de Impresión (src/components/ToolcribPrintModal.tsx, src/components/PlanoOtPreview.tsx)**:
  - Detección reactiva en el modal al seleccionar cualquier plano de Biblioteca u Órdenes: muestra banner informativo 📎 Juego de planos detectado (X hojas) y checkbox ☑ Imprimir juego completo (X hojas) (activo por defecto).
  - Descarga y procesamiento concurrente protegido de los PDFs del juego completo.
  - El visor PlanoOtPreview soporta navegación multi-hoja (← Ant / Sig →) visualizando tanto la ficha de pizarrón como cada plano del set.
  - Botón principal de acción adaptativo: Imprimir Juego (X Planos) o Imprimir OT.
- **Impresión por Lotes (src/hooks/useBatchPrintOts.ts)**:
  - Integración transparente con getAllCadDrawingSnapshotsForPrint: las órdenes en lote que contengan complementos imprimen automáticamente todas sus hojas en secuencia con su respectivo sello.

## Validación Técnica

- npm test: 38 suites, 403 pruebas aprobadas (100% de éxito, 9 pruebas específicas en companionDrawings.test.ts, 19 en planoOt.test.ts).
- npm run lint: Aprobado sin errores (tsc --noEmit, 0 errores).
- npm run build: Compilación de producción limpia en 10.68s con Vite v6.4.3.
- Sin commit, push ni despliegue a producción sin autorización.
/** Cuádruple [ymin, xmin, ymax, xmax] en escala 0-1000 sobre la imagen rasterizada. */
export type BoundingBox = [number, number, number, number];

export interface Order {
  pieza: string;
  numero_parte?: string;
  cantidad: string;
  orden: string;
  fecha: string;
  prioridad: 'URGENTE' | 'Normal';
  haSidoAuditada?: boolean;
  isometricView?: string;
  /**
   * Origen de la miniatura 3D del reporte.
   * - crop: recorte del plano (ISO real o bbox Gemini)
   * - ai-generated: imagen inventada por Gemini (fallback sin ISO/eDrawing)
   */
  isometricSource?: 'crop' | 'ai-generated';
  isometricBoundingBox?: BoundingBox;
  sourcePdfName?: string;
  sourcePdfPath?: string;
  /**
   * Score del mejor blueprint match (0-100). Solo presente cuando la orden
   * fue auditada. Usado para señalar confianza en UI: <90 = revisar a mano.
   */
  matchScore?: number;
  /**
   * dataURL de la imagen completa rasterizada del plano (no el recorte). Se
   * usa para abrir el plano original en un modal al hacer click en la
   * miniatura. Opcional porque las órdenes sin match no lo tienen.
   */
  sourceImageDataUrl?: string;
  /** PO (orden de compra del cliente). Distinta del SO (`orden`). */
  poNumber?: string;
  /** Dibujo del catálogo Tool Crib emparejado con esta orden (si hubo match). */
  matchedDrawingId?: string;
  matchedPartId?: string;
  /** Metadatos técnicos extraídos del cajetín del plano por IA */
  material?: string | null;
  dureza?: string | null;
  tratamiento?: string | null;
  acabado?: string | null;
}

export interface ExtractedOrder {
  pieza: string;
  numero_parte: string;
  cantidad: string;
  orden: string;       // SO (sales order)
  fecha: string;       // OT date
  prioridad: 'URGENTE' | 'Normal';
  poNumber: string;    // PO (purchase order) — distinct from SO, trazabilidad interna
}

export interface BlueprintSpec {
  pieza_detectada: string;
  isometricBoundingBox: BoundingBox;
  material?: string | null;
  dureza?: string | null;
  tratamiento?: string | null;
  acabado?: string | null;
}

export interface BlueprintAnalysis {
  specs: BlueprintSpec[];
  image: string;
}

export interface WorkshopPdfUpload {
  id: string;
  name: string;
  relativePath: string;
  dataUrl: string;
}

/** Se escribe en `analysisRuns` (Firestore). Ya no se muestra en la UI. */
export interface AnalysisMetrics {
  totalMs: number;
  pdfRasterMs: number;
  /**
   * ponytail: el nombre miente — hoy mide la lectura de Odoo en Firestore, no
   * una llamada a Gemini (ese paso se borró). No se renombra porque partiría el
   * esquema de los documentos de `analysisRuns` ya escritos.
   */
  aiOrderMs: number;
  aiBlueprintMs: number;
  mergeMs: number;
}

export interface AnalysisRunSummary {
  totalLoaded: number;
  totalAnalyzed: number;
  totalAudited: number;
  totalNonMatching: number;
  totalOrders: number;
}

/**
 * Resumen agregado de una revisión activa para mostrar en el selector
 * de Tool Crib. Se construye en la capa de datos combinando parte +
 * dibujo activo. Mantenerlo en `types.ts` evita que la UI dependa
 * directamente de los validadores de Firebase.
 */
export interface ToolcribActiveDrawingView {
  partId: string;
  partNumber: string;
  customer: string;
  description: string;
  drawingId: string;
  revision: string;
  sourceType: 'network' | 'storage';
  sourcePath: string;
  pdfUrl: string | null;
  /** STL en Storage (export eDrawings); null si no hay malla. */
  stlUrl: string | null;
  effectiveFromUTC: string | null;
}

/**
 * Estado de una orden de trabajo en la capa de control.
 *  pendiente  → recibida, sin asignar
 *  en_proceso → plano entregado al tornero, en maquinado
 *  terminada  → pieza lista, esperando envío a Suprajit
 *  entregada  → entregada a Suprajit
 */
export type WorkOrderStatus = 'pendiente' | 'en_proceso' | 'terminada' | 'entregada';

/**
 * Forma canónica de una orden de trabajo (una pieza de una PO) lista para
 * la UI. Se construye normalizando el documento de Firestore. Las fechas
 * llegan como ISO-8601 UTC (string) o null — el formateo local es del componente.
 */
export interface WorkOrder {
  id: string;
  poNumber: string;
  soNumber: string;
  otDate: string;
  customer: string;
  pieza: string;
  numeroParte: string;
  cantidad: string;
  prioridad: 'URGENTE' | 'Normal';
  status: WorkOrderStatus;
  matchedPartId: string | null;
  matchedDrawingId: string | null;
  matchScore: number | null;
  deliveredToTornero: string | null;
  deliveredAtUTC: string | null;
  deliveredByUid: string | null;
  /** Fecha límite de entrega a Suprajit (ISO date string, ej. "2025-06-15"). */
  dueDate: string | null;
  /** Tornero que tiene la pieza en este momento (puede diferir de deliveredToTornero). */
  assignedToTornero: string | null;
  /** Cuándo se le dio el plano/hoja al tornero (inicio de maquinado). */
  assignedAtUTC: string | null;
  /** Cuándo quedó terminada (antes de la entrega a Suprajit). */
  finishedAtUTC: string | null;
  /** Notas libres del supervisor. */
  notes: string;
  sourcePdfName: string;
  archived: boolean;
  createdAtUTC: string | null;
  updatedAtUTC: string | null;
  /** true si la OT fue creada automáticamente desde syncOdoo.ts. */
  odooSource: boolean;
  /** ID del documento en `odooSaleOrders` vinculado a esta OT (ej. "2026_S00781"). */
  odooOrderId: string | null;
  /** Índice para reordenamiento manual en la columna pendiente. */
  sortIndex: number | null;
}

/** Tornero al que se le entregan planos. */
export interface Tornero {
  id: string;
  name: string;
  active: boolean;
  createdAtUTC: string | null;
}

export type PurchaseItemType = 'metal' | 'ensamble' | 'herramienta' | 'otro';

/** Un material o pieza que se requiere comprar (metales, ensambles, McMaster). */
export interface PurchaseItem {
  id: string;
  nombre: string;
  tipo: PurchaseItemType;
  sku: string;
  proveedor: string;
  link: string;
  notas: string;
  createdAtUTC: string | null;
  updatedAtUTC: string | null;
}

/**
 * Snapshot de un dibujo Tool Crib guardado en un vínculo de sesión
 * (orden ↔ plano). Suficiente para print OT y adjuntar al reporte
 * sin volver a consultar el catálogo.
 */
export interface OrderDrawingSnapshot {
  drawingId: string;
  partId: string;
  partNumber: string;
  revision: string;
  pdfUrl: string | null;
  stlUrl: string | null;
  sourcePath: string;
  customer: string;
  description: string;
  sourceType: 'network' | 'storage';
  effectiveFromUTC: string | null;
}

/** Estado del vínculo orden↔plano en la sesión del navegador. */
export type OrderDrawingLinkStatus = 'linked' | 'no_match' | 'manual';

/**
 * Vínculo de sesión: una línea de orden Odoo con el plano CAD (OT) y/o
 * el plano preferido para el reporte (ISO-first) ya resueltos.
 * Clave: `${orderId}:${lineIndex}`.
 */
export interface OrderDrawingLink {
  key: string;
  orderId: string;
  lineIndex: number;
  soNumber: string;
  poNumber: string;
  pieza: string;
  numeroParte: string;
  qtyPending: number;
  /** Mejor CAD (no-ISO) para imprimir OT; null si no hay match usable. */
  cadDrawing: OrderDrawingSnapshot | null;
  /**
   * Plano para adjuntar al reporte (ISO-first vía selectLibraryDrawingMatch).
   * Puede ser ISO o CAD si no hay ISO con score suficiente.
   */
  reportDrawing: OrderDrawingSnapshot | null;
  matchScore: number;
  matchedAt: string;
  status: OrderDrawingLinkStatus;
}

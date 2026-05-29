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
}

export interface ExtractedOrder {
  pieza: string;
  numero_parte: string;
  cantidad: string;
  orden: string;
  fecha: string;
  prioridad: 'URGENTE' | 'Normal';
}

export interface BlueprintSpec {
  pieza_detectada: string;
  isometricBoundingBox: BoundingBox;
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

export interface AnalysisMetrics {
  totalMs: number;
  pdfRasterMs: number;
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
  effectiveFromUTC: string | null;
}

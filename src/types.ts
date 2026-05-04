export interface Order {
  pieza: string;
  cantidad: string;
  orden: string;
  fecha: string;
  prioridad: 'URGENTE' | 'Normal';
  descripcionVisual?: string;
  haSidoAuditada?: boolean;
  isometricView?: string;
  isometricBoundingBox?: [number, number, number, number];
  sourcePdfName?: string;
  sourcePdfPath?: string;
}

export interface ExtractedOrder {
  pieza: string;
  cantidad: string;
  orden: string;
  fecha: string;
  prioridad: 'URGENTE' | 'Normal';
}

export interface BlueprintSpec {
  pieza_detectada: string;
  descripcionVisual: string;
  isometricBoundingBox: [number, number, number, number];
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

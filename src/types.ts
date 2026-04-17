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

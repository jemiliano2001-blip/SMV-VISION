import type { BlueprintAnalysis, Order } from '../../types';

export interface CatalogMatch {
  drawingId: string;
  partId: string;
  score: number;
  revision: string;
  stlUrl: string | null;
  matchSource: NonNullable<Order['matchSource']>;
}

export interface BlueprintTaskResult {
  index: number;
  fileId: string;
  fileLabel: string;
  analysis: BlueprintAnalysis;
  metrics: { pdfRasterMs: number; aiBlueprintMs: number };
}

export interface BlueprintStatusPatch {
  fileId: string;
  status: 'done' | 'error';
}

export const FALLBACK_CENTER_BOX: number[] = [30, 30, 720, 970];
export const REFINEMENT_SKIP_AREA_THRESHOLD = 400_000;
export const GEMINI_BLUEPRINT_MODEL = 'gemini-3.5-flash';
export const MAX_BLUEPRINT_CONCURRENCY = 8;
export const MAX_ISO_GEN_CONCURRENCY = 3;

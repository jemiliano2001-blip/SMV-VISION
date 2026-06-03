import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { GoogleGenAI, Type } from '@google/genai';
import type {
  AnalysisMetrics,
  AnalysisRunSummary,
  BlueprintAnalysis,
  BlueprintSpec,
  BoundingBox,
  ExtractedOrder,
  Order,
  WorkOrder,
  WorkshopPdfUpload,
  ToolcribActiveDrawingView,
} from '../types';
import { createDocumentHash, readCachedValue, writeCachedValue } from '../lib/documentAnalysis/cache';
import { runWithConcurrencyLimit } from '../lib/documentAnalysis/concurrency';
import { rasterizeAndNormalizePdf } from '../lib/documentAnalysis/pdfWorkerClient';
import { recordAnalysisRunFireAndForget } from '../lib/firebase/analysisRuns';
import { log } from '../lib/log';
import { formatAgeDays, getOrderAgeDays } from '../lib/age';
import {
  MIN_BLUEPRINT_MATCH_SCORE,
  extractBlueprintSignals,
  extractLibrarySignals,
  extractOrderSignals,
  scorePieceMatch,
  selectBestBlueprintMatch,
} from '../lib/matching';
import { mergeGroupedOrders, parseOrdersResponse, validateOrderPdfName } from '../lib/orderMerge';
import { consolidateHotStamps, isHotStampCatalogEntry, isHotStampPiece } from '../lib/hotStamp';
import {
  cleanPieceName,
  withPartNumber,
  collapseDuplicateOrders,
} from '../lib/reportFormat';
import { listActiveDrawingViews } from '../lib/firebase/toolcrib';
import { upsertWorkOrders, updateCantidad, archiveWorkOrder } from '../lib/firebase/workOrders';
import type { IncomingWorkOrder } from '../lib/firebase/workOrders';
import { buildDedupeKey } from '../lib/workOrders/dedupe';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { generateReportPdf, generateSingleOrderPdf } from '../lib/pdfGenerator';
import type { ToolcribAttachment } from '../components/ToolcribLibraryPanel';

// ── Prompt versions — bump to invalidate IndexedDB cache for all users ────────
const ORDER_PROMPT_VERSION = 'orders-v7-po-multi-hoja';
const BLUEPRINT_PROMPT_VERSION = 'blueprints-v15-multi-piece-variants';
const SMV_VISION_APP_VERSION = `smv-vision@${__APP_VERSION__}`;
const METRICS_BASELINE_KEY = 'smvVisionMetricsBaselineV2';
const MAX_BLUEPRINT_CONCURRENCY = 8;
const REFINEMENT_SKIP_AREA_THRESHOLD = 200_000;
const GEMINI_ORDER_MODEL = 'gemini-3.5-flash';
const GEMINI_BLUEPRINT_MODEL = 'gemini-3.5-flash';
const FALLBACK_CENTER_BOX: number[] = [30, 30, 720, 970];

// ── Internal types ────────────────────────────────────────────────────────────
interface MetricsComparison {
  baseline: AnalysisMetrics;
  latest: AnalysisMetrics;
  totalImprovementPct: number;
}
interface BlueprintTaskResult {
  index: number;
  fileId: string;
  fileLabel: string;
  analysis: BlueprintAnalysis;
  metrics: { pdfRasterMs: number; aiBlueprintMs: number };
}
interface BlueprintStatusPatch {
  fileId: string;
  status: 'done' | 'error';
}

// ── Helper: maps a report Order to its dedup key ──────────────────────────────
function dedupeKeyOfReportOrder(order: Order): string {
  return buildDedupeKey({
    soNumber: order.orden,
    poNumber: order.poNumber ?? '',
    numeroParte: order.numero_parte ?? '',
    pieza: order.pieza,
  });
}

// ── Pure helper functions (moved verbatim from App.tsx) ───────────────────────

async function callWithRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts - 1) {
        await new Promise<void>((r) => setTimeout(r, 1000 * 2 ** attempt));
      }
    }
  }
  throw lastError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseBoundingBox(value: unknown): BoundingBox | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null;
  }

  const nums = value.map((entry) => (typeof entry === 'number' ? entry : Number.NaN));
  if (nums.some((n) => Number.isNaN(n))) {
    return null;
  }

  return [nums[0], nums[1], nums[2], nums[3]];
}

function parseBlueprintResponse(text: string): BlueprintSpec[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter(isRecord)
    .map((item) => {
      const piece = asString(item.pieza_detectada);
      const box = parseBoundingBox(item.isometricBoundingBox);
      if (!piece || !box) {
        return null;
      }

      return {
        pieza_detectada: piece,
        isometricBoundingBox: box,
      } satisfies BlueprintSpec;
    })
    .filter((item): item is BlueprintSpec => item !== null);
}

function readBaselineMetrics(): AnalysisMetrics | null {
  const raw = localStorage.getItem(METRICS_BASELINE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as AnalysisMetrics;
  } catch {
    localStorage.removeItem(METRICS_BASELINE_KEY);
    return null;
  }
}

function calculateMetricsComparison(latest: AnalysisMetrics): MetricsComparison {
  const baseline = readBaselineMetrics();
  if (!baseline) {
    localStorage.setItem(METRICS_BASELINE_KEY, JSON.stringify(latest));
    return {
      baseline: latest,
      latest,
      totalImprovementPct: 0,
    };
  }

  const improvement = baseline.totalMs > 0
    ? ((baseline.totalMs - latest.totalMs) / baseline.totalMs) * 100
    : 0;

  return {
    baseline,
    latest,
    totalImprovementPct: improvement,
  };
}

function isPdfFile(file: File): boolean {
  const mimeType = file.type.toLowerCase();
  if (mimeType === 'application/pdf') {
    return true;
  }
  return file.name.toLowerCase().endsWith('.pdf');
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }
      reject(new Error(`No fue posible leer ${file.name}.`));
    };
    reader.onerror = () => reject(new Error(`No fue posible leer ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

// ── Image/crop helpers (module-scope — no state deps) ─────────────────────────

function preparePdfPart(dataUrl: string) {
  const base64Data = dataUrl.split(';base64,')[1];
  return {
    inlineData: {
      mimeType: "application/pdf",
      data: base64Data
    }
  };
}

function prepareImagePart(dataUrl: string) {
  const base64Data = dataUrl.split(';base64,')[1];
  return {
    inlineData: {
      mimeType: "image/jpeg",
      data: base64Data
    }
  };
}

function isValidBoundingBox(box?: number[]): box is number[] {
  if (!box || box.length !== 4) return false;
  const [ymin, xmin, ymax, xmax] = box;
  if (![ymin, xmin, ymax, xmax].every((n) => Number.isFinite(n))) return false;
  const width = xmax - xmin;
  const height = ymax - ymin;
  if (width <= 50 || height <= 50) return false; // < 5% of the 0-1000 grid
  if (width * height > 750 * 750) return false; // > ~56% area => cubre múltiples vistas
  // Franja/sliver: si el lado corto es < 25% del lado largo, es un strip incorrecto
  if (Math.min(width, height) / Math.max(width, height) < 0.25) return false;
  return true;
}

function cropIsometricView(base64: string, box: number[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const padding = 12;
      const [ymin, xmin, ymax, xmax] = box;
      const x = Math.max(0, (xmin / 1000) * img.width - padding);
      const y = Math.max(0, (ymin / 1000) * img.height - padding);
      const width = Math.min(img.width - x, ((xmax - xmin) / 1000) * img.width + padding * 2);
      const height = Math.min(img.height - y, ((ymax - ymin) / 1000) * img.height + padding * 2);

      // Phase 1: crop the rectangular region
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width = width;
      cropCanvas.height = height;
      const cropCtx = cropCanvas.getContext('2d')!;
      cropCtx.fillStyle = '#FFFFFF';
      cropCtx.fillRect(0, 0, width, height);
      cropCtx.drawImage(img, x, y, width, height, 0, 0, width, height);

      // Phase 2: center the crop on a white square canvas so the aspect ratio
      // is preserved when the PDF embeds it as a fixed-size square cell.
      const side = Math.ceil(Math.max(width, height));
      const squareCanvas = document.createElement('canvas');
      squareCanvas.width = side;
      squareCanvas.height = side;
      const squareCtx = squareCanvas.getContext('2d')!;
      squareCtx.fillStyle = '#FFFFFF';
      squareCtx.fillRect(0, 0, side, side);
      squareCtx.drawImage(
        cropCanvas,
        0, 0, width, height,
        Math.floor((side - width) / 2), Math.floor((side - height) / 2), width, height,
      );

      resolve(squareCanvas.toDataURL('image/jpeg', 0.9));
    };
    // Sin onerror, una imagen corrupta dejaría la promesa colgada para
    // siempre y bloquearía el pipeline de planos (se hace await de este crop).
    img.onerror = () => reject(new Error('No se pudo cargar la imagen para recortar la vista isométrica.'));
    img.src = base64;
  });
}

function cropToBoxRaw(base64: string, box: number[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const [ymin, xmin, ymax, xmax] = box;
      const x = Math.max(0, (xmin / 1000) * img.width);
      const y = Math.max(0, (ymin / 1000) * img.height);
      const width = Math.min(img.width - x, ((xmax - xmin) / 1000) * img.width);
      const height = Math.min(img.height - y, ((ymax - ymin) / 1000) * img.height);
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.floor(width));
      canvas.height = Math.max(1, Math.floor(height));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, x, y, width, height, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.9));
    };
    img.onerror = () => reject(new Error('No se pudo cargar la imagen para el refinamiento del bounding box.'));
    img.src = base64;
  });
}

// ── Hook interfaces ───────────────────────────────────────────────────────────

export interface UseVisionAnalysisOptions {
  findWorkOrderId: (order: Order) => string | null;
  onDataChanged: () => void;
}

export interface VisionAnalysisHook {
  // File state
  orderPdf: string | null;
  orderPdfName: string | null;
  orderPdfWarning: string | null;
  workshopPdfs: WorkshopPdfUpload[];
  orderLoadingState: 'idle' | 'loading' | 'done' | 'error';
  workshopLoadingStates: Record<string, 'idle' | 'loading' | 'done' | 'error'>;
  toolcribPdfToDrawing: Record<string, string>;
  attachedToolcribDrawingIds: Set<string>;
  // Analysis state
  isExtracting: boolean;
  extractingStep: string;
  error: string | null;
  results: Order[] | null;
  analysisSummary: AnalysisRunSummary | null;
  metricsComparison: MetricsComparison | null;
  copying: boolean;
  // Edit mode
  editMode: boolean;
  originalResults: Order[] | null;
  excludedOrders: Array<{ order: Order; workOrderId: string | null }>;
  auditedCount: number;
  // Results display
  draggingZone: 'order' | 'workshop' | null;
  resultsFilter: string;
  filterUrgentOnly: boolean;
  filterMissingOnly: boolean;
  filteredResults: Order[] | null;
  previewOrder: Order | null;
  // Refs
  orderFileInputRef: React.RefObject<HTMLInputElement>;
  // File actions
  ingestOrderFile: (files: FileList | File[]) => Promise<void>;
  ingestWorkshopFiles: (files: FileList | File[]) => Promise<void>;
  handleOrderInputUpload: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleAttachToolcribDrawing: (attachment: ToolcribAttachment) => void;
  removeFile: (type: 'order' | 'workshop', fileId?: string) => void;
  buildDropHandlers: (
    zone: 'order' | 'workshop',
    onFiles: (files: FileList) => void | Promise<void>,
  ) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  // Analysis actions
  extractInfo: () => Promise<void>;
  // Export actions
  downloadPdf: () => void;
  downloadCsv: () => void;
  downloadJson: () => void;
  downloadSingleOrderPdf: (order: Order) => void;
  copyResults: () => Promise<void>;
  // Edit handlers
  snapshotOriginalOnce: () => void;
  handleEditCantidad: (order: Order, newValue: string) => void;
  handleExcludeOrder: (order: Order) => void;
  handleRestoreOrder: (entry: { order: Order; workOrderId: string | null }) => void;
  handleRestoreAll: () => void;
  // Display setters
  setResultsFilter: (v: string) => void;
  setFilterUrgentOnly: (v: boolean) => void;
  setFilterMissingOnly: (v: boolean) => void;
  setDraggingZone: (zone: 'order' | 'workshop' | null) => void;
  setEditMode: (v: boolean) => void;
  setPreviewOrder: (order: Order | null) => void;
  setError: (msg: string | null) => void;
}

// ── Implementation ────────────────────────────────────────────────────────────

export function useVisionAnalysis({
  findWorkOrderId,
  onDataChanged,
}: UseVisionAnalysisOptions): VisionAnalysisHook {
  const [orderPdf, setOrderPdf] = useState<string | null>(null);
  const [orderPdfName, setOrderPdfName] = useState<string | null>(null);
  const [orderPdfWarning, setOrderPdfWarning] = useState<string | null>(null);
  const [workshopPdfs, setWorkshopPdfs] = useState<WorkshopPdfUpload[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractingStep, setExtractingStep] = useState<string>('');
  const [workshopLoadingStates, setWorkshopLoadingStates] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [orderLoadingState, setOrderLoadingState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [metricsComparison, setMetricsComparison] = useState<MetricsComparison | null>(null);
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisRunSummary | null>(null);
  // Mapa pdfId -> drawingId para dibujos adjuntados desde la biblioteca Tool Crib.
  // Permite deduplicar adjuntos y limpiar el set al remover un PDF.
  const [toolcribPdfToDrawing, setToolcribPdfToDrawing] = useState<Record<string, string>>({});

  const orderFileInputRef = useRef<HTMLInputElement>(null);
  const workshopStatePatchQueueRef = useRef<Record<string, 'done' | 'error'>>({});
  const workshopStatePatchTimerRef = useRef<number | null>(null);
  const copyingResetTimerRef = useRef<number | null>(null);
  const hotStampRefImageRef = useRef<string | null>(null);

  const [draggingZone, setDraggingZone] = useState<'order' | 'workshop' | null>(null);

  // Filtros aplicados a la tabla de resultados.
  const [resultsFilter, setResultsFilter] = useState('');
  const [filterUrgentOnly, setFilterUrgentOnly] = useState(false);
  const [filterMissingOnly, setFilterMissingOnly] = useState(false);

  // Modal con la imagen completa del plano cuando el usuario hace click en la
  // miniatura isométrica. Null = cerrado.
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);

  // ── Modo edición del reporte (preview editable antes de imprimir) ──────────
  // `editMode` activa la edición inline sobre la hoja. `originalResults` es el
  // snapshot para "Restaurar todo" (capturado perezosamente en la 1ª mutación).
  // `excludedOrders` son las órdenes excluidas (soft-delete reversible), con su
  // `workOrderId` ya resuelto para restaurar/des-archivar sin re-buscar.
  const [editMode, setEditMode] = useState(false);
  const [originalResults, setOriginalResults] = useState<Order[] | null>(null);
  const [excludedOrders, setExcludedOrders] = useState<Array<{ order: Order; workOrderId: string | null }>>([]);

  // Cancela timers pendientes si el componente se desmonta mid-corrida (evita
  // setState-after-unmount). Cubre el batcher de estados de plano y el reset
  // del badge "Copiado".
  useEffect(() => () => {
    if (workshopStatePatchTimerRef.current !== null) {
      window.clearTimeout(workshopStatePatchTimerRef.current);
      workshopStatePatchTimerRef.current = null;
    }
    if (copyingResetTimerRef.current !== null) {
      window.clearTimeout(copyingResetTimerRef.current);
      copyingResetTimerRef.current = null;
    }
  }, []);

  const flushWorkshopStatePatches = useCallback(() => {
    const pendingPatches = workshopStatePatchQueueRef.current;
    workshopStatePatchQueueRef.current = {};
    workshopStatePatchTimerRef.current = null;
    const entries = Object.entries(pendingPatches);
    if (entries.length === 0) {
      return;
    }
    setWorkshopLoadingStates((prev) => {
      const merged = { ...prev };
      entries.forEach(([key, status]) => {
        merged[key] = status;
      });
      return merged;
    });
  }, []);

  const enqueueWorkshopStatusPatch = useCallback((patch: BlueprintStatusPatch) => {
    workshopStatePatchQueueRef.current[patch.fileId] = patch.status;
    if (workshopStatePatchTimerRef.current !== null) {
      return;
    }
    workshopStatePatchTimerRef.current = window.setTimeout(flushWorkshopStatePatches, 100);
  }, [flushWorkshopStatePatches]);

  const ingestOrderFile = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) {
      return;
    }

    const validFiles = fileArray.filter(isPdfFile);
    if (validFiles.length === 0) {
      setError("El archivo seleccionado no es un PDF válido.");
      return;
    }

    const file = validFiles[0];
    try {
      const dataUrl = await readFileAsDataUrl(file);
      setOrderPdf(dataUrl);
      setOrderPdfName(file.name);
      setOrderPdfWarning(validateOrderPdfName(file.name));
      // Reset el indicador visual del archivo: si el usuario cambia el PDF
      // después de una corrida exitosa o fallida, el icono de check/error
      // anterior quedaba mostrándose sobre el nuevo archivo.
      setOrderLoadingState('idle');
      setError(null);
    } catch {
      setError(`No fue posible leer ${file.name}.`);
      setOrderLoadingState('error');
    }
  }, []);

  const handleOrderInputUpload = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files) {
        await ingestOrderFile(files);
      }
      e.target.value = '';
    },
    [ingestOrderFile],
  );

  // Procesa una lista de PDFs como planos de taller (manual upload). Cada archivo
  // se lee a dataURL y se agrega a workshopPdfs. Útil cuando un plano todavía no
  // está en el catálogo Tool Crib pero el operador necesita auditarlo ahora.
  const ingestWorkshopFiles = useCallback(async (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(isPdfFile);
    if (pdfs.length === 0) {
      setError('Arrastra archivos PDF para agregarlos al workspace.');
      return;
    }
    const uploads = await Promise.all(
      pdfs.map(async (file): Promise<WorkshopPdfUpload> => {
        const dataUrl = await readFileAsDataUrl(file);
        return {
          id: `manual-${file.name}-${file.lastModified}-${file.size}-${crypto.randomUUID()}`,
          name: file.name,
          relativePath: file.webkitRelativePath || file.name,
          dataUrl,
        };
      }),
    );
    setWorkshopPdfs((prev) => [...prev, ...uploads]);
    setError(null);
  }, []);

  const buildDropHandlers = (
    zone: 'order' | 'workshop',
    onFiles: (files: FileList) => void | Promise<void>,
  ) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (draggingZone !== zone) setDraggingZone(zone);
    },
    onDragLeave: (e: React.DragEvent) => {
      // Solo limpia si salimos del contenedor, no de un hijo.
      if (e.currentTarget === e.target) setDraggingZone(null);
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDraggingZone(null);
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        void onFiles(files);
      }
    },
  });

  const removeFile = (type: 'order' | 'workshop', fileId?: string) => {
    if (type === 'order') {
      setOrderPdf(null);
      setOrderPdfName(null);
      setOrderPdfWarning(null);
    } else {
      setWorkshopPdfs((prev) => prev.filter((pdf) => pdf.id !== fileId));
      if (fileId) {
        setWorkshopLoadingStates((prev) => {
          const next = { ...prev };
          delete next[fileId];
          return next;
        });
        setToolcribPdfToDrawing((prev) => {
          if (!(fileId in prev)) {
            return prev;
          }
          const next = { ...prev };
          delete next[fileId];
          return next;
        });
      }
    }
  };

  const attachedToolcribDrawingIds = useMemo(
    () => new Set(Object.values(toolcribPdfToDrawing)),
    [toolcribPdfToDrawing],
  );

  const handleAttachToolcribDrawing = useCallback((attachment: ToolcribAttachment) => {
    // Regla de preservación: si el mismo drawingId ya fue adjuntado, no
    // añadimos un duplicado al estado de análisis.
    if (attachedToolcribDrawingIds.has(attachment.drawingId)) {
      return;
    }

    const pdfId = `toolcrib-${attachment.drawingId}-${crypto.randomUUID()}`;
    const relativePath = attachment.sourcePath.length > 0
      ? attachment.sourcePath
      : attachment.displayName;

    setWorkshopPdfs((prevPdfs) => [
      ...prevPdfs,
      {
        id: pdfId,
        name: attachment.displayName,
        relativePath,
        dataUrl: attachment.dataUrl,
      },
    ]);

    setToolcribPdfToDrawing((prev) => ({ ...prev, [pdfId]: attachment.drawingId }));
    setError(null);
  }, [attachedToolcribDrawingIds]);

  const copyResults = async () => {
    if (!results) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(results, null, 2));
      setCopying(true);
      if (copyingResetTimerRef.current !== null) {
        window.clearTimeout(copyingResetTimerRef.current);
      }
      copyingResetTimerRef.current = window.setTimeout(() => {
        setCopying(false);
        copyingResetTimerRef.current = null;
      }, 2000);
    } catch (err) {
      console.warn('[smv-vision] clipboard write rechazado', err);
      setError('No fue posible copiar al portapapeles. Revisa los permisos del navegador.');
    }
  };

  const downloadCsv = () => {
    if (!results) return;
    // Escape RFC 4180: envolver en comillas si el campo contiene coma, comilla
    // o salto de línea; duplicar comillas internas. Las celdas multi-línea
    // (cantidad, orden, fecha en órdenes agregadas) se colapsan a " | " para
    // que Excel no parta el registro en filas separadas.
    const escapeCell = (raw: string | undefined): string => {
      const value = (raw ?? '').replace(/\r?\n/g, ' | ');
      if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
      return value;
    };
    const header = ['Pieza', 'Numero de parte', 'Cantidad', 'SO', 'Fecha', 'Prioridad', 'Plano', 'Score'];
    const rows = results.map((order) => [
      escapeCell(order.pieza),
      escapeCell(order.numero_parte),
      escapeCell(order.cantidad),
      escapeCell(order.orden),
      escapeCell(order.fecha),
      escapeCell(order.prioridad),
      escapeCell(order.sourcePdfName),
      escapeCell(typeof order.matchScore === 'number' ? String(order.matchScore) : ''),
    ].join(','));
    // BOM UTF-8 → Excel detecta encoding y los acentos no se rompen.
    const csv = '﻿' + [header.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smv_vision_orders_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadJson = () => {
    if (!results) return;
    const blob = new Blob([JSON.stringify(results, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smv_vision_orders_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  const downloadPdf = useCallback(() => {
    if (!results) return;
    generateReportPdf(results, {
      hotStampRefImage: hotStampRefImageRef.current,
      analysisSummary,
    });
  }, [results, analysisSummary]);

  const downloadSingleOrderPdf = useCallback((order: Order) => {
    generateSingleOrderPdf(order);
  }, []);

  // Second-pass refinement: re-asks Gemini to tighten the bounding box on the
  // already-cropped region of the blueprint. Returns the refined box in the
  // original image's 0–1000 coordinate space, or the original box if the second
  // pass fails or returns an unusable result.
  const refineSpecBox = async (
    ai: GoogleGenAI,
    imageDataUrl: string,
    spec: BlueprintSpec,
  ): Promise<BlueprintSpec> => {
    if (!isValidBoundingBox(spec.isometricBoundingBox)) return spec;
    const [ymin, xmin, ymax, xmax] = spec.isometricBoundingBox;
    if ((xmax - xmin) * (ymax - ymin) < REFINEMENT_SKIP_AREA_THRESHOLD) return spec;
    try {
      const croppedImageUrl = await cropToBoxRaw(imageDataUrl, spec.isometricBoundingBox);
      const response = await callWithRetry(() => ai.models.generateContent({
        model: GEMINI_BLUEPRINT_MODEL,
        contents: [{
          role: 'user',
          parts: [
            { text: `Esta imagen es un recorte de un plano que contiene la vista de una pieza mecánica.
Devuelve EXCLUSIVAMENTE un JSON con un campo "box" = [ymin, xmin, ymax, xmax] en escala 0-1000 sobre ESTA imagen.
El box debe centrar la geometría sólida de la pieza eliminando espacio en blanco, cotas y notas a su alrededor.
Si la pieza ya ocupa toda la imagen y no hay margen recortable, devuelve [0, 0, 1000, 1000].
No inventes información.` },
            prepareImagePart(croppedImageUrl),
          ],
        }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              box: {
                type: Type.ARRAY,
                items: { type: Type.NUMBER },
              },
            },
            required: ["box"],
          },
        },
      }));
      const parsed = JSON.parse(response.text.trim()) as { box?: unknown };
      const refinedRelative = parseBoundingBox(parsed.box);
      if (!refinedRelative) return spec;

      // Map refined box from cropped-image 0-1000 space back to original-image 0-1000 space.
      const [oYmin, oXmin, oYmax, oXmax] = spec.isometricBoundingBox;
      const origW = oXmax - oXmin;
      const origH = oYmax - oYmin;
      const [rYmin, rXmin, rYmax, rXmax] = refinedRelative;
      const mapped: BoundingBox = [
        oYmin + (rYmin / 1000) * origH,
        oXmin + (rXmin / 1000) * origW,
        oYmin + (rYmax / 1000) * origH,
        oXmin + (rXmax / 1000) * origW,
      ];
      if (!isValidBoundingBox(mapped)) return spec;
      return { ...spec, isometricBoundingBox: mapped };
    } catch (e) {
      console.warn('[smv-vision] box refinement failed, keeping initial box', e);
      return spec;
    }
  };

  const extractInfo = async (): Promise<void> => {
    if (!orderPdf) {
      setError('Sube la tabla de pedidos para comenzar.');
      return;
    }

    const geminiApiKey = (import.meta.env.VITE_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? '').trim();
    if (!geminiApiKey) {
      setError('Falta configurar VITE_GEMINI_API_KEY (local) o GEMINI_API_KEY (AI Studio).');
      return;
    }

    setIsExtracting(true);
    setError(null);
    setResults(null);
    hotStampRefImageRef.current = null;
    // Reinicia el modo edición/exclusiones: una corrida nueva parte de cero.
    setEditMode(false);
    setExcludedOrders([]);
    setOriginalResults(null);
    setAnalysisSummary(null);
    setExtractingStep('Iniciando análisis...');
    setOrderLoadingState('loading');

    // Lista local para manejar PDFs adjuntados dinámicamente durante esta corrida
    let currentWorkshopPdfs = [...workshopPdfs];

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const runStart = performance.now();
    let pdfRasterMs = 0;
    let aiOrderMs = 0;
    let aiBlueprintMs = 0;
    let mergeMs = 0;

    try {
      // 1 + 1.5: Extract orders and fetch Tool Crib library concurrently — they are independent.
      setExtractingStep('Leyendo pedidos y biblioteca...');
      const [rawOrders, libResult] = await Promise.all([
        (async (): Promise<ExtractedOrder[]> => {
          try {
            const orderHash = await createDocumentHash(orderPdf);
            const cachedOrders = await readCachedValue<ExtractedOrder[]>('orders', orderHash, ORDER_PROMPT_VERSION);
            if (cachedOrders) {
              setOrderLoadingState('done');
              return cachedOrders;
            }
            const orderAiStart = performance.now();
            const response = await callWithRetry(() => ai.models.generateContent({
              model: GEMINI_ORDER_MODEL,
              contents: [{
                role: 'user',
                parts: [
                  { text: `Analiza esta tabla PDF de órdenes de taller tipo tool crib. El PDF puede tener múltiples páginas — procesa TODAS las páginas.
Devuelve EXCLUSIVAMENTE un JSON array con objetos que tengan los campos exactos:
- pieza: descripción completa y ÚNICA de la pieza (incluyendo el número de parte si no tiene columna propia)
- numero_parte: SOLO el código alfanumérico de parte (ej: "90-1012-05", "PN-12345", "WCD01-1824"). Si no existe o no aplica, devuelve "".
- cantidad: número con su unidad si aparece (ej: "2.00\\nPieza", "10\\nSet").
- orden: el número de SO (sales order / orden interna) de la hoja. Si no hay, "".
- fecha: la fecha de la orden de trabajo (OT) que aparece en la hoja. Si no hay, "".
- prioridad (solo "URGENTE" o "Normal")
- poNumber: el número de PO (orden de compra del cliente) de la hoja. Cada hoja del PDF es una PO con sus piezas. PO y SO son DISTINTOS. Si no hay, "".

Reglas de extracción:
1) Lee TODAS las columnas y filas de TODAS las páginas, manejando celdas fusionadas o descripciones multi-línea.
2) NO cortes las descripciones. Si una descripción de pieza continúa en la siguiente línea, concaténala.
3) Si existe una columna "Código de Parte", "Part Number" o similar, coloca ese valor en "numero_parte" y la descripción de la pieza en "pieza". Si ambos están en la misma celda, sepáralos.
4) Devuelve una fila por cada pieza o variante real. Si hay sub-piezas bajo una cabecera, extrae cada una.
5) Si una fila tiene dato de fecha, orden o cantidad, procésala.
6) Excluye filas de totales (ej: "Piezas Requeridas", "Piezas Terminadas", "Restantes a Crear").
7) Si no hay urgencia explícita, usa "Normal".
8) NORMALIZA typos evidentes del origen sin cambiar el significado:
   - "PRESAS" → "PRENSAS"
   - "PATA" (cuando va seguida de PRENSAS/...) → "PARA"
   - "3/8HEX" → "3/8 HEX"
   - Variantes "PRESS-O-MATIC" / "PRESS O -MATIC" / "PRESS O MATIC ." / "PRESS O MATIC" → "PRESS-O-MATIC"
   - Colapsa espacios múltiples a uno solo.
9) SUB-LÍNEAS ÚNICAS: si bajo un mismo SO aparecen varias sub-líneas con descripciones aparentemente idénticas (ej: 5 renglones que solo dicen "Fabricación de pieza" bajo SO 2026/S00781), revisa la columna de descripción/detalle/notas y EXTRAE el detalle diferenciador (número de pieza secuencial, código de parte, dimensión, material) para que cada fila tenga una descripción ÚNICA. Si genuinamente no existe diferencia textual, consolida las sub-líneas en UNA SOLA fila sumando la cantidad — no devuelvas 5 filas idénticas.
10) No devuelvas filas exactamente duplicadas (mismo pieza+numero_parte+orden+fecha+cantidad).
11) Cada HOJA del PDF corresponde a una PO. Propaga el mismo poNumber (y su SO/fecha) a TODAS las piezas listadas en esa hoja.
12) No inventes campos ni texto fuera del JSON.` },
                  preparePdfPart(orderPdf)
                ]
              }],
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      pieza: { type: Type.STRING },
                      numero_parte: { type: Type.STRING },
                      cantidad: { type: Type.STRING },
                      orden: { type: Type.STRING },
                      fecha: { type: Type.STRING },
                      prioridad: { type: Type.STRING, enum: ["URGENTE", "Normal"] },
                      poNumber: { type: Type.STRING }
                    },
                    required: ["pieza", "numero_parte", "cantidad", "orden", "fecha", "prioridad", "poNumber"]
                  }
                }
              }
            }));
            aiOrderMs += performance.now() - orderAiStart;
            const parsed = parseOrdersResponse(response.text.trim());
            await writeCachedValue('orders', orderHash, ORDER_PROMPT_VERSION, parsed);
            setOrderLoadingState('done');
            return parsed;
          } catch (e) {
            setOrderLoadingState('error');
            throw e;
          }
        })(),
        listActiveDrawingViews({ customer: 'SUPRAJIT' }),
      ]);

      // Merge rows with identical piece descriptions: sum quantities, join SO numbers and dates
      const ordersList = mergeGroupedOrders(rawOrders);

      // Captura el dibujo de catálogo emparejado por orden, para la capa de control.
      // Declarado aquí (no dentro de `if (libResult.ok)`) para seguir en alcance en el upsert.
      const matchByOrder = new Map<ExtractedOrder, { drawingId: string; partId: string; score: number }>();

      // Auto-Matching: attach blueprints from library that match the extracted orders
      setExtractingStep('Buscando planos en biblioteca...');
      log.debug('[smv-vision][library] resultado:', libResult.ok ? `${libResult.value.length} entradas` : `FALLO: ${(libResult as { ok: false; reason: string }).reason}`);
      if (libResult.ok) {
        const library = libResult.value;
        log.debug('[smv-vision][library] entradas cargadas:', library.map((v) => `${v.partNumber} pdfUrl=${v.pdfUrl ? '✓' : '✗null'}`));
        const autoAttachedIds = new Set(Object.values(toolcribPdfToDrawing));

        // Pre-compute signals once per library entry and per manual PDF (#3, #5)
        const librarySignals = new Map(
          library.map((view) => [view.drawingId, extractLibrarySignals(view)])
        );
        const manualPdfSignals = currentWorkshopPdfs.map((pdf) => ({
          pdf,
          signals: extractBlueprintSignals(pdf.relativePath, []),
        }));

        // Score all orders synchronously, collect unique library matches to fetch (#3, #5)
        const toFetchMap = new Map<string, { bestView: ToolcribActiveDrawingView; pdfId: string }>();
        // Drawings found in library but missing a fetchable URL (network-only)
        const noUrlMatches: Array<{ pieza: string; partNumber: string; drawingId: string }> = [];

        for (const order of ordersList) {
          const orderSignals = extractOrderSignals(order.pieza, order.numero_parte);

          const hasManualMatch = manualPdfSignals.some(
            ({ signals }) => scorePieceMatch(orderSignals, signals) >= MIN_BLUEPRINT_MATCH_SCORE
          );
          if (hasManualMatch) continue;

          // ISO-first: si algún ISO supera el umbral, gana sobre cualquier plano CAD.
          let bestIsoView: ToolcribActiveDrawingView | null = null;
          let bestIsoScore = 0;
          let bestNonIsoView: ToolcribActiveDrawingView | null = null;
          let bestNonIsoScore = 0;

          for (const view of library) {
            const score = scorePieceMatch(orderSignals, librarySignals.get(view.drawingId)!);
            const isIso =
              view.partNumber.toLowerCase().includes('.iso') ||
              (view.sourcePath ?? '').toLowerCase().includes('.iso');
            if (isIso) {
              if (score > bestIsoScore) { bestIsoScore = score; bestIsoView = view; }
            } else {
              if (score > bestNonIsoScore) { bestNonIsoScore = score; bestNonIsoView = view; }
            }
          }

          const bestView = (bestIsoView && bestIsoScore >= MIN_BLUEPRINT_MATCH_SCORE)
            ? bestIsoView
            : (bestNonIsoView ?? bestIsoView);
          const bestScore = (bestIsoView && bestIsoScore >= MIN_BLUEPRINT_MATCH_SCORE)
            ? bestIsoScore
            : (bestNonIsoView ? bestNonIsoScore : bestIsoScore);

          log.debug(
            '[smv-vision][match]',
            order.pieza,
            '→ best:', bestView ? `${bestView.partNumber} (score ${bestScore}, pdfUrl: ${bestView.pdfUrl ? '✓' : '✗null'})` : 'sin coincidencia',
          );

          if (bestView && bestScore >= MIN_BLUEPRINT_MATCH_SCORE) {
            if (!bestView.pdfUrl) {
              // Drawing is in catalog but has no fetchable URL — log and track
              console.warn(
                '[smv-vision][match] coincidencia encontrada sin pdfUrl (plano en red, no en Storage):',
                order.pieza, '→', bestView.partNumber, `(drawingId: ${bestView.drawingId})`,
              );
              noUrlMatches.push({ pieza: order.pieza, partNumber: bestView.partNumber, drawingId: bestView.drawingId });
            } else if (!autoAttachedIds.has(bestView.drawingId) && !toFetchMap.has(bestView.drawingId)) {
              toFetchMap.set(bestView.drawingId, {
                bestView,
                pdfId: `toolcrib-${bestView.drawingId}-${crypto.randomUUID()}`,
              });
            }
          }

          if (bestView && bestScore >= MIN_BLUEPRINT_MATCH_SCORE) {
            matchByOrder.set(order, {
              drawingId: bestView.drawingId,
              partId: bestView.partId,
              score: bestScore,
            });
          }
        }

        if (noUrlMatches.length > 0) {
          console.warn(
            '[smv-vision] Planos encontrados en catálogo pero sin URL de descarga (subir a Firebase Storage):',
            noUrlMatches.map((m) => `${m.pieza} → ${m.partNumber}`).join(', '),
          );
        }

        // Hot stamp ISO: búsqueda dedicada por keyword (el fuzzy no conecta
        // "HOT STAMP LETRA M" con "PUNZONES DE MARCA"). Si hay ≥2 punzones y
        // existe una entrada en el catálogo, rasteriza el ISO como referencia.
        const hotStampOrders = ordersList.filter((o) => isHotStampPiece(o.pieza));
        if (hotStampOrders.length >= 2) {
          const hotStampEntry =
            library.find((v) => isHotStampCatalogEntry(v) && (
              v.partNumber.toLowerCase().includes('.iso') ||
              (v.sourcePath ?? '').toLowerCase().includes('.iso')
            )) ??
            library.find((v) => isHotStampCatalogEntry(v));

          if (hotStampEntry?.pdfUrl) {
            try {
              const hsDataUrl = await fetchPdfAsDataUrl(hotStampEntry.pdfUrl);
              const hsRaster = await rasterizeAndNormalizePdf(hsDataUrl, {
                maxDim: 1024,
                renderScale: 1.5,
                jpegQuality: 0.80,
                normalizeQuality: 0.78,
              });
              hotStampRefImageRef.current = hsRaster.imageDataUrl;
              log.debug('[smv-vision][hot-stamp] ISO de referencia rasterizado:', hotStampEntry.partNumber);
            } catch (e) {
              console.warn('[smv-vision][hot-stamp] Error al rasterizar ISO de referencia:', e);
            }
          }
        }

        // Fetch all matched blueprints in parallel (#1)
        if (toFetchMap.size > 0) {
          setExtractingStep(`Auto-adjuntando ${toFetchMap.size} plano(s)...`);
          const fetchResults = await Promise.allSettled(
            [...toFetchMap.values()].map(async ({ bestView, pdfId }) => {
              const dataUrl = await fetchPdfAsDataUrl(bestView.pdfUrl!);
              return { bestView, pdfId, dataUrl };
            })
          );

          const newUploads: WorkshopPdfUpload[] = [];
          const newDrawingMap: Record<string, string> = {};

          for (const result of fetchResults) {
            if (result.status === 'rejected') {
              console.warn('[smv-vision] auto-attach fetch failed', result.reason);
              continue;
            }
            const { bestView, pdfId, dataUrl } = result.value;
            const newUpload: WorkshopPdfUpload = {
              id: pdfId,
              name: `${bestView.partNumber} (Rev ${bestView.revision}).pdf`,
              relativePath: bestView.sourcePath || bestView.partNumber,
              dataUrl,
            };
            newUploads.push(newUpload);
            newDrawingMap[pdfId] = bestView.drawingId;
            currentWorkshopPdfs.push(newUpload);
          }

          if (newUploads.length > 0) {
            setWorkshopPdfs((prev) => [...prev, ...newUploads]);
            setToolcribPdfToDrawing((prev) => ({ ...prev, ...newDrawingMap }));
          }
        }
      }

      // Persistir TODAS las órdenes en la capa de control (incluso sin plano):
      // una orden "Pendiente sin plano" también se debe rastrear.
      try {
        const incoming: IncomingWorkOrder[] = ordersList.map((order) => {
          const m = matchByOrder.get(order);
          return {
            pieza: order.pieza,
            numeroParte: order.numero_parte,
            cantidad: order.cantidad,
            prioridad: order.prioridad,
            soNumber: order.orden,
            poNumber: order.poNumber ?? '',
            otDate: order.fecha,
            customer: 'SUPRAJIT',
            matchedDrawingId: m?.drawingId ?? null,
            matchedPartId: m?.partId ?? null,
            matchScore: m?.score ?? null,
            sourcePdfName: orderPdfName ?? '',
          };
        });
        const upsertResult = await upsertWorkOrders(incoming);
        if (upsertResult.ok === false) {
          console.warn('[smv-vision][work-orders] upsert no aplicado:', upsertResult.reason);
        } else {
          log.debug('[smv-vision][work-orders] upsert', upsertResult.value);
        }
      } catch (woErr) {
        console.warn('[smv-vision][work-orders] upsert lanzó (inesperado)', woErr);
      }

      // Revalida el resumen global (badges del rail + portada Inicio) con las
      // órdenes recién creadas/actualizadas.
      onDataChanged();

      if (currentWorkshopPdfs.length === 0) {
        setError('No se encontraron planos para las piezas detectadas. Sube planos manualmente o verifica la biblioteca.');
        setIsExtracting(false);
        return;
      }

      // 2. Render initial results immediately (progressive render) — orders only,
      // blueprints will fill in their isometric views as they finish analyzing.
      const initialResults: Order[] = ordersList.map((order) => ({
        ...order,
        haSidoAuditada: false,
      }));
      setResults(initialResults);

      // Best-match tracking per order index, mutated as blueprints complete.
      // `isIso` permite que un ISO proteja su posición contra planos CAD con score mayor.
      const bestMatchByOrder = new Map<number, { score: number; fileId: string; isIso: boolean }>();
      const matchedBlueprintFileIds = new Set<string>();
      let completedBlueprints = 0;
      const totalBlueprints = currentWorkshopPdfs.length;
      // Deduplicates identical crop operations within a single run (#6)
      const cropCache = new Map<string, string>();

      // Per-file tracking of which specs have been consumed by which order index.
      // Lets us spread isometric crops across orders when a single blueprint
      // contains multiple distinct pieces (#1).
      const usedSpecsByFileId = new Map<string, Map<BlueprintSpec, number>>();

      // Progressive merge: applies one blueprint result against the current state of
      // orders, updating any order whose best match this blueprint improves on.
      const applyBlueprintToResults = async (result: BlueprintTaskResult): Promise<void> => {
        type Update = { orderIdx: number; partial: Partial<Order> };
        const updates: Update[] = [];

        if (!usedSpecsByFileId.has(result.fileId)) {
          usedSpecsByFileId.set(result.fileId, new Map());
        }
        const usedSpecsForFile = usedSpecsByFileId.get(result.fileId)!;

        for (let i = 0; i < ordersList.length; i++) {
          const order = ordersList[i];
          // Build the "used" set excluding any spec previously assigned to THIS order
          // (so that re-processing the same blueprint doesn't keep moving the order).
          const usedSet = new Set<BlueprintSpec>();
          for (const [spec, idx] of usedSpecsForFile) {
            if (idx !== i) usedSet.add(spec);
          }
          const match = selectBestBlueprintMatch(order.pieza, {
            fileLabel: result.fileLabel,
            specs: result.analysis.specs,
          }, order.numero_parte, usedSet);
          if (match.score < MIN_BLUEPRINT_MATCH_SCORE) continue;
          const isNewIso = result.fileLabel.toLowerCase().includes('.iso');
          const current = bestMatchByOrder.get(i);
          if (current) {
            if (current.isIso && !isNewIso) continue;         // ISO protege su posición
            if (!current.isIso && isNewIso) { /* ISO reemplaza CAD */ }
            else if (current.score >= match.score) continue;  // comparación normal
          }

          bestMatchByOrder.set(i, { score: match.score, fileId: result.fileId, isIso: isNewIso });
          matchedBlueprintFileIds.add(result.fileId);

          // Mark this spec as consumed for this file/order pair.
          if (match.spec) {
            usedSpecsForFile.set(match.spec, i);
          }

          const cropBox = isValidBoundingBox(match.spec?.isometricBoundingBox)
            ? match.spec!.isometricBoundingBox
            : FALLBACK_CENTER_BOX;
          let isometricView: string | undefined;
          if (result.analysis.image) {
            try {
              const cropKey = `${result.fileId}:${cropBox.join(',')}`;
              const cached = cropCache.get(cropKey);
              if (cached !== undefined) {
                isometricView = cached;
              } else {
                isometricView = await cropIsometricView(result.analysis.image, cropBox);
                cropCache.set(cropKey, isometricView);
              }
            } catch (e) {
              console.error('Auto-crop error', e);
            }
          }

          updates.push({
            orderIdx: i,
            partial: {
              haSidoAuditada: true,
              isometricBoundingBox: match.spec?.isometricBoundingBox,
              sourcePdfName: result.fileLabel,
              sourcePdfPath: result.fileLabel,
              isometricView,
              matchScore: match.score,
              sourceImageDataUrl: result.analysis.image || undefined,
            },
          });
        }

        if (updates.length === 0) return;
        setResults((prev) => {
          if (!prev) return prev;
          const next = [...prev];
          for (const u of updates) {
            next[u.orderIdx] = { ...next[u.orderIdx], ...u.partial };
          }
          return next;
        });
      };

      // 3. Extract Blueprints (Vision) with two-pass refinement and progressive merge.
      setExtractingStep(`Analizando planos: 0/${totalBlueprints}`);
      const initialWorkshopStates: Record<string, 'loading'> = {};
      currentWorkshopPdfs.forEach((pdf) => { initialWorkshopStates[pdf.id] = 'loading'; });
      setWorkshopLoadingStates(initialWorkshopStates);

      // Phase A: parallel cache lookup — cache hits never enter the concurrency pool (#4)
      const cacheCheckResults = await Promise.all(
        currentWorkshopPdfs.map(async (pdf, index) => {
          const hash = await createDocumentHash(pdf.dataUrl);
          const cached = await readCachedValue<BlueprintAnalysis>('blueprint', hash, BLUEPRINT_PROMPT_VERSION);
          return { pdf, hash, index, cached };
        })
      );

      const blueprintTaskResults: BlueprintTaskResult[] = new Array(currentWorkshopPdfs.length);

      // Apply cache hits immediately — no AI calls, no concurrency slot consumed
      for (const { pdf, index, cached } of cacheCheckResults) {
        if (!cached) continue;
        enqueueWorkshopStatusPatch({ fileId: pdf.id, status: 'done' });
        const taskResult: BlueprintTaskResult = {
          index,
          fileId: pdf.id,
          fileLabel: pdf.relativePath,
          analysis: cached,
          metrics: { pdfRasterMs: 0, aiBlueprintMs: 0 },
        };
        blueprintTaskResults[index] = taskResult;
        await applyBlueprintToResults(taskResult);
        completedBlueprints += 1;
        setExtractingStep(`Analizando planos: ${completedBlueprints}/${totalBlueprints}`);
      }

      // Phase B: only cache misses go through the rate-limited concurrency pool
      const cacheMisses = cacheCheckResults.filter(({ cached }) => cached === null);
      const missResults = await runWithConcurrencyLimit(
        cacheMisses,
        MAX_BLUEPRINT_CONCURRENCY,
        async ({ pdf, hash, index }): Promise<BlueprintTaskResult> => {
          let taskResult: BlueprintTaskResult;
          try {
            const workerResult = await rasterizeAndNormalizePdf(pdf.dataUrl, {
              maxDim: 1024,
              renderScale: 1.5,
              jpegQuality: 0.80,
              normalizeQuality: 0.78,
            });

            const blueprintAiStart = performance.now();
            const response = await callWithRetry(() => ai.models.generateContent({
              model: GEMINI_BLUEPRINT_MODEL,
              contents: [{
                role: 'user',
                parts: [
                  { text: `Analiza este plano de taller y devuelve EXCLUSIVAMENTE un JSON array.
Campos: pieza_detectada, isometricBoundingBox [ymin, xmin, ymax, xmax] (0 a 1000).

Reglas de extracción (ESTILO UT2033):
1) Identifica el "Código de Parte" o "Número de Dibujo". Búscalo en el Cajetín (Title Block), esquina INFERIOR DERECHA.
2) PRIORIDAD ABSOLUTA: Elige la Vista Isométrica 3D (el dibujo que muestra la pieza con volumen). Si existe, el bounding box DEBE ser sobre esta vista. Usa una vista 2D solo si no hay isométrica.
3) GEOMETRÍA LIMPIA: El bounding box debe contener ÚNICAMENTE la geometría sólida de la pieza.
4) REGLA CRÍTICA: Excluye ABSOLUTAMENTE todas las líneas de dimensión (cotas), flechas, números de medidas, líneas de extensión y notas de texto que rodeen la pieza. El recorte debe verse "limpio" como una foto de catálogo.
5) Excluye el marco del plano, marcas de coordenadas en los bordes, cajetines y logos.
6) El bounding box debe estar bien centrado sobre la masa física de la pieza.
7) MULTI-PIEZA — REGLA OBLIGATORIA: si el plano contiene varias piezas (común en planos de variantes por tamaño, p.ej. HEX SWAGE BLOCK 7/32, 9/32, 3/8, 1/4, 5/16, 13/32, 7/16; o conjuntos de remaches, navajas, blocks, etc.), DEBES devolver UNA entrada por cada variante con su PROPIO bounding box centrado en SU geometría. NO devuelvas una sola entrada que englobe a todas. En "pieza_detectada" incluye el sufijo distintivo (tamaño, fracción, código, letra) que diferencia cada variante (ej: "HEX SWAGE BLOCK 7/32", "HEX SWAGE BLOCK 9/32"). Si no puedes leer el sufijo, usa un índice claro ("PIEZA 1", "PIEZA 2") pero sigue devolviendo una entrada por pieza distinta.
8) Si solo hay una pieza con varias vistas (frontal, lateral, isométrica), devuelve UNA sola entrada con el bbox de la vista isométrica.
9) Si no hay vistas útiles, devuelve [].
10) No inventes información.` },
                  prepareImagePart(workerResult.imageDataUrl)
                ]
              }],
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      pieza_detectada: { type: Type.STRING },
                      isometricBoundingBox: {
                        type: Type.ARRAY,
                        items: { type: Type.NUMBER },
                      },
                    },
                    required: ["pieza_detectada", "isometricBoundingBox"]
                  }
                }
              }
            }));
            const aiElapsed = performance.now() - blueprintAiStart;
            const initialSpecs = parseBlueprintResponse(response.text.trim());

            // Two-pass box refinement in parallel across all specs (#2)
            const refinedSpecs = await Promise.all(
              initialSpecs.map((spec) => refineSpecBox(ai, workerResult.imageDataUrl, spec))
            );

            const analysis: BlueprintAnalysis = {
              specs: refinedSpecs,
              image: workerResult.imageDataUrl,
            };
            await writeCachedValue('blueprint', hash, BLUEPRINT_PROMPT_VERSION, analysis);
            enqueueWorkshopStatusPatch({ fileId: pdf.id, status: 'done' });
            taskResult = {
              index,
              fileId: pdf.id,
              fileLabel: pdf.relativePath,
              analysis,
              metrics: {
                pdfRasterMs: workerResult.metrics.pdfRasterMs + workerResult.metrics.normalizeMs,
                aiBlueprintMs: aiElapsed,
              },
            };
          } catch (e) {
            enqueueWorkshopStatusPatch({ fileId: pdf.id, status: 'error' });
            console.error('[smv-vision] blueprint analysis failed for', pdf.name, e);
            taskResult = {
              index,
              fileId: pdf.id,
              fileLabel: pdf.relativePath,
              analysis: { specs: [], image: '' },
              metrics: { pdfRasterMs: 0, aiBlueprintMs: 0 },
            };
          }

          // Progressive merge + counter update
          await applyBlueprintToResults(taskResult);
          completedBlueprints += 1;
          setExtractingStep(`Analizando planos: ${completedBlueprints}/${totalBlueprints}`);
          return taskResult;
        },
      );

      for (const result of missResults) {
        blueprintTaskResults[result.index] = result;
      }

      flushWorkshopStatePatches();
      blueprintTaskResults.forEach((entry) => {
        pdfRasterMs += entry.metrics.pdfRasterMs;
        aiBlueprintMs += entry.metrics.aiBlueprintMs;
      });

      // 4. Final summary
      setExtractingStep('Generando reporte final...');
      const mergeStart = performance.now();
      if (ordersList.length === 0) {
        throw new Error("No fue posible extraer órdenes desde la tabla de entrada.");
      }
      mergeMs = performance.now() - mergeStart;
      const totalAudited = bestMatchByOrder.size;
      setAnalysisSummary({
        totalLoaded: currentWorkshopPdfs.length,
        totalAnalyzed: blueprintTaskResults.length,
        totalAudited,
        totalNonMatching: Math.max(0, blueprintTaskResults.length - matchedBlueprintFileIds.size),
        totalOrders: ordersList.length,
      });
      const latestMetrics: AnalysisMetrics = {
        totalMs: performance.now() - runStart,
        pdfRasterMs,
        aiOrderMs,
        aiBlueprintMs,
        mergeMs,
      };
      setMetricsComparison(calculateMetricsComparison(latestMetrics));

      const auditSummary = {
        totalLoaded: currentWorkshopPdfs.length,
        totalAnalyzed: blueprintTaskResults.length,
        totalAudited,
        totalNonMatching: Math.max(0, blueprintTaskResults.length - matchedBlueprintFileIds.size),
        totalOrders: ordersList.length,
      };
      void (async () => {
        try {
          const [orderReportSha256, blueprintSha256List] = await Promise.all([
            createDocumentHash(orderPdf),
            Promise.all(currentWorkshopPdfs.map((pdf) => createDocumentHash(pdf.dataUrl))),
          ]);
          recordAnalysisRunFireAndForget({
            userUid: null, // sustituido por el writer con auth.currentUser.uid
            status: 'success',
            promptVersions: {
              order: ORDER_PROMPT_VERSION,
              blueprint: BLUEPRINT_PROMPT_VERSION,
            },
            documentHashes: { orderReportSha256, blueprintSha256List },
            summary: auditSummary,
            metrics: latestMetrics,
            errorMessage: null,
            clientInfo: {
              userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
              appVersion: SMV_VISION_APP_VERSION,
            },
          });
        } catch (auditErr) {
          console.warn('[smv-vision][audit] hash calc para success falló', auditErr);
        }
      })();
    } catch (err: unknown) {
      console.error("PDF Analysis Error Object:", err);
      const errorMessage = err instanceof Error ? err.message : JSON.stringify(err);
      setError(`Error analizando PDFs: ${errorMessage}. Verifique su conexión y permisos de API.`);

      const capturedOrderPdf = orderPdf;
      const capturedWorkshopPdfs = currentWorkshopPdfs;
      void (async () => {
        try {
          const orderReportSha256 = capturedOrderPdf
            ? await createDocumentHash(capturedOrderPdf)
            : null;
          const blueprintSha256List = await Promise.all(
            capturedWorkshopPdfs.map((pdf) => createDocumentHash(pdf.dataUrl)),
          );
          recordAnalysisRunFireAndForget({
            userUid: null, // sustituido por el writer con auth.currentUser.uid
            status: 'error',
            promptVersions: {
              order: ORDER_PROMPT_VERSION,
              blueprint: BLUEPRINT_PROMPT_VERSION,
            },
            documentHashes: { orderReportSha256, blueprintSha256List },
            summary: null,
            metrics: null,
            errorMessage,
            clientInfo: {
              userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
              appVersion: SMV_VISION_APP_VERSION,
            },
          });
        } catch (auditErr) {
          console.warn('[smv-vision][audit] hash calc para error falló', auditErr);
        }
      })();
    } finally {
      flushWorkshopStatePatches();
      setIsExtracting(false);
    }
  };

  return {
    orderPdf, orderPdfName, orderPdfWarning, workshopPdfs,
    orderLoadingState, workshopLoadingStates,
    toolcribPdfToDrawing, attachedToolcribDrawingIds,
    isExtracting, extractingStep, error, results,
    analysisSummary, metricsComparison, copying,
    editMode, originalResults, excludedOrders,
    auditedCount: results ? results.filter((r) => r.haSidoAuditada).length : 0,
    draggingZone, resultsFilter, filterUrgentOnly, filterMissingOnly,
    filteredResults: null, // placeholder — Task 5
    previewOrder,
    orderFileInputRef,
    extractInfo, ingestOrderFile, ingestWorkshopFiles,
    handleOrderInputUpload, handleAttachToolcribDrawing,
    removeFile, buildDropHandlers,
    downloadPdf, downloadCsv, downloadJson,
    downloadSingleOrderPdf, copyResults,
    // edit handlers — Task 5
    snapshotOriginalOnce: () => {},
    handleEditCantidad: () => {},
    handleExcludeOrder: () => {},
    handleRestoreOrder: () => {},
    handleRestoreAll: () => {},
    setResultsFilter, setFilterUrgentOnly, setFilterMissingOnly,
    setDraggingZone, setEditMode, setPreviewOrder, setError,
  };
}

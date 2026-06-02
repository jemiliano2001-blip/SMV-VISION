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

  const extractInfo = async (): Promise<void> => {
    throw new Error('extractInfo: not yet implemented — Task 4');
  };

  // Suppress unused variable warnings for refs/state used by extractInfo (Task 4)
  void setIsExtracting;
  void setExtractingStep;
  void setOrderLoadingState;
  void setResults;
  void setMetricsComparison;
  void setAnalysisSummary;
  void setWorkshopLoadingStates;
  void hotStampRefImageRef;
  void enqueueWorkshopStatusPatch;
  void flushWorkshopStatePatches;
  void findWorkOrderId;
  void onDataChanged;

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

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
  OrderDrawingLink,
  WorkshopPdfUpload,
  ToolcribActiveDrawingView,
} from '../types';
import { createDocumentHash, readCachedValue, writeCachedValue } from '../lib/documentAnalysis/cache';
import { runWithConcurrencyLimit } from '../lib/documentAnalysis/concurrency';
import { rasterizeAndNormalizePdf } from '../lib/documentAnalysis/pdfWorkerClient';
import { recordAnalysisRunFireAndForget } from '../lib/firebase/analysisRuns';
import { log } from '../lib/log';
import {
  MIN_BLUEPRINT_MATCH_SCORE,
  extractBlueprintSignals,
  extractLibrarySignals,
  extractOrderSignals,
  scorePieceMatch,
  selectBestBlueprintMatch,
  selectLibraryDrawingMatch,
} from '../lib/matching';
import { isHotStampCatalogEntry, isHotStampPiece } from '../lib/hotStamp';
import { listActiveDrawingViews } from '../lib/firebase/toolcrib';
import { listOrdersToInvoice, REPORT_PARTNER_KEY_PREFIX } from '../lib/firebase/odooOrders';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { generateReportPdf, generateSingleOrderPdf } from '../lib/pdfGenerator';
import type { ToolcribAttachment } from '../components/ToolcribLibraryPanel';
import { callWithRetry, prepareImagePart } from '../lib/gemini';
import {
  parseBoundingBox,
  parseBlueprintResponse,
} from '../lib/blueprintParsers';
import {
  isValidBoundingBox,
  cropIsometricView,
  cropToBoxRaw,
} from '../lib/imageProcessing';
import {
  canGenerateAiIsometric,
  generateIsometricImageFromDrawing,
  ISOMETRIC_GEN_PROMPT_VERSION,
} from '../lib/generateIsometricImage';
import {
  getReportDrawingSnapshot,
  viewFromSnapshot,
} from '../lib/orderDrawingBridge';
import { downloadOrdersCsv } from '../lib/excelExport';

// ── Prompt versions — bump to invalidate IndexedDB cache for all users ────────
const ORDER_PROMPT_VERSION = 'orders-v7-po-multi-hoja';
const BLUEPRINT_PROMPT_VERSION = 'blueprints-v16-title-block-meta';
const MAX_ISO_GEN_CONCURRENCY = 3;
const SMV_VISION_APP_VERSION = `smv-vision@${__APP_VERSION__}`;
const MAX_BLUEPRINT_CONCURRENCY = 8;
// Umbral para el segundo pase de refinamiento del bounding box.
// 400k = ~632×632px: solo recuadros muy grandes disparan el pase adicional.
// (Antes: 200k — disparaba en la mayoría de planos estándar, doblando llamadas Gemini)
const REFINEMENT_SKIP_AREA_THRESHOLD = 400_000;
const GEMINI_BLUEPRINT_MODEL = 'gemini-3.5-flash';
const FALLBACK_CENTER_BOX: number[] = [30, 30, 720, 970];

// ── Internal types ────────────────────────────────────────────────────────────
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



// ── Pure helper functions ────────────────────────────────────────────────────

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

export interface UseVisionAnalysisOptions {}

export interface VisionAnalysisHook {
  // File state
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
  copying: boolean;
  // Edit mode
  editMode: boolean;
  originalResults: Order[] | null;
  excludedOrders: Array<{ order: Order }>;
  auditedCount: number;
  // Results display
  draggingZone: 'workshop' | null;
  resultsFilter: string;
  filterUrgentOnly: boolean;
  filterMissingOnly: boolean;
  filteredResults: Order[] | null;
  previewOrder: Order | null;
  // Refs
  // File actions
  ingestWorkshopFiles: (files: FileList | File[]) => Promise<void>;
  handleAttachToolcribDrawing: (attachment: ToolcribAttachment) => void;
  /** Adjunta planos de vínculos del bridge e indexa semillas para la auditoría. */
  seedFromBridgeLinks: (links: readonly OrderDrawingLink[]) => Promise<void>;
  seededBridgeLinks: readonly OrderDrawingLink[];
  removeSeededBridgeLink: (key: string) => void;
  removeFile: (type: 'workshop', fileId?: string) => void;
  buildDropHandlers: (
    zone: 'workshop',
    onFiles: (files: FileList) => void | Promise<void>,
  ) => {
    onDragOver: (e: React.DragEvent) => void;
    onDragLeave: (e: React.DragEvent) => void;
    onDrop: (e: React.DragEvent) => void;
  };
  // Analysis actions
  extractInfo: () => Promise<void>;
  /**
   * Genera (o regenera) una vista 3D con IA a partir del plano 2D de la orden.
   * Fail-soft: errores van a `error` / log; no rompe el reporte.
   */
  generateAiIsometricForOrder: (order: Order) => Promise<void>;
  /** Clave de la orden que está generando 3D IA ahora, o null. */
  aiIsoGeneratingKey: string | null;
  isAiIsoGenerating: (order: Order) => boolean;
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
  handleRestoreOrder: (entry: { order: Order }) => void;
  handleRestoreAll: () => void;
  handleUpdateOrderCrop: (order: Order, newBox: BoundingBox, newCroppedUrl: string) => void;
  // Display setters
  setResultsFilter: (v: string) => void;
  setFilterUrgentOnly: (v: boolean) => void;
  setFilterMissingOnly: (v: boolean) => void;
  setDraggingZone: (zone: 'workshop' | null) => void;
  setEditMode: (v: boolean) => void;
  setPreviewOrder: (order: Order | null) => void;
  setError: (msg: string | null) => void;
}

// ── Implementation ────────────────────────────────────────────────────────────

export function useVisionAnalysis({}: UseVisionAnalysisOptions = {}): VisionAnalysisHook {
  const [workshopPdfs, setWorkshopPdfs] = useState<WorkshopPdfUpload[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractingStep, setExtractingStep] = useState<string>('');
  const [workshopLoadingStates, setWorkshopLoadingStates] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [orderLoadingState, setOrderLoadingState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisRunSummary | null>(null);
  // Mapa pdfId -> drawingId para dibujos adjuntados desde la biblioteca Tool Crib.
  // Permite deduplicar adjuntos y limpiar el set al remover un PDF.
  const [toolcribPdfToDrawing, setToolcribPdfToDrawing] = useState<Record<string, string>>({});
  /** Vínculos enviados desde Órdenes (sesión); la auditoría los prioriza. */
  const [seededBridgeLinks, setSeededBridgeLinks] = useState<OrderDrawingLink[]>([]);
  const seededBridgeLinksRef = useRef<OrderDrawingLink[]>([]);
  useEffect(() => {
    seededBridgeLinksRef.current = seededBridgeLinks;
  }, [seededBridgeLinks]);


  const workshopStatePatchQueueRef = useRef<Record<string, 'done' | 'error'>>({});
  const workshopStatePatchTimerRef = useRef<number | null>(null);
  const copyingResetTimerRef = useRef<number | null>(null);
  const hotStampRefImageRef = useRef<string | null>(null);

  const [draggingZone, setDraggingZone] = useState<'workshop' | null>(null);

  // Filtros aplicados a la tabla de resultados.
  const [resultsFilter, setResultsFilter] = useState('');
  const [filterUrgentOnly, setFilterUrgentOnly] = useState(false);
  const [filterMissingOnly, setFilterMissingOnly] = useState(false);

  // Modal con la imagen completa del plano cuando el usuario hace click en la
  // miniatura isométrica. Null = cerrado.
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);
  /** Orden en curso de generación 3D IA (`orderAiKey`), o null. */
  const [aiIsoGeneratingKey, setAiIsoGeneratingKey] = useState<string | null>(null);

  // ── Modo edición del reporte (preview editable antes de imprimir) ──────────
  // `editMode` activa la edición inline sobre la hoja. `originalResults` es el
  // snapshot para "Restaurar todo" (capturado perezosamente en la 1ª mutación).
  // `excludedOrders` son las órdenes excluidas (soft-delete reversible), con su
  // `workOrderId` ya resuelto para restaurar/des-archivar sin re-buscar.
  const [editMode, setEditMode] = useState(false);
  const [originalResults, setOriginalResults] = useState<Order[] | null>(null);
  const [excludedOrders, setExcludedOrders] = useState<Array<{ order: Order }>>([]);

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
    zone: 'workshop',
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

  const removeFile = (type: 'workshop', fileId?: string) => {
    if (type === 'workshop') {
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

  const removeSeededBridgeLink = useCallback((key: string) => {
    setSeededBridgeLinks((prev) => prev.filter((l) => l.key !== key));
  }, []);

  const seedFromBridgeLinks = useCallback(async (links: readonly OrderDrawingLink[]) => {
    const alreadyAttached = new Set(Object.values(toolcribPdfToDrawing));
    const errors: string[] = [];

    for (const link of links) {
      const snap = getReportDrawingSnapshot(link);
      if (!snap) {
        errors.push(`${link.soNumber}: sin plano`);
        continue;
      }
      if (!snap.pdfUrl) {
        errors.push(`${snap.partNumber}: sin URL`);
        continue;
      }
      if (!alreadyAttached.has(snap.drawingId)) {
        try {
          const dataUrl = await fetchPdfAsDataUrl(snap.pdfUrl);
          const displayName = `${snap.partNumber.trim()} (Rev ${snap.revision.trim()}).pdf`;
          const pdfId = `toolcrib-${snap.drawingId}-${crypto.randomUUID()}`;
          const relativePath = snap.sourcePath.length > 0 ? snap.sourcePath : displayName;
          setWorkshopPdfs((prev) => [
            ...prev,
            { id: pdfId, name: displayName, relativePath, dataUrl },
          ]);
          setToolcribPdfToDrawing((prev) => ({ ...prev, [pdfId]: snap.drawingId }));
          alreadyAttached.add(snap.drawingId);
        } catch {
          errors.push(`No se pudo descargar ${snap.partNumber}`);
        }
      }
    }

    setSeededBridgeLinks((prev) => {
      const byKey = new Map(prev.map((l) => [l.key, l]));
      for (const link of links) {
        byKey.set(link.key, link);
      }
      return Array.from(byKey.values());
    });

    if (errors.length > 0) {
      setError(errors.join(' · '));
    } else {
      setError(null);
    }
  }, [toolcribPdfToDrawing]);

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
    downloadOrdersCsv(results);
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
    let orderFetchMs = 0;
    let aiBlueprintMs = 0;
    let mergeMs = 0;

    try {
      // 1 + 1.5: Extract orders (from Odoo) and fetch Tool Crib library concurrently — they are independent.
      setExtractingStep('Leyendo Odoo y biblioteca...');
      const orderAiStart = performance.now();
      
      const [odooResult, libResult] = await Promise.all([
        listOrdersToInvoice({ partnerKeyPrefix: REPORT_PARTNER_KEY_PREFIX }),
        listActiveDrawingViews({ customer: 'SUPRAJIT' }),
      ]);
      
      orderFetchMs += performance.now() - orderAiStart;

      if (!odooResult.ok) {
        setOrderLoadingState('error');
        throw new Error('Fallo al obtener órdenes de Odoo');
      }

      setOrderLoadingState('done');
      
      // Mapear órdenes de Odoo a ExtractedOrder, excluyendo líneas completamente entregadas.
      const rawOrders: ExtractedOrder[] = [];
      for (const order of odooResult.value) {
        for (const line of order.order_lines) {
          const qty = line.qty_pending_from_pickings !== undefined 
            ? line.qty_pending_from_pickings 
            : line.qty_pending;

          // Omitir líneas que no tienen piezas pendientes
          if (qty <= 0) continue;

          // Extraer numero de parte de corchetes "[12345] Item" -> "12345"
          let numeroParte = '';
          let piezaName = line.product;

          const bracketMatch = line.product.match(/^\[(.*?)\]\s*(.*)$/);
          if (bracketMatch) {
            numeroParte = bracketMatch[1];
            piezaName = bracketMatch[2];
          }

          const fullPieza = (line.description && line.description !== piezaName)
            ? `${piezaName} - ${line.description}`
            : piezaName;

          rawOrders.push({
            pieza: fullPieza,
            numero_parte: numeroParte,
            // Usar la cantidad pendiente
            cantidad: qty.toString(),
            orden: order.name,
            fecha: order.date_order ? order.date_order.split(' ')[0] : '',
            prioridad: 'Normal', // Odoo no nos da la prioridad de momento
            poNumber: order.client_order_ref ?? '',
          });
        }
      }

      // Odoo es la fuente de verdad, no necesitamos consolidar líneas de manera artificial.
      const ordersList = rawOrders;

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

          // Preferir vínculo enviado desde Órdenes (bridge) sobre re-match ciego.
          const seeded = seededBridgeLinksRef.current.find((l) => {
            if (l.soNumber !== order.orden) return false;
            if (l.numeroParte && order.numero_parte) {
              return l.numeroParte === order.numero_parte;
            }
            return l.pieza === order.pieza;
          });
          const seededSnap = seeded ? getReportDrawingSnapshot(seeded) : null;
          if (seededSnap) {
            const seededView =
              library.find((v) => v.drawingId === seededSnap.drawingId) ??
              viewFromSnapshot(seededSnap);
            matchByOrder.set(order, {
              drawingId: seededView.drawingId,
              partId: seededView.partId,
              score: seeded?.matchScore ?? 100,
            });
            if (
              seededView.pdfUrl &&
              !autoAttachedIds.has(seededView.drawingId) &&
              !toFetchMap.has(seededView.drawingId)
            ) {
              toFetchMap.set(seededView.drawingId, {
                bestView: seededView,
                pdfId: `toolcrib-${seededView.drawingId}-${crypto.randomUUID()}`,
              });
            }
            continue;
          }

          // ISO-first: si algún ISO supera el umbral, gana sobre cualquier plano CAD.
          const { view: bestView, score: bestScore } =
            selectLibraryDrawingMatch(orderSignals, library, librarySignals);

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
      /** Enrichment parcial por índice — evita depender del setState async para el fallback IA. */
      const orderEnrichmentByIdx = new Map<number, Partial<Order>>();
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
              isometricSource: isometricView ? 'crop' : undefined,
              matchScore: match.score,
              sourceImageDataUrl: result.analysis.image || undefined,
              material: match.spec?.material || undefined,
              dureza: match.spec?.dureza || undefined,
              tratamiento: match.spec?.tratamiento || undefined,
              acabado: match.spec?.acabado || undefined,
            },
          });
        }

        if (updates.length === 0) return;
        for (const u of updates) {
          const prev = orderEnrichmentByIdx.get(u.orderIdx) ?? {};
          orderEnrichmentByIdx.set(u.orderIdx, { ...prev, ...u.partial });
        }
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
Campos por objeto:
- pieza_detectada: nombre o código de la pieza
- isometricBoundingBox: [ymin, xmin, ymax, xmax] (0 a 1000)
- material: string o null (ej. "D2", "4140", "O1", "ACERO INOX 304", "ALUMINIO 6061-T6", etc., según lo indicado en el cajetín o notas)
- dureza: string o null (ej. "58-60 HRC", "60-62 RC", "40 HRC", etc.)
- tratamiento: string o null (ej. "TEMPLE Y REVENIDO", "NITRURADO", "PAVONADO", "ANODIZADO", "CROMO DURO", etc.)
- acabado: string o null (ej. "RECTIFICADO", "PULIDO ESPEJO", "ELECTROPULIDO", etc.)

Reglas de extracción (ESTILO UT2033):
1) Identifica el "Código de Parte" o "Número de Dibujo" y metadatos técnicos en el Cajetín (Title Block), esquina INFERIOR DERECHA o en la tabla de materiales.
2) PRIORIDAD ABSOLUTA: Elige la Vista Isométrica 3D (el dibujo que muestra la pieza con volumen). Si existe, el bounding box DEBE ser sobre esta vista. Usa una vista 2D solo si no hay isométrica.
3) GEOMETRÍA LIMPIA: El bounding box debe contener ÚNICAMENTE la geometría sólida de la pieza.
4) REGLA CRÍTICA: Excluye ABSOLUTAMENTE todas las líneas de dimensión (cotas), flechas, números de medidas, líneas de extensión y notas de texto que rodeen la pieza. El recorte debe verse "limpio" como una foto de catálogo.
5) Excluye el marco del plano, marcas de coordenadas en los bordes, cajetines y logos.
6) El bounding box debe estar bien centrado sobre la masa física de la pieza.
7) MULTI-PIEZA — REGLA OBLIGATORIA: si el plano contiene varias piezas (común en planos de variantes por tamaño, p.ej. HEX SWAGE BLOCK 7/32, 9/32, 3/8, 1/4, 5/16, 13/32, 7/16; o conjuntos de remaches, navajas, blocks, etc.), DEBES devolver UNA entrada por cada variante con su PROPIO bounding box centrado en SU geometría. NO devuelvas una sola entrada que englobe a todas. En "pieza_detectada" incluye el sufijo distintivo (tamaño, fracción, código, letra) que diferencia cada variante.
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
                      material: { type: Type.STRING },
                      dureza: { type: Type.STRING },
                      tratamiento: { type: Type.STRING },
                      acabado: { type: Type.STRING },
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

      // 3b. Fallback IA: sin ISO/eDrawing real, generar imagen 3D etiquetada.
      const cadOnlyIdxs: number[] = [];
      for (const [idx, match] of bestMatchByOrder) {
        if (match.isIso) continue;
        const enrichment = orderEnrichmentByIdx.get(idx);
        if (
          !canGenerateAiIsometric({
            sourceImageDataUrl: enrichment?.sourceImageDataUrl,
            isometricView: enrichment?.isometricView,
            sourcePdfName: enrichment?.sourcePdfName,
          })
        ) {
          continue;
        }
        cadOnlyIdxs.push(idx);
      }
      if (cadOnlyIdxs.length > 0) {
        setExtractingStep(`Generando vistas 3D (IA): 0/${cadOnlyIdxs.length}`);
        let isoGenDone = 0;
        await runWithConcurrencyLimit(
          cadOnlyIdxs,
          MAX_ISO_GEN_CONCURRENCY,
          async (orderIdx) => {
            const enrichment = orderEnrichmentByIdx.get(orderIdx);
            const source =
              enrichment?.sourceImageDataUrl ??
              enrichment?.isometricView ??
              null;
            if (!source) {
              isoGenDone += 1;
              setExtractingStep(`Generando vistas 3D (IA): ${isoGenDone}/${cadOnlyIdxs.length}`);
              return;
            }
            try {
              const hash = await createDocumentHash(source);
              const cached = await readCachedValue<string>(
                'iso-gen',
                hash,
                ISOMETRIC_GEN_PROMPT_VERSION,
              );
              let generated = cached;
              if (!generated) {
                generated = await generateIsometricImageFromDrawing(ai, {
                  sourceImageDataUrl: source,
                });
                if (generated) {
                  await writeCachedValue('iso-gen', hash, ISOMETRIC_GEN_PROMPT_VERSION, generated);
                }
              }
              if (generated) {
                const partial: Partial<Order> = {
                  isometricView: generated,
                  isometricSource: 'ai-generated',
                };
                const prev = orderEnrichmentByIdx.get(orderIdx) ?? {};
                orderEnrichmentByIdx.set(orderIdx, { ...prev, ...partial });
                setResults((prevResults) => {
                  if (!prevResults) return prevResults;
                  const next = [...prevResults];
                  next[orderIdx] = { ...next[orderIdx], ...partial };
                  return next;
                });
              }
            } catch (e) {
              log.warn('[smv-vision][iso-gen] falló para orden', orderIdx, e);
            } finally {
              isoGenDone += 1;
              setExtractingStep(`Generando vistas 3D (IA): ${isoGenDone}/${cadOnlyIdxs.length}`);
            }
          },
        );
      }

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
        aiOrderMs: orderFetchMs,
        aiBlueprintMs,
        mergeMs,
      };

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
            Promise.resolve(null), // órdenes vienen de Odoo — no hay PDF de orden
            Promise.all(currentWorkshopPdfs.map((pdf) => createDocumentHash(pdf.dataUrl))),
          ]);
          recordAnalysisRunFireAndForget({
            userUid: null, // sustituido por el writer con auth.currentUser.uid
            status: 'success',
            promptVersions: {
              order: ORDER_PROMPT_VERSION,
              blueprint: BLUEPRINT_PROMPT_VERSION,
              isoGen: ISOMETRIC_GEN_PROMPT_VERSION,
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

      const capturedOrderPdf = null; // órdenes vienen de Odoo — no hay PDF de orden
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
              isoGen: ISOMETRIC_GEN_PROMPT_VERSION,
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

  const snapshotOriginalOnce = useCallback(() => {
    setOriginalResults((prev) => prev ?? (results ? [...results] : null));
  }, [results]);

  const orderAiKey = useCallback((order: Order): string => {
    return `${order.orden}::${order.pieza}::${order.numero_parte ?? ''}::${order.sourcePdfName ?? ''}`;
  }, []);

  /**
   * Genera vista 3D con Gemini a partir del plano 2D de una orden.
   * Usa cache IndexedDB; marca `isometricSource: 'ai-generated'`.
   */
  const generateAiIsometricForOrder = useCallback(
    async (order: Order): Promise<void> => {
      if (!canGenerateAiIsometric(order)) {
        setError(
          'No se puede generar 3D IA: falta imagen del plano 2D, o el plano ya es un ISO real.',
        );
        return;
      }
      const source = order.sourceImageDataUrl ?? order.isometricView;
      if (!source) return;

      const geminiApiKey = (import.meta.env.VITE_GEMINI_API_KEY ?? process.env.GEMINI_API_KEY ?? '').trim();
      if (!geminiApiKey) {
        setError('Falta configurar VITE_GEMINI_API_KEY para generar vistas 3D con IA.');
        return;
      }

      const key = orderAiKey(order);
      setAiIsoGeneratingKey(key);
      setError(null);
      try {
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        const hash = await createDocumentHash(source);
        const cached = await readCachedValue<string>(
          'iso-gen',
          hash,
          ISOMETRIC_GEN_PROMPT_VERSION,
        );
        let generated = cached;
        if (!generated) {
          generated = await generateIsometricImageFromDrawing(ai, {
            sourceImageDataUrl: source,
          });
          if (generated) {
            await writeCachedValue('iso-gen', hash, ISOMETRIC_GEN_PROMPT_VERSION, generated);
          }
        }
        if (!generated) {
          setError('Gemini no devolvió una imagen 3D. Intenta de nuevo o revisa el plano.');
          return;
        }
        snapshotOriginalOnce();
        setResults((prev) => {
          if (!prev) return prev;
          return prev.map((row) =>
            row === order || orderAiKey(row) === key
              ? {
                  ...row,
                  isometricView: generated,
                  isometricSource: 'ai-generated',
                  haSidoAuditada: true,
                }
              : row,
          );
        });
      } catch (e) {
        log.warn('[smv-vision][iso-gen] generateAiIsometricForOrder falló', e);
        const message = e instanceof Error ? e.message : String(e);
        setError(`Error generando vista 3D IA: ${message}`);
      } finally {
        setAiIsoGeneratingKey(null);
      }
    },
    [orderAiKey, snapshotOriginalOnce],
  );

  const handleEditCantidad = useCallback(
    (order: Order, nuevaCantidad: string) => {
      const clean = nuevaCantidad.trim();
      if (!clean || clean === order.cantidad) return;
      snapshotOriginalOnce();
      setResults((prev) => (prev ? prev.map((o) => (o === order ? { ...o, cantidad: clean } : o)) : prev));
    },
    [snapshotOriginalOnce],
  );

  const handleExcludeOrder = useCallback(
    (order: Order) => {
      snapshotOriginalOnce();
      setExcludedOrders((prev) => [...prev, { order }]);
      setResults((prev) => (prev ? prev.filter((o) => o !== order) : prev));
    },
    [snapshotOriginalOnce],
  );

  const handleRestoreOrder = useCallback(
    (entry: { order: Order }) => {
      setExcludedOrders((prev) => prev.filter((e) => e !== entry));
      setResults((prev) => (prev ? [...prev, entry.order] : [entry.order]));
    },
    [],
  );

  const handleRestoreAll = useCallback(() => {
    const snapshot = originalResults;
    if (snapshot) setResults(snapshot);
    setExcludedOrders([]);
    setOriginalResults(null);
  }, [originalResults]);

  const handleUpdateOrderCrop = useCallback(
    (order: Order, newBox: BoundingBox, newCroppedUrl: string) => {
      snapshotOriginalOnce();
      setResults((prev) => {
        if (!prev) return prev;
        return prev.map((o) => {
          if (o.orden === order.orden && o.pieza === order.pieza) {
            return {
              ...o,
              isometricBoundingBox: newBox,
              isometricView: newCroppedUrl,
              isometricSource: 'crop',
            };
          }
          return o;
        });
      });
    },
    [snapshotOriginalOnce],
  );

  const auditedCount = useMemo(
    () => (results ? results.filter((r) => r.haSidoAuditada).length : 0),
    [results],
  );

  const filteredResults = useMemo(() => {
    if (!results) return null;
    const term = resultsFilter.trim().toLowerCase();
    return results.filter((order) => {
      if (filterUrgentOnly && order.prioridad !== 'URGENTE') return false;
      if (filterMissingOnly && order.isometricView) return false;
      if (term.length === 0) return true;
      return [order.pieza, order.numero_parte ?? '', order.orden, order.sourcePdfName ?? '']
        .join(' ').toLowerCase().includes(term);
    });
  }, [results, resultsFilter, filterUrgentOnly, filterMissingOnly]);

  return {
    // File state
    workshopPdfs,
    orderLoadingState, workshopLoadingStates,
    toolcribPdfToDrawing, attachedToolcribDrawingIds,
    // Analysis state
    isExtracting, extractingStep, error, results,
    analysisSummary, copying,
    // Edit mode
    editMode, originalResults, excludedOrders, auditedCount,
    // Results display
    draggingZone, resultsFilter, filterUrgentOnly, filterMissingOnly,
    filteredResults, previewOrder,

    // Actions
    extractInfo, ingestWorkshopFiles,
    handleAttachToolcribDrawing,
    seedFromBridgeLinks,
    seededBridgeLinks,
    removeSeededBridgeLink,
    generateAiIsometricForOrder,
    aiIsoGeneratingKey,
    isAiIsoGenerating: (order: Order) => aiIsoGeneratingKey === orderAiKey(order),
    removeFile, buildDropHandlers,
    downloadPdf, downloadCsv, downloadJson,
    downloadSingleOrderPdf, copyResults,
    snapshotOriginalOnce, handleEditCantidad, handleExcludeOrder,
    handleRestoreOrder, handleRestoreAll, handleUpdateOrderCrop,
    // Setters
    setResultsFilter, setFilterUrgentOnly, setFilterMissingOnly,
    setDraggingZone, setEditMode, setPreviewOrder, setError,
  };
}

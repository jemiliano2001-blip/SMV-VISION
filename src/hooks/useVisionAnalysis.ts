import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  AnalysisMetrics,
  AnalysisRunSummary,
  BoundingBox,
  ExtractedOrder,
  Order,
  OrderDrawingLink,
  WorkshopPdfUpload,
} from '../types';
import {
  createDocumentHash,
  saveLatestAuditSession,
  loadLatestAuditSession,
  clearLatestAuditSession,
  type SavedAuditSession,
} from '../lib/documentAnalysis/cache';
import { recordAnalysisRunFireAndForget } from '../lib/firebase/analysisRuns';
import { log } from '../lib/log';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { generateReportPdf, generateSingleOrderPdf } from '../lib/pdfGenerator';
import type { ToolcribAttachment } from '../components/ToolcribLibraryPanel';
import { getReportDrawingSnapshot } from '../lib/orderDrawingBridge';
import { downloadOrdersCsv } from '../lib/excelExport';
import { ISOMETRIC_GEN_PROMPT_VERSION } from '../lib/generateIsometricImage';
import { useEditableResults } from './useEditableResults';
import { useAiIsometricGeneration } from './useAiIsometricGeneration';
import { fetchOrdersAndMatch } from '../lib/visionPipeline/fetchOrdersAndMatch';
import { analyzeBlueprints } from '../lib/visionPipeline/analyzeBlueprints';
import { generateAiFallbackIso } from '../lib/visionPipeline/generateAiFallbackIso';
import type { BlueprintStatusPatch } from '../lib/visionPipeline/types';

// ── Prompt versions — bump to invalidate IndexedDB cache for all users ────────
const ORDER_PROMPT_VERSION = 'orders-v7-po-multi-hoja';
const BLUEPRINT_PROMPT_VERSION = 'blueprints-v16-title-block-meta';
const SMV_VISION_APP_VERSION = `smv-vision@${__APP_VERSION__}`;

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
  workshopLoadingStates: Record<string, 'idle' | 'loading' | 'done' | 'error'>;
  toolcribPdfToDrawing: Record<string, string>;
  attachedToolcribDrawingIds: Set<string>;
  // Analysis state
  isExtracting: boolean;
  extractingStep: string;
  error: string | null;
  /** Avisos de seed bridge (no bloquean el dashboard si ya hay results). */
  seedWarning: string | null;
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
  filterMissingOnly: boolean;
  filteredResults: Order[] | null;
  previewOrder: Order | null;
  // File actions
  ingestWorkshopFiles: (files: FileList | File[]) => Promise<void>;
  handleAttachToolcribDrawing: (attachment: ToolcribAttachment) => void;
  /** Adjunta planos de vínculos del bridge e indexa semillas para la auditoría. */
  seedFromBridgeLinks: (links: readonly OrderDrawingLink[]) => Promise<{ errors: string[] }>;
  seededBridgeLinks: readonly OrderDrawingLink[];
  removeSeededBridgeLink: (key: string) => void;
  clearSeedWarning: () => void;
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
  downloadSingleOrderPdf: (order: Order) => void;
  copyResults: () => Promise<void>;
  // Edit handlers
  snapshotOriginalOnce: () => void;
  handleEditCantidad: (order: Order, newValue: string) => void;
  handleExcludeOrder: (order: Order) => void;
  handleRestoreOrder: (entry: { order: Order }) => void;
  handleRestoreAll: () => void;
  handleUpdateOrderCrop: (target: Order, newBox: BoundingBox, newCroppedUrl: string) => void;
  // Display setters
  setResultsFilter: (v: string) => void;
  setFilterMissingOnly: (v: boolean) => void;
  setDraggingZone: (zone: 'workshop' | null) => void;
  setEditMode: (v: boolean) => void;
  setPreviewOrder: (order: Order | null) => void;
  setError: (msg: string | null) => void;
  // Session Recovery
  savedSession: SavedAuditSession<Order, AnalysisRunSummary> | null;
  restoreSavedSession: () => void;
  dismissSavedSession: () => void;
}

// ── Implementation ────────────────────────────────────────────────────────────

export function useVisionAnalysis({}: UseVisionAnalysisOptions = {}): VisionAnalysisHook {
  const [workshopPdfs, setWorkshopPdfs] = useState<WorkshopPdfUpload[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractingStep, setExtractingStep] = useState<string>('');
  const [workshopLoadingStates, setWorkshopLoadingStates] = useState<Record<string, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [results, setResults] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [seedWarning, setSeedWarning] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  const extractingRef = useRef(false);
  const [analysisSummary, setAnalysisSummary] = useState<AnalysisRunSummary | null>(null);
  const [savedSession, setSavedSession] = useState<SavedAuditSession<Order, AnalysisRunSummary> | null>(null);

  useEffect(() => {
    void (async () => {
      const saved = await loadLatestAuditSession<Order, AnalysisRunSummary>();
      if (saved) {
        setSavedSession(saved);
      }
    })();
  }, []);

  const restoreSavedSession = useCallback(() => {
    if (!savedSession) return;
    setResults(savedSession.results);
    setAnalysisSummary(savedSession.summary);
    setSavedSession(null);
  }, [savedSession]);

  const dismissSavedSession = useCallback(() => {
    setSavedSession(null);
    void clearLatestAuditSession();
  }, []);

  // Mapa pdfId -> drawingId para dibujos adjuntados desde la biblioteca Tool Crib.
  const [toolcribPdfToDrawing, setToolcribPdfToDrawing] = useState<Record<string, string>>({});
  /** Vínculos enviados desde Órdenes (sesión); la auditoría los prioriza. */
  const [seededBridgeLinks, setSeededBridgeLinks] = useState<OrderDrawingLink[]>([]);
  const seededBridgeLinksRef = useRef<OrderDrawingLink[]>([]);
  useEffect(() => {
    seededBridgeLinksRef.current = seededBridgeLinks;
  }, [seededBridgeLinks]);

  // Refs espejo de workshopPdfs/toolcribPdfToDrawing: la auto-auditoría desde
  // Órdenes hace seedFromBridgeLinks() (setState) e inmediatamente llama
  // extractInfo() de forma síncrona, antes de que React comitee el re-render.
  const workshopPdfsRef = useRef<WorkshopPdfUpload[]>([]);
  useEffect(() => {
    workshopPdfsRef.current = workshopPdfs;
  }, [workshopPdfs]);
  const toolcribPdfToDrawingRef = useRef<Record<string, string>>({});
  useEffect(() => {
    toolcribPdfToDrawingRef.current = toolcribPdfToDrawing;
  }, [toolcribPdfToDrawing]);

  const workshopStatePatchQueueRef = useRef<Record<string, 'done' | 'error'>>({});
  const workshopStatePatchTimerRef = useRef<number | null>(null);
  const copyingResetTimerRef = useRef<number | null>(null);
  const hotStampRefImageRef = useRef<string | null>(null);

  const [draggingZone, setDraggingZone] = useState<'workshop' | null>(null);

  // Filtros aplicados a la tabla de resultados.
  const [resultsFilter, setResultsFilter] = useState('');
  const [filterMissingOnly, setFilterMissingOnly] = useState(false);

  // Modal con la imagen completa del plano cuando el usuario hace click en la
  // miniatura isométrica. Null = cerrado.
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);

  // Sub-hooks extraídos
  const editable = useEditableResults({
    results,
    setResults,
  });

  const aiIso = useAiIsometricGeneration({
    setResults,
    snapshotOriginalOnce: editable.snapshotOriginalOnce,
    setError,
  });

  // Cancela timers pendientes si el componente se desmonta mid-corrida
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

  // Procesa una lista de PDFs como planos de taller (manual upload).
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
    setWorkshopPdfs((prev) => {
      const next = [...prev, ...uploads];
      workshopPdfsRef.current = next;
      return next;
    });
    setError(null);
  }, []);

  const buildDropHandlers = useCallback((
    zone: 'workshop',
    onFiles: (files: FileList) => void | Promise<void>,
  ) => ({
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      if (draggingZone !== zone) setDraggingZone(zone);
    },
    onDragLeave: (e: React.DragEvent) => {
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
  }), [draggingZone]);

  const removeFile = useCallback((type: 'workshop', fileId?: string) => {
    if (type === 'workshop') {
      setWorkshopPdfs((prev) => {
        const next = prev.filter((pdf) => pdf.id !== fileId);
        workshopPdfsRef.current = next;
        return next;
      });
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
          toolcribPdfToDrawingRef.current = next;
          return next;
        });
      }
    }
  }, []);

  const attachedToolcribDrawingIds = useMemo(
    () => new Set(Object.values(toolcribPdfToDrawing)),
    [toolcribPdfToDrawing],
  );

  const handleAttachToolcribDrawing = useCallback((attachment: ToolcribAttachment) => {
    if (attachedToolcribDrawingIds.has(attachment.drawingId)) {
      return;
    }

    const pdfId = `toolcrib-${attachment.drawingId}-${crypto.randomUUID()}`;
    const relativePath = attachment.sourcePath.length > 0
      ? attachment.sourcePath
      : attachment.displayName;

    const newUpload: WorkshopPdfUpload = {
      id: pdfId,
      name: attachment.displayName,
      relativePath,
      dataUrl: attachment.dataUrl,
    };

    setWorkshopPdfs((prevPdfs) => [...prevPdfs, newUpload]);
    setToolcribPdfToDrawing((prev) => ({ ...prev, [pdfId]: attachment.drawingId }));
    workshopPdfsRef.current = [...workshopPdfsRef.current, newUpload];
    toolcribPdfToDrawingRef.current = { ...toolcribPdfToDrawingRef.current, [pdfId]: attachment.drawingId };
    setError(null);
  }, [attachedToolcribDrawingIds]);

  const removeSeededBridgeLink = useCallback((key: string) => {
    setSeededBridgeLinks((prev) => prev.filter((l) => l.key !== key));
    seededBridgeLinksRef.current = seededBridgeLinksRef.current.filter((l) => l.key !== key);
  }, []);

  const clearSeedWarning = useCallback(() => setSeedWarning(null), []);

  const seedFromBridgeLinks = useCallback(async (links: readonly OrderDrawingLink[]): Promise<{ errors: string[] }> => {
    const alreadyAttached = new Set(Object.values(toolcribPdfToDrawingRef.current));
    const errors: string[] = [];
    const newUploads: WorkshopPdfUpload[] = [];
    const newDrawingMap: Record<string, string> = {};

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
          newUploads.push({
            id: pdfId,
            name: displayName,
            relativePath,
            dataUrl,
          });
          newDrawingMap[pdfId] = snap.drawingId;
          alreadyAttached.add(snap.drawingId);
        } catch {
          errors.push(`No se pudo descargar ${snap.partNumber}`);
        }
      }
    }

    if (newUploads.length > 0) {
      setWorkshopPdfs((prev) => [...prev, ...newUploads]);
      setToolcribPdfToDrawing((prev) => ({ ...prev, ...newDrawingMap }));
      // Sincronización síncrona de refs:
      // Si el caller llama vision.extractInfo() inmediatamente tras resolver
      // seedFromBridgeLinks(), las refs deben tener los nuevos PDFs antes de
      // que React complete el re-render.
      workshopPdfsRef.current = [...workshopPdfsRef.current, ...newUploads];
      toolcribPdfToDrawingRef.current = { ...toolcribPdfToDrawingRef.current, ...newDrawingMap };
    }

    setSeededBridgeLinks((prev) => {
      const byKey = new Map(prev.map((l) => [l.key, l]));
      for (const link of links) {
        byKey.set(link.key, link);
      }
      return Array.from(byKey.values());
    });
    const seededMap = new Map(seededBridgeLinksRef.current.map((l) => [l.key, l]));
    for (const link of links) {
      seededMap.set(link.key, link);
    }
    seededBridgeLinksRef.current = Array.from(seededMap.values());

    if (errors.length > 0) {
      setSeedWarning(errors.join(' · '));
      if (!results) {
        setError(errors.join(' · '));
      }
    } else {
      setSeedWarning(null);
    }

    return { errors };
  }, [results]);

  const copyResults = useCallback(async () => {
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
      log.warn('[smv-vision] clipboard write rechazado', err);
      setError('No fue posible copiar al portapapeles. Revisa los permisos del navegador.');
    }
  }, [results]);

  const downloadCsv = useCallback(() => {
    if (!results) return;
    downloadOrdersCsv(results);
  }, [results]);

  const downloadPdf = useCallback(() => {
    if (!results) return;
    generateReportPdf(results, {
      hotStampRefImage: hotStampRefImageRef.current,
    }).catch((e) => {
      log.error('[smv-vision] generateReportPdf falló', e);
      setError('No fue posible generar el PDF del reporte.');
    });
  }, [results]);

  const downloadSingleOrderPdf = useCallback((order: Order) => {
    generateSingleOrderPdf(order).catch((e) => {
      log.error('[smv-vision] generateSingleOrderPdf falló', e);
      setError('No fue posible generar el PDF de la orden.');
    });
  }, []);

  const extractInfo = async (): Promise<void> => {
    if (extractingRef.current) return;

    extractingRef.current = true;
    setIsExtracting(true);
    setError(null);
    setSeedWarning(null);
    setResults(null);
    hotStampRefImageRef.current = null;
    editable.setEditMode(false);
    editable.setExcludedOrders([]);
    editable.setOriginalResults(null);
    setAnalysisSummary(null);
    setExtractingStep('Iniciando análisis...');

    let currentWorkshopPdfs = [...workshopPdfsRef.current];

    const runStart = performance.now();
    let pdfRasterMs = 0;
    let orderFetchMs = 0;
    let aiBlueprintMs = 0;
    let mergeMs = 0;

    try {
      // 1 + 1.5: Lectura de Odoo + Catálogo Tool Crib y Auto-matching
      const step1Result = await fetchOrdersAndMatch({
        currentWorkshopPdfs,
        toolcribPdfToDrawing: toolcribPdfToDrawingRef.current,
        seededBridgeLinks: seededBridgeLinksRef.current,
        onStep: setExtractingStep,
      });

      orderFetchMs = step1Result.orderFetchMs;
      hotStampRefImageRef.current = step1Result.hotStampRefImage;
      currentWorkshopPdfs = step1Result.currentWorkshopPdfs;

      if (step1Result.newUploads.length > 0) {
        setWorkshopPdfs((prev) => [...prev, ...step1Result.newUploads]);
        setToolcribPdfToDrawing((prev) => ({ ...prev, ...step1Result.newDrawingMap }));
        workshopPdfsRef.current = [...workshopPdfsRef.current, ...step1Result.newUploads];
        toolcribPdfToDrawingRef.current = { ...toolcribPdfToDrawingRef.current, ...step1Result.newDrawingMap };
      }

      const ordersList = step1Result.ordersList;
      const matchByOrder = step1Result.matchByOrder;

      const catalogFields = (order: ExtractedOrder): Partial<Order> => {
        const m = matchByOrder.get(order);
        if (!m) return {};
        return {
          matchedDrawingId: m.drawingId,
          matchedPartId: m.partId,
          matchedDrawingRevision: m.revision,
          matchedStlUrl: m.stlUrl,
          matchSource: m.matchSource,
          matchScore: m.score,
        };
      };

      // 2. Render inicial progresivo
      const initialResults: Order[] = ordersList.map((order) => ({
        ...order,
        haSidoAuditada: false,
        ...catalogFields(order),
      }));
      setResults(initialResults);

      if (currentWorkshopPdfs.length === 0) {
        setError(
          'No se encontraron planos para las piezas detectadas. Sube planos manualmente o vincúlalos desde Biblioteca.',
        );
        extractingRef.current = false;
        setIsExtracting(false);
        return;
      }

      // 3. Análisis de planos con Gemini y merge progresivo
      const initialWorkshopStates: Record<string, 'loading'> = {};
      currentWorkshopPdfs.forEach((pdf) => {
        initialWorkshopStates[pdf.id] = 'loading';
      });
      setWorkshopLoadingStates(initialWorkshopStates);

      const step3Result = await analyzeBlueprints({
        currentWorkshopPdfs,
        ordersList,
        catalogFields,
        blueprintPromptVersion: BLUEPRINT_PROMPT_VERSION,
        onStep: setExtractingStep,
        onStatusPatch: enqueueWorkshopStatusPatch,
        onApplyResults: (updates) => {
          setResults((prev) => {
            if (!prev) return prev;
            const next = [...prev];
            for (const u of updates) {
              next[u.orderIdx] = { ...next[u.orderIdx], ...u.partial };
            }
            return next;
          });
        },
      });

      flushWorkshopStatePatches();
      pdfRasterMs = step3Result.pdfRasterMs;
      aiBlueprintMs = step3Result.aiBlueprintMs;

      // 3b. Fallback IA: sin ISO real, generar imagen 3D bajo demanda
      await generateAiFallbackIso({
        bestMatchByOrder: step3Result.bestMatchByOrder,
        orderEnrichmentByIdx: step3Result.orderEnrichmentByIdx,
        onStep: setExtractingStep,
        onApplyIso: (orderIdx, partial) => {
          setResults((prevResults) => {
            if (!prevResults) return prevResults;
            const next = [...prevResults];
            next[orderIdx] = { ...next[orderIdx], ...partial };
            return next;
          });
        },
      });

      // 4. Resumen final
      setExtractingStep('Generando reporte final...');
      const mergeStart = performance.now();
      if (ordersList.length === 0) {
        throw new Error('No fue posible extraer órdenes desde la tabla de entrada.');
      }
      mergeMs = performance.now() - mergeStart;
      const totalAudited = step3Result.bestMatchByOrder.size;
      const auditSummary = {
        totalLoaded: currentWorkshopPdfs.length,
        totalAnalyzed: step3Result.blueprintTaskResults.length,
        totalAudited,
        totalNonMatching: Math.max(
          0,
          step3Result.blueprintTaskResults.length - step3Result.matchedBlueprintFileIds.size,
        ),
        totalOrders: ordersList.length,
      };
      setAnalysisSummary(auditSummary);

      setResults((currentResults) => {
        if (currentResults) {
          void saveLatestAuditSession({
            results: currentResults,
            summary: auditSummary,
          });
        }
        return currentResults;
      });

      const latestMetrics: AnalysisMetrics = {
        totalMs: performance.now() - runStart,
        pdfRasterMs,
        aiOrderMs: orderFetchMs,
        aiBlueprintMs,
        mergeMs,
      };

      void (async () => {
        try {
          const [orderReportSha256, blueprintSha256List] = await Promise.all([
            Promise.resolve(null),
            Promise.all(currentWorkshopPdfs.map((pdf) => createDocumentHash(pdf.dataUrl))),
          ]);
          recordAnalysisRunFireAndForget({
            userUid: null,
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
          log.warn('[smv-vision][audit] hash calc para success falló', auditErr);
        }
      })();
    } catch (err: unknown) {
      log.error('PDF Analysis Error Object:', err);
      const errorMessage = err instanceof Error ? err.message : JSON.stringify(err);
      setError(`Error analizando PDFs: ${errorMessage}. Verifique su conexión y permisos de API.`);

      const capturedOrderPdf = null;
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
            userUid: null,
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
          log.warn('[smv-vision][audit] hash calc para error falló', auditErr);
        }
      })();
    } finally {
      flushWorkshopStatePatches();
      extractingRef.current = false;
      setIsExtracting(false);
    }
  };

  const auditedCount = useMemo(
    () => (results ? results.filter((r) => r.haSidoAuditada).length : 0),
    [results],
  );

  const filteredResults = useMemo(() => {
    if (!results) return null;
    const term = resultsFilter.trim().toLowerCase();
    return results.filter((order) => {
      if (filterMissingOnly && order.isometricView) return false;
      if (term.length === 0) return true;
      return [order.pieza, order.numero_parte ?? '', order.orden, order.sourcePdfName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [results, resultsFilter, filterMissingOnly]);

  return {
    // File state
    workshopPdfs,
    workshopLoadingStates,
    toolcribPdfToDrawing,
    attachedToolcribDrawingIds,
    // Analysis state
    isExtracting,
    extractingStep,
    error,
    seedWarning,
    results,
    analysisSummary,
    copying,
    // Edit mode
    editMode: editable.editMode,
    originalResults: editable.originalResults,
    excludedOrders: editable.excludedOrders,
    auditedCount,
    // Results display
    draggingZone,
    resultsFilter,
    filterMissingOnly,
    filteredResults,
    previewOrder,

    // Actions
    extractInfo,
    ingestWorkshopFiles,
    handleAttachToolcribDrawing,
    seedFromBridgeLinks,
    seededBridgeLinks,
    removeSeededBridgeLink,
    clearSeedWarning,
    generateAiIsometricForOrder: aiIso.generateAiIsometricForOrder,
    aiIsoGeneratingKey: aiIso.aiIsoGeneratingKey,
    isAiIsoGenerating: aiIso.isAiIsoGenerating,
    removeFile,
    buildDropHandlers,
    downloadPdf,
    downloadCsv,
    downloadSingleOrderPdf,
    copyResults,
    snapshotOriginalOnce: editable.snapshotOriginalOnce,
    handleEditCantidad: editable.handleEditCantidad,
    handleExcludeOrder: editable.handleExcludeOrder,
    handleRestoreOrder: editable.handleRestoreOrder,
    handleRestoreAll: editable.handleRestoreAll,
    handleUpdateOrderCrop: editable.handleUpdateOrderCrop,
    // Setters
    setResultsFilter,
    setFilterMissingOnly,
    setDraggingZone,
    setEditMode: editable.setEditMode,
    setPreviewOrder,
    setError,
    // Session Recovery
    savedSession,
    restoreSavedSession,
    dismissSavedSession,
  };
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import jsPDF from 'jspdf';
import autoTable, { CellHookData, RowInput } from 'jspdf-autotable';
import { motion, AnimatePresence } from "motion/react";
import {
  Database,
  FileText,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Maximize2,
} from 'lucide-react';
import {
  AnalysisMetrics,
  AnalysisRunSummary,
  BlueprintAnalysis,
  BlueprintSpec,
  ExtractedOrder,
  Order,
  WorkshopPdfUpload,
  ToolcribActiveDrawingView,
} from './types';
import { createDocumentHash, readCachedValue, writeCachedValue } from './lib/documentAnalysis/cache';
import { runWithConcurrencyLimit } from './lib/documentAnalysis/concurrency';
import { rasterizeAndNormalizePdf } from './lib/documentAnalysis/pdfWorkerClient';
import { recordAnalysisRunFireAndForget } from './lib/firebase/analysisRuns';
import { ToolcribLibraryPanel, type ToolcribAttachment } from './components/ToolcribLibraryPanel';
import { listActiveDrawingViews } from './lib/firebase/toolcrib';

const ORDER_PROMPT_VERSION = 'orders-v4-precise';
const BLUEPRINT_PROMPT_VERSION = 'blueprints-v12-ut2033-standard';
const SMV_VISION_APP_VERSION = 'smv-vision@0.0.0';
const METRICS_BASELINE_KEY = 'smvVisionMetricsBaselineV2';
const MAX_BLUEPRINT_CONCURRENCY = 5;
const MIN_BLUEPRINT_MATCH_SCORE = 80;
const BLUEPRINT_PATH_STOP_WORDS = ['TOOL', 'CRIB', 'PDF', 'REV'] as const;
const GEMINI_ORDER_MODEL = 'gemini-3-flash-preview';
const GEMINI_BLUEPRINT_MODEL = 'gemini-3-flash-preview';
const FETCH_TIMEOUT_MS = 30_000;

async function fetchPdfAsDataUrl(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Lectura de PDF no devolvió un dataURL.'));
      };
      reader.onerror = () => reject(new Error('No fue posible leer el PDF.'));
      reader.readAsDataURL(blob);
    });
  } finally {
    window.clearTimeout(timer);
  }
}

function extractLibrarySignals(view: ToolcribActiveDrawingView): PieceMatchSignals {
  const identifiers = new Set<string>();
  const descriptors = new Set<string>();
  extractPartIdentifiers(view.partNumber).forEach((id) => identifiers.add(id));
  descriptiveTokens(view.partNumber).forEach((d) => descriptors.add(d));
  descriptiveTokens(view.description).forEach((d) => descriptors.add(d));
  return { identifiers: [...identifiers], descriptors: [...descriptors] };
}

const SUGGESTED_BLUEPRINTS_FOLDER = '\\\\smvmatamoros.ddns.net\\PRIVADO\\CLIENTES\\CLIENTES\\SUPRAJIT\\TOOL CRIB';
const SUGGESTED_ORDER_REPORT_NAME = 'Suprajit reporte de tool crib - Google Sheets.pdf';
const SUGGESTED_ORDER_REPORT_HINT = `Descargas \\ ${SUGGESTED_ORDER_REPORT_NAME}`;

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
  metrics: {
    pdfRasterMs: number;
    aiBlueprintMs: number;
  };
}

interface BlueprintStatusPatch {
  fileId: string;
  status: 'done' | 'error';
}

interface BlueprintSpecMatch {
  spec: BlueprintSpec | null;
  score: number;
}

interface FilePickerWindow extends Window {
  showDirectoryPicker?: () => Promise<DirectoryHandleLike>;
}

interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
}

interface DirectoryHandleLike {
  kind: 'directory';
  name: string;
  entries: () => AsyncIterableIterator<[string, DirectoryEntryLike]>;
}

type DirectoryEntryLike = FileHandleLike | DirectoryHandleLike;

interface PickedWorkshopFile {
  file: File;
  relativePath: string;
}

interface DirectoryScanResult {
  totalFiles: number;
  pdfFiles: PickedWorkshopFile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parsePriority(value: unknown): 'URGENTE' | 'Normal' {
  return value === 'URGENTE' ? 'URGENTE' : 'Normal';
}

function isOrderSummaryRow(pieceLabel: string): boolean {
  const normalized = normalizePieceLabel(pieceLabel);
  return (
    normalized.includes('PIEZAS REQUERIDAS')
    || normalized.includes('PIEZAS TERMINADAS')
    || normalized.includes('RESTANTES A CREAR')
  );
}

function validateOrderPdfName(fileName: string): string | null {
  if (fileName.trim() === SUGGESTED_ORDER_REPORT_NAME) {
    return null;
  }
  return `El archivo "${fileName}" no coincide con el nombre esperado del reporte de órdenes. Debe llamarse exactamente "${SUGGESTED_ORDER_REPORT_NAME}".`;
}

function parseOrdersResponse(text: string): ExtractedOrder[] {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed
    .filter(isRecord)
    .map((item) => ({
      pieza: asString(item.pieza),
      cantidad: asString(item.cantidad) || 'N/A',
      orden: asString(item.orden) || 'N/A',
      fecha: asString(item.fecha) || 'N/A',
      prioridad: parsePriority(item.prioridad),
    }))
    .filter((item) => item.pieza.length > 0 && !isOrderSummaryRow(item.pieza));
}

function parseBoundingBox(value: unknown): [number, number, number, number] | null {
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
        descripcionVisual: asString(item.descripcionVisual) || 'Sin descripción visual',
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

function getRelativePath(file: File): string {
  if (file.webkitRelativePath.length > 0) {
    return file.webkitRelativePath;
  }
  return file.name;
}

function buildWorkshopPdfUpload(file: File, dataUrl: string, relativePathOverride?: string): WorkshopPdfUpload {
  return {
    id: `${file.name}-${file.lastModified}-${file.size}-${crypto.randomUUID()}`,
    name: file.name,
    relativePath: relativePathOverride ?? getRelativePath(file),
    dataUrl,
  };
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

async function collectPdfFilesFromDirectory(
  directoryHandle: DirectoryHandleLike,
  currentPath: string,
  result: DirectoryScanResult,
): Promise<void> {
  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    const entryPath = `${currentPath}/${entryName}`;
    if (entryHandle.kind === 'directory') {
      await collectPdfFilesFromDirectory(entryHandle, entryPath, result);
      continue;
    }

    const file = await entryHandle.getFile();
    result.totalFiles += 1;
    if (!isPdfFile(file)) {
      continue;
    }

    result.pdfFiles.push({
      file,
      relativePath: entryPath,
    });
  }
}

function isDirectoryPickerAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function normalizePieceLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9\-/. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedPieceVariants(value: string): string[] {
  const normalized = normalizePieceLabel(value);
  if (!normalized) {
    return [];
  }

  const variants = new Set<string>();
  variants.add(normalized);
  variants.add(normalized.replace(/[^A-Z0-9]/g, ''));

  normalized.split(' ').forEach((chunk) => {
    const compactChunk = chunk.replace(/[^A-Z0-9]/g, '');
    if (compactChunk.length >= 4) {
      variants.add(compactChunk);
    }
  });

  return [...variants].filter((entry) => entry.length > 0);
}

function pieceTokens(value: string): string[] {
  const normalized = normalizePieceLabel(value);
  if (!normalized) {
    return [];
  }

  const tokenSet = new Set<string>();
  normalized
    .split(/[^A-Z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
    .forEach((token) => {
      tokenSet.add(token);
    });

  normalized
    .split(' ')
    .map((chunk) => chunk.replace(/[^A-Z0-9]/g, ''))
    .filter((token) => token.length >= 4)
    .forEach((token) => {
      tokenSet.add(token);
    });

  const fullyCompacted = normalized.replace(/[^A-Z0-9]/g, '');
  if (fullyCompacted.length >= 4) {
    tokenSet.add(fullyCompacted);
  }

  return [...tokenSet];
}

function isStrongToken(token: string): boolean {
  const hasLetter = /[A-Z]/.test(token);
  const hasDigit = /\d/.test(token);
  const hasLongDigitChain = /\d{4,}/.test(token);
  return hasLongDigitChain || (hasLetter && hasDigit && token.length >= 4) || token.length >= 7;
}

function compactPartIdentifier(value: string): string {
  return value
    .replace(/[^A-Z0-9]/g, '')
    .replace(/REV\d*$/g, '');
}

function extractPartIdentifiers(value: string): string[] {
  const normalized = normalizePieceLabel(value);
  if (!normalized) {
    return [];
  }

  const ids = new Set<string>();
  const segmentedMatches = normalized.match(/[A-Z0-9]+(?:[-/.][A-Z0-9]+)+/g) ?? [];
  segmentedMatches.forEach((match) => {
    const compact = compactPartIdentifier(match);
    if (compact.length >= 5 && /\d/.test(compact)) {
      ids.add(compact);
    }
  });

  const compactCandidates = normalized.match(/[A-Z0-9]{5,}/g) ?? [];
  compactCandidates.forEach((candidate) => {
    const compact = compactPartIdentifier(candidate);
    if (compact.length >= 5 && /\d/.test(compact)) {
      ids.add(compact);
    }
  });

  return [...ids];
}

function hasStrongIdentifierMatch(orderIds: string[], blueprintIds: string[]): boolean {
  for (const orderId of orderIds) {
    for (const blueprintId of blueprintIds) {
      if (orderId === blueprintId) {
        return true;
      }
      const shortest = Math.min(orderId.length, blueprintId.length);
      if (
        shortest >= 6
        && (orderId.includes(blueprintId) || blueprintId.includes(orderId))
      ) {
        return true;
      }
    }
  }
  return false;
}

const COMMON_STOP_WORDS = new Set([
  'PART', 'NUMBER', 'DRAWING', 'REV', 'REVISION', 'SUPRAJIT', 'TOOL', 'CRIB', 'PIEZA', 'CODIGO',
  'DETALLE', 'ENSAMBLE', 'ASSEMBLY', 'DETAIL', 'SCALE', 'ESCALA', 'SHEET', 'HOJA', 'CLIENTE', 'CUSTOMER'
]);

function descriptiveTokens(value: string): string[] {
  const normalized = normalizePieceLabel(value);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/[^A-Z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => (
      token.length >= 3 && 
      /[A-Z]/.test(token) && 
      !/\d{3,}/.test(token) &&
      !COMMON_STOP_WORDS.has(token)
    ));
}

interface PieceMatchSignals {
  identifiers: string[];
  descriptors: string[];
}

interface BlueprintSourceCandidate {
  fileLabel: string;
  specs: BlueprintSpec[];
}

function isBlueprintPathStopWord(token: string): boolean {
  if (BLUEPRINT_PATH_STOP_WORDS.includes(token as (typeof BLUEPRINT_PATH_STOP_WORDS)[number])) {
    return true;
  }
  return /^REV\d*$/.test(token);
}

function stripBlueprintPathNoise(fileLabel: string): string {
  const withoutExtension = fileLabel.replace(/\.pdf$/i, ' ');
  const normalizedPath = normalizePieceLabel(withoutExtension).replace(/[\\/]/g, ' ');
  const tokens = normalizedPath
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !isBlueprintPathStopWord(token));
  return tokens.join(' ');
}

function extractBlueprintSignals(fileLabel: string, specs: BlueprintSpec[]): PieceMatchSignals {
  const identifiers = new Set<string>();
  const descriptors = new Set<string>();

  // Extract from the filename/path
  const withoutExtension = fileLabel.replace(/\.pdf$/i, ' ');
  extractPartIdentifiers(withoutExtension).forEach((entry) => identifiers.add(entry));
  descriptiveTokens(withoutExtension).forEach((entry) => descriptors.add(entry));

  // Extract from AI analysis of the blueprint content
  specs.forEach((spec) => {
    extractPartIdentifiers(spec.pieza_detectada).forEach((entry) => identifiers.add(entry));
    descriptiveTokens(spec.pieza_detectada).forEach((entry) => descriptors.add(entry));
  });

  return {
    identifiers: [...identifiers],
    descriptors: [...descriptors],
  };
}

function extractOrderSignals(orderPiece: string): PieceMatchSignals {
  return {
    identifiers: extractPartIdentifiers(orderPiece),
    descriptors: descriptiveTokens(orderPiece),
  };
}

function scorePieceMatch(orderSignals: PieceMatchSignals, candidateSignals: PieceMatchSignals): number {
  const orderIds = orderSignals.identifiers;
  const candidateIds = candidateSignals.identifiers;

  // RULE 1: Direct identifier match is KING.
  if (orderIds.length > 0 && candidateIds.length > 0) {
    if (hasStrongIdentifierMatch(orderIds, candidateIds)) {
      // If we have a perfect ID match, we don't care much about the description
      return 95;
    }
  }

  // RULE 2: If we have IDs in both but they DON'T match, it's a hard NO.
  // This prevents "90-1012-05" from matching "90-1012-06" just because they share "90-1012".
  if (orderIds.length > 0 && candidateIds.length > 0) {
    // We already checked for match above, so if we're here, they don't match.
    return 0;
  }

  // RULE 3: Descriptive matching (Fuzzy)
  const orderSet = new Set(orderSignals.descriptors);
  const candidateSet = new Set(candidateSignals.descriptors);
  const sharedTokens = [...orderSet].filter((token) => candidateSet.has(token));
  
  if (sharedTokens.length === 0) return 0;

  const overlapRatio = sharedTokens.length / Math.max(orderSet.size, candidateSet.size);
  const hasStrongSharedToken = sharedTokens.some(isStrongToken);

  if (hasStrongSharedToken && overlapRatio >= 0.6) return 85;
  if (sharedTokens.length >= 2 && overlapRatio >= 0.5) return 82;
  
  return 0;
}

function calculatePieceMatchScore(orderPiece: string, blueprintPiece: string): number {
  const normalizedOrder = normalizePieceLabel(orderPiece);
  const normalizedBlueprint = normalizePieceLabel(blueprintPiece);

  if (!normalizedOrder || !normalizedBlueprint) {
    return 0;
  }

  if (normalizedOrder === normalizedBlueprint) {
    return 100;
  }

  const orderSignals = extractOrderSignals(orderPiece);
  const blueprintSignals: PieceMatchSignals = {
    identifiers: extractPartIdentifiers(blueprintPiece),
    descriptors: descriptiveTokens(blueprintPiece),
  };
  return scorePieceMatch(orderSignals, blueprintSignals);
}

function selectBestBlueprintSpec(orderPiece: string, specs: BlueprintSpec[]): BlueprintSpec | null {
  return selectBestBlueprintMatch(orderPiece, {
    fileLabel: '',
    specs,
  }).spec;
}

function selectBestBlueprintMatch(orderPiece: string, candidate: BlueprintSourceCandidate): BlueprintSpecMatch {
  const normalizedOrder = normalizePieceLabel(orderPiece);
  if (!normalizedOrder) {
    return { spec: null, score: 0 };
  }

  const orderSignals = extractOrderSignals(orderPiece);
  const fileSignals = extractBlueprintSignals(candidate.fileLabel, candidate.specs);
  const fileScore = scorePieceMatch(orderSignals, fileSignals);

  let bestSpec: BlueprintSpec | null = null;
  let bestSpecScore = 0;

  for (const spec of candidate.specs) {
    const score = calculatePieceMatchScore(orderPiece, spec.pieza_detectada);
    if (score > bestSpecScore) {
      bestSpecScore = score;
      bestSpec = spec;
    }
  }

  const hasStrongFileMatch = fileScore >= MIN_BLUEPRINT_MATCH_SCORE;
  const matchedSpec = bestSpec && (
    bestSpecScore >= MIN_BLUEPRINT_MATCH_SCORE
    // Si el archivo ya es el correcto por nombre/ruta, usamos su mejor spec
    // aunque la etiqueta de pieza_detectada del AI sea débil.
    || hasStrongFileMatch
  ) ? bestSpec : null;
  return {
    spec: matchedSpec,
    score: fileScore,
  };
}

export default function App() {
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
    } catch (err) {
      setError(`No fue posible leer ${file.name}.`);
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

  const preparePdfPart = (dataUrl: string) => {
    const base64Data = dataUrl.split(';base64,')[1];
    return {
      inlineData: {
        mimeType: "application/pdf",
        data: base64Data
      }
    };
  };

  const prepareImagePart = (dataUrl: string) => {
    const base64Data = dataUrl.split(';base64,')[1];
    return {
      inlineData: {
        mimeType: "image/jpeg",
        data: base64Data
      }
    };
  };

  // Guard: returns true only if the AI bounding box is usable.
  // Invalid = missing, wrong length, negative/flipped axes, below 5% of the plano,
  // or covering more than 80% of it (usually means "el plano completo").
  const isValidBoundingBox = (box?: number[]): box is number[] => {
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
  };

  // Fallback crop when the AI did not return a usable view.
  // Covers the upper ~70% of the sheet at near-full width: where the main views live
  // on standard ISO tool-crib drawings (title block occupies the bottom-right corner).
  const FALLBACK_CENTER_BOX: number[] = [30, 30, 720, 970];

  // Helper to crop image based on AI bounding box
  const cropIsometricView = (base64: string, box: number[]): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const padding = 12;
        const [ymin, xmin, ymax, xmax] = box;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const x = Math.max(0, (xmin / 1000) * img.width - padding);
        const y = Math.max(0, (ymin / 1000) * img.height - padding);
        const width = Math.min(img.width - x, ((xmax - xmin) / 1000) * img.width + padding * 2);
        const height = Math.min(img.height - y, ((ymax - ymin) / 1000) * img.height + padding * 2);
        canvas.width = width;
        canvas.height = height;
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.src = base64;
    });
  };

  const extractInfo = async () => {
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
      // 1. Extract Orders (Pro)
      let ordersList: ExtractedOrder[] = [];
      setExtractingStep('Leyendo tabla de pedidos...');
      try {
        const orderHash = await createDocumentHash(orderPdf);
        const cachedOrders = await readCachedValue<ExtractedOrder[]>('orders', orderHash, ORDER_PROMPT_VERSION);
        if (cachedOrders) {
          ordersList = cachedOrders;
        } else {
          const orderAiStart = performance.now();
          const response = await ai.models.generateContent({
            model: GEMINI_ORDER_MODEL,
            contents: [{
              role: 'user',
              parts: [
                { text: `Analiza esta tabla PDF de órdenes de taller tipo tool crib.
Devuelve EXCLUSIVAMENTE un JSON array con objetos que tengan los campos exactos:
- pieza
- cantidad
- orden
- fecha
- prioridad (solo "URGENTE" o "Normal")

Reglas de extracción:
1) Lee TODAS las columnas y filas, manejando celdas fusionadas o descripciones multi-línea.
2) NO cortes las descripciones. Si una descripción de pieza continúa en la siguiente línea, concaténala.
3) Identifica el "Código de Parte" (Part Number) si existe y asegúrate de incluirlo en el campo "pieza" junto a su descripción.
4) Devuelve una fila por cada pieza o variante real. Si hay sub-piezas bajo una cabecera, extrae cada una.
5) Si una fila tiene dato de fecha, orden o cantidad, procésala.
6) Excluye filas de totales (ej: "Piezas Requeridas", "Piezas Terminadas", "Restantes a Crear").
7) Si no hay urgencia explícita, usa "Normal".
8) No inventes campos ni texto fuera del JSON.` },
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
                    cantidad: { type: Type.STRING },
                    orden: { type: Type.STRING },
                    fecha: { type: Type.STRING },
                    prioridad: { type: Type.STRING, enum: ["URGENTE", "Normal"] }
                  },
                  required: ["pieza", "cantidad", "orden", "fecha", "prioridad"]
                }
              }
            }
          });
          aiOrderMs += performance.now() - orderAiStart;
          ordersList = parseOrdersResponse(response.text.trim());
          await writeCachedValue('orders', orderHash, ORDER_PROMPT_VERSION, ordersList);
        }
        setOrderLoadingState('done');
      } catch (e) {
        setOrderLoadingState('error');
        throw e;
      }

      // 1.5 Auto-Matching: Buscar en biblioteca Tool Crib
      setExtractingStep('Buscando planos en biblioteca...');
      const libResult = await listActiveDrawingViews({ customer: 'SUPRAJIT' });
      if (libResult.ok) {
        const library = libResult.value;
        const autoAttachedIds = new Set(Object.values(toolcribPdfToDrawing));
        
        for (const order of ordersList) {
          // Si ya tenemos un plano cargado manualmente que machea bien, saltamos
          const hasManualMatch = currentWorkshopPdfs.some(pdf => 
            calculatePieceMatchScore(order.pieza, pdf.relativePath) >= MIN_BLUEPRINT_MATCH_SCORE
          );
          if (hasManualMatch) continue;

          // Buscar mejor candidato en biblioteca
          let bestView: ToolcribActiveDrawingView | null = null;
          let bestScore = 0;

          for (const view of library) {
            const signals = extractLibrarySignals(view);
            const score = scorePieceMatch(extractOrderSignals(order.pieza), signals);
            if (score > bestScore) {
              bestScore = score;
              bestView = view;
            }
          }

          if (bestView && bestScore >= MIN_BLUEPRINT_MATCH_SCORE && bestView.pdfUrl) {
            if (!autoAttachedIds.has(bestView.drawingId)) {
              setExtractingStep(`Auto-adjuntando: ${bestView.partNumber}...`);
              try {
                const dataUrl = await fetchPdfAsDataUrl(bestView.pdfUrl);
                const pdfId = `toolcrib-${bestView.drawingId}-${crypto.randomUUID()}`;
                const newUpload: WorkshopPdfUpload = {
                  id: pdfId,
                  name: `${bestView.partNumber} (Rev ${bestView.revision}).pdf`,
                  relativePath: bestView.sourcePath || bestView.partNumber,
                  dataUrl,
                };
                
                currentWorkshopPdfs.push(newUpload);
                autoAttachedIds.add(bestView.drawingId);
                
                // Actualizar estado de UI para que el usuario vea qué se añadió
                setWorkshopPdfs(prev => [...prev, newUpload]);
                setToolcribPdfToDrawing(prev => ({ ...prev, [pdfId]: bestView!.drawingId }));
              } catch (fetchErr) {
                console.warn(`Falló auto-attach de ${bestView.partNumber}`, fetchErr);
              }
            }
          }
        }
      }

      if (currentWorkshopPdfs.length === 0) {
        setError('No se encontraron planos para las piezas detectadas. Sube planos manualmente o verifica la biblioteca.');
        setIsExtracting(false);
        return;
      }

      // 2. Extract Blueprints from all pages/PDFs (Pro Vision)
      setExtractingStep(`Analizando ${currentWorkshopPdfs.length} planos...`);
      const initialWorkshopStates: Record<string, 'loading'> = {};
      currentWorkshopPdfs.forEach((pdf) => { initialWorkshopStates[pdf.id] = 'loading'; });
      setWorkshopLoadingStates(initialWorkshopStates);

      const blueprintTaskResults = await runWithConcurrencyLimit(
        currentWorkshopPdfs.map((workshopPdf, index) => ({ workshopPdf, index })),
        MAX_BLUEPRINT_CONCURRENCY,
        async (task): Promise<BlueprintTaskResult> => {
          try {
            const blueprintHash = await createDocumentHash(task.workshopPdf.dataUrl);
            const cached = await readCachedValue<BlueprintAnalysis>('blueprint', blueprintHash, BLUEPRINT_PROMPT_VERSION);
            if (cached) {
              enqueueWorkshopStatusPatch({ fileId: task.workshopPdf.id, status: 'done' });
              return {
                index: task.index,
                fileId: task.workshopPdf.id,
                fileLabel: task.workshopPdf.relativePath,
                analysis: cached,
                metrics: {
                  pdfRasterMs: 0,
                  aiBlueprintMs: 0,
                },
              };
            }

            const workerResult = await rasterizeAndNormalizePdf(task.workshopPdf.dataUrl, {
              maxDim: 1024,
              renderScale: 1.5,
              jpegQuality: 0.85,
              normalizeQuality: 0.68,
            });

            const blueprintAiStart = performance.now();
            const response = await ai.models.generateContent({
              model: GEMINI_BLUEPRINT_MODEL,
              contents: [{
                role: 'user',
                parts: [
                  { text: `Analiza este plano de taller y devuelve EXCLUSIVAMENTE un JSON array.
Campos: pieza_detectada, descripcionVisual, isometricBoundingBox [ymin, xmin, ymax, xmax] (0 a 1000).

Reglas de extracción (ESTILO UT2033):
1) Identifica el "Código de Parte" o "Número de Dibujo". Búscalo en el Cajetín (Title Block), esquina INFERIOR DERECHA.
2) PRIORIDAD ABSOLUTA: Elige la Vista Isométrica 3D (el dibujo que muestra la pieza con volumen). Si existe, el bounding box DEBE ser sobre esta vista. Usa una vista 2D solo si no hay isométrica.
3) GEOMETRÍA LIMPIA: El bounding box debe contener ÚNICAMENTE la geometría sólida de la pieza.
4) REGLA CRÍTICA: Excluye ABSOLUTAMENTE todas las líneas de dimensión (cotas), flechas, números de medidas, líneas de extensión y notas de texto que rodeen la pieza. El recorte debe verse "limpio" como una foto de catálogo.
5) Excluye el marco del plano, marcas de coordenadas en los bordes, cajetines y logos.
6) El bounding box debe estar bien centrado sobre la masa física de la pieza.
7) Si hay múltiples piezas diferentes en el mismo plano, devuelve una entrada por pieza.
8) Si no hay vistas útiles, devuelve [].
9) No inventes información.` },
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
                      descripcionVisual: { type: Type.STRING },
                      isometricBoundingBox: {
                        type: Type.ARRAY,
                        items: { type: Type.NUMBER },
                      },
                    },
                    required: ["pieza_detectada", "descripcionVisual", "isometricBoundingBox"]
                  }
                }
              }
            });
            const aiElapsed = performance.now() - blueprintAiStart;
            const analysis: BlueprintAnalysis = {
              specs: parseBlueprintResponse(response.text.trim()),
              image: workerResult.imageDataUrl,
            };
            await writeCachedValue('blueprint', blueprintHash, BLUEPRINT_PROMPT_VERSION, analysis);
            enqueueWorkshopStatusPatch({ fileId: task.workshopPdf.id, status: 'done' });
            return {
              index: task.index,
              fileId: task.workshopPdf.id,
              fileLabel: task.workshopPdf.relativePath,
              analysis,
              metrics: {
                pdfRasterMs: workerResult.metrics.pdfRasterMs + workerResult.metrics.normalizeMs,
                aiBlueprintMs: aiElapsed,
              },
            };
          } catch (e) {
            enqueueWorkshopStatusPatch({ fileId: task.workshopPdf.id, status: 'error' });
            console.error('[smv-vision] blueprint analysis failed for', task.workshopPdf.name, e);
            return {
              index: task.index,
              fileId: task.workshopPdf.id,
              fileLabel: task.workshopPdf.relativePath,
              analysis: { specs: [], image: '' },
              metrics: { pdfRasterMs: 0, aiBlueprintMs: 0 },
            };
          }
        },
      );
      flushWorkshopStatePatches();
      const blueprintResults = blueprintTaskResults
        .sort((a, b) => a.index - b.index)
        .map((entry) => ({
          fileId: entry.fileId,
          fileLabel: entry.fileLabel,
          ...entry.analysis,
        }));
      blueprintTaskResults.forEach((entry) => {
        pdfRasterMs += entry.metrics.pdfRasterMs;
        aiBlueprintMs += entry.metrics.aiBlueprintMs;
      });

      // 3. Merge and Populate Results
      setExtractingStep('Generando reporte final...');
      const mergeStart = performance.now();
      let finalResults: Order[] = [];
      const matchedBlueprintFileIds = new Set<string>();

      finalResults = await Promise.all(ordersList.map(async (order) => {
        let bestMatch: BlueprintSpec | null = null;
        let bestScore = 0;
        let sourceImg: string | null = null;
        let sourceFileId: string | null = null;
        let sourceFileLabel: string | null = null;

        for (const res of blueprintResults) {
          const match = selectBestBlueprintMatch(order.pieza, {
            fileLabel: res.fileLabel,
            specs: res.specs,
          });
          if (match.score >= MIN_BLUEPRINT_MATCH_SCORE && match.score > bestScore) {
            bestMatch = match.spec;
            bestScore = match.score;
            sourceImg = res.image;
            sourceFileId = res.fileId;
            sourceFileLabel = res.fileLabel;
          }
        }

        if (sourceFileId) {
          matchedBlueprintFileIds.add(sourceFileId);
        }

        const resObj: Order = {
          ...order,
          haSidoAuditada: !!bestMatch || !!sourceFileLabel,
          descripcionVisual:
            bestMatch?.descripcionVisual
            || (sourceFileLabel
              ? "Vista general del plano (sin vista principal detectada)."
              : "Detalles técnicos no encontrados en planos."),
          isometricBoundingBox: bestMatch?.isometricBoundingBox,
          sourcePdfName: sourceFileLabel ?? undefined,
          sourcePdfPath: sourceFileLabel ?? undefined,
        };

        if (sourceImg) {
          try {
            const cropBox = isValidBoundingBox(resObj.isometricBoundingBox)
              ? resObj.isometricBoundingBox
              : FALLBACK_CENTER_BOX;
            resObj.isometricView = await cropIsometricView(sourceImg, cropBox);
          } catch (e) {
            console.error("Auto-crop error", e);
          }
        }
        return resObj;
      }));

      if (finalResults.length === 0) {
        throw new Error("No fue posible extraer órdenes desde la tabla de entrada.");
      }

      mergeMs = performance.now() - mergeStart;
      const totalAudited = finalResults.filter((result) => result.haSidoAuditada).length;
      setResults(finalResults);
      setAnalysisSummary({
        totalLoaded: currentWorkshopPdfs.length,
        totalAnalyzed: blueprintResults.length,
        totalAudited,
        totalNonMatching: Math.max(0, blueprintResults.length - matchedBlueprintFileIds.size),
        totalOrders: finalResults.length,
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
        totalAnalyzed: blueprintResults.length,
        totalAudited,
        totalNonMatching: Math.max(0, blueprintResults.length - matchedBlueprintFileIds.size),
        totalOrders: finalResults.length,
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

  const copyResults = async () => {
    if (!results) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(results, null, 2));
      setCopying(true);
      setTimeout(() => setCopying(false), 2000);
    } catch {
      // clipboard access denied — silent no-op
    }
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

  const downloadPdf = () => {
    if (!results) {
      return;
    }

    // Cambiado a 'portrait' (vertical)
    const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const generatedAt = new Date();
    const dateLabel = generatedAt.toLocaleDateString();
    const auditedTotal = analysisSummary?.totalAudited ?? results.filter((entry) => entry.haSidoAuditada).length;
    const totalOrders = analysisSummary?.totalOrders ?? results.length;
    const headerY = 40;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('REPORTE DE TRABAJO: SUPRAJIT', 40, headerY);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(
      `Fecha: ${dateLabel}   |   Ordenes: ${totalOrders}   |   Auditadas: ${auditedTotal}`,
      40,
      headerY + 12,
    );

    const sortedResults: Order[] = [
      ...results.filter((order) => !!order.isometricView),
      ...results.filter((order) => !order.isometricView),
    ];

    const bodyRows: RowInput[] = sortedResults.map((order) => [
      '', // Espacio para el dibujo
      order.pieza,
      order.cantidad,
      order.orden,
      order.fecha,
    ]);

    autoTable(doc, {
      startY: headerY + 20,
      head: [['DIBUJO', 'NOMBRE DE LA PIEZA', 'CANT.', 'SO', 'FECHA']],
      body: bodyRows,
      theme: 'grid',
      headStyles: { 
        fillColor: [0, 0, 0], 
        textColor: [255, 255, 255], 
        fontStyle: 'bold', 
        fontSize: 9,
        halign: 'center'
      },
      styles: { 
        fontSize: 8, 
        cellPadding: 4, 
        overflow: 'linebreak', 
        valign: 'middle',
        lineWidth: 1,
        lineColor: [0, 0, 0]
      },
      columnStyles: {
        0: { cellWidth: 95,  halign: 'center' },
        1: { cellWidth: 225, fontStyle: 'bold', fontSize: 9 },
        2: { cellWidth: 45,  halign: 'center', fontStyle: 'bold', fontSize: 11 },
        3: { cellWidth: 70,  halign: 'center', fontStyle: 'bold' },
        4: { cellWidth: 80,  halign: 'center' },
      },
      didParseCell: (hookData: CellHookData) => {
        if (hookData.section === 'body' && hookData.column.index === 0) {
          const order = sortedResults[hookData.row.index];
          if (order?.isometricView) {
            hookData.cell.styles.minCellHeight = 82;
          }
        }
      },
      didDrawCell: (hookData: CellHookData) => {
        if (hookData.section !== 'body' || hookData.column.index !== 0) {
          return;
        }
        const order = sortedResults[hookData.row.index];
        if (!order?.isometricView) {
          return;
        }
        const imageSize = 72;
        const imageX = hookData.cell.x + (hookData.cell.width - imageSize) / 2;
        const imageY = hookData.cell.y + (hookData.cell.height - imageSize) / 2;
        try {
          doc.addImage(order.isometricView, 'JPEG', imageX, imageY, imageSize, imageSize);
        } catch (error) {
          console.error('PDF image embedding error', error);
        }
      },
    });

    const pageCount = doc.getNumberOfPages();
    for (let page = 1; page <= pageCount; page += 1) {
      doc.setPage(page);
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`SMV VISION // ${generatedAt.toLocaleString()}`, 40, 820);
      doc.text(`Pagina ${page} de ${pageCount}`, 555, 820, { align: 'right' });
    }

    doc.save(`reporte_smv_${generatedAt.toISOString().split('T')[0]}.pdf`);
    
    // Abrir en nueva pestaña como preview (opcional pero solicitado)
    try {
      const blobUrl = doc.output('bloburl');
      window.open(blobUrl, '_blank');
    } catch (e) {
      console.warn('No fue posible abrir el preview del PDF', e);
    }
  };

  const auditedCount = useMemo(
    () => (results ? results.filter((result) => result.haSidoAuditada).length : 0),
    [results],
  );

  return (
    <div className="min-h-screen bg-bg font-sans text-ink border-12 border-ink flex flex-col h-screen">
      {/* Header - Compacted */}
      <header className="bg-bg border-b-2 border-ink px-10 py-6">
        <div className="flex flex-col md:flex-row items-end justify-between gap-4">
          <div className="space-y-2">
            <span className="text-[11px] font-black uppercase tracking-[2px] bg-ink text-bg px-2 py-0.5 inline-block">
              Servicios y Maquinados Vázquez
            </span>
            <h1 className="text-[48px] lg:text-[64px] font-black leading-none tracking-[-3px] uppercase italic">
              SMV // VISION
            </h1>
          </div>
          <div className="text-right space-y-1">
            <span className="text-[11px] font-black uppercase tracking-[2px] bg-accent text-bg px-2 py-0.5 inline-block">
              Intelligent Workshop Analyzer
            </span>
            <p className="text-[20px] font-black tracking-[-0.5px] uppercase opacity-40">
              AUDIT CORE V3.1
            </p>
          </div>
        </div>
      </header>

      <main className="grow grid grid-cols-1 xl:grid-cols-12 overflow-hidden">
        {/* Input & Vision Sidebar */}
        <section className="xl:col-span-4 bg-[#E8E8E8] border-r-2 border-ink p-8 flex flex-col gap-8 overflow-y-auto">
          
          {/* Header Module: Config & Orders */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest text-ink/40">
              <div className="w-4 h-1 bg-ink"></div>
              01. Pedidos
            </div>

            {/* Order Visual Input */}
            <div 
              className={`min-h-[160px] border-2 border-dashed border-ink flex flex-col items-center justify-center p-6 relative transition-all group ${orderPdf ? 'bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)]' : 'bg-white/30 hover:bg-white hover:border-accent cursor-pointer'}`}
              onClick={() => !orderPdf && orderFileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={orderFileInputRef} 
                className="hidden" 
                accept="application/pdf" 
                onChange={(e) => void handleOrderInputUpload(e)} 
              />
              
              {!orderPdf ? (
                <div className="text-center space-y-2 group-hover:scale-105 transition-transform">
                  <Database className="mx-auto w-10 h-10 text-ink/20 group-hover:text-accent" />
                  <p className="font-black uppercase text-xs tracking-tighter">Subir Reporte de Pedidos</p>
                  <p className="text-[9px] text-gray-400 font-mono uppercase">PDF de Google Sheets (Suprajit)</p>
                </div>
              ) : (
                <div className="relative w-full h-full flex flex-col items-center justify-center">
                  <div className="relative">
                    <FileText className={`w-14 h-14 ${orderLoadingState === 'loading' ? 'text-accent animate-pulse' : 'text-ink'}`} />
                    {orderLoadingState === 'done' && (
                      <div className="absolute -bottom-1 -right-1 bg-green-500 p-1 rounded-full border-2 border-white">
                        <CheckCircle2 size={12} className="text-white" />
                      </div>
                    )}
                  </div>
                  <p className="mt-4 font-black text-[11px] uppercase tracking-widest truncate max-w-full px-4">
                    {orderPdfName}
                  </p>
                  <button 
                    onClick={(e) => { e.stopPropagation(); removeFile('order'); }}
                    className="absolute -top-4 -right-4 p-2 bg-accent text-bg hover:bg-ink transition-colors border-2 border-ink shadow-[2px_2px_0px_rgba(0,0,0,1)]"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Module 2: Tool Crib Library */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest text-ink/40">
              <div className="w-4 h-1 bg-ink"></div>
              02. Biblioteca de Planos
            </div>
            <ToolcribLibraryPanel
              onAttachDrawing={handleAttachToolcribDrawing}
              attachedDrawingIds={attachedToolcribDrawingIds}
            />
          </div>

          {/* Module 3: Active Workspace & Actions */}
          <div className="mt-auto pt-6 space-y-4 border-t-4 border-ink/5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-[12px] font-black uppercase tracking-widest text-ink/40">
                <div className="w-4 h-1 bg-accent"></div>
                03. Workspace
              </div>
              <span className="bg-ink text-bg px-2 py-0.5 text-[10px] font-black">{workshopPdfs.length} PLANOS</span>
            </div>

            {workshopPdfs.length > 0 && (
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-2">
                {workshopPdfs.map((pdf) => (
                  <div key={pdf.id} className="relative group border border-ink bg-white p-2 flex items-center justify-between gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)] hover:translate-y-[-1px] transition-transform">
                    <div className="flex items-center gap-2 overflow-hidden">
                      {workshopLoadingStates[pdf.id] === 'loading' ? (
                        <Loader2 size={12} className="text-accent animate-spin shrink-0" />
                      ) : (
                        <CheckCircle2 size={12} className="text-green-500 shrink-0" />
                      )}
                      <span className="text-[9px] font-mono truncate uppercase font-bold">
                        {pdf.relativePath.split('/').pop()}
                      </span>
                    </div>
                    <button 
                      onClick={(e) => { e.stopPropagation(); removeFile('workshop', pdf.id); }}
                      className="text-ink/30 hover:text-accent transition-colors"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            
            <button
              onClick={extractInfo}
              disabled={isExtracting || !orderPdf}
              className="w-full bg-accent hover:bg-ink disabled:bg-gray-300 text-bg font-black py-5 px-8 text-xl uppercase tracking-[4px] transition-all shadow-[6px_6px_0px_rgba(0,0,0,0.2)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 active:scale-[0.98]"
            >
              {isExtracting ? (
                <span className="flex items-center justify-center gap-3 italic">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Analizando...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-3">
                  Ejecutar Auditoría
                </span>
              )}
            </button>
          </div>
        </section>

        {/* Results Section */}
        <section className="xl:col-span-8 p-10 flex flex-col bg-bg overflow-hidden relative">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 bg-ink"></div>
              <h2 className="text-2xl font-black uppercase tracking-tighter italic">Audit Dashboard</h2>
            </div>
            
            {results && (
              <div className="flex gap-2">
                <button
                  onClick={copyResults}
                  className="bg-white border-2 border-ink text-ink px-4 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-ink hover:text-bg transition-all"
                >
                  {copying ? 'Copiado' : 'Copiar JSON'}
                </button>
                <button
                  onClick={downloadPdf}
                  className="bg-accent text-bg px-6 py-2 text-[10px] font-black uppercase tracking-widest hover:bg-ink transition-all shadow-[4px_4px_0px_rgba(0,0,0,1)] hover:shadow-none active:translate-x-0.5 active:translate-y-0.5"
                >
                  Exportar Reporte (PDF)
                </button>
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {!results && !isExtracting && !error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                className="grow border-4 border-ink border-dashed flex flex-col items-center justify-center text-center p-16 bg-white shadow-inner"
              >
                <div className="relative mb-8">
                  <Maximize2 className="text-ink/5 w-32 h-32" />
                  <FileText className="absolute inset-0 m-auto text-ink/20 w-12 h-12" />
                </div>
                <h3 className="font-black text-4xl uppercase tracking-tighter text-ink/20 italic mb-4">Esperando Instrucciones</h3>
                <p className="text-[11px] font-mono text-ink/40 uppercase tracking-[4px]">Carga el reporte de pedidos y selecciona planos para iniciar</p>
                <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-2xl w-full">
                  <div className="p-4 border-2 border-ink/10 bg-bg/50 text-left">
                    <p className="font-black text-[10px] uppercase mb-1">Paso 01</p>
                    <p className="text-[9px] font-mono opacity-60 leading-tight">Carga el PDF de órdenes generado por Google Sheets.</p>
                  </div>
                  <div className="p-4 border-2 border-ink/10 bg-bg/50 text-left">
                    <p className="font-black text-[10px] uppercase mb-1">Paso 02</p>
                    <p className="text-[9px] font-mono opacity-60 leading-tight">Usa el Auto-Matching o la Biblioteca para buscar planos.</p>
                  </div>
                  <div className="p-4 border-2 border-ink/10 bg-bg/50 text-left">
                    <p className="font-black text-[10px] uppercase mb-1">Paso 03</p>
                    <p className="text-[9px] font-mono opacity-60 leading-tight">Presiona "Ejecutar" para que Vision AI audite las piezas.</p>
                  </div>
                </div>
              </motion.div>
            )}

            {isExtracting && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grow border-4 border-ink bg-ink flex flex-col items-center justify-center text-center p-12 relative overflow-hidden"
              >
                {/* Background Pattern */}
                <div className="absolute inset-0 opacity-10 pointer-events-none" style={{ backgroundImage: 'radial-gradient(#FF4E00 1px, transparent 0)', backgroundSize: '24px 24px' }}></div>
                
                <div className="relative z-10 space-y-8">
                  <div className="relative">
                    <div className="w-40 h-40 border-8 border-white/5 border-t-accent rounded-full animate-spin"></div>
                    <Database className="absolute inset-0 m-auto text-accent w-10 h-10 animate-pulse" />
                  </div>
                  <div className="space-y-2">
                    <h3 className="text-bg font-black text-5xl uppercase tracking-tighter italic">Procesando...</h3>
                    <p className="text-accent font-mono text-sm uppercase tracking-[8px] animate-pulse">{extractingStep}</p>
                  </div>
                  <div className="flex justify-center gap-1 max-w-xs mx-auto flex-wrap">
                    {workshopPdfs.map((pdf) => (
                      <div 
                        key={pdf.id} 
                        className={`h-2 transition-all duration-500 ${
                          workshopLoadingStates[pdf.id] === 'done' ? 'bg-green-500 w-8' : 
                          workshopLoadingStates[pdf.id] === 'loading' ? 'bg-accent w-4 animate-pulse' : 'bg-white/10 w-2'
                        }`}
                      />
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grow border-4 border-accent bg-accent/5 p-12 flex flex-col items-center justify-center text-center"
              >
                <AlertCircle className="text-accent w-20 h-20 mb-6" />
                <h3 className="text-ink font-black text-2xl uppercase italic mb-4">Error Crítico Visión AI</h3>
                <p className="text-gray-600 font-mono text-sm max-w-md mx-auto bg-white p-4 border-2 border-ink">{error}</p>
              </motion.div>
            )}

            {results && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grow flex flex-col"
              >
                <div className="grow overflow-auto border-4 border-ink bg-white shadow-[12px_12px_0px_rgba(0,0,0,0.1)]">
                  {/* Styled Header matching PDF */}
                  <div className="bg-[#0D2B4D] text-white p-6 border-b-4 border-ink flex items-center justify-between">
                    <div>
                      <h2 className="text-3xl font-black uppercase tracking-tighter">REPORTE DE TRABAJO: SUPRAJIT</h2>
                      <p className="text-xs font-mono opacity-60">AUDITORÍA AUTOMATIZADA // SMV VISION</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black uppercase tracking-widest bg-accent text-bg px-2 inline-block mb-1">PRODUCCIÓN ACTIVA</p>
                      <p className="text-xs font-mono">{new Date().toLocaleDateString()}</p>
                    </div>
                  </div>

                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 z-20">
                      <tr className="bg-[#000000] text-bg">
                        <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest border-r border-white/10 w-[50%]">PIEZA Y VISTA DE PLANO</th>
                        <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest border-r border-white/10 text-center">CANT.</th>
                        <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest border-r border-white/10 text-center">SO (ORDEN)</th>
                        <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest text-center">FECHA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((order, idx) => (
                        <tr key={idx} className="border-b-2 border-gray-200 hover:bg-gray-50 transition-colors group">
                          {/* Pieza + Vista de Plano */}
                          <td className="px-5 py-4 border-r-2 border-gray-100 flex items-center justify-between gap-4">
                            <div className="grow">
                              <h4 className="font-black text-xl uppercase tracking-tight text-black mb-1">
                                {order.pieza}
                              </h4>
                              <p className="text-[10px] text-gray-500 font-mono italic">
                                {order.sourcePdfName || "Sin plano asociado"}
                              </p>
                            </div>

                            {order.isometricView && (
                              <div className="w-28 h-28 border-2 border-black bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)] shrink-0 relative overflow-hidden flex items-center justify-center p-1">
                                <img 
                                  src={order.isometricView} 
                                  alt="Vista" 
                                  className="max-w-full max-h-full object-contain mix-blend-multiply" 
                                />
                              </div>
                            )}
                          </td>
                          
                          <td className="px-5 py-4 border-r-2 border-gray-100 text-center align-middle">
                            <span className="font-black text-2xl text-black italic">
                              {order.cantidad}
                            </span>
                          </td>
                          
                          <td className="px-5 py-4 border-r-2 border-gray-100 text-center align-middle">
                            <span className="font-mono text-sm font-black bg-black text-white px-2 py-1">
                              {order.orden}
                            </span>
                          </td>
                          
                          <td className="px-5 py-4 text-center align-middle">
                            <span className="font-black text-xs uppercase text-black">
                              {order.fecha}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Production Summary Cards */}
                <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="bg-ink p-5 border-t-8 border-accent">
                    <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Total Auditado</p>
                    <p className="text-4xl font-black text-bg italic">{analysisSummary?.totalAudited ?? results.length}</p>
                  </div>
                  <div className="bg-ink p-5 border-t-8 border-accent">
                    <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Match Visual</p>
                    <p className="text-4xl font-black text-accent italic">{auditedCount}</p>
                  </div>
                  <div className="bg-ink p-5 border-t-8 border-accent">
                    <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Planos Analizados</p>
                    <p className="text-4xl font-black text-white italic">{analysisSummary?.totalAnalyzed ?? workshopPdfs.length}</p>
                  </div>
                  <div className="bg-ink p-5 flex items-center justify-center">
                    <div className="text-center">
                      <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">No Coincidentes</p>
                      <p className="text-2xl font-black text-accent italic">{analysisSummary?.totalNonMatching ?? 0}</p>
                    </div>
                  </div>
                </div>
                <div className="mt-2 text-[10px] font-mono text-ink/60">
                  Cargados: {analysisSummary?.totalLoaded ?? workshopPdfs.length} PDFs de taller. Ordenes en reporte: {analysisSummary?.totalOrders ?? results.length}.
                </div>
                {metricsComparison && (
                  <div className="mt-4 bg-[#0D2B4D] text-white border-2 border-ink p-4">
                    <div className="flex items-center justify-between gap-4 flex-wrap">
                      <p className="text-[10px] font-black uppercase tracking-widest">Métricas de rendimiento</p>
                      <p className="text-xs font-mono">
                        Total actual: {metricsComparison.latest.totalMs.toFixed(0)}ms
                      </p>
                    </div>
                    <div className="mt-3 grid grid-cols-2 md:grid-cols-5 gap-3 text-[10px] font-mono">
                      <p>Raster: {metricsComparison.latest.pdfRasterMs.toFixed(0)}ms</p>
                      <p>AI órdenes: {metricsComparison.latest.aiOrderMs.toFixed(0)}ms</p>
                      <p>AI planos: {metricsComparison.latest.aiBlueprintMs.toFixed(0)}ms</p>
                      <p>Merge: {metricsComparison.latest.mergeMs.toFixed(0)}ms</p>
                      <p className={metricsComparison.totalImprovementPct >= 0 ? 'text-green-300' : 'text-red-300'}>
                        Delta baseline: {metricsComparison.totalImprovementPct.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-ink text-bg px-10 py-5 flex items-center justify-between text-[11px] font-black uppercase tracking-widest">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 bg-[#00FF41] rounded-full animate-pulse shadow-[0_0_8px_#00FF41]"></div>
          VISION CORE ONLINE // SUPRAJIT ANALYZER READY
        </div>
        <div className="flex items-center gap-4">
          <span className="text-accent italic">SMV DATA CENTER</span>
          <span className="opacity-50">v3.1.PRO</span>
        </div>
      </footer>
    </div>
  );
}

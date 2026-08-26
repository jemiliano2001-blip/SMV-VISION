/**
 * Inventario/exportador de fuentes CAD para las isometricas de Tool Crib.
 * El dry-run es offline: no carga ni inicializa Firebase Admin.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { copyFile, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve as resolvePath } from 'node:path';
import { argv } from 'node:process';

import {
  buildCadPdfFileName,
  buildIsoPartNumber,
  buildIsoPdfFileName,
  buildIsoStlFileName,
  EDRAWINGS_ISO_REVISION,
  isCadSourceCandidateFile,
  isExcludedCadSourceRelativePath,
  parseCadDrawingFileName,
  parseCadSourceFileName,
  rankCadSourceCandidates,
  resolveCompanionImagePath,
  resolveCompanionStlPath,
  type CadSourceExtension,
  type CadSourceKind,
} from '../src/lib/edrawingsIso';
import { wrapImageFileAsPdfBytes } from './lib/wrapImageAsPdf';
import {
  canReuseExistingJpeg,
  normalizeExporterOption,
  runCadExporter,
  writeJpegProvenance,
} from './edrawings/exporterAdapter';
import {
  buildDrawingDocId,
  buildPartDocId,
  uploadCatalogBytes,
  upsertCatalogDrawing,
  upsertCatalogPart,
  type FirebaseCatalogContext,
} from './toolcrib/lib/firestoreCatalog';

const CREATED_BY_UID = 'edrawings-iso-v1';
const CREATED_BY_UID_CAD = 'edrawings-cad-v1';
const MANIFEST_SCHEMA_VERSION = 1;

interface CliOptions {
  scanPath: string;
  customer: string;
  credentialsPath: string | null;
  storageBucket: string;
  exporterPath: string | null;
  workDir: string | null;
  manifestPath: string | null;
  limit: number | null;
  includeUnpaired: boolean;
  includeStl: boolean;
  /** Omite el plano acotado (CAD): solo procesa la isométrica. */
  skipCad: boolean;
  dryRun: boolean;
}

interface CompanionPath {
  relativePath: string;
  absolutePath: string;
}

interface SourceCompanions {
  slddrw: CompanionPath | null;
  pdf: CompanionPath | null;
  raster: CompanionPath | null;
  stl: CompanionPath | null;
}

type ProcessingStatus =
  | 'pending'
  | 'inventory-only'
  | 'dry-run-ready'
  | 'uploaded'
  | 'skipped'
  | 'failed';

interface DiscoveredCadSource {
  relativePath: string;
  absolutePath: string;
  fileName: string;
  sourceKind: CadSourceKind;
  extension: CadSourceExtension;
  basePartNumber: string;
  isoPartNumber: string;
  embeddedRevision: string | null;
  sizeBytes: number;
  modifiedAtUTC: string;
  modifiedAtMs: number;
  companions: SourceCompanions;
  hasLocalDrawing: boolean;
  eligible: boolean;
  active: boolean;
  processingStatus: ProcessingStatus;
  processingMessage: string | null;
  exportDiagnostics: string | null;
  /** Estado del plano acotado (CAD) de esta pieza — independiente de la isométrica. */
  cadProcessingStatus: ProcessingStatus;
  cadProcessingMessage: string | null;
  cadExportDiagnostics: string | null;
}

type NonselectionReason =
  | 'solidworks-without-local-drawing'
  | 'duplicate-lower-ranked'
  | 'limit-exceeded';

interface NonselectedCandidate extends DiscoveredCadSource {
  nonselectionReason: NonselectionReason;
}

interface ExcludedSourceCounts {
  total: number;
  excludedPath: number;
  emptyFile: number;
  temporaryFile: number;
  statError: number;
}

interface ManifestSummary {
  discoveredSourceFiles: number;
  usableCandidates: number;
  eligibleCandidates: number;
  selectedCandidates: number;
  nonselectedUsableCandidates: number;
  duplicatePartGroups: number;
  excludedSources: number;
  inventoryOnly: number;
  dryRunReady: number;
  uploaded: number;
  skipped: number;
  failed: number;
  /** Contadores del plano acotado (CAD) — independientes de la isométrica. */
  cadInventoryOnly: number;
  cadDryRunReady: number;
  cadUploaded: number;
  cadSkipped: number;
  cadFailed: number;
  /** Piezas con `.slddrw` pero sin modelo 3D — CAD posible, ISO no. */
  cadOnlySourcesFound: number;
}

interface ImportManifest {
  schemaVersion: number;
  generatedAtUTC: string;
  scanRoot: string | null;
  options: {
    customer: string | null;
    storageBucket: string | null;
    exporter: string | null;
    workDir: string | null;
    dryRun: boolean | null;
    includeUnpaired: boolean | null;
    includeStl: boolean | null;
    skipCad: boolean | null;
    limit: number | null;
  };
  summary: ManifestSummary;
  excludedSourceCounts: ExcludedSourceCounts;
  selectedCandidates: DiscoveredCadSource[];
  nonselectedUsableCandidates: NonselectedCandidate[];
  cadOnlySources: CadOnlySource[];
  fatalErrorCategory: PublicErrorCategory | null;
  fatalError: string | null;
}

type PublicErrorCategory =
  | 'cli-validation'
  | 'scan-failed'
  | 'credentials-unavailable'
  | 'firebase-initialization-failed'
  | 'unexpected-error';

class PublicImportError extends Error {
  constructor(
    readonly category: PublicErrorCategory,
    message: string,
  ) {
    super(message);
    this.name = 'PublicImportError';
  }
}

interface PublicFailure {
  category: PublicErrorCategory;
  message: string;
}

interface DiscoveryResult {
  discoveredSourceFiles: number;
  usableCandidates: DiscoveredCadSource[];
  excludedSourceCounts: ExcludedSourceCounts;
}

type FirebaseContext = FirebaseCatalogContext;

function parsePositiveInteger(raw: string, name: string): number {
  if (!/^\d+$/.test(raw)) {
    throw new PublicImportError('cli-validation', `${name} debe ser un entero positivo.`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new PublicImportError('cli-validation', `${name} debe ser un entero positivo.`);
  }
  return value;
}

function extractRawManifestPath(args: readonly string[]): string | null {
  const raw = args
    .find((arg) => arg.startsWith('--manifest='))
    ?.slice('--manifest='.length)
    .trim();
  return raw ? resolvePath(raw) : null;
}

function toPublicFailure(error: unknown): PublicFailure {
  if (error instanceof PublicImportError) {
    return { category: error.category, message: error.message };
  }
  return {
    category: 'unexpected-error',
    message: 'La importacion termino por un error inesperado.',
  };
}

function parseCliOptions(args: readonly string[]): CliOptions {
  let scanPath: string | null = null;
  let customer = 'SUPRAJIT';
  let credentialsPath: string | null = null;
  let storageBucket = 'smv-brain.firebasestorage.app';
  let exporterPath: string | null = null;
  let workDir: string | null = null;
  let manifestPath: string | null = null;
  let limit: number | null = null;
  let includeUnpaired = false;
  let includeStl = false;
  let skipCad = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg.startsWith('--scan=')) scanPath = arg.slice('--scan='.length);
    else if (arg.startsWith('--customer=')) customer = arg.slice('--customer='.length);
    else if (arg.startsWith('--credentials=')) credentialsPath = arg.slice('--credentials='.length);
    else if (arg.startsWith('--storageBucket=')) storageBucket = arg.slice('--storageBucket='.length);
    else if (arg.startsWith('--exporter=')) exporterPath = arg.slice('--exporter='.length);
    else if (arg.startsWith('--workDir=')) workDir = arg.slice('--workDir='.length);
    else if (arg.startsWith('--manifest=')) manifestPath = arg.slice('--manifest='.length);
    else if (arg.startsWith('--limit=')) limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
    else if (arg === '--includeUnpaired') includeUnpaired = true;
    else if (arg === '--includeStl') includeStl = true;
    else if (arg === '--skipCad') skipCad = true;
    else if (arg === '--dryRun' || arg === '--dry-run') dryRun = true;
  }
  if (!scanPath) {
    throw new PublicImportError('cli-validation', 'Falta --scan=./ruta/TOOL CRIB');
  }

  return {
    scanPath: resolvePath(scanPath),
    customer: customer.trim().toUpperCase() || 'SUPRAJIT',
    credentialsPath: credentialsPath ? resolvePath(credentialsPath) : null,
    storageBucket,
    exporterPath: normalizeExporterOption(exporterPath),
    workDir: workDir ? resolvePath(workDir) : null,
    manifestPath: manifestPath ? resolvePath(manifestPath) : null,
    limit,
    includeUnpaired,
    skipCad,
    includeStl,
    dryRun,
  };
}

function normalizeRelativePath(path: string): string {
  return path.replace(/\\/g, '/');
}

function toManifestPath(scanRoot: string, absolutePath: string): CompanionPath {
  return {
    relativePath: normalizeRelativePath(relative(scanRoot, absolutePath)),
    absolutePath: resolvePath(absolutePath),
  };
}

function findSameStemCompanion(
  sourcePath: string,
  directoryNames: readonly string[],
  extensions: readonly string[],
): string | null {
  const stem = basename(sourcePath, extname(sourcePath)).toLowerCase();
  const accepted = new Set(extensions.map((extension) => `${stem}${extension}`.toLowerCase()));
  const match = [...directoryNames].sort().find((name) => accepted.has(name.toLowerCase()));
  return match ? join(dirname(sourcePath), match) : null;
}

function incrementExcluded(counts: ExcludedSourceCounts, reason: keyof Omit<ExcludedSourceCounts, 'total'>): void {
  counts[reason] += 1;
  counts.total += 1;
}

async function discoverCadSources(options: CliOptions): Promise<DiscoveryResult> {
  const usableCandidates: DiscoveredCadSource[] = [];
  const excludedSourceCounts: ExcludedSourceCounts = {
    total: 0,
    excludedPath: 0,
    emptyFile: 0,
    temporaryFile: 0,
    statError: 0,
  };
  let discoveredSourceFiles = 0;

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    const directoryNames = entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    const sortedEntries = [...entries].sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    );

    for (const entry of sortedEntries) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;

      const parsed = parseCadSourceFileName(entry.name);
      if (!parsed) continue;
      discoveredSourceFiles += 1;
      const relativePath = normalizeRelativePath(relative(options.scanPath, absolutePath));
      if (isExcludedCadSourceRelativePath(relativePath)) {
        incrementExcluded(excludedSourceCounts, 'excludedPath');
        continue;
      }

      let sourceStat;
      try {
        sourceStat = await stat(absolutePath);
      } catch {
        incrementExcluded(excludedSourceCounts, 'statError');
        continue;
      }
      if (!isCadSourceCandidateFile(entry.name, sourceStat.size)) {
        incrementExcluded(excludedSourceCounts, sourceStat.size <= 0 ? 'emptyFile' : 'temporaryFile');
        continue;
      }

      const rasterPath = resolveCompanionImagePath(
        absolutePath, existsSync, dirname, basename, join, extname,
      ) ?? findSameStemCompanion(absolutePath, directoryNames, ['.jpg', '.jpeg', '.png']);
      const stlPath = resolveCompanionStlPath(
        absolutePath, existsSync, dirname, basename, join, extname,
      ) ?? findSameStemCompanion(absolutePath, directoryNames, ['.stl']);
      const slddrwPath = findSameStemCompanion(absolutePath, directoryNames, ['.slddrw']);
      const pdfPath = findSameStemCompanion(absolutePath, directoryNames, ['.pdf']);
      const hasLocalDrawing = slddrwPath !== null;
      const eligible = parsed.sourceKind === 'edrawings' || hasLocalDrawing || options.includeUnpaired;

      usableCandidates.push({
        relativePath,
        absolutePath: resolvePath(absolutePath),
        fileName: entry.name,
        sourceKind: parsed.sourceKind,
        extension: parsed.extension,
        basePartNumber: parsed.basePartNumber,
        isoPartNumber: buildIsoPartNumber(parsed.basePartNumber),
        embeddedRevision: parsed.embeddedRevision,
        sizeBytes: sourceStat.size,
        modifiedAtUTC: sourceStat.mtime.toISOString(),
        modifiedAtMs: sourceStat.mtimeMs,
        companions: {
          slddrw: slddrwPath ? toManifestPath(options.scanPath, slddrwPath) : null,
          pdf: pdfPath ? toManifestPath(options.scanPath, pdfPath) : null,
          raster: rasterPath ? toManifestPath(options.scanPath, rasterPath) : null,
          stl: stlPath ? toManifestPath(options.scanPath, stlPath) : null,
        },
        hasLocalDrawing,
        eligible,
        active: false,
        processingStatus: 'pending',
        processingMessage: null,
        exportDiagnostics: null,
        cadProcessingStatus: 'pending',
        cadProcessingMessage: null,
        cadExportDiagnostics: null,
      });
    }
  }

  await walk(options.scanPath);
  return { discoveredSourceFiles, usableCandidates, excludedSourceCounts };
}

/**
 * Pieza que tiene plano acotado (`.slddrw`, opcionalmente con `.pdf`
 * companion) pero NINGÚN modelo 3D (`.sldprt`/`.easm`/`.eprt`) en el scan —
 * invisible para `discoverCadSources` porque esa función solo camina a
 * partir de archivos de modelo. Sin modelo no hay ISO posible para esta
 * pieza, pero sí puede tener CAD.
 */
interface CadOnlySource {
  relativePath: string;
  basePartNumber: string;
  embeddedRevision: string | null;
  companions: { pdf: CompanionPath | null; slddrw: CompanionPath | null };
  cadProcessingStatus: ProcessingStatus;
  cadProcessingMessage: string | null;
  cadExportDiagnostics: string | null;
}

/**
 * Nota sobre `--limit`: a diferencia de `selectCandidates` (que acota los
 * candidatos ISO por modelo 3D), esta función no respeta `--limit` — el CAD
 * huérfano es una corrida aparte y barata (no compite por el cupo del
 * batch de isométricas).
 */
async function discoverCadOnlySources(
  options: CliOptions,
  alreadyCoveredBaseNumbers: ReadonlySet<string>,
): Promise<CadOnlySource[]> {
  const bySlddrwBase = new Map<string, { relativePath: string; absolutePath: string; embeddedRevision: string | null }>();

  async function walk(current: string): Promise<void> {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of [...entries].sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0))) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const parsed = parseCadDrawingFileName(entry.name);
      if (!parsed) continue;
      const relativePath = normalizeRelativePath(relative(options.scanPath, absolutePath));
      if (isExcludedCadSourceRelativePath(relativePath)) continue;
      if (alreadyCoveredBaseNumbers.has(parsed.basePartNumber)) continue;
      if (bySlddrwBase.has(parsed.basePartNumber)) continue; // primer .slddrw encontrado gana
      bySlddrwBase.set(parsed.basePartNumber, {
        relativePath,
        absolutePath: resolvePath(absolutePath),
        embeddedRevision: parsed.embeddedRevision,
      });
    }
  }
  await walk(options.scanPath);

  const results: CadOnlySource[] = [];
  for (const [basePartNumber, slddrw] of bySlddrwBase) {
    const dir = dirname(slddrw.absolutePath);
    const directoryNames = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    const pdfPath = findSameStemCompanion(slddrw.absolutePath, directoryNames, ['.pdf']);
    results.push({
      relativePath: slddrw.relativePath,
      basePartNumber,
      embeddedRevision: slddrw.embeddedRevision,
      companions: {
        pdf: pdfPath ? toManifestPath(options.scanPath, pdfPath) : null,
        slddrw: toManifestPath(options.scanPath, slddrw.absolutePath),
      },
      cadProcessingStatus: 'pending',
      cadProcessingMessage: null,
      cadExportDiagnostics: null,
    });
  }
  return results;
}

function selectCandidates(
  usableCandidates: readonly DiscoveredCadSource[],
  limit: number | null,
): {
  selected: DiscoveredCadSource[];
  nonselected: NonselectedCandidate[];
  duplicatePartGroups: number;
  eligibleCandidates: number;
} {
  const groups = new Map<string, DiscoveredCadSource[]>();
  const nonselected: NonselectedCandidate[] = [];
  for (const candidate of usableCandidates) {
    if (!candidate.eligible) {
      nonselected.push({ ...candidate, nonselectionReason: 'solidworks-without-local-drawing' });
      continue;
    }
    const group = groups.get(candidate.basePartNumber) ?? [];
    group.push(candidate);
    groups.set(candidate.basePartNumber, group);
  }

  const winners: DiscoveredCadSource[] = [];
  let duplicatePartGroups = 0;
  let eligibleCandidates = 0;
  for (const partNumber of [...groups.keys()].sort()) {
    const group = groups.get(partNumber) ?? [];
    eligibleCandidates += group.length;
    if (group.length > 1) duplicatePartGroups += 1;
    const ranked = [
      ...rankCadSourceCandidates(group.filter((candidate) => candidate.hasLocalDrawing)),
      ...rankCadSourceCandidates(group.filter((candidate) => !candidate.hasLocalDrawing)),
    ];
    const [winner, ...duplicates] = ranked;
    if (winner) winners.push(winner);
    for (const duplicate of duplicates) {
      nonselected.push({ ...duplicate, nonselectionReason: 'duplicate-lower-ranked' });
    }
  }

  const selected = limit === null ? winners : winners.slice(0, limit);
  for (const candidate of limit === null ? [] : winners.slice(limit)) {
    nonselected.push({ ...candidate, nonselectionReason: 'limit-exceeded' });
  }
  for (const candidate of selected) candidate.active = true;
  nonselected.sort((left, right) => {
    if (left.basePartNumber !== right.basePartNumber) {
      return left.basePartNumber < right.basePartNumber ? -1 : 1;
    }
    return left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0;
  });
  return { selected, nonselected, duplicatePartGroups, eligibleCandidates };
}

function emptySummary(): ManifestSummary {
  return {
    discoveredSourceFiles: 0,
    usableCandidates: 0,
    eligibleCandidates: 0,
    selectedCandidates: 0,
    nonselectedUsableCandidates: 0,
    duplicatePartGroups: 0,
    excludedSources: 0,
    inventoryOnly: 0,
    dryRunReady: 0,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    cadInventoryOnly: 0,
    cadDryRunReady: 0,
    cadUploaded: 0,
    cadSkipped: 0,
    cadFailed: 0,
    cadOnlySourcesFound: 0,
  };
}

function createManifest(options: CliOptions): ImportManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAtUTC: new Date().toISOString(),
    scanRoot: options.scanPath,
    options: {
      customer: options.customer,
      storageBucket: options.storageBucket,
      exporter: options.exporterPath,
      workDir: options.workDir,
      dryRun: options.dryRun,
      includeUnpaired: options.includeUnpaired,
      includeStl: options.includeStl,
      skipCad: options.skipCad,
      limit: options.limit,
    },
    summary: emptySummary(),
    excludedSourceCounts: {
      total: 0,
      excludedPath: 0,
      emptyFile: 0,
      temporaryFile: 0,
      statError: 0,
    },
    selectedCandidates: [],
    nonselectedUsableCandidates: [],
    cadOnlySources: [],
    fatalErrorCategory: null,
    fatalError: null,
  };
}

function createStartupManifest(args: readonly string[]): ImportManifest {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedAtUTC: new Date().toISOString(),
    scanRoot: null,
    options: {
      customer: null,
      storageBucket: null,
      exporter: null,
      workDir: null,
      dryRun: args.includes('--dryRun') || args.includes('--dry-run'),
      includeUnpaired: args.includes('--includeUnpaired'),
      includeStl: args.includes('--includeStl'),
      skipCad: args.includes('--skipCad'),
      limit: null,
    },
    summary: emptySummary(),
    excludedSourceCounts: {
      total: 0,
      excludedPath: 0,
      emptyFile: 0,
      temporaryFile: 0,
      statError: 0,
    },
    selectedCandidates: [],
    nonselectedUsableCandidates: [],
    cadOnlySources: [],
    fatalErrorCategory: null,
    fatalError: null,
  };
}

function refreshProcessingSummary(manifest: ImportManifest): void {
  manifest.summary.inventoryOnly = 0;
  manifest.summary.dryRunReady = 0;
  manifest.summary.uploaded = 0;
  manifest.summary.skipped = 0;
  manifest.summary.failed = 0;
  manifest.summary.cadInventoryOnly = 0;
  manifest.summary.cadDryRunReady = 0;
  manifest.summary.cadUploaded = 0;
  manifest.summary.cadSkipped = 0;
  manifest.summary.cadFailed = 0;
  for (const candidate of manifest.selectedCandidates) {
    if (candidate.processingStatus === 'inventory-only') manifest.summary.inventoryOnly += 1;
    else if (candidate.processingStatus === 'dry-run-ready') manifest.summary.dryRunReady += 1;
    else if (candidate.processingStatus === 'uploaded') manifest.summary.uploaded += 1;
    else if (candidate.processingStatus === 'skipped') manifest.summary.skipped += 1;
    else if (candidate.processingStatus === 'failed') manifest.summary.failed += 1;

    if (candidate.cadProcessingStatus === 'inventory-only') manifest.summary.cadInventoryOnly += 1;
    else if (candidate.cadProcessingStatus === 'dry-run-ready') manifest.summary.cadDryRunReady += 1;
    else if (candidate.cadProcessingStatus === 'uploaded') manifest.summary.cadUploaded += 1;
    else if (candidate.cadProcessingStatus === 'skipped') manifest.summary.cadSkipped += 1;
    else if (candidate.cadProcessingStatus === 'failed') manifest.summary.cadFailed += 1;
  }

  manifest.summary.cadOnlySourcesFound = manifest.cadOnlySources.length;
  for (const item of manifest.cadOnlySources) {
    if (item.cadProcessingStatus === 'inventory-only') manifest.summary.cadInventoryOnly += 1;
    else if (item.cadProcessingStatus === 'dry-run-ready') manifest.summary.cadDryRunReady += 1;
    else if (item.cadProcessingStatus === 'uploaded') manifest.summary.cadUploaded += 1;
    else if (item.cadProcessingStatus === 'skipped') manifest.summary.cadSkipped += 1;
    else if (item.cadProcessingStatus === 'failed') manifest.summary.cadFailed += 1;
  }
}

async function writeManifest(manifestPath: string, manifest: ImportManifest): Promise<void> {
  manifest.generatedAtUTC = new Date().toISOString();
  refreshProcessingSummary(manifest);
  mkdirSync(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.info(`[manifest] ${manifestPath}`);
}

async function initializeFirebase(options: CliOptions): Promise<FirebaseContext> {
  let modules;
  try {
    modules = await Promise.all([
      import('firebase-admin/app'),
      import('firebase-admin/firestore'),
      import('firebase-admin/storage'),
    ]);
  } catch {
    throw new PublicImportError(
      'firebase-initialization-failed',
      'No se pudo inicializar Firebase para el modo productivo.',
    );
  }

  const [{ applicationDefault, cert, getApps, initializeApp }, firestore, storage] = modules;
  try {
    if (getApps().length === 0) {
      let credential;
      if (options.credentialsPath) {
        try {
          const parsedCredential = JSON.parse(readFileSync(options.credentialsPath, 'utf8'));
          credential = cert(parsedCredential);
        } catch {
          throw new PublicImportError(
            'credentials-unavailable',
            'No se pudieron cargar las credenciales de Firebase.',
          );
        }
      } else {
        credential = applicationDefault();
      }
      initializeApp({ credential, storageBucket: options.storageBucket });
    }
    return {
      db: firestore.getFirestore(),
      getStorage: storage.getStorage,
      FieldValue: firestore.FieldValue,
    };
  } catch (error) {
    if (error instanceof PublicImportError) throw error;
    throw new PublicImportError(
      'firebase-initialization-failed',
      'No se pudo inicializar Firebase para el modo productivo.',
    );
  }
}

function tryExportWithExporter(
  exporterPath: string,
  inputFile: string,
  outDir: string,
  includeStl: boolean,
) {
  mkdirSync(outDir, { recursive: true });
  const ps1 = resolvePath(join('scripts', 'edrawings', 'Export-EDrawings.ps1'));
  return runCadExporter({
    exporter: exporterPath,
    nativeScriptPath: ps1,
    inputFile,
    outDir,
    formats: includeStl ? ['.jpg', '.stl'] : ['.jpg'],
  });
}

function resolveImageForItem(
  item: DiscoveredCadSource,
  exporterPath: string | null,
  workRoot: string,
  includeStl: boolean,
): { imagePath: string; exportedStlPath: string | null } | null {
  if (!includeStl && item.companions.raster) {
    return { imagePath: item.companions.raster.absolutePath, exportedStlPath: null };
  }
  if (includeStl && !exporterPath && item.companions.raster && item.companions.stl) {
    return { imagePath: item.companions.raster.absolutePath, exportedStlPath: null };
  }
  const outDir = join(workRoot, item.basePartNumber);
  const sourceStem = basename(item.absolutePath, extname(item.absolutePath));
  const reusableJpegPath = join(outDir, `${sourceStem}.jpg`);
  if (canReuseExistingJpeg({ sourcePath: item.absolutePath, jpegPath: reusableJpegPath, includeStl })) {
    item.exportDiagnostics = 'resume=reused-existing-jpg';
    console.info(`[resume] ${item.isoPartNumber} <- ${reusableJpegPath}`);
    return { imagePath: reusableJpegPath, exportedStlPath: null };
  }
  if (!exporterPath) return null;
  const attempt = tryExportWithExporter(exporterPath, item.absolutePath, outDir, includeStl);
  item.exportDiagnostics = attempt.diagnostics;
  if (!attempt.ok) {
    console.warn(`[exporter] ${item.relativePath}: ${attempt.diagnostics}`);
    return null;
  }
  if (attempt.jpgPath) {
    try {
      writeJpegProvenance(item.absolutePath, attempt.jpgPath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      item.exportDiagnostics = `${attempt.diagnostics} | provenance_warning=${message}`;
      console.warn(`[provenance] ${item.relativePath}: ${message}`);
    }
  }
  return attempt.jpgPath
    ? { imagePath: attempt.jpgPath, exportedStlPath: attempt.stlPath }
    : null;
}

async function upsertIsoDrawing(params: {
  firebase: FirebaseContext;
  customer: string;
  item: DiscoveredCadSource;
  pdfLocalPath: string;
  stlLocalPath: string | null | undefined;
}): Promise<void> {
  const { firebase, customer, item, pdfLocalPath, stlLocalPath } = params;
  const partId = buildPartDocId(customer, item.isoPartNumber);
  const drawingId = buildDrawingDocId(partId, EDRAWINGS_ISO_REVISION);
  const pdfBytes = await readFile(pdfLocalPath);
  const checksum = createHash('sha256').update(pdfBytes).digest('hex');
  const pdfStoragePath = `tool-crib/${customer}/${buildIsoPdfFileName(item.basePartNumber)}`;
  const pdfUrl = await uploadCatalogBytes(firebase, pdfStoragePath, pdfBytes, 'application/pdf');
  let stlUrl: string | null | undefined;
  if (stlLocalPath === null) stlUrl = null;
  if (stlLocalPath) {
    const stlBytes = await readFile(stlLocalPath);
    const path = `tool-crib/${customer}/${buildIsoStlFileName(item.basePartNumber)}`;
    stlUrl = await uploadCatalogBytes(firebase, path, stlBytes, 'model/stl');
  }

  await upsertCatalogPart(firebase, partId, {
    partNumber: item.isoPartNumber,
    customer,
    description: `ISO export CAD (${item.basePartNumber})`,
    status: 'active' as const,
    updatedAtUTC: firebase.FieldValue.serverTimestamp(),
  });

  const drawingPayload: Record<string, unknown> = {
    partId,
    revision: EDRAWINGS_ISO_REVISION,
    isActive: true,
    sourceType: 'storage',
    sourcePath: pdfLocalPath,
    pdfUrl,
    checksumSha256: checksum,
    effectiveFromUTC: null,
  };
  if (stlUrl !== undefined) drawingPayload.stlUrl = stlUrl;
  await upsertCatalogDrawing(firebase, drawingId, partId, drawingPayload, CREATED_BY_UID);
}

type CadPdfResolution =
  | { kind: 'existing-companion-pdf'; pdfPath: string }
  | { kind: 'exported-from-slddrw'; jpegPath: string };

/**
 * Forma mínima que necesita el flujo CAD — satisfecha estructuralmente por
 * `DiscoveredCadSource` (pieza con modelo 3D) y por `CadOnlySource` (pieza
 * sin modelo, solo plano acotado). El CAD no depende de si hay ISO o no.
 */
interface CadSourceLike {
  basePartNumber: string;
  embeddedRevision: string | null;
  companions: { pdf: CompanionPath | null; slddrw: CompanionPath | null };
  cadExportDiagnostics: string | null;
}

/**
 * Resuelve la fuente del plano acotado (CAD) de una pieza: un PDF companion
 * real (ya dimensionado, junto al modelo 3D) si existe, o el `.slddrw`
 * companion exportado en modo `flat` (sin isométrica forzada). A diferencia
 * de la isométrica, el CAD no tiene fallback IA — sin uno de estos dos,
 * la pieza queda sin plano acotado en el catálogo.
 */
function resolveCadSourceForItem(
  item: CadSourceLike,
  exporterPath: string | null,
  workRoot: string,
): CadPdfResolution | null {
  if (item.companions.pdf) {
    return { kind: 'existing-companion-pdf', pdfPath: item.companions.pdf.absolutePath };
  }
  if (!item.companions.slddrw) {
    return null;
  }

  // Subcarpeta propia: el .slddrw casi siempre comparte stem con el modelo 3D
  // (p.ej. "273-17-04167.SLDPRT" + "273-17-04167.SLDDRW"), y el exportador
  // nombra su salida por ese stem — sin este aislamiento, el JPEG/sidecar del
  // CAD y el de la ISO se pisarían entre sí en el mismo directorio.
  const outDir = join(workRoot, item.basePartNumber, 'cad');
  const sourceStem = basename(item.companions.slddrw.absolutePath, extname(item.companions.slddrw.absolutePath));
  const reusableJpegPath = join(outDir, `${sourceStem}.jpg`);
  if (canReuseExistingJpeg({ sourcePath: item.companions.slddrw.absolutePath, jpegPath: reusableJpegPath, includeStl: false })) {
    item.cadExportDiagnostics = 'resume=reused-existing-cad-jpg';
    console.info(`[resume] ${item.basePartNumber} (CAD) <- ${reusableJpegPath}`);
    return { kind: 'exported-from-slddrw', jpegPath: reusableJpegPath };
  }
  if (!exporterPath) return null;

  mkdirSync(outDir, { recursive: true });
  const ps1 = resolvePath(join('scripts', 'edrawings', 'Export-EDrawings.ps1'));
  const attempt = runCadExporter({
    exporter: exporterPath,
    nativeScriptPath: ps1,
    inputFile: item.companions.slddrw.absolutePath,
    outDir,
    formats: ['.jpg'],
    viewMode: 'flat',
  });
  item.cadExportDiagnostics = attempt.diagnostics;
  if (!attempt.ok || !attempt.jpgPath) {
    console.warn(`[exporter-cad] ${item.companions.slddrw.relativePath}: ${attempt.diagnostics}`);
    return null;
  }
  try {
    writeJpegProvenance(item.companions.slddrw.absolutePath, attempt.jpgPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    item.cadExportDiagnostics = `${attempt.diagnostics} | provenance_warning=${message}`;
    console.warn(`[provenance-cad] ${item.companions.slddrw.relativePath}: ${message}`);
  }
  return { kind: 'exported-from-slddrw', jpegPath: attempt.jpgPath };
}

async function upsertCadDrawing(params: {
  firebase: FirebaseContext;
  customer: string;
  item: CadSourceLike;
  pdfLocalPath: string;
}): Promise<void> {
  const { firebase, customer, item, pdfLocalPath } = params;
  const partId = buildPartDocId(customer, item.basePartNumber);
  const revision = item.embeddedRevision ?? 'CAD';
  const drawingId = buildDrawingDocId(partId, revision);
  const pdfBytes = await readFile(pdfLocalPath);
  const checksum = createHash('sha256').update(pdfBytes).digest('hex');
  const pdfStoragePath = `tool-crib/${customer}/${buildCadPdfFileName(item.basePartNumber)}`;
  const pdfUrl = await uploadCatalogBytes(firebase, pdfStoragePath, pdfBytes, 'application/pdf');

  await upsertCatalogPart(firebase, partId, {
    partNumber: item.basePartNumber,
    customer,
    description: `CAD (${item.basePartNumber})`,
    status: 'active' as const,
    updatedAtUTC: firebase.FieldValue.serverTimestamp(),
  });

  await upsertCatalogDrawing(firebase, drawingId, partId, {
    partId,
    revision,
    isActive: true,
    sourceType: 'storage',
    sourcePath: pdfLocalPath,
    pdfUrl,
    checksumSha256: checksum,
    effectiveFromUTC: null,
  }, CREATED_BY_UID_CAD);
}

/** CAD para piezas sin modelo 3D — mismo resolve/upsert que el flujo normal, sin rama ISO. */
async function processCadOnlySources(
  options: CliOptions,
  items: CadOnlySource[],
  workRoot: string,
  firebase: FirebaseContext | null,
): Promise<void> {
  for (const item of items) {
    try {
      const cadResolution = resolveCadSourceForItem(item, options.exporterPath, workRoot);
      if (!cadResolution) {
        item.cadProcessingStatus = options.dryRun ? 'inventory-only' : 'skipped';
        item.cadProcessingMessage = options.exporterPath
          ? 'El exportador no produjo un raster utilizable para el plano acotado.'
          : 'Hay .slddrw pero no companion .pdf ni exportador; CAD conservado como inventario.';
        console.info(`[${item.cadProcessingStatus}-cad-only] ${item.basePartNumber} <- ${item.relativePath}`);
        continue;
      }

      const cadOutDir = join(workRoot, item.basePartNumber);
      mkdirSync(cadOutDir, { recursive: true });
      const cadPdfLocalPath = join(cadOutDir, buildCadPdfFileName(item.basePartNumber));
      if (cadResolution.kind === 'existing-companion-pdf') {
        await copyFile(cadResolution.pdfPath, cadPdfLocalPath);
      } else {
        await writeFile(cadPdfLocalPath, await wrapImageFileAsPdfBytes(cadResolution.jpegPath));
      }

      if (options.dryRun) {
        item.cadProcessingStatus = 'dry-run-ready';
        item.cadProcessingMessage = cadResolution.kind === 'existing-companion-pdf'
          ? 'PDF local copiado desde companion existente; Firebase no fue cargado.'
          : 'PDF local generado desde plano acotado (.slddrw); Firebase no fue cargado.';
      } else {
        if (!firebase) throw new Error('Firebase no fue inicializado para modo produccion.');
        await upsertCadDrawing({ firebase, customer: options.customer, item, pdfLocalPath: cadPdfLocalPath });
        item.cadProcessingStatus = 'uploaded';
        item.cadProcessingMessage = cadResolution.kind === 'existing-companion-pdf'
          ? 'CAD (PDF companion existente) procesado.'
          : 'CAD (plano acotado exportado desde .slddrw) procesado.';
      }
      console.info(`[${item.cadProcessingStatus}-cad-only] ${item.basePartNumber} <- ${item.relativePath}`);
    } catch (error) {
      item.cadProcessingStatus = 'failed';
      item.cadProcessingMessage = error instanceof Error ? error.message : String(error);
      console.error(`[fail-cad-only] ${item.basePartNumber}: ${item.cadProcessingMessage}`);
    }
  }
}

async function processSelectedCandidates(options: CliOptions, selected: DiscoveredCadSource[]): Promise<void> {
  const workRoot = options.workDir ?? join(options.scanPath, '_iso_export');
  const firebase = !options.dryRun && selected.length > 0 ? await initializeFirebase(options) : null;

  for (const item of selected) {
    try {
      const resolvedImage = resolveImageForItem(
        item,
        options.exporterPath,
        workRoot,
        options.includeStl,
      );
      if (!resolvedImage) {
        item.processingStatus = options.dryRun ? 'inventory-only' : 'skipped';
        item.processingMessage = options.exporterPath
          ? 'El exportador no produjo un raster utilizable.'
          : 'Sin raster companion ni exportador; candidato conservado como inventario.';
        console.info(`[${item.processingStatus}] ${item.isoPartNumber} <- ${item.relativePath}`);
      } else {
      const { imagePath, exportedStlPath } = resolvedImage;

      const pdfOutDir = join(workRoot, item.basePartNumber);
      mkdirSync(pdfOutDir, { recursive: true });
      const pdfLocalPath = join(pdfOutDir, buildIsoPdfFileName(item.basePartNumber));
      await writeFile(pdfLocalPath, await wrapImageFileAsPdfBytes(imagePath));
      const stlLocalPath = options.includeStl
        ? options.exporterPath ? exportedStlPath : item.companions.stl?.absolutePath ?? null
        : undefined;
      if (options.dryRun) {
        item.processingStatus = 'dry-run-ready';
        item.processingMessage = `PDF local generado desde ${imagePath}; Firebase no fue cargado.`;
      } else {
        if (!firebase) throw new Error('Firebase no fue inicializado para modo produccion.');
        await upsertIsoDrawing({ firebase, customer: options.customer, item, pdfLocalPath, stlLocalPath });
        item.processingStatus = 'uploaded';
        item.processingMessage = !options.includeStl
          ? 'PDF procesado; STL no solicitado.'
          : stlLocalPath
            ? 'PDF y STL procesados.'
            : 'PDF procesado; sin STL.';
      }
      console.info(`[${item.processingStatus}] ${item.isoPartNumber} <- ${item.relativePath}`);
      }
    } catch (error) {
      item.processingStatus = 'failed';
      item.processingMessage = error instanceof Error ? error.message : String(error);
      console.error(`[fail] ${item.basePartNumber}: ${item.processingMessage}`);
    }

    // Plano acotado (CAD) — independiente de la isométrica: una pieza puede
    // tener ISO sin CAD (sin .slddrw ni PDF companion en el scan) o viceversa.
    if (options.skipCad) continue;
    try {
      const cadResolution = resolveCadSourceForItem(item, options.exporterPath, workRoot);
      if (!cadResolution) {
        item.cadProcessingStatus = options.dryRun ? 'inventory-only' : 'skipped';
        item.cadProcessingMessage = item.companions.slddrw
          ? (options.exporterPath
              ? 'El exportador no produjo un raster utilizable para el plano acotado.'
              : 'Hay .slddrw pero no companion .pdf ni exportador; CAD conservado como inventario.')
          : 'Sin companion .pdf ni .slddrw; esta pieza no tiene plano acotado en el scan.';
        console.info(`[${item.cadProcessingStatus}-cad] ${item.basePartNumber} <- ${item.relativePath}`);
        continue;
      }

      const cadOutDir = join(workRoot, item.basePartNumber);
      mkdirSync(cadOutDir, { recursive: true });
      const cadPdfLocalPath = join(cadOutDir, buildCadPdfFileName(item.basePartNumber));
      if (cadResolution.kind === 'existing-companion-pdf') {
        await copyFile(cadResolution.pdfPath, cadPdfLocalPath);
      } else {
        await writeFile(cadPdfLocalPath, await wrapImageFileAsPdfBytes(cadResolution.jpegPath));
      }

      if (options.dryRun) {
        item.cadProcessingStatus = 'dry-run-ready';
        item.cadProcessingMessage = cadResolution.kind === 'existing-companion-pdf'
          ? 'PDF local copiado desde companion existente; Firebase no fue cargado.'
          : 'PDF local generado desde plano acotado (.slddrw); Firebase no fue cargado.';
      } else {
        if (!firebase) throw new Error('Firebase no fue inicializado para modo produccion.');
        await upsertCadDrawing({ firebase, customer: options.customer, item, pdfLocalPath: cadPdfLocalPath });
        item.cadProcessingStatus = 'uploaded';
        item.cadProcessingMessage = cadResolution.kind === 'existing-companion-pdf'
          ? 'CAD (PDF companion existente) procesado.'
          : 'CAD (plano acotado exportado desde .slddrw) procesado.';
      }
      console.info(`[${item.cadProcessingStatus}-cad] ${item.basePartNumber} <- ${item.relativePath}`);
    } catch (error) {
      item.cadProcessingStatus = 'failed';
      item.cadProcessingMessage = error instanceof Error ? error.message : String(error);
      console.error(`[fail-cad] ${item.basePartNumber}: ${item.cadProcessingMessage}`);
    }
  }
}

async function run(): Promise<void> {
  const args = argv.slice(2);
  let manifestPath = extractRawManifestPath(args);
  let manifest = createStartupManifest(args);
  let options: CliOptions;

  try {
    options = parseCliOptions(args);
    manifestPath = options.manifestPath ?? manifestPath;
    manifest = createManifest(options);
    if (!existsSync(options.scanPath)) {
      throw new PublicImportError('scan-failed', 'El directorio indicado por --scan no existe.');
    }
    const discovery = await discoverCadSources(options);
    const selection = selectCandidates(discovery.usableCandidates, options.limit);
    manifest.excludedSourceCounts = discovery.excludedSourceCounts;
    manifest.selectedCandidates = selection.selected;
    manifest.nonselectedUsableCandidates = selection.nonselected;
    manifest.summary = {
      ...emptySummary(),
      discoveredSourceFiles: discovery.discoveredSourceFiles,
      usableCandidates: discovery.usableCandidates.length,
      eligibleCandidates: selection.eligibleCandidates,
      selectedCandidates: selection.selected.length,
      nonselectedUsableCandidates: selection.nonselected.length,
      duplicatePartGroups: selection.duplicatePartGroups,
      excludedSources: discovery.excludedSourceCounts.total,
    };
    console.info(
      `[toolcribEdrawingsIso] discovered=${discovery.discoveredSourceFiles} ` +
        `usable=${discovery.usableCandidates.length} selected=${selection.selected.length} ` +
        `excluded=${discovery.excludedSourceCounts.total}`,
    );
    await processSelectedCandidates(options, selection.selected);

    if (!options.skipCad) {
      const coveredBaseNumbers = new Set(selection.selected.map((candidate) => candidate.basePartNumber));
      const cadOnlySources = await discoverCadOnlySources(options, coveredBaseNumbers);
      manifest.cadOnlySources = cadOnlySources;
      if (cadOnlySources.length > 0) {
        console.info(`[toolcribEdrawingsIso] CAD-only (sin modelo 3D): ${cadOnlySources.length} encontradas`);
        const workRoot = options.workDir ?? join(options.scanPath, '_iso_export');
        const firebaseForCadOnly = !options.dryRun ? await initializeFirebase(options) : null;
        await processCadOnlySources(options, cadOnlySources, workRoot, firebaseForCadOnly);
      }
    }
  } catch (error) {
    const failure = toPublicFailure(error);
    manifest.fatalErrorCategory = failure.category;
    manifest.fatalError = failure.message;
    if (manifestPath) await writeManifest(manifestPath, manifest);
    throw new PublicImportError(failure.category, failure.message);
  }

  if (manifestPath) await writeManifest(manifestPath, manifest);
  refreshProcessingSummary(manifest);
  console.info(
    `[toolcribEdrawingsIso] ${options.dryRun ? '[dryRun] ' : ''}listo. ` +
      `selected=${manifest.summary.selectedCandidates} inventoryOnly=${manifest.summary.inventoryOnly} ` +
      `ready=${manifest.summary.dryRunReady} uploaded=${manifest.summary.uploaded} ` +
      `skipped=${manifest.summary.skipped} failed=${manifest.summary.failed}`,
  );
  if (!options.skipCad) {
    console.info(
      `[toolcribEdrawingsIso] CAD (incl. ${manifest.summary.cadOnlySourcesFound} sin modelo 3D): ` +
        `inventoryOnly=${manifest.summary.cadInventoryOnly} ready=${manifest.summary.cadDryRunReady} ` +
        `uploaded=${manifest.summary.cadUploaded} skipped=${manifest.summary.cadSkipped} failed=${manifest.summary.cadFailed}`,
    );
  }
}

run().catch((error: unknown) => {
  const failure = toPublicFailure(error);
  console.error(`[toolcribEdrawingsIso] abort [${failure.category}]: ${failure.message}`);
  process.exitCode = 1;
});

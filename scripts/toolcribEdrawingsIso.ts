/**
 * Inventario/exportador de fuentes CAD para las isometricas de Tool Crib.
 * El dry-run es offline: no carga ni inicializa Firebase Admin.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, extname, join, relative, resolve as resolvePath } from 'node:path';
import { argv } from 'node:process';

import {
  buildIsoPartNumber,
  buildIsoPdfFileName,
  buildIsoStlFileName,
  EDRAWINGS_ISO_REVISION,
  isCadSourceCandidateFile,
  isExcludedCadSourceRelativePath,
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

const PARTS_COLLECTION = 'toolcribParts';
const DRAWINGS_COLLECTION = 'toolcribDrawings';
const CREATED_BY_UID = 'edrawings-iso-v1';
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
    limit: number | null;
  };
  summary: ManifestSummary;
  excludedSourceCounts: ExcludedSourceCounts;
  selectedCandidates: DiscoveredCadSource[];
  nonselectedUsableCandidates: NonselectedCandidate[];
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

interface FirebaseContext {
  db: import('firebase-admin/firestore').Firestore;
  getStorage: typeof import('firebase-admin/storage').getStorage;
  FieldValue: typeof import('firebase-admin/firestore').FieldValue;
}

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
      });
    }
  }

  await walk(options.scanPath);
  return { discoveredSourceFiles, usableCandidates, excludedSourceCounts };
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
  for (const candidate of manifest.selectedCandidates) {
    if (candidate.processingStatus === 'inventory-only') manifest.summary.inventoryOnly += 1;
    else if (candidate.processingStatus === 'dry-run-ready') manifest.summary.dryRunReady += 1;
    else if (candidate.processingStatus === 'uploaded') manifest.summary.uploaded += 1;
    else if (candidate.processingStatus === 'skipped') manifest.summary.skipped += 1;
    else if (candidate.processingStatus === 'failed') manifest.summary.failed += 1;
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

function buildPartDocId(customer: string, partNumber: string): string {
  const digest = createHash('sha1')
    .update(`${customer.toUpperCase()}::${partNumber.toUpperCase()}`)
    .digest('hex')
    .slice(0, 16);
  return `part_${digest}`;
}

function buildDrawingDocId(partId: string, revision: string): string {
  const digest = createHash('sha1')
    .update(`${partId}::${revision.toUpperCase()}`)
    .digest('hex')
    .slice(0, 20);
  return `drw_${digest}`;
}

function buildFirebaseStorageUrl(bucket: string, path: string, token: string): string {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
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

async function uploadBytes(
  firebase: FirebaseContext,
  storagePath: string,
  bytes: Buffer | Uint8Array,
  contentType: string,
): Promise<string> {
  const bucket = firebase.getStorage().bucket();
  const token = randomUUID();
  await bucket.file(storagePath).save(Buffer.from(bytes), {
    contentType,
    metadata: { metadata: { firebaseStorageDownloadTokens: token } },
  });
  return buildFirebaseStorageUrl(bucket.name, storagePath, token);
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
  const pdfUrl = await uploadBytes(firebase, pdfStoragePath, pdfBytes, 'application/pdf');
  let stlUrl: string | null | undefined;
  if (stlLocalPath === null) stlUrl = null;
  if (stlLocalPath) {
    const stlBytes = await readFile(stlLocalPath);
    const path = `tool-crib/${customer}/${buildIsoStlFileName(item.basePartNumber)}`;
    stlUrl = await uploadBytes(firebase, path, stlBytes, 'model/stl');
  }

  const partRef = firebase.db.collection(PARTS_COLLECTION).doc(partId);
  const partExisting = await partRef.get();
  const partPayload = {
    partNumber: item.isoPartNumber,
    customer,
    description: `ISO export CAD (${item.basePartNumber})`,
    status: 'active' as const,
    updatedAtUTC: firebase.FieldValue.serverTimestamp(),
  };
  await partRef.set(
    partExisting.exists
      ? partPayload
      : { ...partPayload, createdAtUTC: firebase.FieldValue.serverTimestamp() },
    { merge: partExisting.exists },
  );

  const drawingRef = firebase.db.collection(DRAWINGS_COLLECTION).doc(drawingId);
  const drawingExisting = await drawingRef.get();
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
  await drawingRef.set(
    drawingExisting.exists
      ? drawingPayload
      : {
          ...drawingPayload,
          createdAtUTC: firebase.FieldValue.serverTimestamp(),
          createdByUid: CREATED_BY_UID,
        },
    { merge: drawingExisting.exists },
  );

  const activeDrawings = await firebase.db
    .collection(DRAWINGS_COLLECTION)
    .where('partId', '==', partId)
    .where('isActive', '==', true)
    .get();
  const batch = firebase.db.batch();
  activeDrawings.forEach((docSnap) => {
    if (docSnap.id !== drawingId) batch.set(docSnap.ref, { isActive: false }, { merge: true });
  });
  await batch.commit();
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
        continue;
      }
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
    } catch (error) {
      item.processingStatus = 'failed';
      item.processingMessage = error instanceof Error ? error.message : String(error);
      console.error(`[fail] ${item.basePartNumber}: ${item.processingMessage}`);
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
}

run().catch((error: unknown) => {
  const failure = toPublicFailure(error);
  console.error(`[toolcribEdrawingsIso] abort [${failure.category}]: ${failure.message}`);
  process.exitCode = 1;
});

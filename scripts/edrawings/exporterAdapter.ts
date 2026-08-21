import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, extname, join, resolve as resolvePath } from 'node:path';

export type ExporterMode = 'edrawings' | 'auto';
export type ExportFormat = '.jpg' | '.stl';

export interface ExportAttempt {
  ok: boolean;
  jpgPath: string | null;
  stlPath: string | null;
  diagnostics: string;
}

interface ExportCommand {
  executable: string;
  args: string[];
  timeoutMilliseconds: number;
  windowsHide: boolean;
}

interface FileInspection {
  size: number;
  modifiedAtMs: number;
  firstBytes: readonly number[];
  lastBytes: readonly number[];
}

interface ReusableArtifactDependencies {
  inspectFile: (path: string) => FileInspection | null;
  readTextFile: (path: string) => string | null;
  sha256File: (path: string) => string | null;
  canonicalPath: (path: string) => string;
}

interface JpegProvenanceDependencies {
  sha256File: (path: string) => string | null;
  canonicalPath: (path: string) => string;
  writeTextFileAtomically: (path: string, contents: string) => void;
}

interface SpawnResultLike {
  status: number | null;
  stdout: string | Buffer | null;
  stderr: string | Buffer | null;
  error?: Error;
  signal?: NodeJS.Signals | null;
}

interface ExporterAdapterDependencies {
  spawn: (
    executable: string,
    args: readonly string[],
    options: {
      encoding: 'utf8';
      windowsHide: boolean;
      timeout: number;
      maxBuffer: number;
    },
  ) => SpawnResultLike;
  removeFile: (path: string) => void;
  nonemptyFileSize: (path: string) => number | null;
}

const defaultDependencies: ExporterAdapterDependencies = {
  spawn: (executable, args, options) => spawnSync(executable, args, options),
  removeFile: (path) => rmSync(path, { force: true }),
  nonemptyFileSize: (path) => {
    try {
      const value = statSync(path);
      return value.isFile() && value.size > 0 ? value.size : null;
    } catch {
      return null;
    }
  },
};

function sha256File(path: string): string | null {
  let descriptor: number | null = null;
  try {
    descriptor = openSync(path, 'r');
    const digest = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let bytesRead = 0;
    do {
      bytesRead = readSync(descriptor, buffer, 0, buffer.length, null);
      if (bytesRead > 0) digest.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return digest.digest('hex');
  } catch {
    return null;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
  }
}

const defaultReusableArtifactDependencies: ReusableArtifactDependencies = {
  inspectFile: (path) => {
    let descriptor: number | null = null;
    try {
      const value = statSync(path);
      if (!value.isFile()) return null;
      const firstBytes = Buffer.alloc(2);
      const lastBytes = Buffer.alloc(2);
      if (value.size >= 2) {
        descriptor = openSync(path, 'r');
        readSync(descriptor, firstBytes, 0, 2, 0);
        readSync(descriptor, lastBytes, 0, 2, value.size - 2);
      }
      return {
        size: value.size,
        modifiedAtMs: value.mtimeMs,
        firstBytes: [...firstBytes],
        lastBytes: [...lastBytes],
      };
    } catch {
      return null;
    } finally {
      if (descriptor !== null) closeSync(descriptor);
    }
  },
  readTextFile: (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  },
  sha256File,
  canonicalPath: (path) => resolvePath(path),
};

const defaultJpegProvenanceDependencies: JpegProvenanceDependencies = {
  sha256File,
  canonicalPath: (path) => resolvePath(path),
  writeTextFileAtomically: (path, contents) => {
    const partialPath = `${path}.${randomUUID()}.partial`;
    try {
      writeFileSync(partialPath, contents, 'utf8');
      renameSync(partialPath, path);
    } catch (error) {
      rmSync(partialPath, { force: true });
      throw error;
    }
  },
};

interface JpegProvenance {
  schemaVersion: 1;
  sourcePath: string;
  sourceSha256: string;
  jpegSha256: string;
}

function parseJpegProvenance(raw: string): JpegProvenance | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const record = value as Record<string, unknown>;
    if (
      record.schemaVersion !== 1
      || typeof record.sourcePath !== 'string'
      || typeof record.sourceSha256 !== 'string'
      || typeof record.jpegSha256 !== 'string'
    ) return null;
    return record as unknown as JpegProvenance;
  } catch {
    return null;
  }
}

export function isReusableJpegArtifact(
  sourcePath: string,
  jpegPath: string,
  dependencies: Partial<ReusableArtifactDependencies> = {},
): boolean {
  const inspectFile = dependencies.inspectFile ?? defaultReusableArtifactDependencies.inspectFile;
  const readTextFile = dependencies.readTextFile ?? defaultReusableArtifactDependencies.readTextFile;
  const hashFile = dependencies.sha256File ?? defaultReusableArtifactDependencies.sha256File;
  const canonicalPath = dependencies.canonicalPath ?? defaultReusableArtifactDependencies.canonicalPath;
  const source = inspectFile(sourcePath);
  const jpeg = inspectFile(jpegPath);
  const validJpeg = source !== null
    && source.size > 0
    && jpeg !== null
    && jpeg.size >= 4
    && jpeg.modifiedAtMs >= source.modifiedAtMs
    && jpeg.firstBytes[0] === 0xff
    && jpeg.firstBytes[1] === 0xd8
    && jpeg.lastBytes[0] === 0xff
    && jpeg.lastBytes[1] === 0xd9;
  if (!validJpeg) return false;

  const provenanceRaw = readTextFile(`${jpegPath}.source.json`);
  const provenance = provenanceRaw === null ? null : parseJpegProvenance(provenanceRaw);
  if (!provenance) return false;
  const sourceSha256 = hashFile(sourcePath);
  const jpegSha256 = hashFile(jpegPath);
  return sourceSha256 !== null
    && jpegSha256 !== null
    && provenance.sourcePath === canonicalPath(sourcePath)
    && provenance.sourceSha256 === sourceSha256
    && provenance.jpegSha256 === jpegSha256;
}

export function canReuseExistingJpeg(
  params: { sourcePath: string; jpegPath: string; includeStl: boolean },
  dependencies: Partial<ReusableArtifactDependencies> = {},
): boolean {
  if (params.includeStl) return false;
  return isReusableJpegArtifact(params.sourcePath, params.jpegPath, dependencies);
}

export function writeJpegProvenance(
  sourcePath: string,
  jpegPath: string,
  dependencies: JpegProvenanceDependencies = defaultJpegProvenanceDependencies,
): void {
  const sourceSha256 = dependencies.sha256File(sourcePath);
  const jpegSha256 = dependencies.sha256File(jpegPath);
  if (!sourceSha256 || !jpegSha256) {
    throw new Error('No se pudo calcular la procedencia del JPEG exportado.');
  }
  const provenance: JpegProvenance = {
    schemaVersion: 1,
    sourcePath: dependencies.canonicalPath(sourcePath),
    sourceSha256,
    jpegSha256,
  };
  dependencies.writeTextFileAtomically(
    `${jpegPath}.source.json`,
    `${JSON.stringify(provenance, null, 2)}\n`,
  );
}

function normalizeFormats(formats?: readonly ExportFormat[]): ExportFormat[] {
  const requested = new Set<ExportFormat>(formats ?? ['.jpg']);
  requested.add('.jpg');
  return ['.jpg', ...(requested.has('.stl') ? ['.stl' as const] : [])];
}

export function normalizeExporterOption(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const keyword = trimmed.toLowerCase();
  if (keyword === 'edrawings' || keyword === 'auto') return keyword;
  return resolvePath(trimmed);
}

export function buildExporterCommand(params: {
  exporter: string;
  nativeScriptPath: string;
  inputFile: string;
  outDir: string;
  timeoutSeconds?: number;
  formats?: readonly ExportFormat[];
}): ExportCommand {
  const timeoutSeconds = params.timeoutSeconds ?? 180;
  const formats = normalizeFormats(params.formats);
  // The native path starts a dedicated ActiveX host. Load and JPG each have a
  // bounded wait; optional STL receives its own shorter grace period.
  const parentTimeoutMilliseconds = (timeoutSeconds * 3 + 60) * 1000;
  if (params.exporter === 'edrawings' || params.exporter === 'auto') {
    return {
      executable: 'powershell.exe',
      args: [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-Sta',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        params.nativeScriptPath,
        '-InputFile',
        params.inputFile,
        '-OutDir',
        params.outDir,
        '-Formats',
        formats.join(','),
        '-TimeoutSeconds',
        String(timeoutSeconds),
      ],
      timeoutMilliseconds: parentTimeoutMilliseconds,
      windowsHide: false,
    };
  }
  return {
    executable: params.exporter,
    args: ['-input', params.inputFile, '-outdir', params.outDir, '-format', ...formats],
    timeoutMilliseconds: parentTimeoutMilliseconds,
    windowsHide: true,
  };
}

function textOutput(value: string | Buffer | null): string {
  if (value === null) return '';
  return typeof value === 'string' ? value.trim() : value.toString('utf8').trim();
}

function formatDiagnostics(exporter: string, result: SpawnResultLike): string {
  const parts = [
    `exporter=${exporter}`,
    `exit=${result.status === null ? 'none' : result.status}`,
  ];
  const stdout = textOutput(result.stdout);
  const stderr = textOutput(result.stderr);
  if (stdout) parts.push(`stdout=${stdout}`);
  if (stderr) parts.push(`stderr=${stderr}`);
  if (result.error) parts.push(`error=${result.error.message}`);
  if (result.signal) parts.push(`signal=${result.signal}`);
  return parts.join(' | ');
}

function expectedExportPaths(inputFile: string, outDir: string): { jpgPath: string; stlPath: string } {
  const sourceStem = basename(inputFile, extname(inputFile));
  return {
    jpgPath: join(outDir, `${sourceStem}.jpg`),
    stlPath: join(outDir, `${sourceStem}.stl`),
  };
}

export function runCadExporter(
  params: {
    exporter: string;
    nativeScriptPath: string;
    inputFile: string;
    outDir: string;
    timeoutSeconds?: number;
    formats?: readonly ExportFormat[];
  },
  dependencies: ExporterAdapterDependencies = defaultDependencies,
): ExportAttempt {
  const command = buildExporterCommand(params);
  const expected = expectedExportPaths(params.inputFile, params.outDir);
  const formats = normalizeFormats(params.formats);
  try {
    dependencies.removeFile(expected.jpgPath);
    if (formats.includes('.stl')) dependencies.removeFile(expected.stlPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      jpgPath: null,
      stlPath: null,
      diagnostics: `exporter=${params.exporter} | preflight_error=${message}`,
    };
  }

  let result: SpawnResultLike;
  try {
    result = dependencies.spawn(command.executable, command.args, {
      encoding: 'utf8',
      windowsHide: command.windowsHide,
      timeout: command.timeoutMilliseconds,
      maxBuffer: 10 * 1024 * 1024,
    });
  } catch (error) {
    result = {
      status: null,
      stdout: null,
      stderr: null,
      error: error instanceof Error ? error : new Error(String(error)),
    };
  }
  const jpgSize = dependencies.nonemptyFileSize(expected.jpgPath);
  const stlSize = formats.includes('.stl')
    ? dependencies.nonemptyFileSize(expected.stlPath)
    : null;
  return {
    ok: jpgSize !== null,
    jpgPath: jpgSize === null ? null : expected.jpgPath,
    stlPath: stlSize === null ? null : expected.stlPath,
    diagnostics: formatDiagnostics(params.exporter, result),
  };
}

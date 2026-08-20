/**
 * Validación de frontera para los documentos de la colección `analysisRuns`.
 *
 * Todos los datos que cruzan la frontera cliente -> Firestore DEBEN pasar por
 * `validateAnalysisRunInput`. Mantener este módulo libre de dependencias de
 * Firebase lo hace trivialmente testeable y reutilizable.
 */

import type { AnalysisMetrics, AnalysisRunSummary } from '../../types';

export type AnalysisRunStatus = 'success' | 'error';

export interface AnalysisRunClientInfo {
  userAgent: string;
  appVersion: string;
}

export interface AnalysisRunPromptVersions {
  order: string;
  blueprint: string;
  /** Presente cuando la corrida usó (o pudo usar) fallback de imagen 3D IA. */
  isoGen?: string;
}

export interface AnalysisRunDocumentHashes {
  orderReportSha256: string | null;
  blueprintSha256List: string[];
}

/**
 * Forma exacta del input que recibe el writer. Coincide 1:1 con el documento
 * que se escribirá en Firestore, excepto por `createdAt` que lo añade el
 * writer usando `serverTimestamp()` para trazabilidad UTC inquebrantable.
 */
export interface AnalysisRunRecordInput {
  userUid: string | null;
  status: AnalysisRunStatus;
  promptVersions: AnalysisRunPromptVersions;
  documentHashes: AnalysisRunDocumentHashes;
  summary: AnalysisRunSummary | null;
  metrics: AnalysisMetrics | null;
  errorMessage: string | null;
  clientInfo: AnalysisRunClientInfo;
}

export type ValidationIssue = { path: string; message: string };

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: ValidationIssue[] };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateClientInfo(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): AnalysisRunClientInfo | null {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: 'debe ser objeto' });
    return null;
  }
  const userAgent = raw.userAgent;
  const appVersion = raw.appVersion;
  if (typeof userAgent !== 'string') {
    issues.push({ path: `${path}.userAgent`, message: 'debe ser string' });
  }
  if (!isNonEmptyString(appVersion)) {
    issues.push({ path: `${path}.appVersion`, message: 'debe ser string no vacío' });
  }
  if (typeof userAgent !== 'string' || !isNonEmptyString(appVersion)) {
    return null;
  }
  return { userAgent, appVersion };
}

function validatePromptVersions(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): AnalysisRunPromptVersions | null {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: 'debe ser objeto' });
    return null;
  }
  const order = raw.order;
  const blueprint = raw.blueprint;
  if (!isNonEmptyString(order)) {
    issues.push({ path: `${path}.order`, message: 'debe ser string no vacío' });
  }
  if (!isNonEmptyString(blueprint)) {
    issues.push({ path: `${path}.blueprint`, message: 'debe ser string no vacío' });
  }
  if (!isNonEmptyString(order) || !isNonEmptyString(blueprint)) {
    return null;
  }
  const isoGenRaw = raw.isoGen;
  const isoGen = isNonEmptyString(isoGenRaw) ? isoGenRaw : undefined;
  return isoGen ? { order, blueprint, isoGen } : { order, blueprint };
}

function validateDocumentHashes(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): AnalysisRunDocumentHashes | null {
  if (!isPlainObject(raw)) {
    issues.push({ path, message: 'debe ser objeto' });
    return null;
  }
  const orderReportSha256 = raw.orderReportSha256;
  const blueprintList = raw.blueprintSha256List;

  let orderHash: string | null = null;
  if (orderReportSha256 === null) {
    orderHash = null;
  } else if (isNonEmptyString(orderReportSha256)) {
    orderHash = orderReportSha256;
  } else {
    issues.push({
      path: `${path}.orderReportSha256`,
      message: 'debe ser string no vacío o null',
    });
    return null;
  }

  if (!Array.isArray(blueprintList)) {
    issues.push({
      path: `${path}.blueprintSha256List`,
      message: 'debe ser array',
    });
    return null;
  }
  const blueprintSha256List: string[] = [];
  for (let i = 0; i < blueprintList.length; i += 1) {
    const entry = blueprintList[i];
    if (!isNonEmptyString(entry)) {
      issues.push({
        path: `${path}.blueprintSha256List[${i}]`,
        message: 'debe ser string no vacío',
      });
      return null;
    }
    blueprintSha256List.push(entry);
  }

  return { orderReportSha256: orderHash, blueprintSha256List };
}

function validateSummary(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): AnalysisRunSummary | null {
  if (raw === null) {
    return null;
  }
  if (!isPlainObject(raw)) {
    issues.push({ path, message: 'debe ser objeto o null' });
    return null;
  }
  const fields: Array<keyof AnalysisRunSummary> = [
    'totalLoaded',
    'totalAnalyzed',
    'totalAudited',
    'totalNonMatching',
    'totalOrders',
  ];
  const out: Partial<Record<keyof AnalysisRunSummary, number>> = {};
  for (const field of fields) {
    const value = raw[field];
    if (!isFiniteNumber(value) || value < 0) {
      issues.push({ path: `${path}.${String(field)}`, message: 'debe ser número >= 0' });
      return null;
    }
    out[field] = value;
  }
  return out as AnalysisRunSummary;
}

function validateMetrics(
  raw: unknown,
  path: string,
  issues: ValidationIssue[],
): AnalysisRunMetricsSanitized | null {
  if (raw === null) {
    return null;
  }
  if (!isPlainObject(raw)) {
    issues.push({ path, message: 'debe ser objeto o null' });
    return null;
  }
  const fields: Array<keyof AnalysisMetrics> = [
    'totalMs',
    'pdfRasterMs',
    'aiOrderMs',
    'aiBlueprintMs',
    'mergeMs',
  ];
  const out: Partial<Record<keyof AnalysisMetrics, number>> = {};
  for (const field of fields) {
    const value = raw[field];
    if (!isFiniteNumber(value) || value < 0) {
      issues.push({ path: `${path}.${String(field)}`, message: 'debe ser número >= 0' });
      return null;
    }
    // Redondear a microsegundos para estabilidad y evitar ruido de float puro.
    out[field] = Math.round(value * 1000) / 1000;
  }
  return out as AnalysisRunMetricsSanitized;
}

type AnalysisRunMetricsSanitized = AnalysisMetrics;

export function validateAnalysisRunInput(
  raw: unknown,
): ValidationResult<AnalysisRunRecordInput> {
  const issues: ValidationIssue[] = [];

  if (!isPlainObject(raw)) {
    return {
      ok: false,
      issues: [{ path: '$', message: 'input debe ser objeto' }],
    };
  }

  const { userUid, status, errorMessage } = raw;

  let userUidValue: string | null = null;
  if (userUid === null) {
    userUidValue = null;
  } else if (isNonEmptyString(userUid)) {
    userUidValue = userUid;
  } else {
    issues.push({ path: 'userUid', message: 'debe ser string no vacío o null' });
  }

  if (status !== 'success' && status !== 'error') {
    issues.push({ path: 'status', message: "debe ser 'success' o 'error'" });
  }

  let errorMessageValue: string | null = null;
  if (errorMessage === null || errorMessage === undefined) {
    errorMessageValue = null;
  } else if (typeof errorMessage === 'string') {
    errorMessageValue = errorMessage.length > 512 ? errorMessage.slice(0, 512) : errorMessage;
  } else {
    issues.push({ path: 'errorMessage', message: 'debe ser string o null' });
  }

  const promptVersions = validatePromptVersions(raw.promptVersions, 'promptVersions', issues);
  const documentHashes = validateDocumentHashes(raw.documentHashes, 'documentHashes', issues);
  const summary = validateSummary(raw.summary, 'summary', issues);
  const metrics = validateMetrics(raw.metrics, 'metrics', issues);
  const clientInfo = validateClientInfo(raw.clientInfo, 'clientInfo', issues);

  if (status === 'error' && errorMessageValue === null) {
    issues.push({
      path: 'errorMessage',
      message: "requerido cuando status == 'error'",
    });
  }

  if (issues.length > 0 || !promptVersions || !documentHashes || !clientInfo) {
    return { ok: false, issues };
  }

  return {
    ok: true,
    value: {
      userUid: userUidValue,
      status: status as AnalysisRunStatus,
      promptVersions,
      documentHashes,
      summary,
      metrics,
      errorMessage: errorMessageValue,
      clientInfo,
    },
  };
}

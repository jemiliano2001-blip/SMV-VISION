/**
 * Audit trail de corridas de análisis.
 *
 * Contrato:
 * - `recordAnalysisRun` NUNCA lanza. Si algo falla (config ausente,
 *   validación, red, permisos), se registra un warning y se devuelve
 *   `{ ok: false, reason }`. El flujo principal de la app no se afecta.
 * - El campo `createdAt` se añade SIEMPRE con `serverTimestamp()` para
 *   garantizar trazabilidad UTC independiente del reloj del cliente.
 * - El documento resultante es inmutable a nivel de reglas de seguridad.
 */

import {
  addDoc,
  collection,
  serverTimestamp,
  type DocumentReference,
} from 'firebase/firestore';

import { getCurrentUserUid } from './auth';
import { getFirestoreClient } from './client';
import {
  validateAnalysisRunInput,
  type AnalysisRunRecordInput,
  type ValidationIssue,
} from './validators';

export const ANALYSIS_RUNS_COLLECTION = 'analysisRuns';

export type RecordAnalysisRunResult =
  | { ok: true; id: string }
  | { ok: false; reason: RecordAnalysisRunFailureReason; issues?: ValidationIssue[] };

export type RecordAnalysisRunFailureReason =
  | 'not-configured'
  | 'not-authenticated'
  | 'invalid-input'
  | 'write-failed';

export async function recordAnalysisRun(
  input: AnalysisRunRecordInput,
): Promise<RecordAnalysisRunResult> {
  const db = getFirestoreClient();
  if (!db) {
    return { ok: false, reason: 'not-configured' };
  }

  // Regla de trazabilidad: el userUid lo resolvemos SIEMPRE desde el Auth
  // activo, nunca desde el input. Así un llamador malicioso no puede
  // falsificar la identidad del origen del movimiento.
  const resolvedUserUid = getCurrentUserUid();
  if (!resolvedUserUid) {
    return { ok: false, reason: 'not-authenticated' };
  }

  const validation = validateAnalysisRunInput({ ...input, userUid: resolvedUserUid });
  if (validation.ok === false) {
    console.warn(
      '[smv-vision][audit] analysisRun rechazado por validación de frontera',
      validation.issues,
    );
    return { ok: false, reason: 'invalid-input', issues: validation.issues };
  }

  const value = validation.value;
  const payload = {
    userUid: resolvedUserUid,
    createdAt: serverTimestamp(),
    status: value.status,
    promptVersions: value.promptVersions,
    documentHashes: value.documentHashes,
    summary: value.summary,
    metrics: value.metrics,
    errorMessage: value.errorMessage,
    clientInfo: value.clientInfo,
  };

  try {
    const ref: DocumentReference = await addDoc(
      collection(db, ANALYSIS_RUNS_COLLECTION),
      payload,
    );
    return { ok: true, id: ref.id };
  } catch (error) {
    console.warn(
      '[smv-vision][audit] no se pudo escribir analysisRun (fire-and-forget)',
      error,
    );
    return { ok: false, reason: 'write-failed' };
  }
}

/**
 * Helper de conveniencia: envuelve `recordAnalysisRun` en un `void` seguro
 * para llamar desde código síncrono sin bloquear la UI.
 *
 * Regla de oro: el audit trail es observacional, nunca debe esperar al UI.
 */
export function recordAnalysisRunFireAndForget(
  input: AnalysisRunRecordInput,
): void {
  recordAnalysisRun(input).catch((error) => {
    console.warn('[smv-vision][audit] fire-and-forget atrapó error inesperado', error);
  });
}

import { httpsCallable } from 'firebase/functions';
import { getFunctionsClient } from './client';

export type SyncOdooResult = 
  | { ok: true; ordersProcessed: number; created: number; updated: number; archived: number; headersWritten: number }
  | { ok: false; reason: string };

/**
 * Dispara el sync manual de Odoo invocando la Cloud Function triggerOdooSync.
 */
export async function triggerOdooSync(): Promise<SyncOdooResult> {
  const functions = getFunctionsClient();
  if (!functions) {
    return { ok: false, reason: 'Firebase Functions no está configurado.' };
  }

  try {
    const triggerSync = httpsCallable(functions, 'triggerOdooSync');
    const result = await triggerSync();
    
    const data = result.data as any;
    if (data && data.ok) {
      return {
        ok: true,
        ordersProcessed: data.ordersProcessed ?? 0,
        created: data.created ?? 0,
        updated: data.updated ?? 0,
        archived: data.archived ?? 0,
        headersWritten: data.headersWritten ?? 0
      };
    } else {
      return { ok: false, reason: data?.error || 'Error desconocido de la Cloud Function.' };
    }
  } catch (error: any) {
    console.error('[smv-vision][sync] triggerOdooSync falló:', error);
    
    if (error.code === 'functions/unauthenticated') {
      return { ok: false, reason: 'not-authenticated' };
    }
    
    return { ok: false, reason: error.message || String(error) };
  }
}

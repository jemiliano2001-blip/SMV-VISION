/**
 * Cliente para la Cloud Function `analyzeGemini` (functions/src/gemini.ts).
 *
 * Reemplaza las llamadas directas a `new GoogleGenAI({apiKey}).models.generateContent(...)`
 * que antes corrían en el navegador con `VITE_GEMINI_API_KEY` — una variable
 * `VITE_*` que Vite inserta como texto plano en el bundle, legible por
 * cualquiera que abriera el sitio. Ahora el navegador solo arma el mismo
 * payload (`model`/`contents`/`config`) y lo manda por un canal autenticado;
 * la key real vive solo en Secret Manager del lado del servidor.
 *
 * Como beneficio colateral, `@google/genai` (~280 KB / 54 KB gzip) ya no
 * necesita empaquetarse del lado del cliente en absoluto.
 */

import { httpsCallable } from 'firebase/functions';
import { getFunctionsClient } from './firebase/client';

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

/** Mismos valores que el enum `Type` de @google/genai — son strings planos, no hace falta importar el SDK para usarlos. */
export type GeminiSchemaType = 'OBJECT' | 'ARRAY' | 'STRING' | 'NUMBER' | 'BOOLEAN' | 'INTEGER';

export interface GeminiSchema {
  type: GeminiSchemaType;
  properties?: Record<string, GeminiSchema>;
  items?: GeminiSchema;
  required?: string[];
}

export interface GeminiGenerateConfig {
  responseMimeType?: string;
  responseSchema?: GeminiSchema;
  /** Solo para modelos de generación de imagen (p.ej. gemini-2.5-flash-image). */
  responseModalities?: Array<'TEXT' | 'IMAGE'>;
}

export interface GeminiProxyRequest {
  model: string;
  contents: GeminiContent[];
  config?: GeminiGenerateConfig;
}

export interface GeminiResponsePart {
  text?: string;
  thought?: boolean;
  inlineData?: { data?: string; mimeType?: string } | null;
}

export interface GeminiResponseCandidate {
  content?: { parts?: GeminiResponsePart[] };
}

interface AnalyzeGeminiResult {
  candidates: GeminiResponseCandidate[];
}

export interface GeminiProxyResponse {
  /** Concatenación de las partes de texto del primer candidato (misma lógica que el getter `.text` del SDK). */
  text: string;
  candidates: GeminiResponseCandidate[];
}

/** Replica el getter `response.text` del SDK: concatena partes de texto del primer candidato, saltando "thought" parts. */
export function extractResponseText(candidates: GeminiResponseCandidate[]): string {
  const parts = candidates[0]?.content?.parts ?? [];
  let text = '';
  for (const part of parts) {
    if (part.thought) continue;
    if (typeof part.text === 'string') {
      text += part.text;
    }
  }
  return text;
}

/**
 * Llama a la Cloud Function `analyzeGemini`. No reintenta por sí sola — los
 * llamadores ya envuelven con `callWithRetry` (ver src/lib/gemini.ts), igual
 * que antes hacían con la llamada directa al SDK.
 */
export async function callGeminiProxy(request: GeminiProxyRequest): Promise<GeminiProxyResponse> {
  const functions = getFunctionsClient();
  if (!functions) {
    throw new Error('Firebase no está configurado — no es posible llamar a Gemini.');
  }

  const callable = httpsCallable<GeminiProxyRequest, AnalyzeGeminiResult>(functions, 'analyzeGemini');
  const result = await callable(request);
  const candidates = result.data.candidates ?? [];
  return { text: extractResponseText(candidates), candidates };
}

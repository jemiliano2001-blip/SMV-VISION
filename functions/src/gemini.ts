/**
 * functions/src/gemini.ts
 *
 * Proxy callable para la API de Gemini. Antes de esto, el cliente
 * construía `new GoogleGenAI({ apiKey })` con `VITE_GEMINI_API_KEY` — una
 * variable `VITE_*`, que Vite inserta como texto plano en el bundle del
 * navegador. Cualquiera que abriera el sitio y bajara el chunk podía leer
 * la key y usarla a costa de SMV. Esta función mueve la llamada real a
 * Gemini al backend: la key vive solo en Secret Manager, y el cliente pasa
 * únicamente `model` / `contents` / `config` (el mismo payload que ya
 * armaba localmente) a través de un canal autenticado.
 *
 * Contrato:
 * - Requiere `request.auth` (mismo patrón que `triggerOdooSync`).
 * - `request.data` se tipa contra `GenerateContentParameters`, el mismo
 *   tipo que el cliente arma localmente — no hay validación de forma
 *   adicional más allá de exigir `model`: el resto es pass-through hacia
 *   `ai.models.generateContent`, y esa validación ya vive en TS del lado
 *   del cliente (la superficie de ataque real es la API de Gemini, no
 *   esta función).
 * - Devuelve `{ candidates }` tal cual los entrega el SDK — el cliente
 *   deriva `.text` con la misma lógica que usaba el SDK localmente
 *   (ver `src/lib/geminiProxy.ts`).
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { GoogleGenAI, type GenerateContentParameters } from "@google/genai";

const GEMINI_API_KEY = defineSecret("GEMINI_API_KEY");

function isGenerateContentParameters(data: unknown): data is GenerateContentParameters {
  if (typeof data !== "object" || data === null) return false;
  const model = (data as { model?: unknown }).model;
  const contents = (data as { contents?: unknown }).contents;
  return typeof model === "string" && model.trim().length > 0 && contents !== undefined;
}

export const analyzeGemini = onCall(
  {
    secrets: [GEMINI_API_KEY],
    timeoutSeconds: 120,
    memory: "512MiB",
    // Hasta 8 análisis de plano concurrentes por corrida (MAX_BLUEPRINT_CONCURRENCY
    // en el cliente) × varios operadores — margen amplio sin abrir la puerta a abuso.
    concurrency: 40,
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Debe estar autenticado para usar Gemini.");
    }

    if (!isGenerateContentParameters(request.data)) {
      throw new HttpsError("invalid-argument", "Falta 'model' o 'contents' en la solicitud.");
    }

    const apiKey = GEMINI_API_KEY.value().trim();
    if (!apiKey) {
      throw new HttpsError("failed-precondition", "GEMINI_API_KEY no está configurado en Secret Manager.");
    }

    const ai = new GoogleGenAI({ apiKey });

    try {
      const response = await ai.models.generateContent(request.data);
      return { candidates: response.candidates ?? [] };
    } catch (error) {
      logger.error("[analyzeGemini] Gemini falló", error);
      throw new HttpsError("internal", "Gemini no pudo procesar la solicitud.");
    }
  },
);

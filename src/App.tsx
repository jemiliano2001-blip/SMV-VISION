/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useRef, Suspense } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stage, PerspectiveCamera } from '@react-three/drei';
import { 
  ClipboardCopy, 
  Database, 
  FileText, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Truck,
  Calendar,
  Layers,
  Hash,
  Download,
  Image as ImageIcon,
  Upload,
  X,
  Maximize2,
  Box as BoxIcon
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { BlueprintSpec, Order, OrderExtraction } from './types';

// Configure pdfjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerSrc;

// Procedural 3D Model Component
function Part3DModel({ model }: { model: Order['model3D'] }) {
  if (!model) return null;

  const { shape, dimensions, color, metalness, roughness } = model;
  const materialProps = {
    color: color || '#FF4E00',
    metalness: metalness ?? 0.5,
    roughness: roughness ?? 0.5,
  };

  return (
    <Canvas shadows dpr={[1, 2]}>
      <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={50} />
      <Suspense fallback={null}>
        <Stage adjustCamera intensity={0.5} environment="city">
          {shape === 'box' && (
            <mesh castShadow receiveShadow>
              <boxGeometry args={[dimensions[0] || 1, dimensions[1] || 1, dimensions[2] || 1]} />
              <meshStandardMaterial {...materialProps} />
            </mesh>
          )}
          {shape === 'cylinder' && (
            <mesh castShadow receiveShadow>
              <cylinderGeometry args={[dimensions[0] || 0.5, dimensions[1] || 0.5, dimensions[2] || 2, 32]} />
              <meshStandardMaterial {...materialProps} />
            </mesh>
          )}
          {shape === 'sphere' && (
            <mesh castShadow receiveShadow>
              <sphereGeometry args={[dimensions[0] || 1, 32, 32]} />
              <meshStandardMaterial {...materialProps} />
            </mesh>
          )}
          {shape === 'torus' && (
            <mesh castShadow receiveShadow>
              <torusGeometry args={[dimensions[0] || 1, dimensions[1] || 0.4, 16, 100]} />
              <meshStandardMaterial {...materialProps} />
            </mesh>
          )}
        </Stage>
      </Suspense>
      <OrbitControls makeDefault autoRotate autoRotateSpeed={2} />
    </Canvas>
  );
}

export default function App() {
  const geminiApiKey = import.meta.env.VITE_GEMINI_API_KEY;
  const [orderPdf, setOrderPdf] = useState<string | null>(null);
  const [workshopPdfs, setWorkshopPdfs] = useState<string[]>([]);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractingStep, setExtractingStep] = useState<string>('');
  const [workshopLoadingStates, setWorkshopLoadingStates] = useState<Record<number, 'idle' | 'loading' | 'done' | 'error'>>({});
  const [orderLoadingState, setOrderLoadingState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [results, setResults] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copying, setCopying] = useState(false);
  
  const orderFileInputRef = useRef<HTMLInputElement>(null);
  const workshopFileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>, type: 'order' | 'workshop') => {
    const files = e.target.files;
    if (!files) return;

    Array.from(files).forEach(file => {
      if (file.type === 'application/pdf') {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (type === 'order') {
            setOrderPdf(reader.result as string);
          } else {
            setWorkshopPdfs(prev => [...prev, reader.result as string]);
          }
        };
        reader.readAsDataURL(file);
      } else {
        alert(`El archivo ${file.name} no es un PDF válido.`);
      }
    });

    // Reset input value to allow re-uploading the same file
    if (e.target) e.target.value = '';
  };

  const removeFile = (type: 'order' | 'workshop', index?: number) => {
    if (type === 'order') {
      setOrderPdf(null);
    } else {
      setWorkshopPdfs(prev => prev.filter((_, i) => i !== index));
    }
  };

  /**
   * Normalizes and resizes the image to ensure Gemini can process it.
   * High-resolution photos from phones are often too large or in formats
   * that cause transient "Unable to process" errors.
   */
  const normalizeImage = (dataUrl: string, isBlueprint: boolean = false): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!dataUrl.startsWith('data:image/')) {
        reject(new Error('Imagen inválida: se esperaba un DataURL de imagen.'));
        return;
      }

      const img = new Image();
      img.onload = () => {
        // Reduciendo resoluciones para mayor velocidad
        // 1600px es suficiente incluso para planos detallados
        const MAX_DIM = isBlueprint ? 1600 : 1200; 
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_DIM) {
            height *= MAX_DIM / width;
            width = MAX_DIM;
          }
        } else {
          if (height > MAX_DIM) {
            width *= MAX_DIM / height;
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo crear el contexto de canvas para normalizar imagen.'));
          return;
        }
        ctx.drawImage(img, 0, 0, width, height);
        // Normalize to JPEG for reliability, compression 0.7 for speed/weight balance
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.onerror = () => reject(new Error('No se pudo cargar la imagen para normalización.'));
      img.src = dataUrl;
    });
  };

  const extractBase64FromDataUrl = (dataUrl: string, expectedPrefix: string): string => {
    if (!dataUrl.startsWith(expectedPrefix)) {
      throw new Error(`Formato de archivo inválido. Se esperaba: ${expectedPrefix}.`);
    }

    const separator = ';base64,';
    const separatorIndex = dataUrl.indexOf(separator);
    if (separatorIndex < 0) {
      throw new Error('DataURL inválido: no contiene payload en base64.');
    }

    const base64Data = dataUrl.slice(separatorIndex + separator.length).trim();
    if (!base64Data) {
      throw new Error('DataURL inválido: payload base64 vacío.');
    }

    return base64Data;
  };

  const preparePdfPart = (dataUrl: string) => {
    const base64Data = extractBase64FromDataUrl(dataUrl, 'data:application/pdf');
    return {
      inlineData: {
        mimeType: "application/pdf",
        data: base64Data
      }
    };
  };

  const prepareImagePart = (dataUrl: string) => {
    const base64Data = extractBase64FromDataUrl(dataUrl, 'data:image/jpeg');
    return {
      inlineData: {
        mimeType: "image/jpeg",
        data: base64Data
      }
    };
  };

  const toUserFriendlyErrorMessage = (error: unknown): string => {
    if (error instanceof Error) {
      const message = error.message.toLowerCase();

      if (
        message.includes('fake worker') ||
        message.includes('pdf.worker') ||
        message.includes('dynamically imported module')
      ) {
        return 'No se pudo inicializar el worker de PDF.js. Reinicia el servidor de desarrollo y recarga el navegador.';
      }

      if (message.includes('json válido') || message.includes('formato inesperado')) {
        return `La IA respondió con un formato no compatible: ${error.message}`;
      }

      return error.message;
    }

    return 'Error desconocido durante el análisis de PDFs.';
  };

  interface BlueprintSpecWithImage {
    spec: BlueprintSpec;
    image: string;
  }

  interface MatchResult {
    entry: BlueprintSpecWithImage;
    score: number;
  }

  const normalizePieceKey = (value: string): string =>
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]/g, '')
      .toLowerCase();

  const tokenizePiece = (value: string): string[] =>
    value
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length >= 2);

  const computePieceMatchScore = (left: string, right: string): number => {
    const normalizedLeft = normalizePieceKey(left);
    const normalizedRight = normalizePieceKey(right);

    if (!normalizedLeft || !normalizedRight) return 0;
    if (normalizedLeft === normalizedRight) return 1;

    let score = 0;

    if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
      const shortest = Math.min(normalizedLeft.length, normalizedRight.length);
      const longest = Math.max(normalizedLeft.length, normalizedRight.length);
      score = Math.max(score, 0.7 + (shortest / longest) * 0.2);
    }

    const leftTokens = new Set(tokenizePiece(left));
    const rightTokens = new Set(tokenizePiece(right));
    if (leftTokens.size > 0 && rightTokens.size > 0) {
      let sharedTokens = 0;
      leftTokens.forEach((token) => {
        if (rightTokens.has(token)) sharedTokens += 1;
      });
      const overlap = sharedTokens / Math.max(leftTokens.size, rightTokens.size);
      score = Math.max(score, overlap * 0.75);
    }

    return Math.min(score, 1);
  };

  const parseJsonResponse = (rawText: string): unknown => {
    const trimmed = rawText.trim();
    if (!trimmed) {
      throw new Error('La IA devolvió una respuesta vacía.');
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error('La respuesta de IA no llegó en formato JSON válido.');
    }
  };

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

  const getStringField = (record: Record<string, unknown>, key: string): string | null => {
    const value = record[key];
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  };

  const normalizePriority = (value: string): 'URGENTE' | 'Normal' => {
    const normalized = value.trim().toUpperCase();
    return normalized === 'URGENTE' ? 'URGENTE' : 'Normal';
  };

  const parseOrdersResponse = (payload: unknown): OrderExtraction[] => {
    if (!Array.isArray(payload)) {
      throw new Error('La IA devolvió pedidos en un formato inesperado.');
    }

    const parsed: OrderExtraction[] = [];
    payload.forEach((entry, idx) => {
      if (!isRecord(entry)) return;
      const pieza = getStringField(entry, 'pieza');
      const cantidad = getStringField(entry, 'cantidad');
      const orden = getStringField(entry, 'orden');
      const fecha = getStringField(entry, 'fecha');
      const prioridadValue = getStringField(entry, 'prioridad') ?? 'Normal';

      if (!pieza || !cantidad || !orden || !fecha) {
        console.warn(`Pedido omitido por campos faltantes en índice ${idx}`);
        return;
      }

      parsed.push({
        pieza,
        cantidad,
        orden,
        fecha,
        prioridad: normalizePriority(prioridadValue),
      });
    });

    return parsed;
  };

  const isModelShape = (value: unknown): value is BlueprintSpec['model3D']['shape'] =>
    value === 'box' || value === 'cylinder' || value === 'sphere' || value === 'torus';

  const parseBoundingBox = (value: unknown): [number, number, number, number] | null => {
    if (!Array.isArray(value) || value.length !== 4) return null;
    const coords = value.map((item) => (typeof item === 'number' ? item : Number.NaN));
    if (coords.some((coord) => !Number.isFinite(coord))) return null;
    const [ymin, xmin, ymax, xmax] = coords;
    if (ymin < 0 || xmin < 0 || ymax > 1000 || xmax > 1000 || ymin >= ymax || xmin >= xmax) return null;
    return [ymin, xmin, ymax, xmax];
  };

  const parseBlueprintSpecsResponse = (payload: unknown): BlueprintSpec[] => {
    if (!Array.isArray(payload)) {
      throw new Error('La IA devolvió planos en un formato inesperado.');
    }

    const parsed: BlueprintSpec[] = [];
    payload.forEach((entry, idx) => {
      if (!isRecord(entry)) return;
      const pieza_detectada = getStringField(entry, 'pieza_detectada');
      const descripcionVisual = getStringField(entry, 'descripcionVisual');
      const isometricBoundingBox = parseBoundingBox(entry.isometricBoundingBox);

      if (!pieza_detectada || !descripcionVisual || !isometricBoundingBox) {
        console.warn(`Plano omitido por campos inválidos en índice ${idx}`);
        return;
      }

      if (!isRecord(entry.model3D)) {
        console.warn(`Plano omitido por model3D inválido en índice ${idx}`);
        return;
      }

      const shapeRaw = entry.model3D.shape;
      const dimensionsRaw = entry.model3D.dimensions;
      const color = getStringField(entry.model3D, 'color');
      const metalness = entry.model3D.metalness;
      const roughness = entry.model3D.roughness;

      if (
        !isModelShape(shapeRaw) ||
        !Array.isArray(dimensionsRaw) ||
        dimensionsRaw.some((dim) => typeof dim !== 'number' || !Number.isFinite(dim)) ||
        !color ||
        typeof metalness !== 'number' ||
        !Number.isFinite(metalness) ||
        typeof roughness !== 'number' ||
        !Number.isFinite(roughness)
      ) {
        console.warn(`Plano omitido por model3D incompleto en índice ${idx}`);
        return;
      }

      parsed.push({
        pieza_detectada,
        descripcionVisual,
        isometricBoundingBox,
        model3D: {
          shape: shapeRaw,
          dimensions: dimensionsRaw,
          color,
          metalness,
          roughness,
        },
      });
    });

    return parsed;
  };

  const findBestBlueprintMatch = (
    orderPiece: string,
    blueprintEntries: BlueprintSpecWithImage[],
  ): MatchResult | null => {
    let best: MatchResult | null = null;
    for (const entry of blueprintEntries) {
      const score = computePieceMatchScore(orderPiece, entry.spec.pieza_detectada);
      if (!best || score > best.score) {
        best = { entry, score };
      }
    }
    const threshold = 0.45;
    return best && best.score >= threshold ? best : null;
  };

  /**
   * Converts every page of a PDF into JPEG images for visual analysis and cropping.
   */
  const convertPdfToImages = async (dataUrl: string): Promise<string[]> => {
    try {
      if (!dataUrl.startsWith('data:application/pdf')) {
        throw new Error('El archivo proporcionado no es un PDF válido en formato DataURL.');
      }

      console.log("Rendering all PDF pages...");
      const loadingTask = pdfjsLib.getDocument(dataUrl);
      const pdf = await loadingTask.promise;
      if (pdf.numPages < 1) {
        throw new Error('El PDF no contiene páginas renderizables.');
      }
      const images: string[] = [];

      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const viewport = page.getViewport({ scale: 2.5 });
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) {
          throw new Error('No se pudo crear el contexto del canvas para procesar el PDF.');
        }

        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvas, canvasContext: context, viewport }).promise;
        images.push(canvas.toDataURL('image/jpeg', 0.85));
      }

      if (images.length === 0) {
        throw new Error('No se pudieron renderizar páginas del PDF.');
      }

      return images;
    } catch (e) {
      console.error("PDF to Image conversion failed", e);
      throw new Error(`No se pudo procesar el PDF como imagen para la extracción visual. ${toUserFriendlyErrorMessage(e)}`);
    }
  };

  // Helper to crop image based on AI bounding box
  const cropIsometricView = (base64: string, box: number[]): Promise<string> => {
    return new Promise((resolve, reject) => {
      if (!Array.isArray(box) || box.length !== 4) {
        reject(new Error('No se puede recortar vista isométrica: bounding box inválido.'));
        return;
      }

      const img = new Image();
      img.onload = () => {
        const padding = 20;
        const [ymin, xmin, ymax, xmax] = box;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('No se pudo crear contexto de canvas para recortar vista isométrica.'));
          return;
        }
        const x = Math.max(0, (xmin / 1000) * img.width - padding);
        const y = Math.max(0, (ymin / 1000) * img.height - padding);
        const width = Math.min(img.width - x, ((xmax - xmin) / 1000) * img.width + padding * 2);
        const height = Math.min(img.height - y, ((ymax - ymin) / 1000) * img.height + padding * 2);
        if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
          reject(new Error('No se pudo recortar vista isométrica: dimensiones fuera de rango.'));
          return;
        }
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.onerror = () => reject(new Error('No se pudo cargar la imagen para recorte isométrico.'));
      img.src = base64;
    });
  };

  const extractInfo = async () => {
    if (!orderPdf && workshopPdfs.length === 0) return;
    if (!geminiApiKey) {
      setError('Falta la variable VITE_GEMINI_API_KEY. Defínela en tu archivo .env y reinicia el servidor de desarrollo.');
      return;
    }
    
    setIsExtracting(true);
    setError(null);
    setResults(null);
    setExtractingStep('Iniciando análisis...');
    setOrderLoadingState(orderPdf ? 'loading' : 'idle');
    const initialWorkshopStates: Record<number, 'loading'> = {};
    workshopPdfs.forEach((_, i) => { initialWorkshopStates[i] = 'loading'; });
    setWorkshopLoadingStates(initialWorkshopStates);

    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    
    try {
      // 1. Extract Orders (Flash) + strict validation
      let ordersList: OrderExtraction[] = [];
      if (orderPdf) {
        setExtractingStep('Leyendo tabla de pedidos...');
        try {
          const response = await ai.models.generateContent({
            model: "gemini-flash-latest",
            contents: [{
              role: 'user',
              parts: [
                { text: "Analiza este documento PDF de órdenes. Extrae la tabla de pedidos completa. JSON Array: pieza, cantidad, orden, fecha, prioridad (URGENTE si es Marzo)." },
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
          ordersList = parseOrdersResponse(parseJsonResponse(response.text));
          setOrderLoadingState('done');
        } catch (orderError) {
          setOrderLoadingState('error');
          throw orderError;
        }
      }

      // 2. Extract blueprints from every page/PDF with strict validation
      setExtractingStep(`Analizando ${workshopPdfs.length} planos de taller...`);
      const workshopFailures: string[] = [];
      const groupedBlueprintEntries = await Promise.all(
        workshopPdfs.map(async (pdf, idx): Promise<BlueprintSpecWithImage[]> => {
          const entries: BlueprintSpecWithImage[] = [];
          try {
            const workshopImages = await convertPdfToImages(pdf);

            for (let pageIndex = 0; pageIndex < workshopImages.length; pageIndex += 1) {
              setExtractingStep(`Plano ${idx + 1}/${workshopPdfs.length} - página ${pageIndex + 1}/${workshopImages.length}`);
              const normalized = await normalizeImage(workshopImages[pageIndex], true);

              const response = await ai.models.generateContent({
                model: "gemini-flash-latest",
                contents: [{
                  role: 'user',
                  parts: [
                    { text: `Analiza este plano de taller. Busca las vistas isométricas de las piezas.
                    REGLA CRÍTICA: Debes identificar el "isometricBoundingBox" [ymin, xmin, ymax, xmax] (0-1000) que encierra la vista 3D/isométrica de la pieza.
                    También indica especificaciones visuales detalladas y parámetros 3D completos (shape, dimensions [números], color [HEX], metalness, roughness).` },
                    prepareImagePart(normalized)
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
                        isometricBoundingBox: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                        model3D: {
                          type: Type.OBJECT,
                          properties: {
                            shape: { type: Type.STRING, enum: ["box", "cylinder", "sphere", "torus"] },
                            dimensions: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                            color: { type: Type.STRING },
                            metalness: { type: Type.NUMBER },
                            roughness: { type: Type.NUMBER }
                          },
                          required: ["shape", "dimensions", "color", "metalness", "roughness"]
                        }
                      },
                      required: ["pieza_detectada", "descripcionVisual", "isometricBoundingBox", "model3D"]
                    }
                  }
                }
              });

              const pageSpecs = parseBlueprintSpecsResponse(parseJsonResponse(response.text));
              pageSpecs.forEach((spec) => entries.push({ spec, image: normalized }));
            }

            setWorkshopLoadingStates((prev) => ({ ...prev, [idx]: entries.length > 0 ? 'done' : 'error' }));
            return entries;
          } catch (workshopError) {
            setWorkshopLoadingStates((prev) => ({ ...prev, [idx]: 'error' }));
            console.error(`Error procesando plano ${idx + 1}`, workshopError);
            workshopFailures.push(`Plano ${idx + 1}: ${toUserFriendlyErrorMessage(workshopError)}`);
            return [];
          }
        }),
      );

      const blueprintEntries = groupedBlueprintEntries.flat();

      if (workshopPdfs.length > 0 && blueprintEntries.length === 0) {
        const firstFailure = workshopFailures[0];
        if (firstFailure) {
          throw new Error(`No se pudieron extraer piezas válidas de los planos de taller. ${firstFailure}`);
        }
        throw new Error('No se pudieron extraer piezas válidas de los planos de taller.');
      }

      // 3. Merge and populate results using scored matching
      setExtractingStep('Generando reporte final...');
      let finalResults: Order[] = [];

      if (ordersList.length > 0) {
        finalResults = await Promise.all(ordersList.map(async (order) => {
          const bestMatch = findBestBlueprintMatch(order.pieza, blueprintEntries);
          const sourceImg = bestMatch?.entry.image ?? null;

          const resultOrder: Order = {
            ...order,
            haSidoAuditada: Boolean(bestMatch),
            descripcionVisual: bestMatch?.entry.spec.descripcionVisual ?? "Detalles técnicos no encontrados en planos.",
            model3D: bestMatch?.entry.spec.model3D,
            isometricBoundingBox: bestMatch?.entry.spec.isometricBoundingBox
          };

          if (resultOrder.isometricBoundingBox && sourceImg) {
            try {
              resultOrder.isometricView = await cropIsometricView(sourceImg, resultOrder.isometricBoundingBox);
            } catch (cropError) {
              console.error("Auto-crop error", cropError);
            }
          }

          return resultOrder;
        }));
      } else if (blueprintEntries.length > 0) {
        finalResults = await Promise.all(
          blueprintEntries.map(async ({ spec, image }) => {
            const resultOrder: Order = {
              pieza: spec.pieza_detectada,
              cantidad: "N/A",
              orden: "N/A",
              fecha: "N/A",
              prioridad: "Normal",
              haSidoAuditada: true,
              descripcionVisual: spec.descripcionVisual,
              model3D: spec.model3D,
              isometricBoundingBox: spec.isometricBoundingBox
            };

            if (resultOrder.isometricBoundingBox) {
              try {
                resultOrder.isometricView = await cropIsometricView(image, resultOrder.isometricBoundingBox);
              } catch (cropError) {
                console.error("Auto-crop error", cropError);
              }
            }
            return resultOrder;
          }),
        );
      }

      if (finalResults.length === 0) {
        throw new Error("No se encontraron datos en los documentos proporcionados. Intente con otros archivos.");
      }

      setResults(finalResults);
    } catch (err: unknown) {
      console.error("PDF Analysis Error Object:", err);
      const errorMessage = toUserFriendlyErrorMessage(err);
      setError(`Error analizando PDFs: ${errorMessage}. Verifique su conexión, formato de archivos y permisos de API.`);
    } finally {
      setIsExtracting(false);
    }
  };

  const copyResults = () => {
    if (!results) return;
    navigator.clipboard.writeText(JSON.stringify(results, null, 2));
    setCopying(true);
    setTimeout(() => setCopying(false), 2000);
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

  return (
    <div className="min-h-screen bg-bg font-sans text-ink border-12 border-ink flex flex-col">
      {/* Header */}
      <header className="bg-bg border-b-2 border-ink px-10 py-10">
        <div className="flex flex-col md:flex-row items-end justify-between gap-6">
          <div className="space-y-4">
            <span className="text-[14px] font-bold uppercase tracking-[2px] bg-ink text-bg px-2 py-1 inline-block">
              Servicios y Maquinados Vázquez
            </span>
            <h1 className="text-[60px] lg:text-[82px] font-black leading-[0.85] tracking-[-4px] uppercase">
              SMV // VISION
            </h1>
          </div>
          <div className="text-right space-y-2">
            <span className="text-[14px] font-bold uppercase tracking-[2px] bg-accent text-bg px-2 py-1 inline-block">
              Intelligent Workshop Analyzer
            </span>
            <h1 className="text-[32px] font-black tracking-[-1px] uppercase">
              EXTRACTOR
            </h1>
          </div>
        </div>
      </header>

      <main className="grow grid grid-cols-1 xl:grid-cols-12">
        {/* Input & Vision Section */}
        <section className="xl:col-span-5 bg-[#E8E8E8] border-r-2 border-ink p-10 flex flex-col gap-6">
          
          {/* Order Visual Input */}
          <div className="flex flex-col gap-4 flex-1">
            <div className="flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-wider">
              <div className="w-2.5 h-2.5 bg-ink"></div>
              1. Tabla de Órdenes (PDF)
            </div>
            
            <div 
              className={`grow min-h-[180px] border-2 border-dashed border-ink flex flex-col items-center justify-center p-6 relative transition-all ${orderPdf ? 'bg-white' : 'bg-white/30 hover:bg-white/50 cursor-pointer'}`}
              onClick={() => !orderPdf && orderFileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={orderFileInputRef} 
                className="hidden" 
                accept="application/pdf" 
                onChange={(e) => handleFileUpload(e, 'order')} 
              />
              
              {!orderPdf ? (
                <div className="text-center space-y-2">
                  <Database className="mx-auto w-10 h-10 text-ink/30" />
                  <p className="font-black uppercase text-xs tracking-tighter">Subir archivo PDF pedidos</p>
                  <p className="text-[10px] text-gray-400 font-mono">Tabla de Suprajit (PDF)</p>
                </div>
              ) : (
                <div className="relative w-full h-full flex flex-col items-center justify-center">
                  <div className="relative">
                    <FileText className={`w-16 h-16 ${orderLoadingState === 'loading' ? 'text-accent animate-pulse' : 'text-ink'}`} />
                    {orderLoadingState === 'loading' && (
                      <div className="absolute -bottom-2 -right-2 bg-accent p-1 rounded-full border-2 border-bg animate-spin">
                        <Loader2 size={12} className="text-bg" />
                      </div>
                    )}
                    {orderLoadingState === 'done' && (
                      <div className="absolute -bottom-2 -right-2 bg-green-500 p-1 rounded-full border-2 border-bg">
                        <CheckCircle2 size={12} className="text-bg" />
                      </div>
                    )}
                  </div>
                  <p className="mt-4 font-black text-[10px] uppercase">
                    {orderLoadingState === 'loading' ? 'Analizando Pedidos...' : 'Pedidos Listos'}
                  </p>
                  <button 
                    onClick={(e) => { e.stopPropagation(); removeFile('order'); }}
                    className="absolute top-0 right-0 p-1 bg-accent text-bg hover:bg-ink transition-colors"
                  >
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Workshop Sheet Visual Input */}
          <div className="flex flex-col gap-4 flex-1">
            <div className="flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-wider">
              <div className="w-2.5 h-2.5 bg-accent"></div>
              2. Hoja de Taller (Planos PDF)
            </div>
            
            <div 
              className={`grow min-h-[180px] border-2 border-dashed border-ink flex flex-col items-center justify-center p-6 relative transition-all bg-white/30 hover:bg-white/50 cursor-pointer`}
              onClick={() => workshopFileInputRef.current?.click()}
            >
              <input 
                type="file" 
                ref={workshopFileInputRef} 
                className="hidden" 
                accept="application/pdf" 
                multiple
                onChange={(e) => handleFileUpload(e, 'workshop')} 
              />
              
              <div className="text-center space-y-2">
                <FileText className="mx-auto w-10 h-10 text-ink/30" />
                <p className="font-black uppercase text-xs tracking-tighter">Subir planos PDF (Múltiples)</p>
                <p className="text-[10px] text-gray-400 font-mono">Agregue todos los planos necesarios</p>
              </div>
            </div>

            {workshopPdfs.length > 0 && (
              <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-2">
                {workshopPdfs.map((pdf, idx) => (
                  <div key={idx} className="relative group border border-ink bg-white p-2 flex items-center justify-between gap-2 shadow-[2px_2px_0px_rgba(0,0,0,1)]">
                    <div className="flex items-center gap-2 overflow-hidden">
                      {workshopLoadingStates[idx] === 'loading' ? (
                        <Loader2 size={14} className="text-accent animate-spin shrink-0" />
                      ) : workshopLoadingStates[idx] === 'done' ? (
                        <CheckCircle2 size={14} className="text-green-500 shrink-0" />
                      ) : (
                        <FileText size={14} className="text-accent shrink-0" />
                      )}
                      <span className={`text-[9px] font-mono truncate ${workshopLoadingStates[idx] === 'loading' ? 'text-accent font-bold' : ''}`}>
                        Plan_{idx + 1}.pdf
                      </span>
                    </div>
                    {workshopLoadingStates[idx] !== 'loading' && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); removeFile('workshop', idx); }}
                        className="text-accent hover:text-ink transition-colors"
                      >
                        <X size={14} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="mt-auto">
            <button
              onClick={extractInfo}
              disabled={isExtracting || (!orderPdf && workshopPdfs.length === 0)}
              className="w-full bg-ink hover:bg-accent disabled:bg-gray-400 text-bg font-black py-4 px-8 text-xl uppercase tracking-widest transition-all shadow-[8px_8px_0px_rgba(0,0,0,0.2)] hover:shadow-none hover:translate-x-1 hover:translate-y-1 active:bg-ink active:shadow-none"
            >
              {isExtracting ? (
                <span className="flex items-center justify-center gap-3 italic">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  Analizando {workshopPdfs.length} planos...
                </span>
              ) : (
                <span className="flex items-center justify-center gap-3">
                  <CheckCircle2 className="w-6 h-6" />
                  Procesar Todo
                </span>
              )}
            </button>
          </div>
        </section>

        {/* Results Section */}
        <section className="xl:col-span-7 p-10 flex flex-col bg-bg overflow-hidden min-h-[600px]">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-wider">
              <div className="w-2.5 h-2.5 bg-ink"></div>
              Audit Table: Pieces & Isometric Details
            </div>
            
            {results && (
              <div className="flex gap-3">
                <button
                  onClick={copyResults}
                  className="bg-ink text-bg px-4 py-1.5 text-[11px] font-black uppercase tracking-wider hover:bg-accent transition-colors border border-ink"
                >
                  {copying ? 'Copiado' : 'Link JSON'}
                </button>
                <button
                  onClick={downloadJson}
                  className="bg-accent text-bg px-4 py-1.5 text-[11px] font-black uppercase tracking-wider hover:bg-ink transition-colors border border-ink"
                >
                  Descargar
                </button>
              </div>
            )}
          </div>

          <AnimatePresence mode="wait">
            {!results && !isExtracting && !error && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grow border-4 border-ink border-dashed flex flex-col items-center justify-center text-center p-12 bg-white/30"
              >
                <div className="relative mb-6">
                  <Maximize2 className="text-ink/10 w-24 h-24" />
                  <FileText className="absolute inset-0 m-auto text-ink/20 w-10 h-10" />
                </div>
                <h3 className="font-black text-3xl uppercase tracking-tighter text-ink/20 italic">Dashboard de Auditoría Vacío</h3>
                <p className="text-[11px] font-mono text-ink/30 uppercase mt-2 tracking-widest">Sube una tabla de órdenes y/o hojas de taller para analizar</p>
                <div className="mt-6 p-4 border border-ink/10 bg-white/50 text-[10px] font-mono text-left space-y-1">
                  <p>• Recomendado: PDF de alta resolución</p>
                  <p>• Soporta: Múltiples planos de taller</p>
                  <p>• Extracción: Vistas Isométricas automáticas</p>
                </div>
              </motion.div>
            )}

            {isExtracting && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="grow border-4 border-ink bg-ink flex flex-col items-center justify-center text-center p-12"
              >
                <div className="relative mb-10">
                  <div className="w-32 h-32 border-8 border-white/10 border-t-accent rounded-full animate-spin"></div>
                  <Database className="absolute inset-0 m-auto text-accent w-8 h-8 animate-pulse" />
                </div>
                <div className="space-y-4">
                  <h3 className="text-bg font-black text-4xl uppercase tracking-widest leading-none">Analizando Planos</h3>
                  <div className="flex flex-col items-center gap-2">
                    <p className="text-accent font-mono text-xs uppercase tracking-[4px] animate-pulse">{extractingStep}</p>
                    <div className="flex gap-1">
                      {workshopPdfs.map((_, i) => (
                        <div 
                          key={i} 
                          className={`w-2.5 h-1 transition-all ${
                            workshopLoadingStates[i] === 'done' ? 'bg-green-500 w-4' : 
                            workshopLoadingStates[i] === 'loading' ? 'bg-accent animate-pulse' : 'bg-white/20'
                          }`}
                        />
                      ))}
                    </div>
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
                      <tr className="bg-[#0D2B4D] text-bg">
                        <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest border-r border-white/10 w-[45%]">PIEZA / DESCRIPCIÓN</th>
                        <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest border-r border-white/10 text-center">CANTIDAD</th>
                        <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest border-r border-white/10 text-center">ORDEN</th>
                        <th className="px-5 py-3 text-[11px] font-black uppercase tracking-widest text-center">ENTREGA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((order, idx) => (
                        <tr key={idx} className="border-b-2 border-gray-200 hover:bg-gray-50 transition-colors group">
                          {/* Pieza / Descripción + Isometric */}
                          <td className="px-5 py-4 border-r-2 border-gray-100 flex items-start gap-4">
                            <div className="grow">
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-black text-lg uppercase tracking-tight text-[#0D2B4D]">
                                  {order.pieza}
                                </h4>
                                {order.prioridad === 'URGENTE' && (
                                  <span className="bg-accent text-bg text-[10px] font-black px-2 py-0.5 rounded-sm animate-pulse">
                                    ¡URGENTE!
                                  </span>
                                )}
                              </div>
                              <p className="text-[10px] text-gray-500 font-mono leading-tight max-w-sm">
                                {order.descripcionVisual}
                              </p>
                              
                              {/* Audit status and 3D Model mini toggle */}
                              <div className="mt-3 flex items-center gap-3">
                                {order.haSidoAuditada ? (
                                  <div className="flex items-center gap-1 text-green-600 text-[9px] font-black uppercase">
                                    <CheckCircle2 size={12} />
                                    Isométrico Encontrado
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-1 text-accent text-[9px] font-black uppercase opacity-60">
                                    <AlertCircle size={12} />
                                    Sin Plano Isométrico
                                  </div>
                                )}
                                
                                <div className="h-3 w-px bg-gray-300"></div>
                                
                                <div className="w-24 h-24 border-2 border-ink bg-gray-100 p-1 relative group-hover:scale-125 transition-transform z-10 origin-left">
                                  <Part3DModel model={order.model3D} />
                                  <div className="absolute inset-0 border border-white/20 pointer-events-none"></div>
                                </div>
                              </div>
                            </div>

                            {/* Isometric Extract Card */}
                            {order.isometricView && (
                              <div className="w-32 h-32 border-2 border-ink bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)] shrink-0 relative overflow-hidden flex items-center justify-center p-1">
                                <img 
                                  src={order.isometricView} 
                                  alt="Iso Extract" 
                                  className="max-w-full max-h-full object-contain mix-blend-multiply transition-transform group-hover:scale-110" 
                                />
                                <div className="absolute bottom-0 right-0 bg-ink text-bg text-[7px] font-black px-1 uppercase italic translate-y-full group-hover:translate-y-0 transition-transform">
                                  EXTRACTO ISO
                                </div>
                              </div>
                            )}
                          </td>
                          
                          <td className="px-5 py-4 border-r-2 border-gray-100 text-center align-middle">
                            <span className="font-black text-xl text-[#0D2B4D] italic tracking-tighter">
                              {order.cantidad}
                            </span>
                          </td>
                          
                          <td className="px-5 py-4 border-r-2 border-gray-100 text-center align-middle">
                            <span className="font-mono text-xs font-bold text-accent">
                              {order.orden}
                            </span>
                          </td>
                          
                          <td className="px-5 py-4 text-center align-middle">
                            <div className="flex flex-col items-center gap-1">
                              <Calendar size={12} className="text-gray-400" />
                              <span className="font-black text-xs uppercase text-[#0D2B4D]">
                                {order.fecha}
                              </span>
                            </div>
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
                    <p className="text-4xl font-black text-bg italic">{results.length}</p>
                  </div>
                  <div className="bg-ink p-5 border-t-8 border-accent">
                    <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Match Visual</p>
                    <p className="text-4xl font-black text-accent italic">{results.filter(r => r.haSidoAuditada).length}</p>
                  </div>
                  <div className="bg-ink p-5 border-t-8 border-accent">
                    <p className="text-[10px] text-gray-500 uppercase font-black tracking-widest">Urgentes</p>
                    <p className="text-4xl font-black text-white italic">{results.filter(r => r.prioridad === 'URGENTE').length}</p>
                  </div>
                  <div className="bg-ink p-5 flex items-center justify-center">
                    <Database className="text-white w-12 h-12" />
                  </div>
                </div>
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

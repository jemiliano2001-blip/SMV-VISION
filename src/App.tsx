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
import { Order } from './types';

// Configure pdfjs worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

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
    return new Promise((resolve) => {
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
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, width, height);
        // Normalize to JPEG for reliability, compression 0.7 for speed/weight balance
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = dataUrl;
    });
  };

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

  /**
   * Converts the first page of a PDF into a JPEG image for visual analysis and cropping.
   */
  const convertPdfToImage = async (dataUrl: string): Promise<string> => {
    try {
      console.log("Rendering PDF page 1...");
      const loadingTask = pdfjsLib.getDocument(dataUrl);
      const pdf = await loadingTask.promise;
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2.5 }); // Increased scale for better detail
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await (page as any).render({ canvasContext: context, viewport }).promise;
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch (e) {
      console.error("PDF to Image conversion failed", e);
      throw new Error("No se pudo procesar el PDF como imagen para la extracción visual.");
    }
  };

  // Helper to crop image based on AI bounding box
  const cropIsometricView = (base64: string, box: number[]): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const padding = 20;
        const [ymin, xmin, ymax, xmax] = box;
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const x = Math.max(0, (xmin / 1000) * img.width - padding);
        const y = Math.max(0, (ymin / 1000) * img.height - padding);
        const width = Math.min(img.width - x, ((xmax - xmin) / 1000) * img.width + padding * 2);
        const height = Math.min(img.height - y, ((ymax - ymin) / 1000) * img.height + padding * 2);
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(img, x, y, width, height, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.9));
      };
      img.src = base64;
    });
  };

  const extractInfo = async () => {
    if (!orderPdf && workshopPdfs.length === 0) return;
    
    setIsExtracting(true);
    setError(null);
    setResults(null);
    setExtractingStep('Iniciando análisis...');
    setOrderLoadingState(orderPdf ? 'loading' : 'idle');
    const initialWorkshopStates: Record<number, 'loading'> = {};
    workshopPdfs.forEach((_, i) => { initialWorkshopStates[i] = 'loading'; });
    setWorkshopLoadingStates(initialWorkshopStates);

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    try {
      // 1. Extract Orders (Flash)
      let ordersList: any[] = [];
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
                  required: ["pieza, cantidad, orden, fecha, prioridad"]
                }
              }
            }
          });
          ordersList = JSON.parse(response.text.trim());
          setOrderLoadingState('done');
        } catch (e) {
          setOrderLoadingState('error');
          throw e;
        }
      }

      // 2. Extract Blueprints from all pages/PDFs (Flash)
      setExtractingStep(`Analizando ${workshopPdfs.length} planos de taller...`);
      const blueprintResults = await Promise.all(workshopPdfs.map(async (pdf, idx) => {
        try {
          const workshopImage = await convertPdfToImage(pdf);
          const normalized = await normalizeImage(workshopImage, true);
          
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
          
          setWorkshopLoadingStates(prev => ({ ...prev, [idx]: 'done' }));
          return { 
            specs: JSON.parse(response.text.trim()), 
            image: normalized 
          };
        } catch (e) {
          setWorkshopLoadingStates(prev => ({ ...prev, [idx]: 'error' }));
          throw e;
        }
      }));

      // 3. Merge and Populate Results
      setExtractingStep('Generando reporte final...');
      let finalResults: Order[] = [];

      if (ordersList.length > 0) {
        finalResults = await Promise.all(ordersList.map(async (order: any) => {
          let bestMatch: any = null;
          let sourceImg: string | null = null;

          for (const res of blueprintResults) {
            const match = res.specs.find((s: any) => 
              s.pieza_detectada.toLowerCase().includes(order.pieza.toLowerCase()) ||
              order.pieza.toLowerCase().includes(s.pieza_detectada.toLowerCase())
            );
            if (match) {
              bestMatch = match;
              sourceImg = res.image;
              break; 
            }
          }

          const resObj: Order = {
            ...order,
            haSidoAuditada: !!bestMatch,
            descripcionVisual: bestMatch?.descripcionVisual || "Detalles técnicos no encontrados en planos.",
            model3D: bestMatch?.model3D,
            isometricBoundingBox: bestMatch?.isometricBoundingBox
          };

          if (resObj.isometricBoundingBox && sourceImg) {
            try {
              resObj.isometricView = await cropIsometricView(sourceImg, resObj.isometricBoundingBox);
            } catch (e) {
              console.error("Auto-crop error", e);
            }
          }
          return resObj;
        }));
      } else if (blueprintResults.length > 0) {
        // If no orders but we have blueprints, show all pieces detected in blueprints
        for (const res of blueprintResults) {
          const pageResults = await Promise.all(res.specs.map(async (spec: any) => {
            const resObj: Order = {
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

            if (resObj.isometricBoundingBox && res.image) {
              try {
                resObj.isometricView = await cropIsometricView(res.image, resObj.isometricBoundingBox);
              } catch (e) {
                console.error("Auto-crop error", e);
              }
            }
            return resObj;
          }));
          finalResults = [...finalResults, ...pageResults];
        }
      }

      if (finalResults.length === 0) {
        throw new Error("No se encontraron datos en los documentos proporcionados. Intente con otros archivos.");
      }

      setResults(finalResults);
    } catch (err: any) {
      console.error("PDF Analysis Error Object:", err);
      const errorMessage = err?.message || JSON.stringify(err);
      setError(`Error analizando PDFs: ${errorMessage}. Verifique su conexión y permisos de API.`);
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
    <div className="min-h-screen bg-bg font-sans text-ink border-[12px] border-ink flex flex-col">
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

      <main className="flex-grow grid grid-cols-1 xl:grid-cols-12">
        {/* Input & Vision Section */}
        <section className="xl:col-span-5 bg-[#E8E8E8] border-r-2 border-ink p-10 flex flex-col gap-6">
          
          {/* Order Visual Input */}
          <div className="flex flex-col gap-4 flex-1">
            <div className="flex items-center gap-2 text-[12px] font-extrabold uppercase tracking-wider">
              <div className="w-2.5 h-2.5 bg-ink"></div>
              1. Tabla de Órdenes (PDF)
            </div>
            
            <div 
              className={`flex-grow min-h-[180px] border-2 border-dashed border-ink flex flex-col items-center justify-center p-6 relative transition-all ${orderPdf ? 'bg-white' : 'bg-white/30 hover:bg-white/50 cursor-pointer'}`}
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
              className={`flex-grow min-h-[180px] border-2 border-dashed border-ink flex flex-col items-center justify-center p-6 relative transition-all bg-white/30 hover:bg-white/50 cursor-pointer`}
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
                        <Loader2 size={14} className="text-accent animate-spin flex-shrink-0" />
                      ) : workshopLoadingStates[idx] === 'done' ? (
                        <CheckCircle2 size={14} className="text-green-500 flex-shrink-0" />
                      ) : (
                        <FileText size={14} className="text-accent flex-shrink-0" />
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
                className="flex-grow border-4 border-ink border-dashed flex flex-col items-center justify-center text-center p-12 bg-white/30"
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
                className="flex-grow border-4 border-ink bg-ink flex flex-col items-center justify-center text-center p-12"
              >
                <div className="relative mb-10">
                  <div className="w-32 h-32 border-[8px] border-white/10 border-t-accent rounded-full animate-spin"></div>
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
                className="flex-grow border-4 border-accent bg-accent/5 p-12 flex flex-col items-center justify-center text-center"
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
                className="flex-grow flex flex-col"
              >
                <div className="flex-grow overflow-auto border-4 border-ink bg-white shadow-[12px_12px_0px_rgba(0,0,0,0.1)]">
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
                            <div className="flex-grow">
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
                              <div className="w-32 h-32 border-2 border-ink bg-white shadow-[4px_4px_0px_rgba(0,0,0,1)] flex-shrink-0 relative overflow-hidden flex items-center justify-center p-1">
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

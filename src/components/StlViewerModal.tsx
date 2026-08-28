/**
 * Visor 3D de alta precisión para STL (export eDrawings / Tool Crib).
 * 
 * Características:
 * - Auto-encuadre geométrico preciso (bounding sphere + FOV horizontal/vertical).
 * - Estudio de iluminación industrial con rim-lighting y reflejos metálicos.
 * - Dimensiones en pulgadas (primario) y milímetros (secundario).
 * - Controles de cámara: ISO, Superior, Frontal, Lateral, Auto-giro, Malla y Reset.
 * - Soporte táctil móvil (1 dedo rotar, 2 dedos zoom/paneo).
 */

import { useEffect, useRef, useState, useCallback, type ReactElement } from 'react';
import {
  Loader2,
  X,
  Box,
  RotateCw,
  Maximize2,
  Minimize2,
  Layers,
  Focus,
  Grid,
} from 'lucide-react';
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  GridHelper,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { log } from '../lib/log';

export interface StlViewerModalProps {
  open: boolean;
  stlUrl: string | null;
  title: string;
  onClose: () => void;
}

interface PieceDimensions {
  xMm: number;
  yMm: number;
  zMm: number;
  xIn: number;
  yIn: number;
  zIn: number;
}

export function StlViewerModal({
  open,
  stlUrl,
  title,
  onClose,
}: StlViewerModalProps): ReactElement | null {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<PieceDimensions | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Referencias mutables para manipular la cámara y controles desde los botones UI
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const materialRef = useRef<MeshStandardMaterial | null>(null);
  const gridRef = useRef<GridHelper | null>(null);
  const fitDistanceRef = useRef<number>(100);

  // Ajustar cámara a una vista predefinida
  const setCameraView = useCallback((type: 'iso' | 'top' | 'front' | 'right' | 'fit') => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    const d = fitDistanceRef.current;
    if (!camera || !controls) return;

    controls.target.set(0, 0, 0);

    switch (type) {
      case 'iso':
      case 'fit':
        camera.position.set(d * 0.75, d * 0.65, d * 0.75);
        camera.up.set(0, 1, 0);
        break;
      case 'top':
        camera.position.set(0, d * 1.35, 0);
        camera.up.set(0, 0, -1);
        break;
      case 'front':
        camera.position.set(0, 0, d * 1.35);
        camera.up.set(0, 1, 0);
        break;
      case 'right':
        camera.position.set(d * 1.35, 0, 0);
        camera.up.set(0, 1, 0);
        break;
    }

    controls.update();
  }, []);

  // Alternar auto-rotación
  const toggleAutoRotate = () => {
    setAutoRotate((prev) => {
      const next = !prev;
      if (controlsRef.current) {
        controlsRef.current.autoRotate = next;
      }
      return next;
    });
  };

  // Alternar modo alambre (wireframe)
  const toggleWireframe = () => {
    setWireframe((prev) => {
      const next = !prev;
      if (materialRef.current) {
        materialRef.current.wireframe = next;
      }
      return next;
    });
  };

  // Alternar rejilla guía
  const toggleGrid = () => {
    setShowGrid((prev) => {
      const next = !prev;
      if (gridRef.current) {
        gridRef.current.visible = next;
      }
      return next;
    });
  };

  useEffect(() => {
    if (!open || !stlUrl || !mountRef.current) {
      return;
    }

    let disposed = false;
    const mount = mountRef.current;
    setStatus('loading');
    setErrorMessage(null);
    setDimensions(null);

    const width = mount.clientWidth || 640;
    const height = mount.clientHeight || 480;

    // ── Escena ──
    const scene = new Scene();
    scene.background = new Color(0x0a0f18); // Dark industrial background

    // ── Cámara inicial ──
    const camera = new PerspectiveCamera(40, width / height, 0.1, 5000);
    camera.position.set(100, 100, 100);
    cameraRef.current = camera;

    // ── Renderer WebGL ──
    const renderer = new WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.domElement.style.touchAction = 'none';
    mount.appendChild(renderer.domElement);

    // ── Controles de Órbita ──
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.8;
    controlsRef.current = controls;

    // ── Iluminación Industrial de Estudio ──
    const ambientLight = new AmbientLight(0xffffff, 0.45);
    scene.add(ambientLight);

    // Key Light (principal cálida)
    const keyLight = new DirectionalLight(0xfffaed, 0.95);
    keyLight.position.set(150, 200, 120);
    scene.add(keyLight);

    // Fill Light (relleno frío)
    const fillLight = new DirectionalLight(0x90b8f8, 0.45);
    fillLight.position.set(-150, 80, -120);
    scene.add(fillLight);

    // Rim Light (luz de contorno azul cian para resaltar biseles y filos)
    const rimLight = new DirectionalLight(0x38bdf8, 0.7);
    rimLight.position.set(-80, -100, 150);
    scene.add(rimLight);

    // ── Material Metálico Satinado (Acero / Aluminio Maquinado) ──
    const material = new MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.58,
      roughness: 0.32,
      wireframe,
    });
    materialRef.current = material;

    let mesh: Mesh | null = null;
    let gridHelper: GridHelper | null = null;
    let frameId = 0;

    const animate = () => {
      if (disposed) return;
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // ── Carga del Archivo STL ──
    const loader = new STLLoader();
    loader.load(
      stlUrl,
      (geometry) => {
        if (disposed) {
          geometry.dispose();
          return;
        }

        // 1. Normales suaves para el sombreado
        geometry.computeVertexNormals();

        // 2. Centrado automático exacto de vértices al origen (0,0,0)
        geometry.center();

        // 3. Medidas de la caja contenedora
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        const box = geometry.boundingBox ?? new Box3().setFromObject(new Mesh(geometry));
        const size = box.getSize(new Vector3());

        const xMm = size.x;
        const yMm = size.y;
        const zMm = size.z;

        setDimensions({
          xMm,
          yMm,
          zMm,
          xIn: xMm / 25.4,
          yIn: yMm / 25.4,
          zIn: zMm / 25.4,
        });

        // 4. Malla
        mesh = new Mesh(geometry, material);
        scene.add(mesh);

        // 5. Plano de cuadrícula guía (GridHelper) en la base de la pieza
        const maxPlaneDim = Math.max(xMm, zMm, 10);
        const gridDim = maxPlaneDim * 2.2;
        gridHelper = new GridHelper(gridDim, 20, 0x0284c7, 0x1e293b);
        gridHelper.position.y = -yMm / 2;
        gridHelper.visible = showGrid;
        scene.add(gridHelper);
        gridRef.current = gridHelper;

        // 6. Cálculo exacto de distancia de cámara para encuadre completo (Zoom-to-fit)
        const radius = geometry.boundingSphere ? geometry.boundingSphere.radius : Math.max(xMm, yMm, zMm) / 2;
        const fovRad = (camera.fov * Math.PI) / 180;
        const aspect = Math.max(camera.aspect, 0.1);
        const vDist = radius / Math.sin(fovRad / 2);
        const hFovRad = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
        const hDist = radius / Math.sin(hFovRad / 2);
        const fitDistance = Math.max(vDist, hDist) * 1.15; // 15% de margen visual cómodo

        fitDistanceRef.current = fitDistance;

        camera.near = Math.max(fitDistance * 0.005, 0.05);
        camera.far = fitDistance * 50;
        camera.position.set(fitDistance * 0.75, fitDistance * 0.65, fitDistance * 0.75);
        camera.updateProjectionMatrix();

        controls.target.set(0, 0, 0);
        controls.minDistance = fitDistance * 0.05;
        controls.maxDistance = fitDistance * 10;
        controls.update();

        // Reposicionar luces al tamaño del modelo
        keyLight.position.set(fitDistance * 1.2, fitDistance * 1.6, fitDistance);
        fillLight.position.set(-fitDistance * 1.2, fitDistance * 0.8, -fitDistance);
        rimLight.position.set(-fitDistance * 0.8, -fitDistance * 0.8, fitDistance * 1.2);

        setStatus('ready');
      },
      undefined,
      (err) => {
        if (disposed) return;
        log.warn('[smv-vision][stl] load failed', err);
        setStatus('error');
        setErrorMessage('No fue posible cargar el modelo STL. Verifica la conexión o disponibilidad del archivo.');
      },
    );

    const onResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', onResize);
      controls.dispose();
      if (mesh) {
        mesh.geometry.dispose();
        scene.remove(mesh);
      }
      if (gridHelper) {
        gridHelper.geometry.dispose();
        scene.remove(gridHelper);
      }
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [open, stlUrl]);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'f' || event.key === 'F') setCameraView('fit');
      if (event.key === 'r' || event.key === 'R') toggleAutoRotate();
      if (event.key === 'w' || event.key === 'W') toggleWireframe();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, setCameraView]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-0 sm:p-4 md:p-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`Vista 3D ${title}`}
      onClick={onClose}
    >
      <div
        className={`flex w-full flex-col border-2 border-line bg-surface shadow-hard-accent rounded-none overflow-hidden transition-all ${
          isFullscreen
            ? 'fixed inset-0 z-50 h-full max-w-none border-0'
            : 'h-full sm:h-[min(90vh,800px)] sm:max-w-5xl'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Encabezado ── */}
        <header className="flex items-center justify-between border-b-2 border-line bg-[#0D2B4D] text-white px-4 sm:px-5 py-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="size-8 bg-accent text-bg flex items-center justify-center font-bold shrink-0">
              <Box size={18} />
            </div>
            <div className="min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-widest text-white/70">
                Visor 3D · Malla STL
              </p>
              <h2 className="font-display text-base sm:text-lg font-black uppercase tracking-tight text-white leading-tight truncate">
                {title}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setIsFullscreen((prev) => !prev)}
              className="h-8 w-8 rounded-none border-2 border-white/40 bg-transparent text-white hover:bg-white/10 transition-colors flex items-center justify-center hidden sm:flex"
              title={isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa'}
              aria-label="Pantalla completa"
            >
              {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-none border-2 border-white/40 bg-transparent text-white hover:bg-accent hover:border-accent hover:text-bg transition-colors flex items-center justify-center"
              title="Cerrar (ESC)"
              aria-label="Cerrar"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        {/* ── Contenedor Canvas 3D + Barra de Herramientas Flotante ── */}
        <div className="relative min-h-0 flex-1 bg-[#0A0F18]" ref={mountRef}>
          {status === 'loading' && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 font-mono text-xs uppercase text-ink-dim bg-[#0A0F18]/90">
              <Loader2 className="animate-spin text-accent" size={28} />
              <span>Cargando geometría y renderizando pieza 3D…</span>
            </div>
          )}

          {status === 'error' && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center font-mono text-xs text-danger bg-[#0A0F18]/95">
              {errorMessage}
            </div>
          )}

          {/* Barra de Controles y Vistas Flotante (Arriba a la izquierda) */}
          {status === 'ready' && (
            <div className="absolute top-3 left-3 z-20 flex flex-wrap items-center gap-1 bg-surface/90 backdrop-blur border-2 border-line p-1 shadow-hard">
              <button
                type="button"
                onClick={() => setCameraView('iso')}
                className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider border border-line bg-surface-2 text-ink hover:bg-accent hover:text-bg hover:border-accent transition-colors"
                title="Vista Isométrica"
              >
                ISO
              </button>
              <button
                type="button"
                onClick={() => setCameraView('top')}
                className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider border border-line bg-surface-2 text-ink hover:bg-accent hover:text-bg hover:border-accent transition-colors"
                title="Vista Superior (Planta)"
              >
                TOP
              </button>
              <button
                type="button"
                onClick={() => setCameraView('front')}
                className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider border border-line bg-surface-2 text-ink hover:bg-accent hover:text-bg hover:border-accent transition-colors"
                title="Vista Frontal"
              >
                FRONT
              </button>
              <button
                type="button"
                onClick={() => setCameraView('right')}
                className="px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider border border-line bg-surface-2 text-ink hover:bg-accent hover:text-bg hover:border-accent transition-colors"
                title="Vista Lateral Derecha"
              >
                LATERAL
              </button>

              <div className="h-4 w-[1px] bg-line mx-0.5" />

              <button
                type="button"
                onClick={() => setCameraView('fit')}
                className="p-1 border border-line bg-surface-2 text-ink hover:bg-accent hover:text-bg hover:border-accent transition-colors"
                title="Centrar y Ajustar Vista (Tecla F)"
                aria-label="Ajustar"
              >
                <Focus size={13} />
              </button>
              <button
                type="button"
                onClick={toggleAutoRotate}
                className={`p-1 border transition-colors ${
                  autoRotate
                    ? 'bg-accent text-bg border-accent'
                    : 'border-line bg-surface-2 text-ink hover:bg-accent hover:text-bg hover:border-accent'
                }`}
                title="Auto-Giro 360° (Tecla R)"
                aria-label="Auto rotación"
              >
                <RotateCw size={13} className={autoRotate ? 'animate-spin' : ''} />
              </button>
              <button
                type="button"
                onClick={toggleWireframe}
                className={`p-1 border transition-colors ${
                  wireframe
                    ? 'bg-accent text-bg border-accent'
                    : 'border-line bg-surface-2 text-ink hover:bg-accent hover:text-bg hover:border-accent'
                }`}
                title="Modo Malla / Wireframe (Tecla W)"
                aria-label="Malla"
              >
                <Layers size={13} />
              </button>
              <button
                type="button"
                onClick={toggleGrid}
                className={`p-1 border transition-colors ${
                  showGrid
                    ? 'bg-accent text-bg border-accent'
                    : 'border-line bg-surface-2 text-ink hover:bg-accent hover:text-bg hover:border-accent'
                }`}
                title="Cuadrícula Guía"
                aria-label="Cuadrícula"
              >
                <Grid size={13} />
              </button>
            </div>
          )}

          {/* Indicador de ayuda táctil flotante */}
          {status === 'ready' && (
            <div className="absolute bottom-3 right-3 z-20 pointer-events-none hidden md:block">
              <span className="font-mono text-[9px] uppercase tracking-wider text-white/50 bg-black/60 px-2 py-1 border border-white/10 backdrop-blur">
                1 Dedo / Clic: Rotar · 2 Dedos / Rueda: Zoom & Paneo
              </span>
            </div>
          )}
        </div>

        {/* ── Pie de Página: Cotas en Pulgadas + mm ── */}
        <footer className="border-t-2 border-line px-4 sm:px-5 py-2.5 bg-surface-2 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 shrink-0">
          <div className="font-mono text-[11px] text-ink flex items-center gap-2 flex-wrap">
            <span className="text-ink-dim uppercase text-[10px] font-bold tracking-wider">
              Dimensiones (Bounding Box):
            </span>
            {dimensions ? (
              <span className="font-bold text-accent">
                X: {dimensions.xIn.toFixed(3)}&quot; <span className="text-ink-dim font-normal">({dimensions.xMm.toFixed(1)} mm)</span> ·
                Y: {dimensions.yIn.toFixed(3)}&quot; <span className="text-ink-dim font-normal">({dimensions.yMm.toFixed(1)} mm)</span> ·
                Z: {dimensions.zIn.toFixed(3)}&quot; <span className="text-ink-dim font-normal">({dimensions.zMm.toFixed(1)} mm)</span>
              </span>
            ) : (
              <span className="text-ink-dim font-normal">Calculando dimensiones…</span>
            )}
          </div>

          <div className="flex items-center gap-3 text-ink-dim font-mono text-[10px] self-end sm:self-auto">
            <span className="text-ink-dim hidden lg:inline">No sustituye el plano CAD acotado.</span>
            <span className="text-accent font-bold uppercase tracking-wider bg-accent/10 px-2 py-0.5 border border-accent/30">
              Three.js WebGL
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}

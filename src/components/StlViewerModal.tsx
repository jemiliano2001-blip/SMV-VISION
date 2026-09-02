/**
 * Visor 3D de alta precisión para STL (export eDrawings / Tool Crib).
 * 
 * Características:
 * - Calibrador 3D con Snap Magnético Inteligente a vértices y esquinas de mecanizado.
 * - Desglose de cotas de taller: distancia euclidiana directa y carros ortogonales (ΔX, ΔY, ΔZ) para torno y fresa.
 * - Corrección automática de escala STL (metros x1000 típico de eDrawings) con selector manual.
 * - Cota 3D en la pieza con etiqueta flotante y tarjeta HUD industrial de alta visibilidad.
 * - Auto-encuadre geométrico preciso (bounding sphere + FOV horizontal/vertical).
 * - Estudio de iluminación industrial con rim-lighting y reflejos metálicos.
 * - Dimensiones en pulgadas (primario) y milímetros (secundario).
 * - Controles de cámara: ISO, Superior, Frontal, Lateral, Auto-giro, Malla y Reset.
 * - Soporte táctil móvil y discriminación de rotación vs clic.
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
  Ruler,
  RotateCcw,
  Copy,
  Check,
} from 'lucide-react';
import {
  AmbientLight,
  Box3,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  GridHelper,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  RingGeometry,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferAttribute,
} from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { log } from '../lib/log';
import {
  detectStlUnitScale,
  calculateStlMeasurement,
  findClosestVertexSnap,
  type StlMeasurementResult,
  type StlScaleInfo,
} from '../lib/stlMeasurement';

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
  const badgeElRef = useRef<HTMLDivElement | null>(null);

  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<PieceDimensions | null>(null);
  const [autoRotate, setAutoRotate] = useState(false);
  const [wireframe, setWireframe] = useState(false);
  const [showGrid, setShowGrid] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // ── Estados de Escala y Unidades ──
  const [scaleMode, setScaleMode] = useState<'auto' | 'meters' | 'mm' | 'inches'>('auto');
  const [detectedScale, setDetectedScale] = useState<StlScaleInfo | null>(null);

  // ── Estados de la Herramienta de Medición (Calibrador 3D) ──
  const [isMeasuring, setIsMeasuring] = useState(false);
  const [measureStep, setMeasureStep] = useState<'idle' | 'picking_first' | 'picking_second' | 'measured'>('idle');
  const [measurement, setMeasurement] = useState<StlMeasurementResult | null>(null);
  const [liveMeasurement, setLiveMeasurement] = useState<StlMeasurementResult | null>(null);
  const [midpointScreenPos, setMidpointScreenPos] = useState<{ x: number; y: number; visible: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  // ── Referencias Mutables Three.js ──
  const controlsRef = useRef<OrbitControls | null>(null);
  const cameraRef = useRef<PerspectiveCamera | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const materialRef = useRef<MeshStandardMaterial | null>(null);
  const meshRef = useRef<Mesh | null>(null);
  const rawGeometryRef = useRef<BufferGeometry | null>(null);
  const gridRef = useRef<GridHelper | null>(null);
  const fitDistanceRef = useRef<number>(100);
  const lightsRef = useRef<{ key: DirectionalLight; fill: DirectionalLight; rim: DirectionalLight } | null>(null);

  // Espejo de `showGrid` para que el re-encuadre no dependa del estado en su
  // lista de dependencias (se llama desde dentro del loader de Three.js).
  const showGridRef = useRef(showGrid);
  showGridRef.current = showGrid;

  // Referencias mutables para el ciclo de medición
  const isMeasuringRef = useRef(isMeasuring);
  isMeasuringRef.current = isMeasuring;

  const measureStepRef = useRef(measureStep);
  measureStepRef.current = measureStep;

  const pointARef = useRef<Vector3 | null>(null);
  const pointBRef = useRef<Vector3 | null>(null);
  const currentSnappedPointRef = useRef<Vector3 | null>(null);
  const dragStartPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Objetos 3D del Calibrador
  const measureGroupRef = useRef<Group | null>(null);
  const snapCursorMeshRef = useRef<Mesh | null>(null);
  const markerAMeshRef = useRef<Mesh | null>(null);
  const markerBMeshRef = useRef<Mesh | null>(null);
  const dimensionLineMeshRef = useRef<Mesh | null>(null);

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

  /**
   * Factor de escala a milímetros según el modo elegido (o el detectado en `auto`).
   */
  const resolveScaleMultiplier = useCallback(
    (detected: StlScaleInfo | null): number => {
      if (scaleMode === 'auto') return detected?.scaleMultiplier ?? 1;
      if (scaleMode === 'meters') return 1000;
      if (scaleMode === 'inches') return 25.4;
      return 1;
    },
    [scaleMode],
  );

  /**
   * Recalcula TODO lo que depende del tamaño real de la malla: cotas mostradas,
   * rejilla guía, distancia de encuadre, escala de los marcadores del calibrador,
   * planos near/far, límites de OrbitControls y posición de las luces.
   *
   * Debe llamarse tanto al cargar el STL como al cambiar la escala a mano. Si no,
   * `fitDistanceRef` conserva el valor de la carga y todo lo proporcional se rompe:
   * el umbral de snap (`fitDistance * 0.045`) deja de enganchar, los marcadores
   * quedan microscópicos y con un cambio grande (x1000) la pieza se sale del far plane.
   */
  const fitSceneToGeometry = useCallback((geometry: BufferGeometry) => {
    const scene = sceneRef.current;
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!scene || !camera || !controls) return;

    if (!geometry.boundingBox) geometry.computeBoundingBox();
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();

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

    // El tamaño de un GridHelper se fija al construirlo, así que para reescalarlo
    // hay que recrearlo (y liberar el anterior).
    const prevGrid = gridRef.current;
    const gridVisible = prevGrid ? prevGrid.visible : showGridRef.current;
    if (prevGrid) {
      scene.remove(prevGrid);
      prevGrid.geometry.dispose();
      const gridMat = prevGrid.material;
      if (Array.isArray(gridMat)) {
        gridMat.forEach((m) => m.dispose());
      } else {
        gridMat.dispose();
      }
    }
    const gridDim = Math.max(xMm, zMm, 10) * 2.2;
    const grid = new GridHelper(gridDim, 20, 0x0284c7, 0x1e293b);
    grid.position.y = -yMm / 2;
    grid.visible = gridVisible;
    scene.add(grid);
    gridRef.current = grid;

    // Cálculo exacto de distancia de cámara para encuadre completo (Zoom-to-fit)
    const radius = geometry.boundingSphere
      ? geometry.boundingSphere.radius
      : Math.max(xMm, yMm, zMm) / 2;
    const fovRad = (camera.fov * Math.PI) / 180;
    const aspect = Math.max(camera.aspect, 0.1);
    const vDist = radius / Math.sin(fovRad / 2);
    const hFovRad = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
    const hDist = radius / Math.sin(hFovRad / 2);
    const fitDistance = Math.max(vDist, hDist) * 1.15;

    fitDistanceRef.current = fitDistance;

    // Escalar los marcadores 3D proporcionalmente a la pieza
    const markerScale = Math.max(fitDistance * 0.007, 0.15);
    snapCursorMeshRef.current?.scale.setScalar(markerScale);
    markerAMeshRef.current?.scale.setScalar(markerScale * 1.15);
    markerBMeshRef.current?.scale.setScalar(markerScale * 1.15);

    camera.near = Math.max(fitDistance * 0.005, 0.05);
    camera.far = fitDistance * 50;
    camera.position.set(fitDistance * 0.75, fitDistance * 0.65, fitDistance * 0.75);
    camera.up.set(0, 1, 0);
    camera.updateProjectionMatrix();

    controls.target.set(0, 0, 0);
    controls.minDistance = fitDistance * 0.05;
    controls.maxDistance = fitDistance * 10;
    controls.update();

    // Reposicionar luces al tamaño del modelo
    const lights = lightsRef.current;
    if (lights) {
      lights.key.position.set(fitDistance * 1.2, fitDistance * 1.6, fitDistance);
      lights.fill.position.set(-fitDistance * 1.2, fitDistance * 0.8, -fitDistance);
      lights.rim.position.set(-fitDistance * 0.8, -fitDistance * 0.8, fitDistance * 1.2);
    }
  }, []);

  // El efecto que monta la escena descarga el STL de la red, así que NO puede
  // depender de `scaleMode` (cambiar la escala volvería a bajar el archivo).
  // Estos espejos le dan acceso a la versión actual sin ensuciar sus dependencias.
  const fitSceneToGeometryRef = useRef(fitSceneToGeometry);
  fitSceneToGeometryRef.current = fitSceneToGeometry;

  const resolveScaleMultiplierRef = useRef(resolveScaleMultiplier);
  resolveScaleMultiplierRef.current = resolveScaleMultiplier;

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

  // Limpiar geometría 3D de medición
  const clearMeasurement3D = useCallback(() => {
    pointARef.current = null;
    pointBRef.current = null;
    currentSnappedPointRef.current = null;

    if (markerAMeshRef.current) markerAMeshRef.current.visible = false;
    if (markerBMeshRef.current) markerBMeshRef.current.visible = false;
    if (dimensionLineMeshRef.current) dimensionLineMeshRef.current.visible = false;
    if (snapCursorMeshRef.current) snapCursorMeshRef.current.visible = false;

    setMeasurement(null);
    setLiveMeasurement(null);
    setMidpointScreenPos(null);
  }, []);

  // Reiniciar a nueva medición
  const handleNewMeasurement = useCallback(() => {
    clearMeasurement3D();
    setMeasureStep('picking_first');
  }, [clearMeasurement3D]);

  // Alternar modo medir
  const toggleMeasuring = useCallback(() => {
    setIsMeasuring((prev) => {
      const next = !prev;
      if (next) {
        setMeasureStep('picking_first');
      } else {
        clearMeasurement3D();
        setMeasureStep('idle');
      }
      return next;
    });
  }, [clearMeasurement3D]);

  // Copiar medición al portapapeles
  const handleCopyMeasurement = useCallback(() => {
    if (!measurement) return;
    const text = `[MEDIDA 3D // ${title}]\nDistancia Directa: ${measurement.distance.inFormatted} (${measurement.distance.mmFormatted})\nΔX: ${measurement.deltaX.inFormatted} (${measurement.deltaX.mmFormatted})\nΔY: ${measurement.deltaY.inFormatted} (${measurement.deltaY.mmFormatted})\nΔZ: ${measurement.deltaZ.inFormatted} (${measurement.deltaZ.mmFormatted})`;

    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [measurement, title]);

  // Función utilitaria para actualizar el cilindro de la línea de cota
  const updateDimensionCylinder = (p1: Vector3, p2: Vector3, radius: number) => {
    const cylinder = dimensionLineMeshRef.current;
    if (!cylinder) return;

    const dist = p1.distanceTo(p2);
    if (dist < 0.0001) {
      cylinder.visible = false;
      return;
    }

    cylinder.scale.set(radius, dist, radius);
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    cylinder.position.copy(mid);

    const dir = p2.clone().sub(p1).normalize();
    const up = new Vector3(0, 1, 0);
    cylinder.quaternion.setFromUnitVectors(up, dir);
    cylinder.visible = true;
  };

  // Actualizar la posición 2D de la etiqueta flotante en pantalla
  const updateBadgeScreenPos = useCallback((p1: Vector3, p2: Vector3) => {
    const camera = cameraRef.current;
    const mount = mountRef.current;
    if (!camera || !mount) return;

    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    const projected = mid.project(camera);

    const isVisible = projected.z < 1.0;
    const width = mount.clientWidth || 640;
    const height = mount.clientHeight || 480;

    const screenX = (projected.x * 0.5 + 0.5) * width;
    const screenY = (-(projected.y * 0.5) + 0.5) * height;

    setMidpointScreenPos({
      x: screenX,
      y: screenY,
      visible: isVisible,
    });
  }, []);

  // ── Carga y Montaje de Three.js ──
  useEffect(() => {
    if (!open || !stlUrl || !mountRef.current) {
      return;
    }

    let disposed = false;
    const mount = mountRef.current;
    setStatus('loading');
    setErrorMessage(null);
    setDimensions(null);
    clearMeasurement3D();

    const width = mount.clientWidth || 640;
    const height = mount.clientHeight || 480;

    // ── Escena ──
    const scene = new Scene();
    scene.background = new Color(0x0a0f18);
    sceneRef.current = scene;

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

    const keyLight = new DirectionalLight(0xfffaed, 0.95);
    keyLight.position.set(150, 200, 120);
    scene.add(keyLight);

    const fillLight = new DirectionalLight(0x90b8f8, 0.45);
    fillLight.position.set(-150, 80, -120);
    scene.add(fillLight);

    const rimLight = new DirectionalLight(0x38bdf8, 0.7);
    rimLight.position.set(-80, -100, 150);
    scene.add(rimLight);

    lightsRef.current = { key: keyLight, fill: fillLight, rim: rimLight };

    // ── Material Metálico Satinado ──
    const material = new MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.58,
      roughness: 0.32,
      wireframe,
    });
    materialRef.current = material;

    let mesh: Mesh | null = null;
    let frameId = 0;

    // ── Grupo 3D de Medición y Marcadores ──
    const measureGroup = new Group();
    scene.add(measureGroup);
    measureGroupRef.current = measureGroup;

    // 1. Cursor de Snap (resalta vértices al pasar el ratón)
    const snapSphereGeo = new SphereGeometry(1, 16, 16);
    const snapSphereMat = new MeshBasicMaterial({
      color: 0x00f0ff,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });
    const snapCursor = new Mesh(snapSphereGeo, snapSphereMat);
    snapCursor.renderOrder = 999;
    snapCursor.visible = false;
    measureGroup.add(snapCursor);
    snapCursorMeshRef.current = snapCursor;

    // Aro exterior del cursor de snap
    const ringGeo = new RingGeometry(1.2, 1.6, 16);
    const ringMat = new MeshBasicMaterial({ color: 0x38bdf8, depthTest: false, side: 2 });
    const snapRing = new Mesh(ringGeo, ringMat);
    snapCursor.add(snapRing);

    // 2. Marcador Punto A (Cyan de inicio)
    const markerAMat = new MeshBasicMaterial({ color: 0x00f0ff, depthTest: false });
    const markerA = new Mesh(snapSphereGeo, markerAMat);
    markerA.renderOrder = 999;
    markerA.visible = false;
    measureGroup.add(markerA);
    markerAMeshRef.current = markerA;

    // 3. Marcador Punto B (Naranja de fin)
    const markerBMat = new MeshBasicMaterial({ color: 0xf97316, depthTest: false });
    const markerB = new Mesh(snapSphereGeo, markerBMat);
    markerB.renderOrder = 999;
    markerB.visible = false;
    measureGroup.add(markerB);
    markerBMeshRef.current = markerB;

    // 4. Línea de Cota 3D (Cilindro para grosor consistente en WebGL)
    const lineGeo = new CylinderGeometry(1, 1, 1, 8);
    const lineMat = new MeshBasicMaterial({ color: 0x38bdf8, depthTest: false });
    const dimensionLine = new Mesh(lineGeo, lineMat);
    dimensionLine.renderOrder = 998;
    dimensionLine.visible = false;
    measureGroup.add(dimensionLine);
    dimensionLineMeshRef.current = dimensionLine;

    // Actualizar proyección de cota en cada movimiento de cámara
    controls.addEventListener('change', () => {
      if (pointARef.current && pointBRef.current) {
        updateBadgeScreenPos(pointARef.current, pointBRef.current);
      } else if (pointARef.current && currentSnappedPointRef.current) {
        updateBadgeScreenPos(pointARef.current, currentSnappedPointRef.current);
      }
    });

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

        // 1. Normales suaves y centrado
        geometry.computeVertexNormals();
        geometry.center();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();

        // 2. Guardar clon sin escalar para cambios de escala instantáneos
        rawGeometryRef.current = geometry.clone();

        // 3. Detección automática de escala (metros x1000)
        const rawBox = geometry.boundingBox ?? new Box3().setFromObject(new Mesh(geometry));
        const rawSize = rawBox.getSize(new Vector3());
        const detected = detectStlUnitScale(rawSize);
        setDetectedScale(detected);

        // 4. Aplicar factor de escala para normalizar a milímetros reales
        const multiplier = resolveScaleMultiplierRef.current(detected);

        if (multiplier !== 1) {
          geometry.scale(multiplier, multiplier, multiplier);
          geometry.computeBoundingBox();
          geometry.computeBoundingSphere();
        }

        // 5. Malla
        mesh = new Mesh(geometry, material);
        meshRef.current = mesh;
        scene.add(mesh);

        // 6. Cotas, rejilla, encuadre, marcadores y luces (todo lo proporcional al tamaño)
        fitSceneToGeometryRef.current(geometry);

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

    // ── Raycasting y Eventos de Puntero para Medición con Snap ──
    const raycaster = new Raycaster();
    const mouseVector = new Vector2();

    const onPointerDown = (e: PointerEvent) => {
      dragStartPosRef.current = { x: e.clientX, y: e.clientY };
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!isMeasuringRef.current || !meshRef.current) return;

      const rect = mount.getBoundingClientRect();
      const mouseX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const mouseY = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      mouseVector.set(mouseX, mouseY);

      raycaster.setFromCamera(mouseVector, camera);
      const intersects = raycaster.intersectObject(meshRef.current, false);

      if (intersects.length > 0 && intersects[0].face) {
        const hit = intersects[0];
        const geom = meshRef.current.geometry as BufferGeometry;
        const posAttr = geom.attributes.position as BufferAttribute;

        // Snap a vértice más cercano (radio proporcional al tamaño de la pieza)
        const snapThreshold = fitDistanceRef.current * 0.045;
        const snap = findClosestVertexSnap(hit.point, hit.face, posAttr, snapThreshold);

        currentSnappedPointRef.current = snap.point;
        snapCursor.position.copy(snap.point);
        snapCursor.visible = true;

        // Si estamos buscando el Punto B, actualizar línea y distancia previa en tiempo real
        if (measureStepRef.current === 'picking_second' && pointARef.current) {
          const pA = pointARef.current;
          const pB = snap.point;
          const lineRadius = Math.max(fitDistanceRef.current * 0.0018, 0.08);
          updateDimensionCylinder(pA, pB, lineRadius);

          const liveResult = calculateStlMeasurement(pA, pB);
          setLiveMeasurement(liveResult);
          updateBadgeScreenPos(pA, pB);
        }
      } else {
        currentSnappedPointRef.current = null;
        if (measureStepRef.current !== 'measured') {
          snapCursor.visible = false;
        }
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!isMeasuringRef.current) return;

      // Discriminar arrastre de cámara vs clic puntual (umbral de 6px)
      const distMoved = Math.hypot(
        e.clientX - dragStartPosRef.current.x,
        e.clientY - dragStartPosRef.current.y
      );
      if (distMoved > 6) {
        return; // Fue una rotación/paneo de cámara, ignorar clic
      }

      const hitPoint = currentSnappedPointRef.current;
      if (!hitPoint) return;

      const currentStep = measureStepRef.current;

      if (currentStep === 'idle' || currentStep === 'picking_first') {
        // Fijar Punto A
        pointARef.current = hitPoint.clone();
        markerA.position.copy(hitPoint);
        markerA.visible = true;
        setMeasureStep('picking_second');
      } else if (currentStep === 'picking_second') {
        // Fijar Punto B y bloquear la cota
        if (!pointARef.current) return;
        pointBRef.current = hitPoint.clone();
        markerB.position.copy(hitPoint);
        markerB.visible = true;

        const lineRadius = Math.max(fitDistanceRef.current * 0.0022, 0.1);
        updateDimensionCylinder(pointARef.current, pointBRef.current, lineRadius);

        const finalResult = calculateStlMeasurement(pointARef.current, pointBRef.current);
        setMeasurement(finalResult);
        setMeasureStep('measured');
        snapCursor.visible = false;
        updateBadgeScreenPos(pointARef.current, pointBRef.current);
      } else if (currentStep === 'measured') {
        // Un nuevo clic inicia otra medida desde este punto
        clearMeasurement3D();
        pointARef.current = hitPoint.clone();
        markerA.position.copy(hitPoint);
        markerA.visible = true;
        setMeasureStep('picking_second');
      }
    };

    mount.addEventListener('pointerdown', onPointerDown);
    mount.addEventListener('pointermove', onPointerMove);
    mount.addEventListener('pointerup', onPointerUp);

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
      mount.removeEventListener('pointerdown', onPointerDown);
      mount.removeEventListener('pointermove', onPointerMove);
      mount.removeEventListener('pointerup', onPointerUp);
      controls.dispose();

      if (mesh) {
        mesh.geometry.dispose();
        scene.remove(mesh);
      }
      // `fitSceneToGeometry` recrea la rejilla en cada cambio de escala, así que
      // hay que liberar la que esté viva en el ref, no una copia local obsoleta.
      const liveGrid = gridRef.current;
      if (liveGrid) {
        liveGrid.geometry.dispose();
        const gridMat = liveGrid.material;
        if (Array.isArray(gridMat)) {
          gridMat.forEach((m) => m.dispose());
        } else {
          gridMat.dispose();
        }
        scene.remove(liveGrid);
        gridRef.current = null;
      }
      if (rawGeometryRef.current) {
        rawGeometryRef.current.dispose();
        rawGeometryRef.current = null;
      }
      snapSphereGeo.dispose();
      snapSphereMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      markerAMat.dispose();
      markerBMat.dispose();
      lineGeo.dispose();
      lineMat.dispose();

      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [open, stlUrl, clearMeasurement3D, updateBadgeScreenPos]);

  // ── Cambio Instantáneo de Escala sin recargar de la red ──
  useEffect(() => {
    if (!meshRef.current || !rawGeometryRef.current || !cameraRef.current) return;

    const raw = rawGeometryRef.current.clone();
    const multiplier = resolveScaleMultiplier(detectedScale);

    if (multiplier !== 1) {
      raw.scale(multiplier, multiplier, multiplier);
    }
    raw.computeBoundingBox();
    raw.computeBoundingSphere();

    meshRef.current.geometry.dispose();
    meshRef.current.geometry = raw;

    // Reencuadrar: cotas, rejilla, distancia de encuadre, umbral de snap,
    // near/far y luces dependen todos del tamaño, que acaba de cambiar.
    fitSceneToGeometry(raw);

    // Limpiar medición activa ya que cambió la escala
    clearMeasurement3D();
  }, [scaleMode, detectedScale, clearMeasurement3D, fitSceneToGeometry, resolveScaleMultiplier]);

  // ── Atajos de Teclado ──
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (isMeasuring && measureStep !== 'idle') {
          handleNewMeasurement();
        } else {
          onClose();
        }
      }
      if (event.key === 'm' || event.key === 'M') toggleMeasuring();
      if (event.key === 'c' || event.key === 'C') handleNewMeasurement();
      if (event.key === 'f' || event.key === 'F') setCameraView('fit');
      if (event.key === 'r' || event.key === 'R') toggleAutoRotate();
      if (event.key === 'w' || event.key === 'W') toggleWireframe();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose, isMeasuring, measureStep, toggleMeasuring, handleNewMeasurement, setCameraView]);

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
            : 'h-full sm:h-[min(90vh,820px)] sm:max-w-5xl'
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
        <div
          className={`relative min-h-0 flex-1 bg-[#0A0F18] select-none ${
            isMeasuring ? 'cursor-crosshair' : ''
          }`}
          ref={mountRef}
        >
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

              {/* Botón Herramienta de Medición / Calibrador 3D */}
              <button
                type="button"
                onClick={toggleMeasuring}
                className={`px-2.5 py-1 text-[10px] font-mono font-bold uppercase tracking-wider border flex items-center gap-1.5 transition-colors ${
                  isMeasuring
                    ? 'bg-accent text-bg border-accent shadow-hard-accent'
                    : 'border-line bg-surface-2 text-ink hover:bg-accent hover:text-bg hover:border-accent'
                }`}
                title="Herramienta de Medición / Calibrador 3D (Tecla M)"
                aria-label="Medir"
              >
                <Ruler size={13} />
                <span>{isMeasuring ? 'Midiendo' : 'Medir'}</span>
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

          {/* ── Etiqueta 3D Flotante en el Punto Medio de la Cota ── */}
          {midpointScreenPos && midpointScreenPos.visible && (measureStep === 'measured' || (measureStep === 'picking_second' && liveMeasurement)) && (
            <div
              ref={badgeElRef}
              className="absolute pointer-events-none z-20 -translate-x-1/2 -translate-y-1/2 px-2.5 py-1 bg-[#0D2B4D]/95 border border-accent text-white font-mono text-[11px] font-bold shadow-hard backdrop-blur flex items-center gap-1.5 whitespace-nowrap"
              style={{ left: `${midpointScreenPos.x}px`, top: `${midpointScreenPos.y}px` }}
            >
              <span className="size-1.5 rounded-full bg-accent animate-pulse" />
              <span>
                {measureStep === 'measured' && measurement
                  ? measurement.distance.inFormatted
                  : liveMeasurement?.distance.inFormatted}
              </span>
              <span className="text-white/60 font-normal text-[10px]">
                (
                {measureStep === 'measured' && measurement
                  ? measurement.distance.mmFormatted
                  : liveMeasurement?.distance.mmFormatted}
                )
              </span>
            </div>
          )}

          {/* ── Tarjeta Flotante HUD Industrial del Calibrador 3D ── */}
          {status === 'ready' && isMeasuring && (
            <div className="absolute top-3 sm:top-14 right-3 z-30 w-72 sm:w-80 bg-[#0A0F18]/95 backdrop-blur-md border-2 border-line shadow-hard-accent text-ink font-mono text-xs overflow-hidden select-none animate-in fade-in duration-150">
              <div className="flex items-center justify-between px-3 py-2 bg-[#0D2B4D] border-b-2 border-line text-white">
                <div className="flex items-center gap-2">
                  <Ruler size={14} className="text-accent" />
                  <span className="font-bold uppercase tracking-wider text-[11px]">
                    Calibrador 3D // Taller
                  </span>
                </div>
                <button
                  type="button"
                  onClick={toggleMeasuring}
                  className="p-1 text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                  title="Cerrar calibrador (ESC)"
                  aria-label="Cerrar calibrador"
                >
                  <X size={13} />
                </button>
              </div>

              <div className="p-3 space-y-3">
                {measureStep === 'picking_first' && (
                  <div className="space-y-1.5 text-ink-dim">
                    <p className="font-bold text-accent uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-accent animate-ping" />
                      Paso 1: Fija el Punto A
                    </p>
                    <p className="text-[11px] leading-snug">
                      Pasa el cursor sobre la pieza y haz clic en la primera esquina o filo. El imán cyan resalta los vértices automáticamente.
                    </p>
                  </div>
                )}

                {measureStep === 'picking_second' && (
                  <div className="space-y-2 text-ink-dim">
                    <p className="font-bold text-accent uppercase text-[10px] tracking-wider flex items-center gap-1.5">
                      <span className="size-2 rounded-full bg-accent animate-pulse" />
                      Paso 2: Fija el Punto B
                    </p>
                    <p className="text-[11px] leading-snug">
                      Haz clic en el segundo punto. Puedes rotar y acercar la pieza con normalidad para ver caras ocultas.
                    </p>
                    {liveMeasurement && (
                      <div className="mt-2 pt-2 border-t border-line/60 flex items-center justify-between text-[11px]">
                        <span className="text-ink-dim uppercase text-[9px] font-bold tracking-wider">Distancia previa:</span>
                        <span className="font-bold text-accent">
                          {liveMeasurement.distance.inFormatted}{' '}
                          <span className="text-ink-dim font-normal">({liveMeasurement.distance.mmFormatted})</span>
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {measureStep === 'measured' && measurement && (
                  <div className="space-y-3">
                    {/* Cota principal directa */}
                    <div className="bg-surface-2 p-2.5 border border-line">
                      <span className="text-[9px] uppercase tracking-widest text-ink-dim font-bold block mb-0.5">
                        Distancia Directa (Largo L)
                      </span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-xl font-black text-accent tracking-tight">
                          {measurement.distance.inFormatted}
                        </span>
                        <span className="text-ink-dim text-xs font-normal">
                          ({measurement.distance.mmFormatted})
                        </span>
                      </div>
                    </div>

                    {/* Desglose de carros de torno / ejes ortogonales */}
                    <div>
                      <span className="text-[9px] uppercase tracking-widest text-ink-dim font-bold block mb-1">
                        Desglose de Carros (Torno / Fresa)
                      </span>
                      <div className="grid grid-cols-3 gap-1 text-center font-mono text-[10px]">
                        <div className="bg-surface-2 p-1.5 border border-line">
                          <span className="text-ink-dim block font-bold text-[9px]">ΔX (Diámetro)</span>
                          <span className="font-bold text-ink block mt-0.5">{measurement.deltaX.inFormatted}</span>
                          <span className="text-ink-dim text-[9px] block">({measurement.deltaX.mmFormatted})</span>
                        </div>
                        <div className="bg-surface-2 p-1.5 border border-line">
                          <span className="text-ink-dim block font-bold text-[9px]">ΔY (Carro Z)</span>
                          <span className="font-bold text-ink block mt-0.5">{measurement.deltaY.inFormatted}</span>
                          <span className="text-ink-dim text-[9px] block">({measurement.deltaY.mmFormatted})</span>
                        </div>
                        <div className="bg-surface-2 p-1.5 border border-line">
                          <span className="text-ink-dim block font-bold text-[9px]">ΔZ (Profund.)</span>
                          <span className="font-bold text-ink block mt-0.5">{measurement.deltaZ.inFormatted}</span>
                          <span className="text-ink-dim text-[9px] block">({measurement.deltaZ.mmFormatted})</span>
                        </div>
                      </div>
                    </div>

                    {/* Botones de acción */}
                    <div className="flex items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={handleNewMeasurement}
                        className="flex-1 py-1.5 px-2 bg-accent text-bg font-bold uppercase tracking-wider text-[10px] border border-accent hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw size={12} />
                        Nueva Medida (C)
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyMeasurement}
                        className="py-1.5 px-2.5 bg-surface-2 text-ink hover:bg-surface border border-line transition-colors flex items-center justify-center gap-1 text-[10px] font-bold uppercase"
                        title="Copiar cotas al portapapeles"
                      >
                        {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                        {copied ? 'Copiado' : 'Copiar'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Pie de ayuda del HUD */}
              <div className="px-3 py-1.5 bg-surface-2/70 border-t border-line text-[9px] text-ink-dim flex items-center justify-between">
                <span>Imán: Snap a vértice activo</span>
                <span>ESC: Cancelar</span>
              </div>
            </div>
          )}

          {/* Indicador de ayuda táctil flotante */}
          {status === 'ready' && !isMeasuring && (
            <div className="absolute bottom-3 right-3 z-20 pointer-events-none hidden md:block">
              <span className="font-mono text-[9px] uppercase tracking-wider text-white/50 bg-black/60 px-2 py-1 border border-white/10 backdrop-blur">
                1 Dedo / Clic: Rotar · 2 Dedos / Rueda: Zoom & Paneo
              </span>
            </div>
          )}
        </div>

        {/* ── Pie de Página: Cotas en Pulgadas + mm + Selector de Escala ── */}
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

            {/* Chip selector de escala */}
            {detectedScale && (
              <div className="flex items-center gap-1.5 ml-1 sm:ml-3">
                <span className="text-[10px] text-ink-dim uppercase font-bold">Escala:</span>
                <select
                  value={scaleMode}
                  onChange={(e) => setScaleMode(e.target.value as 'auto' | 'meters' | 'mm' | 'inches')}
                  className="bg-surface border border-line text-accent font-mono text-[10px] py-0.5 px-1 font-bold rounded-none focus:outline-none hover:border-accent cursor-pointer"
                  title="Factor de escala geométrica del STL (Auto detecta metros de eDrawings x1000)"
                >
                  <option value="auto">Auto ({detectedScale.label})</option>
                  <option value="meters">Forzar Metros (x1000)</option>
                  <option value="mm">1:1 Directo (mm)</option>
                  <option value="inches">1:1 Pulgadas (x25.4)</option>
                </select>
                {detectedScale.isAmbiguous && scaleMode === 'auto' && (
                  <span
                    className="text-[10px] font-bold uppercase tracking-wider text-warn bg-warn/10 border border-warn/40 px-1.5 py-0.5"
                    title="La malla mide entre 3 y 25 unidades: puede venir en mm o en pulgadas y no hay forma de saberlo desde la geometría. Se asumió mm. Verifica contra el plano CAD antes de tomar una cota."
                  >
                    Escala sin confirmar
                  </span>
                )}
              </div>
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

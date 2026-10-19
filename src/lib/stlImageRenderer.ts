/**
 * Utilidades para renderizar vistas 3D limpias de modelos STL en imágenes PNG/JPEG (dataURL y Blob),
 * ideales para copiar al portapapeles o adjuntar en correos/documentos sin cotas ni medidas.
 */

import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { detectStlUnitScale } from './stlMeasurement';
import { log } from './log';

export interface RenderStlOptions {
  width?: number;
  height?: number;
  backgroundColor?: number | string;
  metalColor?: number;
  /**
   * `color` conserva el render de metal para factura y correo.
   * `print` es escala de grises de alto contraste para la láser de la OT.
   */
  tone?: 'color' | 'print';
}

/**
 * Renderiza de forma offscreen un modelo STL en una imagen DataURL (PNG).
 * Produce una vista isométrica 3D limpia sobre fondo claro/blanco, sin rejilla ni cotas.
 */
export async function renderStlToDataUrl(
  stlUrl: string,
  options: RenderStlOptions = {}
): Promise<{ ok: true; dataUrl: string; blob: Blob } | { ok: false; reason: string }> {
  try {
    const width = options.width ?? 600;
    const height = options.height ?? 450;
    const printTone = options.tone === 'print';
    const bgColor = options.backgroundColor ?? 0xffffff;
    const metalColor = printTone ? 0x2a2a2a : (options.metalColor ?? 0x64748b);

    // 1. Cargar la geometría STL
    const loader = new STLLoader();
    const geometry = await loader.loadAsync(stlUrl);

    geometry.computeVertexNormals();
    geometry.center();
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();

    // Normalizar escala si venía en metros
    const rawBox = geometry.boundingBox ?? new Box3().setFromObject(new Mesh(geometry));
    const rawSize = rawBox.getSize(new Vector3());
    const detected = detectStlUnitScale(rawSize);
    if (detected.scaleMultiplier !== 1) {
      geometry.scale(detected.scaleMultiplier, detected.scaleMultiplier, detected.scaleMultiplier);
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
    }

    // 2. Configurar la escena Three.js
    const scene = new Scene();
    scene.background = new Color(bgColor);

    // Material metálico satinado limpio
    const material = new MeshStandardMaterial({
      color: metalColor,
      metalness: printTone ? 0.05 : 0.55,
      roughness: printTone ? 0.9 : 0.35,
    });

    const mesh = new Mesh(geometry, material);
    scene.add(mesh);

    // 3. Luces de estudio industrial
    const ambientLight = new AmbientLight(0xffffff, printTone ? 0.9 : 0.65);
    scene.add(ambientLight);

    const keyLight = new DirectionalLight(printTone ? 0xffffff : 0xfffaed, printTone ? 1.15 : 0.95);
    keyLight.position.set(150, 200, 120);
    scene.add(keyLight);

    if (!printTone) {
      const fillLight = new DirectionalLight(0x90b8f8, 0.5);
      fillLight.position.set(-150, 80, -120);
      scene.add(fillLight);

      const rimLight = new DirectionalLight(0x38bdf8, 0.6);
      rimLight.position.set(-80, -100, 150);
      scene.add(rimLight);
    } else {
      const fillLight = new DirectionalLight(0xffffff, 0.4);
      fillLight.position.set(-150, 80, -120);
      scene.add(fillLight);
    }

    // 4. Cámara en perspectiva isométrica
    const camera = new PerspectiveCamera(42, width / height, 0.1, 5000);
    const box = geometry.boundingBox ?? new Box3().setFromObject(mesh);
    const size = box.getSize(new Vector3());
    const radius = geometry.boundingSphere ? geometry.boundingSphere.radius : Math.max(size.x, size.y, size.z) / 2;

    const fovRad = (camera.fov * Math.PI) / 180;
    const aspect = width / height;
    const vDist = radius / Math.sin(fovRad / 2);
    const hFovRad = 2 * Math.atan(Math.tan(fovRad / 2) * aspect);
    const hDist = radius / Math.sin(hFovRad / 2);
    const fitDist = Math.max(vDist, hDist) * 1.25;

    camera.near = Math.max(fitDist * 0.01, 0.1);
    camera.far = fitDist * 20;
    camera.position.set(fitDist * 0.75, fitDist * 0.65, fitDist * 0.75);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    // 5. Canvas y WebGLRenderer
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      preserveDrawingBuffer: true,
    });
    renderer.setSize(width, height, false);
    renderer.setPixelRatio(1);
    renderer.render(scene, camera);

    // Obtener DataURL y Blob
    const dataUrl = canvas.toDataURL('image/png');

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((b) => resolve(b), 'image/png');
    });

    // Limpieza de recursos WebGL
    renderer.dispose();
    geometry.dispose();
    material.dispose();

    if (!blob) {
      return { ok: false, reason: 'No se pudo generar el Blob de la imagen.' };
    }

    return { ok: true, dataUrl, blob };
  } catch (error) {
    log.error('[renderStlToDataUrl] Error al renderizar STL', error);
    return { ok: false, reason: error instanceof Error ? error.message : 'Error al renderizar el STL' };
  }
}

/**
 * Copia un Blob de imagen PNG al portapapeles del sistema operativo (para pegar con Ctrl+V en Outlook/Email).
 */
export async function copyImageBlobToClipboard(blob: Blob): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
      return false;
    }
    const item = new ClipboardItem({ 'image/png': blob });
    await navigator.clipboard.write([item]);
    return true;
  } catch (err) {
    log.warn('[copyImageBlobToClipboard] No se pudo copiar la imagen al portapapeles', err);
    return false;
  }
}

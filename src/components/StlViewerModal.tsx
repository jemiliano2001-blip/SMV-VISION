/**
 * Visor 3D mínimo para STL (export eDrawings) dentro de Biblioteca.
 * Orbit controls nativos con drag + rueda; fail-soft si el fetch falla.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { Loader2, X, Box } from 'lucide-react';
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
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { log } from '../lib/log';

export interface StlViewerModalProps {
  open: boolean;
  stlUrl: string | null;
  title: string;
  onClose: () => void;
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

  useEffect(() => {
    if (!open || !stlUrl || !mountRef.current) {
      return;
    }

    let disposed = false;
    const mount = mountRef.current;
    setStatus('loading');
    setErrorMessage(null);

    const width = mount.clientWidth || 640;
    const height = mount.clientHeight || 480;

    const scene = new Scene();
    scene.background = new Color(0xf4f4f0);

    const camera = new PerspectiveCamera(45, width / height, 0.1, 5000);
    camera.position.set(120, 90, 120);

    const renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;

    scene.add(new AmbientLight(0xffffff, 0.55));
    const key = new DirectionalLight(0xffffff, 0.9);
    key.position.set(80, 120, 60);
    scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.35);
    fill.position.set(-60, 40, -80);
    scene.add(fill);

    const material = new MeshStandardMaterial({
      color: 0x8a8f98,
      metalness: 0.35,
      roughness: 0.45,
    });

    let mesh: Mesh | null = null;
    let frameId = 0;

    const animate = () => {
      if (disposed) return;
      frameId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    const loader = new STLLoader();
    loader.load(
      stlUrl,
      (geometry) => {
        if (disposed) {
          geometry.dispose();
          return;
        }
        geometry.computeVertexNormals();
        mesh = new Mesh(geometry, material);
        scene.add(mesh);

        const box = new Box3().setFromObject(mesh);
        const size = box.getSize(new Vector3());
        const center = box.getCenter(new Vector3());
        mesh.position.sub(center);

        const maxDim = Math.max(size.x, size.y, size.z, 1);
        camera.position.set(maxDim * 1.6, maxDim * 1.2, maxDim * 1.6);
        controls.target.set(0, 0, 0);
        controls.update();
        setStatus('ready');
      },
      undefined,
      (err) => {
        if (disposed) return;
        log.warn('[smv-vision][stl] load failed', err);
        setStatus('error');
        setErrorMessage('No se pudo cargar el STL. Revisa la URL o CORS del Storage.');
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
      material.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, [open, stlUrl]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Vista 3D ${title}`}
    >
      <div className="flex h-[min(80vh,720px)] w-full max-w-3xl flex-col border-2 border-black bg-bg shadow-[8px_8px_0_#000]">
        <header className="flex items-center justify-between border-b-2 border-black px-4 py-3">
          <div className="flex items-center gap-2">
            <Box size={18} className="text-accent" />
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[2px] text-ink-dim">Vista 3D · STL</p>
              <h2 className="font-display text-lg font-black uppercase italic leading-tight">{title}</h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="border-2 border-black p-2 hover:bg-surface-2"
            aria-label="Cerrar"
          >
            <X size={18} />
          </button>
        </header>

        <div className="relative min-h-0 flex-1 bg-[#f4f4f0]" ref={mountRef}>
          {status === 'loading' && (
            <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 font-mono text-xs uppercase">
              <Loader2 className="animate-spin" size={16} /> Cargando malla…
            </div>
          )}
          {status === 'error' && (
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6 text-center font-mono text-xs text-danger">
              {errorMessage}
            </div>
          )}
        </div>

        <footer className="border-t-2 border-black px-4 py-2 font-mono text-[10px] text-ink-dim">
          Arrastra para rotar · rueda para zoom. Solo visualización — no sustituye el plano CAD.
        </footer>
      </div>
    </div>
  );
}

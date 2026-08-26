import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8')) as { version: string };

// pdf.js v5 needs the JBig2/OpenJPEG/QCMS wasm assets available at a stable,
// unhashed URL prefix (`wasmUrl`). Copying them into `public/pdfjs-wasm/`
// ensures Vite serves them verbatim in dev and ships them unchanged to `dist`
// on build, matching the exact filenames pdf.js constructs at runtime.
function syncPdfjsWasm(): void {
  const srcDir = path.resolve(__dirname, 'node_modules/pdfjs-dist/wasm');
  if (!existsSync(srcDir)) {
    return;
  }
  const destDir = path.resolve(__dirname, 'public/pdfjs-wasm');
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true });
  }
  for (const entry of readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, entry);
    if (!statSync(srcPath).isFile()) {
      continue;
    }
    copyFileSync(srcPath, path.join(destDir, entry));
  }
}

syncPdfjsWasm();

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }
            // Normalize path separators (Windows uses \) and collect EVERY
            // package name along the path — not just the last `node_modules/`
            // segment — because nested deps (e.g. firebase's own
            // node_modules/@firebase/firestore, motion's @motionone/*) live
            // one level deeper and would otherwise fall through to the
            // catch-all. Matching by exact package name (not substring) also
            // avoids false positives like `id.includes('react')` catching
            // `react-zoom-pan-pinch`.
            const normalized = id.replace(/\\/g, '/');
            const pkgNames = [...normalized.matchAll(/node_modules\/(@[^/]+\/[^/]+|[^/@][^/]*)/g)]
              .map((m) => m[1]);

            const hasPkg = (...names: string[]) => names.some((n) => pkgNames.includes(n));
            const hasScope = (scope: string) => pkgNames.some((n) => n.startsWith(`${scope}/`));

            if (hasPkg('pdfjs-dist')) {
              return 'pdfjs-vendor';
            }

            if (hasPkg('@google/genai')) {
              return 'genai-vendor';
            }

            if (hasPkg('three')) {
              return 'three-vendor';
            }

            if (hasPkg('motion', 'framer-motion') || hasScope('@motionone')) {
              return 'motion-vendor';
            }

            if (hasPkg('react', 'react-dom', 'scheduler', 'lucide-react')) {
              return 'react-vendor';
            }

            if (hasPkg('firebase') || hasScope('@firebase')) {
              return 'firebase-vendor';
            }

            if (hasPkg('jspdf', 'jspdf-autotable')) {
              return 'pdf-gen-vendor';
            }

            if (hasPkg('pdf-lib')) {
              return 'pdf-lib-vendor';
            }

            // Catch-all goes into react-vendor to avoid circular chunk
            // between a standalone 'vendor' chunk and react-vendor.
            return 'react-vendor';
          },
        },
      },
      chunkSizeWarningLimit: 800,
    },
    test: {
      environment: 'node',
      globals: true,
    },
  };
});

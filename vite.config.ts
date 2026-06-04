import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

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

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) {
              return undefined;
            }

            if (id.includes('pdfjs-dist')) {
              return 'pdfjs-vendor';
            }

            if (id.includes('@google/genai')) {
              return 'genai-vendor';
            }

            if (id.includes('motion') || id.includes('framer-motion')) {
              return 'motion-vendor';
            }

            if (
              id.includes('react') ||
              id.includes('scheduler') ||
              id.includes('lucide-react')
            ) {
              return 'react-vendor';
            }

            return 'vendor';
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

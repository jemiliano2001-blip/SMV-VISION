/**
 * scripts/syncServer.ts
 *
 * Servidor HTTP local en localhost:3031 que expone un endpoint POST /sync
 * para que el botón REFRESCAR de OdooOrdersPanel pueda disparar el sync
 * de Odoo desde el navegador sin tener que abrir una terminal.
 *
 * Uso:
 *   npm run sync:server
 *
 * Endpoints:
 *   GET  /status  → { ok: true, running: bool }
 *   POST /sync    → lanza runOdooSync.ps1 y responde { ok: true, running: true }
 *                   si ya hay un sync en curso, responde igual (idempotente)
 *
 * CORS habilitado para smv-brain.web.app y localhost (Chrome trata localhost
 * como "potentially trustworthy" y permite llamadas fetch desde HTTPS).
 *
 * Seguridad: POST /sync exige el header `X-SMV-Sync: 1`. Un header custom
 * convierte la petición en "preflighted", así que un sitio malicioso abierto
 * en el navegador no puede disparar el sync con un POST simple (drive-by):
 * el preflight solo pasa para los orígenes de ALLOWED_ORIGINS. También se
 * responde al preflight de Private Network Access de Chrome.
 */

import express from 'express';
import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = 3031;

const ALLOWED_ORIGINS = new Set([
  'https://smv-brain.web.app',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173',
]);

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

let syncRunning = false;

const app = express();

app.use((req, res, next) => {
  const origin = req.headers.origin ?? '';
  const originAllowed = ALLOWED_ORIGINS.has(origin);
  if (originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-SMV-Sync');
  if (req.method === 'OPTIONS') {
    // Chrome Private Network Access: una página HTTPS pública que llama a
    // localhost debe recibir este header en el preflight.
    if (originAllowed && req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    res.status(204).end();
    return;
  }
  next();
});

app.get('/status', (_req, res) => {
  res.json({ ok: true, running: syncRunning });
});

app.post('/sync', (req, res) => {
  // El header custom fuerza preflight CORS: bloquea POSTs "simples" que
  // cualquier web abierta en el navegador podría lanzar contra localhost.
  if (req.headers['x-smv-sync'] !== '1') {
    res.status(403).json({ ok: false, message: 'Falta header X-SMV-Sync' });
    return;
  }

  if (syncRunning) {
    res.json({ ok: true, running: true, message: 'Sync ya en progreso' });
    return;
  }

  syncRunning = true;
  console.log('[syncServer] Sync solicitado desde el navegador — lanzando runOdooSync.ps1…');

  const proc = spawn(
    'powershell',
    [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', resolve(repoRoot, 'scripts', 'runOdooSync.ps1'),
    ],
    { cwd: repoRoot, stdio: 'inherit' },
  );

  proc.on('close', (code) => {
    syncRunning = false;
    console.log(`[syncServer] Sync terminado (exit ${code ?? '?'})`);
  });

  proc.on('error', (err) => {
    syncRunning = false;
    console.error('[syncServer] Error al lanzar el proceso:', err.message);
  });

  res.json({ ok: true, running: true, message: 'Sync iniciado' });
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[syncServer] Escuchando en http://127.0.0.1:${PORT}`);
  console.log(`[syncServer] CORS habilitado para: ${[...ALLOWED_ORIGINS].join(', ')}`);
  console.log('[syncServer] Endpoints: GET /status  POST /sync');
});

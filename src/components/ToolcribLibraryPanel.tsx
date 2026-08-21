/**
 * ToolcribLibraryPanel
 *
 * Panel read-only del catálogo de planos Tool Crib. Permite:
 * - Buscar partes por número o descripción.
 * - Ver la revisión activa emparejada con la parte.
 * - Imprimir / abrir el PDF de la revisión activa (registra audit log).
 * - Adjuntar el PDF al flujo de análisis existente sin re-subirlo cada vez.
 *
 * Principios seguidos (user_rules):
 * - Componente puro: toda la E/S pasa por `src/lib/firebase/toolcrib.ts`.
 * - Manejo silencioso: los errores se muestran como feedback constructivo,
 *   nunca rompen el flujo (no throws).
 * - Modularidad: no acopla la lógica de auditoría al render. El padre
 *   decide qué hacer con los PDFs vía `onAttachDrawing`.
 */

import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  FileText,
  FolderOpen,
  Loader2,
  Plus,
  Printer,
  RefreshCcw,
  Search,
  Eye,
  X,
  Trash2,
  Box,
} from 'lucide-react';
import Fuse from 'fuse.js';

import {
  listActiveDrawingViews,
  listRecentPrintLogs,
  recordToolcribPrintLogFireAndForget,
  inactivatePart,
} from '../lib/firebase/toolcrib';
import type { ToolcribActiveDrawingView } from '../types';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { formatRelativeTime } from '../lib/age';
import { isIsoDrawingView } from '../lib/matching';
import { ToolcribUploadModal } from './ToolcribUploadModal';
import { ToolcribPrintModal } from './ToolcribPrintModal';
import { ToolcribHistoryModal } from './ToolcribHistoryModal';
import { StlViewerModal } from './StlViewerModal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Input } from './ui/input';
import { Button } from './ui/button';

export interface ToolcribAttachment {
  drawingId: string;
  partId: string;
  partNumber: string;
  revision: string;
  sourcePath: string;
  displayName: string;
  dataUrl: string;
}

export interface ToolcribLibraryPanelProps {
  /**
   * Callback usado para adjuntar un PDF resuelto (dataURL) al flujo de
   * análisis existente. El panel garantiza que el dataURL ya esté listo.
   */
  onAttachDrawing?: (attachment: ToolcribAttachment) => void;
  /**
   * IDs de dibujos ya adjuntados al flujo de análisis, para evitar dobles
   * inserciones y reflejar el estado en la UI.
   */
  attachedDrawingIds?: ReadonlySet<string>;
  /**
   * Si true, oculta planos ISO (`.iso` / `*.iso.pdf`) de la lista.
   * Usar en Biblioteca (impresión OT); dejar false en Reporte para adjuntar.
   */
  excludeIsoForPrint?: boolean;
  /** Prefill del buscador (p. ej. al llegar desde Órdenes). */
  initialSearchTerm?: string;
  /**
   * Vínculo pendiente de Biblioteca: muestra "Usar para orden X"
   * en cada fila cuando hay un link activo desde Órdenes.
   */
  pendingLinkLabel?: string | null;
  onUseForPendingOrder?: (view: ToolcribActiveDrawingView) => void;
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RowActionState {
  status: 'idle' | 'attaching' | 'printing' | 'error';
  message?: string;
}

function normalizeSearchTerm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

function buildDisplayName(view: ToolcribActiveDrawingView): string {
  const base = view.partNumber.trim();
  const revision = view.revision.trim();
  return `${base} (Rev ${revision}).pdf`;
}

export type PartFamily =
  | 'all'
  | 'punzones'
  | 'matrices'
  | 'bujes'
  | 'placas'
  | 'cuchillas'
  | 'ensambles'
  | 'otros';

export const FAMILIES: { id: PartFamily; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'punzones', label: 'Punzones / Marcas' },
  { id: 'matrices', label: 'Matrices / Dados' },
  { id: 'bujes', label: 'Bujes' },
  { id: 'placas', label: 'Placas / Calces' },
  { id: 'cuchillas', label: 'Gavilanes / Cuchillas' },
  { id: 'ensambles', label: 'Ensambles / Nidos' },
  { id: 'otros', label: 'Otros' },
];

export function matchesFamily(view: ToolcribActiveDrawingView, family: PartFamily): boolean {
  if (family === 'all') return true;
  const text = `${view.partNumber} ${view.description} ${view.sourcePath}`.toUpperCase();

  switch (family) {
    case 'punzones':
      return /PUNZON|HOT\s*STAMP|PUNCH|MARCA|ESTAMP/i.test(text);
    case 'matrices':
      return /MATRIZ|DIE|INSERT|CAVIDAD|DADO/i.test(text);
    case 'bujes':
      return /BUJE|BUSHING|CASQUILLO/i.test(text);
    case 'placas':
      return /PLACA|PLATE|CALCE|SHIM|BASE/i.test(text);
    case 'cuchillas':
      return /GAVILAN|CUCHILLA|BLADE|CORTE|SHEAR/i.test(text);
    case 'ensambles':
      return /ENSAMBLE|NIDO|FIXTURE|JIG|ASSEMBLY|DISPOSITIVO/i.test(text);
    case 'otros':
      return !/PUNZON|HOT\s*STAMP|PUNCH|MARCA|ESTAMP|MATRIZ|DIE|INSERT|CAVIDAD|DADO|BUJE|BUSHING|CASQUILLO|PLACA|PLATE|CALCE|SHIM|BASE|GAVILAN|CUCHILLA|BLADE|CORTE|SHEAR|ENSAMBLE|NIDO|FIXTURE|JIG|ASSEMBLY|DISPOSITIVO/i.test(
        text,
      );
  }
}

export interface DrawingPrintStat {
  count: number;
  totalCopies: number;
  lastPrintedAtUTC: string | null;
  lastOrderRef: string | null;
}

export function ToolcribLibraryPanel({
  onAttachDrawing,
  attachedDrawingIds,
  excludeIsoForPrint = false,
  initialSearchTerm = '',
  pendingLinkLabel = null,
  onUseForPendingOrder,
}: ToolcribLibraryPanelProps): ReactElement {
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [views, setViews] = useState<ToolcribActiveDrawingView[]>([]);
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
  const [selectedFamily, setSelectedFamily] = useState<PartFamily>('all');
  const [printStats, setPrintStats] = useState<Map<string, DrawingPrintStat>>(new Map());
  const [isOpen, setIsOpen] = useState<boolean>(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false);
  const [printDrawing, setPrintDrawing] = useState<ToolcribActiveDrawingView | null>(null);
  const [historyDrawing, setHistoryDrawing] = useState<ToolcribActiveDrawingView | null>(null);
  const [updateDrawing, setUpdateDrawing] = useState<ToolcribActiveDrawingView | null>(null);
  const [rowState, setRowState] = useState<Record<string, RowActionState>>({});
  const [previewDrawing, setPreviewDrawing] = useState<ToolcribActiveDrawingView | null>(null);
  const [stlDrawing, setStlDrawing] = useState<ToolcribActiveDrawingView | null>(null);

  useEffect(() => {
    if (initialSearchTerm.trim().length > 0) {
      setSearchTerm(initialSearchTerm);
      setIsOpen(true);
    }
  }, [initialSearchTerm]);

  const loadLibrary = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    const result = await listActiveDrawingViews({ customer: 'SUPRAJIT' });
    if (result.ok === false) {
      setStatus('error');
      if (result.reason === 'not-configured') {
        setErrorMessage(
          'Firebase no está configurado. Completa las variables VITE_FIREBASE_* en .env.local para activar la biblioteca Tool Crib.',
        );
      } else if (result.reason === 'not-authenticated') {
        setErrorMessage(
          'La biblioteca Tool Crib requiere sesión activa. Inicia sesión para consultar planos y registrar auditoría.',
        );
      } else {
        setErrorMessage(
          'No fue posible cargar la biblioteca. Verifica tu conexión y permisos.',
        );
      }
      return;
    }
    // En modo impresión OT ocultamos ISO… excepto los que traen STL (visor 3D).
    const loaded = excludeIsoForPrint
      ? result.value.filter((view) => !isIsoDrawingView(view) || Boolean(view.stlUrl))
      : result.value;
    setViews(loaded);
    setStatus('ready');

    // Cargar estadísticas de impresión de fondo
    void listRecentPrintLogs().then((logsRes) => {
      if (logsRes.ok) {
        const stats = new Map<string, DrawingPrintStat>();
        for (const log of logsRes.value) {
          const existing = stats.get(log.drawingId) ?? {
            count: 0,
            totalCopies: 0,
            lastPrintedAtUTC: log.printedAtUTC,
            lastOrderRef: log.orderRef,
          };
          existing.count += 1;
          existing.totalCopies += log.copies;
          stats.set(log.drawingId, existing);
        }
        setPrintStats(stats);
      }
    });
  }, [excludeIsoForPrint]);

  useEffect(() => {
    if (status === 'idle') {
      void loadLibrary();
    }
  }, [loadLibrary, status]);

  // Conteos por familia para los chips
  const familyCounts = useMemo(() => {
    const counts: Record<PartFamily, number> = {
      all: views.length,
      punzones: 0,
      matrices: 0,
      bujes: 0,
      placas: 0,
      cuchillas: 0,
      ensambles: 0,
      otros: 0,
    };
    for (const v of views) {
      for (const f of FAMILIES) {
        if (f.id !== 'all' && matchesFamily(v, f.id)) {
          counts[f.id] += 1;
        }
      }
    }
    return counts;
  }, [views]);

  const filteredViews = useMemo(() => {
    // 1. Filtrado por familia
    const familyMatched = selectedFamily === 'all'
      ? views
      : views.filter((v) => matchesFamily(v, selectedFamily));

    const term = normalizeSearchTerm(searchTerm);
    if (term.length === 0) {
      return familyMatched;
    }

    const fuse = new Fuse(familyMatched, {
      keys: [
        { name: 'partNumber', weight: 2 },
        { name: 'description', weight: 1 },
        { name: 'sourcePath', weight: 1 },
      ],
      threshold: 0.4,
      ignoreLocation: true,
      includeScore: true,
    });

    const results = fuse.search(term);
    if (excludeIsoForPrint) {
      return results
        .sort((a, b) => (a.score || 0) - (b.score || 0))
        .map((result) => result.item);
    }

    // En modo adjuntar (Reporte): priorizar `.iso` cuando los scores son cercanos.
    return results
      .sort((a, b) => {
        const aIso = isIsoDrawingView(a.item);
        const bIso = isIsoDrawingView(b.item);

        if (aIso && !bIso && Math.abs((a.score || 0) - (b.score || 0)) < 0.1) return -1;
        if (!aIso && bIso && Math.abs((a.score || 0) - (b.score || 0)) < 0.1) return 1;

        return (a.score || 0) - (b.score || 0);
      })
      .map((result) => result.item);
  }, [searchTerm, views, selectedFamily, excludeIsoForPrint]);



  const handleAttach = useCallback(
    async (view: ToolcribActiveDrawingView) => {
      if (!onAttachDrawing) {
        return;
      }
      if (!view.pdfUrl) {
        setRowState((prev) => ({
          ...prev,
          [view.drawingId]: {
            status: 'error',
            message:
              'Este plano no tiene URL HTTP accesible. Súbelo manualmente o configura pdfUrl.',
          },
        }));
        return;
      }

      setRowState((prev) => ({
        ...prev,
        [view.drawingId]: { status: 'attaching' },
      }));

      try {
        const dataUrl = await fetchPdfAsDataUrl(view.pdfUrl);
        onAttachDrawing({
          drawingId: view.drawingId,
          partId: view.partId,
          partNumber: view.partNumber,
          revision: view.revision,
          sourcePath: view.sourcePath,
          displayName: buildDisplayName(view),
          dataUrl,
        });
        setRowState((prev) => ({
          ...prev,
          [view.drawingId]: { status: 'idle' },
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Error desconocido';
        console.warn('[smv-vision][toolcrib] handleAttach falló', error);
        setRowState((prev) => ({
          ...prev,
          [view.drawingId]: {
            status: 'error',
            message: `No fue posible descargar el PDF (${message}).`,
          },
        }));
      }
    },
    [onAttachDrawing],
  );

  const handleInactivate = useCallback(async (view: ToolcribActiveDrawingView) => {
    if (!window.confirm(`¿Estás seguro de que deseas eliminar (inactivar) la parte ${view.partNumber}?`)) {
      return;
    }

    setRowState((prev) => ({
      ...prev,
      [view.drawingId]: { status: 'inactivating' as any },
    }));

    try {
      const res = await inactivatePart(view.partId);
      if (res.ok === false) {
        throw new Error(res.reason);
      }
      void loadLibrary();
    } catch (error) {
      console.warn('[smv-vision][toolcrib] handleInactivate falló', error);
      setRowState((prev) => ({
        ...prev,
        [view.drawingId]: {
          status: 'error',
          message: 'No fue posible inactivar la parte. Intenta nuevamente.',
        },
      }));
    }
  }, [loadLibrary]);

  const totalCount = views.length;
  const visibleCount = filteredViews.length;
  const isEmpty = status === 'ready' && totalCount === 0;

  return (
    <div className="border border-border bg-card text-card-foreground rounded-lg shadow-sm">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="w-full flex items-center justify-between px-4 py-3 font-medium hover:bg-muted/50 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-t-lg"
        aria-expanded={isOpen}
      >
        <span className="flex items-center gap-2">
          <FolderOpen size={16} className="text-primary" />
          Biblioteca Tool Crib
        </span>
        <span className="flex items-center gap-2 text-sm text-muted-foreground">
          {status === 'loading' ? (
            <Loader2 size={14} className="animate-spin" />
          ) : status === 'ready' ? (
            <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-semibold">{totalCount}</span>
          ) : status === 'error' ? (
            <AlertCircle size={14} className="text-destructive" />
          ) : null}
        </span>
      </button>

      {isOpen && (
        <div className="border-t border-border p-4 space-y-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="relative flex-1 w-full">
              <Search size={16} className="absolute left-2.5 top-2.5 text-muted-foreground" />
              <Input
                type="text"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Buscar parte, descripción o revisión…"
                className="pl-9 w-full"
              />
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void loadLibrary()}
                disabled={status === 'loading'}
                className="w-full sm:w-auto"
                title="Refrescar biblioteca"
              >
                {status === 'loading' ? (
                  <Loader2 size={14} className="animate-spin mr-2" />
                ) : (
                  <RefreshCcw size={14} className="mr-2" />
                )}
                Actualizar
              </Button>
              <Button
                size="sm"
                onClick={() => setIsUploadModalOpen(true)}
                className="w-full sm:w-auto"
              >
                <Plus size={14} className="mr-2" />
                Subir Plano
              </Button>
            </div>
          </div>

          {/* Chips de filtro por familia de pieza */}
          <div className="flex flex-wrap gap-1.5 pt-1">
            {FAMILIES.map((family) => {
              const isSelected = selectedFamily === family.id;
              const count = familyCounts[family.id];
              if (family.id !== 'all' && count === 0) return null;
              return (
                <button
                  key={family.id}
                  type="button"
                  onClick={() => setSelectedFamily(family.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono border transition-all ${
                    isSelected
                      ? 'bg-primary text-primary-foreground border-primary font-bold shadow-sm'
                      : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border'
                  }`}
                >
                  <span>{family.label}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      isSelected
                        ? 'bg-primary-foreground/20 text-primary-foreground'
                        : 'bg-muted text-muted-foreground'
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>

          {errorMessage && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{errorMessage}</span>
            </div>
          )}

          {status === 'loading' && (
            <div className="text-sm text-muted-foreground flex items-center justify-center py-8">
              <Loader2 size={16} className="animate-spin mr-2" /> Cargando catálogo…
            </div>
          )}

          {isEmpty && (
            <div className="text-sm text-muted-foreground text-center py-8 border rounded-lg border-dashed">
              Aún no hay planos registrados. Ejecuta el script de bootstrap o carga el primer plano manual.
            </div>
          )}

          {status === 'ready' && totalCount > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Mostrando {visibleCount} de {totalCount} planos activos.
              </p>
              
              <div className="rounded-md border max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10 shadow-sm">
                    <TableRow>
                      <TableHead>Número de Parte</TableHead>
                      <TableHead>Descripción</TableHead>
                      <TableHead className="w-24">Rev</TableHead>
                      <TableHead className="text-right">Acciones</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredViews.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                          Ningún plano coincide con la búsqueda.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredViews.map((view) => {
                        const rowActionState = rowState[view.drawingId] ?? { status: 'idle' };
                        const isAttached = attachedDrawingIds?.has(view.drawingId) === true;
                        const pStat = printStats.get(view.drawingId);
                        
                        return (
                          <TableRow key={view.drawingId}>
                            <TableCell className="font-medium whitespace-nowrap">
                              <div className="flex flex-col items-start">
                                <div className="flex items-center gap-1.5">
                                  <span>{view.partNumber}</span>
                                  {isIsoDrawingView(view) && (
                                    <span className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-[9px] font-mono px-1 py-0.5 rounded">
                                      ISO
                                    </span>
                                  )}
                                </div>
                                {pStat && pStat.count > 0 && (
                                  <button
                                    type="button"
                                    onClick={() => setHistoryDrawing(view)}
                                    className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-muted/60 hover:bg-accent/10 border border-border hover:border-accent text-[10px] font-mono text-muted-foreground hover:text-accent transition-colors"
                                    title={`Impreso ${pStat.count} ${pStat.count === 1 ? 'vez' : 'veces'} (${pStat.totalCopies} copias). Clic para ver historial.`}
                                  >
                                    <Printer size={10} className="text-accent" />
                                    <span>{pStat.count}x OT</span>
                                    {pStat.lastPrintedAtUTC && (
                                      <span className="opacity-75">
                                        · {formatRelativeTime(new Date(pStat.lastPrintedAtUTC))}
                                      </span>
                                    )}
                                  </button>
                                )}
                                {rowActionState.status === 'error' && rowActionState.message && (
                                  <span className="text-xs text-destructive mt-1 font-normal whitespace-normal">
                                    {rowActionState.message}
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="flex flex-col max-w-[200px] sm:max-w-xs">
                                <span className="truncate" title={view.description}>
                                  {view.description || 'Sin descripción'}
                                </span>
                                <span className="text-xs text-muted-foreground truncate" title={view.sourcePath}>
                                  <FileText size={10} className="inline-block mr-1 -mt-0.5" />
                                  {view.sourcePath ? view.sourcePath.split(/[\\/]/).pop() : '(sin archivo)'}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell>
                              <span className="inline-flex items-center justify-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground ring-1 ring-inset ring-secondary/20">
                                {view.revision}
                              </span>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex items-center justify-end gap-2">
                                {view.stlUrl && (
                                  <Button
                                    variant="outline"
                                    size="xs"
                                    onClick={() => setStlDrawing(view)}
                                    title="Abrir vista 3D (STL)"
                                  >
                                    <Box size={12} />
                                    <span className="ml-1 hidden sm:inline">3D</span>
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  size="xs"
                                  onClick={() => setPreviewDrawing(view)}
                                  disabled={!view.pdfUrl}
                                  title={view.pdfUrl ? "Ver plano" : "Plano no disponible"}
                                >
                                  <Eye size={12} />
                                  <span className="ml-1 hidden sm:inline">Ver</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="xs"
                                  onClick={() => setUpdateDrawing(view)}
                                  title="Subir nueva revisión"
                                >
                                  <RefreshCcw size={12} />
                                  <span className="ml-1 hidden sm:inline">Actualizar</span>
                                </Button>
                                <Button
                                  variant="outline"
                                  size="xs"
                                  onClick={() => setPrintDrawing(view)}
                                  disabled={
                                    rowActionState.status === 'printing' ||
                                    (excludeIsoForPrint && isIsoDrawingView(view))
                                  }
                                  title={
                                    excludeIsoForPrint && isIsoDrawingView(view)
                                      ? 'ISO no se imprime como OT — usa el CAD'
                                      : 'Imprimir OT'
                                  }
                                >
                                  {rowActionState.status === 'printing' ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Printer size={12} />
                                  )}
                                  <span className="ml-1 hidden sm:inline">Imprimir</span>
                                </Button>
                                {pendingLinkLabel && onUseForPendingOrder && (
                                  <Button
                                    variant="default"
                                    size="xs"
                                    onClick={() => onUseForPendingOrder(view)}
                                    title={`Usar este plano para ${pendingLinkLabel}`}
                                  >
                                    <CheckCircle2 size={12} />
                                    <span className="ml-1 hidden sm:inline">
                                      Usar para {pendingLinkLabel}
                                    </span>
                                  </Button>
                                )}
                                <Button
                                  variant="outline"
                                  size="xs"
                                  className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                  onClick={() => void handleInactivate(view)}
                                  disabled={(rowActionState.status as any) === 'inactivating'}
                                  title="Eliminar (Inactivar)"
                                >
                                  {(rowActionState.status as any) === 'inactivating' ? (
                                    <Loader2 size={12} className="animate-spin" />
                                  ) : (
                                    <Trash2 size={12} />
                                  )}
                                  <span className="ml-1 hidden sm:inline">Eliminar</span>
                                </Button>

                                {onAttachDrawing && (
                                  <Button
                                    variant={isAttached ? 'secondary' : 'default'}
                                    size="xs"
                                    onClick={() => void handleAttach(view)}
                                    disabled={
                                      rowActionState.status === 'attaching' || isAttached || !view.pdfUrl
                                    }
                                    title={
                                      !view.pdfUrl
                                        ? 'Falta pdfUrl accesible'
                                        : isAttached
                                          ? 'Ya adjunto al análisis'
                                          : 'Adjuntar al análisis'
                                    }
                                  >
                                    {isAttached ? (
                                      <CheckCircle2 size={12} />
                                    ) : rowActionState.status === 'attaching' ? (
                                      <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                      <Plus size={12} />
                                    )}
                                    <span className="ml-1 hidden sm:inline">
                                      {isAttached ? 'Adjunto' : 'Análisis'}
                                    </span>
                                  </Button>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      )}

      <ToolcribUploadModal
        isOpen={isUploadModalOpen || !!updateDrawing}
        onClose={() => {
          setIsUploadModalOpen(false);
          setUpdateDrawing(null);
        }}
        onSuccess={() => {
          void loadLibrary();
        }}
        initialPartNumber={updateDrawing?.partNumber}
        initialCustomer={updateDrawing?.customer}
        initialDescription={updateDrawing?.description}
      />
      <ToolcribPrintModal
        drawing={printDrawing}
        onClose={() => setPrintDrawing(null)}
        onSuccess={() => {
          if (printDrawing) {
            recordToolcribPrintLogFireAndForget({
              drawingId: printDrawing.drawingId,
              partId: printDrawing.partId,
              copies: 1,
              orderRef: null,
            });
            // Refrescar estadísticas de impresión
            void loadLibrary();
          }
        }}
      />

      <ToolcribHistoryModal
        drawing={historyDrawing}
        onClose={() => setHistoryDrawing(null)}
      />

      {previewDrawing?.pdfUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 sm:p-8"
          onClick={() => setPreviewDrawing(null)}
          role="dialog"
          aria-modal="true"
          ref={(el) => {
            if (el) el.focus();
          }}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setPreviewDrawing(null);
          }}
        >
          <div
            className="bg-surface border-2 border-line shadow-hard-accent max-w-6xl w-full max-h-full flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 px-5 py-3 border-b-2 border-line bg-[#0D2B4D] text-white">
              <div className="min-w-0">
                <p className="text-[10px] font-mono opacity-60 uppercase tracking-widest truncate">
                  Plano de biblioteca
                </p>
                <h3 className="font-display text-lg font-black uppercase tracking-tight truncate">
                  {previewDrawing.partNumber} - Rev {previewDrawing.revision}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPreviewDrawing(null)}
                className="shrink-0 p-1.5 border-2 border-white/40 hover:bg-accent hover:border-accent transition-colors"
                title="Cerrar (ESC)"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grow overflow-hidden bg-surface-2 relative flex items-center justify-center min-h-[70vh]">
              <object
                data={`${previewDrawing.pdfUrl}#toolbar=0&navpanes=0&view=FitH`}
                type="application/pdf"
                className="w-full h-full border-none"
              >
                <p className="text-center p-4">
                  El navegador no soporta visualización incrustada de PDFs.{' '}
                  <a href={previewDrawing.pdfUrl} target="_blank" rel="noopener noreferrer" className="text-accent underline">
                    Descargar o abrir PDF
                  </a>
                </p>
              </object>
            </div>
          </div>
        </div>
      )}

      <StlViewerModal
        open={stlDrawing !== null && Boolean(stlDrawing.stlUrl)}
        stlUrl={stlDrawing?.stlUrl ?? null}
        title={stlDrawing ? `${stlDrawing.partNumber} · Rev ${stlDrawing.revision}` : ''}
        onClose={() => setStlDrawing(null)}
      />
    </div>
  );
}

/**
 * ToolcribLibraryPanel
 *
 * Catálogo de planos Tool Crib. En Biblioteca (variant=page) agrupa CAD+ISO
 * en una pieza, llena el viewport y filtra por tipo de archivo. En Reporte
 * (variant=embedded) sigue siendo el acordeón compacto del flujo de análisis.
 */

import { useCallback, useEffect, useMemo, useState, Suspense, lazy, type ReactElement } from 'react';
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
  MoreHorizontal,
} from 'lucide-react';
import Fuse from 'fuse.js';

import {
  listActiveDrawingViews,
  listRecentPrintLogs,
  recordToolcribPrintLog,
  inactivatePart,
} from '../lib/firebase/toolcrib';
import type { ToolcribActiveDrawingView } from '../types';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { formatRelativeTime } from '../lib/age';
import {
  ASSET_FILTERS,
  FAMILIES,
  attachDrawingForGroup,
  groupDrawingViews,
  matchesAssetFilter,
  matchesFamilyGroup,
  previewDrawingForGroup,
  printDrawingForGroup,
  type AssetFilter,
  type PartFamily,
  type ToolcribPartGroup,
} from '../lib/toolcribCatalog';
import { ToolcribUploadModal } from './ToolcribUploadModal';
import { ToolcribPrintModal } from './ToolcribPrintModal';
import { ToolcribHistoryModal } from './ToolcribHistoryModal';
// three.js (~600 KB) solo se necesita al abrir el visor 3D — carga bajo
// demanda en lugar de en el bundle inicial (three-vendor chunk).
const StlViewerModal = lazy(() =>
  import('./StlViewerModal').then((m) => ({ default: m.StlViewerModal })),
);
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Input } from './ui/input';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { cn } from '../lib/utils';
import { log } from '../lib/log';

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
   * Si true (Biblioteca / OT): al buscar no prioriza ISO sobre CAD.
   * Imprimir siempre usa el CAD del grupo; si no hay CAD, el botón queda deshabilitado.
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
  /**
   * `page` = Biblioteca dedicada (llena el viewport, sin acordeón).
   * `embedded` = bloque dentro de Generar Reporte.
   */
  variant?: 'page' | 'embedded';
  /**
   * Se dispara tras una mutación real del catálogo (inactivar, subir/actualizar
   * un plano) — nunca en el fetch inicial. El panel mantiene su propia copia
   * para mostrarse a sí mismo; este callback es para que el caller invalide la
   * copia independiente que usa `useToolcribCatalog` (auto-matching de Órdenes,
   * resolución de STL en Reporte), que si no se queda desactualizada hasta
   * recargar la página.
   */
  onCatalogChanged?: () => void;
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error';

interface RowActionState {
  status: 'idle' | 'attaching' | 'printing' | 'inactivating' | 'error';
  message?: string;
}

export interface DrawingPrintStat {
  count: number;
  totalCopies: number;
  lastPrintedAtUTC: string | null;
  lastOrderRef: string | null;
}

function normalizeSearchTerm(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function buildDisplayName(view: ToolcribActiveDrawingView): string {
  const base = view.partNumber.trim();
  const revision = view.revision.trim();
  return `${base} (Rev ${revision}).pdf`;
}

function fileBasename(sourcePath: string): string {
  const trimmed = sourcePath.trim();
  if (!trimmed) return '(sin archivo)';
  return trimmed.split(/[\\/]/).pop() ?? trimmed;
}

function FilterChip({
  label,
  count,
  selected,
  onClick,
}: {
  label: string;
  count: number;
  selected: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono uppercase tracking-wider border-2 transition-all ${
        selected
          ? 'bg-accent text-bg border-accent font-bold shadow-hard active:translate-x-0.5 active:translate-y-0.5'
          : 'bg-surface hover:bg-surface-2 text-ink hover:text-accent border-line hover:border-accent'
      }`}
    >
      <span>{label}</span>
      <span
        className={`text-[9px] font-mono px-1 py-0.2 ${
          selected
            ? 'bg-black/25 text-bg font-bold'
            : 'bg-surface-2 text-ink-dim'
        }`}
      >
        {count}
      </span>
    </button>
  );
}

export function ToolcribLibraryPanel({
  onAttachDrawing,
  attachedDrawingIds,
  excludeIsoForPrint = false,
  initialSearchTerm = '',
  pendingLinkLabel = null,
  onUseForPendingOrder,
  variant = 'embedded',
  onCatalogChanged,
}: ToolcribLibraryPanelProps): ReactElement {
  const isPage = variant === 'page';
  const [status, setStatus] = useState<LoadStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [views, setViews] = useState<ToolcribActiveDrawingView[]>([]);
  const [searchTerm, setSearchTerm] = useState(initialSearchTerm);
  const [selectedFamily, setSelectedFamily] = useState<PartFamily>('all');
  const [selectedAsset, setSelectedAsset] = useState<AssetFilter>('all');
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

  // Listener a nivel window (no depende de dónde viva el foco) — antes el
  // cierre con Escape dejaba de funcionar en cuanto el usuario clickeaba
  // dentro del <object> del PDF.
  useEffect(() => {
    if (!previewDrawing) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewDrawing(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [previewDrawing]);

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
    setViews(result.value);
    setStatus('ready');

    void listRecentPrintLogs().then((logsRes) => {
      if (logsRes.ok === false) {
        log.warn('[toolcrib] listRecentPrintLogs falló — badges de "Nx OT" no se mostrarán', logsRes.reason);
        return;
      }
      const stats = new Map<string, DrawingPrintStat>();
      for (const entry of logsRes.value) {
        const existing = stats.get(entry.drawingId) ?? {
          count: 0,
          totalCopies: 0,
          lastPrintedAtUTC: entry.printedAtUTC,
          lastOrderRef: entry.orderRef,
        };
        existing.count += 1;
        existing.totalCopies += entry.copies;
        stats.set(entry.drawingId, existing);
      }
      setPrintStats(stats);
    });
  }, []);

  useEffect(() => {
    if (status === 'idle') {
      void loadLibrary();
    }
  }, [loadLibrary, status]);

  const groups = useMemo(() => groupDrawingViews(views), [views]);

  // Cada eje cuenta sobre el grupo ya acotado por el OTRO eje — así los chips
  // de familia reflejan el filtro de archivo activo (y viceversa) en vez del
  // catálogo completo, que es lo que hacía que un chip mostrara "120" y al
  // hacer clic resolviera a 3 filas.
  const assetMatchedForFamilyCounts = useMemo(() => {
    return selectedAsset === 'all'
      ? groups
      : groups.filter((group) => matchesAssetFilter(group, selectedAsset));
  }, [groups, selectedAsset]);

  const familyMatchedForAssetCounts = useMemo(() => {
    return selectedFamily === 'all'
      ? groups
      : groups.filter((group) => matchesFamilyGroup(group, selectedFamily));
  }, [groups, selectedFamily]);

  const familyCounts = useMemo(() => {
    const counts: Record<PartFamily, number> = {
      all: assetMatchedForFamilyCounts.length,
      punzones: 0,
      matrices: 0,
      bujes: 0,
      placas: 0,
      cuchillas: 0,
      ensambles: 0,
      otros: 0,
    };
    for (const group of assetMatchedForFamilyCounts) {
      for (const family of FAMILIES) {
        if (family.id !== 'all' && matchesFamilyGroup(group, family.id)) {
          counts[family.id] += 1;
        }
      }
    }
    return counts;
  }, [assetMatchedForFamilyCounts]);

  const assetCounts = useMemo(() => {
    const counts: Record<AssetFilter, number> = {
      all: familyMatchedForAssetCounts.length,
      cad: 0,
      iso: 0,
      stl: 0,
      'missing-pdf': 0,
    };
    for (const group of familyMatchedForAssetCounts) {
      for (const filter of ASSET_FILTERS) {
        if (filter.id !== 'all' && matchesAssetFilter(group, filter.id)) {
          counts[filter.id] += 1;
        }
      }
    }
    return counts;
  }, [familyMatchedForAssetCounts]);

  const filteredGroups = useMemo(() => {
    const familyMatched =
      selectedFamily === 'all'
        ? groups
        : groups.filter((group) => matchesFamilyGroup(group, selectedFamily));
    const assetMatched =
      selectedAsset === 'all'
        ? familyMatched
        : familyMatched.filter((group) => matchesAssetFilter(group, selectedAsset));

    const term = normalizeSearchTerm(searchTerm);
    if (term.length === 0) {
      return assetMatched;
    }

    const fuse = new Fuse(assetMatched, {
      keys: [
        { name: 'partNumber', weight: 2 },
        { name: 'description', weight: 1 },
        { name: 'searchText', weight: 0.8 },
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

    return results
      .sort((a, b) => {
        const scoreDiff = (a.score || 0) - (b.score || 0);
        if (Math.abs(scoreDiff) < 0.1) {
          const aIso = a.item.iso ? 1 : 0;
          const bIso = b.item.iso ? 1 : 0;
          if (aIso !== bIso) return bIso - aIso;
        }
        return scoreDiff;
      })
      .map((result) => result.item);
  }, [searchTerm, groups, selectedFamily, selectedAsset, excludeIsoForPrint]);

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
        log.warn('[smv-vision][toolcrib] handleAttach falló', error);
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

  const handleInactivate = useCallback(
    async (view: ToolcribActiveDrawingView) => {
      if (
        !window.confirm(
          `¿Inactivar la parte ${view.partNumber} (rev ${view.revision})? Deja de aparecer en el catálogo activo.`,
        )
      ) {
        return;
      }

      setRowState((prev) => ({
        ...prev,
        [view.drawingId]: { status: 'inactivating' },
      }));

      try {
        const res = await inactivatePart(view.partId);
        if (res.ok === false) {
          throw new Error(res.reason);
        }
        void loadLibrary();
        onCatalogChanged?.();
      } catch (error) {
        log.warn('[smv-vision][toolcrib] handleInactivate falló', error);
        setRowState((prev) => ({
          ...prev,
          [view.drawingId]: {
            status: 'error',
            message: 'No fue posible inactivar la parte. Intenta nuevamente.',
          },
        }));
      }
    },
    [loadLibrary],
  );

  const totalCount = groups.length;
  const visibleCount = filteredGroups.length;
  const isEmpty = status === 'ready' && totalCount === 0;
  const listOpen = isPage || isOpen;

  const toolbar = (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
      <div className="relative flex-1 w-full">
        <Search size={14} className="absolute left-3 top-2.5 text-ink-dim" />
        <Input
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          placeholder="Buscar parte, descripción o revisión…"
          className="pl-9 w-full border-2 border-line bg-surface-2 text-ink h-9 text-xs font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none"
        />
      </div>
      <div className="flex items-center gap-2 w-full sm:w-auto">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadLibrary()}
          disabled={status === 'loading'}
          className="border-2 border-line text-ink font-black uppercase text-[10px] tracking-widest hover:bg-surface-2 hover:text-ink transition-colors rounded-none h-9 px-3 w-full sm:w-auto"
          title="Refrescar biblioteca"
        >
          {status === 'loading' ? (
            <Loader2 size={14} className="animate-spin mr-2 text-accent" />
          ) : (
            <RefreshCcw size={14} className="mr-2" />
          )}
          Actualizar
        </Button>
        <Button
          size="sm"
          onClick={() => setIsUploadModalOpen(true)}
          className="bg-accent text-bg px-4 h-9 text-[10px] font-black uppercase tracking-widest hover:bg-accent/80 transition-colors shadow-hard active:translate-x-0.5 active:translate-y-0.5 rounded-none flex items-center gap-1.5 w-full sm:w-auto"
        >
          <Plus size={14} />
          Subir Plano
        </Button>
      </div>
    </div>
  );

  const filters = (
    <div className="space-y-2">
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none flex-nowrap sm:flex-wrap">
        {FAMILIES.map((family) => {
          const count = familyCounts[family.id];
          if (family.id !== 'all' && count === 0) return null;
          return (
            <FilterChip
              key={family.id}
              label={family.label}
              count={count}
              selected={selectedFamily === family.id}
              onClick={() => setSelectedFamily(family.id)}
            />
          );
        })}
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none flex-nowrap sm:flex-wrap">
        {ASSET_FILTERS.map((filter) => {
          const count = assetCounts[filter.id];
          if (filter.id === 'missing-pdf' && count === 0) return null;
          return (
            <FilterChip
              key={filter.id}
              label={filter.label}
              count={count}
              selected={selectedAsset === filter.id}
              onClick={() => setSelectedAsset(filter.id)}
            />
          );
        })}
      </div>
    </div>
  );

  // No exigimos status === 'ready': un refresh fallido (status 'error') no debe
  // borrar la tabla si ya había un catálogo cargado de una consulta anterior.
  const tableBlock = status !== 'loading' && totalCount > 0 && (
    <div className={cn('space-y-2', isPage && 'flex-1 min-h-0 flex flex-col')}>
      <p className="font-mono text-[11px] uppercase tracking-wider text-ink-dim shrink-0">
        Mostrando {visibleCount} de {totalCount} piezas
        {views.length !== totalCount ? ` · ${views.length} archivos` : ''}.
      </p>
      <div
        className={cn(
          'border-2 border-line overflow-auto rounded-none bg-surface',
          isPage ? 'flex-1 min-h-0' : 'max-h-[400px]',
        )}
      >
        <Table className="min-w-[620px] sm:min-w-full">
          <TableHeader className="sticky top-0 bg-surface-2 border-b-2 border-line z-10">
            <TableRow className="border-b-2 border-line hover:bg-transparent">
              <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim py-2.5">Número de Parte</TableHead>
              <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim py-2.5">Descripción</TableHead>
              <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim py-2.5 w-28">Rev</TableHead>
              <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim py-2.5 text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center font-mono text-xs text-ink-dim uppercase">
                  {normalizeSearchTerm(searchTerm).length > 0
                    ? 'Ningún plano coincide con la búsqueda.'
                    : 'Ningún plano coincide con los filtros seleccionados.'}
                </TableCell>
              </TableRow>
            ) : (
              filteredGroups.map((group) => (
                <PartGroupRow
                  key={group.key}
                  group={group}
                  printStats={printStats}
                  rowState={rowState}
                  attachedDrawingIds={attachedDrawingIds}
                  pendingLinkLabel={pendingLinkLabel}
                  showAttach={Boolean(onAttachDrawing)}
                  onPreview={setPreviewDrawing}
                  onPrint={setPrintDrawing}
                  onHistory={setHistoryDrawing}
                  onStl={setStlDrawing}
                  onUpdate={setUpdateDrawing}
                  onAttach={(view) => void handleAttach(view)}
                  onInactivate={(view) => void handleInactivate(view)}
                  onUseForPending={onUseForPendingOrder}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );

  const body = (
    <div className={cn(isPage ? 'flex-1 min-h-0 flex flex-col gap-4 p-5' : 'space-y-4')}>
      {toolbar}
      {filters}
      {errorMessage && (
        <div className="flex items-start gap-2 border-2 border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger">
          <AlertCircle size={16} className="shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}
      {status === 'loading' && (
        <div className="font-mono text-xs text-ink-dim flex items-center justify-center py-8 uppercase tracking-widest">
          <Loader2 size={16} className="animate-spin mr-2 text-accent" /> Cargando catálogo…
        </div>
      )}
      {isEmpty && (
        <div className="font-mono text-xs text-ink-dim text-center py-8 border-2 border-dashed border-line bg-surface-2 p-6 corner-ticks">
          Aún no hay planos registrados. Ejecuta el script de bootstrap o carga el primer plano manual.
        </div>
      )}
      {tableBlock}
    </div>
  );

  return (
    <div
      className={cn(
        'border-2 border-line bg-surface text-ink rounded-none shadow-hard',
        isPage && 'h-full min-h-0 flex flex-col overflow-hidden',
      )}
    >
      {isPage ? (
        <div className="shrink-0 flex items-center justify-between px-5 py-3 border-b-2 border-line bg-[#0D2B4D] text-white">
          <span className="flex items-center gap-2.5 font-display font-black text-lg uppercase tracking-tight text-white">
            <FolderOpen size={18} className="text-accent" />
            Biblioteca Tool Crib
          </span>
          <span className="flex items-center gap-2 font-mono text-xs text-white/80">
            {status === 'loading' ? (
              <Loader2 size={14} className="animate-spin text-accent" />
            ) : status === 'ready' ? (
              <span className="bg-accent text-bg px-2 py-0.5 text-[11px] font-bold">
                {totalCount} piezas
              </span>
            ) : status === 'error' ? (
              <AlertCircle size={14} className="text-danger" />
            ) : null}
          </span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="w-full flex items-center justify-between px-5 py-3 font-medium bg-[#0D2B4D] text-white hover:bg-[#12365e] transition-colors outline-none border-b-2 border-line"
          aria-expanded={isOpen}
        >
          <span className="flex items-center gap-2.5 font-display font-black text-base uppercase tracking-tight text-white">
            <FolderOpen size={16} className="text-accent" />
            Biblioteca Tool Crib
          </span>
          <span className="flex items-center gap-2 font-mono text-xs text-white/80">
            {status === 'loading' ? (
              <Loader2 size={14} className="animate-spin text-accent" />
            ) : status === 'ready' ? (
              <span className="bg-accent text-bg px-2 py-0.5 text-[10px] font-bold">
                {totalCount}
              </span>
            ) : status === 'error' ? (
              <AlertCircle size={14} className="text-danger" />
            ) : null}
          </span>
        </button>
      )}

      {listOpen && (isPage ? body : <div className="p-4">{body}</div>)}

      <ToolcribUploadModal
        isOpen={isUploadModalOpen || !!updateDrawing}
        onClose={() => {
          setIsUploadModalOpen(false);
          setUpdateDrawing(null);
        }}
        onSuccess={() => {
          void loadLibrary();
          onCatalogChanged?.();
        }}
        initialPartNumber={updateDrawing?.partNumber}
        initialCustomer={updateDrawing?.customer}
        initialDescription={updateDrawing?.description}
      />
      <ToolcribPrintModal
        drawing={printDrawing}
        onClose={() => setPrintDrawing(null)}
        onSuccess={({ soNumber }) => {
          if (printDrawing) {
            // Espera a que el log de impresión llegue a Firestore antes de
            // recargar — si no, el "Nx OT" no refleja la impresión recién
            // hecha hasta el siguiente refresh manual.
            void recordToolcribPrintLog({
              drawingId: printDrawing.drawingId,
              partId: printDrawing.partId,
              copies: 1,
              orderRef: soNumber,
            }).then(() => loadLibrary());
          }
        }}
      />

      <ToolcribHistoryModal drawing={historyDrawing} onClose={() => setHistoryDrawing(null)} />

      {previewDrawing?.pdfUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 sm:p-8"
          onClick={() => setPreviewDrawing(null)}
          role="dialog"
          aria-modal="true"
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
                  <a
                    href={previewDrawing.pdfUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-accent underline"
                  >
                    Descargar o abrir PDF
                  </a>
                </p>
              </object>
            </div>
          </div>
        </div>
      )}

      {stlDrawing !== null && (
        <Suspense fallback={null}>
          <StlViewerModal
            open={Boolean(stlDrawing.stlUrl)}
            stlUrl={stlDrawing.stlUrl ?? null}
            title={`${stlDrawing.partNumber} · Rev ${stlDrawing.revision}`}
            onClose={() => setStlDrawing(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

interface PartGroupRowProps {
  group: ToolcribPartGroup;
  printStats: ReadonlyMap<string, DrawingPrintStat>;
  rowState: Record<string, RowActionState>;
  attachedDrawingIds: ReadonlySet<string> | undefined;
  pendingLinkLabel: string | null | undefined;
  showAttach: boolean;
  onPreview: (view: ToolcribActiveDrawingView) => void;
  onPrint: (view: ToolcribActiveDrawingView) => void;
  onHistory: (view: ToolcribActiveDrawingView) => void;
  onStl: (view: ToolcribActiveDrawingView) => void;
  onUpdate: (view: ToolcribActiveDrawingView) => void;
  onAttach: (view: ToolcribActiveDrawingView) => void;
  onInactivate: (view: ToolcribActiveDrawingView) => void;
  onUseForPending?: (view: ToolcribActiveDrawingView) => void;
}

function PartGroupRow({
  group,
  printStats,
  rowState,
  attachedDrawingIds,
  pendingLinkLabel,
  showAttach,
  onPreview,
  onPrint,
  onHistory,
  onStl,
  onUpdate,
  onAttach,
  onInactivate,
  onUseForPending,
}: PartGroupRowProps): ReactElement {
  const printView = printDrawingForGroup(group);
  const previewView = previewDrawingForGroup(group);
  const attachView = attachDrawingForGroup(group);
  const pendingView = printView ?? group.iso;
  // Mismo target que abrirá el historial al hacer clic — así el número del
  // badge y lo que el modal muestra siempre coinciden (antes se sumaban las
  // impresiones de todo el grupo pero el historial solo mostraba un plano).
  const printStat = pendingView ? printStats.get(pendingView.drawingId) ?? null : null;
  const errorMember = group.members.find((member) => rowState[member.drawingId]?.status === 'error');
  const errorMessage = errorMember ? rowState[errorMember.drawingId]?.message : undefined;
  const attachBusy = group.members.some((member) => rowState[member.drawingId]?.status === 'attaching');
  const printBusy = printView ? rowState[printView.drawingId]?.status === 'printing' : false;
  const isoAttached = group.iso ? attachedDrawingIds?.has(group.iso.drawingId) === true : false;
  const cadAttached = group.cad ? attachedDrawingIds?.has(group.cad.drawingId) === true : false;
  const attachTargetAttached = attachView
    ? attachedDrawingIds?.has(attachView.drawingId) === true
    : false;
  const printDisabled = printBusy || !printView || !printView.pdfUrl;
  const printTitle = !printView
    ? 'ISO no se imprime como OT — falta el plano CAD'
    : !printView.pdfUrl
      ? 'Este plano no tiene un PDF accesible'
      : 'Imprimir OT';
  const cadFile = group.cad ? fileBasename(group.cad.sourcePath) : null;
  const isoFile = group.iso ? fileBasename(group.iso.sourcePath) : null;

  return (
    <TableRow className="border-b-2 border-line hover:bg-surface-2/60 transition-colors">
      <TableCell className="font-medium whitespace-nowrap py-3">
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-bold text-ink">{group.partNumber}</span>
            {group.cad && (
              <span className="bg-surface-2 text-ink-dim border-2 border-line text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-none">
                CAD
              </span>
            )}
            {group.iso && (
              <button
                type="button"
                onClick={() => group.iso && onPreview(group.iso)}
                disabled={!group.iso?.pdfUrl}
                className="bg-draft/10 text-draft border-2 border-draft/40 hover:bg-draft/20 text-[9px] font-mono font-bold px-1.5 py-0.2 rounded-none transition-colors disabled:opacity-50"
                title={group.iso.pdfUrl ? 'Ver ISO' : 'ISO sin PDF'}
              >
                ISO
              </button>
            )}
            {!group.cad && (
              <span className="text-[9px] font-mono text-ink-dim border border-line/60 px-1 py-0.2">sin CAD</span>
            )}
          </div>
          {printStat && printStat.count > 0 && pendingView && (
            <button
              type="button"
              onClick={() => onHistory(pendingView)}
              className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 bg-surface-2 hover:bg-accent/10 border-2 border-line hover:border-accent text-[10px] font-mono text-ink-dim hover:text-accent transition-colors rounded-none"
              title={`Impreso ${printStat.count} ${printStat.count === 1 ? 'vez' : 'veces'} (${printStat.totalCopies} copias). Clic para ver historial.`}
            >
              <Printer size={10} className="text-accent" />
              <span>{printStat.count}x OT</span>
              {printStat.lastPrintedAtUTC && (
                <span className="opacity-75">
                  · {formatRelativeTime(new Date(printStat.lastPrintedAtUTC))}
                </span>
              )}
            </button>
          )}
          {errorMessage && (
            <span className="text-[11px] font-mono text-danger mt-1 font-normal whitespace-normal">
              {errorMessage}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="py-3">
        <div className="flex flex-col max-w-[200px] sm:max-w-xs">
          <span className="truncate text-xs text-ink font-medium" title={group.description}>
            {group.description || 'Sin descripción'}
          </span>
          <span className="text-[11px] font-mono text-ink-dim truncate" title={cadFile ?? isoFile ?? ''}>
            <FileText size={10} className="inline-block mr-1 -mt-0.5 text-ink-dim" />
            {cadFile ?? isoFile ?? '(sin archivo)'}
            {cadFile && isoFile && cadFile !== isoFile ? ` · ${isoFile}` : ''}
          </span>
        </div>
      </TableCell>
      <TableCell className="py-3">
        <div className="flex flex-col items-start gap-0.5">
          {group.cad && (
            <span className="inline-flex items-center justify-center bg-surface-2 border-2 border-line px-2 py-0.5 text-[11px] font-mono font-bold text-ink rounded-none">
              {group.cad.revision}
            </span>
          )}
          {group.iso && group.iso.revision !== group.cad?.revision && (
            <span className="text-[10px] font-mono text-ink-dim">
              ISO {group.iso.revision}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right py-3">
        <div className="flex items-center justify-end gap-1.5">
          {group.stlView && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => group.stlView && onStl(group.stlView)}
              title="Abrir vista 3D (STL)"
              className="border-2 border-line text-ink font-mono font-bold uppercase text-[10px] tracking-wider hover:bg-surface-2 hover:border-accent hover:text-accent rounded-none h-7 px-2"
            >
              <Box size={11} />
              <span className="ml-1 hidden sm:inline">3D</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="xs"
            onClick={() => previewView && onPreview(previewView)}
            disabled={!previewView?.pdfUrl}
            title={previewView?.pdfUrl ? 'Ver plano CAD' : 'Plano no disponible'}
            className="border-2 border-line text-ink font-mono font-bold uppercase text-[10px] tracking-wider hover:bg-surface-2 hover:border-accent hover:text-accent rounded-none h-7 px-2"
          >
            <Eye size={11} />
            <span className="ml-1 hidden sm:inline">Ver</span>
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => printView && onPrint(printView)}
            disabled={printDisabled}
            title={printTitle}
            className="border-2 border-line text-ink font-mono font-bold uppercase text-[10px] tracking-wider hover:bg-surface-2 hover:border-accent hover:text-accent rounded-none h-7 px-2"
          >
            {printBusy ? <Loader2 size={11} className="animate-spin text-accent" /> : <Printer size={11} />}
            <span className="ml-1 hidden sm:inline">Imprimir</span>
          </Button>
          {pendingLinkLabel && onUseForPending && pendingView && (
            <Button
              variant="default"
              size="xs"
              disabled={!pendingView.pdfUrl}
              onClick={() => onUseForPending(pendingView)}
              title={
                pendingView.pdfUrl
                  ? `Usar este plano para ${pendingLinkLabel}`
                  : 'Este plano no tiene un PDF accesible'
              }
              className="bg-accent border-2 border-accent text-bg font-mono font-bold uppercase text-[10px] tracking-wider hover:bg-accent/80 shadow-hard active:translate-x-0.5 active:translate-y-0.5 rounded-none h-7 px-2.5 flex items-center gap-1.5 disabled:opacity-50 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0"
            >
              <CheckCircle2 size={11} />
              <span className="ml-1 hidden sm:inline">Usar para {pendingLinkLabel}</span>
            </Button>
          )}
          {showAttach && (
            <Button
              variant={attachTargetAttached ? 'secondary' : 'default'}
              size="xs"
              onClick={() => attachView && onAttach(attachView)}
              disabled={attachBusy || attachTargetAttached || !attachView?.pdfUrl}
              title={
                !attachView?.pdfUrl
                  ? 'Falta pdfUrl accesible'
                  : attachTargetAttached
                    ? 'Ya adjunto al análisis'
                    : 'Adjuntar ISO al análisis (o CAD si no hay ISO)'
              }
              className={cn(
                'font-mono font-bold uppercase text-[10px] tracking-wider rounded-none h-7 px-2.5 flex items-center gap-1.5 border-2',
                attachTargetAttached
                  ? 'bg-surface-2 border-line text-ink-dim'
                  : 'bg-accent border-accent text-bg hover:bg-accent/80 shadow-hard active:translate-x-0.5 active:translate-y-0.5'
              )}
            >
              {attachTargetAttached ? (
                <CheckCircle2 size={11} />
              ) : attachBusy ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <Plus size={11} />
              )}
              <span className="ml-1 hidden sm:inline">
                {attachTargetAttached ? 'Adjunto' : 'Análisis'}
              </span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="h-7 w-7 rounded-none border-2 border-line bg-surface text-ink hover:bg-surface-2 hover:border-accent hover:text-accent transition-colors inline-flex items-center justify-center"
              title="Más acciones"
            >
              <MoreHorizontal size={12} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px] bg-surface border-2 border-line shadow-hard-accent text-ink rounded-none p-1">
              {group.cad?.pdfUrl && (
                <DropdownMenuItem onClick={() => group.cad && onPreview(group.cad)} className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5">
                  <Eye size={12} className="mr-1.5" />
                  Ver CAD
                </DropdownMenuItem>
              )}
              {group.iso?.pdfUrl && (
                <DropdownMenuItem onClick={() => group.iso && onPreview(group.iso)} className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5">
                  <Eye size={12} className="mr-1.5" />
                  Ver ISO
                </DropdownMenuItem>
              )}
              {group.cad && (
                <DropdownMenuItem onClick={() => group.cad && onUpdate(group.cad)} className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5">
                  <RefreshCcw size={12} className="mr-1.5" />
                  Nueva rev. CAD
                </DropdownMenuItem>
              )}
              {group.iso && (
                <DropdownMenuItem onClick={() => group.iso && onUpdate(group.iso)} className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5">
                  <RefreshCcw size={12} className="mr-1.5" />
                  Nueva rev. ISO
                </DropdownMenuItem>
              )}
              {showAttach && group.cad?.pdfUrl && (
                <DropdownMenuItem
                  disabled={cadAttached}
                  onClick={() => group.cad && onAttach(group.cad)}
                  className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5"
                >
                  <Plus size={12} className="mr-1.5" />
                  {cadAttached ? 'CAD ya adjunto' : 'Adjuntar CAD'}
                </DropdownMenuItem>
              )}
              {showAttach && group.iso?.pdfUrl && (
                <DropdownMenuItem
                  disabled={isoAttached}
                  onClick={() => group.iso && onAttach(group.iso)}
                  className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5"
                >
                  <Plus size={12} className="mr-1.5" />
                  {isoAttached ? 'ISO ya adjunto' : 'Adjuntar ISO'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator className="bg-line my-1" />
              {group.cad && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => group.cad && onInactivate(group.cad)}
                  className="font-mono text-xs cursor-pointer text-danger hover:bg-danger/10 rounded-none px-2 py-1.5"
                >
                  <Trash2 size={12} className="mr-1.5" />
                  Eliminar CAD
                </DropdownMenuItem>
              )}
              {group.iso && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => group.iso && onInactivate(group.iso)}
                  className="font-mono text-xs cursor-pointer text-danger hover:bg-danger/10 rounded-none px-2 py-1.5"
                >
                  <Trash2 size={12} className="mr-1.5" />
                  Eliminar ISO
                </DropdownMenuItem>
              )}
              {group.extras.map((extra) => (
                <DropdownMenuItem
                  key={extra.drawingId}
                  variant="destructive"
                  onClick={() => onInactivate(extra)}
                  className="font-mono text-xs cursor-pointer text-danger hover:bg-danger/10 rounded-none px-2 py-1.5"
                >
                  <Trash2 size={12} className="mr-1.5" />
                  Eliminar {extra.partNumber}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );
}

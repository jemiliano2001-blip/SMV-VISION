/**
 * ToolcribLibraryPanel
 *
 * Catálogo de planos Tool Crib. En Biblioteca (variant=page) agrupa CAD+ISO
 * en una pieza, llena el viewport y filtra por tipo de archivo. En Reporte
 * (variant=embedded) sigue siendo el acordeón compacto del flujo de análisis.
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
  MoreHorizontal,
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
import {
  ASSET_FILTERS,
  FAMILIES,
  attachDrawingForGroup,
  groupDrawingViews,
  matchesAssetFilter,
  matchesFamily,
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
import { StlViewerModal } from './StlViewerModal';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Input } from './ui/input';
import { Button, buttonVariants } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { cn } from '../lib/utils';

export type { PartFamily, AssetFilter, ToolcribPartGroup };
export { FAMILIES, ASSET_FILTERS, matchesFamily };

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

function mergeGroupPrintStats(
  group: ToolcribPartGroup,
  printStats: ReadonlyMap<string, DrawingPrintStat>,
): DrawingPrintStat | null {
  let merged: DrawingPrintStat | null = null;
  for (const member of group.members) {
    const stat = printStats.get(member.drawingId);
    if (!stat) continue;
    if (!merged) {
      merged = { ...stat };
      continue;
    }
    merged.count += stat.count;
    merged.totalCopies += stat.totalCopies;
    if (
      stat.lastPrintedAtUTC &&
      (!merged.lastPrintedAtUTC || stat.lastPrintedAtUTC > merged.lastPrintedAtUTC)
    ) {
      merged.lastPrintedAtUTC = stat.lastPrintedAtUTC;
      merged.lastOrderRef = stat.lastOrderRef;
    }
  }
  return merged;
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
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-mono border transition-all ${
        selected
          ? 'bg-primary text-primary-foreground border-primary font-bold shadow-sm'
          : 'bg-muted/40 hover:bg-muted text-muted-foreground hover:text-foreground border-border'
      }`}
    >
      <span>{label}</span>
      <span
        className={`text-[10px] px-1.5 py-0.5 rounded-full ${
          selected
            ? 'bg-primary-foreground/20 text-primary-foreground'
            : 'bg-muted text-muted-foreground'
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
  }, []);

  useEffect(() => {
    if (status === 'idle') {
      void loadLibrary();
    }
  }, [loadLibrary, status]);

  const groups = useMemo(() => groupDrawingViews(views), [views]);

  const familyCounts = useMemo(() => {
    const counts: Record<PartFamily, number> = {
      all: groups.length,
      punzones: 0,
      matrices: 0,
      bujes: 0,
      placas: 0,
      cuchillas: 0,
      ensambles: 0,
      otros: 0,
    };
    for (const group of groups) {
      for (const family of FAMILIES) {
        if (family.id !== 'all' && matchesFamilyGroup(group, family.id)) {
          counts[family.id] += 1;
        }
      }
    }
    return counts;
  }, [groups]);

  const assetCounts = useMemo(() => {
    const counts: Record<AssetFilter, number> = {
      all: groups.length,
      cad: 0,
      iso: 0,
      stl: 0,
      'missing-pdf': 0,
    };
    for (const group of groups) {
      for (const filter of ASSET_FILTERS) {
        if (filter.id !== 'all' && matchesAssetFilter(group, filter.id)) {
          counts[filter.id] += 1;
        }
      }
    }
    return counts;
  }, [groups]);

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
        <Button size="sm" onClick={() => setIsUploadModalOpen(true)} className="w-full sm:w-auto">
          <Plus size={14} className="mr-2" />
          Subir Plano
        </Button>
      </div>
    </div>
  );

  const filters = (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
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
      <div className="flex flex-wrap gap-1.5">
        {ASSET_FILTERS.filter((filter) => filter.id !== 'all').map((filter) => {
          const count = assetCounts[filter.id];
          if (filter.id === 'missing-pdf' && count === 0) return null;
          return (
            <FilterChip
              key={filter.id}
              label={filter.label}
              count={count}
              selected={selectedAsset === filter.id}
              onClick={() =>
                setSelectedAsset((current) => (current === filter.id ? 'all' : filter.id))
              }
            />
          );
        })}
      </div>
    </div>
  );

  const tableBlock = status === 'ready' && totalCount > 0 && (
    <div className={cn('space-y-2', isPage && 'flex-1 min-h-0 flex flex-col')}>
      <p className="text-xs text-muted-foreground shrink-0">
        Mostrando {visibleCount} de {totalCount} piezas
        {views.length !== totalCount ? ` · ${views.length} archivos` : ''}.
      </p>
      <div
        className={cn(
          'rounded-md border overflow-auto',
          isPage ? 'flex-1 min-h-0' : 'max-h-[400px]',
        )}
      >
        <Table>
          <TableHeader className="sticky top-0 bg-background/95 backdrop-blur z-10 shadow-sm">
            <TableRow>
              <TableHead>Número de Parte</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead className="w-28">Rev</TableHead>
              <TableHead className="text-right">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  Ningún plano coincide con la búsqueda.
                </TableCell>
              </TableRow>
            ) : (
              filteredGroups.map((group) => (
                <PartGroupRow
                  key={group.key}
                  group={group}
                  printStat={mergeGroupPrintStats(group, printStats)}
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
    <div className={cn(isPage ? 'flex-1 min-h-0 flex flex-col gap-4 p-4' : 'space-y-4')}>
      {toolbar}
      {filters}
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
      {tableBlock}
    </div>
  );

  return (
    <div
      className={cn(
        'border border-border bg-card text-card-foreground rounded-lg shadow-sm',
        isPage && 'h-full min-h-0 flex flex-col overflow-hidden',
      )}
    >
      {isPage ? (
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="flex items-center gap-2 font-medium">
            <FolderOpen size={16} className="text-primary" />
            Biblioteca Tool Crib
          </span>
          <span className="flex items-center gap-2 text-sm text-muted-foreground">
            {status === 'loading' ? (
              <Loader2 size={14} className="animate-spin" />
            ) : status === 'ready' ? (
              <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-semibold">
                {totalCount}
              </span>
            ) : status === 'error' ? (
              <AlertCircle size={14} className="text-destructive" />
            ) : null}
          </span>
        </div>
      ) : (
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
              <span className="bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-semibold">
                {totalCount}
              </span>
            ) : status === 'error' ? (
              <AlertCircle size={14} className="text-destructive" />
            ) : null}
          </span>
        </button>
      )}

      {listOpen && (isPage ? body : <div className="border-t border-border p-4">{body}</div>)}

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
            void loadLibrary();
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

      <StlViewerModal
        open={stlDrawing !== null && Boolean(stlDrawing.stlUrl)}
        stlUrl={stlDrawing?.stlUrl ?? null}
        title={stlDrawing ? `${stlDrawing.partNumber} · Rev ${stlDrawing.revision}` : ''}
        onClose={() => setStlDrawing(null)}
      />
    </div>
  );
}

interface PartGroupRowProps {
  group: ToolcribPartGroup;
  printStat: DrawingPrintStat | null;
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
  printStat,
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
  const errorMember = group.members.find((member) => rowState[member.drawingId]?.status === 'error');
  const errorMessage = errorMember ? rowState[errorMember.drawingId]?.message : undefined;
  const attachBusy = group.members.some((member) => rowState[member.drawingId]?.status === 'attaching');
  const printBusy = printView ? rowState[printView.drawingId]?.status === 'printing' : false;
  const isoAttached = group.iso ? attachedDrawingIds?.has(group.iso.drawingId) === true : false;
  const cadAttached = group.cad ? attachedDrawingIds?.has(group.cad.drawingId) === true : false;
  const attachTargetAttached = attachView
    ? attachedDrawingIds?.has(attachView.drawingId) === true
    : false;
  const printDisabled = printBusy || !printView;
  const printTitle = !printView
    ? 'ISO no se imprime como OT — falta el plano CAD'
    : 'Imprimir OT';
  const cadFile = group.cad ? fileBasename(group.cad.sourcePath) : null;
  const isoFile = group.iso ? fileBasename(group.iso.sourcePath) : null;

  return (
    <TableRow>
      <TableCell className="font-medium whitespace-nowrap">
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-1.5">
            <span>{group.partNumber}</span>
            {group.cad && (
              <span className="bg-muted text-muted-foreground border border-border text-[9px] font-mono px-1 py-0.5 rounded">
                CAD
              </span>
            )}
            {group.iso && (
              <button
                type="button"
                onClick={() => group.iso && onPreview(group.iso)}
                disabled={!group.iso?.pdfUrl}
                className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-[9px] font-mono px-1 py-0.5 rounded hover:bg-blue-500/20 disabled:opacity-50"
                title={group.iso.pdfUrl ? 'Ver ISO' : 'ISO sin PDF'}
              >
                ISO
              </button>
            )}
            {!group.cad && (
              <span className="text-[9px] font-mono text-muted-foreground">sin CAD</span>
            )}
          </div>
          {printStat && printStat.count > 0 && (printView || group.iso) && (
            <button
              type="button"
              onClick={() => {
                const historyTarget = printView ?? group.iso;
                if (historyTarget) onHistory(historyTarget);
              }}
              className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded bg-muted/60 hover:bg-accent/10 border border-border hover:border-accent text-[10px] font-mono text-muted-foreground hover:text-accent transition-colors"
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
            <span className="text-xs text-destructive mt-1 font-normal whitespace-normal">
              {errorMessage}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col max-w-[200px] sm:max-w-xs">
          <span className="truncate" title={group.description}>
            {group.description || 'Sin descripción'}
          </span>
          <span className="text-xs text-muted-foreground truncate" title={cadFile ?? isoFile ?? ''}>
            <FileText size={10} className="inline-block mr-1 -mt-0.5" />
            {cadFile ?? isoFile ?? '(sin archivo)'}
            {cadFile && isoFile && cadFile !== isoFile ? ` · ${isoFile}` : ''}
          </span>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-col items-start gap-0.5">
          {group.cad && (
            <span className="inline-flex items-center justify-center rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground ring-1 ring-inset ring-secondary/20">
              {group.cad.revision}
            </span>
          )}
          {group.iso && group.iso.revision !== group.cad?.revision && (
            <span className="text-[10px] font-mono text-muted-foreground">
              ISO {group.iso.revision}
            </span>
          )}
        </div>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-2">
          {group.stlView && (
            <Button
              variant="outline"
              size="xs"
              onClick={() => group.stlView && onStl(group.stlView)}
              title="Abrir vista 3D (STL)"
            >
              <Box size={12} />
              <span className="ml-1 hidden sm:inline">3D</span>
            </Button>
          )}
          <Button
            variant="outline"
            size="xs"
            onClick={() => previewView && onPreview(previewView)}
            disabled={!previewView?.pdfUrl}
            title={previewView?.pdfUrl ? 'Ver plano CAD' : 'Plano no disponible'}
          >
            <Eye size={12} />
            <span className="ml-1 hidden sm:inline">Ver</span>
          </Button>
          <Button
            variant="outline"
            size="xs"
            onClick={() => printView && onPrint(printView)}
            disabled={printDisabled}
            title={printTitle}
          >
            {printBusy ? <Loader2 size={12} className="animate-spin" /> : <Printer size={12} />}
            <span className="ml-1 hidden sm:inline">Imprimir</span>
          </Button>
          {pendingLinkLabel && onUseForPending && pendingView && (
            <Button
              variant="default"
              size="xs"
              onClick={() => onUseForPending(pendingView)}
              title={`Usar este plano para ${pendingLinkLabel}`}
            >
              <CheckCircle2 size={12} />
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
            >
              {attachTargetAttached ? (
                <CheckCircle2 size={12} />
              ) : attachBusy ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Plus size={12} />
              )}
              <span className="ml-1 hidden sm:inline">
                {attachTargetAttached ? 'Adjunto' : 'Análisis'}
              </span>
            </Button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(buttonVariants({ variant: 'outline', size: 'icon-xs' }))}
              title="Más acciones"
            >
              <MoreHorizontal size={12} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[180px]">
              {group.cad?.pdfUrl && (
                <DropdownMenuItem onClick={() => group.cad && onPreview(group.cad)}>
                  <Eye size={12} />
                  Ver CAD
                </DropdownMenuItem>
              )}
              {group.iso?.pdfUrl && (
                <DropdownMenuItem onClick={() => group.iso && onPreview(group.iso)}>
                  <Eye size={12} />
                  Ver ISO
                </DropdownMenuItem>
              )}
              {group.cad && (
                <DropdownMenuItem onClick={() => group.cad && onUpdate(group.cad)}>
                  <RefreshCcw size={12} />
                  Nueva rev. CAD
                </DropdownMenuItem>
              )}
              {group.iso && (
                <DropdownMenuItem onClick={() => group.iso && onUpdate(group.iso)}>
                  <RefreshCcw size={12} />
                  Nueva rev. ISO
                </DropdownMenuItem>
              )}
              {showAttach && group.cad?.pdfUrl && (
                <DropdownMenuItem
                  disabled={cadAttached}
                  onClick={() => group.cad && onAttach(group.cad)}
                >
                  <Plus size={12} />
                  {cadAttached ? 'CAD ya adjunto' : 'Adjuntar CAD'}
                </DropdownMenuItem>
              )}
              {showAttach && group.iso?.pdfUrl && (
                <DropdownMenuItem
                  disabled={isoAttached}
                  onClick={() => group.iso && onAttach(group.iso)}
                >
                  <Plus size={12} />
                  {isoAttached ? 'ISO ya adjunto' : 'Adjuntar ISO'}
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {group.cad && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => group.cad && onInactivate(group.cad)}
                >
                  <Trash2 size={12} />
                  Eliminar CAD
                </DropdownMenuItem>
              )}
              {group.iso && (
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => group.iso && onInactivate(group.iso)}
                >
                  <Trash2 size={12} />
                  Eliminar ISO
                </DropdownMenuItem>
              )}
              {group.extras.map((extra) => (
                <DropdownMenuItem
                  key={extra.drawingId}
                  variant="destructive"
                  onClick={() => onInactivate(extra)}
                >
                  <Trash2 size={12} />
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

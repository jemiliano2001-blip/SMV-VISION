/**
 * ToolcribLibraryPanel
 *
 * Catálogo de planos Tool Crib. En Biblioteca (variant=page) agrupa CAD+ISO
 * en una pieza, llena el viewport y filtra por tipo de archivo. En Reporte
 * (variant=embedded) sigue siendo el acordeón compacto del flujo de análisis.
 */

import { useCallback, useEffect, useMemo, useRef, useState, Suspense, lazy, type ReactElement } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
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
  Tag,
} from 'lucide-react';

import {
  listActiveDrawingViews,
  listRecentPrintLogs,
  recordToolcribPrintLog,
  inactivatePart,
} from '../lib/firebase/toolcrib';
import { listPartAliases, type PartAliasDoc } from '../lib/firebase/aliases';
import type { ToolcribActiveDrawingView } from '../types';
import { fetchPdfAsDataUrl } from '../lib/fetchPdf';
import { formatRelativeTime } from '../lib/age';
import {
  ASSET_FILTERS,
  FAMILIES,
  attachDrawingForGroup,
  canonicalPartNumber,
  groupDrawingViews,
  isGapAssetFilter,
  matchesAssetFilter,
  matchesFamilyGroup,
  pendingPrintViewForGroup,
  previewDrawingForGroup,
  printDrawingForGroup,
  sortToolcribGroups,
  thumbnailPdfUrlForGroup,
  type AssetFilter,
  type GroupPrintMetrics,
  type PartFamily,
  type SortDirection,
  type ToolcribPartGroup,
  type ToolcribSortKey,
} from '../lib/toolcribCatalog';
import {
  buildSearchIndex,
  highlightSegments,
  searchIndex,
  withAliasSearchText,
} from '../lib/toolcribSearch';
import { ToolcribThumbnail } from './ToolcribThumbnail';
import { ToolcribUploadModal } from './ToolcribUploadModal';
import { ToolcribPrintModal } from './ToolcribPrintModal';
import { ToolcribHistoryModal } from './ToolcribHistoryModal';
import { ToolcribBatchPrintModal } from './ToolcribBatchPrintModal';
import { ToolcribAliasModal, type ToolcribAliasTarget } from './ToolcribAliasModal';
// three.js (~600 KB) y pdfjs-dist en el hilo principal solo se necesitan al
// abrir sus respectivos modales — cargan bajo demanda en lugar de ir en el
// bundle inicial (three-vendor / pdfjs-vendor chunks).
const StlViewerModal = lazy(() =>
  import('./StlViewerModal').then((m) => ({ default: m.StlViewerModal })),
);
const ToolcribPdfViewer = lazy(() =>
  import('./ToolcribPdfViewer').then((m) => ({ default: m.ToolcribPdfViewer })),
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

/** Resalta los tramos de `text` que coinciden con la busqueda. */
function Highlighted({ text, query }: { text: string; query: string }): ReactElement {
  return (
    <>
      {highlightSegments(text, query).map((segment, i) =>
        segment.match ? (
          <mark key={i} className="bg-accent/30 text-ink rounded-none px-0">
            {segment.text}
          </mark>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
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

function HealthStat({
  label,
  count,
  total,
  onClick,
  tone = 'default',
}: {
  label: string;
  count: number;
  total: number;
  onClick: () => void;
  tone?: 'default' | 'danger';
}): ReactElement {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'hover:underline transition-colors',
        tone === 'danger' ? 'text-danger hover:text-danger/80' : 'hover:text-accent',
      )}
      title={`Filtrar por ${label.toLowerCase()}`}
    >
      {label}: {count} ({pct}%)
    </button>
  );
}

function SortableHead({
  label,
  sortKey,
  activeKey,
  direction,
  onSort,
  disabled,
  className,
}: {
  label: string;
  sortKey: ToolcribSortKey;
  activeKey: ToolcribSortKey;
  direction: SortDirection;
  onSort: (key: ToolcribSortKey) => void;
  disabled?: boolean;
  className?: string;
}): ReactElement {
  const isActive = activeKey === sortKey;
  return (
    <TableHead className={cn('font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim py-2.5', className)}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        disabled={disabled}
        title={disabled ? 'Se aplica al limpiar la búsqueda' : `Ordenar por ${label.toLowerCase()}`}
        className={cn(
          'inline-flex items-center gap-1 hover:text-accent transition-colors disabled:hover:text-ink-dim disabled:cursor-default',
          isActive && !disabled && 'text-accent',
        )}
      >
        <span>{label}</span>
        {isActive && !disabled ? (
          direction === 'asc' ? (
            <ArrowUp size={10} />
          ) : (
            <ArrowDown size={10} />
          )
        ) : (
          <ArrowUpDown size={10} className="opacity-30" />
        )}
      </button>
    </TableHead>
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
  const [aliases, setAliases] = useState<PartAliasDoc[]>([]);
  const [aliasTarget, setAliasTarget] = useState<ToolcribAliasTarget | null>(null);
  const [sortKey, setSortKey] = useState<ToolcribSortKey>('partNumber');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [batchPrintDrawings, setBatchPrintDrawings] = useState<ToolcribActiveDrawingView[] | null>(
    null,
  );
  const searchInputRef = useRef<HTMLInputElement>(null);

  const loadAliases = useCallback(async () => {
    const result = await listPartAliases();
    if (result.ok === false) {
      log.warn('[toolcrib] listPartAliases falló — la búsqueda no incluirá alias de taller', result.reason);
      return;
    }
    setAliases(result.value);
  }, []);

  // Se carga una sola vez al montar (mismo ciclo de vida que loadLibrary):
  // los alias son poco frecuentes y su lectura es barata (<=1000 docs).
  useEffect(() => {
    void loadAliases();
  }, [loadAliases]);

  // "/" enfoca el buscador desde cualquier parte de la vista — en el taller se
  // llega aquí con un número de parte en la mano, no con el mouse. Se ignora si
  // el foco ya está en un campo de texto (si no, "/" sería intecleable).
  useEffect(() => {
    if (!isPage) return;
    const handleSlash = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      searchInputRef.current?.focus();
      searchInputRef.current?.select();
    };
    window.addEventListener('keydown', handleSlash);
    return () => window.removeEventListener('keydown', handleSlash);
  }, [isPage]);

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
      'missing-cad': 0,
      'missing-iso': 0,
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

  // Salud del catálogo: SIEMPRE contra el total real, no el ya acotado por
  // familia — si no, navegar a "Punzones / Marcas" haría parecer que el
  // catálogo entero mejoró o empeoró de cobertura cuando sólo cambió la vista.
  const catalogHealth = useMemo(() => {
    let withCad = 0;
    let withIso = 0;
    let with3d = 0;
    let missingBoth = 0;
    for (const group of groups) {
      if (group.cad) withCad += 1;
      if (group.iso) withIso += 1;
      if (group.stlView) with3d += 1;
      if (!group.cad?.pdfUrl && !group.iso?.pdfUrl) missingBoth += 1;
    }
    return { total: groups.length, withCad, withIso, with3d, missingBoth };
  }, [groups]);

  // Alias de taller inyectados en el searchText: "el punzón de la M" debe
  // encontrar la pieza aunque el catálogo no tenga esas palabras en ningún
  // lado. Sin alias (el caso normal) esto devuelve el mismo array sin clonar.
  const groupsWithAliases = useMemo(
    () => withAliasSearchText(groups, aliases, canonicalPartNumber),
    [groups, aliases],
  );

  // El indice se reconstruye solo cuando cambia el catalogo, no en cada tecla:
  // antes se creaba un Fuse nuevo por pulsacion sobre el set ya filtrado.
  const catalogIndex = useMemo(() => buildSearchIndex(groupsWithAliases), [groupsWithAliases]);

  const hasQuery = searchTerm.trim().length > 0;

  const filteredGroups = useMemo(() => {
    const passesFilters = (group: ToolcribPartGroup) =>
      matchesFamilyGroup(group, selectedFamily) && matchesAssetFilter(group, selectedAsset);

    if (!hasQuery) {
      // Sin búsqueda activa, el orden lo decide la columna elegida (por
      // defecto, alfabético — el comportamiento de antes). Con búsqueda
      // activa el orden lo decide la relevancia, no tendría sentido pelearse
      // por cuál gana.
      const metricsFor = (group: ToolcribPartGroup): GroupPrintMetrics => {
        const view = pendingPrintViewForGroup(group);
        const stat = view ? printStats.get(view.drawingId) : undefined;
        return { count: stat?.count ?? 0, lastPrintedAtUTC: stat?.lastPrintedAtUTC ?? null };
      };
      return sortToolcribGroups(groups.filter(passesFilters), sortKey, sortDirection, metricsFor);
    }

    // Buscar primero y filtrar despues: los escalones de `searchIndex` ya dejan
    // el orden bueno y los chips no lo alteran.
    const hits = searchIndex(catalogIndex, searchTerm, {
      // En Biblioteca/OT no se prefiere ISO: ahi imprimir siempre usa el CAD.
      tieBreak: excludeIsoForPrint ? undefined : (group) => (group.iso ? 1 : 0),
    });

    return hits.map((hit) => hit.item).filter(passesFilters);
  }, [
    hasQuery,
    searchTerm,
    catalogIndex,
    groups,
    selectedFamily,
    selectedAsset,
    excludeIsoForPrint,
    sortKey,
    sortDirection,
    printStats,
  ]);

  const toggleSort = useCallback((key: ToolcribSortKey) => {
    setSortKey((prevKey) => {
      if (prevKey === key) {
        setSortDirection((prevDir) => (prevDir === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortDirection('asc');
      }
      return key;
    });
  }, []);

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

  const toggleGroupSelection = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearSelection = useCallback(() => setSelectedKeys(new Set()), []);

  const handleBatchPrintSuccess = useCallback(
    ({ soNumber, drawings }: { soNumber: string | null; drawings: ToolcribActiveDrawingView[] }) => {
      for (const drawing of drawings) {
        if (!drawing.pdfUrl) continue;
        void recordToolcribPrintLog({
          drawingId: drawing.drawingId,
          partId: drawing.partId,
          copies: 1,
          orderRef: soNumber,
        });
      }
      clearSelection();
      // Da tiempo a que los logs lleguen a Firestore antes de refrescar,
      // igual que la impresión individual — si no, el "Nx OT" queda atrasado.
      window.setTimeout(() => void loadLibrary(), 1200);
    },
    [clearSelection, loadLibrary],
  );

  const totalCount = groups.length;
  const visibleCount = filteredGroups.length;
  const hasNarrowingFilters = selectedFamily !== 'all' || selectedAsset !== 'all';
  const resetFilters = useCallback(() => {
    setSelectedFamily('all');
    setSelectedAsset('all');
  }, []);
  const isEmpty = status === 'ready' && totalCount === 0;
  const listOpen = isPage || isOpen;

  // La impresión en lote es una función de Biblioteca (isPage): el acordeón
  // de Reporte ya tiene su propio flujo de adjuntar/imprimir por pieza y
  // añadir checkboxes ahí sólo estorbaría en un espacio ya apretado.
  const showBatchSelection = isPage;
  const selectedEligibleGroups = useMemo(
    () =>
      showBatchSelection
        ? filteredGroups.filter(
            (group) => selectedKeys.has(group.key) && printDrawingForGroup(group)?.pdfUrl,
          )
        : [],
    [showBatchSelection, filteredGroups, selectedKeys],
  );
  const visibleEligibleKeys = useMemo(
    () =>
      showBatchSelection
        ? filteredGroups.filter((group) => printDrawingForGroup(group)?.pdfUrl).map((group) => group.key)
        : [],
    [showBatchSelection, filteredGroups],
  );
  const allVisibleEligibleSelected =
    visibleEligibleKeys.length > 0 && visibleEligibleKeys.every((key) => selectedKeys.has(key));

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedKeys((prev) => {
      if (visibleEligibleKeys.length > 0 && visibleEligibleKeys.every((key) => prev.has(key))) {
        const next = new Set(prev);
        for (const key of visibleEligibleKeys) next.delete(key);
        return next;
      }
      return new Set([...prev, ...visibleEligibleKeys]);
    });
  }, [visibleEligibleKeys]);

  const handleAliasSaved = useCallback(() => {
    void loadAliases();
    onCatalogChanged?.();
  }, [loadAliases, onCatalogChanged]);

  const toolbar = (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
      <div className="relative flex-1 w-full">
        <Search size={14} className="absolute left-3 top-2.5 text-ink-dim" />
        <Input
          ref={searchInputRef}
          type="text"
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          onKeyDown={(event) => {
            // Escape limpia primero y solo suelta el foco si ya estaba vacío.
            if (event.key === 'Escape') {
              if (searchTerm.length > 0) {
                event.preventDefault();
                setSearchTerm('');
              } else {
                event.currentTarget.blur();
              }
            }
          }}
          placeholder="Buscar parte, descripción, archivo o revisión…   ( / )"
          aria-label="Buscar en el catálogo Tool Crib"
          className="pl-9 pr-24 w-full border-2 border-line bg-surface-2 text-ink h-9 text-xs font-mono focus-visible:ring-0 focus-visible:border-accent rounded-none shadow-none"
        />
        {hasQuery && (
          <div className="absolute right-2 top-1.5 flex items-center gap-1.5">
            <span className="font-mono text-[10px] text-ink-dim tabular-nums">
              {visibleCount}
            </span>
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                searchInputRef.current?.focus();
              }}
              className="p-1 border-2 border-line hover:border-accent hover:text-accent text-ink-dim transition-colors"
              title="Limpiar búsqueda (Esc)"
              aria-label="Limpiar búsqueda"
            >
              <X size={12} />
            </button>
          </div>
        )}
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
          if (isGapAssetFilter(filter.id) && count === 0) return null;
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

  // Huecos del catálogo, de un vistazo: cuánto falta digitalizar sin ir
  // pieza por pieza. Sólo en Biblioteca dedicada — el acordeón de Reporte no
  // necesita esta vista de auditoría.
  const healthStrip = isPage && catalogHealth.total > 0 && (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 font-mono text-[10px] text-ink-dim uppercase tracking-wider">
      <span className="font-bold text-ink-dim/80">Salud del catálogo:</span>
      <HealthStat
        label="Con ISO"
        count={catalogHealth.withIso}
        total={catalogHealth.total}
        onClick={() => setSelectedAsset('iso')}
      />
      <HealthStat
        label="Con CAD"
        count={catalogHealth.withCad}
        total={catalogHealth.total}
        onClick={() => setSelectedAsset('cad')}
      />
      <HealthStat
        label="Con 3D"
        count={catalogHealth.with3d}
        total={catalogHealth.total}
        onClick={() => setSelectedAsset('stl')}
      />
      {catalogHealth.missingBoth > 0 && (
        <HealthStat
          label="Sin nada"
          count={catalogHealth.missingBoth}
          total={catalogHealth.total}
          tone="danger"
          onClick={() => setSelectedAsset('missing-pdf')}
        />
      )}
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
              {showBatchSelection && (
                <TableHead className="w-8 py-2.5">
                  <input
                    type="checkbox"
                    checked={allVisibleEligibleSelected}
                    onChange={toggleSelectAllVisible}
                    disabled={visibleEligibleKeys.length === 0}
                    title="Seleccionar todas las visibles con CAD imprimible"
                    className="size-3.5 accent-accent border-2 border-line cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  />
                </TableHead>
              )}
              <TableHead className="w-14 py-2.5" />
              <SortableHead label="Número de Parte" sortKey="partNumber" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} disabled={hasQuery} />
              <SortableHead label="Descripción" sortKey="description" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} disabled={hasQuery} />
              <SortableHead label="Rev" sortKey="revision" activeKey={sortKey} direction={sortDirection} onSort={toggleSort} disabled={hasQuery} className="w-28" />
              <TableHead className="font-mono text-[10px] font-bold uppercase tracking-wider text-ink-dim py-2.5 text-right">
                <div className="flex items-center justify-end gap-2">
                  <span>Acciones</span>
                  {isPage && (
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className="inline-flex items-center gap-1 px-1.5 py-0.5 border-2 border-line hover:border-accent hover:text-accent rounded-none normal-case font-normal"
                        title="Ordenar por…"
                        disabled={hasQuery}
                      >
                        <ArrowUpDown size={10} />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="min-w-[170px] bg-surface border-2 border-line shadow-hard-accent text-ink rounded-none p-1 normal-case font-normal">
                        <DropdownMenuItem onClick={() => { setSortKey('prints'); setSortDirection('desc'); }} className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5">
                          Más impresas
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setSortKey('lastPrinted'); setSortDirection('desc'); }} className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5">
                          Impresas recientemente
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => { setSortKey('partNumber'); setSortDirection('asc'); }} className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5">
                          Alfabético
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </div>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredGroups.length === 0 ? (
              <TableRow>
                <TableCell colSpan={showBatchSelection ? 6 : 5} className="h-24 text-center font-mono text-xs text-ink-dim uppercase">
                  {hasQuery ? (
                    <div className="flex flex-col items-center gap-2">
                      <span>
                        Ningún plano coincide con «{searchTerm.trim()}»
                        {hasNarrowingFilters ? ' con estos filtros' : ''}.
                      </span>
                      <div className="flex items-center gap-2">
                        {hasNarrowingFilters && (
                          <button
                            type="button"
                            onClick={resetFilters}
                            className="border-2 border-line hover:border-accent hover:text-accent px-2 py-1 text-[10px] tracking-wider transition-colors"
                          >
                            Quitar filtros
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setSearchTerm('')}
                          className="border-2 border-line hover:border-accent hover:text-accent px-2 py-1 text-[10px] tracking-wider transition-colors"
                        >
                          Limpiar búsqueda
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center gap-2">
                      <span>Ningún plano coincide con los filtros seleccionados.</span>
                      <button
                        type="button"
                        onClick={resetFilters}
                        className="border-2 border-line hover:border-accent hover:text-accent px-2 py-1 text-[10px] tracking-wider transition-colors"
                      >
                        Quitar filtros
                      </button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ) : (
              filteredGroups.map((group) => (
                <PartGroupRow
                  key={group.key}
                  group={group}
                  searchTerm={searchTerm}
                  printStats={printStats}
                  rowState={rowState}
                  attachedDrawingIds={attachedDrawingIds}
                  pendingLinkLabel={pendingLinkLabel}
                  showAttach={Boolean(onAttachDrawing)}
                  showCheckbox={showBatchSelection}
                  selected={selectedKeys.has(group.key)}
                  onToggleSelect={toggleGroupSelection}
                  onPreview={setPreviewDrawing}
                  onPrint={setPrintDrawing}
                  onHistory={setHistoryDrawing}
                  onStl={setStlDrawing}
                  onUpdate={setUpdateDrawing}
                  onAttach={(view) => void handleAttach(view)}
                  onInactivate={(view) => void handleInactivate(view)}
                  onUseForPending={onUseForPendingOrder}
                  onAlias={setAliasTarget}
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
      {healthStrip}
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
      {showBatchSelection && selectedKeys.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-2 border-accent bg-accent/10 shrink-0">
          <span className="font-mono text-[11px] font-bold uppercase tracking-wider text-ink">
            {selectedKeys.size} {selectedKeys.size === 1 ? 'seleccionada' : 'seleccionadas'}
            {selectedEligibleGroups.length !== selectedKeys.size
              ? ` (${selectedEligibleGroups.length} imprimibles)`
              : ''}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="xs"
              onClick={() =>
                setBatchPrintDrawings(
                  selectedEligibleGroups
                    .map((group) => printDrawingForGroup(group))
                    .filter((view): view is ToolcribActiveDrawingView => view !== null),
                )
              }
              disabled={selectedEligibleGroups.length === 0}
              className="bg-accent text-bg font-mono font-bold uppercase text-[10px] tracking-wider rounded-none h-7 px-3 hover:bg-accent/80 shadow-hard active:translate-x-0.5 active:translate-y-0.5 flex items-center gap-1.5 disabled:opacity-50 disabled:shadow-none"
            >
              <Printer size={12} />
              Imprimir Lote
            </Button>
            <Button
              variant="outline"
              size="xs"
              onClick={clearSelection}
              className="border-2 border-line text-ink font-mono font-bold uppercase text-[10px] tracking-wider hover:bg-surface-2 rounded-none h-7 px-3"
            >
              Limpiar selección
            </Button>
          </div>
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
              <Suspense
                fallback={
                  <div className="flex flex-col items-center gap-2 text-ink-dim font-mono text-xs uppercase tracking-widest">
                    <Loader2 size={20} className="animate-spin text-accent" />
                    Cargando visor…
                  </div>
                }
              >
                <ToolcribPdfViewer
                  pdfUrl={previewDrawing.pdfUrl}
                  fileName={buildDisplayName(previewDrawing)}
                />
              </Suspense>
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

      <ToolcribBatchPrintModal
        drawings={batchPrintDrawings}
        onClose={() => setBatchPrintDrawings(null)}
        onSuccess={handleBatchPrintSuccess}
      />

      <ToolcribAliasModal
        target={aliasTarget}
        onClose={() => setAliasTarget(null)}
        onSaved={handleAliasSaved}
      />
    </div>
  );
}

interface PartGroupRowProps {
  group: ToolcribPartGroup;
  /** Consulta activa, sólo para resaltar los tramos coincidentes. */
  searchTerm: string;
  printStats: ReadonlyMap<string, DrawingPrintStat>;
  rowState: Record<string, RowActionState>;
  attachedDrawingIds: ReadonlySet<string> | undefined;
  pendingLinkLabel: string | null | undefined;
  showAttach: boolean;
  /** Biblioteca (isPage) muestra checkbox de selección para imprimir en lote. */
  showCheckbox: boolean;
  selected: boolean;
  onToggleSelect: (key: string) => void;
  onPreview: (view: ToolcribActiveDrawingView) => void;
  onPrint: (view: ToolcribActiveDrawingView) => void;
  onHistory: (view: ToolcribActiveDrawingView) => void;
  onStl: (view: ToolcribActiveDrawingView) => void;
  onUpdate: (view: ToolcribActiveDrawingView) => void;
  onAttach: (view: ToolcribActiveDrawingView) => void;
  onInactivate: (view: ToolcribActiveDrawingView) => void;
  onUseForPending?: (view: ToolcribActiveDrawingView) => void;
  onAlias: (target: ToolcribAliasTarget) => void;
}

function PartGroupRow({
  group,
  searchTerm,
  printStats,
  rowState,
  attachedDrawingIds,
  pendingLinkLabel,
  showAttach,
  showCheckbox,
  selected,
  onToggleSelect,
  onPreview,
  onPrint,
  onHistory,
  onStl,
  onUpdate,
  onAttach,
  onInactivate,
  onUseForPending,
  onAlias,
}: PartGroupRowProps): ReactElement {
  const printView = printDrawingForGroup(group);
  const previewView = previewDrawingForGroup(group);
  const attachView = attachDrawingForGroup(group);
  // Mismo target que abrirá el historial al hacer clic — así el número del
  // badge y lo que el modal muestra siempre coinciden (antes se sumaban las
  // impresiones de todo el grupo pero el historial solo mostraba un plano).
  const pendingView = pendingPrintViewForGroup(group);
  const printStat = pendingView ? printStats.get(pendingView.drawingId) ?? null : null;
  const selectionEligible = Boolean(printView?.pdfUrl);
  const thumbnailUrl = thumbnailPdfUrlForGroup(group);
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
      {showCheckbox && (
        <TableCell className="py-3 align-top">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(group.key)}
            disabled={!selectionEligible}
            title={selectionEligible ? 'Seleccionar para lote' : 'Sin CAD imprimible'}
            className="size-3.5 accent-accent border-2 border-line cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
          />
        </TableCell>
      )}
      <TableCell className="py-3 align-top">
        <ToolcribThumbnail pdfUrl={thumbnailUrl} alt={group.partNumber} />
      </TableCell>
      <TableCell className="font-medium whitespace-nowrap py-3">
        <div className="flex flex-col items-start">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs font-bold text-ink">
              <Highlighted text={group.partNumber} query={searchTerm} />
            </span>
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
            {group.description ? (
              <Highlighted text={group.description} query={searchTerm} />
            ) : (
              'Sin descripción'
            )}
          </span>
          <span className="text-[11px] font-mono text-ink-dim truncate" title={cadFile ?? isoFile ?? ''}>
            <FileText size={10} className="inline-block mr-1 -mt-0.5 text-ink-dim" />
            <Highlighted text={cadFile ?? isoFile ?? '(sin archivo)'} query={searchTerm} />
            {cadFile && isoFile && cadFile !== isoFile ? (
              <>
                {' · '}
                <Highlighted text={isoFile} query={searchTerm} />
              </>
            ) : null}
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
              {pendingView && (
                <DropdownMenuItem
                  onClick={() => onAlias({ partNumber: group.partNumber, drawingId: pendingView.drawingId })}
                  className="font-mono text-xs cursor-pointer hover:bg-surface-2 rounded-none px-2 py-1.5"
                >
                  <Tag size={12} className="mr-1.5" />
                  Agregar alias de taller
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

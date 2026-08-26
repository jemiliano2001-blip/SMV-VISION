/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useRef, useState, Suspense, lazy } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Order, OrderDrawingLink, ToolcribActiveDrawingView } from './types';
import { makeOrderDrawingLinkKey, getReportDrawingSnapshot } from './lib/orderDrawingBridge';
import { AppShell, type AppView } from './components/shell/AppShell';
import { InicioView } from './components/InicioView';
import { ReporteView } from './components/ReporteView';
import { OdooOrdersPanel } from './components/OdooOrdersPanel';
import { BibliotecaView } from './components/BibliotecaView';
import { ComprasPanel } from './components/ComprasPanel';
import { EntregasSinOCPanel } from './components/EntregasSinOCPanel';
import { CropAdjustModal } from './components/CropAdjustModal';
import { QuickPurchaseModal } from './components/QuickPurchaseModal';
import { ToolcribHistoryModal } from './components/ToolcribHistoryModal';
import { useVisionAnalysis } from './hooks/useVisionAnalysis';
import { useToolcribCatalog } from './hooks/useToolcribCatalog';
import { useOrderDrawingBridge } from './hooks/useOrderDrawingBridge';
import { useIndustrialHotkeys } from './hooks/useIndustrialHotkeys';

// three.js (~600 KB) solo se necesita cuando el operador abre el visor 3D —
// se carga bajo demanda en lugar de en el bundle inicial (three-vendor chunk).
const StlViewerModal = lazy(() =>
  import('./components/StlViewerModal').then((m) => ({ default: m.StlViewerModal })),
);

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('inicio');
  const [biblioSearchPrefill, setBiblioSearchPrefill] = useState('');
  const [cropAdjustTarget, setCropAdjustTarget] = useState<{
    order: Order;
    resultIndex: number;
  } | null>(null);
  const [quickPurchaseData, setQuickPurchaseData] = useState<{
    soNumber?: string;
    poNumber?: string;
    pieza?: string;
    numeroParte?: string;
    cantidad?: number | string;
    material?: string | null;
    rowKey?: string;
  } | null>(null);
  const [purchaseToast, setPurchaseToast] = useState<string | null>(null);
  const [purchasedKeys, setPurchasedKeys] = useState<Set<string>>(() => new Set());
  const [historyDrawing, setHistoryDrawing] = useState<ToolcribActiveDrawingView | null>(null);
  const [stlDrawing, setStlDrawing] = useState<ToolcribActiveDrawingView | null>(null);
  const biblioReturnViewRef = useRef<'odoo' | 'reporte'>('odoo');

  const vision = useVisionAnalysis();
  const catalog = useToolcribCatalog();
  const bridge = useOrderDrawingBridge();

  // Atajos de teclado para taller (hotkeys industriales)
  useIndustrialHotkeys({
    activeView,
    onToggleEdit: () => vision.setEditMode(!vision.editMode),
    onExportPdf: vision.downloadPdf,
    onNavigate: (v) => setActiveView(v as AppView),
    onEscape: () => {
      if (vision.previewOrder) vision.setPreviewOrder(null);
      if (cropAdjustTarget) setCropAdjustTarget(null);
      if (quickPurchaseData) setQuickPurchaseData(null);
      if (historyDrawing) setHistoryDrawing(null);
      if (stlDrawing) setStlDrawing(null);
    },
  });

  // Navegación
  const navigate = useCallback((view: AppView) => {
    setActiveView(view);
  }, []);

  const handleSendToReport = useCallback(
    async (link: OrderDrawingLink) => {
      const { errors } = await vision.seedFromBridgeLinks([link]);
      setActiveView('reporte');
      // Auto-auditoría: el operador ya eligió "Reporte" en Órdenes.
      if (errors.length === 0 || getReportDrawingSnapshot(link)) {
        void vision.extractInfo();
      }
    },
    [vision],
  );

  const handleOpenBiblioteca = useCallback(
    (query: string, linkKey: string) => {
      biblioReturnViewRef.current = 'odoo';
      bridge.setPendingKey(linkKey);
      setBiblioSearchPrefill(query);
      setActiveView('biblioteca');
    },
    [bridge],
  );

  const handleVincularFromReport = useCallback(
    (order: Order) => {
      const so = order.orden.split('\n')[0] || 'report';
      const key = makeOrderDrawingLinkKey(`report:${so}`, 0);
      // Asegura un link de sesión para que upsertManual / alias funcionen.
      bridge.resolveAndStore(
        {
          orderId: `report:${so}`,
          lineIndex: 0,
          soNumber: so,
          poNumber: order.poNumber ?? '',
          pieza: order.pieza,
          numeroParte: order.numero_parte ?? '',
          qtyPending: Number.parseFloat(order.cantidad.split('\n')[0]) || 0,
        },
        catalog.views,
        catalog.signalsByDrawingId,
      );
      biblioReturnViewRef.current = 'reporte';
      bridge.setPendingKey(key);
      setBiblioSearchPrefill(order.numero_parte || order.pieza);
      setActiveView('biblioteca');
    },
    [bridge, catalog.views, catalog.signalsByDrawingId],
  );

  const handleUseDrawingForPending = useCallback(
    (view: ToolcribActiveDrawingView) => {
      const key = bridge.pendingKey;
      if (!key) return;
      const updated = bridge.upsertManual(key, view);
      bridge.setPendingKey(null);
      setBiblioSearchPrefill('');
      const returnTo = biblioReturnViewRef.current;
      biblioReturnViewRef.current = 'odoo';
      if (updated && returnTo === 'reporte') {
        void vision.seedFromBridgeLinks([updated]).then(() => {
          setActiveView('reporte');
          void vision.extractInfo();
        });
        return;
      }
      if (updated) {
        setActiveView('odoo');
      }
    },
    [bridge, vision],
  );

  const pendingBibliotecaLink = bridge.pendingKey
    ? bridge.links[bridge.pendingKey] ?? null
    : null;

  return (
    <>
      <AppShell activeView={activeView} onNavigate={navigate} version="v3.1.PRO">
        {/* ── Generar Reporte — montado siempre, oculto para preservar PDFs/resultados ── */}
        <div className="h-full" style={{ display: activeView === 'reporte' ? 'block' : 'none' }}>
          <ReporteView
            vision={vision}
            catalog={catalog}
            purchasedKeys={purchasedKeys}
            onEncuadre={setCropAdjustTarget}
            onQuickPurchase={setQuickPurchaseData}
            onViewStl={setStlDrawing}
            onViewHistory={setHistoryDrawing}
            onVincular={handleVincularFromReport}
          />
        </div>

        {/* ── Otras vistas (con transición) ── */}
        <AnimatePresence mode="wait">
          {activeView !== 'reporte' && (
            <motion.div
              key={activeView}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className={
                activeView === 'biblioteca' ? 'h-full overflow-hidden' : 'h-full overflow-y-auto'
              }
            >
              {activeView === 'inicio' && (
                <InicioView onNavigate={navigate} analysisSummary={vision.analysisSummary} />
              )}
              {activeView === 'odoo' && (
                <OdooOrdersPanel
                  catalog={catalog}
                  bridge={bridge}
                  onSendToReport={handleSendToReport}
                  onOpenBiblioteca={handleOpenBiblioteca}
                />
              )}
              {activeView === 'biblioteca' && (
                <BibliotecaView
                  searchPrefill={biblioSearchPrefill}
                  pendingLink={pendingBibliotecaLink}
                  onUseDrawingForPending={handleUseDrawingForPending}
                />
              )}
              {activeView === 'compras' && <ComprasPanel />}
              {activeView === 'entregas-sin-oc' && <EntregasSinOCPanel />}
            </motion.div>
          )}
        </AnimatePresence>
      </AppShell>

      {/* Modal de edición y ajuste interactivo de encuadre / recorte */}
      <CropAdjustModal
        order={cropAdjustTarget?.order ?? null}
        open={cropAdjustTarget !== null}
        onClose={() => setCropAdjustTarget(null)}
        onSaveCrop={(_order, newBox, newCroppedUrl) => {
          if (!cropAdjustTarget) return;
          vision.handleUpdateOrderCrop(cropAdjustTarget.resultIndex, newBox, newCroppedUrl);
        }}
      />

      {/* Modal de Requisición Rápida de Compras */}
      <QuickPurchaseModal
        open={quickPurchaseData !== null}
        defaultData={quickPurchaseData}
        onClose={() => setQuickPurchaseData(null)}
        onSuccess={() => {
          const key = quickPurchaseData?.rowKey;
          if (key) {
            setPurchasedKeys((prev) => new Set(prev).add(key));
          }
          setPurchaseToast('✓ Requisición guardada con éxito en Compras.');
          setTimeout(() => setPurchaseToast(null), 4000);
        }}
      />

      <ToolcribHistoryModal drawing={historyDrawing} onClose={() => setHistoryDrawing(null)} />

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

      {/* Toast de confirmación de compra */}
      {purchaseToast && (
        <div className="fixed bottom-6 right-6 z-50 bg-[#0D2B4D] text-white border-2 border-accent shadow-hard px-4 py-2.5 font-mono text-xs flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 duration-200">
          <span className="text-accent font-bold">✓</span>
          <span>{purchaseToast}</span>
          <button
            type="button"
            className="ml-2 underline text-accent hover:text-white"
            onClick={() => {
              setPurchaseToast(null);
              setActiveView('compras');
            }}
          >
            Ir a Compras
          </button>
        </div>
      )}
    </>
  );
}

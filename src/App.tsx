/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useMemo, useState } from 'react';
import { motion, AnimatePresence } from "motion/react";
import type { Order, WorkOrder } from './types';
import { ReportView } from './components/ReportView';
import { WorkOrdersPanel } from './components/WorkOrdersPanel';
import { OdooOrdersPanel } from './components/OdooOrdersPanel';
import { AppShell, type AppView } from './components/shell/AppShell';
import { InicioView, type AlertSeverity } from './components/InicioView';
import { BibliotecaView } from './components/BibliotecaView';
import { useDashboardSummary } from './lib/useDashboardSummary';
import { buildDedupeKey } from './lib/workOrders/dedupe';
import { useVisionAnalysis } from './hooks/useVisionAnalysis';

/**
 * Llave de dedup de una orden del REPORTE (mismo formato que el upsert de
 * Control). Permite mapear una fila del reporte a su `WorkOrder` en Firestore.
 */
function dedupeKeyOfReportOrder(order: Order): string {
  return buildDedupeKey({
    soNumber: order.orden,
    poNumber: order.poNumber ?? '',
    numeroParte: order.numero_parte ?? '',
    pieza: order.pieza,
  });
}


export default function App() {
  const [activeView, setActiveView] = useState<AppView>('inicio');
  const [controlAlert, setControlAlert] = useState<AlertSeverity | null>(null);
  const { summary, refresh } = useDashboardSummary();

  // Mapa dedupeKey -> WorkOrder (de Control) para enlazar cada fila del reporte
  // con su documento en Firestore y poder sincronizar ediciones/exclusiones.
  const workOrderByKey = useMemo(() => {
    const map = new Map<string, WorkOrder>();
    for (const wo of summary.orders) {
      const key = buildDedupeKey({
        soNumber: wo.soNumber,
        poNumber: wo.poNumber,
        numeroParte: wo.numeroParte,
        pieza: wo.pieza,
      });
      if (!map.has(key)) map.set(key, wo);
    }
    return map;
  }, [summary.orders]);

  const findWorkOrderId = useCallback(
    (order: Order): string | null => workOrderByKey.get(dedupeKeyOfReportOrder(order))?.id ?? null,
    [workOrderByKey],
  );

  const vision = useVisionAnalysis({ findWorkOrderId, onDataChanged: refresh });

  // Navegación: al ir a Control sin una alerta específica, limpia el filtro.
  const navigate = useCallback((view: AppView) => {
    if (view !== 'control') setControlAlert(null);
    setActiveView(view);
  }, []);

  // Desde "atención inmediata" de Inicio: salta a Control con el filtro puesto.
  const handleFocusAlert = useCallback((sev: AlertSeverity) => {
    setControlAlert(sev);
    setActiveView('control');
  }, []);


  return (
    <>
      <AppShell
        activeView={activeView}
        onNavigate={navigate}
        counts={summary.counts}
        version="v3.1.PRO"
      >
        {/* ── Generar Reporte ── */}
        <div className="h-full" style={{ display: activeView === 'reporte' ? 'block' : 'none' }}>
          <ReportView vision={vision} summary={summary} />
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
              className="h-full overflow-y-auto"
            >
              {activeView === 'inicio' && (
                <InicioView
                  summary={summary}
                  onNavigate={navigate}
                  onFocusAlert={handleFocusAlert}
                  analysisSummary={vision.analysisSummary}
                />
              )}
              {activeView === 'control' && (
                <WorkOrdersPanel initialAlertFilter={controlAlert} onDataChanged={refresh} />
              )}
              {activeView === 'odoo' && <OdooOrdersPanel />}
              {activeView === 'biblioteca' && <BibliotecaView />}
            </motion.div>
          )}
        </AnimatePresence>
      </AppShell>
    </>
  );
}


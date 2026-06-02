/**
 * AppShell — marco de la aplicación: rail de navegación fijo + área de
 * contenido a viewport completo (corrige el doble-header y el desborde de
 * altura previos). El switching de vistas lo decide App (dueño del estado de
 * Reporte, que se preserva oculto en vez de desmontarse).
 */

import type { ReactElement, ReactNode } from 'react';

import { NavRail, type AppView } from './NavRail';
import type { DashboardCounts } from '../../lib/useDashboardSummary';

export type { AppView } from './NavRail';

export interface AppShellProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  counts: DashboardCounts;
  version: string;
  children: ReactNode;
}

export function AppShell({ activeView, onNavigate, counts, version, children }: AppShellProps): ReactElement {
  return (
    <div className="h-screen w-full flex bg-bg text-ink overflow-hidden font-sans">
      <NavRail activeView={activeView} onNavigate={onNavigate} counts={counts} version={version} />
      <main className="flex-1 min-w-0 h-full relative overflow-hidden">
        {children}
      </main>
    </div>
  );
}

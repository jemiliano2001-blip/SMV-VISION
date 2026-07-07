/**
 * AppShell — marco de la aplicación: rail de navegación fijo + área de
 * contenido a viewport completo (corrige el doble-header y el desborde de
 * altura previos). El switching de vistas lo decide App (dueño del estado de
 * Reporte, que se preserva oculto en vez de desmontarse).
 */

import type { ReactElement, ReactNode } from 'react';

import { NavRail, type AppView } from './NavRail';
import { Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from '../ui/sheet';
import { Button } from '../ui/button';

export type { AppView } from './NavRail';

export interface AppShellProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  version: string;
  children: ReactNode;
}

export function AppShell({ activeView, onNavigate, version, children }: AppShellProps): ReactElement {
  return (
    <div className="h-screen w-full flex bg-bg text-ink overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block w-60 shrink-0 border-r-2 border-line">
        <NavRail activeView={activeView} onNavigate={onNavigate} version={version} />
      </div>

      <main className="flex-1 min-w-0 h-full flex flex-col relative overflow-hidden">
        {/* Mobile Header */}
        <div className="lg:hidden shrink-0 h-16 border-b-2 border-line bg-surface flex items-center px-4 gap-3">
          <Sheet>
            <SheetTrigger render={
              <Button variant="outline" size="icon" className="h-10 w-10 rounded-none border-2 border-line text-ink bg-surface-2 hover:bg-accent hover:border-accent hover:text-bg transition-colors">
                <Menu size={20} />
              </Button>
            } />
            <SheetContent side="left" className="p-0 w-64 border-r-2 border-line bg-surface">
              <SheetTitle className="sr-only">Menú de Navegación</SheetTitle>
              <SheetDescription className="sr-only">Navega por las distintas secciones de la aplicación.</SheetDescription>
              <NavRail activeView={activeView} onNavigate={onNavigate} version={version} />
            </SheetContent>
          </Sheet>
          <div className="font-display font-black text-xl tracking-[-0.5px] italic leading-none min-w-0 pt-1">
            SMV<span className="text-accent">//</span>VISION
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 h-full relative overflow-hidden">
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * AppShell — marco de la aplicación: rail de navegación fijo + área de
 * contenido a viewport completo.
 * 
 * En móvil (< lg):
 * - Drawer controlado que se cierra automáticamente al navegar a cualquier vista.
 * - Header móvil compacto con título de sección actual y alternador de tema.
 */

import { useState, type ReactElement, type ReactNode } from 'react';
import { NavRail, type AppView } from './NavRail';
import { Menu, Sun, Moon } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from '../ui/sheet';
import { Button } from '../ui/button';
import { useTheme } from 'next-themes';

export type { AppView } from './NavRail';

export interface AppShellProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  version: string;
  children: ReactNode;
}

const VIEW_TITLES: Record<AppView, string> = {
  inicio: 'Inicio',
  reporte: 'Generar Reporte',
  odoo: 'Órdenes Odoo',
  biblioteca: 'Biblioteca',
  herramental: 'Herramental CNC',
  compras: 'Compras',
  'entregas-sin-oc': 'Entregas sin OC',
};

export function AppShell({ activeView, onNavigate, version, children }: AppShellProps): ReactElement {
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const { theme, setTheme } = useTheme();

  const handleMobileNavigate = (view: AppView) => {
    onNavigate(view);
    setMobileDrawerOpen(false);
  };

  return (
    <div className="h-screen w-full flex bg-bg text-ink overflow-hidden font-sans">
      {/* Desktop Sidebar */}
      <div className="hidden lg:block w-60 shrink-0 border-r-2 border-line">
        <NavRail activeView={activeView} onNavigate={onNavigate} version={version} />
      </div>

      <main className="flex-1 min-w-0 h-full flex flex-col relative overflow-hidden">
        {/* Mobile Header */}
        <div className="lg:hidden shrink-0 h-14 sm:h-16 border-b-2 border-line bg-surface flex items-center justify-between px-3 sm:px-4 gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <Sheet open={mobileDrawerOpen} onOpenChange={setMobileDrawerOpen}>
              <SheetTrigger render={
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9 rounded-none border-2 border-line text-ink bg-surface-2 hover:bg-accent hover:border-accent hover:text-bg transition-colors shrink-0"
                  aria-label="Abrir menú de navegación"
                >
                  <Menu size={18} />
                </Button>
              } />
              <SheetContent side="left" className="p-0 w-64 border-r-2 border-line bg-surface">
                <SheetTitle className="sr-only">Menú de Navegación</SheetTitle>
                <SheetDescription className="sr-only">Navega por las distintas secciones de la aplicación.</SheetDescription>
                <NavRail activeView={activeView} onNavigate={handleMobileNavigate} version={version} />
              </SheetContent>
            </Sheet>

            <div className="flex items-center gap-2 min-w-0">
              <div className="font-display font-black text-lg sm:text-xl tracking-[-0.5px] italic leading-none pt-0.5 shrink-0">
                SMV<span className="text-accent">//</span>VISION
              </div>
              <span className="hidden xs:inline-block text-ink-dim">·</span>
              <span className="font-mono text-[10px] sm:text-xs uppercase font-bold text-accent truncate max-w-[130px] sm:max-w-[200px]">
                {VIEW_TITLES[activeView] || activeView}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="p-1.5 border border-line bg-surface-2 text-ink-dim hover:text-accent transition-colors"
              title={theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
              aria-label="Cambiar tema"
            >
              {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
            </button>
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

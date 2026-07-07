/**
 * NavRail — rail de navegación vertical fijo (instrumento de ingeniería).
 *
 * - Destinos con icono + etiqueta + badge en vivo (pendientes; punto rojo si
 *   hay vencidas).
 * - Integra la sesión (de Firebase Auth) al pie → elimina la barra superior
 *   duplicada que antes vivía en AuthGate.
 * - Responsive: en <lg se contrae a solo-iconos.
 */

import { useCallback, type ReactElement } from 'react';
import {
  LayoutDashboard, ScanLine, Library,
  LogOut, Loader2, Ghost, Boxes, CloudDownload, ShoppingCart, Moon, Sun, FileWarning, ExternalLink, BarChart3, type LucideIcon,
} from 'lucide-react';

import { useTheme } from 'next-themes';
import { isFirebaseConfigured } from '../../lib/firebase/env';
import { signOutUser, useFirebaseUser } from '../../lib/firebase/auth';

export type AppView = 'inicio' | 'reporte' | 'biblioteca' | 'odoo' | 'compras' | 'entregas-sin-oc';

interface NavItemDef {
  view: AppView;
  label: string;
  icon: LucideIcon;
}

const NAV_ITEMS: NavItemDef[] = [
  { view: 'inicio', label: 'Inicio', icon: LayoutDashboard },
  { view: 'reporte', label: 'Generar Reporte', icon: ScanLine },
  { view: 'odoo', label: 'Órdenes Odoo', icon: CloudDownload },
  { view: 'biblioteca', label: 'Biblioteca', icon: Library },
  { view: 'compras', label: 'Compras', icon: ShoppingCart },
  { view: 'entregas-sin-oc', label: 'Entregas sin OC', icon: FileWarning },
];

export interface NavRailProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  version: string;
}

export function NavRail({ activeView, onNavigate, version }: NavRailProps): ReactElement {
  const auth = useFirebaseUser();
  const configured = isFirebaseConfigured();
  const { theme, setTheme } = useTheme();

  const handleSignOut = useCallback(() => {
    void signOutUser();
  }, []);

  const user = auth.status === 'signed-in' ? auth.user : null;
  const displayName = user?.displayName ?? user?.email ?? null;
  const initial = (displayName ?? 'SMV').trim().charAt(0).toUpperCase();

  return (
    <nav
      aria-label="Navegación principal"
      className="w-full h-full bg-surface flex flex-col"
    >
      {/* ── Marca ── */}
      <div className="h-16 flex items-center gap-3 px-4 border-b-2 border-line">
        <span className="grid place-items-center w-9 h-9 bg-accent text-bg shrink-0 corner-ticks">
          <Boxes size={20} strokeWidth={2.4} />
        </span>
        <div className="leading-none min-w-0">
          <p className="font-display font-black text-[18px] tracking-[-0.5px] italic">
            SMV<span className="text-accent">//</span>VISION
          </p>
          <p className="font-mono text-[8px] uppercase tracking-[3px] text-ink-dim mt-0.5">
            Suprajit Analyzer
          </p>
        </div>
      </div>

      {/* ── Destinos ── */}
      <ul className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ view, label, icon: Icon }) => {
          const active = activeView === view;
          return (
            <li key={view}>
              <button
                type="button"
                onClick={() => onNavigate(view)}
                aria-current={active ? 'page' : undefined}
                title={label}
                className={`group relative w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  active
                    ? 'bg-surface-2 text-ink'
                    : 'text-ink-dim hover:text-ink hover:bg-surface-2/60'
                }`}
              >
                {/* barra de acento del activo */}
                <span
                  className={`absolute left-0 top-0 bottom-0 w-[3px] ${active ? 'bg-accent' : 'bg-transparent'}`}
                  aria-hidden
                />
                <Icon size={19} strokeWidth={active ? 2.4 : 2} className={active ? 'text-accent' : ''} />
                <span className="font-display font-bold text-[13px] uppercase tracking-wide truncate flex-1">
                  {label}
                </span>
              </button>
            </li>
          );
        })}

        {/* ── Link externo: Dashboard Visual ── */}
        <li className="border-t border-line mt-2 pt-2">
          <a
            href="https://dashboardsmv.web.app/"
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir Dashboard Visual en nueva pestaña"
            className="group relative w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent text-ink-dim hover:text-ink hover:bg-surface-2/60"
          >
            <BarChart3 size={19} strokeWidth={2} />
            <span className="font-display font-bold text-[13px] uppercase tracking-wide truncate flex-1">
              Dashboard Visual
            </span>
            <ExternalLink size={12} className="shrink-0 opacity-50 group-hover:opacity-100" />
          </a>
        </li>
      </ul>

      {/* ── Sesión + versión ── */}
      <div className="border-t-2 border-line p-2">
        {auth.status === 'loading' ? (
          <div className="flex items-center gap-2 px-2 py-2 text-ink-dim">
            <Loader2 size={14} className="animate-spin" />
            <span className="font-mono text-[10px] uppercase tracking-widest">Sesión…</span>
          </div>
        ) : user ? (
          <div className="flex items-center gap-2 px-1 py-1">
            <span className="grid place-items-center w-8 h-8 shrink-0 bg-surface-2 border-2 border-line font-display font-black text-[13px]">
              {initial}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-bold text-ink truncate" title={displayName ?? ''}>{displayName}</p>
              <p className="font-mono text-[8px] uppercase tracking-widest text-ink-dim">Sesión activa</p>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              title="Cerrar sesión"
              aria-label="Cerrar sesión"
              className="shrink-0 p-1.5 text-ink-dim hover:text-accent hover:bg-surface-2 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              <LogOut size={15} />
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-2 py-2" title={configured ? 'Sesión local de depuración' : 'Firebase no configurado'}>
            <Ghost size={15} className="text-warn shrink-0" />
            <span className="font-mono text-[9px] uppercase tracking-widest text-ink-dim leading-tight">
              {configured ? 'Modo debug' : 'Sin Firebase'}
            </span>
          </div>
        )}

        <div className="flex items-center justify-between px-2 pt-1.5 pb-0.5">
          <p className="font-mono text-[8px] uppercase tracking-[2px] text-ink-dim/60">
            {version}
          </p>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className="p-1 text-ink-dim hover:text-accent transition-colors outline-none focus-visible:ring-2 focus-visible:ring-accent"
            title={theme === 'dark' ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          >
            {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
          </button>
        </div>
      </div>
    </nav>
  );
}

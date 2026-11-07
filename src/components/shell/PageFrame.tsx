/**
 * Marco común de cada sección: encabezado compacto, franja opcional de
 * herramientas y un cuerpo que es el único dueño del scroll de la página.
 */

import type { ReactNode } from 'react';

export interface PageFrameProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Filtros y búsqueda, debajo del encabezado. */
  toolbar?: ReactNode;
  /** Avisos de ancho completo entre la franja y el cuerpo. */
  notices?: ReactNode;
  /** `form` centra un ancho legible para formularios. */
  width?: 'full' | 'form';
  /** `false` cuando el contenido maneja sus propios paneles con scroll. */
  scrollBody?: boolean;
  children: ReactNode;
}

export function PageFrame({
  title,
  subtitle,
  actions,
  toolbar,
  notices,
  width = 'full',
  scrollBody = true,
  children,
}: PageFrameProps) {
  return (
    <div className="h-full flex flex-col bg-bg">
      <header className="shrink-0 border-b border-line bg-surface/95 backdrop-blur-xl px-4 sm:px-6 py-3 flex items-center justify-between flex-wrap gap-x-6 gap-y-2">
        <div className="min-w-0">
          <h1 className="workspace-title text-2xl lg:text-3xl text-ink">{title}</h1>
          {subtitle && <div className="text-xs text-ink-dim mt-1">{subtitle}</div>}
        </div>
        {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </header>

      {toolbar && (
        <div className="shrink-0 border-b border-line bg-surface px-4 sm:px-6 py-2">{toolbar}</div>
      )}
      {notices}

      {scrollBody ? (
        <main className="flex-1 min-h-0 overflow-y-auto">
          <div className={width === 'form' ? 'max-w-4xl mx-auto p-4 sm:p-6' : 'min-h-full p-4 sm:p-6'}>
            {children}
          </div>
        </main>
      ) : (
        <main className="flex-1 min-h-0 flex overflow-hidden">{children}</main>
      )}
    </div>
  );
}

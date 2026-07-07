/**
 * ErrorBoundary global: si un componente lanza durante render/lifecycle,
 * React desmonta todo el árbol y deja la pantalla en blanco. Este boundary
 * lo sustituye por una pantalla de error recuperable (recargar página).
 *
 * Nota: los errores de handlers de eventos y promesas NO pasan por aquí
 * (React solo enruta errores de render); esos ya se manejan con los
 * result types de la capa Firebase y los try/catch del pipeline.
 */

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { log } from '../lib/log';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    log.error('[smv-vision][error-boundary] crash de render', error, info.componentStack);
  }

  render(): ReactNode {
    if (this.state.error === null) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-bg bp-grid-lg flex items-center justify-center p-6 font-sans">
        <div className="w-full max-w-lg border-2 border-danger bg-surface shadow-hard corner-ticks">
          <div className="border-b-2 border-danger px-6 py-4 bg-surface-2 text-ink">
            <h1 className="font-display text-[20px] font-black tracking-[-0.5px] uppercase italic">
              SMV<span className="text-danger">//</span>VISION
            </h1>
          </div>
          <div className="p-6 flex flex-col gap-4">
            <p className="font-mono text-[11px] font-black uppercase tracking-widest text-danger">
              Error inesperado de interfaz
            </p>
            <p className="text-[13px] text-ink-dim leading-snug">
              Algo falló al dibujar la pantalla. Tu trabajo en Firestore no se
              pierde; recarga para continuar. Si se repite, comparte el detalle
              de abajo.
            </p>
            <pre className="border-2 border-line bg-surface-2 text-ink-dim p-3 text-[10px] font-mono overflow-x-auto whitespace-pre-wrap break-words max-h-40 overflow-y-auto">
              {this.state.error.message}
            </pre>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full bg-danger text-bg hover:bg-danger/80 px-4 py-3 text-[13px] font-black uppercase tracking-widest shadow-hard active:translate-x-0.5 active:translate-y-0.5 transition-all"
            >
              Recargar aplicación
            </button>
          </div>
        </div>
      </div>
    );
  }
}

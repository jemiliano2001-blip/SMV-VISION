import type { ReactElement } from 'react';
import type { DataSourceRef } from '../../lib/tooling/types';

interface DataSourceChipProps {
  source: DataSourceRef;
  className?: string;
}

/**
 * Chip reutilizable de atribución de fuente de datos (§ HANDOFF-HERRAMENTAL-CNC.md
 * Fase 3). Mismo estilo que el `TapDrillSourceChip` local de `ThreadingAdvisorTab`
 * (Fase 2): texto mono minúsculo, enlace si hay URL, y fecha de verificación.
 */
export function DataSourceChip({ source, className = '' }: DataSourceChipProps): ReactElement {
  return (
    <p className={`font-mono text-[9px] uppercase tracking-widest text-ink-dim ${className}`}>
      Fuente:{' '}
      {source.url ? (
        <a
          href={source.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-accent font-bold hover:underline normal-case tracking-normal"
        >
          {source.label}
        </a>
      ) : (
        <span className="text-ink font-bold normal-case tracking-normal">{source.label}</span>
      )}
      {' '}· verificado {source.verifiedOn}
    </p>
  );
}

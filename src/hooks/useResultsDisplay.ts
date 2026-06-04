import { useMemo, useState } from 'react';
import type { Order } from '../types';

export interface ResultsDisplayAPI {
  resultsFilter: string;
  filterUrgentOnly: boolean;
  filterMissingOnly: boolean;
  filteredResults: Order[] | null;
  previewOrder: Order | null;
  setResultsFilter: (v: string) => void;
  setFilterUrgentOnly: (v: boolean) => void;
  setFilterMissingOnly: (v: boolean) => void;
  setPreviewOrder: (order: Order | null) => void;
}

export function useResultsDisplay(results: Order[] | null): ResultsDisplayAPI {
  const [resultsFilter, setResultsFilter] = useState('');
  const [filterUrgentOnly, setFilterUrgentOnly] = useState(false);
  const [filterMissingOnly, setFilterMissingOnly] = useState(false);
  const [previewOrder, setPreviewOrder] = useState<Order | null>(null);

  const filteredResults = useMemo(() => {
    if (!results) return null;
    const term = resultsFilter.trim().toLowerCase();
    return results.filter((order) => {
      if (filterUrgentOnly && order.prioridad !== 'URGENTE') return false;
      if (filterMissingOnly && order.isometricView) return false;
      if (term.length === 0) return true;
      return [order.pieza, order.numero_parte ?? '', order.orden, order.sourcePdfName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(term);
    });
  }, [results, resultsFilter, filterUrgentOnly, filterMissingOnly]);

  return {
    resultsFilter, filterUrgentOnly, filterMissingOnly,
    filteredResults, previewOrder,
    setResultsFilter, setFilterUrgentOnly, setFilterMissingOnly, setPreviewOrder,
  };
}

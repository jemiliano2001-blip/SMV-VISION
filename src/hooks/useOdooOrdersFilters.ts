import { useMemo, useState } from 'react';
import type { OdooOrderView } from '../lib/firebase/odooOrders';
import { getOrderAgeDays } from '../lib/age';

export type UrgencyFilter = 'ALL' | 'OVERDUE' | 'CRITICAL' | 'NORMAL' | 'MISSING_DRAWING';

export interface UseOdooOrdersFiltersOptions {
  orders: OdooOrderView[];
  isOrderMissingDrawing?: (order: OdooOrderView) => boolean;
}

export function getOrderUrgencyCategory(
  order: OdooOrderView,
): 'OVERDUE' | 'CRITICAL' | 'NORMAL' | 'UNKNOWN' {
  if (!order.date_order) return 'UNKNOWN';
  const cleanDate = order.date_order.split(' ')[0].split('T')[0];
  const days = getOrderAgeDays(cleanDate);
  if (days === null) return 'UNKNOWN';
  if (days > 14) return 'OVERDUE';
  if (days >= 8) return 'CRITICAL';
  return 'NORMAL';
}

export function useOdooOrdersFilters({
  orders,
  isOrderMissingDrawing,
}: UseOdooOrdersFiltersOptions) {
  const [viewMode, setViewMode] = useState<'all' | 'by_requisitor'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRequisitor, setSelectedRequisitor] = useState<string>('ALL');
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('ALL');
  const [collapsedRequisitores, setCollapsedRequisitores] = useState<Record<string, boolean>>({});

  // Lista de Requisitores únicos para el filtro selector
  const uniqueRequisitores = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      set.add(o.requisitor || 'Sin Requisitor');
    }
    return Array.from(set).sort();
  }, [orders]);

  // Órdenes que pasan la búsqueda libre (base común)
  const searchMatchedOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((o) => {
      const nameMatch = o.name.toLowerCase().includes(term);
      const poMatch = (o.client_order_ref || '').toLowerCase().includes(term);
      const partnerMatch = o.partner.toLowerCase().includes(term);
      const reqMatch = (o.requisitor || '').toLowerCase().includes(term);
      const lineMatch = (o.order_lines ?? []).some(
        (l) =>
          (l.product || '').toLowerCase().includes(term) ||
          (l.description || '').toLowerCase().includes(term),
      );
      return nameMatch || poMatch || partnerMatch || reqMatch || lineMatch;
    });
  }, [orders, searchTerm]);

  // Contadores de urgencia en base a la búsqueda actual
  const urgencyCounts = useMemo(() => {
    let overdue = 0;
    let critical = 0;
    let normal = 0;
    let missingDrawing = 0;

    for (const o of searchMatchedOrders) {
      const cat = getOrderUrgencyCategory(o);
      if (cat === 'OVERDUE') overdue += 1;
      else if (cat === 'CRITICAL') critical += 1;
      else if (cat === 'NORMAL') normal += 1;

      if (isOrderMissingDrawing && isOrderMissingDrawing(o)) {
        missingDrawing += 1;
      }
    }

    return {
      all: searchMatchedOrders.length,
      overdue,
      critical,
      normal,
      missingDrawing,
    };
  }, [searchMatchedOrders, isOrderMissingDrawing]);

  // Órdenes filtradas por texto, requisitor y urgencia
  const filteredOrders = useMemo(() => {
    return searchMatchedOrders.filter((o) => {
      if (selectedRequisitor !== 'ALL') {
        if ((o.requisitor || 'Sin Requisitor') !== selectedRequisitor) return false;
      }

      if (urgencyFilter === 'OVERDUE') {
        return getOrderUrgencyCategory(o) === 'OVERDUE';
      }
      if (urgencyFilter === 'CRITICAL') {
        return getOrderUrgencyCategory(o) === 'CRITICAL';
      }
      if (urgencyFilter === 'NORMAL') {
        return getOrderUrgencyCategory(o) === 'NORMAL';
      }
      if (urgencyFilter === 'MISSING_DRAWING') {
        return isOrderMissingDrawing ? isOrderMissingDrawing(o) : false;
      }

      return true;
    });
  }, [searchMatchedOrders, selectedRequisitor, urgencyFilter, isOrderMissingDrawing]);

  // Agrupación de órdenes por Requisitor
  const groupedByRequisitor = useMemo(() => {
    const groups = new Map<string, OdooOrderView[]>();
    for (const order of filteredOrders) {
      const reqKey = order.requisitor || 'Sin Requisitor';
      if (!groups.has(reqKey)) {
        groups.set(reqKey, []);
      }
      groups.get(reqKey)!.push(order);
    }
    // Ordenar grupos alfabéticamente (poniendo "Sin Requisitor" al final)
    return Array.from(groups.entries()).sort(([a], [b]) => {
      if (a === 'Sin Requisitor') return 1;
      if (b === 'Sin Requisitor') return -1;
      return a.localeCompare(b);
    });
  }, [filteredOrders]);

  const toggleGroupCollapse = (reqKey: string) => {
    setCollapsedRequisitores((prev) => ({
      ...prev,
      [reqKey]: !prev[reqKey],
    }));
  };

  return {
    viewMode,
    setViewMode,
    searchTerm,
    setSearchTerm,
    selectedRequisitor,
    setSelectedRequisitor,
    urgencyFilter,
    setUrgencyFilter,
    urgencyCounts,
    collapsedRequisitores,
    setCollapsedRequisitores,
    uniqueRequisitores,
    searchMatchedOrders,
    filteredOrders,
    groupedByRequisitor,
    toggleGroupCollapse,
  };
}

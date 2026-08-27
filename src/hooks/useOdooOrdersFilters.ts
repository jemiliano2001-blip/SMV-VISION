import { useMemo, useState } from 'react';
import type { OdooOrderView } from '../lib/firebase/odooOrders';

export interface UseOdooOrdersFiltersOptions {
  orders: OdooOrderView[];
}

export function useOdooOrdersFilters({ orders }: UseOdooOrdersFiltersOptions) {
  const [viewMode, setViewMode] = useState<'all' | 'by_requisitor'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRequisitor, setSelectedRequisitor] = useState<string>('ALL');
  const [collapsedRequisitores, setCollapsedRequisitores] = useState<Record<string, boolean>>({});

  // Lista de Requisitores únicos para el filtro selector
  const uniqueRequisitores = useMemo(() => {
    const set = new Set<string>();
    for (const o of orders) {
      set.add(o.requisitor || 'Sin Requisitor');
    }
    return Array.from(set).sort();
  }, [orders]);

  // Órdenes que pasan la búsqueda libre (sin aplicar el filtro de requisitor —
  // esta base es la que usan los contadores del propio selector de requisitor,
  // que no pueden auto-filtrarse por la opción que están a punto de ofrecer).
  const searchMatchedOrders = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return orders;
    return orders.filter((o) => {
      const nameMatch = o.name.toLowerCase().includes(term);
      const poMatch = (o.client_order_ref || '').toLowerCase().includes(term);
      const partnerMatch = o.partner.toLowerCase().includes(term);
      const reqMatch = (o.requisitor || '').toLowerCase().includes(term);
      const lineMatch = o.order_lines.some(
        (l) =>
          l.product.toLowerCase().includes(term) ||
          l.description.toLowerCase().includes(term),
      );
      return nameMatch || poMatch || partnerMatch || reqMatch || lineMatch;
    });
  }, [orders, searchTerm]);

  // Órdenes filtradas por texto de búsqueda y por requisitor seleccionado
  const filteredOrders = useMemo(() => {
    if (selectedRequisitor === 'ALL') return searchMatchedOrders;
    return searchMatchedOrders.filter(
      (o) => (o.requisitor || 'Sin Requisitor') === selectedRequisitor,
    );
  }, [searchMatchedOrders, selectedRequisitor]);

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
    collapsedRequisitores,
    setCollapsedRequisitores,
    uniqueRequisitores,
    searchMatchedOrders,
    filteredOrders,
    groupedByRequisitor,
    toggleGroupCollapse,
  };
}

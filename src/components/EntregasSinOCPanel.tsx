import { useCallback, useEffect, useState } from 'react';
import { Loader2, FileWarning, RefreshCw, AlertCircle, X } from 'lucide-react';
import { Button } from './ui/button';
import { PageFrame } from './shell/PageFrame';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './ui/table';
import {
  listEntregasSinOC,
  type OdooOrderView,
} from '../lib/firebase/odooOrders';
import { triggerOdooSync } from '../lib/firebase/syncOdoo';
import { useSyncMeta } from '../hooks/useSyncMeta';
import { formatAgeDays, formatRelativeTime, getOrderAgeDays } from '../lib/age';

export function EntregasSinOCPanel() {
  const [orders, setOrders] = useState<OdooOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { isError, effectiveLastSyncDate } = useSyncMeta();

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await listEntregasSinOC();
    if (result.ok) {
      setOrders(result.value);
    } else {
      const reason = (result as { ok: false; reason: string }).reason;
      setError(
        reason === 'not-authenticated'
          ? 'No hay sesión activa.'
          : reason === 'not-configured'
          ? 'Firebase no está configurado.'
          : 'Error al leer la base de datos de Firestore.',
      );
    }
    setLoading(false);
  }, []);

  const handleRefreshSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const result = await triggerOdooSync();
      if (result.ok === false) {
        setError(
          result.reason === 'not-authenticated'
            ? 'Debes iniciar sesión para sincronizar.'
            : `No se pudo sincronizar con Odoo: ${result.reason}`,
        );
        return;
      }
      await fetchOrders();
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  return (
    <PageFrame
      title="Entregas sin OC"
      subtitle={
        <>
          Cotizaciones entregadas sin orden de compra capturada
          {effectiveLastSyncDate && (
            <span className={isError ? 'text-danger' : undefined}>
              {' · '}
              {isError ? 'aviso de sync' : 'sync'} {formatRelativeTime(effectiveLastSyncDate)}
            </span>
          )}
        </>
      }
      actions={
        <Button
          variant="ghost"
          onClick={() => void handleRefreshSync()}
          disabled={loading || syncing}
          className="flex items-center gap-2 px-4 rounded-lg border border-line bg-surface-2 hover:border-warn hover:text-warn transition-colors disabled:opacity-50 text-[11px] font-semibold h-10 text-ink"
        >
          <RefreshCw size={14} className={loading || syncing ? 'animate-spin' : ''} />
          {syncing ? 'Sincronizando…' : loading ? 'Cargando…' : 'Refrescar Odoo'}
        </Button>
      }
      notices={
        error && orders.length > 0 ? (
          <div className="shrink-0 flex items-start gap-2 border-b border-danger/50 bg-danger/10 px-4 sm:px-6 py-2 text-sm text-danger">
            <AlertCircle size={16} className="shrink-0 mt-0.5" />
            <span className="grow">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-danger/70 hover:text-danger shrink-0"
              aria-label="Cerrar error"
            >
              <X size={14} />
            </button>
          </div>
        ) : undefined
      }
    >
      {loading ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-ink-dim">
          <Loader2 size={28} className="animate-spin text-warn" />
          <p className="text-xs">Obteniendo entregas sin OC…</p>
        </div>
      ) : error && orders.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-danger">
          <AlertCircle size={32} />
          <p className="text-sm">{error}</p>
        </div>
      ) : orders.length === 0 ? (
        <div className="py-24 flex flex-col items-center justify-center gap-3 text-center text-ink-dim">
          <FileWarning size={32} className="text-line" />
          <p className="font-display font-semibold text-lg text-ink">No hay entregas pendientes de OC</p>
          <p className="text-xs">Ninguna entrega reciente de Suprajit está pendiente de orden de compra.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-line bg-surface overflow-x-auto">
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow className="bg-surface-2 hover:bg-surface-2 text-[10px] font-black uppercase tracking-widest">
                <TableHead className="w-32 px-4 h-10 text-ink-dim">Cotización</TableHead>
                <TableHead className="w-44 px-4 h-10 text-ink-dim">Fecha</TableHead>
                <TableHead className="px-4 h-10 text-ink-dim">Piezas entregadas</TableHead>
                <TableHead className="w-64 px-4 h-10 text-ink-dim">Remisiones</TableHead>
                <TableHead className="w-24 px-4 h-10 text-ink-dim">Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => {
                const ageDays = order.date_order ? getOrderAgeDays(order.date_order.split(' ')[0]) : null;
                return (
                  <TableRow key={order.id} className="align-top hover:bg-surface-2/40">
                    <TableCell className="px-4 py-3 align-top">
                      <span className="font-mono text-sm font-bold text-ink block">{order.name}</span>
                      <span className="text-[11px] text-ink-dim block whitespace-normal">{order.partner}</span>
                    </TableCell>
                    <TableCell className="px-4 py-3 align-top text-xs text-ink">
                      {order.date_order?.split(' ')[0] ?? '—'}
                      {ageDays !== null && (
                        <span className="block text-[11px] text-ink-dim">{formatAgeDays(ageDays)}</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 align-top whitespace-normal">
                      {order.order_lines.length === 0 ? (
                        <span className="text-xs text-ink-dim">Sin líneas de producto</span>
                      ) : (
                        <ul className="space-y-1">
                          {order.order_lines.map((line, idx) => (
                            <li
                              key={idx}
                              className={`flex items-baseline gap-3 text-xs ${line.qty_delivered > 0 ? 'text-ink' : 'text-ink-dim'}`}
                            >
                              <span className="font-mono font-bold tabular-nums shrink-0">
                                {line.qty_delivered}/{line.qty}
                              </span>
                              <span className="min-w-0 break-words">
                                <span className="font-semibold">{line.product.split('] ')[1] || line.product}</span>
                                {line.description ? ` · ${line.description}` : ''}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 align-top whitespace-normal">
                      {order.deliveries && order.deliveries.length > 0 ? (
                        <ul className="space-y-1">
                          {order.deliveries.map((d) => (
                            <li key={d.name} className="flex flex-wrap items-center gap-x-2 text-xs">
                              <span className="font-mono font-bold">{d.name}</span>
                              <span className={`px-1.5 text-[9px] font-bold uppercase ${d.state === 'done' ? 'bg-ok text-bg' : 'bg-line text-ink'}`}>
                                {d.state}
                              </span>
                              {d.date_done && <span className="text-[10px] text-ink-dim">{d.date_done.split(' ')[0]}</span>}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs text-ink-dim">—</span>
                      )}
                    </TableCell>
                    <TableCell className="px-4 py-3 align-top">
                      <span className="px-2 py-1 text-[10px] font-black uppercase tracking-widest font-mono bg-warn text-bg">
                        Falta OC
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </PageFrame>
  );
}

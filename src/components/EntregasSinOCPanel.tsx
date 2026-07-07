import { useCallback, useEffect, useState } from 'react';
import { Loader2, FileWarning, RefreshCw, AlertCircle } from 'lucide-react';
import { Button } from './ui/button';
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
import { formatAgeDays, getOrderAgeDays } from '../lib/age';

export function EntregasSinOCPanel() {
  const [orders, setOrders] = useState<OdooOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  useEffect(() => {
    void fetchOrders();
  }, [fetchOrders]);

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* ── Header ── */}
      <header className="shrink-0 border-b-2 border-line bg-surface px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-warn text-bg flex items-center justify-center corner-ticks shadow-hard">
            <FileWarning size={22} strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="font-display font-black text-2xl uppercase tracking-tight italic leading-none">
              Entregas sin OC (Suprajit)
            </h1>
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-dim mt-1">
              Cotizaciones entregadas sin orden de compra capturada
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            onClick={() => void fetchOrders()}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 border-2 border-line bg-surface-2 hover:border-warn hover:text-warn transition-colors disabled:opacity-50 text-[11px] font-black uppercase tracking-widest h-auto rounded-none text-ink hover:bg-surface-2"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Cargando…' : 'Refrescar'}
          </Button>
        </div>
      </header>

      {/* ── Contenido ── */}
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? (
          <div className="h-full flex flex-col items-center justify-center text-ink-dim space-y-4">
            <Loader2 size={32} className="animate-spin text-warn" />
            <p className="font-mono text-[11px] uppercase tracking-widest">Obteniendo entregas sin OC…</p>
          </div>
        ) : error ? (
          <div className="h-full flex flex-col items-center justify-center text-danger space-y-4">
            <AlertCircle size={48} />
            <p className="font-mono text-sm border border-danger/50 bg-danger/10 p-4">{error}</p>
          </div>
        ) : orders.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-ink-dim space-y-4 border-2 border-dashed border-line bg-surface-2/30 p-12 text-center max-w-2xl mx-auto">
            <FileWarning size={48} className="text-line" />
            <p className="font-display font-black text-2xl uppercase italic">No hay entregas pendientes de OC</p>
            <p className="font-mono text-xs uppercase tracking-widest">
              Todas las entregas de Suprajit cuentan con una Orden de Compra asociada.
            </p>
          </div>
        ) : (
          <div className="space-y-6 max-w-6xl mx-auto">
            {orders.map((order) => {
              const ageDays = order.date_order ? getOrderAgeDays(order.date_order.split(' ')[0]) : null;

              return (
                <div key={order.id} className="border-2 border-warn bg-warn/5 flex flex-col shadow-hard">
                  <div className="border-b-2 border-warn bg-warn text-bg px-5 py-3 flex items-center justify-between flex-wrap gap-4">
                    <div>
                      <div className="flex items-center gap-3">
                        <h2 className="font-display font-black text-xl tracking-tight uppercase text-black">
                          {order.name}
                        </h2>
                        <span className="bg-black text-white px-2 py-0.5 text-[10px] font-black uppercase tracking-widest">
                          {order.partner}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 mt-1 font-mono text-[10px] uppercase tracking-widest text-black/80">
                        <span>ESTADO ODOO: {order.state.toUpperCase()}</span>
                        {order.date_order && (
                          <span>
                            FECHA: {order.date_order.split(' ')[0]}
                            {ageDays !== null && ` (${formatAgeDays(ageDays)})`}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-black">
                      <span className="px-2 py-1 text-[10px] font-black uppercase tracking-widest font-mono bg-black text-warn">
                        FALTA OC
                      </span>
                      <div className="text-right">
                        <p className="text-[10px] uppercase font-black tracking-widest opacity-80">Líneas entregadas</p>
                        <p className="font-display text-xl font-black">
                          {order.order_lines.filter(l => l.qty_delivered > 0).length} / {order.order_lines.length}
                        </p>
                      </div>
                    </div>
                  </div>
                  
                  <div className="p-0 bg-surface">
                    <Table className="w-full text-left border-collapse">
                      <TableHeader>
                        <TableRow className="bg-surface-2 text-[10px] font-black uppercase tracking-widest text-ink-dim border-b border-line hover:bg-surface-2">
                          <TableHead className="px-5 py-2 font-bold w-1/2 text-ink-dim h-auto">Producto</TableHead>
                          <TableHead className="px-5 py-2 font-bold text-ink-dim h-auto">Descripción</TableHead>
                          <TableHead className="px-5 py-2 font-bold text-center w-32 text-ink-dim h-auto">Entregado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {order.order_lines.map((line, idx) => {
                          return (
                            <TableRow
                              key={idx}
                              className={`border-b border-line last:border-b-0 transition-colors ${
                                line.qty_delivered > 0
                                  ? 'bg-ok/5 hover:bg-ok/10'
                                  : 'hover:bg-surface-2/40 opacity-50'
                              }`}
                            >
                              <TableCell className="px-5 py-3 align-top">
                                <span className="font-display font-black uppercase tracking-tight text-sm text-ink block">
                                  {line.product.split('] ')[1] || line.product}
                                </span>
                                {line.product.includes(']') && (
                                  <span className="font-mono text-[9px] text-ink-dim">
                                    {line.product.split(']')[0] + ']'}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="px-5 py-3 font-mono text-xs text-ink align-top leading-snug">
                                {line.description || '—'}
                              </TableCell>
                              <TableCell className="px-5 py-3 text-center align-top">
                                <div>
                                  <span className="font-black text-xl italic">{line.qty_delivered}</span>
                                  <span className="block font-mono text-[9px] text-ink-dim">
                                    de {line.qty} cotizadas
                                  </span>
                                </div>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                        {order.order_lines.length === 0 && (
                          <TableRow>
                            <TableCell colSpan={3} className="px-5 py-8 text-center text-ink-dim font-mono text-[10px] uppercase tracking-widest">
                              No hay líneas de producto en esta cotización
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>

                    {/* Mostrar remisiones (deliveries) */}
                    {order.deliveries && order.deliveries.length > 0 && (
                      <div className="border-t border-line p-4 bg-surface-2/30">
                        <p className="font-mono text-[10px] font-black uppercase tracking-widest text-ink-dim mb-2">
                          Remisiones (Stock Pickings)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {order.deliveries.map(d => (
                            <div key={d.name} className="flex items-center gap-2 border border-line bg-surface px-2 py-1">
                              <span className="font-mono text-xs font-bold">{d.name}</span>
                              <span className={`px-1.5 text-[9px] font-bold uppercase ${d.state === 'done' ? 'bg-ok text-bg' : 'bg-line text-ink'}`}>
                                {d.state}
                              </span>
                              {d.date_done && <span className="text-[9px] font-mono text-ink-dim">{d.date_done.split(' ')[0]}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}

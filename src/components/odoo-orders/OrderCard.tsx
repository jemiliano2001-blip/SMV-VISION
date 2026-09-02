import {
  AlertTriangle,
  CheckSquare,
  FileSearch,
  Loader2,
  Printer,
  Send,
  ShoppingCart,
  Square,
  Truck,
  User,
  Sparkles,
} from 'lucide-react';
import { Button } from '../ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../ui/table';
import type {
  OdooOrderView,
  OdooOrderLineView,
  ProductionStatus,
} from '../../lib/firebase/odooOrders';
import type { UseOrderDrawingBridgeResult } from '../../hooks/useOrderDrawingBridge';
import { formatAgeDays, getOrderAgeDays } from '../../lib/age';
import { checkRevisionDiscrepancy } from '../../lib/matching';
import {
  makeOrderDrawingLinkKey,
  parseOdooLineLabels,
} from '../../lib/orderDrawingBridge';

export interface OrderCardProps {
  order: OdooOrderView;
  productionMap: Map<string, ProductionStatus>;
  bridge: UseOrderDrawingBridgeResult;
  selectedLines: Set<string>;
  lineBusyKey: string | null;
  sendingKey: string | null;
  onToggleSelectLine: (lineKey: string) => void;
  onToggleSelectAllInOrder: (order: OdooOrderView) => void;
  onPrintLine: (order: OdooOrderView, line: OdooOrderLineView, idx: number) => void | Promise<void>;
  onSendLineToReport: (order: OdooOrderView, line: OdooOrderLineView, idx: number) => void | Promise<void>;
  onQuickPurchase: (data: {
    soNumber?: string;
    poNumber?: string;
    pieza?: string;
    numeroParte?: string;
    cantidad?: number | string;
    material?: string | null;
    rowKey?: string;
  }) => void;
  onOpenBiblioteca: (order: OdooOrderView, line: OdooOrderLineView, idx: number) => void;
  onExportDeliverySlip: (order: OdooOrderView) => void;
  onSendOrderToReport?: (order: OdooOrderView) => void | Promise<void>;
}

export function OrderCard({
  order,
  productionMap,
  bridge,
  selectedLines,
  lineBusyKey,
  sendingKey,
  onToggleSelectLine,
  onToggleSelectAllInOrder,
  onPrintLine,
  onSendLineToReport,
  onSendOrderToReport,
  onQuickPurchase,
  onOpenBiblioteca,
  onExportDeliverySlip,
}: OrderCardProps) {
  const ageDays = order.date_order ? getOrderAgeDays(order.date_order.split(' ')[0]) : null;
  const prod = productionMap.get(order.name);
  const badge =
    !prod || prod.total === 0
      ? { label: '○ SIN OTs', cls: 'bg-line/40 text-ink-dim' }
      : prod.entregadas >= prod.total
      ? { label: '✓ LISTO', cls: 'bg-ok text-bg' }
      : { label: `◐ ${prod.entregadas}/${prod.total} OTs`, cls: 'bg-warn text-bg' };

  return (
    <div className="border-2 border-line bg-surface flex flex-col shadow-hard">
      <div className="border-b-2 border-line bg-[#0D2B4D] text-white px-4 sm:px-5 py-3 flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
            <h2 className="font-display font-black text-lg sm:text-xl tracking-tight uppercase">
              {order.name}
            </h2>
            <span className="bg-accent text-bg px-2 py-0.5 text-[9px] sm:text-[10px] font-black uppercase tracking-widest">
              {order.partner}
            </span>
            {order.requisitor && (
              <span className="bg-surface-2 text-ink border border-line/40 px-2 py-0.5 text-[9px] sm:text-[10px] font-mono font-bold flex items-center gap-1 uppercase tracking-wide">
                <User size={11} className="text-accent" />
                {order.requisitor}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 sm:gap-4 mt-1 font-mono text-[9px] sm:text-[10px] uppercase tracking-widest flex-wrap">
            {order.client_order_ref ? (
              <span className="bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 px-1.5 py-0.5 font-bold">
                PO: {order.client_order_ref}
              </span>
            ) : (
              <span className="opacity-60">PO: N/A</span>
            )}
            {order.date_order && (
              <span className="opacity-80">
                FECHA: {order.date_order.split(' ')[0]}
                {ageDays !== null && ` (${formatAgeDays(ageDays)})`}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 ml-auto sm:ml-0 flex-wrap">
          {/* Badge de Urgencia / Envejecimiento */}
          {ageDays !== null && (
            <span
              className={`px-2 py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-widest font-mono flex items-center gap-1 ${
                ageDays > 14
                  ? 'bg-danger text-white border border-danger/40'
                  : ageDays >= 8
                  ? 'bg-warn text-bg border border-warn/40'
                  : 'bg-ok/20 text-ok border border-ok/40'
              }`}
              title={`Antigüedad de la orden: ${ageDays} días`}
            >
              {ageDays > 14 ? <AlertTriangle size={11} /> : null}
              {ageDays > 14 ? `Vencida (+${ageDays}d)` : ageDays >= 8 ? `Crítica (${ageDays}d)` : `En tiempo (${ageDays}d)`}
            </span>
          )}

          <span className={`px-2 py-1 text-[9px] sm:text-[10px] font-black uppercase tracking-widest font-mono ${badge.cls}`}>
            {badge.label}
          </span>
          <div className="text-right">
            <p className="text-[9px] uppercase font-black tracking-widest opacity-60">Líneas</p>
            <p className="font-display text-lg sm:text-xl font-black">{order.order_lines.length}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            disabled={!order.order_lines.some((l) => l.qty_pending > 0)}
            onClick={() => onExportDeliverySlip(order)}
            className="flex items-center gap-1.5 bg-surface text-ink hover:bg-line ml-1 sm:ml-2 h-8 px-2.5"
            title="Generar PDF de Remisión"
          >
            <Truck size={13} />
            <span className="text-[9px] sm:text-[10px] font-black tracking-widest uppercase">Remisión</span>
          </Button>

          {onSendOrderToReport && (
            <Button
              variant="outline"
              size="sm"
              disabled={
                sendingKey === order.id ||
                !order.order_lines.some((l) => (l.qty_pending_from_pickings ?? l.qty_pending) > 0)
              }
              onClick={() => onSendOrderToReport(order)}
              className="flex items-center gap-1.5 bg-accent text-bg hover:bg-accent/80 border-accent h-8 px-2.5 shadow-hard transition-all active:translate-x-0.5 active:translate-y-0.5 disabled:opacity-40"
              title="Enviar todas las líneas activas de esta orden al Reporte de auditoría"
            >
              {sendingKey === order.id ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Send size={12} />
              )}
              <span className="text-[9px] sm:text-[10px] font-black tracking-widest uppercase">
                {sendingKey === order.id ? 'Enviando…' : 'A Reporte'}
              </span>
            </Button>
          )}
        </div>
      </div>

      <div className="p-0 overflow-x-auto">
        <Table className="w-full text-left border-collapse min-w-[650px] sm:min-w-full">
          <TableHeader>
            <TableRow className="bg-surface-2 text-[10px] font-black uppercase tracking-widest text-ink-dim border-b border-line hover:bg-surface-2">
              <TableHead className="w-10 px-3 py-2 text-center h-auto">
                <button
                  type="button"
                  onClick={() => onToggleSelectAllInOrder(order)}
                  className="text-ink hover:text-accent flex items-center justify-center mx-auto"
                  title="Seleccionar / deseleccionar todas las líneas de esta orden"
                >
                  {(() => {
                    const pendingKeys = order.order_lines
                      .map((l, idx) => ({ l, key: makeOrderDrawingLinkKey(order.id, idx) }))
                      .filter(({ l }) => l.qty_pending > 0)
                      .map(({ key }) => key);
                    return pendingKeys.length > 0 && pendingKeys.every((k) => selectedLines.has(k));
                  })() ? (
                    <CheckSquare size={16} className="text-accent" />
                  ) : (
                    <Square size={16} className="text-ink-dim" />
                  )}
                </button>
              </TableHead>
              <TableHead className="px-5 py-2 font-bold w-1/3 text-ink-dim h-auto">Producto</TableHead>
              <TableHead className="px-5 py-2 font-bold text-ink-dim h-auto">Descripción</TableHead>
              <TableHead className="px-5 py-2 font-bold text-center w-28 text-ink-dim h-auto">Pendiente</TableHead>
              <TableHead className="px-5 py-2 font-bold text-center min-w-[220px] text-ink-dim h-auto">Plano</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.order_lines.map((line, idx) => {
              const fullyDelivered = line.qty_pending <= 0;
              const lineKey = makeOrderDrawingLinkKey(order.id, idx);
              const isMatching = lineBusyKey === lineKey;
              const isSending = sendingKey === lineKey;
              const link = bridge.links[lineKey];
              const partLabel =
                link?.cadDrawing?.partNumber ??
                link?.reportDrawing?.partNumber ??
                null;
              const isSelected = selectedLines.has(lineKey);

              return (
                <TableRow
                  key={idx}
                  className={`border-b border-line last:border-b-0 transition-colors ${
                    fullyDelivered
                      ? 'opacity-40 bg-ok/5 hover:bg-ok/5'
                      : isSelected
                        ? 'bg-accent/5 hover:bg-accent/10'
                        : 'hover:bg-surface-2/40'
                  }`}
                >
                  <TableCell className="w-10 px-3 py-3 text-center align-middle">
                    {!fullyDelivered ? (
                      <button
                        type="button"
                        onClick={() => onToggleSelectLine(lineKey)}
                        className="text-ink hover:text-accent flex items-center justify-center mx-auto"
                        title={isSelected ? 'Deseleccionar OT' : 'Seleccionar para imprimir en lote'}
                      >
                        {isSelected ? (
                          <CheckSquare size={16} className="text-accent" />
                        ) : (
                          <Square size={16} className="text-ink-dim" />
                        )}
                      </button>
                    ) : (
                      <span className="text-ink-dim opacity-30 text-xs">—</span>
                    )}
                  </TableCell>
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
                    <div className="space-y-1.5">
                      <div>{line.description || '—'}</div>
                      {(() => {
                        const drawingRev = link?.cadDrawing?.revision ?? link?.reportDrawing?.revision;
                        if (drawingRev) {
                          const revCheck = checkRevisionDiscrepancy(
                            `${line.description || ''} ${line.product || ''}`,
                            drawingRev,
                          );
                          if (revCheck.hasMismatch) {
                            return (
                              <div
                                className="inline-flex items-center gap-1.5 bg-warn/15 border border-warn text-warn font-mono text-[9px] font-bold px-2 py-0.5"
                                title={`Discrepancia detectada: Odoo pide Rev "${revCheck.orderRev}" pero el catálogo tiene Rev "${revCheck.drawingRev}".`}
                              >
                                <AlertTriangle size={11} className="shrink-0" />
                                <span>Odoo pide Rev {revCheck.orderRev} (Plano es Rev {revCheck.drawingRev})</span>
                              </div>
                            );
                          }
                        }
                        return null;
                      })()}
                    </div>
                  </TableCell>
                  <TableCell className="px-5 py-3 text-center align-top">
                    {fullyDelivered ? (
                      <span className="font-mono text-[10px] text-ok uppercase tracking-widest">
                        ✓ entregada
                      </span>
                    ) : (
                      <div>
                        <span className="font-black text-xl italic">{line.qty_pending}</span>
                        {line.qty_delivered > 0 && (
                          <span className="block font-mono text-[9px] text-ink-dim">
                            de {line.qty} ({line.qty_delivered} entregadas)
                          </span>
                        )}
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="px-5 py-3 text-center align-top">
                    {!fullyDelivered && (
                      <div className="flex flex-col items-stretch gap-1.5 min-w-[200px]">
                        {link && link.status !== 'no_match' && partLabel ? (
                          <div className="flex flex-col items-center">
                            <span
                              className="font-mono text-[9px] text-ok uppercase tracking-wide truncate max-w-[200px]"
                              title={`Score ${link.matchScore}`}
                            >
                              {partLabel}
                              {link.matchScore > 0 ? ` · ${link.matchScore}` : ''}
                            </span>
                            {link.status === 'manual' && (
                              <span className="inline-flex items-center gap-1 font-mono text-[8px] text-accent font-bold uppercase tracking-wider bg-accent/10 px-1.5 py-0.2 rounded mt-0.5">
                                <Sparkles size={9} />
                                Alias aprendido
                              </span>
                            )}
                          </div>
                        ) : link?.status === 'no_match' ? (
                          <span className="font-mono text-[9px] text-warn uppercase tracking-wide">
                            Sin plano
                          </span>
                        ) : null}
                        <div className="flex flex-wrap justify-center gap-1">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={lineBusyKey !== null || sendingKey !== null}
                            onClick={() => void onPrintLine(order, line, idx)}
                            className="inline-flex items-center gap-1"
                            title="Buscar plano CAD e imprimir OT"
                          >
                            {isMatching ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Printer size={12} />
                            )}
                            <span className="text-[9px] font-black uppercase tracking-widest">
                              Imprimir
                            </span>
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={lineBusyKey !== null || sendingKey !== null}
                            onClick={() => void onSendLineToReport(order, line, idx)}
                            className="inline-flex items-center gap-1"
                            title="Adjuntar plano al reporte y abrir Generar Reporte"
                          >
                            {isSending ? (
                              <Loader2 size={12} className="animate-spin" />
                            ) : (
                              <Send size={12} />
                            )}
                            <span className="text-[9px] font-black uppercase tracking-widest">
                              Reporte
                            </span>
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => {
                              const parsed = parseOdooLineLabels(line.product, line.description);
                              onQuickPurchase({
                                soNumber: order.name,
                                poNumber: order.client_order_ref || undefined,
                                pieza: parsed.pieza || line.product,
                                numeroParte: parsed.numeroParte || undefined,
                                cantidad: line.qty_pending,
                                rowKey: lineKey,
                              });
                            }}
                            className="inline-flex items-center gap-1 hover:border-accent hover:text-accent"
                            title="Requisitar material o insumos para esta orden en Compras"
                          >
                            <ShoppingCart size={12} />
                            <span className="text-[9px] font-black uppercase tracking-widest">
                              Comprar
                            </span>
                          </Button>
                          {(link?.status === 'no_match' || !link || !link.cadDrawing) && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={lineBusyKey !== null || sendingKey !== null}
                              onClick={() => onOpenBiblioteca(order, line, idx)}
                              className="inline-flex items-center gap-1"
                              title="Buscar plano en Biblioteca"
                            >
                              <FileSearch size={12} />
                              <span className="text-[9px] font-black uppercase tracking-widest">
                                Biblioteca
                              </span>
                            </Button>
                          )}
                        </div>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            {order.order_lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="px-5 py-8 text-center text-ink-dim font-mono text-[10px] uppercase tracking-widest">
                  No hay líneas de producto en esta orden
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

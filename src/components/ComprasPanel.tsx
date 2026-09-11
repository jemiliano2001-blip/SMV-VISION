import React, { useCallback, useEffect, useState, useMemo, type ReactElement } from 'react';
import { Loader2, Plus, AlertCircle, ExternalLink, Pencil, Trash2, Box, X, Search, ArrowUpDown } from 'lucide-react';
import type { PurchaseItem, PurchaseItemType } from '../types';
import { listPurchases, createPurchase, updatePurchase, deletePurchase } from '../lib/firebase/purchases';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';

const ITEM_TYPES: { value: PurchaseItemType; label: string }[] = [
  { value: 'metal', label: 'Metal' },
  { value: 'ensamble', label: 'Ensamble' },
  { value: 'herramienta', label: 'Herramienta' },
  { value: 'otro', label: 'Otro' },
];

export function ComprasPanel(): ReactElement {
  const [items, setItems] = useState<PurchaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PurchaseItem | null>(null);

  // Search and Sort states
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<'nombre' | 'tipo' | 'sku' | 'proveedor'>('nombre');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Form states
  const [nombre, setNombre] = useState('');
  const [tipo, setTipo] = useState<PurchaseItemType>('metal');
  const [sku, setSku] = useState('');
  const [proveedor, setProveedor] = useState('');
  const [link, setLink] = useState('');
  const [notas, setNotas] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listPurchases();
    if (res.ok) {
      setItems(res.value);
    } else {
      setError('No fue posible cargar el directorio de compras.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleOpenAdd = () => {
    setEditingItem(null);
    setNombre('');
    setTipo('metal');
    setSku('');
    setProveedor('');
    setLink('');
    setNotas('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: PurchaseItem) => {
    setEditingItem(item);
    setNombre(item.nombre);
    setTipo(item.tipo);
    setSku(item.sku);
    setProveedor(item.proveedor);
    setLink(item.link);
    setNotas(item.notas);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!nombre.trim()) {
      setError('El nombre del material es obligatorio.');
      return;
    }
    setIsSaving(true);

    if (editingItem) {
      const res = await updatePurchase(editingItem.id, {
        nombre, tipo, sku, proveedor, link, notas
      });
      if (res.ok) {
        setItems(prev => prev.map(i => i.id === editingItem.id ? { ...i, nombre, tipo, sku, proveedor, link, notas } : i));
        setIsModalOpen(false);
      } else {
        setError('Error al actualizar el material.');
      }
    } else {
      const res = await createPurchase({ nombre, tipo, sku, proveedor, link, notas });
      if (res.ok) {
        await loadData();
        setIsModalOpen(false);
      } else {
        setError('Error al agregar el material.');
      }
    }
    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este material del directorio?')) return;
    const res = await deletePurchase(id);
    if (res.ok) {
      setItems(prev => prev.filter(i => i.id !== id));
    } else {
      setError('Error al eliminar el material.');
    }
  };

  const filteredAndSortedItems = useMemo(() => {
    let result = [...items];

    if (searchQuery.trim()) {
      const lowerQuery = searchQuery.toLowerCase();
      result = result.filter(
        item =>
          item.nombre.toLowerCase().includes(lowerQuery) ||
          (item.sku && item.sku.toLowerCase().includes(lowerQuery)) ||
          (item.proveedor && item.proveedor.toLowerCase().includes(lowerQuery))
      );
    }

    result.sort((a, b) => {
      let valA = (a[sortField] || '').toLowerCase();
      let valB = (b[sortField] || '').toLowerCase();

      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [items, searchQuery, sortField, sortOrder]);

  // Solo avisa — nunca bloquea el guardado. El usuario decide si es un
  // duplicado real o dos entradas legítimas con nombre parecido.
  const duplicateWarning = useMemo(() => {
    const normalized = nombre.trim().toLowerCase();
    if (!normalized) return null;
    const match = items.find(
      (i) => i.id !== editingItem?.id && i.nombre.trim().toLowerCase() === normalized,
    );
    return match ? `Ya existe un material con este nombre: "${match.nombre}".` : null;
  }, [nombre, items, editingItem]);

  const SortableHeader = ({ field, label, width }: { field: 'nombre' | 'tipo' | 'proveedor' | 'sku'; label: string; width?: string }) => (
    <TableHead 
      aria-sort={sortField === field ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={`p-0 border-r-2 border-line select-none group text-ink-dim ${width ? width : ''}`}
    >
      <button
        type="button"
        className="flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left text-[10px] font-black uppercase tracking-widest transition-colors hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        onClick={() => {
          if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
          } else {
            setSortField(field);
            setSortOrder('asc');
          }
        }}
      >
        {label}
        <ArrowUpDown 
          size={12} 
          className={`transition-all duration-200 ${sortField === field ? 'text-accent opacity-100' : 'text-ink-dim/40 opacity-0 group-hover:opacity-100'} ${sortField === field && sortOrder === 'desc' ? 'rotate-180' : ''}`} 
        />
      </button>
    </TableHead>
  );

  return (
    <div className="min-h-full bp-grid-lg flex flex-col">
      <div className="sticky top-0 z-20 bg-bg/90 backdrop-blur-xl border-b border-line px-4 sm:px-6 lg:px-9 py-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="workspace-kicker mb-2">Directorio</p>
            <h1 className="workspace-title text-3xl sm:text-4xl flex items-center gap-3">
              Compras y materiales
            </h1>
          </div>
          <Button
            onClick={handleOpenAdd}
            className="bg-accent text-white px-4 py-2 text-[12px] font-semibold hover:bg-accent/90 transition-colors shadow-hard-accent flex items-center gap-2 rounded-lg h-11"
          >
            <Plus size={14} /> Nuevo Material
          </Button>
        </div>
        
        {error && (
          <div className="mt-4 flex items-start gap-2 border border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger leading-snug">
            <AlertCircle size={14} className="shrink-0 mt-0.5" />
            <span className="text-left">{error}</span>
          </div>
        )}

        <div className="mt-4 sm:mt-5">
          <div className="flex flex-col sm:flex-row gap-3 items-center w-full">
            <div className="relative flex-1 w-full group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim group-focus-within:text-accent transition-colors" size={16} />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Buscar material por nombre, SKU o proveedor..."
                className="w-full bg-surface border-2 border-line text-ink pl-10 pr-10 h-10 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent focus-visible:shadow-[4px_4px_0px_0px_rgba(var(--color-accent),0.2)] transition-all shadow-hard rounded-none"
              />
              {searchQuery && (
                <Button 
                  variant="ghost"
                  size="icon"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-0 top-1/2 min-h-11 min-w-11 -translate-y-1/2 text-ink-dim hover:text-ink hover:bg-transparent"
                >
                  <X size={14} />
                </Button>
              )}
            </div>
            <div className="hidden sm:flex items-center justify-center bg-surface border-2 border-line px-4 py-2.5 shadow-hard whitespace-nowrap min-w-[140px]">
              <span className="font-mono text-[11px] font-bold text-ink-dim uppercase tracking-widest">
                <span className="text-accent">{filteredAndSortedItems.length}</span> / {items.length} res
              </span>
            </div>
          </div>
          {items.length >= 500 && (
            <p className="mt-2 font-mono text-[10px] text-warn uppercase tracking-widest">
              Mostrando los 500 más recientes — puede haber más materiales sin listar aquí.
            </p>
          )}
        </div>
      </div>

      <div className="flex-1 p-3.5 sm:p-6 lg:p-8 overflow-y-auto">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-40 text-ink-dim font-mono text-[11px] uppercase tracking-widest">
            <Loader2 size={24} className="animate-spin mb-3 text-accent" />
            Cargando directorio...
          </div>
        ) : items.length === 0 ? (
          <div className="border-2 border-line border-dashed flex flex-col items-center justify-center text-center p-12 bg-surface/40 corner-ticks">
             <Box className="text-line w-16 h-16 mb-4" />
             <h3 className="font-display font-black text-2xl uppercase tracking-tighter text-ink-dim italic mb-2">Directorio Vacío</h3>
             <p className="text-[11px] font-mono text-ink-dim uppercase tracking-[2px]">Agrega metales, piezas o herramientas para empezar</p>
          </div>
        ) : filteredAndSortedItems.length === 0 ? (
          <div className="border-2 border-line border-dashed flex flex-col items-center justify-center text-center p-12 bg-surface/40 corner-ticks">
             <Search className="text-line w-16 h-16 mb-4" />
             <h3 className="font-display font-black text-2xl uppercase tracking-tighter text-ink-dim italic mb-2">Sin Resultados</h3>
             <p className="text-[11px] font-mono text-ink-dim uppercase tracking-[2px]">No se encontraron materiales que coincidan con la búsqueda</p>
          </div>
        ) : (
          <div className="workspace-panel relative overflow-x-auto">
            <Table className="min-w-[650px] sm:min-w-full">
              <TableHeader className="bg-surface-2 border-b-2 border-line text-ink-dim">
                <TableRow className="border-0 hover:bg-transparent">
                  <SortableHeader field="nombre" label="Material / Descripción" />
                  <SortableHeader field="tipo" label="Tipo" width="w-28" />
                  <SortableHeader field="sku" label="SKU / Parte" />
                  <SortableHeader field="proveedor" label="Proveedor" />
                  <TableHead className="px-4 py-3 text-[10px] font-black uppercase tracking-widest border-r-2 border-line text-ink-dim">Notas</TableHead>
                  <TableHead className="px-4 py-3 text-[10px] font-black uppercase tracking-widest text-center w-28 text-ink-dim">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAndSortedItems.map((item) => (
                  <TableRow key={item.id} className="border-b-2 border-line hover:bg-surface-2 transition-colors group border-0">
                    <TableCell className="px-4 py-3 border-r-2 border-line group-hover:bg-accent/5 transition-colors">
                      <p className="font-display font-black text-[13px] uppercase tracking-tight text-ink">{item.nombre}</p>
                    </TableCell>
                    <TableCell className="px-4 py-3 border-r-2 border-line group-hover:bg-accent/5 transition-colors">
                      <span className="rounded-md bg-surface-2 border border-line text-ink-dim px-2 py-0.5 text-[9px] font-black uppercase tracking-wider">
                        {item.tipo}
                      </span>
                    </TableCell>
                    <TableCell className="px-4 py-3 border-r-2 border-line font-mono text-[11px] text-ink-dim group-hover:bg-accent/5 transition-colors">
                      {item.sku || '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3 border-r-2 border-line font-display font-bold text-[11px] uppercase group-hover:bg-accent/5 transition-colors">
                      {item.proveedor || '—'}
                    </TableCell>
                    <TableCell className="px-4 py-3 border-r-2 border-line text-[10px] font-mono text-ink-dim group-hover:bg-accent/5 transition-colors">
                      {item.notas || '—'}
                    </TableCell>
                    <TableCell className="px-3 py-3 text-center align-middle group-hover:bg-accent/5 transition-colors">
                      <div className="flex items-center justify-center gap-1.5">
                        {item.link ? (
                          <a
                            href={item.link.startsWith('http') ? item.link : `https://${item.link}`}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center min-h-11 min-w-11 rounded-lg border border-line text-ink hover:text-white hover:bg-accent hover:border-accent transition-colors"
                            title="Abrir enlace"
                            aria-label={`Abrir enlace de compra de ${item.nombre}`}
                          >
                            <ExternalLink size={13} />
                          </a>
                        ) : (
                          <div className="w-8"></div>
                        )}
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => handleOpenEdit(item)}
                          className="min-h-11 min-w-11 rounded-lg border border-line text-ink bg-transparent hover:text-white hover:bg-accent hover:border-accent transition-colors"
                          title="Editar"
                          aria-label={`Editar ${item.nombre}`}
                        >
                          <Pencil size={13} />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          onClick={() => void handleDelete(item.id)}
                          className="min-h-11 min-w-11 rounded-lg border border-line text-ink bg-transparent hover:text-white hover:bg-danger hover:border-danger transition-colors"
                          title="Eliminar"
                          aria-label={`Eliminar ${item.nombre}`}
                        >
                          <Trash2 size={13} />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-lg rounded-xl p-0 gap-0 overflow-hidden bg-surface border border-line shadow-hard-accent flex flex-col" showCloseButton={false}>
          <DialogHeader className="flex flex-row items-center justify-between px-5 py-3 border-b border-line bg-surface-2 text-ink shrink-0 space-y-0">
            <DialogTitle className="font-display text-lg font-semibold tracking-tight m-0">
              {editingItem ? 'Editar Material' : 'Nuevo Material'}
            </DialogTitle>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsModalOpen(false)}
              aria-label="Cerrar formulario de material"
              className="min-h-11 min-w-11 rounded-lg border border-line bg-transparent text-ink hover:bg-accent hover:text-white hover:border-accent transition-colors"
            >
              <X size={14} />
            </Button>
          </DialogHeader>
          <DialogDescription className="sr-only">Modal para crear o editar un material en el directorio.</DialogDescription>

          <form onSubmit={handleSave} className="p-5 space-y-4">
            {error && (
              <div className="flex items-start gap-2 border border-danger/60 bg-danger/10 px-3 py-2 text-[11px] font-mono text-danger leading-snug">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span className="text-left">{error}</span>
              </div>
            )}
            <div>
              <label htmlFor="purchase-name" className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Nombre / Descripción *</label>
              <Input
                id="purchase-name"
                required
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 text-ink min-h-11 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent shadow-none"
                placeholder="Ej. Acero M2 de 1/2 x 7/8 x 20"
              />
              {duplicateWarning && (
                <p className="mt-1 text-[10px] font-mono text-warn">{duplicateWarning}</p>
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="purchase-type" className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Tipo</label>
                <select
                  id="purchase-type"
                  value={tipo}
                  onChange={(e) => setTipo(e.target.value as PurchaseItemType)}
                  className="w-full rounded-lg border border-line bg-surface-2 text-ink min-h-11 px-3 py-1 text-[12px] font-mono outline-none focus:border-accent"
                >
                  {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="purchase-provider" className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Proveedor</label>
                <Input
                  id="purchase-provider"
                  value={proveedor}
                  onChange={(e) => setProveedor(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface-2 text-ink min-h-11 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent shadow-none"
                  placeholder="Ej. McMaster, Aceros MTY"
                />
              </div>
            </div>

            <div>
              <label htmlFor="purchase-sku" className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">SKU / Número de Parte</label>
              <Input
                id="purchase-sku"
                value={sku}
                onChange={(e) => setSku(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 text-ink min-h-11 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent shadow-none"
                placeholder="Ej. 8975K14"
              />
            </div>

            <div>
              <label htmlFor="purchase-link" className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Link de Compra</label>
              <Input
                id="purchase-link"
                type="url"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 text-ink min-h-11 text-[12px] font-mono focus-visible:ring-0 focus-visible:border-accent shadow-none"
                placeholder="https://..."
              />
            </div>

            <div>
              <label htmlFor="purchase-notes" className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Notas</label>
              <textarea
                id="purchase-notes"
                rows={2}
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 text-ink px-3 py-2 text-[12px] font-mono outline-none focus:border-accent resize-none"
                placeholder="Comentarios adicionales..."
              />
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-line mt-4">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg border border-line text-ink font-semibold text-[11px] hover:bg-surface-2 hover:text-ink transition-colors min-h-11 px-4"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className="rounded-lg bg-accent text-white px-6 min-h-11 text-[11px] font-semibold hover:bg-accent/90 transition-colors shadow-hard-accent disabled:opacity-50 flex items-center gap-2"
              >
                {isSaving ? <Loader2 size={12} className="animate-spin" /> : null}
                {isSaving ? 'Guardando...' : 'Guardar'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

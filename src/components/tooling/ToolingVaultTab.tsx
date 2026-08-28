import React, { useState, useEffect, useCallback, useMemo, type ReactElement } from 'react';
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  AlertCircle,
  Loader2,
  Star,
  X,
  Boxes,
} from 'lucide-react';
import type { ToolingPurchaseItem, ToolingCategory, IsoMaterialGroup } from '../../lib/tooling/types';
import {
  listToolingPurchases,
  createToolingPurchase,
  updateToolingPurchase,
  deleteToolingPurchase,
} from '../../lib/firebase/toolingPurchases';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '../ui/dialog';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

const CATEGORIES: { value: ToolingCategory; label: string }[] = [
  { value: 'inserto_torneado', label: 'Inserto Torneado' },
  { value: 'inserto_fresado', label: 'Inserto Fresado' },
  { value: 'inserto_roscado', label: 'Inserto Roscado' },
  { value: 'inserto_ranurado', label: 'Inserto Ranurado' },
  { value: 'endmill', label: 'Endmill / Fresa' },
  { value: 'porta_torno', label: 'Porta Torno' },
  { value: 'cono_fresadora', label: 'Cono CAT40 / Fresa' },
  { value: 'boquilla_collet', label: 'Boquilla ER' },
  { value: 'broca', label: 'Broca' },
  { value: 'machuelo', label: 'Machuelo' },
  { value: 'refaccion_torx', label: 'Refacción Torx' },
];

export function ToolingVaultTab(): ReactElement {
  const [items, setItems] = useState<ToolingPurchaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ToolingPurchaseItem | null>(null);

  // Filtros
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  // Form states
  const [codigoISO, setCodigoISO] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [categoria, setCategoria] = useState<ToolingCategory>('inserto_torneado');
  const [marca, setMarca] = useState('');
  const [grado, setGrado] = useState('');
  const [rompevirutas, setRompevirutas] = useState('');
  const [materialISO, setMaterialISO] = useState<IsoMaterialGroup | 'Universal'>('P');
  const [proveedor, setProveedor] = useState('');
  const [precioUnitario, setPrecioUnitario] = useState<number>(0);
  const [precioCaja, setPrecioCaja] = useState<number>(0);
  const [moneda, setMoneda] = useState<'MXN' | 'USD'>('MXN');
  const [linkCompra, setLinkCompra] = useState('');
  const [maquinaAsignada, setMaquinaAsignada] = useState('');
  const [calificacion, setCalificacion] = useState<number>(5);
  const [rendimientoNotas, setRendimientoNotas] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listToolingPurchases();
    if (res.ok) {
      setItems(res.value);
    } else {
      setError('No fue posible cargar el directorio de herramental.');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleOpenAdd = () => {
    setEditingItem(null);
    setCodigoISO('');
    setDescripcion('');
    setCategoria('inserto_torneado');
    setMarca('');
    setGrado('');
    setRompevirutas('');
    setMaterialISO('P');
    setProveedor('');
    setPrecioUnitario(0);
    setPrecioCaja(0);
    setMoneda('MXN');
    setLinkCompra('');
    setMaquinaAsignada('');
    setCalificacion(5);
    setRendimientoNotas('');
    setIsModalOpen(true);
  };

  const handleOpenEdit = (item: ToolingPurchaseItem) => {
    setEditingItem(item);
    setCodigoISO(item.codigoISO);
    setDescripcion(item.descripcion);
    setCategoria(item.categoria);
    setMarca(item.marca);
    setGrado(item.grado || '');
    setRompevirutas(item.rompevirutas || '');
    setMaterialISO(item.materialISO || 'Universal');
    setProveedor(item.proveedor);
    setPrecioUnitario(item.precioUnitario);
    setPrecioCaja(item.precioCaja || 0);
    setMoneda(item.moneda);
    setLinkCompra(item.linkCompra);
    setMaquinaAsignada(item.maquinaAsignada || '');
    setCalificacion(item.calificacion || 5);
    setRendimientoNotas(item.rendimientoNotas || '');
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!codigoISO.trim() && !descripcion.trim()) {
      setError('El código ISO o la descripción es obligatorio.');
      return;
    }
    setIsSaving(true);
    setError(null);

    const payload = {
      codigoISO,
      descripcion,
      categoria,
      marca,
      grado,
      rompevirutas,
      materialISO,
      proveedor,
      precioUnitario,
      precioCaja,
      moneda,
      linkCompra,
      maquinaAsignada,
      calificacion,
      rendimientoNotas,
    };

    if (editingItem) {
      const res = await updateToolingPurchase(editingItem.id, payload);
      if (res.ok) {
        setItems(prev => prev.map(i => i.id === editingItem.id ? { ...i, ...payload } : i));
        setIsModalOpen(false);
      } else {
        setError('Error al actualizar herramienta.');
      }
    } else {
      const res = await createToolingPurchase(payload);
      if (res.ok) {
        await loadData();
        setIsModalOpen(false);
      } else {
        setError('Error al registrar herramienta.');
      }
    }
    setIsSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('¿Eliminar esta herramienta de la bóveda?')) return;
    const res = await deleteToolingPurchase(id);
    if (res.ok) {
      setItems(prev => prev.filter(i => i.id !== id));
    } else {
      setError('Error al eliminar.');
    }
  };

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      const matchesCat = selectedCategory === 'all' || item.categoria === selectedCategory;
      const q = searchQuery.toLowerCase().trim();
      const matchesQuery =
        !q ||
        item.codigoISO.toLowerCase().includes(q) ||
        item.descripcion.toLowerCase().includes(q) ||
        item.marca.toLowerCase().includes(q) ||
        item.proveedor.toLowerCase().includes(q) ||
        (item.maquinaAsignada && item.maquinaAsignada.toLowerCase().includes(q));
      return matchesCat && matchesQuery;
    });
  }, [items, selectedCategory, searchQuery]);

  return (
    <div className="space-y-4">
      {/* Barra de Filtros y Botón de Nuevo Registro */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-2 border-line bg-surface p-4 shadow-hard">
        <div className="flex flex-wrap items-center gap-2 flex-1">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por código ISO, marca, máquina..."
              className="h-9 pl-9 text-xs font-mono border-2 border-line bg-surface-2"
            />
          </div>

          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="h-9 px-3 border-2 border-line bg-surface-2 text-ink text-xs font-mono font-bold outline-none focus:border-accent"
          >
            <option value="all">Todas las Categorías ({items.length})</option>
            {CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>
                {cat.label} ({items.filter(i => i.categoria === cat.value).length})
              </option>
            ))}
          </select>
        </div>

        <Button
          onClick={handleOpenAdd}
          className="bg-accent text-bg px-4 h-9 text-xs font-black uppercase tracking-wider hover:bg-accent/80 transition-colors shadow-hard rounded-none flex items-center gap-2"
        >
          <Plus size={14} /> Registrar Herramienta
        </Button>
      </div>

      {error && (
        <div className="border border-danger bg-danger/10 p-3 text-xs font-mono text-danger flex items-center gap-2">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Tabla de la Bóveda */}
      {loading ? (
        <div className="border-2 border-line bg-surface p-12 text-center text-xs font-mono text-ink-dim flex flex-col items-center">
          <Loader2 size={20} className="animate-spin text-accent mb-2" />
          Cargando inventario de herramental...
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="border-2 border-line border-dashed bg-surface/50 p-12 text-center">
          <Boxes size={32} className="mx-auto text-ink-dim/40 mb-2" />
          <h4 className="font-display font-black text-sm uppercase text-ink">Bóveda Vacía o Sin Resultados</h4>
          <p className="text-xs font-mono text-ink-dim mt-1">
            Registra insertos, endmills, holders y boquillas para guardar tu historial técnico y reordenar en 1 click.
          </p>
        </div>
      ) : (
        <div className="border-2 border-line bg-surface shadow-hard overflow-x-auto">
          <Table>
            <TableHeader className="bg-surface-2 border-b-2 border-line">
              <TableRow className="border-0">
                <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                  Código ISO / Descripción
                </TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                  Categoría
                </TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                  Marca & Grado
                </TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                  Máquina Asignada
                </TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                  Proveedor & Precio
                </TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                  Calificación & Notas
                </TableHead>
                <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim text-center">
                  Acciones
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredItems.map((item) => (
                <TableRow key={item.id} className="border-b-2 border-line hover:bg-surface-2/60 transition-colors">
                  <TableCell className="border-r-2 border-line py-3">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-black text-ink uppercase">
                        {item.codigoISO}
                      </span>
                      {item.materialISO && item.materialISO !== 'Universal' && (
                        <span className="bg-accent/20 text-accent border border-accent/40 px-1 py-0.2 text-[9px] font-mono font-bold">
                          ISO {item.materialISO}
                        </span>
                      )}
                    </div>
                    {item.descripcion && (
                      <p className="text-[11px] font-mono text-ink-dim mt-0.5">{item.descripcion}</p>
                    )}
                  </TableCell>

                  <TableCell className="border-r-2 border-line py-3">
                    <span className="bg-surface-2 border border-line px-2 py-0.5 text-[10px] font-mono font-bold text-ink-dim uppercase">
                      {CATEGORIES.find(c => c.value === item.categoria)?.label || item.categoria}
                    </span>
                  </TableCell>

                  <TableCell className="border-r-2 border-line py-3 font-mono text-xs">
                    <div className="font-bold text-ink">{item.marca}</div>
                    <div className="text-[10px] text-ink-dim">
                      {item.grado ? `Grado: ${item.grado}` : ''} {item.rompevirutas ? `· Romp: ${item.rompevirutas}` : ''}
                    </div>
                  </TableCell>

                  <TableCell className="border-r-2 border-line py-3 font-mono text-xs text-ink">
                    {item.maquinaAsignada ? (
                      <span className="bg-accent/10 border border-accent/30 px-1.5 py-0.5 text-[10px] font-bold text-accent">
                        {item.maquinaAsignada}
                      </span>
                    ) : (
                      <span className="text-ink-dim">—</span>
                    )}
                  </TableCell>

                  <TableCell className="border-r-2 border-line py-3 font-mono text-xs">
                    <div className="font-bold text-ink">{item.proveedor || 'Sin proveedor'}</div>
                    <div className="text-accent font-bold text-[11px]">
                      ${item.precioUnitario.toFixed(2)} {item.moneda}
                      {item.precioCaja ? ` ($${item.precioCaja} caja)` : ''}
                    </div>
                  </TableCell>

                  <TableCell className="border-r-2 border-line py-3 font-mono text-xs max-w-[200px]">
                    <div className="flex items-center gap-1 text-accent mb-0.5">
                      {Array.from({ length: item.calificacion || 5 }).map((_, i) => (
                        <Star key={i} size={10} fill="currentColor" />
                      ))}
                    </div>
                    <p className="text-[10px] text-ink-dim truncate" title={item.rendimientoNotas || ''}>
                      {item.rendimientoNotas || 'Sin notas'}
                    </p>
                  </TableCell>

                  <TableCell className="py-3 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      {item.linkCompra ? (
                        <a
                          href={item.linkCompra}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center justify-center h-7 px-2 border-2 border-line bg-accent text-bg text-[10px] font-mono font-black uppercase hover:bg-accent/80 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px]"
                          title="Reordenar"
                        >
                          Reordenar
                        </a>
                      ) : null}
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => handleOpenEdit(item)}
                        className="h-7 w-7 rounded-none border-2 border-line text-ink hover:bg-accent hover:text-bg hover:border-accent"
                        title="Editar"
                      >
                        <Pencil size={12} />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => void handleDelete(item.id)}
                        className="h-7 w-7 rounded-none border-2 border-line text-ink hover:bg-danger hover:text-bg hover:border-danger"
                        title="Eliminar"
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Modal para Crear / Editar Herramienta */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-xl p-0 gap-0 bg-surface border-2 border-line shadow-hard-accent flex flex-col" showCloseButton={false}>
          <DialogHeader className="flex flex-row items-center justify-between px-5 py-3 border-b-2 border-line bg-[#0D2B4D] text-white shrink-0 space-y-0">
            <DialogTitle className="font-display text-base font-black uppercase tracking-tight m-0">
              {editingItem ? 'Editar Registro de Herramienta' : 'Nuevo Registro de Herramienta'}
            </DialogTitle>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsModalOpen(false)}
              className="h-7 w-7 rounded-none border-2 border-white/40 bg-transparent text-white hover:bg-accent hover:border-accent hover:text-bg"
            >
              <X size={14} />
            </Button>
          </DialogHeader>
          <DialogDescription className="sr-only">Formulario de registro de herramienta</DialogDescription>

          <form onSubmit={handleSave} className="p-5 space-y-3 font-mono text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                  Código ISO / Nombre *
                </label>
                <Input
                  required
                  value={codigoISO}
                  onChange={(e) => setCodigoISO(e.target.value)}
                  placeholder="ej. WNMG 080408-PC"
                  className="h-8 border-2 border-line bg-surface-2 uppercase font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                  Categoría
                </label>
                <select
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value as ToolingCategory)}
                  className="w-full h-8 px-2 border-2 border-line bg-surface-2 text-ink font-bold outline-none"
                >
                  {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                Descripción Técnica
              </label>
              <Input
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
                placeholder="ej. Inserto trígono negativo 6 filos para desbaste 4140"
                className="h-8 border-2 border-line bg-surface-2"
              />
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Marca</label>
                <Input
                  value={marca}
                  onChange={(e) => setMarca(e.target.value)}
                  placeholder="ej. Korloy / Haas"
                  className="h-8 border-2 border-line bg-surface-2 font-bold"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Grado</label>
                <Input
                  value={grado}
                  onChange={(e) => setGrado(e.target.value)}
                  placeholder="ej. NC3030 / HT-P25"
                  className="h-8 border-2 border-line bg-surface-2"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Rompevirutas</label>
                <Input
                  value={rompevirutas}
                  onChange={(e) => setRompevirutas(e.target.value)}
                  placeholder="ej. PC / MA"
                  className="h-8 border-2 border-line bg-surface-2"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Proveedor</label>
                <Input
                  value={proveedor}
                  onChange={(e) => setProveedor(e.target.value)}
                  placeholder="ej. Travers México"
                  className="h-8 border-2 border-line bg-surface-2"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Precio Unit.</label>
                <Input
                  type="number"
                  step="0.01"
                  value={precioUnitario}
                  onChange={(e) => setPrecioUnitario(Number(e.target.value))}
                  className="h-8 border-2 border-line bg-surface-2 font-bold text-accent"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Máquina Asignada</label>
                <Input
                  value={maquinaAsignada}
                  onChange={(e) => setMaquinaAsignada(e.target.value)}
                  placeholder="ej. Haas ST-20"
                  className="h-8 border-2 border-line bg-surface-2 font-bold"
                />
              </div>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Link de Compra / Reorden</label>
              <Input
                type="url"
                value={linkCompra}
                onChange={(e) => setLinkCompra(e.target.value)}
                placeholder="https://www.haastooling.com/..."
                className="h-8 border-2 border-line bg-surface-2"
              />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                Notas de Rendimiento y Durabilidad
              </label>
              <textarea
                rows={2}
                value={rendimientoNotas}
                onChange={(e) => setRendimientoNotas(e.target.value)}
                placeholder="ej. Rindió 40 piezas por filo en desbaste de flechas 4140. Excelente acabado."
                className="w-full p-2 border-2 border-line bg-surface-2 text-ink text-xs font-mono outline-none focus:border-accent resize-none"
              />
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t-2 border-line mt-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsModalOpen(false)}
                className="border-2 border-line text-ink font-black uppercase text-[10px] rounded-none h-8 px-3"
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                disabled={isSaving}
                className="bg-accent text-bg px-5 h-8 text-[10px] font-black uppercase tracking-wider hover:bg-accent/80 rounded-none shadow-hard"
              >
                {isSaving ? 'Guardando...' : 'Guardar en Bóveda'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

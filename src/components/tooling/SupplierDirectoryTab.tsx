import { useState, useMemo, type ReactElement } from 'react';
import {
  Search,
  ExternalLink,
  ShoppingCart,
  Globe,
} from 'lucide-react';
import { TOOLING_SUPPLIERS, getSupplierSearchUrl } from '../../lib/tooling/toolingSuppliers';
import { Input } from '../ui/input';

export function SupplierDirectoryTab(): ReactElement {
  const [searchQuery, setSearchQuery] = useState('WNMG 080408');
  const [countryFilter, setCountryFilter] = useState<'all' | 'USA' | 'MEX'>('all');

  const filteredSuppliers = useMemo(() => {
    return TOOLING_SUPPLIERS.filter(
      (s) => countryFilter === 'all' || s.country === countryFilter
    );
  }, [countryFilter]);

  return (
    <div className="space-y-6">
      {/* Barra de Búsqueda Global en Tiendas */}
      <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Escribe el código o herramienta a buscar (ej. WNMG 080408, Endmill 1/2 AlTiN, CAT40 ER32)..."
              className="h-10 pl-10 text-sm font-mono font-bold border-2 border-line bg-surface-2 uppercase"
            />
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={() => setCountryFilter('all')}
              className={`px-3 py-2 text-xs font-mono font-bold uppercase border-2 border-line transition-all ${
                countryFilter === 'all'
                  ? 'bg-accent text-bg border-accent shadow-none'
                  : 'bg-surface-2 text-ink hover:bg-surface-2/80 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
              }`}
            >
              Todos ({TOOLING_SUPPLIERS.length})
            </button>
            <button
              onClick={() => setCountryFilter('MEX')}
              className={`px-3 py-2 text-xs font-mono font-bold uppercase border-2 border-line transition-all ${
                countryFilter === 'MEX'
                  ? 'bg-accent text-bg border-accent shadow-none'
                  : 'bg-surface-2 text-ink hover:bg-surface-2/80 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
              }`}
            >
              🇲🇽 México (CFDI)
            </button>
            <button
              onClick={() => setCountryFilter('USA')}
              className={`px-3 py-2 text-xs font-mono font-bold uppercase border-2 border-line transition-all ${
                countryFilter === 'USA'
                  ? 'bg-accent text-bg border-accent shadow-none'
                  : 'bg-surface-2 text-ink hover:bg-surface-2/80 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
              }`}
            >
              🇺🇸 EE.UU.
            </button>
          </div>
        </div>

        <p className="text-xs font-mono text-ink-dim">
          Haz click en el botón <strong>"Buscar en Tienda"</strong> de cualquier proveedor para abrir directamente los resultados con el término: <code className="text-accent font-bold font-mono">"{searchQuery || '—'}"</code>.
        </p>
      </div>

      {/* Grid de Proveedores */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredSuppliers.map((supplier) => {
          const directSearchUrl = getSupplierSearchUrl(supplier.id, searchQuery);

          return (
            <div
              key={supplier.id}
              className="border-2 border-line bg-surface p-4 shadow-hard flex flex-col justify-between space-y-3 group hover:border-accent transition-colors"
            >
              <div>
                <div className="flex items-start justify-between gap-2 border-b border-line pb-2 mb-2">
                  <div>
                    <h4 className="font-display font-black text-sm uppercase tracking-tight text-ink">
                      {supplier.name}
                    </h4>
                    <span className="text-[10px] font-mono text-ink-dim">
                      {supplier.country === 'MEX' ? '🇲🇽 México' : '🇺🇸 Estados Unidos'} · {supplier.category}
                    </span>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-[9px] font-mono font-black uppercase border shrink-0 ${
                      supplier.badge === 'Oficial Haas'
                        ? 'bg-ok/20 text-ok border-ok/40'
                        : supplier.badge === 'Factura México CFDI'
                          ? 'bg-accent/20 text-accent border-accent/40'
                          : 'bg-surface-2 text-ink-dim border-line'
                    }`}
                  >
                    {supplier.badge}
                  </span>
                </div>

                <p className="text-xs font-mono text-ink-dim mb-2">{supplier.description}</p>
                
                <div className="text-[11px] font-mono bg-surface-2 p-2 border border-line">
                  <span className="text-ink-dim block text-[10px]">Especialidad:</span>
                  <strong className="text-ink">{supplier.specialty}</strong>
                </div>
              </div>

              <div className="pt-2 border-t border-line/60 flex items-center justify-between gap-2">
                <a
                  href={supplier.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] font-mono text-ink-dim hover:text-ink flex items-center gap-1"
                >
                  <Globe size={11} /> Sitio Web
                </a>

                <a
                  href={directSearchUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg text-[10px] font-mono font-black uppercase hover:bg-accent/80 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px]"
                >
                  <ShoppingCart size={12} /> Buscar en Tienda <ExternalLink size={10} />
                </a>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

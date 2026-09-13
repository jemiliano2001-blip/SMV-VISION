import { useState, useMemo, type ReactElement } from 'react';
import {
  Search,
  Cpu,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { searchGrades, CARBIDE_GRADES_SOURCE } from '../../lib/tooling/carbideGrades';
import { HAAS_TOOLING_SPECS, HAAS_TOOLING_SPECS_SOURCE } from '../../lib/tooling/haasToolingSpecs';
import { getSupplierSearchUrl } from '../../lib/tooling/toolingSuppliers';
import { Input } from '../ui/input';
import { DataSourceChip } from './DataSourceChip';

const GRADE_BRANDS: { key: 'sandvik' | 'kennametal' | 'iscar' | 'korloy' | 'haasTooling' | 'mitsubishi' | 'walter' | 'kyocera' | 'seco' | 'yg1'; label: string }[] = [
  { key: 'sandvik', label: 'Sandvik' },
  { key: 'korloy', label: 'Korloy' },
  { key: 'kennametal', label: 'Kennametal' },
  { key: 'iscar', label: 'Iscar' },
  { key: 'haasTooling', label: 'Haas Tooling' },
  { key: 'mitsubishi', label: 'Mitsubishi' },
  { key: 'walter', label: 'Walter' },
  { key: 'kyocera', label: 'Kyocera' },
  { key: 'seco', label: 'Seco' },
  { key: 'yg1', label: 'YG-1' },
];

export function GradesAndHaasTab(): ReactElement {
  const [gradeSearch, setGradeSearch] = useState('');
  const [selectedSubTab, setSelectedSubTab] = useState<'grades' | 'haas_specs'>('grades');
  const [specCategory, setSpecCategory] = useState<string>('all');

  const filteredGrades = useMemo(() => {
    return searchGrades(gradeSearch);
  }, [gradeSearch]);

  const filteredSpecs = useMemo(() => {
    return HAAS_TOOLING_SPECS.filter(
      (s) => specCategory === 'all' || s.category === specCategory
    );
  }, [specCategory]);

  return (
    <div className="space-y-6">
      {/* Selector de Sub-pestaña */}
      <div className="flex items-center gap-2 border-b-2 border-line pb-3">
        <button
          onClick={() => setSelectedSubTab('grades')}
          className={`px-4 py-2 text-xs font-black uppercase tracking-wider flex items-center gap-2 border-2 border-line transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
            selectedSubTab === 'grades'
              ? 'bg-accent text-bg border-accent shadow-none translate-x-[2px] translate-y-[2px]'
              : 'bg-surface text-ink hover:bg-surface-2'
          }`}
        >
          <Zap size={14} /> Matriz de Equivalencias de Grados Multimarca
        </button>

        <button
          onClick={() => setSelectedSubTab('haas_specs')}
          className={`px-4 py-2 text-xs font-black uppercase tracking-wider flex items-center gap-2 border-2 border-line transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] ${
            selectedSubTab === 'haas_specs'
              ? 'bg-accent text-bg border-accent shadow-none translate-x-[2px] translate-y-[2px]'
              : 'bg-surface text-ink hover:bg-surface-2'
          }`}
        >
          <Cpu size={14} /> Ecosistema Haas CNC & Refacciones Torx
        </button>
      </div>

      {selectedSubTab === 'grades' ? (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 border-2 border-line bg-surface p-4 shadow-hard">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
              <Input
                value={gradeSearch}
                onChange={(e) => setGradeSearch(e.target.value)}
                placeholder="Buscar por grado (ej. GC4325, NC3030, KCP25B, P25)..."
                className="h-9 pl-9 text-xs font-mono border-2 border-line bg-surface-2"
              />
            </div>
            <div className="text-xs font-mono text-ink-dim">
              Mostrando <strong className="text-accent">{filteredGrades.length}</strong> aplicaciones ISO
            </div>
          </div>

          <div className="border-2 border-danger/40 bg-danger/5 p-3 text-[11px] font-mono text-ink-dim">
            <strong className="text-danger uppercase">Orientativo, no un cruce oficial:</strong> estas equivalencias son una compilación
            editorial multimarca para acelerar la búsqueda de un sustituto. Los grados de distintos fabricantes rara vez son idénticos
            en composición o recubrimiento — confirma siempre contra el catálogo o el ingeniero de aplicación del fabricante antes de comprar.
          </div>
          <DataSourceChip source={CARBIDE_GRADES_SOURCE} />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {filteredGrades.map((entry, idx) => (
              <div key={idx} className="border-2 border-line bg-surface p-4 shadow-hard space-y-3">
                <div className="flex items-center gap-1.5 border-b border-line pb-2">
                  <span className="bg-accent text-bg px-1.5 py-0.5 text-[10px] font-mono font-bold shrink-0">
                    {entry.isoGroup}
                  </span>
                  <h4 className="font-display font-black text-sm uppercase tracking-tight text-ink">
                    {entry.subGroup}
                  </h4>
                </div>
                <p className="text-[11px] font-mono text-ink-dim leading-tight">{entry.application}</p>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                  {GRADE_BRANDS.map((brand) => (
                    <div
                      key={brand.key}
                      className={`border px-2 py-1.5 ${
                        brand.key === 'haasTooling'
                          ? 'border-ok/40 bg-ok/10'
                          : brand.key === 'korloy'
                            ? 'border-accent/40 bg-accent/5'
                            : 'border-line bg-surface-2'
                      }`}
                    >
                      <span className="block text-[8px] font-mono uppercase tracking-wider text-ink-dim">{brand.label}</span>
                      <strong
                        className={`block text-[11px] font-mono font-bold truncate ${
                          brand.key === 'haasTooling' ? 'text-ok' : brand.key === 'korloy' ? 'text-accent' : 'text-ink'
                        }`}
                        title={entry[brand.key]}
                      >
                        {entry[brand.key]}
                      </strong>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 border-2 border-line bg-surface p-4 shadow-hard">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold uppercase text-ink-dim">Filtrar Componentes:</span>
              <select
                value={specCategory}
                onChange={(e) => setSpecCategory(e.target.value)}
                className="h-8 px-3 border-2 border-line bg-surface-2 text-ink text-xs font-mono font-bold outline-none"
              >
                <option value="all">Todos los Componentes Haas</option>
                <option value="fresado_cat40">Fresado Haas CAT40 & Tirantes</option>
                <option value="torno_st_exterior">Torno Haas ST (Exteriores)</option>
                <option value="torno_st_interior">Torno Haas ST (Mandrinado)</option>
                <option value="refaccion_torx">Refacciones Torx & Clamps</option>
              </select>
            </div>
            <DataSourceChip source={HAAS_TOOLING_SPECS_SOURCE} />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredSpecs.map((spec, idx) => (
              <div key={idx} className="border-2 border-line bg-surface p-4 shadow-hard flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-start justify-between gap-2 border-b border-line pb-2 mb-2">
                    <h4 className="font-display font-black text-sm uppercase tracking-tight text-ink">
                      {spec.name}
                    </h4>
                    {spec.partNumberVerified && spec.haasPartNumber ? (
                      <span className="bg-accent text-bg px-2 py-0.5 text-[10px] font-mono font-bold shrink-0">
                        P/N Haas {spec.haasPartNumber}
                      </span>
                    ) : (
                      <span className="bg-warn/20 text-warn border border-warn/40 px-2 py-0.5 text-[10px] font-mono font-bold shrink-0">
                        ISO / sin P/N
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-mono text-ink-dim mb-2">{spec.description}</p>

                  <div className="space-y-1 text-xs font-mono bg-surface-2 p-2.5 border border-line">
                    <div>
                      <span className="text-ink-dim">Cono / Zanco:</span> <strong className="text-ink">{spec.taperOrShank}</strong>
                    </div>
                    <div>
                      <span className="text-ink-dim">Capacidad / Insertos:</span> <strong className="text-accent">{spec.toolCapacity}</strong>
                    </div>
                    <div>
                      <span className="text-ink-dim">Tirante / Sujeción:</span> <strong className="text-ink">{spec.pullStudOrClamp}</strong>
                    </div>
                  </div>
                </div>

                <div className="pt-2 border-t border-line/60 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-mono text-ink-dim italic truncate mr-2">{spec.notes}</span>
                    <a
                      href={getSupplierSearchUrl('haas_tooling', spec.haasPartNumber || spec.name)}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 inline-flex items-center gap-1 text-[10px] font-mono font-black uppercase text-accent hover:underline"
                    >
                      Ver en Haas Tooling <ExternalLink size={11} />
                    </a>
                  </div>
                  <p className="font-mono text-[9px] text-ink-dim">
                    Fuente: <span className={spec.partNumberVerified ? 'text-ink font-bold' : 'text-warn font-bold'}>{spec.source}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

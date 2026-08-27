import { useState, useMemo, type ReactElement } from 'react';
import {
  Search,
  Cpu,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { searchGrades } from '../../lib/tooling/carbideGrades';
import { HAAS_TOOLING_SPECS } from '../../lib/tooling/haasToolingSpecs';
import { getSupplierSearchUrl } from '../../lib/tooling/toolingSuppliers';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

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

          <div className="border-2 border-line bg-surface shadow-hard overflow-x-auto">
            <Table>
              <TableHeader className="bg-surface-2 border-b-2 border-line">
                <TableRow className="border-0">
                  <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                    Grupo / Aplicación
                  </TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                    Sandvik
                  </TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                    Korloy
                  </TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                    Kennametal
                  </TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                    Iscar
                  </TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                    Haas Tooling
                  </TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                    Mitsubishi
                  </TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim border-r-2 border-line">
                    Walter
                  </TableHead>
                  <TableHead className="font-black text-[10px] uppercase tracking-wider text-ink-dim">
                    Kyocera / Seco
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredGrades.map((entry, idx) => (
                  <TableRow key={idx} className="border-b-2 border-line hover:bg-surface-2/60 transition-colors">
                    <TableCell className="border-r-2 border-line py-3">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="bg-accent text-bg px-1.5 py-0.2 text-[9px] font-mono font-bold">
                          {entry.isoGroup}
                        </span>
                        <span className="font-mono text-xs font-black text-ink">{entry.subGroup}</span>
                      </div>
                      <p className="text-[10px] font-mono text-ink-dim leading-tight">{entry.application}</p>
                    </TableCell>

                    <TableCell className="border-r-2 border-line py-3 font-mono text-xs font-bold text-ink">
                      {entry.sandvik}
                    </TableCell>

                    <TableCell className="border-r-2 border-line py-3 font-mono text-xs font-bold text-accent">
                      {entry.korloy}
                    </TableCell>

                    <TableCell className="border-r-2 border-line py-3 font-mono text-xs font-bold text-ink">
                      {entry.kennametal}
                    </TableCell>

                    <TableCell className="border-r-2 border-line py-3 font-mono text-xs font-bold text-ink">
                      {entry.iscar}
                    </TableCell>

                    <TableCell className="border-r-2 border-line py-3 font-mono text-xs font-bold text-ok">
                      {entry.haasTooling}
                    </TableCell>

                    <TableCell className="border-r-2 border-line py-3 font-mono text-xs text-ink-dim">
                      {entry.mitsubishi}
                    </TableCell>

                    <TableCell className="border-r-2 border-line py-3 font-mono text-xs text-ink-dim">
                      {entry.walter}
                    </TableCell>

                    <TableCell className="py-3 font-mono text-xs text-ink-dim">
                      {entry.kyocera} / {entry.seco}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
            <span className="text-xs font-mono text-ink-dim">
              Compatibilidad 100% verificada para máquinas Haas VF y ST
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredSpecs.map((spec, idx) => (
              <div key={idx} className="border-2 border-line bg-surface p-4 shadow-hard flex flex-col justify-between space-y-3">
                <div>
                  <div className="flex items-start justify-between gap-2 border-b border-line pb-2 mb-2">
                    <h4 className="font-display font-black text-sm uppercase tracking-tight text-ink">
                      {spec.name}
                    </h4>
                    {spec.haasPartNumber && (
                      <span className="bg-accent text-bg px-2 py-0.5 text-[10px] font-mono font-bold shrink-0">
                        Haas P/N {spec.haasPartNumber}
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

                <div className="pt-2 border-t border-line/60 flex items-center justify-between">
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
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

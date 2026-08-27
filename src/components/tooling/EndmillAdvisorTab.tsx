import { useState, type ReactElement } from 'react';
import {
  Layers,
  CheckCircle2,
  ExternalLink,
  ShoppingCart,
  Wrench,
} from 'lucide-react';
import type { IsoMaterialGroup, EndmillTipGeometry } from '../../lib/tooling/types';
import { ENDMILL_RECOMMENDATIONS, TIP_GEOMETRY_GUIDE } from '../../lib/tooling/endmillGuide';
import { getSupplierSearchUrl } from '../../lib/tooling/toolingSuppliers';

export function EndmillAdvisorTab(): ReactElement {
  const [selectedGroup, setSelectedGroup] = useState<IsoMaterialGroup>('P');
  const [selectedTip, setSelectedTip] = useState<EndmillTipGeometry>('corner_radius');

  const rec = ENDMILL_RECOMMENDATIONS[selectedGroup];
  const tipInfo = TIP_GEOMETRY_GUIDE[selectedTip];

  return (
    <div className="space-y-6">
      {/* Selector de Material para Fresas */}
      <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b-2 border-line pb-3">
          <div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-accent font-bold">
              Guía Técnica de Fresas de Carburo
            </span>
            <h3 className="font-display font-black text-lg uppercase tracking-tight text-ink mt-0.5">
              Selector Inteligente de Endmills por Material
            </h3>
          </div>
          <span className="text-xs font-mono text-ink-dim">
            Recomendaciones para centros de maquinado Haas VF y Mini Mill
          </span>
        </div>

        {/* Botones de Grupo ISO */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          <button
            onClick={() => setSelectedGroup('P')}
            className={`p-3 text-left border-2 transition-all ${
              selectedGroup === 'P'
                ? 'border-accent bg-accent text-bg shadow-none'
                : 'border-line bg-surface-2 text-ink hover:border-accent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
            }`}
          >
            <span className="font-mono text-[10px] font-bold block opacity-80">GRUPO P</span>
            <strong className="font-display font-black text-xs uppercase block">Aceros 1018/4140</strong>
            <span className="text-[9px] font-mono block mt-1 opacity-90">4 Filos · AlTiN</span>
          </button>

          <button
            onClick={() => setSelectedGroup('M')}
            className={`p-3 text-left border-2 transition-all ${
              selectedGroup === 'M'
                ? 'border-accent bg-accent text-bg shadow-none'
                : 'border-line bg-surface-2 text-ink hover:border-accent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
            }`}
          >
            <span className="font-mono text-[10px] font-bold block opacity-80">GRUPO M</span>
            <strong className="font-display font-black text-xs uppercase block">Inox 304 / 316</strong>
            <span className="text-[9px] font-mono block mt-1 opacity-90">5 Filos · nACo</span>
          </button>

          <button
            onClick={() => setSelectedGroup('N')}
            className={`p-3 text-left border-2 transition-all ${
              selectedGroup === 'N'
                ? 'border-accent bg-accent text-bg shadow-none'
                : 'border-line bg-surface-2 text-ink hover:border-accent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
            }`}
          >
            <span className="font-mono text-[10px] font-bold block opacity-80">GRUPO N</span>
            <strong className="font-display font-black text-xs uppercase block">Aluminio 6061/7075</strong>
            <span className="text-[9px] font-mono block mt-1 opacity-90">3 Filos · ZrN / DLC</span>
          </button>

          <button
            onClick={() => setSelectedGroup('K')}
            className={`p-3 text-left border-2 transition-all ${
              selectedGroup === 'K'
                ? 'border-accent bg-accent text-bg shadow-none'
                : 'border-line bg-surface-2 text-ink hover:border-accent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
            }`}
          >
            <span className="font-mono text-[10px] font-bold block opacity-80">GRUPO K</span>
            <strong className="font-display font-black text-xs uppercase block">Fundición Gris</strong>
            <span className="text-[9px] font-mono block mt-1 opacity-90">4-6 Filos · Corte Seco</span>
          </button>

          <button
            onClick={() => setSelectedGroup('S')}
            className={`p-3 text-left border-2 transition-all ${
              selectedGroup === 'S'
                ? 'border-accent bg-accent text-bg shadow-none'
                : 'border-line bg-surface-2 text-ink hover:border-accent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
            }`}
          >
            <span className="font-mono text-[10px] font-bold block opacity-80">GRUPO S</span>
            <strong className="font-display font-black text-xs uppercase block">Titanio / Inconel</strong>
            <span className="text-[9px] font-mono block mt-1 opacity-90">5-7 Filos · Trocoidal</span>
          </button>

          <button
            onClick={() => setSelectedGroup('H')}
            className={`p-3 text-left border-2 transition-all ${
              selectedGroup === 'H'
                ? 'border-accent bg-accent text-bg shadow-none'
                : 'border-line bg-surface-2 text-ink hover:border-accent shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
            }`}
          >
            <span className="font-mono text-[10px] font-bold block opacity-80">GRUPO H</span>
            <strong className="font-display font-black text-xs uppercase block">D2 Templado &gt;55HRC</strong>
            <span className="text-[9px] font-mono block mt-1 opacity-90">Micrograno · TiSiN</span>
          </button>
        </div>
      </div>

      {/* DETALLE TÉCNICO DE LA FRESA RECOMENDADA */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* ESPECIFICACIONES (Izquierda) */}
        <div className="lg:col-span-7 border-2 border-line bg-surface p-5 shadow-hard space-y-4">
          <div className="flex items-center justify-between border-b-2 border-line pb-2">
            <h4 className="font-display font-black text-sm uppercase tracking-wider text-ink flex items-center gap-2">
              <Layers size={16} className="text-accent" />
              Especificación Óptima de Fresa para Grupo {selectedGroup}
            </h4>
            <span className="bg-accent/20 text-accent font-bold px-2 py-0.5 text-[10px] font-mono">
              Máximo Rendimiento
            </span>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs font-mono">
            <div className="bg-surface-2 border border-line p-3">
              <span className="text-ink-dim block text-[10px] uppercase">Número de Filos (Flutes):</span>
              <strong className="text-accent text-base block mt-0.5">
                {rec.idealFlutes.join(' o ')} Filos ({rec.idealFlutes.map(f => `${f}F`).join('/')})
              </strong>
            </div>

            <div className="bg-surface-2 border border-line p-3">
              <span className="text-ink-dim block text-[10px] uppercase">Recubrimiento Recomendado:</span>
              <strong className="text-ink text-sm block mt-0.5">{rec.coatingName}</strong>
            </div>

            <div className="bg-surface-2 border border-line p-3">
              <span className="text-ink-dim block text-[10px] uppercase">Ángulo de Hélice:</span>
              <strong className="text-ink text-xs block mt-0.5">{rec.helixAngle}</strong>
            </div>

            <div className="bg-surface-2 border border-line p-3">
              <span className="text-ink-dim block text-[10px] uppercase">Geometría de Punta:</span>
              <strong className="text-ink text-xs block mt-0.5">
                {TIP_GEOMETRY_GUIDE[rec.tipGeometry].name}
              </strong>
            </div>
          </div>

          {/* Justificación Técnica */}
          <div className="border border-line bg-surface-2 p-3 text-xs font-mono space-y-2">
            <h5 className="font-bold text-ink uppercase text-[10px] flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-ok" /> Por qué esta configuración:
            </h5>
            <ul className="list-disc list-inside text-ink-dim space-y-1 text-[11px]">
              {rec.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </div>

          {/* Marcas Recomendadas & Enlaces Directos */}
          <div className="pt-2 border-t border-line/60 flex flex-wrap items-center justify-between gap-3">
            <div>
              <span className="text-[10px] font-mono text-ink-dim uppercase block">Marcas Recomendadas:</span>
              <span className="text-xs font-mono font-bold text-ink">{rec.topBrands.join(' · ')}</span>
            </div>

            <div className="flex gap-2">
              <a
                href={getSupplierSearchUrl('haas_tooling', `endmill ${rec.idealFlutes[0]} flute`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg text-[10px] font-mono font-black uppercase hover:bg-accent/80 transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                <ShoppingCart size={11} /> Haas Tooling <ExternalLink size={10} />
              </a>
              <a
                href={getSupplierSearchUrl('travers_mexico', `cortador ${rec.idealFlutes[0]} filos carburo`)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 border-2 border-line text-ink text-[10px] font-mono font-black uppercase hover:bg-accent hover:text-bg hover:border-accent transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
              >
                Travers MX <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>

        {/* GUÍA DE GEOMETRÍAS DE PUNTA (Derecha) */}
        <div className="lg:col-span-5 border-2 border-line bg-surface p-5 shadow-hard space-y-3 flex flex-col justify-between">
          <div>
            <h4 className="font-display font-black text-sm uppercase tracking-wider text-ink border-b-2 border-line pb-2 mb-3 flex items-center gap-2">
              <Wrench size={16} className="text-accent" />
              Tipos de Punta y Aplicación
            </h4>

            <div className="space-y-1.5">
              {(Object.keys(TIP_GEOMETRY_GUIDE) as EndmillTipGeometry[]).map((tipKey) => {
                const item = TIP_GEOMETRY_GUIDE[tipKey];
                const isSelected = selectedTip === tipKey;
                return (
                  <button
                    key={tipKey}
                    onClick={() => setSelectedTip(tipKey)}
                    className={`w-full text-left p-2.5 border-2 transition-all text-xs font-mono ${
                      isSelected
                        ? 'border-accent bg-accent/10 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                        : 'border-line/70 bg-surface-2 hover:border-line'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <strong className="text-ink">{item.name}</strong>
                      {isSelected && <span className="text-[9px] font-bold text-accent">ACTIVO</span>}
                    </div>
                    <p className="text-[10px] text-ink-dim mt-0.5">{item.bestFor}</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border border-line bg-surface-2 p-3 text-xs font-mono">
            <span className="text-ink-dim block text-[10px] uppercase">Detalle de {tipInfo.name}:</span>
            <p className="text-ink text-[11px] mt-1">{tipInfo.description}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

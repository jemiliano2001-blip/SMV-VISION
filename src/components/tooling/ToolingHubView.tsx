import { useState, type ReactElement } from 'react';
import {
  Gauge,
  FileText,
  Boxes,
  Layers,
  Cpu,
  ShoppingBag,
  RotateCcw,
  Bolt,
} from 'lucide-react';
import { SpeedsFeedsCalculatorTab } from './SpeedsFeedsCalculatorTab';
import { BlueprintAdvisorTab } from './BlueprintAdvisorTab';
import { ToolingVaultTab } from './ToolingVaultTab';
import { InsertDecoderTab } from './InsertDecoderTab';
import { EndmillAdvisorTab } from './EndmillAdvisorTab';
import { GradesAndHaasTab } from './GradesAndHaasTab';
import { SupplierDirectoryTab } from './SupplierDirectoryTab';
import { ThreadingAdvisorTab } from './ThreadingAdvisorTab';

type ToolingHubTab =
  | 'calculadora'
  | 'asesor_planos'
  | 'boveda'
  | 'endmills'
  | 'decodificador'
  | 'roscado'
  | 'grados_haas'
  | 'proveedores';

interface TabItemDef {
  id: ToolingHubTab;
  label: string;
  shortLabel: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
}

const TABS: TabItemDef[] = [
  { id: 'calculadora', label: '1. Calculadora de Corte (Speeds & Feeds)', shortLabel: 'Calculadora', icon: Gauge },
  { id: 'asesor_planos', label: '2. Asesor desde Planos (Blueprints)', shortLabel: 'Asesor Planos', icon: FileText },
  { id: 'boveda', label: '3. Mi Bóveda de Herramental', shortLabel: 'Bóveda Compras', icon: Boxes },
  { id: 'endmills', label: '4. Asesor de Endmills / Fresas', shortLabel: 'Endmills', icon: Layers },
  { id: 'decodificador', label: '5. Decodificador ISO + Escáner IA', shortLabel: 'Decodificador ISO', icon: RotateCcw },
  { id: 'roscado', label: '6. Roscado & Machuelos', shortLabel: 'Roscado', icon: Bolt },
  { id: 'grados_haas', label: '7. Grados Multimarca & Haas CNC', shortLabel: 'Grados & Haas', icon: Cpu },
  { id: 'proveedores', label: '8. Directorio de Proveedores', shortLabel: 'Proveedores', icon: ShoppingBag },
];

export function ToolingHubView(): ReactElement {
  const [activeTab, setActiveTab] = useState<ToolingHubTab>('calculadora');

  return (
    <div className="min-h-full bp-grid-lg flex flex-col">
      {/* Header Fijo */}
      <div className="sticky top-0 z-20 bg-bg/95 backdrop-blur border-b-2 border-line px-6 lg:px-8 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[4px] text-accent mb-0.5">
              Ingeniería & Maquinado CNC
            </p>
            <h1 className="font-display font-black text-3xl lg:text-4xl uppercase italic tracking-[-1.5px] leading-none flex items-center gap-3">
              Herramental & Cálculo Técnico
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="bg-surface border-2 border-line px-3 py-1 text-xs font-mono font-bold shadow-hard">
              ⚙️ Máquinas Haas VF & ST
            </span>
          </div>
        </div>

        {/* Barra de Pestañas con Navegación Horizontal */}
        <div className="mt-4 flex items-center gap-1.5 overflow-x-auto pb-1 border-t border-line/40 pt-3 scrollbar-none">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 text-xs font-mono font-black uppercase whitespace-nowrap flex items-center gap-2 border-2 transition-all shrink-0 ${
                  isActive
                    ? 'border-accent bg-accent text-bg shadow-none translate-x-[1px] translate-y-[1px]'
                    : 'border-line bg-surface text-ink hover:bg-surface-2 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                }`}
              >
                <Icon size={14} />
                <span className="hidden sm:inline">{tab.label}</span>
                <span className="sm:hidden">{tab.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Contenido Dinámico de la Pestaña Activa */}
      <div className="flex-1 p-6 lg:p-8 overflow-y-auto">
        {activeTab === 'calculadora' && <SpeedsFeedsCalculatorTab />}
        {activeTab === 'asesor_planos' && <BlueprintAdvisorTab />}
        {activeTab === 'boveda' && <ToolingVaultTab />}
        {activeTab === 'endmills' && <EndmillAdvisorTab />}
        {activeTab === 'decodificador' && <InsertDecoderTab />}
        {activeTab === 'roscado' && <ThreadingAdvisorTab />}
        {activeTab === 'grados_haas' && <GradesAndHaasTab />}
        {activeTab === 'proveedores' && <SupplierDirectoryTab />}
      </div>
    </div>
  );
}

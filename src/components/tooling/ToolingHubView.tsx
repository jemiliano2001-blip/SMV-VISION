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
  Wrench,
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
    <div className="tooling-workspace min-h-full bp-grid-lg flex flex-col">
      {/* Header Fijo */}
      <div className="sticky top-0 z-20 border-b border-line bg-bg/95 px-4 py-4 backdrop-blur sm:px-6 lg:px-8">
        <div className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
          <div>
            <p className="workspace-kicker mb-2">
              Ingeniería & Maquinado CNC
            </p>
            <h1 className="workspace-title text-3xl sm:text-4xl flex items-center gap-3">
              Herramental & Cálculo
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs font-mono font-bold shadow-sm">
              <Wrench size={15} className="text-accent" aria-hidden="true" /> Haas VF & ST
            </span>
          </div>
        </div>

        {/* Barra de Pestañas con Navegación Horizontal */}
        <div role="tablist" aria-label="Herramientas CNC" className="mt-4 flex items-center gap-2 overflow-x-auto border-t border-line/40 pt-3 pb-1 scrollbar-none">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`tooling-tab-${tab.id}`}
                aria-selected={isActive}
                aria-controls="tooling-active-panel"
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-11 rounded-lg border px-3.5 text-xs font-mono font-bold whitespace-nowrap flex items-center gap-2 transition-all shrink-0 ${
                  isActive
                    ? 'border-accent bg-accent text-white shadow-hard-accent'
                    : 'border-line bg-surface text-ink hover:border-accent hover:bg-surface-2'
                }`}
              >
                <Icon size={14} />
                <span className="hidden md:inline">{tab.label}</span>
                <span className="md:hidden">{tab.shortLabel}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Contenido Dinámico de la Pestaña Activa */}
      <div
        id="tooling-active-panel"
        role="tabpanel"
        aria-labelledby={`tooling-tab-${activeTab}`}
        className="flex-1 p-3.5 sm:p-6 lg:p-8 overflow-y-auto"
      >
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

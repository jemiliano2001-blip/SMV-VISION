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
import { PageFrame } from '../shell/PageFrame';
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
    <PageFrame
      title="Herramental y cálculo"
      subtitle="Ingeniería y maquinado CNC"
      actions={
        <span className="flex min-h-11 items-center gap-2 rounded-xl border border-line bg-surface px-3 text-xs font-mono font-bold shadow-sm">
          <Wrench size={15} className="text-accent" aria-hidden="true" /> Haas VF &amp; ST
        </span>
      }
      scrollBody={false}
    >
      <div className="tooling-workspace bp-grid-lg flex h-full w-full min-h-0 flex-col lg:flex-row">
        {/* Menú: select en pantallas < lg */}
        <div className="shrink-0 border-b border-line bg-surface px-4 py-3 lg:hidden">
          <label htmlFor="tooling-tab-select" className="mb-1 block text-[10px] font-mono font-bold uppercase text-ink-dim">
            Herramienta
          </label>
          <select
            id="tooling-tab-select"
            value={activeTab}
            onChange={(e) => setActiveTab(e.target.value as ToolingHubTab)}
            className="min-h-11 w-full rounded-lg border border-line bg-surface-2 px-3 text-xs font-mono font-bold text-ink outline-none focus:border-accent"
          >
            {TABS.map((tab) => (
              <option key={tab.id} value={tab.id}>
                {tab.label}
              </option>
            ))}
          </select>
        </div>

        {/* Submenú vertical en lg+ */}
        <div
          role="tablist"
          aria-orientation="vertical"
          aria-label="Herramientas CNC"
          className="hidden w-60 shrink-0 flex-col gap-2 overflow-y-auto border-r border-line bg-surface/60 p-3 lg:flex"
        >
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
                title={tab.label}
                onClick={() => setActiveTab(tab.id)}
                className={`min-h-11 w-full rounded-lg border px-3 text-left text-xs font-mono font-bold flex items-center gap-2 transition-all ${
                  isActive
                    ? 'border-accent bg-accent text-white shadow-hard-accent'
                    : 'border-line bg-surface text-ink hover:border-accent hover:bg-surface-2'
                }`}
              >
                <Icon size={14} className="shrink-0" />
                <span className="min-w-0">{tab.shortLabel}</span>
              </button>
            );
          })}
        </div>
      {/* Contenido Dinámico de la Pestaña Activa */}
      <div
        id="tooling-active-panel"
        role="tabpanel"
        aria-labelledby={`tooling-tab-${activeTab}`}
        className="flex-1 min-w-0 min-h-0 p-3.5 sm:p-6 lg:p-8 overflow-y-auto"
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
    </PageFrame>
  );
}

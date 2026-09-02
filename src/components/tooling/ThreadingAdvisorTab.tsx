import { useMemo, useState, type ReactElement } from 'react';
import {
  Search,
  Wrench,
  Drill,
  Ruler,
  Terminal,
  Copy,
  Check,
  Compass,
  Layers,
} from 'lucide-react';
import { toast } from 'sonner';
import { decodeThreadInsertCode } from '../../lib/tooling/threadInsertDecoder';
import { calculateThreadDepths, generateHaasG76Block, pitchFromTpi } from '../../lib/tooling/threadingCalculator';
import { METRIC_TAP_DRILLS, NPT_TAP_DRILLS, UNC_TAP_DRILLS, UNF_TAP_DRILLS } from '../../lib/tooling/tapDrillChart';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

const INSERT_PRESETS = [
  '3ER 14UN',
  '3IR AG60',
  '16ER 20UN',
  '16ER 18NPT',
  '3ER 10ACME',
  '16ER 16UNJ',
  '16ER 1.5 ISO',
  '22ER 8UN',
];

type ThreadingSection = 'machuelos' | 'calculadora' | 'decodificador';
type ThreadStandard = 'unc_unf' | 'npt' | 'metric';
type G76Format = 'haas_single' | 'fanuc_two_line';

export function ThreadingAdvisorTab(): ReactElement {
  const [section, setSection] = useState<ThreadingSection>('machuelos');
  const [threadStandard, setThreadStandard] = useState<ThreadStandard>('unc_unf');
  const [g76Format, setG76Format] = useState<G76Format>('haas_single');
  const [copiedCode, setCopiedCode] = useState(false);

  // ── Decodificador de insertos ──
  const [insertCode, setInsertCode] = useState('3ER 14UN');
  const decodedInsert = decodeThreadInsertCode(insertCode);

  // ── Calculadora CNC G76 ──
  const [isExternal, setIsExternal] = useState(true);
  const [majorDiameterInch, setMajorDiameterInch] = useState<number>(0.75); // 3/4"
  const [tpi, setTpi] = useState<number>(10); // 10 TPI (3/4-10 UNC)
  const [majorDiameterMm, setMajorDiameterMm] = useState<number>(20);
  const [pitchMmCustom, setPitchMmCustom] = useState<number>(1.5);
  const [startZInch, setStartZInch] = useState<number>(0.15);
  const [endZInch, setEndZInch] = useState<number>(-1.125);

  const effectiveMajorMm = threadStandard === 'metric' ? majorDiameterMm : majorDiameterInch * 25.4;
  const effectivePitchMm = threadStandard === 'metric' ? pitchMmCustom : pitchFromTpi(tpi);

  const depthResult = useMemo(
    () =>
      calculateThreadDepths({
        pitchMm: effectivePitchMm,
        majorDiameterMm: effectiveMajorMm,
        isExternal,
      }),
    [effectivePitchMm, effectiveMajorMm, isExternal]
  );

  const g76Code = useMemo(() => {
    const isInch = threadStandard !== 'metric';
    const depthMm = isExternal ? depthResult.depthExternalMm : depthResult.depthInternalMm;
    const depthInch = isExternal ? depthResult.depthExternalInch : depthResult.depthInternalInch;

    return generateHaasG76Block({
      isExternal,
      majorDiameterMm: effectiveMajorMm,
      pitchMm: effectivePitchMm,
      depthMm,
      finishingPasses: 2,
      chamferCode: 0,
      tipAngleDegrees: 60,
      minDepthPerPassMm: 0.02,
      finishAllowanceMm: 0.02,
      firstPassDepthMm: depthResult.infeedScheduleMm[0] ?? 0.25,
      startZMm: startZInch * 25.4,
      endZMm: endZInch * 25.4,
      format: g76Format,
      unitSystem: isInch ? 'inch' : 'metric',
      tpi,
      majorDiameterInch,
      depthInch,
      firstPassDepthInch: depthResult.infeedScheduleInch[0] ?? 0.01,
      minDepthPerPassInch: 0.001,
      finishAllowanceInch: 0.001,
      startZInch,
      endZInch,
    });
  }, [
    isExternal,
    effectiveMajorMm,
    effectivePitchMm,
    depthResult,
    startZInch,
    endZInch,
    g76Format,
    threadStandard,
    tpi,
    majorDiameterInch,
  ]);

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(g76Code);
      setCopiedCode(true);
      toast.success('Código G76 copiado al portapapeles.');
      setTimeout(() => setCopiedCode(false), 2000);
    } catch {
      toast.error('No se pudo copiar el código.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navegación interna */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-line bg-surface p-2 shadow-hard">
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { id: 'machuelos' as const, label: '1. Tablas de Machuelos & Brocas (UNC / UNF / NPT)', icon: Drill },
            { id: 'calculadora' as const, label: '2. Calculadora & Ciclo G76 Haas ST (Pulgadas)', icon: Terminal },
            { id: 'decodificador' as const, label: '3. Decodificador de Insertos de Rosca (ANSI / ISO)', icon: Search },
          ]).map((tab) => {
            const Icon = tab.icon;
            const isActive = section === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSection(tab.id)}
                className={`px-3 py-1.5 text-[11px] font-mono font-black uppercase flex items-center gap-1.5 border-2 transition-all ${
                  isActive ? 'border-accent bg-accent text-bg' : 'border-line bg-surface-2 text-ink hover:border-accent'
                }`}
              >
                <Icon size={13} /> {tab.label}
              </button>
            );
          })}
        </div>

        {/* Selector de Estándar */}
        <div className="flex items-center gap-1 border-2 border-line bg-surface-2 p-0.5 text-xs font-mono">
          <span className="text-[10px] font-bold text-ink-dim px-1 uppercase">Estándar:</span>
          <button
            type="button"
            onClick={() => setThreadStandard('unc_unf')}
            className={`px-2 py-0.5 text-[10px] font-bold uppercase transition-colors ${
              threadStandard === 'unc_unf' ? 'bg-accent text-bg' : 'text-ink-dim hover:text-ink'
            }`}
          >
            UNC / UNF (Pulgadas)
          </button>
          <button
            type="button"
            onClick={() => setThreadStandard('npt')}
            className={`px-2 py-0.5 text-[10px] font-bold uppercase transition-colors ${
              threadStandard === 'npt' ? 'bg-accent text-bg' : 'text-ink-dim hover:text-ink'
            }`}
          >
            NPT Tubería
          </button>
          <button
            type="button"
            onClick={() => setThreadStandard('metric')}
            className={`px-2 py-0.5 text-[10px] font-bold uppercase transition-colors ${
              threadStandard === 'metric' ? 'bg-accent text-bg' : 'text-ink-dim hover:text-ink'
            }`}
          >
            Métrico ISO
          </button>
        </div>
      </div>

      {/* SECCIÓN 1: MACHUELOS Y BROCAS PREVIAS (UNC / UNF / NPT / MÉTRICO) */}
      {section === 'machuelos' && (
        <div className="space-y-6">
          {/* Roscas en Pulgadas: UNC y UNF */}
          {(threadStandard === 'unc_unf' || threadStandard === 'npt') && (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* Tabla UNC */}
                <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
                  <div className="flex items-center justify-between border-b-2 border-line pb-2">
                    <h4 className="font-display font-black text-sm uppercase tracking-wider text-ink flex items-center gap-2">
                      <Drill size={15} className="text-accent" />
                      Tabla UNC (Rosca Gruesa Americana en Pulgadas)
                    </h4>
                    <span className="font-mono text-[9px] font-bold text-accent uppercase bg-accent/10 px-2 py-0.5 border border-accent/30">
                      Taller Principal
                    </span>
                  </div>
                  <div className="max-h-96 overflow-y-auto overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rosca UNC</TableHead>
                          <TableHead>Broca de Corte (75%)</TableHead>
                          <TableHead>Decimal</TableHead>
                          <TableHead>Roll Tap (Formado)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {UNC_TAP_DRILLS.map((entry) => (
                          <TableRow key={entry.designation}>
                            <TableCell className="font-mono font-bold text-ink whitespace-nowrap">{entry.designation}</TableCell>
                            <TableCell className="font-mono font-black text-accent whitespace-nowrap">{entry.cutTapDrillLabel}</TableCell>
                            <TableCell className="font-mono text-xs text-ink-dim whitespace-nowrap">{entry.cutTapDrillInchDecimal ? `${entry.cutTapDrillInchDecimal.toFixed(4)}"` : `${entry.cutTapDrillMm.toFixed(2)} mm`}</TableCell>
                            <TableCell className="font-mono text-xs text-ok font-bold whitespace-nowrap">{entry.rollTapDrillLabel}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>

                {/* Tabla UNF */}
                <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
                  <div className="flex items-center justify-between border-b-2 border-line pb-2">
                    <h4 className="font-display font-black text-sm uppercase tracking-wider text-ink flex items-center gap-2">
                      <Drill size={15} className="text-accent" />
                      Tabla UNF (Rosca Fina Americana)
                    </h4>
                    <span className="font-mono text-[9px] font-bold text-ink-dim uppercase bg-surface-2 px-2 py-0.5 border border-line">
                      Automotriz / Precisión
                    </span>
                  </div>
                  <div className="max-h-96 overflow-y-auto overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Rosca UNF</TableHead>
                          <TableHead>Broca de Corte</TableHead>
                          <TableHead>Decimal</TableHead>
                          <TableHead>Roll Tap (Formado)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {UNF_TAP_DRILLS.map((entry) => (
                          <TableRow key={entry.designation}>
                            <TableCell className="font-mono font-bold text-ink whitespace-nowrap">{entry.designation}</TableCell>
                            <TableCell className="font-mono font-black text-accent whitespace-nowrap">{entry.cutTapDrillLabel}</TableCell>
                            <TableCell className="font-mono text-xs text-ink-dim whitespace-nowrap">{entry.cutTapDrillInchDecimal ? `${entry.cutTapDrillInchDecimal.toFixed(4)}"` : `${entry.cutTapDrillMm.toFixed(2)} mm`}</TableCell>
                            <TableCell className="font-mono text-xs text-ok font-bold whitespace-nowrap">{entry.rollTapDrillLabel}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </div>

              {/* Tabla NPT (Tubería Cónica) */}
              <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
                <div className="flex items-center justify-between border-b-2 border-line pb-2">
                  <h4 className="font-display font-black text-sm uppercase tracking-wider text-ink flex items-center gap-2">
                    <Compass size={15} className="text-accent" />
                    Tabla NPT (National Pipe Taper — Conexiones Neumáticas e Hidráulicas 1:16)
                  </h4>
                  <span className="font-mono text-[9px] font-bold text-accent uppercase bg-accent/10 px-2 py-0.5 border border-accent/30">
                    Sellado Hermético
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Tamaño NPT</TableHead>
                        <TableHead>Diámetro Exterior Tubo</TableHead>
                        <TableHead>Broca Previa Cilíndrica</TableHead>
                        <TableHead>Broca con Rima Cónica</TableHead>
                        <TableHead>Notas de Taller</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {NPT_TAP_DRILLS.map((entry) => (
                        <TableRow key={entry.designation}>
                          <TableCell className="font-mono font-black text-ink">{entry.designation}</TableCell>
                          <TableCell className="font-mono text-xs text-ink-dim">{entry.majorDiameterInch?.toFixed(3)}&quot; ({entry.majorDiameterMm.toFixed(2)} mm)</TableCell>
                          <TableCell className="font-mono font-black text-accent">{entry.cutTapDrillLabel}</TableCell>
                          <TableCell className="font-mono text-xs text-ok font-bold">{entry.rollTapDrillLabel}</TableCell>
                          <TableCell className="font-mono text-[11px] text-ink-dim">{entry.pipeNotes}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            </>
          )}

          {/* Tabla Métrica ISO */}
          {threadStandard === 'metric' && (
            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
              <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink border-b-2 border-line pb-2 flex items-center justify-between">
                <span>Tabla Métrica ISO (Paso Estándar Coarse)</span>
                <span className="font-mono text-[9px] text-ink-dim">Broca Corte & Formado (Roll Tap)</span>
              </h4>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rosca Métrica</TableHead>
                      <TableHead>Broca de Corte</TableHead>
                      <TableHead>Decimal en Pulgadas</TableHead>
                      <TableHead>Broca de Formado (Roll Tap)</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {METRIC_TAP_DRILLS.map((entry) => (
                      <TableRow key={entry.designation}>
                        <TableCell className="font-mono font-bold">{entry.designation}</TableCell>
                        <TableCell className="font-mono font-bold text-accent">{entry.cutTapDrillLabel}</TableCell>
                        <TableCell className="font-mono text-xs text-ink-dim">{entry.cutTapDrillInchDecimal?.toFixed(4)}&quot; ({entry.cutTapDrillFraction})</TableCell>
                        <TableCell className="font-mono text-ok font-bold">{entry.rollTapDrillLabel}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}

          {/* Reglas de Machuelado Haas */}
          <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-2 text-xs font-mono text-ink-dim">
            <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink border-b-2 border-line pb-2">
              Reglas de Machuelado CNC en Haas ST / VF (Pulgadas & G20)
            </h4>
            <p>• <strong className="text-ink">Rigid Tapping (G84):</strong> Con M29 activado en Haas, el avance debe ser exactamente igual al paso en pulgadas: <code className="text-accent font-bold">F = 1 / TPI</code> (ej. 1/2-13 UNC ➔ F0.0769 IPR). No requiere porta-machuelo flotante.</p>
            <p>• <strong className="text-ink">Machuelo Punta Espiral (Gun Tap):</strong> Empuja la viruta hacia adelante ➔ Usar en barrenos PASANTES.</p>
            <p>• <strong className="text-ink">Machuelo Canal Espiral (Spiral Flute):</strong> Extrae la viruta hacia arriba ➔ Usar en barrenos CIEGOS para evitar apelmazamiento en el fondo.</p>
            <p>• <strong className="text-ink">Machuelo de Formado (Roll Tap):</strong> Deforma el metal sin generar rebaba ➔ Requiere lubricación rica y broca previa significativamente mayor que la de corte.</p>
          </div>
        </div>
      )}

      {/* SECCIÓN 2: CALCULADORA Y CÓDIGO G76 HAAS (PULGADAS) */}
      {section === 'calculadora' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 border-2 border-line bg-surface p-5 shadow-hard space-y-4">
            <div className="flex items-center justify-between border-b-2 border-line pb-2">
              <h3 className="font-display font-black text-sm uppercase tracking-wider text-ink flex items-center gap-2">
                <Ruler size={16} className="text-accent" />
                Parámetros de Rosca ({threadStandard === 'metric' ? 'Métrico' : 'Pulgadas G20'})
              </h3>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setIsExternal(true)}
                  className={`px-2.5 py-1 text-[10px] font-mono font-black uppercase border-2 ${
                    isExternal ? 'border-accent bg-accent text-bg' : 'border-line bg-surface-2 text-ink'
                  }`}
                >
                  Exterior (OD)
                </button>
                <button
                  type="button"
                  onClick={() => setIsExternal(false)}
                  className={`px-2.5 py-1 text-[10px] font-mono font-black uppercase border-2 ${
                    !isExternal ? 'border-accent bg-accent text-bg' : 'border-line bg-surface-2 text-ink'
                  }`}
                >
                  Interior (ID)
                </button>
              </div>
            </div>

            {threadStandard !== 'metric' ? (
              <>
                <div>
                  <div className="flex justify-between text-xs font-mono mb-1">
                    <span className="font-bold">Diámetro Mayor Nominal (D)</span>
                    <span className="text-accent font-black">{majorDiameterInch.toFixed(3)}&quot; ({(majorDiameterInch * 25.4).toFixed(2)} mm)</span>
                  </div>
                  <Input
                    type="number"
                    step="0.0625"
                    value={majorDiameterInch}
                    onChange={(e) => setMajorDiameterInch(Number(e.target.value))}
                    className="h-9 font-mono font-bold border-2 border-line bg-surface-2"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {[0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1.0, 1.25, 1.5].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setMajorDiameterInch(d)}
                        className={`text-[9px] font-mono px-2 py-0.5 border ${
                          majorDiameterInch === d ? 'border-accent bg-accent text-bg font-bold' : 'bg-surface-2 border-line hover:border-accent'
                        }`}
                      >
                        {d}&quot;
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-mono mb-1">
                    <span className="font-bold">Hilos por Pulgada (TPI)</span>
                    <span className="text-accent font-black">{tpi} TPI (Avance F: {(1 / tpi).toFixed(4)}&quot;)</span>
                  </div>
                  <Input
                    type="number"
                    step="1"
                    value={tpi}
                    onChange={(e) => setTpi(Number(e.target.value))}
                    className="h-9 font-mono font-bold border-2 border-line bg-surface-2"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {[28, 24, 20, 18, 16, 14, 13, 11, 10, 8].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setTpi(val)}
                        className={`text-[9px] font-mono px-2 py-0.5 border ${
                          tpi === val ? 'border-accent bg-accent text-bg font-bold' : 'bg-surface-2 border-line hover:border-accent'
                        }`}
                      >
                        {val} TPI
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                      Z Inicio (pulgadas)
                    </label>
                    <Input
                      type="number"
                      step="0.05"
                      value={startZInch}
                      onChange={(e) => setStartZInch(Number(e.target.value))}
                      className="h-9 font-mono font-bold border-2 border-line bg-surface-2"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                      Z Final (pulgadas)
                    </label>
                    <Input
                      type="number"
                      step="0.05"
                      value={endZInch}
                      onChange={(e) => setEndZInch(Number(e.target.value))}
                      className="h-9 font-mono font-bold border-2 border-line bg-surface-2"
                    />
                  </div>
                </div>
              </>
            ) : (
              <>
                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                    Diámetro Mayor Nominal (mm)
                  </label>
                  <Input
                    type="number"
                    step="0.5"
                    value={majorDiameterMm}
                    onChange={(e) => setMajorDiameterMm(Number(e.target.value))}
                    className="h-9 font-mono font-bold border-2 border-line bg-surface-2"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                    Paso de Rosca (mm)
                  </label>
                  <Input
                    type="number"
                    step="0.25"
                    value={pitchMmCustom}
                    onChange={(e) => setPitchMmCustom(Number(e.target.value))}
                    className="h-9 font-mono font-bold border-2 border-line bg-surface-2"
                  />
                </div>
              </>
            )}

            {/* Resumen Geométrico en Pulgadas */}
            <div className="border-t-2 border-line pt-3 space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-ink-dim">Profundidad de Filete (K):</span>
                <strong className="text-accent font-black">
                  {(isExternal ? depthResult.depthExternalInch : depthResult.depthInternalInch).toFixed(4)}&quot; (
                  {(isExternal ? depthResult.depthExternalMm : depthResult.depthInternalMm).toFixed(3)} mm)
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-dim">Ángulo de Hélice (Avance):</span>
                <strong className="text-ink font-bold">{depthResult.leadAngleDegrees}°</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-dim">Pasadas Sugeridas:</span>
                <strong className="text-ink font-bold">{depthResult.suggestedPasses} pasadas</strong>
              </div>
            </div>

            {/* Tarjeta de Recomendación de Cuña / Calce (Shim) */}
            <div className="border border-line bg-surface-2 p-3 text-xs font-mono space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-accent font-black uppercase text-[10px] flex items-center gap-1">
                  <Compass size={12} /> Cuña / Calce Sugerido (Anvil)
                </span>
                <span className="bg-accent/20 text-accent font-bold px-1.5 py-0.5 text-[10px]">
                  {depthResult.shimRecommendation.shimCodeCarmexOrVardex}
                </span>
              </div>
              <p className="text-[11px] text-ink-dim leading-snug">
                {depthResult.shimRecommendation.reason}
              </p>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-4">
            {/* Bloque de Código CNC G76 Haas */}
            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
              <div className="flex flex-wrap items-center justify-between border-b-2 border-line pb-2 gap-2">
                <div className="flex items-center gap-2">
                  <Terminal size={15} className="text-accent" />
                  <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink">
                    Ciclo de Roscado G76 CNC
                  </h4>
                </div>

                <div className="flex items-center gap-2">
                  {/* Selector de formato G76 */}
                  <div className="flex items-center border border-line bg-surface-2 p-0.5 text-[10px] font-mono">
                    <button
                      type="button"
                      onClick={() => setG76Format('haas_single')}
                      className={`px-2 py-0.5 font-black uppercase transition-colors ${
                        g76Format === 'haas_single' ? 'bg-accent text-bg' : 'text-ink-dim hover:text-ink'
                      }`}
                    >
                      Haas 1-Línea
                    </button>
                    <button
                      type="button"
                      onClick={() => setG76Format('fanuc_two_line')}
                      className={`px-2 py-0.5 font-black uppercase transition-colors ${
                        g76Format === 'fanuc_two_line' ? 'bg-accent text-bg' : 'text-ink-dim hover:text-ink'
                      }`}
                    >
                      Fanuc 2-Líneas
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="px-2.5 py-1 bg-surface-2 border border-line hover:border-accent text-ink hover:text-accent font-mono text-[10px] font-bold uppercase flex items-center gap-1 transition-colors"
                  >
                    {copiedCode ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
                    <span>{copiedCode ? 'Copiado' : 'Copiar'}</span>
                  </button>
                </div>
              </div>

              <pre className="bg-[#0D131F] text-ok p-4 font-mono text-xs leading-relaxed border-2 border-line overflow-x-auto whitespace-pre-wrap">
                {g76Code}
              </pre>
            </div>

            {/* Cronograma de Pasadas con Profundidad en Pulgadas */}
            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
              <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink border-b-2 border-line pb-2 flex items-center gap-2">
                <Layers size={14} className="text-accent" />
                Cronograma de Pasadas (Volumen de Viruta Constante)
              </h4>
              <div className="max-h-48 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pasada</TableHead>
                      <TableHead>Profundidad (Pulgadas)</TableHead>
                      <TableHead>Profundidad (mm)</TableHead>
                      <TableHead>% Acumulado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {depthResult.infeedScheduleInch.map((dInch, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono font-bold">#{i + 1}</TableCell>
                        <TableCell className="font-mono font-black text-accent">{dInch.toFixed(4)}&quot;</TableCell>
                        <TableCell className="font-mono text-xs text-ink-dim">{depthResult.infeedScheduleMm[i].toFixed(3)} mm</TableCell>
                        <TableCell className="font-mono text-xs">{depthResult.infeedSchedulePercent[i]}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECCIÓN 3: DECODIFICADOR DE INSERTOS DE ROSCADO (ANSI / ISO) */}
      {section === 'decodificador' && (
        <div className="space-y-4">
          <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
              <Input
                value={insertCode}
                onChange={(e) => setInsertCode(e.target.value)}
                placeholder="ej. 3ER 14UN, 3IR AG60, 16ER 20UN, 16ER 18NPT, 3ER 10ACME, 16ER 16UNJ..."
                className="h-10 pl-10 text-sm font-mono font-bold border-2 border-line bg-surface-2 uppercase"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] font-mono font-bold text-ink-dim self-center mr-1 uppercase">Comunes de taller:</span>
              {INSERT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setInsertCode(p)}
                  className={`px-2 py-0.5 text-[10px] font-mono font-bold border ${
                    insertCode.toUpperCase().replace(/\s/g, '').includes(p.toUpperCase().replace(/\s/g, ''))
                      ? 'border-accent bg-accent text-bg'
                      : 'border-line bg-surface hover:border-accent text-ink'
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {decodedInsert ? (
            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-4">
              <div className="flex items-center justify-between border-b-2 border-line pb-3">
                <div>
                  <h3 className="font-display font-black text-xl uppercase tracking-tight text-ink">
                    {decodedInsert.rawCode}
                  </h3>
                  <span className="text-xs font-mono text-ink-dim">
                    {decodedInsert.ansiSizeCode ? `Designación ANSI: ${decodedInsert.ansiSizeCode} · ` : ''}
                    Tamaño ISO: {decodedInsert.sizeCode}
                  </span>
                </div>
                <span className="bg-accent text-bg px-2.5 py-1 font-mono text-xs font-black uppercase shadow-hard">
                  {decodedInsert.profileLabel}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs font-mono">
                <div className="border border-line bg-surface-2 p-3">
                  <span className="text-ink-dim block text-[10px] uppercase font-bold">Tipo de Rosca:</span>
                  <strong className="text-ink text-sm font-black">
                    {decodedInsert.side === 'external' ? 'Exterior (ER)' : 'Interior (IR)'} · {decodedInsert.hand === 'right' ? 'Derecha (RH)' : 'Izquierda (LH)'}
                  </strong>
                </div>

                <div className="border border-line bg-surface-2 p-3">
                  <span className="text-ink-dim block text-[10px] uppercase font-bold">Círculo Inscrito (I.C.):</span>
                  <strong className="text-accent text-sm font-black">
                    {decodedInsert.inscribedCircleInch ?? `Tamaño ${decodedInsert.sizeCode}`}
                  </strong>
                </div>

                <div className="border border-line bg-surface-2 p-3">
                  <span className="text-ink-dim block text-[10px] uppercase font-bold">Barreno o Barra Mínima:</span>
                  <strong className="text-ink text-sm font-black">
                    {decodedInsert.minBarOrHoleInch ? `≥ Ø ${decodedInsert.minBarOrHoleInch}` : `≥ Ø ${decodedInsert.minBarOrHoleMm} mm`}
                  </strong>
                </div>

                <div className="border border-line bg-surface-2 p-3">
                  <span className="text-ink-dim block text-[10px] uppercase font-bold">Paso / TPI Cubierto:</span>
                  <strong className="text-ok text-sm font-black">
                    {decodedInsert.tpi
                      ? `${decodedInsert.tpi} TPI (Perfil Completo)`
                      : decodedInsert.tpiRange
                        ? `${decodedInsert.tpiRange} (Perfil Parcial)`
                        : decodedInsert.pitchMm
                          ? `${decodedInsert.pitchMm} mm paso`
                          : decodedInsert.profileLabel}
                  </strong>
                </div>
              </div>

              <div className="bg-surface-2 border border-line p-3 text-xs font-mono space-y-1">
                <p className="text-ink font-bold">
                  ℹ️ {decodedInsert.fullProfileNote}
                </p>
                <div className="flex items-center gap-2 pt-1 text-ink-dim">
                  <Wrench size={14} className="text-accent shrink-0" />
                  <span>Portaherramienta Sugerido: <strong className="text-ink">{decodedInsert.holderSuggestion}</strong></span>
                </div>
              </div>
            </div>
          ) : (
            <div className="border-2 border-line bg-surface p-12 text-center text-xs font-mono text-ink-dim space-y-2">
              <p className="font-bold text-ink">Código no reconocido como inserto de rosca.</p>
              <p>Formato esperado: [Tamaño 1 o 2 dígitos][E/I][R/L][Paso o TPI][Familia]</p>
              <p className="text-ink-dim/80">
                Ejemplos válidos en pulgadas: <strong className="text-accent">3ER 14UN</strong>, <strong className="text-accent">3IR AG60</strong>, <strong className="text-accent">16ER 18NPT</strong>, <strong className="text-accent">3ER 10ACME</strong>, <strong className="text-accent">16ER 1.5 ISO</strong>.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

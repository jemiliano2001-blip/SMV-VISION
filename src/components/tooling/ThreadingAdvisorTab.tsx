import { useMemo, useState, type ReactElement } from 'react';
import {
  Search,
  Wrench,
  Drill,
  Ruler,
  Terminal,
} from 'lucide-react';
import { decodeThreadInsertCode } from '../../lib/tooling/threadInsertDecoder';
import { calculateThreadDepths, generateHaasG76Block, pitchFromTpi } from '../../lib/tooling/threadingCalculator';
import { METRIC_TAP_DRILLS, UNC_TAP_DRILLS, UNF_TAP_DRILLS } from '../../lib/tooling/tapDrillChart';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

const INSERT_PRESETS = ['16ER 20UN', '16ER 14UN', '16ER 1.5 ISO', '16IR AG60', '11ER 1.25 ISO', '22ER 2.0 ISO'];

type ThreadingSection = 'decodificador' | 'calculadora' | 'machuelos';
type ThreadStandard = 'unc_unf' | 'metric';

export function ThreadingAdvisorTab(): ReactElement {
  const [section, setSection] = useState<ThreadingSection>('machuelos'); // Default to Machuelos / Hilos comunes
  const [threadStandard, setThreadStandard] = useState<ThreadStandard>('unc_unf');

  // ── Decodificador de insertos ──
  const [insertCode, setInsertCode] = useState('16ER 20UN');
  const decodedInsert = decodeThreadInsertCode(insertCode);

  // ── Calculadora CNC G76 ──
  const [isExternal, setIsExternal] = useState(true);
  const [majorDiameterInch, setMajorDiameterInch] = useState<number>(0.75); // 3/4"
  const [tpi, setTpi] = useState<number>(10); // 10 TPI (3/4-10 UNC)
  const [majorDiameterMm, setMajorDiameterMm] = useState<number>(20);
  const [pitchMmCustom, setPitchMmCustom] = useState<number>(1.5);
  const [startZ, setStartZ] = useState<number>(0.1);
  const [endZ, setEndZ] = useState<number>(-1.0);

  const effectiveMajorMm = threadStandard === 'unc_unf' ? majorDiameterInch * 25.4 : majorDiameterMm;
  const effectivePitchMm = threadStandard === 'unc_unf' ? pitchFromTpi(tpi) : pitchMmCustom;

  const depthResult = useMemo(
    () => calculateThreadDepths({ pitchMm: effectivePitchMm, majorDiameterMm: effectiveMajorMm }),
    [effectivePitchMm, effectiveMajorMm]
  );

  const g76Code = useMemo(() => {
    const depthMm = isExternal ? depthResult.depthExternalMm : depthResult.depthInternalMm;
    const startZMm = threadStandard === 'unc_unf' ? startZ * 25.4 : startZ;
    const endZMm = threadStandard === 'unc_unf' ? endZ * 25.4 : endZ;

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
      firstPassDepthMm: depthResult.infeedScheduleMm[0] ?? 0.1,
      startZMm,
      endZMm,
    });
  }, [isExternal, effectiveMajorMm, effectivePitchMm, depthResult, startZ, endZ, threadStandard]);

  return (
    <div className="space-y-6">
      {/* Sub-navegación interna */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-2 border-line bg-surface p-2 shadow-hard">
        <div className="flex flex-wrap items-center gap-1.5">
          {([
            { id: 'machuelos' as const, label: '1. Tablas de Machuelos & Brocas (UNC/UNF)', icon: Drill },
            { id: 'calculadora' as const, label: '2. Calculadora & Ciclo G76 Haas', icon: Terminal },
            { id: 'decodificador' as const, label: '3. Decodificador de Insertos de Rosca', icon: Search },
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
            onClick={() => setThreadStandard('metric')}
            className={`px-2 py-0.5 text-[10px] font-bold uppercase transition-colors ${
              threadStandard === 'metric' ? 'bg-accent text-bg' : 'text-ink-dim hover:text-ink'
            }`}
          >
            Métrico (ISO)
          </button>
        </div>
      </div>

      {/* SECCIÓN 1: MACHUELOS Y BROCAS PREVIAS (UNC / UNF / MÉTRICO) */}
      {section === 'machuelos' && (
        <div className="space-y-6">
          {/* Tablas Americanas UNC y UNF Primero (Pulgadas) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
              <div className="flex items-center justify-between border-b-2 border-line pb-2">
                <h4 className="font-display font-black text-sm uppercase tracking-wider text-ink flex items-center gap-2">
                  <Drill size={15} className="text-accent" />
                  Tabla UNC (Rosca Gruesa Estándar Americana)
                </h4>
                <span className="font-mono text-[9px] font-bold text-accent uppercase bg-accent/10 px-2 py-0.5 border border-accent/30">
                  Taller Principal
                </span>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rosca UNC</TableHead>
                      <TableHead>Broca de Corte (75%)</TableHead>
                      <TableHead>Decimal / mm</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {UNC_TAP_DRILLS.map((entry) => (
                      <TableRow key={entry.designation}>
                        <TableCell className="font-mono font-bold text-ink">{entry.designation}</TableCell>
                        <TableCell className="font-mono font-black text-accent">{entry.cutTapDrillLabel}</TableCell>
                        <TableCell className="font-mono text-xs text-ink-dim">{entry.cutTapDrillMm.toFixed(2)} mm</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
              <div className="flex items-center justify-between border-b-2 border-line pb-2">
                <h4 className="font-display font-black text-sm uppercase tracking-wider text-ink flex items-center gap-2">
                  <Drill size={15} className="text-accent" />
                  Tabla UNF (Rosca Fina Americana)
                </h4>
                <span className="font-mono text-[9px] font-bold text-ink-dim uppercase bg-surface-2 px-2 py-0.5 border border-line">
                  Fina / Automotriz
                </span>
              </div>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rosca UNF</TableHead>
                      <TableHead>Broca de Corte (75%)</TableHead>
                      <TableHead>Decimal / mm</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {UNF_TAP_DRILLS.map((entry) => (
                      <TableRow key={entry.designation}>
                        <TableCell className="font-mono font-bold text-ink">{entry.designation}</TableCell>
                        <TableCell className="font-mono font-black text-accent">{entry.cutTapDrillLabel}</TableCell>
                        <TableCell className="font-mono text-xs text-ink-dim">{entry.cutTapDrillMm.toFixed(2)} mm</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          {/* Tabla Métrica */}
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
                    <TableHead>Broca de Formado (Roll Tap)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {METRIC_TAP_DRILLS.map((entry) => (
                    <TableRow key={entry.designation}>
                      <TableCell className="font-mono font-bold">{entry.designation}</TableCell>
                      <TableCell className="font-mono font-bold text-accent">{entry.cutTapDrillLabel}</TableCell>
                      <TableCell className="font-mono text-ok font-bold">{entry.rollTapDrillLabel}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          {/* Notas de Machuelado en Haas */}
          <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-2 text-xs font-mono text-ink-dim">
            <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink border-b-2 border-line pb-2">
              Reglas de Machuelado CNC en Haas ST / VF
            </h4>
            <p>• <strong className="text-ink">Rigid Tapping (G84):</strong> Con M29 activado en Haas, el avance debe sincronizarse con el paso (F = paso en pulgadas o mm). No se necesita porta-machuelo flotante.</p>
            <p>• <strong className="text-ink">Machuelo Punta Espiral (Gun Tap / Spiral Point):</strong> Empuja la viruta hacia adelante — usar en barrenos PASANTES.</p>
            <p>• <strong className="text-ink">Machuelo Canal Espiral (Spiral Flute):</strong> Extrae la viruta hacia arriba — usar en barrenos CIEGOS para no acumular rebaba al fondo.</p>
            <p>• <strong className="text-ink">Machuelo de Formado (Roll Tap):</strong> Sin viruta (deforma el metal). Requiere lubricación rica y broca de barreno mayor que el de corte.</p>
          </div>
        </div>
      )}

      {/* SECCIÓN 2: CALCULADORA Y CÓDIGO G76 HAAS */}
      {section === 'calculadora' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 border-2 border-line bg-surface p-5 shadow-hard space-y-4">
            <h3 className="font-display font-black text-sm uppercase tracking-wider text-ink border-b-2 border-line pb-2 flex items-center gap-2">
              <Ruler size={16} className="text-accent" /> Parámetros de Rosca ({threadStandard === 'unc_unf' ? 'Pulgadas' : 'Métrico'})
            </h3>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsExternal(true)}
                className={`flex-1 px-3 py-2 text-xs font-mono font-black uppercase border-2 ${
                  isExternal ? 'border-accent bg-accent text-bg' : 'border-line bg-surface-2 text-ink'
                }`}
              >
                Exterior (OD)
              </button>
              <button
                type="button"
                onClick={() => setIsExternal(false)}
                className={`flex-1 px-3 py-2 text-xs font-mono font-black uppercase border-2 ${
                  !isExternal ? 'border-accent bg-accent text-bg' : 'border-line bg-surface-2 text-ink'
                }`}
              >
                Interior (ID)
              </button>
            </div>

            {threadStandard === 'unc_unf' ? (
              <>
                <div>
                  <div className="flex justify-between text-xs font-mono mb-1">
                    <span className="font-bold">Diámetro Mayor Nominal (D)</span>
                    <span className="text-accent font-bold">{majorDiameterInch.toFixed(3)}&quot; ({(majorDiameterInch * 25.4).toFixed(2)} mm)</span>
                  </div>
                  <Input
                    type="number"
                    step="0.0625"
                    value={majorDiameterInch}
                    onChange={(e) => setMajorDiameterInch(Number(e.target.value))}
                    className="h-9 font-mono font-bold border-2 border-line bg-surface-2"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {[0.25, 0.375, 0.5, 0.625, 0.75, 1.0].map((d) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setMajorDiameterInch(d)}
                        className="text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
                      >
                        {d}&quot;
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="flex justify-between text-xs font-mono mb-1">
                    <span className="font-bold">Hilos por Pulgada (TPI)</span>
                    <span className="text-accent font-bold">{tpi} TPI (Paso: {(25.4 / tpi).toFixed(3)} mm)</span>
                  </div>
                  <Input
                    type="number"
                    step="1"
                    value={tpi}
                    onChange={(e) => setTpi(Number(e.target.value))}
                    className="h-9 font-mono font-bold border-2 border-line bg-surface-2"
                  />
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {[20, 18, 16, 14, 13, 11, 10, 8].map((val) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setTpi(val)}
                        className="text-[9px] font-mono px-2 py-0.5 bg-surface-2 border border-line hover:border-accent"
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
                      value={startZ}
                      onChange={(e) => setStartZ(Number(e.target.value))}
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
                      value={endZ}
                      onChange={(e) => setEndZ(Number(e.target.value))}
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

            <div className="border-t-2 border-line pt-3 space-y-2 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-ink-dim">Profundidad {isExternal ? 'Exterior' : 'Interior'}:</span>
                <strong className="text-accent">
                  {(isExternal ? depthResult.depthExternalMm / 25.4 : depthResult.depthInternalMm / 25.4).toFixed(4)}&quot; (
                  {(isExternal ? depthResult.depthExternalMm : depthResult.depthInternalMm).toFixed(3)} mm)
                </strong>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-dim">Ángulo de Hélice:</span>
                <strong className="text-ink">{depthResult.leadAngleDegrees}°</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-dim">Pasadas Sugeridas:</span>
                <strong className="text-ink">{depthResult.suggestedPasses} pasadas</strong>
              </div>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-4">
            {/* Bloque de Código CNC G76 Haas */}
            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
              <div className="flex items-center justify-between border-b-2 border-line pb-2">
                <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink flex items-center gap-2">
                  <Terminal size={14} className="text-accent" /> Bloque de Código CNC G76 Haas ST
                </h4>
                <span className="font-mono text-[9px] font-bold text-accent uppercase">
                  Listo para Control Haas
                </span>
              </div>
              <pre className="bg-[#0D131F] text-ok p-4 font-mono text-xs leading-relaxed border-2 border-line overflow-x-auto whitespace-pre-wrap">
                {g76Code}
              </pre>
            </div>

            {/* Cronograma de Pasadas */}
            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
              <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink border-b-2 border-line pb-2 flex items-center gap-2">
                <Terminal size={14} className="text-accent" /> Cronograma de Pasadas (Volumen de Viruta Constante)
              </h4>
              <div className="max-h-48 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pasada</TableHead>
                      <TableHead>Profundidad (Pulgadas)</TableHead>
                      <TableHead>Profundidad (mm)</TableHead>
                      <TableHead>% del Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {depthResult.infeedScheduleMm.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono font-bold">#{i + 1}</TableCell>
                        <TableCell className="font-mono font-black text-accent">
                          {(d / 25.4).toFixed(4)}&quot;
                        </TableCell>
                        <TableCell className="font-mono text-xs text-ink-dim">{d.toFixed(3)} mm</TableCell>
                        <TableCell className="font-mono text-xs">
                          {depthResult.infeedSchedulePercent[i]}%
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECCIÓN 3: DECODIFICADOR DE INSERTOS DE ROSCADO */}
      {section === 'decodificador' && (
        <div className="space-y-4">
          <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
              <Input
                value={insertCode}
                onChange={(e) => setInsertCode(e.target.value)}
                placeholder="ej. 16ER 20UN, 16ER 14UN, 16IR AG60, 16ER 1.5 ISO"
                className="h-10 pl-10 text-sm font-mono font-bold border-2 border-line bg-surface-2 uppercase"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <span className="text-[10px] font-mono text-ink-dim self-center mr-1">Ejemplos comunes:</span>
              {INSERT_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setInsertCode(p)}
                  className="px-2 py-0.5 text-[10px] font-mono font-bold border border-line bg-surface hover:border-accent"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {decodedInsert ? (
            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-4">
              <div className="flex items-center justify-between border-b-2 border-line pb-3">
                <h3 className="font-display font-black text-lg uppercase tracking-tight text-ink">
                  {decodedInsert.rawCode}
                </h3>
                <span className="bg-accent text-bg px-2 py-0.5 font-mono text-xs font-bold uppercase">
                  {decodedInsert.profileLabel}
                </span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs font-mono">
                <div className="border border-line bg-surface-2 p-3">
                  <span className="text-ink-dim block text-[10px]">TIPO DE ROSCADO:</span>
                  <strong className="text-ink text-sm">
                    {decodedInsert.side === 'external' ? 'Exterior (ER)' : 'Interior (IR)'} · {decodedInsert.hand === 'right' ? 'Derecho (RH)' : 'Izquierdo (LH)'}
                  </strong>
                </div>
                <div className="border border-line bg-surface-2 p-3">
                  <span className="text-ink-dim block text-[10px]">TAMAÑO DE INSERTO:</span>
                  <strong className="text-ink text-sm">
                    Tamaño {decodedInsert.sizeCode} ({decodedInsert.sizeLabel.split('—')[0].trim()})
                  </strong>
                </div>
                <div className="border border-line bg-surface-2 p-3">
                  <span className="text-ink-dim block text-[10px]">PERFIL / PASO / TPI:</span>
                  <strong className="text-accent text-sm">
                    {decodedInsert.tpi
                      ? `${decodedInsert.tpi} TPI (Pulgadas)`
                      : decodedInsert.pitchMm
                        ? `${decodedInsert.pitchMm} mm paso`
                        : decodedInsert.profileLabel}
                  </strong>
                </div>
              </div>
              <div className="bg-surface-2 border border-line p-3 text-xs font-mono flex items-center gap-2">
                <Wrench size={14} className="text-accent shrink-0" />
                <span>Portaherramienta Sugerido: <strong className="text-ink">{decodedInsert.holderSuggestion}</strong></span>
              </div>
            </div>
          ) : (
            <div className="border-2 border-line bg-surface p-12 text-center text-xs font-mono text-ink-dim space-y-2">
              <p>Código no reconocido como inserto de rosca.</p>
              <p>Formato esperado: [Tamaño][E/I][R/L][Paso o TPI][Familia] — ej. 16ER 20UN, 16ER 14UN, 16ER 1.5 ISO.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

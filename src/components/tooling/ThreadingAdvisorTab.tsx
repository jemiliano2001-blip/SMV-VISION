import { useMemo, useState, type ReactElement } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Search,
  Wrench,
  Drill,
  Ruler,
  Terminal,
} from 'lucide-react';
import { decodeThreadInsertCode } from '../../lib/tooling/threadInsertDecoder';
import { calculateThreadDepths, generateHaasG76Block } from '../../lib/tooling/threadingCalculator';
import { METRIC_TAP_DRILLS, UNC_TAP_DRILLS, UNF_TAP_DRILLS, estimateMetricCutTapDrillMm, estimateMetricRollTapDrillMm } from '../../lib/tooling/tapDrillChart';
import { Input } from '../ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

const INSERT_PRESETS = ['16ER 1.5 ISO', '16IR AG60', '11ER 1.25 ISO', '22ER 2.0 ISO', '16ER 20UN'];

type ThreadingSection = 'decodificador' | 'calculadora' | 'machuelos';

export function ThreadingAdvisorTab(): ReactElement {
  const [section, setSection] = useState<ThreadingSection>('decodificador');

  // ── Decodificador de insertos ──
  const [insertCode, setInsertCode] = useState('16ER 1.5 ISO');
  const decodedInsert = decodeThreadInsertCode(insertCode);

  // ── Calculadora ──
  const [isExternal, setIsExternal] = useState(true);
  const [majorDiameterMm, setMajorDiameterMm] = useState<number>(20);
  const [pitchMm, setPitchMm] = useState<number>(1.5);
  const [startZMm, setStartZMm] = useState<number>(2);
  const [endZMm, setEndZMm] = useState<number>(-20);

  const depthResult = useMemo(
    () => calculateThreadDepths({ pitchMm, majorDiameterMm }),
    [pitchMm, majorDiameterMm]
  );

  const g76Block = useMemo(() => {
    const depthMm = isExternal ? depthResult.depthExternalMm : depthResult.depthInternalMm;
    return generateHaasG76Block({
      isExternal,
      majorDiameterMm,
      pitchMm,
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
  }, [isExternal, majorDiameterMm, pitchMm, depthResult, startZMm, endZMm]);

  // ── Machuelos ──
  const [customMajor, setCustomMajor] = useState<number>(6);
  const [customPitch, setCustomPitch] = useState<number>(1.0);
  const customCutDrill = estimateMetricCutTapDrillMm(customMajor, customPitch);
  const customRollDrill = estimateMetricRollTapDrillMm(customMajor, customPitch);

  return (
    <div className="space-y-6">
      {/* Sub-navegación interna */}
      <div className="flex flex-wrap items-center gap-1.5 border-2 border-line bg-surface p-2 shadow-hard">
        {([
          { id: 'decodificador' as const, label: 'Decodificador de Inserto', icon: Search },
          { id: 'calculadora' as const, label: 'Calculadora & G76 Haas', icon: Terminal },
          { id: 'machuelos' as const, label: 'Machuelos & Broca Previa', icon: Drill },
        ]).map((tab) => {
          const Icon = tab.icon;
          const isActive = section === tab.id;
          return (
            <button
              key={tab.id}
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

      {section === 'decodificador' && (
        <div className="space-y-4">
          <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
              <Input
                value={insertCode}
                onChange={(e) => setInsertCode(e.target.value)}
                placeholder="ej. 16ER 1.5 ISO, 16IR AG60, 11ER 20UN"
                className="h-10 pl-10 text-sm font-mono font-bold border-2 border-line bg-surface-2 uppercase"
              />
            </div>
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-line/60">
              <span className="text-[10px] font-mono font-bold uppercase text-ink-dim mr-1">Ejemplos:</span>
              {INSERT_PRESETS.map((code) => (
                <button
                  key={code}
                  onClick={() => setInsertCode(code)}
                  className="text-[10px] font-mono font-bold px-2 py-0.5 border border-line bg-surface-2 text-ink hover:border-accent transition-all"
                >
                  {code}
                </button>
              ))}
            </div>
          </div>

          {decodedInsert ? (
            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
                <div className="bg-surface-2 border border-line p-3">
                  <span className="text-ink-dim">Lado / Mano:</span>{' '}
                  <strong className="text-ink">{decodedInsert.side === 'external' ? 'Exterior' : 'Interior'} — {decodedInsert.hand === 'right' ? 'Derecha (R)' : 'Izquierda (L)'}</strong>
                </div>
                <div className="bg-surface-2 border border-line p-3">
                  <span className="text-ink-dim">Tamaño de Inserto:</span>{' '}
                  <strong className="text-ink">{decodedInsert.sizeLabel}</strong>
                </div>
                <div className="bg-surface-2 border border-line p-3 sm:col-span-2">
                  <span className="text-ink-dim">Perfil:</span>{' '}
                  <strong className="text-ink">{decodedInsert.profileLabel}</strong>
                  {decodedInsert.isFullProfile ? (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-ok/20 text-ok font-black uppercase">Perfil Completo</span>
                  ) : (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 bg-warn/20 text-warn font-black uppercase">Perfil Parcial</span>
                  )}
                </div>
                {decodedInsert.isFullProfile && (
                  <div className="bg-surface-2 border border-line p-3 sm:col-span-2">
                    <span className="text-ink-dim">Paso / TPI:</span>{' '}
                    <strong className="text-accent">
                      {decodedInsert.pitchMm ? `${decodedInsert.pitchMm} mm` : `${decodedInsert.tpi} TPI (${(25.4 / (decodedInsert.tpi ?? 1)).toFixed(3)} mm)`}
                    </strong>
                  </div>
                )}
              </div>

              <div className="border-t-2 border-line pt-3 text-xs font-mono text-ink-dim">
                {decodedInsert.fullProfileNote}
              </div>

              <div className="flex items-center gap-2 border border-line bg-surface-2 p-3 text-xs font-mono">
                <Wrench size={14} className="text-accent shrink-0" />
                <span className="text-ink font-bold">{decodedInsert.holderSuggestion}</span>
              </div>
            </div>
          ) : (
            <div className="border-2 border-line bg-surface p-12 text-center text-xs font-mono text-ink-dim space-y-2">
              <p>Código no reconocido como inserto de rosca.</p>
              <p>Formato esperado: [Tamaño][E/I][R/L][Paso o TPI][Familia] — ej. 16ER1.5ISO, 16IR AG60, 11ER20UN.</p>
              <p className="text-ink-dim/70">¿Es un inserto de torneado/fresado (CNMG, WNMG, APKT)? Usa la pestaña Decodificador ISO.</p>
            </div>
          )}
        </div>
      )}

      {section === 'calculadora' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-5 border-2 border-line bg-surface p-5 shadow-hard space-y-4">
            <h3 className="font-display font-black text-sm uppercase tracking-wider text-ink border-b-2 border-line pb-2 flex items-center gap-2">
              <Ruler size={16} className="text-accent" /> Parámetros de Rosca
            </h3>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsExternal(true)}
                className={`flex-1 px-3 py-2 text-xs font-mono font-black uppercase border-2 ${isExternal ? 'border-accent bg-accent text-bg' : 'border-line bg-surface-2 text-ink'}`}
              >
                Exterior
              </button>
              <button
                onClick={() => setIsExternal(false)}
                className={`flex-1 px-3 py-2 text-xs font-mono font-black uppercase border-2 ${!isExternal ? 'border-accent bg-accent text-bg' : 'border-line bg-surface-2 text-ink'}`}
              >
                Interior
              </button>
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                Diámetro Mayor Nominal (mm)
              </label>
              <Input type="number" step="0.01" value={majorDiameterMm} onChange={(e) => setMajorDiameterMm(Number(e.target.value))} className="h-9 font-mono font-bold border-2 border-line bg-surface-2" />
            </div>

            <div>
              <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">
                Paso (mm)
              </label>
              <Input type="number" step="0.05" value={pitchMm} onChange={(e) => setPitchMm(Number(e.target.value))} className="h-9 font-mono font-bold border-2 border-line bg-surface-2" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Z Inicio</label>
                <Input type="number" step="0.5" value={startZMm} onChange={(e) => setStartZMm(Number(e.target.value))} className="h-9 font-mono font-bold border-2 border-line bg-surface-2" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Z Final</label>
                <Input type="number" step="0.5" value={endZMm} onChange={(e) => setEndZMm(Number(e.target.value))} className="h-9 font-mono font-bold border-2 border-line bg-surface-2" />
              </div>
            </div>

            <div className="border-t-2 border-line pt-3 space-y-2 text-xs font-mono">
              <div className="flex justify-between"><span className="text-ink-dim">Profundidad {isExternal ? 'Exterior' : 'Interior'}:</span><strong className="text-accent">{(isExternal ? depthResult.depthExternalMm : depthResult.depthInternalMm).toFixed(3)} mm (radio)</strong></div>
              <div className="flex justify-between"><span className="text-ink-dim">Ángulo de Hélice:</span><strong className="text-ink">{depthResult.leadAngleDegrees}°</strong></div>
              <div className="flex justify-between"><span className="text-ink-dim">Pasadas Sugeridas:</span><strong className="text-ink">{depthResult.suggestedPasses}</strong></div>
              <div className="flex justify-between"><span className="text-ink-dim">Método de Infeed:</span><strong className="text-ink">{depthResult.infeedMethod === 'radial' ? 'Radial' : depthResult.infeedMethod === 'flanco_modificado_29_30' ? 'Flanco Modificado' : 'Alternado'}</strong></div>
            </div>
          </div>

          <div className="lg:col-span-7 space-y-4">
            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-2">
              {depthResult.warnings.map((w, i) => (
                <div key={i} className="flex items-start gap-2 border border-danger/50 bg-danger/10 p-2.5 text-xs font-mono text-ink">
                  <AlertTriangle size={14} className="text-danger shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
              {depthResult.tips.map((t, i) => (
                <div key={i} className="flex items-start gap-2 border border-accent/40 bg-accent/10 p-2.5 text-xs font-mono text-ink">
                  <CheckCircle2 size={14} className="text-accent shrink-0 mt-0.5" />
                  <span>{t}</span>
                </div>
              ))}
            </div>

            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
              <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink border-b-2 border-line pb-2 flex items-center gap-2">
                <Terminal size={14} className="text-accent" /> Cronograma de Pasadas (Volumen de Viruta Constante)
              </h4>
              <div className="max-h-40 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Pasada</TableHead>
                      <TableHead>Profundidad Acum. (mm)</TableHead>
                      <TableHead>% del Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {depthResult.infeedScheduleMm.map((d, i) => (
                      <TableRow key={i}>
                        <TableCell className="font-mono">{i + 1}</TableCell>
                        <TableCell className="font-mono">{d.toFixed(4)}</TableCell>
                        <TableCell className="font-mono">{depthResult.infeedSchedulePercent[i]}%</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-2">
              <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink border-b-2 border-line pb-2 flex items-center gap-2">
                <Terminal size={14} className="text-accent" /> Bloque G76 (Haas / Fanuc) — Referencia
              </h4>
              <pre className="bg-surface-2 border border-line p-3 text-[11px] font-mono text-ink whitespace-pre-wrap overflow-x-auto">{g76Block}</pre>
              <div className="flex items-start gap-2 border border-warn/50 bg-warn/10 p-2.5 text-[11px] font-mono text-ink-dim">
                <AlertTriangle size={13} className="text-warn shrink-0 mt-0.5" />
                <span>Siempre verifica en el simulador gráfico de la máquina antes de correr. La representación exacta de P/Q/R puede variar entre versiones del control Haas — confirma unidades (mm vs. micras) en tu máquina.</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {section === 'machuelos' && (
        <div className="space-y-6">
          <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
            <h3 className="font-display font-black text-sm uppercase tracking-wider text-ink border-b-2 border-line pb-2 flex items-center gap-2">
              <Drill size={16} className="text-accent" /> Broca Previa para Cualquier Rosca Métrica
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Diámetro Mayor (mm)</label>
                <Input type="number" step="0.1" value={customMajor} onChange={(e) => setCustomMajor(Number(e.target.value))} className="h-9 font-mono font-bold border-2 border-line bg-surface-2" />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1">Paso (mm)</label>
                <Input type="number" step="0.05" value={customPitch} onChange={(e) => setCustomPitch(Number(e.target.value))} className="h-9 font-mono font-bold border-2 border-line bg-surface-2" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="bg-surface-2 border border-line p-3 text-xs font-mono">
                <span className="text-ink-dim block">Machuelo de Corte (75% engrane):</span>
                <strong className="text-accent text-base">{customCutDrill} mm</strong>
              </div>
              <div className="bg-surface-2 border border-line p-3 text-xs font-mono">
                <span className="text-ink-dim block">Machuelo de Formado (roll tap):</span>
                <strong className="text-ok text-base">{customRollDrill} mm</strong>
              </div>
            </div>
            <div className="flex items-start gap-2 border border-warn/50 bg-warn/10 p-2.5 text-[11px] font-mono text-ink-dim">
              <AlertTriangle size={13} className="text-warn shrink-0 mt-0.5" />
              <span>El machuelo de formado (roll tap) SIEMPRE necesita broca más grande que el de corte — no forma la rosca correctamente con la broca de corte y se rompe. Los roll taps varían más entre fabricantes: confirma con la ficha técnica antes de producción.</span>
            </div>
          </div>

          <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
            <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink border-b-2 border-line pb-2">Tabla Métrica (Coarse / Paso Estándar)</h4>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Rosca</TableHead>
                    <TableHead>Broca de Corte</TableHead>
                    <TableHead>Broca de Formado (Roll Tap)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {METRIC_TAP_DRILLS.map((entry) => (
                    <TableRow key={entry.designation}>
                      <TableCell className="font-mono font-bold">{entry.designation}</TableCell>
                      <TableCell className="font-mono">{entry.cutTapDrillLabel}</TableCell>
                      <TableCell className="font-mono">{entry.rollTapDrillLabel}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
              <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink border-b-2 border-line pb-2">Tabla UNC (Rosca Gruesa)</h4>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rosca</TableHead>
                      <TableHead>Broca de Corte</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {UNC_TAP_DRILLS.map((entry) => (
                      <TableRow key={entry.designation}>
                        <TableCell className="font-mono font-bold">{entry.designation}</TableCell>
                        <TableCell className="font-mono">{entry.cutTapDrillLabel}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-3">
              <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink border-b-2 border-line pb-2">Tabla UNF (Rosca Fina)</h4>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rosca</TableHead>
                      <TableHead>Broca de Corte</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {UNF_TAP_DRILLS.map((entry) => (
                      <TableRow key={entry.designation}>
                        <TableCell className="font-mono font-bold">{entry.designation}</TableCell>
                        <TableCell className="font-mono">{entry.cutTapDrillLabel}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>

          <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-2 text-xs font-mono text-ink-dim">
            <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink border-b-2 border-line pb-2">Notas de Machuelado en Haas</h4>
            <p>• <strong className="text-ink">Rigid Tapping (G84):</strong> con M29 activado, el avance debe ser exactamente igual al paso (F = paso en mm/rev). No se necesita porta-machuelo flotante.</p>
            <p>• <strong className="text-ink">Punta espiral (gun tap):</strong> empuja la viruta hacia adelante — úsalo en barrenos PASANTES.</p>
            <p>• <strong className="text-ink">Canal espiral (spiral flute):</strong> saca la viruta hacia atrás — úsalo en barrenos CIEGOS.</p>
            <p>• <strong className="text-ink">Machuelo roto o material muy duro:</strong> considera una fresa de roscar (thread mill) por interpolación helicoidal — una sola herramienta sirve para varios diámetros del mismo paso.</p>
          </div>
        </div>
      )}
    </div>
  );
}

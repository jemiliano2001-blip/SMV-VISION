import { useState, useEffect, useCallback, type ReactElement } from 'react';
import {
  FileText,
  Sparkles,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Wrench,
  Search,
  Upload,
  Cpu,
  Layers,
  ChevronRight,
  ShoppingCart,
} from 'lucide-react';
import type { ToolcribActiveDrawingView } from '../../types';
import type { ToolingPurchaseItem, BlueprintToolingPackage } from '../../lib/tooling/types';
import { listActiveDrawingViews } from '../../lib/firebase/toolcrib';
import { listToolingPurchases } from '../../lib/firebase/toolingPurchases';
import {
  generateToolingPackageFromMetadata,
  analyzeBlueprintWithAI,
} from '../../lib/tooling/blueprintToolingAdvisor';
import { Input } from '../ui/input';

export function BlueprintAdvisorTab(): ReactElement {
  const [drawings, setDrawings] = useState<ToolcribActiveDrawingView[]>([]);
  const [vaultItems, setVaultItems] = useState<ToolingPurchaseItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedDrawing, setSelectedDrawing] = useState<ToolcribActiveDrawingView | null>(null);
  const [analyzingAi, setAnalyzingAi] = useState(false);
  const [toolingPackage, setToolingPackage] = useState<BlueprintToolingPackage | null>(null);

  // Cargar catálogo de planos y bóveda de compras
  const loadData = useCallback(async () => {
    setLoading(true);
    const [drawingsRes, vaultRes] = await Promise.all([
      listActiveDrawingViews(),
      listToolingPurchases(),
    ]);

    if (drawingsRes.ok) {
      setDrawings(drawingsRes.value);
      if (drawingsRes.value.length > 0) {
        const first = drawingsRes.value[0];
        setSelectedDrawing(first);
        const pkg = generateToolingPackageFromMetadata({
          blueprintName: `${first.partNumber} - ${first.description}`,
          material: first.description,
          existingVaultItems: vaultRes.ok ? vaultRes.value : [],
        });
        setToolingPackage(pkg);
      }
    }
    if (vaultRes.ok) {
      setVaultItems(vaultRes.value);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSelectDrawing = (d: ToolcribActiveDrawingView) => {
    setSelectedDrawing(d);
    const pkg = generateToolingPackageFromMetadata({
      blueprintName: `${d.partNumber} · Rev ${d.revision}`,
      material: d.description,
      description: d.description,
      existingVaultItems: vaultItems,
    });
    setToolingPackage(pkg);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalyzingAi(true);

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        const aiMetadata = await analyzeBlueprintWithAI(dataUrl);
        const pkg = generateToolingPackageFromMetadata({
          ...aiMetadata,
          existingVaultItems: vaultItems,
        });
        setSelectedDrawing({
          partId: 'custom-upload',
          partNumber: aiMetadata.blueprintName,
          customer: 'Plano Subido',
          description: aiMetadata.material || '',
          drawingId: 'custom-drawing',
          revision: 'A',
          sourceType: 'storage',
          sourcePath: file.name,
          pdfUrl: dataUrl,
          stlUrl: null,
          effectiveFromUTC: null,
        });
        setToolingPackage(pkg);
      } catch (err) {
        console.error('Error al analizar plano con IA:', err);
      } finally {
        setAnalyzingAi(false);
      }
    };
    reader.readAsDataURL(file);
  };

  const filteredDrawings = drawings.filter(
    (d) =>
      d.partNumber.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.customer.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Encabezado y Selector de Planos */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* LISTA DE PLANOS DEL TOOL CRIB (Izquierda) */}
        <div className="lg:col-span-4 border-2 border-line bg-surface p-4 shadow-hard flex flex-col h-[520px]">
          <div className="flex items-center justify-between border-b-2 border-line pb-2 mb-3">
            <h3 className="font-display font-black text-xs uppercase tracking-wider flex items-center gap-2">
              <FileText size={15} className="text-accent" />
              Catálogo Tool Crib ({filteredDrawings.length})
            </h3>
            <label className="cursor-pointer bg-surface-2 hover:bg-accent hover:text-bg text-ink border border-line px-2 py-1 text-[10px] font-mono font-bold flex items-center gap-1 transition-colors">
              <Upload size={12} />
              <span>Subir PDF</span>
              <input type="file" accept="image/*,application/pdf" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>

          <div className="relative mb-3">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-dim" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por número de parte..."
              className="h-8 pl-8 text-xs font-mono border-2 border-line bg-surface-2"
            />
          </div>

          <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center h-40 text-ink-dim font-mono text-xs">
                <Loader2 size={18} className="animate-spin mb-2 text-accent" />
                Cargando planos...
              </div>
            ) : filteredDrawings.length === 0 ? (
              <div className="text-center py-8 text-xs font-mono text-ink-dim">
                No se encontraron planos coincidentes.
              </div>
            ) : (
              filteredDrawings.map((d) => {
                const isSelected = selectedDrawing?.partId === d.partId;
                return (
                  <button
                    key={`${d.partId}-${d.revision}`}
                    onClick={() => handleSelectDrawing(d)}
                    className={`w-full text-left p-2.5 border-2 transition-all flex items-center justify-between group ${
                      isSelected
                        ? 'border-accent bg-accent/10 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]'
                        : 'border-line/70 bg-surface-2 hover:border-line hover:bg-surface-2/90'
                    }`}
                  >
                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-2">
                        <span className="font-display font-black text-xs uppercase tracking-tight truncate text-ink">
                          {d.partNumber}
                        </span>
                        <span className="text-[9px] font-mono px-1 border border-line bg-surface text-ink-dim">
                          Rev {d.revision}
                        </span>
                      </div>
                      <p className="text-[10px] font-mono text-ink-dim truncate mt-0.5">{d.description || 'Sin descripción'}</p>
                    </div>
                    <ChevronRight
                      size={14}
                      className={`shrink-0 transition-transform ${
                        isSelected ? 'text-accent translate-x-0.5' : 'text-ink-dim opacity-0 group-hover:opacity-100'
                      }`}
                    />
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* DETALLE Y RECOMENDACIÓN TÉCNICA DE HERRAMENTAL (Derecha) */}
        <div className="lg:col-span-8 border-2 border-line bg-surface p-5 shadow-hard flex flex-col">
          {analyzingAi ? (
            <div className="flex-1 flex flex-col items-center justify-center p-12 text-center">
              <Sparkles size={32} className="animate-spin text-accent mb-3" />
              <h4 className="font-display font-black text-base uppercase">Gemini Vision Analizando Plano...</h4>
              <p className="text-xs font-mono text-ink-dim mt-1">
                Extrayendo especificación de material, dureza, roscas y tolerancias geométricas.
              </p>
            </div>
          ) : toolingPackage ? (
            <div className="space-y-5">
              {/* Header del Blueprint Analizado */}
              <div className="border-b-2 border-line pb-3 flex flex-wrap items-start justify-between gap-2">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-widest text-accent font-bold">
                    Asesor Técnico de Herramental
                  </span>
                  <h3 className="font-display font-black text-xl uppercase tracking-tight text-ink mt-0.5">
                    {toolingPackage.blueprintName}
                  </h3>
                  <div className="flex flex-wrap items-center gap-3 mt-2 text-xs font-mono">
                    <span className="bg-accent text-bg px-2 py-0.5 font-bold text-[10px]">
                      GRUPO ISO [{toolingPackage.isoGroup}]
                    </span>
                    <span className="text-ink font-bold">{toolingPackage.detectedMaterial}</span>
                    <span className="text-ink-dim">· Dureza: <strong className="text-ink">{toolingPackage.hardness}</strong></span>
                  </div>
                </div>
                {selectedDrawing?.pdfUrl && (
                  <a
                    href={selectedDrawing.pdfUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 border-2 border-line bg-surface-2 text-xs font-mono font-bold hover:bg-accent hover:text-bg hover:border-accent transition-colors shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"
                  >
                    <ExternalLink size={12} /> Ver Plano PDF
                  </a>
                )}
              </div>

              {/* Operaciones Detectadas */}
              <div>
                <h4 className="text-[10px] font-black uppercase tracking-widest text-ink-dim mb-1.5">
                  Operaciones Identificadas en el Plano:
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {toolingPackage.operations.map((op, i) => (
                    <span
                      key={i}
                      className="bg-surface-2 border border-line px-2 py-0.5 text-xs font-mono text-ink flex items-center gap-1"
                    >
                      <CheckCircle2 size={11} className="text-ok" /> {op}
                    </span>
                  ))}
                </div>
              </div>

              {/* PAQUETE DE HERRAMIENTAS: TORNO HAAS ST */}
              <div className="border-2 border-line bg-surface-2 p-4">
                <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink mb-3 flex items-center gap-2 border-b border-line pb-1.5">
                  <Wrench size={14} className="text-accent" />
                  Herramientas Recomendadas para Torno Haas ST
                </h4>
                <div className="space-y-3">
                  {toolingPackage.latheTools.map((tool, idx) => (
                    <div
                      key={idx}
                      className="bg-surface border-2 border-line p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-display font-black text-xs uppercase text-accent">
                            {tool.roleLabel}
                          </span>
                          <span className="font-mono text-xs font-bold text-ink">
                            {tool.codeSuggestion}
                          </span>
                          {tool.inVaultMatch ? (
                            <span className="bg-ok/20 text-ok border border-ok/40 px-1.5 py-0.2 text-[9px] font-mono font-bold">
                              ✓ En Bóveda ({tool.inVaultMatch.marca})
                            </span>
                          ) : (
                            <span className="bg-warn/20 text-warn border border-warn/40 px-1.5 py-0.2 text-[9px] font-mono font-bold">
                              No Registrado
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-mono text-ink-dim mt-0.5">{tool.holderSuggestion}</p>
                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[10px] font-mono text-ink">
                          <span>RPM: <strong>{tool.speedsFeedsSuggestion.rpm}</strong></span>
                          <span>Avance: <strong>{tool.speedsFeedsSuggestion.feed}</strong></span>
                          <span>Corte: <strong>{tool.speedsFeedsSuggestion.depthOfCut}</strong></span>
                        </div>
                      </div>

                      <a
                        href={tool.searchUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg text-[10px] font-mono font-black uppercase hover:bg-accent/80 transition-colors shadow-hard self-start md:self-center"
                      >
                        <ShoppingCart size={12} /> Cotizar
                      </a>
                    </div>
                  ))}
                </div>
              </div>

              {/* PAQUETE DE HERRAMIENTAS: FRESA HAAS VF CAT40 */}
              <div className="border-2 border-line bg-surface-2 p-4">
                <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink mb-3 flex items-center gap-2 border-b border-line pb-1.5">
                  <Layers size={14} className="text-accent" />
                  Herramientas Recomendadas para Fresadora Haas VF (CAT40)
                </h4>
                <div className="space-y-3">
                  {toolingPackage.millTools.map((tool, idx) => (
                    <div
                      key={idx}
                      className="bg-surface border-2 border-line p-3 flex flex-col md:flex-row md:items-center justify-between gap-3 shadow-[2px_2px_0px_0px_rgba(0,0,0,0.5)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-display font-black text-xs uppercase text-accent">
                            {tool.roleLabel}
                          </span>
                          <span className="font-mono text-xs font-bold text-ink">
                            {tool.codeSuggestion}
                          </span>
                          {tool.inVaultMatch ? (
                            <span className="bg-ok/20 text-ok border border-ok/40 px-1.5 py-0.2 text-[9px] font-mono font-bold">
                              ✓ En Bóveda ({tool.inVaultMatch.marca})
                            </span>
                          ) : (
                            <span className="bg-warn/20 text-warn border border-warn/40 px-1.5 py-0.2 text-[9px] font-mono font-bold">
                              No Registrado
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-mono text-ink-dim mt-0.5">{tool.holderSuggestion}</p>
                        <div className="flex flex-wrap items-center gap-3 mt-1.5 text-[10px] font-mono text-ink">
                          <span>Velocidad: <strong>{tool.speedsFeedsSuggestion.cuttingSpeed}</strong></span>
                          <span>Avance: <strong>{tool.speedsFeedsSuggestion.feed}</strong></span>
                          <span>Profundidad: <strong>{tool.speedsFeedsSuggestion.depthOfCut}</strong></span>
                        </div>
                      </div>

                      <a
                        href={tool.searchUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg text-[10px] font-mono font-black uppercase hover:bg-accent/80 transition-colors shadow-hard self-start md:self-center"
                      >
                        <ShoppingCart size={12} /> Cotizar
                      </a>
                    </div>
                  ))}
                </div>
              </div>

              {/* Consejos Haas para el Maquinista */}
              <div className="border border-accent/40 bg-accent/5 p-3 text-xs font-mono space-y-1">
                <h5 className="font-bold text-accent uppercase text-[10px] flex items-center gap-1.5">
                  <Cpu size={12} /> Consejos de Maquinado Haas para este Plano:
                </h5>
                <ul className="list-disc list-inside text-ink-dim space-y-0.5 text-[11px]">
                  {toolingPackage.haasSetupAdvice.map((adv, idx) => (
                    <li key={idx}>{adv}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-xs font-mono text-ink-dim">
              Selecciona un plano del catálogo a la izquierda para generar el paquete de herramientas.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, type ReactElement } from 'react';
import {
  Camera,
  Layers,
  CheckCircle2,
  Loader2,
  Wrench,
  Search,
  ExternalLink,
  AlertTriangle,
} from 'lucide-react';
import { decodeInsertCode } from '../../lib/tooling/isoInsertDecoder';
import { analyzeInsertBoxPhotoWithAI } from '../../lib/tooling/blueprintToolingAdvisor';
import { getSupplierSearchUrl } from '../../lib/tooling/toolingSuppliers';
import { InsertGeometrySvg } from './InsertGeometrySvg';
import { Input } from '../ui/input';
import { log } from '../../lib/log';

const PRESET_CODES = [
  'WNMG 080408',
  'CNMG 120408',
  'DNMG 110404',
  'CCMT 09T304',
  'DCMT 11T304',
  'APKT 160408',
  'SEKT 1204',
];

export function InsertDecoderTab(): ReactElement {
  const [inputCode, setInputCode] = useState('WNMG 080408');
  const [analyzingPhoto, setAnalyzingPhoto] = useState(false);
  const [photoDetectionResult, setPhotoDetectionResult] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const decoded = decodeInsertCode(inputCode);

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAnalyzingPhoto(true);
    setPhotoDetectionResult(null);
    setPhotoError(null);

    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      try {
        const result = await analyzeInsertBoxPhotoWithAI(dataUrl);
        if (result.ok === false) {
          setPhotoError(
            result.reason === 'network'
              ? 'No se pudo contactar a Gemini para leer la etiqueta. Revisa tu conexión e intenta de nuevo.'
              : 'No se detectó ningún código legible en la foto. Intenta con otra foto o captura el código a mano.'
          );
          return;
        }
        const detected = result.value;
        setInputCode(detected.codigoISO);
        setPhotoDetectionResult(
          `¡Etiqueta Detectada!: Marca: ${detected.marca} · Grado: ${detected.grado} · Rompevirutas: ${detected.rompevirutas} · Grupo ISO: ${detected.materialISO}`
        );
      } catch (err) {
        log.error('[smv-vision][tooling] Error al analizar foto de inserto con IA', err);
        setPhotoError('No se pudo leer la etiqueta de la caja. Intenta con otra foto o captura el código a mano.');
      } finally {
        setAnalyzingPhoto(false);
      }
    };
    reader.onerror = () => {
      setAnalyzingPhoto(false);
      setPhotoError('No se pudo leer el archivo de imagen.');
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-6">
      {/* Input Bar & Preset Chips */}
      <div className="border-2 border-line bg-surface p-5 shadow-hard space-y-4">
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-dim" />
            <Input
              value={inputCode}
              onChange={(e) => setInputCode(e.target.value)}
              placeholder="Escribe código ISO o ANSI ej. WNMG 080408, CNMG 432, APKT 1604..."
              className="h-10 pl-10 text-sm font-mono font-bold border-2 border-line bg-surface-2 uppercase"
            />
          </div>

          <label className="cursor-pointer bg-accent hover:bg-accent/80 text-bg border-2 border-accent px-4 h-10 text-xs font-mono font-black uppercase flex items-center justify-center gap-2 transition-colors shadow-hard">
            <Camera size={16} />
            <span>{analyzingPhoto ? 'Escaneando...' : 'Escanear Foto de Caja (IA)'}</span>
            <input type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} disabled={analyzingPhoto} />
          </label>
        </div>

        {/* Quick Presets */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-line/60">
          <span className="text-[10px] font-mono font-bold uppercase text-ink-dim mr-1">Populares:</span>
          {PRESET_CODES.map((code) => (
            <button
              key={code}
              onClick={() => setInputCode(code)}
              className={`text-[10px] font-mono font-bold px-2 py-0.5 border transition-all ${
                inputCode.toUpperCase().replace(/\s/g, '').includes(code.toUpperCase().replace(/\s/g, ''))
                  ? 'border-accent bg-accent text-bg'
                  : 'border-line bg-surface-2 text-ink hover:border-accent'
              }`}
            >
              {code}
            </button>
          ))}
        </div>

        {photoDetectionResult && (
          <div className="flex items-center gap-2 border border-ok/50 bg-ok/10 p-2.5 text-xs font-mono text-ink">
            <CheckCircle2 size={14} className="text-ok shrink-0" />
            <span>{photoDetectionResult}</span>
          </div>
        )}

        {photoError && (
          <div className="flex items-center gap-2 border border-danger/50 bg-danger/10 p-2.5 text-xs font-mono text-ink">
            <AlertTriangle size={14} className="text-danger shrink-0" />
            <span>{photoError}</span>
          </div>
        )}
      </div>

      {analyzingPhoto && (
        <div className="border-2 border-line bg-surface p-12 text-center text-xs font-mono text-ink-dim flex flex-col items-center">
          <Loader2 size={24} className="animate-spin text-accent mb-2" />
          Gemini Vision analizando fotografía de la etiqueta de la caja...
        </div>
      )}

      {/* RESULTADO DE LA DECODIFICACIÓN */}
      {decoded ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* LADO IZQUIERDO: DIAGRAMA SVG & FILOS */}
          <div className="lg:col-span-4 border-2 border-line bg-surface p-5 shadow-hard flex flex-col items-center text-center space-y-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-accent font-bold">
              Geometría del Inserto
            </span>

            <InsertGeometrySvg
              shape={decoded.shape.letter}
              points={decoded.svgPoints}
              size={180}
              hasHole={decoded.fixing.hole}
            />

            <div className="border-t-2 border-line pt-3 w-full space-y-2 text-left text-xs font-mono">
              <div className="flex justify-between border-b border-line/40 pb-1">
                <span className="text-ink-dim">Código Normalizado:</span>
                <strong className="text-accent">{decoded.normalizedCode}</strong>
              </div>
              <div className="flex justify-between border-b border-line/40 pb-1">
                <span className="text-ink-dim">Filos Útiles de Corte:</span>
                <strong className="text-ink">{decoded.shape.cuttingEdges} Filos ({decoded.clearance.type === 'negative' ? 'Reversible' : 'Una Cara'})</strong>
              </div>
              <div className="flex justify-between border-b border-line/40 pb-1">
                <span className="text-ink-dim">Ángulo de Punta:</span>
                <strong className="text-ink">{decoded.shape.angleDegrees}°</strong>
              </div>
              <div className="flex justify-between border-b border-line/40 pb-1">
                <span className="text-ink-dim">Círculo Inscrito (I.C.):</span>
                <strong className="text-ink">{decoded.size.inscribedCircleMm.toFixed(2)} mm ({decoded.size.inscribedCircleInch})</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-dim">Espesor (S):</span>
                <strong className="text-ink">{decoded.thickness.thicknessMm} mm ({decoded.thickness.thicknessInch})</strong>
              </div>
            </div>

            {(decoded.size.isEstimate || decoded.thickness.isEstimate) && (
              <div className="flex items-start gap-1.5 border border-warn/50 bg-warn/10 p-2 text-[10px] font-mono text-ink-dim text-left w-full">
                <AlertTriangle size={12} className="text-warn shrink-0 mt-0.5" />
                <span>Dimensiones estimadas por rango de código, no de un catálogo específico. Confirma IC, espesor y radio exactos en la ficha del proveedor antes de comprar.</span>
              </div>
            )}
          </div>

          {/* LADO DERECHO: DESGLOSE PASO A PASO ISO 1832 */}
          <div className="lg:col-span-8 border-2 border-line bg-surface p-5 shadow-hard space-y-4">
            <h3 className="font-display font-black text-sm uppercase tracking-wider text-ink border-b-2 border-line pb-2 flex items-center gap-2">
              <Layers size={16} className="text-accent" />
              Desglose de Posiciones de la Norma ISO 1832
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono">
              {/* Posición 1: Forma */}
              <div className="bg-surface-2 border border-line p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-accent text-bg px-2 py-0.5 font-black text-[10px]">1</span>
                  <span className="font-bold text-ink">Forma: {decoded.shape.letter} ({decoded.shape.name})</span>
                </div>
                <p className="text-[11px] text-ink-dim">{decoded.shape.description}</p>
              </div>

              {/* Posición 2: Desahogo */}
              <div className="bg-surface-2 border border-line p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-accent text-bg px-2 py-0.5 font-black text-[10px]">2</span>
                  <span className="font-bold text-ink">Desahogo: {decoded.clearance.letter} ({decoded.clearance.angleDegrees}°)</span>
                </div>
                <p className="text-[11px] text-ink-dim">{decoded.clearance.description}</p>
              </div>

              {/* Posición 3: Tolerancia */}
              <div className="bg-surface-2 border border-line p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-accent text-bg px-2 py-0.5 font-black text-[10px]">3</span>
                  <span className="font-bold text-ink">Tolerancia: {decoded.tolerance.letter}</span>
                </div>
                <p className="text-[11px] text-ink-dim">{decoded.tolerance.description}</p>
              </div>

              {/* Posición 4: Fijación / Agujero */}
              <div className="bg-surface-2 border border-line p-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="bg-accent text-bg px-2 py-0.5 font-black text-[10px]">4</span>
                  <span className="font-bold text-ink">Fijación: {decoded.fixing.letter}</span>
                </div>
                <p className="text-[11px] text-ink-dim">{decoded.fixing.description}</p>
              </div>
            </div>

            {/* Radio de Punta y Recomendaciones */}
            <div className="border border-line bg-surface-2 p-3 text-xs font-mono space-y-1">
              <div className="flex items-center gap-2">
                <span className="bg-accent/20 text-accent font-bold px-1.5 py-0.5 text-[10px]">RADIO</span>
                <strong className="text-ink">Radio de Punta: {decoded.noseRadius.radiusMm} mm ({decoded.noseRadius.radiusInch})</strong>
              </div>
              <p className="text-[11px] text-ink-dim">{decoded.noseRadius.idealFinish}</p>
            </div>

            {/* Portaherramientas Compatibles */}
            {decoded.compatibleHolders.length > 0 && (
              <div className="border-t-2 border-line pt-3">
                <h4 className="font-display font-black text-xs uppercase tracking-wider text-ink mb-2 flex items-center gap-2">
                  <Wrench size={14} className="text-accent" />
                  Portaherramientas Compatibles para Torno Haas:
                </h4>
                <div className="space-y-1.5">
                  {decoded.compatibleHolders.map((holder, idx) => (
                    <div key={idx} className="flex items-center justify-between bg-surface-2 border border-line px-3 py-2 text-xs font-mono">
                      <span className="text-ink font-bold">{holder}</span>
                      <a
                        href={getSupplierSearchUrl('haas_tooling', holder)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] text-accent font-black uppercase flex items-center gap-1 hover:underline"
                      >
                        Ver en Haas Tooling <ExternalLink size={10} />
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="border-2 border-line bg-surface p-12 text-center text-xs font-mono text-ink-dim space-y-2">
          <p>Código no reconocido como inserto ISO 1832 de torneado o fresado.</p>
          <p>Ingresa un código válido (ej. CNMG 120408, WNMG 432, CCMT 09T304).</p>
          <p className="text-ink-dim/70">
            ¿Es un inserto de roscar (16ER, 16IR) o de ranurar (MGMN, GTN)? Esos usan otra norma —
            revisa la pestaña <strong className="text-accent">Roscado & Machuelos</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

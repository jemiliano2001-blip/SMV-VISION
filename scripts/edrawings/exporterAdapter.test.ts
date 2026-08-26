import { readFileSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as exporterAdapterModule from './exporterAdapter';
import { buildExporterCommand, normalizeExporterOption, runCadExporter } from './exporterAdapter';

describe('native eDrawings Office Automator contract', () => {
  const supervisorSource = readFileSync(
    resolvePath('scripts/edrawings/Export-EDrawings.ps1'),
    'utf8',
  );

  it('usa el automatizador firmado de eDrawings y no invoca mshta', () => {
    expect(supervisorSource).toContain('EDrawingOfficeAutomator.Document');
    expect(supervisorSource).toContain('New-Object -ComObject');
    expect(supervisorSource).toContain('GetViewerControl()');
    expect(supervisorSource).not.toContain('mshta.exe');
    expect(supervisorSource).not.toContain('NativeEModelViewHost.hta');
    expect(supervisorSource).not.toContain('Start-Process -FilePath');
  });

  it('espera los eventos COM de carga y guardado antes de promover la isométrica', () => {
    expect(supervisorSource).toContain('function Initialize-EDrawingsEventBridge');
    expect(supervisorSource).toContain('ComEventsHelper]::Combine');
    expect(supervisorSource).toContain('OnFinishedLoadingDocument');
    expect(supervisorSource).toContain('OnFinishedSavingDocument');
    expect(supervisorSource).toContain('OnFailedLoadingDocument');
    expect(supervisorSource).toContain('OnFailedSavingDocument');
    expect(supervisorSource).toContain('function Wait-EDrawingsEvent');
    expect(supervisorSource).toContain('function Invoke-STAEventPump');
    expect(supervisorSource).toContain('System.Windows.Forms');
    expect(supervisorSource).toContain('Application]::DoEvents()');
    expect(supervisorSource).toContain('ComEventsHelper]::Remove');
    expect(supervisorSource).toContain('$viewer.ViewOrientation = 6');
    expect(supervisorSource).toContain('$viewer.ViewOrientation = 7');
    expect(supervisorSource).toContain('$viewer.Save($stagedJpgPath, $false, \'\')');
  });

  it('solo fuerza vista isométrica en modo iso; en modo flat hace zoom-to-fit', () => {
    expect(supervisorSource).toContain("[ValidateSet('iso', 'flat')][string]$Mode = 'iso'");
    expect(supervisorSource).toContain("if ($Mode -eq 'iso') {");
    expect(supervisorSource).toContain('$viewer.ZoomToFit()');
  });

  it('conserva la promoción atómica y valida el STL opcional', () => {
    expect(supervisorSource).toContain('Remove-Item -LiteralPath $outputPath -Force');
    expect(supervisorSource).toContain('function Promote-Artifact');
    expect(supervisorSource).toContain('Copy-Item -LiteralPath $StagedPath -Destination $PromotionPath -Force');
    expect(supervisorSource).toContain('Move-Item -LiteralPath $PromotionPath -Destination $OutputPath -Force');
    expect(supervisorSource).toContain('$promotedInfo.Length -ne $stagedInfo.Length');
    expect(supervisorSource).toContain('EndsWith(\'.partial\'');
    expect(supervisorSource).toContain('function Test-ValidBinaryStl');
    expect(supervisorSource).toContain('84L + ([int64]$triangleCount * 50L)');
    expect(supervisorSource).toContain('El exportador no puede sobrescribir el archivo fuente.');
  });
});

describe('Tool Crib batch integration contract', () => {
  const importerSource = readFileSync(
    resolvePath('scripts/toolcribEdrawingsIso.ts'),
    'utf8',
  );

  it('deja STL fuera del lote normal y lo habilita sólo con --includeStl', () => {
    expect(importerSource).toContain("arg === '--includeStl'");
    expect(importerSource).toContain("formats: includeStl ? ['.jpg', '.stl'] : ['.jpg']");
    expect(importerSource).toContain('includeStl: options.includeStl');
    expect(importerSource).toContain('const stlLocalPath = options.includeStl');
    expect(importerSource).toContain('if (stlUrl !== undefined) drawingPayload.stlUrl = stlUrl;');
  });

  it('reutiliza un JPG de trabajo validado antes de volver a abrir eDrawings', () => {
    expect(importerSource).toContain('canReuseExistingJpeg');
    expect(importerSource).toContain('writeJpegProvenance');
    expect(importerSource).toContain('resume=reused-existing-jpg');
  });

  it('fuerza una exportacion fresca cuando se solicita STL y no adopta un STL residual', () => {
    expect(importerSource).toContain('if (!includeStl && item.companions.raster)');
    expect(importerSource).toContain(
      'if (canReuseExistingJpeg({ sourcePath: item.absolutePath, jpegPath: reusableJpegPath, includeStl }))',
    );
    expect(importerSource).toContain(
      'options.exporterPath ? exportedStlPath : item.companions.stl?.absolutePath ?? null',
    );
  });

  it('prioriza el PDF companion real sobre exportar el .slddrw, y exporta en modo flat cuando no hay PDF', () => {
    expect(importerSource).toContain("if (item.companions.pdf) {");
    expect(importerSource).toContain("return { kind: 'existing-companion-pdf', pdfPath: item.companions.pdf.absolutePath };");
    expect(importerSource).toContain("viewMode: 'flat'");
  });

  it('aísla el JPEG del CAD en su propia subcarpeta para no pisar el de la ISO (mismo stem .sldprt/.slddrw)', () => {
    expect(importerSource).toContain("join(workRoot, item.basePartNumber, 'cad')");
  });

  it('descubre piezas con .slddrw pero sin modelo 3D, sin duplicar las que ya tiene el flujo de modelo', () => {
    expect(importerSource).toContain('async function discoverCadOnlySources(');
    expect(importerSource).toContain('if (alreadyCoveredBaseNumbers.has(parsed.basePartNumber)) continue;');
    expect(importerSource).toContain('const coveredBaseNumbers = new Set(selection.selected.map((candidate) => candidate.basePartNumber));');
  });
});

describe('normalizeExporterOption', () => {
  it.each(['edrawings', 'EDRAWINGS', 'auto', ' Auto '])(
    'conserva el modo nativo %s como palabra clave',
    (raw) => {
      expect(normalizeExporterOption(raw)).toBe(raw.trim().toLowerCase());
    },
  );

  it('preserva una ruta de ejecutable arbitraria como ruta resuelta', () => {
    const raw = String.raw`tools\vendor exporter.exe`;
    expect(normalizeExporterOption(raw)).toBe(resolvePath(raw));
  });
});

describe('buildExporterCommand', () => {
  it('lanza PowerShell STA ocultable con el adaptador nativo', () => {
    const command = buildExporterCommand({
      exporter: 'edrawings',
      nativeScriptPath: String.raw`D:\repo\scripts\edrawings\Export-EDrawings.ps1`,
      inputFile: String.raw`D:\models\PART A.eprt`,
      outDir: String.raw`D:\output\PART A`,
      timeoutSeconds: 45,
    });

    expect(command.executable).toBe('powershell.exe');
    expect(command.args).toContain('-Sta');
    expect(command.args).toContain('-NonInteractive');
    expect(command.args).toContain(String.raw`D:\models\PART A.eprt`);
    expect(command.args).toContain('.jpg');
    expect(command.args).not.toContain('.jpg,.stl');
    expect(command.args).not.toContain('-ExporterPath');
    expect(command.timeoutMilliseconds).toBe(195_000);
    expect(command.windowsHide).toBe(false);
  });

  it('da margen de carga a documentos CAD fríos sin dejar el proceso sin límite', () => {
    const command = buildExporterCommand({
      exporter: 'edrawings',
      nativeScriptPath: 'native.ps1',
      inputFile: 'part.sldprt',
      outDir: 'out',
    });

    expect(command.args).toContain('180');
    expect(command.timeoutMilliseconds).toBe(600_000);
  });

  it('invoca directamente una ruta externa sin reinterpretarla', () => {
    const executable = String.raw`C:\Program Files\Vendor Tool\export.exe`;
    const command = buildExporterCommand({
      exporter: executable,
      nativeScriptPath: 'ignored.ps1',
      inputFile: 'part.sldprt',
      outDir: 'out',
    });

    expect(command.executable).toBe(executable);
    expect(command.args).toEqual([
      '-input', 'part.sldprt', '-outdir', 'out', '-format', '.jpg',
    ]);
    expect(command.windowsHide).toBe(true);
  });

  it('solicita STL únicamente cuando la corrida lo habilita explícitamente', () => {
    const command = buildExporterCommand({
      exporter: 'edrawings',
      nativeScriptPath: 'native.ps1',
      inputFile: 'part.sldprt',
      outDir: 'out',
      formats: ['.jpg', '.stl'],
    });

    expect(command.args).toContain('.jpg,.stl');
  });

  it('por defecto pide vista isométrica (-Mode iso)', () => {
    const command = buildExporterCommand({
      exporter: 'edrawings',
      nativeScriptPath: 'native.ps1',
      inputFile: 'part.sldprt',
      outDir: 'out',
    });

    expect(command.args).toContain('-Mode');
    expect(command.args[command.args.indexOf('-Mode') + 1]).toBe('iso');
  });

  it('pasa -Mode flat para planos acotados (.slddrw)', () => {
    const command = buildExporterCommand({
      exporter: 'edrawings',
      nativeScriptPath: 'native.ps1',
      inputFile: 'part.slddrw',
      outDir: 'out',
      viewMode: 'flat',
    });

    expect(command.args[command.args.indexOf('-Mode') + 1]).toBe('flat');
  });

  it('no reinterpreta -Mode para un ejecutable externo', () => {
    const command = buildExporterCommand({
      exporter: String.raw`C:\Program Files\Vendor Tool\export.exe`,
      nativeScriptPath: 'ignored.ps1',
      inputFile: 'part.sldprt',
      outDir: 'out',
      viewMode: 'flat',
    });

    expect(command.args).not.toContain('-Mode');
  });
});

describe('runCadExporter', () => {
  it('acepta un JPG fresco y no vacío aunque el exportador termine con exit no-cero', () => {
    const outDir = String.raw`D:\output\PART A`;
    const jpgPath = join(outDir, 'PART A.jpg');
    const stlPath = join(outDir, 'PART A.stl');
    const files = new Map<string, number>([[jpgPath, 99], [stlPath, 50]]);
    const removed: string[] = [];

    const result = runCadExporter({
      exporter: 'edrawings',
      nativeScriptPath: 'native.ps1',
      inputFile: String.raw`D:\models\PART A.eprt`,
      outDir,
      formats: ['.jpg', '.stl'],
    }, {
      removeFile: (path) => {
        removed.push(path);
        files.delete(path);
      },
      nonemptyFileSize: (path) => files.get(path) ?? null,
      spawn: () => {
        expect(files.has(jpgPath)).toBe(false);
        files.set(jpgPath, 1234);
        return { status: 7, stdout: 'JPG guardado', stderr: 'STL denegado' };
      },
    });

    expect(removed).toEqual([jpgPath, stlPath]);
    expect(result).toMatchObject({ ok: true, jpgPath, stlPath: null });
    expect(result.diagnostics).toContain('exit=7');
    expect(result.diagnostics).toContain('stdout=JPG guardado');
    expect(result.diagnostics).toContain('stderr=STL denegado');
  });

  it('rechaza un JPG obsoleto cuando el intento actual no produce uno nuevo', () => {
    const outDir = String.raw`D:\output\PART B`;
    const jpgPath = join(outDir, 'PART B.jpg');
    const files = new Map<string, number>([[jpgPath, 500]]);

    const result = runCadExporter({
      exporter: String.raw`C:\tools\external.exe`,
      nativeScriptPath: 'unused.ps1',
      inputFile: String.raw`D:\models\PART B.sldprt`,
      outDir,
    }, {
      removeFile: (path) => files.delete(path),
      nonemptyFileSize: (path) => files.get(path) ?? null,
      spawn: () => ({ status: 0, stdout: '', stderr: '' }),
    });

    expect(files.has(jpgPath)).toBe(false);
    expect(result).toMatchObject({ ok: false, jpgPath: null, stlPath: null });
    expect(result.diagnostics).toContain('exit=0');
  });

  it('conserva un JPG fresco escrito antes de que el proceso exceda el timeout', () => {
    const outDir = String.raw`D:\output\PART C`;
    const jpgPath = join(outDir, 'PART C.jpg');
    const files = new Map<string, number>();

    const result = runCadExporter({
      exporter: 'auto',
      nativeScriptPath: 'native.ps1',
      inputFile: String.raw`D:\models\PART C.easm`,
      outDir,
    }, {
      removeFile: (path) => files.delete(path),
      nonemptyFileSize: (path) => files.get(path) ?? null,
      spawn: () => {
        files.set(jpgPath, 42);
        return {
          status: null,
          stdout: 'JPG guardado',
          stderr: '',
          error: new Error('ETIMEDOUT'),
          signal: 'SIGTERM',
        };
      },
    });

    expect(result).toMatchObject({ ok: true, jpgPath });
    expect(result.diagnostics).toContain('exit=none');
    expect(result.diagnostics).toContain('error=ETIMEDOUT');
  });

  it('en modo JPG no elimina ni adopta un STL existente', () => {
    const outDir = String.raw`D:\output\PART D`;
    const jpgPath = join(outDir, 'PART D.jpg');
    const stlPath = join(outDir, 'PART D.stl');
    const files = new Map<string, number>([[stlPath, 500]]);
    const removed: string[] = [];

    const result = runCadExporter({
      exporter: 'edrawings',
      nativeScriptPath: 'native.ps1',
      inputFile: String.raw`D:\models\PART D.sldprt`,
      outDir,
      formats: ['.jpg'],
    }, {
      removeFile: (path) => {
        removed.push(path);
        files.delete(path);
      },
      nonemptyFileSize: (path) => files.get(path) ?? null,
      spawn: () => {
        files.set(jpgPath, 100);
        return { status: 0, stdout: '', stderr: '' };
      },
    });

    expect(removed).toEqual([jpgPath]);
    expect(files.get(stlPath)).toBe(500);
    expect(result).toMatchObject({ ok: true, jpgPath, stlPath: null });
  });
});

describe('isReusableJpegArtifact', () => {
  const getSubject = () => Reflect.get(
    exporterAdapterModule,
    'isReusableJpegArtifact',
  ) as undefined | ((
    sourcePath: string,
    jpegPath: string,
    dependencies: {
      inspectFile: (path: string) => {
        size: number;
        modifiedAtMs: number;
        firstBytes: readonly number[];
        lastBytes: readonly number[];
      } | null;
      readTextFile?: (path: string) => string | null;
      sha256File?: (path: string) => string | null;
      canonicalPath?: (path: string) => string;
    },
  ) => boolean);

  it('reutiliza un JPEG completo que es posterior a la fuente CAD', () => {
    const subject = getSubject();
    expect(subject).toBeTypeOf('function');
    if (!subject) return;

    const reusable = subject('part.sldprt', 'part.jpg', {
      inspectFile: (path) => path.endsWith('.sldprt')
        ? { size: 100, modifiedAtMs: 1_000, firstBytes: [], lastBytes: [] }
        : {
            size: 1_000,
            modifiedAtMs: 1_001,
            firstBytes: [0xff, 0xd8],
            lastBytes: [0xff, 0xd9],
          },
      readTextFile: () => JSON.stringify({
        schemaVersion: 1,
        sourcePath: 'part.sldprt',
        sourceSha256: 'source-hash',
        jpegSha256: 'jpeg-hash',
      }),
      sha256File: (path) => path.endsWith('.sldprt') ? 'source-hash' : 'jpeg-hash',
      canonicalPath: (path) => path,
    });

    expect(reusable).toBe(true);
  });

  it('rechaza un JPEG sin sidecar de procedencia', () => {
    const subject = getSubject();
    expect(subject).toBeTypeOf('function');
    if (!subject) return;

    const reusable = subject('part.sldprt', 'part.jpg', {
      inspectFile: (path) => path.endsWith('.sldprt')
        ? { size: 100, modifiedAtMs: 1_000, firstBytes: [], lastBytes: [] }
        : {
            size: 1_000,
            modifiedAtMs: 1_001,
            firstBytes: [0xff, 0xd8],
            lastBytes: [0xff, 0xd9],
          },
      readTextFile: () => null,
      sha256File: () => 'hash',
      canonicalPath: (path) => path,
    });

    expect(reusable).toBe(false);
  });

  it('rechaza una sidecar ligada a otra fuente con el mismo basename', () => {
    const subject = getSubject();
    expect(subject).toBeTypeOf('function');
    if (!subject) return;

    const reusable = subject('B/PART.sldprt', 'work/PART.jpg', {
      inspectFile: (path) => path.endsWith('.sldprt')
        ? { size: 100, modifiedAtMs: 1_000, firstBytes: [], lastBytes: [] }
        : {
            size: 1_000,
            modifiedAtMs: 1_001,
            firstBytes: [0xff, 0xd8],
            lastBytes: [0xff, 0xd9],
          },
      readTextFile: () => JSON.stringify({
        schemaVersion: 1,
        sourcePath: 'A/PART.sldprt',
        sourceSha256: 'source-hash',
        jpegSha256: 'jpeg-hash',
      }),
      sha256File: (path) => path.endsWith('.sldprt') ? 'source-hash' : 'jpeg-hash',
      canonicalPath: (path) => path,
    });

    expect(reusable).toBe(false);
  });

  it('rechaza JPEG obsoleto, truncado o vacío', () => {
    const subject = getSubject();
    expect(subject).toBeTypeOf('function');
    if (!subject) return;

    const source = { size: 100, modifiedAtMs: 2_000, firstBytes: [], lastBytes: [] };
    const inspectFile = (jpeg: {
      size: number;
      modifiedAtMs: number;
      firstBytes: readonly number[];
      lastBytes: readonly number[];
    }) => (path: string) => path.endsWith('.sldprt') ? source : jpeg;

    expect(subject('part.sldprt', 'part.jpg', {
      inspectFile: inspectFile({
        size: 1_000,
        modifiedAtMs: 1_999,
        firstBytes: [0xff, 0xd8],
        lastBytes: [0xff, 0xd9],
      }),
    })).toBe(false);
    expect(subject('part.sldprt', 'part.jpg', {
      inspectFile: inspectFile({
        size: 1_000,
        modifiedAtMs: 2_001,
        firstBytes: [0xff, 0xd8],
        lastBytes: [0x00, 0x00],
      }),
    })).toBe(false);
    expect(subject('part.sldprt', 'part.jpg', {
      inspectFile: inspectFile({
        size: 0,
        modifiedAtMs: 2_001,
        firstBytes: [],
        lastBytes: [],
      }),
    })).toBe(false);
  });
});

describe('writeJpegProvenance', () => {
  it('escribe una sidecar atomica ligada a la fuente y al JPEG exactos', () => {
    const subject = Reflect.get(
      exporterAdapterModule,
      'writeJpegProvenance',
    ) as undefined | ((
      sourcePath: string,
      jpegPath: string,
      dependencies: {
        sha256File: (path: string) => string | null;
        canonicalPath: (path: string) => string;
        writeTextFileAtomically: (path: string, contents: string) => void;
      },
    ) => void);
    expect(subject).toBeTypeOf('function');
    if (!subject) return;

    let writtenPath = '';
    let writtenContents = '';
    subject('models/PART.sldprt', 'work/PART.jpg', {
      sha256File: (path) => path.endsWith('.sldprt') ? 'source-hash' : 'jpeg-hash',
      canonicalPath: (path) => `canonical:${path}`,
      writeTextFileAtomically: (path, contents) => {
        writtenPath = path;
        writtenContents = contents;
      },
    });

    expect(writtenPath).toBe('work/PART.jpg.source.json');
    expect(JSON.parse(writtenContents)).toEqual({
      schemaVersion: 1,
      sourcePath: 'canonical:models/PART.sldprt',
      sourceSha256: 'source-hash',
      jpegSha256: 'jpeg-hash',
    });
  });
});

describe('canReuseExistingJpeg', () => {
  it('rechaza un JPG valido si la corrida solicita tambien STL', () => {
    const subject = Reflect.get(
      exporterAdapterModule,
      'canReuseExistingJpeg',
    ) as undefined | ((
      params: { sourcePath: string; jpegPath: string; includeStl: boolean },
      dependencies: {
        inspectFile: (path: string) => {
          size: number;
          modifiedAtMs: number;
          firstBytes: readonly number[];
          lastBytes: readonly number[];
        } | null;
        readTextFile: () => string;
        sha256File: (path: string) => string;
        canonicalPath: (path: string) => string;
      },
    ) => boolean);
    expect(subject).toBeTypeOf('function');
    if (!subject) return;

    const dependencies = {
      inspectFile: (path: string) => path.endsWith('.sldprt')
        ? { size: 100, modifiedAtMs: 1_000, firstBytes: [], lastBytes: [] }
        : {
            size: 1_000,
            modifiedAtMs: 1_001,
            firstBytes: [0xff, 0xd8],
            lastBytes: [0xff, 0xd9],
          },
      readTextFile: () => JSON.stringify({
        schemaVersion: 1,
        sourcePath: 'part.sldprt',
        sourceSha256: 'source-hash',
        jpegSha256: 'jpeg-hash',
      }),
      sha256File: (path: string) => path.endsWith('.sldprt') ? 'source-hash' : 'jpeg-hash',
      canonicalPath: (path: string) => path,
    };

    expect(subject({
      sourcePath: 'part.sldprt',
      jpegPath: 'part.jpg',
      includeStl: true,
    }, dependencies)).toBe(false);
    expect(subject({
      sourcePath: 'part.sldprt',
      jpegPath: 'part.jpg',
      includeStl: false,
    }, dependencies)).toBe(true);
  });
});

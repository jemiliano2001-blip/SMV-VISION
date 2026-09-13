# Handoff — Rediseño de "Herramental CNC" (ToolingHubView)

> Estado al 2026-09-11 (Fases 1–3 hechas en Cursor). Trabajo iniciado en Claude Code.
> Lee primero `CLAUDE.md` / `AGENTS.md` de este repo para el contexto general del proyecto.

## Objetivo

Rediseñar **Herramental CNC** (`src/components/tooling/`, 8 pestañas): más ilustrativa/interactiva
y con **información real** (specs verificados, rangos con fuente, tarifa sin placeholder).

## Decisiones

| Tema | Decisión |
|---|---|
| Máquinas taller | **Mini Mill, VF-2, VF-3** → `inTaller: true`. Tornos = referencia catálogo hasta confirmar. |
| Alcance | Por fases. **Fases 1–3 hechas.** |
| Tarifa | MXN, default 0, `localStorage`; costo "—" si 0. |
| Estilo | Brutalista SMV: `border-2 border-line`, `shadow-hard`, tokens accent/ok/warn/danger. |
| Honestidad de datos | Si no se puede verificar, marcar "sin verificar" / "orientativo" — nunca inventar que está verificado. |

## Fase 1 — HECHA (Calculadora S&F)

- Datos Haas/materiales/surfaceFinish + `toolChangeSec` en ciclo.
- Calculadora partida en `src/components/tooling/calculator/` + visuals conectados.
- Tarifa MXN + gauges + diagramas de corte/rugosidad/ciclo.

## Fase 2 — HECHA (Roscado + Decodificador)

- `ThreadProfileSvg` + `threadProfileGeometry.ts`: perfil V 60° con pasadas G76.
- `InsertGeometrySvg`: desahogo + radio de punta.
- `TAP_DRILL_CHART_SOURCE` / `DataSourceChip` en tablas de machuelos.

## Fase 3 — HECHA (Fuente + tarjetas)

- `sources.ts` + `DataSourceChip.tsx` compartido.
- Fuentes en grados / endmills / Haas specs / proveedores; matriz de grados marcada como **NO verificada 1:1**.
- Haas: `partNumberVerified` solo con P/N CAT40 real; resto "ISO / sin P/N".
- Proveedores MX vía Google: badge "Búsqueda indirecta".
- Grados: tabla → tarjetas; Endmills: `EndmillTipSvg`; chips en Bóveda y Asesor de Planos.

## Verificación final

`npm test` (358) + `npm run lint` + `npm run build` en verde.

## Pendiente de Emiliano

Confirmar si hay torno Haas en el taller → `inTaller: true` en ese modelo.

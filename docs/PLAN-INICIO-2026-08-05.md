# Plan: llenar la vista Inicio — 2026-08-05

**Para el agente ejecutor (Antigravity / Gemini 3.6 Flash):** este documento es la fuente
de verdad de esta tarea. Ejecuta las fases **en orden**. Cada fase termina con un comando
de verificación que debe pasar antes de seguir. Si una verificación falla, **detente y
reporta** — no improvises un arreglo.

**Regla global:** este plan toca **exactamente 3 archivos**:

```
src/components/InicioView.tsx      (se reemplaza completo)
src/components/shell/NavRail.tsx   (2 líneas de comentario)
CLAUDE.md                          (1 línea)
```

Si un archivo no aparece en esa lista, **no lo toques**.

**Prohibido en este plan:**
- `npm install` de cualquier dependencia nueva.
- Crear archivos nuevos (ni componentes, ni hooks, ni utilidades, ni tests).
- Agregar funciones nuevas al data layer (`src/lib/firebase/`). Todo lo que se necesita
  ya existe y está listado abajo.
- Silenciar TypeScript con `// @ts-ignore`, `any`, `_var` o `void x`.
- Refactorizar, renombrar o "mejorar de paso" cualquier otra cosa.

---

## Contexto: por qué existe este plan

`InicioView` es la **vista por defecto** al abrir la app (`src/App.tsx:79`), y hoy no
sirve para nada:

- Su columna derecha renderiza `analysisSummary`, que solo existe **si corriste una
  auditoría en esta misma sesión**. En un arranque en frío queda en blanco: 4 botones y
  espacio muerto.
- `CLAUDE.md` la describe como *"Dashboard and KPI analytics"*. No hay ni un KPI.
- Le falta el acceso a **Entregas sin OC**, que sí está en `NavRail.tsx:35`.
- El comentario de cabecera de `NavRail.tsx` (líneas 5-6) promete *"badge en vivo
  (pendientes; punto rojo si hay vencidas)"*. Eso **no existe**. Es la misma clase de
  documentación mentirosa que la Fase 0 del plan de limpieza acaba de corregir.

El resultado de este plan es que Inicio conteste **"¿qué hay hoy?"** con tres cifras que
ya viven en Firestore. Cero dependencias nuevas, cero queries nuevas, cero archivos nuevos.

### Todo lo que se usa ya existe — no lo reimplementes

| Qué | Dónde | Devuelve |
|---|---|---|
| `listOrdersToInvoice()` | `src/lib/firebase/odooOrders.ts:176` | `OdooOrderResult<OdooOrderView[]>` |
| `listEntregasSinOC()` | `src/lib/firebase/odooOrders.ts:221` | `OdooOrderResult<OdooOrderView[]>` |
| `useSyncMeta()` | `src/hooks/useSyncMeta.ts:12` | `{ meta: OdooSyncMeta \| null }` |
| `formatRelativeTime(date)` | `src/lib/age.ts:135` | `string` (`"hace 8 min"`) |

`OdooSyncMeta` (`src/lib/firebase/syncMeta.ts:7`) es:

```ts
interface OdooSyncMeta {
  lastSyncAt: Date;
  ordersProcessed: number;
  status: 'ok' | 'error';   // ⚠️ 'ok', NO 'success'
  errorMessage?: string;
}
```

Las dos funciones de `odooOrders.ts` siguen el **contrato de result type**: nunca lanzan
excepción. Devuelven `{ ok: true, value }` o `{ ok: false, reason }`. El código de abajo ya
lo maneja — no le agregues `try/catch`.

### Detalle de diseño que ya está resuelto

`src/App.tsx:612` monta la vista así:

```tsx
{activeView === 'inicio' && <InicioView ... />}
```

O sea que **Inicio se desmonta al navegar a otra vista y se vuelve a montar al regresar**.
El `useEffect` de abajo se dispara en cada visita, así que las cifras se refrescan solas.
**No agregues un botón de refrescar, ni un `setInterval`, ni caché.**

---

## FASE 1 — Reemplazar `src/components/InicioView.tsx`

Borra el contenido completo del archivo y pégalo por esto, **verbatim**:

```tsx
/**
 * InicioView — portada / resumen.
 *
 * Contesta "¿qué hay hoy?" con tres cifras que ya viven en Firestore y ofrece
 * accesos rápidos a las demás vistas.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { motion } from 'motion/react';
import {
  ScanLine, Library, ArrowRight, CloudDownload, ShoppingCart, FileWarning, RefreshCw,
  type LucideIcon,
} from 'lucide-react';

import { listOrdersToInvoice, listEntregasSinOC } from '../lib/firebase/odooOrders';
import { formatRelativeTime } from '../lib/age';
import { useSyncMeta } from '../hooks/useSyncMeta';
import type { AnalysisRunSummary } from '../types';
import type { AppView } from './shell/AppShell';

export interface InicioViewProps {
  onNavigate: (view: AppView) => void;
  analysisSummary: AnalysisRunSummary | null;
}

/** Por cifra: `undefined` = cargando · `null` = la consulta falló · número = dato bueno. */
interface Counts {
  pendientes: number | null;
  sinOc: number | null;
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.05, delayChildren: 0.04 } },
};
const item = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 320, damping: 30 } },
} as const;

function show(n: number | null | undefined): string {
  if (n === undefined) return '…';
  if (n === null) return '—';
  return String(n);
}

export function InicioView({ onNavigate, analysisSummary }: InicioViewProps): ReactElement {
  const now = new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const { meta } = useSyncMeta();
  const [counts, setCounts] = useState<Counts | undefined>(undefined);

  // ponytail: relee en cada visita — App.tsx desmonta Inicio al navegar. Sin caché ni
  // auto-refresh. Si la doble lectura de listEntregasSinOC (hasta 1000 docs, filtra en
  // cliente) llega a molestar, subir el estado a App.tsx; hoy nadie lo ha medido.
  useEffect(() => {
    let alive = true;
    void Promise.all([listOrdersToInvoice(), listEntregasSinOC()]).then(([pend, sin]) => {
      if (!alive) return;
      setCounts({
        pendientes: pend.ok ? pend.value.length : null,
        sinOc: sin.ok ? sin.value.length : null,
      });
    });
    return () => { alive = false; };
  }, []);

  return (
    <motion.div
      variants={container}
      initial="hidden"
      animate="show"
      className="bp-grid-lg min-h-full p-6 lg:p-10 max-w-[1400px]"
    >
      {/* ── Encabezado ── */}
      <motion.header variants={item} className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[4px] text-accent mb-1">Resumen</p>
          <h1 className="font-display font-black text-5xl lg:text-6xl uppercase italic tracking-[-2px] leading-none">
            Inicio
          </h1>
        </div>
        <p className="font-mono text-[11px] text-ink-dim capitalize">{now}</p>
      </motion.header>

      {/* ── Qué hay hoy ── */}
      <motion.section variants={item} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <StatCard
          icon={CloudDownload}
          value={show(counts?.pendientes)}
          label="Órdenes pendientes"
          onClick={() => onNavigate('odoo')}
        />
        <StatCard
          icon={FileWarning}
          value={show(counts?.sinOc)}
          label="Entregas sin OC"
          tone={counts?.sinOc ? 'text-warn' : undefined}
          onClick={() => onNavigate('entregas-sin-oc')}
        />
        <StatCard
          icon={RefreshCw}
          value={meta ? formatRelativeTime(meta.lastSyncAt) : '—'}
          label={meta?.status === 'error' ? 'Último sync · ERROR' : 'Último sync Odoo'}
          tone={meta?.status === 'error' ? 'text-danger' : undefined}
          small
        />
      </motion.section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Accesos rápidos ── */}
        <motion.section variants={item} className="space-y-3">
          <QuickAction icon={ScanLine} title="Generar Reporte" desc="Auditar planos y generar reporte PDF" onClick={() => onNavigate('reporte')} />
          <QuickAction icon={Library} title="Biblioteca" desc="Catálogo de planos Tool Crib" onClick={() => onNavigate('biblioteca')} />
          <QuickAction icon={ShoppingCart} title="Compras" desc="Catálogo de compras" onClick={() => onNavigate('compras')} />
        </motion.section>

        {/* ── Última corrida (solo si auditaste en esta sesión) ── */}
        <motion.section variants={item} className="space-y-3">
          {analysisSummary && (
            <div className="corner-ticks bg-surface border-2 border-line p-4">
              <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mb-3">Última auditoría</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <Stat n={analysisSummary.totalOrders} l="Órdenes" />
                <Stat n={analysisSummary.totalAudited} l="Auditadas" tone="text-accent" />
                <Stat n={analysisSummary.totalAnalyzed} l="Planos" />
              </div>
            </div>
          )}
        </motion.section>
      </div>
    </motion.div>
  );
}

function StatCard({ icon: Icon, value, label, tone = 'text-ink', small = false, onClick }: {
  icon: LucideIcon;
  value: string;
  label: string;
  tone?: string;
  small?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <div className="flex items-start justify-between mb-2">
        <Icon size={16} className="text-ink-dim" />
        {onClick && (
          <ArrowRight size={14} className="text-ink-dim opacity-0 group-hover:opacity-100 transition-opacity" />
        )}
      </div>
      <p className={`font-display font-black italic leading-none ${small ? 'text-2xl' : 'text-4xl'} ${tone}`}>
        {value}
      </p>
      <p className="font-mono text-[9px] uppercase tracking-[2px] text-ink-dim mt-2">{label}</p>
    </>
  );

  if (!onClick) {
    return <div className="corner-ticks bg-surface border-2 border-line p-4">{body}</div>;
  }

  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ y: -2, boxShadow: '4px 4px 0px var(--color-accent)' }}
      whileTap={{ y: 0, boxShadow: '0px 0px 0px var(--color-accent)' }}
      className="group corner-ticks bg-surface border-2 border-line p-4 text-left transition-colors hover:border-accent outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {body}
    </motion.button>
  );
}

function Stat({ n, l, tone = 'text-ink' }: { n: number | string; l: string; tone?: string }) {
  return (
    <div>
      <p className={`font-display font-black text-2xl italic leading-none ${tone}`}>{n}</p>
      <p className="font-mono text-[9px] uppercase tracking-wider text-ink-dim mt-1">{l}</p>
    </div>
  );
}

function QuickAction({ icon: Icon, title, desc, onClick }: { icon: LucideIcon; title: string; desc: string; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      onClick={onClick}
      whileHover={{ scale: 1.02, x: 4, boxShadow: '4px 4px 0px var(--color-accent)' }}
      whileTap={{ scale: 0.98, x: 0, boxShadow: '0px 0px 0px var(--color-accent)' }}
      className="w-full text-left bg-surface border-2 border-line p-4 flex items-center gap-4 transition-colors hover:border-accent group outline-none focus-visible:ring-2 focus-visible:ring-accent relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-accent/5 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
      <span className="grid place-items-center w-10 h-10 bg-surface-2 border-2 border-line group-hover:border-accent group-hover:bg-accent group-hover:text-bg transition-colors shrink-0">
        <Icon size={18} />
      </span>
      <div className="min-w-0">
        <h3 className="font-display font-black text-[15px] uppercase tracking-wide group-hover:text-accent transition-colors">{title}</h3>
        <p className="font-mono text-[10px] text-ink-dim truncate">{desc}</p>
      </div>
      <ArrowRight size={16} className="ml-auto text-ink-dim opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all group-hover:text-accent" />
    </motion.button>
  );
}
```

### Notas sobre el código de arriba — no lo "mejores"

- **`show()` y el tipo `Counts`.** Tres estados por cifra: cargando (`…`), consulta fallida
  (`—`), dato bueno (el número). No lo cambies por `boolean isLoading` — perderías la
  distinción entre "todavía no llega" y "falló".
- **`tone={counts?.sinOc ? 'text-warn' : undefined}`.** Cuando hay `0` entregas sin OC el
  valor es falsy y **no** se pinta de amarillo. Es intencional: cero = nada que hacer.
- **`let alive = true`.** Evita el `setState` sobre un componente desmontado si navegas
  antes de que resuelvan las consultas. No lo quites.
- **`Promise.all` sin `.catch()`.** Correcto: ninguna de las dos funciones lanza (result
  type). Agregarle un `catch` sería ruido muerto.
- **`text-warn` / `text-danger` / `corner-ticks`** son tokens que ya existen en
  `src/index.css`. No inventes clases nuevas ni valores hex.
- **`QuickAction` ahora tipa `icon: LucideIcon`** (antes era `any`). Es a propósito.
- Los accesos rápidos bajaron de 4 a 3: **Órdenes Odoo** ya no está ahí porque ahora es la
  primera StatCard. No lo re-agregues.

### ✅ Verificación Fase 1

```bash
npx tsc --noEmit    # debe salir con código 0
npm test            # debe pasar
npm run build       # debe completar
```

```bash
grep -c "listEntregasSinOC" src/components/InicioView.tsx   # debe imprimir 3 (import, comentario ponytail, llamada)
grep -c "entregas-sin-oc" src/components/InicioView.tsx     # debe imprimir 1
grep -c ": any" src/components/InicioView.tsx               # debe imprimir 0
```

Commit: `feat(inicio): mostrar pendientes, entregas sin OC y último sync`

---

## FASE 2 — Borrar el comentario mentiroso de `NavRail.tsx`

Archivo: `src/components/shell/NavRail.tsx`, líneas 5-6. Dicen:

```
 * - Destinos con icono + etiqueta + badge en vivo (pendientes; punto rojo si
 *   hay vencidas).
```

Esos badges no existen y **este plan no los agrega** (las cifras viven en Inicio, que es
donde sí se leen). Reemplaza esas dos líneas por una sola:

```
 * - Destinos con icono + etiqueta.
```

No toques nada más del archivo.

### ✅ Verificación Fase 2

```bash
grep -c "badge en vivo" src/components/shell/NavRail.tsx   # debe imprimir 0
npx tsc --noEmit                                            # código 0
```

Commit: `docs(navrail): borrar comentario de badges que no existen`

---

## FASE 3 — Corregir `CLAUDE.md`

En la sección `### Multi-view application shell`, la línea que hoy dice:

```
- **Inicio** (`InicioView.tsx`) — Dashboard and KPI analytics.
```

Reemplázala por:

```
- **Inicio** (`InicioView.tsx`) — Landing view. Reads three live counters on mount
  (`listOrdersToInvoice().length`, `listEntregasSinOC().length`, `useSyncMeta()`) and
  offers quick actions to the other views. Remounts on every visit (`App.tsx` gates it
  behind `activeView === 'inicio'`), so the counters refresh without a refresh button.
```

No cambies ninguna otra línea de `CLAUDE.md`.

### ✅ Verificación Fase 3

```bash
grep -c "Dashboard and KPI analytics" CLAUDE.md   # debe imprimir 0
grep -c "listEntregasSinOC" CLAUDE.md             # debe imprimir 1 o más
```

Commit: `docs(claude): describir Inicio como es hoy`

---

## Verificación final — en el navegador

`npm run dev`, entra con tu cuenta y revisa:

1. **Inicio muestra tres tarjetas, y los dos primeros números cuadran.** Ya está
   verificado que deben coincidir exactamente — compáralos contra estos dos lugares
   concretos, no contra "lo que se vea":
   - **Órdenes pendientes** vs. el chip naranja del botón **"Todas las Órdenes"** en la
     vista Órdenes Odoo (`OdooOrdersPanel.tsx:586`, renderiza `orders.length`).
     ⚠️ Compara **antes de escribir nada en el buscador** y con el filtro de requisitor en
     `TODOS`: los defaults son `searchTerm = ''` y `selectedRequisitor = 'ALL'`
     (líneas 234-235). Si filtras, la lista de abajo baja pero el chip no — el chip es el
     que debe cuadrar.
   - **Entregas sin OC** vs. el número de tarjetas en la vista Entregas sin OC
     (`EntregasSinOCPanel.tsx` renderiza `orders` sin filtrar).

   Si un número dice `—` de forma permanente, esa consulta está fallando — revisa la
   consola. **Si los números no cuadran, detente y reporta** — significa que un panel
   cambió desde que se escribió este plan.
2. **Las dos primeras tarjetas navegan.** Clic en "Órdenes pendientes" → vista Órdenes.
   Clic en "Entregas sin OC" → vista Entregas sin OC.
3. **La tarjeta de sync NO navega** y muestra algo como `hace 8 min`. Si dice `—`, es que
   `syncMeta/odoo` no existe todavía (la Cloud Function nunca ha corrido). No es un bug
   de este plan.
4. **Vuelve a Inicio desde otra vista.** Las cifras deben mostrar `…` un instante y luego
   el número — eso confirma que el remount refresca.

> Nota: si corres con `VITE_TOOLCRIB_DEBUG_ALLOW_UNAUTH` sin sesión, las dos primeras
> tarjetas van a decir `—` porque las funciones devuelven `not-authenticated`. Es el
> comportamiento correcto, no lo "arregles".

---

## Resumen del impacto

| Fase | Qué cambia | Archivos | Riesgo |
|---|---|---|---|
| 1 | Inicio muestra 3 cifras reales + acceso a Entregas sin OC | 1 | Bajo |
| 2 | Comentario de badges inexistentes | 1 | Ninguno |
| 3 | Descripción de Inicio en `CLAUDE.md` | 1 | Ninguno |

Cero dependencias nuevas. Cero archivos nuevos. Cero funciones nuevas en el data layer.

---

## Lo que este plan NO hace, a propósito

- **No agrega badges al NavRail.** Requiere subir el estado a `App.tsx` o meter un
  contexto: 3 archivos más para el mismo dato que Inicio ya muestra.
- **No agrega gráficas.** `https://dashboardsmv.web.app/` ya es la app de gráficas y está
  linkeada en el NavRail. Dos dashboards es un dashboard de más.
- **No cachea las consultas ni agrega auto-refresh.** El remount de Inicio ya refresca. Un
  caché aquí es estado nuevo que invalidar.
- **No agrega tests.** Lo único con lógica es `show()` (tres ramas de formato) y el
  `useEffect`. El check es el paso 1 de la verificación en el navegador: si los números de
  Inicio no coinciden con los de las otras dos vistas, está roto.
- **No toca `useVisionAnalysis.ts`, el pipeline de Gemini, ni el data layer.**

# Biblioteca: juegos (pares), notas permanentes y presets de impresión

Fecha: 2026-09-29 · Estado: pendiente de revisión

## Objetivo

Que la Biblioteca (Tool Crib) permita:
1. Saber qué piezas son par/juego/hoja/complemento y gestionarlo sin tocar código.
2. Guardar notas permanentes por pieza que salgan (opcionalmente) en la OT.
3. Imprimir con presets guardados, incluyendo cómo imprimir un juego.

Contexto del taller: un "par" son **piezas distintas que se piden juntas porque forman un ensamble**
(ej. 1012-05-CHICO + 1012-05-GRANDE). Hoy la detección vive en 4 reglas fijas de
`src/lib/companionDrawings.ts` (`KNOWN_RULES`).

## Decisiones ya tomadas

- Impresión de juegos: **una impresión separada por pieza**, cada una con su sello y ficha completos
  (mismo SO, PO y fecha; cantidad propia). Ya no se mezclan como "hojas 2 de 2" en un solo PDF.
- Presets en `localStorage` (por navegador). Sin colección nueva para presets.
- Fuera de alcance: elegir hojas individuales, copias, posición del sello, historial de impresión, etiquetas.

## 1. Juegos (pares y hojas)

### Datos
Colección Firestore `toolcribSets`, un doc por juego:

```
{ id, nombre, tipo: 'par' | 'hoja' | 'complemento' | 'variante',
  miembros: [{ partNumber, rol, orden, cantidadPorJuego }],
  createdAtUTC, updatedAtUTC }
```

- `partNumber` se guarda con `canonicalPartNumber`. `cantidadPorJuego` entero ≥ 1 (defecto 1).
- Máximo 8 miembros por juego. Una pieza puede estar en un solo juego (el vínculo nuevo la mueve).

### Lógica (`src/lib/toolcribSets.ts`, nuevo)
- `resolveSetForPart(partNumber, sets, library)`: si la pieza está en un juego guardado, devuelve sus
  miembros resueltos contra el catálogo; si no, cae a `findCompanionDrawings` (reglas fijas).
  El guardado siempre gana.
- `suggestSets(library, sets)`: agrupa por `extractBasePartRoot` piezas con raíz común aún sin juego
  guardado; devuelve candidatos para confirmar.
- `quantityForMember(member, juegos)`: `juegos * cantidadPorJuego`.

### Capa de datos (`src/lib/firebase/toolcribSets.ts`, nuevo)
`listSets`, `saveSet`, `deleteSet`; result-type (`{ ok, value } | { ok: false, reason }`), nunca lanzan.
Validador de forma en `src/lib/firebase/toolcribSetValidators.ts`.

### UI (`ToolcribLibraryPanel`)
- Insignia en la tarjeta: `PAR 1/2 · con <pieza>`; clic salta a la hermana.
- Filtro "Solo pares / juegos".
- Botón "Vincular como juego": mini-formulario (piezas, rol, orden, cantidad por juego, tipo).
- Bloque "Sugerencias": lista de candidatos de `suggestSets` con Confirmar / Descartar
  (descartar solo oculta en la sesión).

## 2. Notas permanentes

### Datos
Colección `toolcribPartNotes`, un doc por número de parte canónico:

```
{ partNumber, notas: [{ id, texto, imprimirEnOT, createdAtUTC }], updatedAtUTC }
```

Texto ≤ 300 caracteres; máximo 10 notas por pieza.

### Lógica y capa de datos
- `src/lib/firebase/partNotes.ts`: `getPartNotes`, `listPartNotes`, `savePartNotes`, `deletePartNotes`
  (result-type).
- `composeOtNotes(permanentes, corrida)` en `src/lib/toolcribSets.ts` o módulo propio: une las notas
  permanentes marcadas y desmarcables más la nota de la corrida (la actual), separadas por " · ".

### UI
- Ícono 📝 en la tarjeta si hay notas; se ven y editan en el detalle de la pieza.
- Modal de impresión: casillas por nota permanente (precargadas según `imprimirEnOT`) y campo de nota de
  la corrida como hoy.
- Chips de notas rápidas ("Rebabear", "Tratamiento térmico", "Rectificar") desde una constante editable
  en código; un clic agrega el texto a la nota de la corrida.

## 3. Presets de impresión

### Datos
`localStorage`, clave `smv.printPresets.v1`, lista de:

```
{ id, nombre, modo: 'blueprint' | 'board_ticket' | 'both', headerStyle: 'slim' | 'classic',
  incluirNotasPermanentes: boolean, juego: 'separadas' | 'unificado' }
```

- Vienen 3 de fábrica (no borrables): "OT estándar", "Solo pizarrón", "Plano limpio".
- Defecto para juegos: `juego: 'separadas'`.
- Lectura/escritura envueltas en try/catch; si falla el storage, se usan los de fábrica.
- Módulo puro `src/lib/printPresets.ts` (`loadPresets`, `savePreset`, `deletePreset`).

### UI
Selector "Preset" arriba de `ToolcribPrintModal`; "Guardar como preset" con nombre; borrar los propios.

## 4. Impresión de juegos, una por pieza

Cuando la pieza forma parte de un juego y el preset dice `juego: 'separadas'`:
- Para cada miembro se genera su PDF con `stampPlanoOt` (sello y ficha completos, su `partNumber`,
  su `quantityForMember`, SO/PO/fecha compartidos, notas permanentes propias + nota de la corrida).
- Se abren una por una. Si el navegador bloquea las pestañas extra tras el primer `window.open`,
  el modal muestra la lista de piezas con un botón "Imprimir" por cada una (y "Imprimir siguiente").
- `juego: 'unificado'` conserva el comportamiento actual (`createStampedPlanoOtSet`), por si se necesita.
- `ToolcribBatchPrintModal` / `useBatchPrintOts` usan `resolveSetForPart` para expandir juegos con la
  misma regla.

## 5. Seguridad y reglas

- `firestore.rules`: dos bloques nuevos (`toolcribSets`, `toolcribPartNotes`) con
  `allow read, create, update, delete: if isSignedIn();`, mismo patrón que `partAliases`.
- Base compartida con el Dashboard: no se toca su bloque; se verifica que el desplegado de reglas
  conserve la copia del Dashboard. Deploy solo `firestore:rules` con `--project smv-brain`.
- Pruebas en `tests/firestore-rules.emulator.test.ts`: anónimo bloqueado, usuario Vision permitido.

## 6. Errores y degradación

Si Firestore no responde o la config falta, `resolveSetForPart` usa solo las reglas fijas, las notas
permanentes no se muestran y la impresión funciona igual que hoy. Ninguna función nueva lanza.

## 7. Pruebas

- `toolcribSets.test.ts`: guardado gana sobre regla fija; sugerencias; cantidad por juego;
  pieza en un solo juego.
- `printPresets.test.ts`: cargar/guardar/borrar, storage roto, de fábrica no borrables.
- `partNotes` / `composeOtNotes`: unión de notas, límites, desmarcadas.
- Validadores de Firestore: documentos mal formados se normalizan o se descartan.
- Reglas de Firestore en el emulador (requiere Java en PATH).
- Los tests existentes de `companionDrawings` y `planoOt` deben seguir pasando.

## 8. Fases de implementación sugeridas

1. Juegos: datos, lógica, reglas, insignia y filtro.
2. Impresión separada por pieza con cantidad por juego.
3. Vincular/sugerencias en UI.
4. Notas permanentes.
5. Presets.

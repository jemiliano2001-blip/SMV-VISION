# Impresión OT: cantidad original y encabezado — 2026-09-10

- La impresión individual de Biblioteca/Órdenes pasa por una vista previa. El operador selecciona la cantidad original con un recuadro, puede quitarlo, usar zoom o ajustar sus coordenadas con teclado. Debe seleccionar una zona o indicar explícitamente que no hace falta ocultar ninguna.
- «Ver resultado» genera la misma primera página que se imprime: cubierta blanca en la zona seleccionada, SO/cantidad grandes y fecha/notas debajo. La fuente del catálogo permanece intacta. La cubierta es visual para impresión, no una redacción segura de información confidencial.
- El generador normaliza la orientación y CropBox antes de aplicar el recuadro. Conserva el contenido vectorial del plano y las páginas posteriores. La selección se aplica únicamente a la primera página y no se guarda en Firestore.
- El encabezado ampliado también se usa al imprimir lotes. La selección interactiva se ofrece en la impresión individual; los lotes no seleccionan ni reutilizan máscaras automáticamente.
- Revisión defensiva: rechazo de coordenadas no finitas/fuera de página, cantidad positiva, aislamiento de renders y respuestas tardías, controles accesibles con teclado, notas largas envueltas, páginas vacías admitidas y sin borrados por posición fija.

## Validación

- `npm test`: 29 archivos, 325 pruebas aprobadas; nueve casos nuevos del generador.
- `npm run lint`: aprobado.
- `npm run build`: aprobado; advertencia de tamaño de chunks de Vite.
- Navegador local con componente real y PDF local `90-1012-06.pdf`; consulta de órdenes simulada, sin escrituras a Firebase: arrastre, vista final y generación de un PDF válido desde «Imprimir OT».
- Comprobación por píxeles para 0/90/180/270 grados con CropBox desplazado: interior seleccionado blanco y borde exterior negro conservado.
- Vista móvil 390 × 844: sin desbordamiento horizontal; ajuste por teclado, quitar recuadro y omisión explícita funcionan.
- No se verificó impresión física ni producción. Sin commit, push ni despliegue.

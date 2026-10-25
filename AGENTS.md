# EKKO Studio — Reglas del proyecto

## 🔴 LEY SUPREMA · REGLA DE ORO

**Todo análisis, inspección o cambio se hace SIEMPRE sobre el repositorio REMOTO
actualizado, nunca sobre una copia local.**

Motivo: el cliente trabaja en el repositorio remoto en paralelo. Trabajar sobre un
árbol local viejo produce solapamiento de rutas y respuestas equivocadas.

Procedimiento obligatorio al iniciar cada tarea:

```bash
git fetch origin
git log --oneline -3 FETCH_HEAD   # ver qué cambió
git merge --ff-only FETCH_HEAD    # fast-forward al remoto
```

- Si el fast-forward no se puede hacer (divergencia), **NO** hacer `reset`, `rebase`
  ni `push --force`. Informar al usuario y esperar instrucción.
- Si `git fetch` falla (sin credenciales / sin red), declarar explícitamente que el
  análisis se hizo sobre un estado local posiblemente desactualizado, y no presentarlo
  como análisis del remoto.
- Nunca modificar ramas, worktrees ni configuración de git de otros chats.

## Enfoque actual de producto

El foco está en la **estética y el flujo de la interfaz**:

- **Barra emergente** (`#contextual-toolbar`) y **panel superior fijo** (`#topBar`)
  deben comportarse de forma **dinámica**: mostrar/ocultar/reagrupar botones según el
  tipo o tipos de objetos seleccionados, como el ribbon de **Office.com** y como la
  barra de herramientas contextual de **AutoCAD**.
- La interacción completa debe sentirse de esas platauras: **guías de alineación
  magnéticas, cotas en vivo, snaps y reacción inmediata al cambiar la selección**.

## Modelo de clasificación de herramientas (referencia de diseño)

Tres familias, aplicadas a cada botón de `#topBar` y `#contextual-toolbar`:

| Familia | Concepto | Cómo se representa en la UI |
|---|---|---|
| **H — Orden libre** | conmutativa, sin precondición (ej.: espaciado ↔ curvar) | fila horizontal, mismo nivel |
| **P — Orden obligado** | typestate / precondiciones (ej.: el texto no se descompone) | pirámide de escalones; solo el escalón vigente se ofrece |
| **E — Máquina de estados** | la regla que esconde el botón (ej.: vectorizado ya no muestra "Texto a Vector") | el motor decide la existencia del botón |

- **Fuente única de verdad**: `ASSETS/js/modules/canvas-pro/capabilities.js`
  (`TOOLS`, `TABS`, `detectTab`, `legacyNamesFor`).
- Las dos superficies consumen ese mismo motor
  (`canvasControlsIntegration.js` → `syncToolbar()`), por lo que **nunca pueden
  discrepar**. `panelCommandBridge.js` solo recorta por la pestaña activa: nunca amplía.
- Ejes de decisión: **especie** (raster / vector / texto / mezcla), **cantidad**
  (1 vs varios), **rol topológico** (sólido / hueco / línea de corte) y **estado**
  (¿fondo quitado?, ¿fusionado?, ¿vectorizado?, ¿descompuesto?).

## ⚠️ Diagnóstico obligatorio: por qué hoy los botones aparecen y desaparecen mal

Hay **CUATRO escritores** de `element.style.display` sobre los MISMOS botones, con
criterios distintos y en distintos ticks. Gana el último en correr, por eso el
botón que debería irse reaparece y el que debería verse se oculta:

| # | Escritor | Criterio que usa | Cuándo corre |
|---|---|---|---|
| A | `canvasControlsIntegration.syncToolbar()` | `legacyNamesFor()` — **sin** pestaña | `setSelectedItem` + `setTimeout(10)` |
| B | `panelCommandBridge.applyCommandVisibility()` | `legacyNamesForTab()` — **con** pestaña + overrides propios | `requestAnimationFrame` + `setTimeout(0)` + `setTimeout(60)` |
| C | `contextualMenu.js` (~líneas 943 y 1024-1101) | clasificación propia por `className` | en cada actualización de la selección |
| D | `toolbarOverflow.js` | mide `scrollWidth` y esconde desde el final | en resize/mutación |

Además `panelCommandBridge.classifySelection()` **reimplementa** la clasificación de
especie por `className` (un `Group` no-fusión cuenta como `vector`), cuando
`capabilities.speciesOf()` dice que hay que mirar el contenido y que un grupo
mixto es `mixed`. Dos clasificadores distintos → dos respuestas distintas.

**Regla de arquitectura: de acá en adelante UN SOLO escritor.**
Estado (`selección + pestaña + capacidades`) → un render puro → el DOM. Ningún
módulo más puede tocar `style.display` de un botón de barra.

## 📋 Plan de acción (orden de trabajo — respetar el orden)

0. **Contrato** — manifiesto declarativo de botones + un solo render.
   Cada botón declara: `id · herramienta · superficie · grupo · pestaña · familia (H/P/E) · precondición`.
   La interfaz **lee el manifiesto**, nunca decide por su cuenta.
1. **Corrección de defectos** — cerrar los huecos que hoy rompen la lógica
   (`audit` y `btnTopTextCurve` sin `data-fusion-btn`; `audit` ausente de
   `ENGINE_TO_LEGACY`; `editCutout` solo en la emergente; `measurements` sin botón
   en las dos superficies; `distribute` habilitado con 2 pero exige 3;
   `align` visible sin selección).
2. **Ribbon estático** — grupos colapsables con título + pestañas contextuales
   (Inicio / Imagen / Vector / Texto / Varios) con transiciones. `TABS` y
   `detectTab()` ya existen: solo falta la capa visual.
3. **Dinámica** — expansión/plegado animado de grupos y colapso por espacio
   insuficiente a nivel de **grupo** (reemplaza el menú "..." de `toolbarOverflow.js`).
4. **Interacción de lienzo (AutoCAD)** — guías magnéticas, cotas en vivo
   arrastrables/editables, OSNAP, rastreo polar, entrada dinámica.
5. **Pulido** — motion, `prefers-reduced-motion`, teclado, accesibilidad.

No invertir el orden: no se anima un ribbon cuya visibilidad es una carrera, y no
se miden cotas sobre un lienzo que cambia debajo.

**Modelo de interacción propuesto (familia → comportamiento):**
- **H (orden libre)** → siempre visible y habilitado.
- **P (orden obligado)** → **visible pero deshabilitado con motivo en el tooltip**
  ("Primero quitá el fondo"), en lugar de desaparecer: enseña la pirámide y la barra no salta.
- **E (máquina de estados)** → el **slot** cambia de identidad (Quitar Fondo →
  Editar Fondo) en la misma posición: el botón no aparece ni desaparece, muta.

## 🗂 Frontera de archivos (para no solaparnos)

**Capa de INTERFAZ (asistente):** archivos nuevos en `ASSETS/js/modules/canvas-pro/ui/`
(manifiesto, store, renderer, ribbon), `ASSETS/ui/ekko-ribbon.css` (nuevo),
módulos nuevos de lienzo (`osnap`, `polarTracking`, `dynamicInput`, cotas).
Ediciones mínimas y puntuales en `index.html`, `panelCommandBridge.js`,
`canvasControlsIntegration.js`, `panelCoordinator.js`, `toolbarOverflow.js`.

**Capa de OBJETOS (cliente):** `capabilities.js`, `vectorSemantics.js`,
`smartFusion.js`, `geometricUngroup.js`, `backgroundRemover.js`, `contorno.js`,
`imageTracer.js`, `fusionCore.js`, `calado.js`, `nodeEditor.js`, `textToolbar.js`,
`selection.js`, `editor.js`.

El asistente **no edita** la capa de objetos: solo consume su API exportada. Si
hace falta una capacidad nueva, se le pide al cliente que la declare en
`capabilities.js`. `index.html` es el único archivo que comparten: avisar antes

de editarlo.

## 📤 Subida de cambios (LEY — segunda regla de oro)

**El asistente NUNCA hace commit ni push.** Todo cambio vive como archivo en el
workspace del chat y el CLIENTE lo sube a GitHub. Motivo: el cliente trabaja en
GitHub en paralelo y un push del asistente lo toma por sorpresa y puede solaparse
con las rutas que él está modificando.

Procedimiento al terminar cada tarea:

1. Listar las rutas exactas, separadas en **MODIFICADAS** y **NUEVAS**.
2. Empaquetar en un ZIP con la estructura de rutas intacta
   (`para-subir-<tema>.zip`) para que el cliente lo descargue de un clic.
3. Nunca ejecutar `git add`, `git commit` ni `git push` sin que el cliente lo
   pida expresamente en el mensaje.

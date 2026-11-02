/* =========================================================================
   EKKO STUDIO — MENU CONTEXTUAL (CLIC DERECHO) — v1

   ╔══════════════════════════════════════════════════════════════════════╗
   ║  SOLO LECTURA. Este modulo no decide reglas de negocio: clasifica    ║
   ║  el contexto (C0-C8 de PROPUESTA-MENU-CONTEXTUAL.md) y arma el menu  ║
   ║  con la verdad que ya calculo capabilities.js via toolbarStore.      ║
   ║  No toca style.display de ningun boton de barra (eso es de           ║
   ║  ribbonRenderer.js) ni edita contextualMenu.js (la emergente).       ║
   ╚══════════════════════════════════════════════════════════════════════╝

   DECISIONES DEL CLIENTE YA CERRADAS:
   - D1: Contorno con 2+ seleccionados = Union por default + "Por pieza"
     en el panel (el boton Contorno del menu abre ese panel).
   - D2: Eliminar y Duplicar TAMBIEN en grupo mixto (SVG con imagen).
     El motor hoy no los habilita ahi (solo Desagrupar); el menu los
     agrega con regla propia: borrar un objeto cargado por error no
     puede requerir desagruparlo primero.
   - D3: el menu NO lleva controles de texto (Fuente/Tamano/Espaciado):
     ese atajo ya lo cumple la barra emergente (#ctxTextControls).

   GESTOS EXISTENTES QUE SE RESPETAN (no se abren el menu por encima):
   - Modo nodos activo  -> clic derecho SALIE del modo (contextualMenu.js
     y nodeEditor.js ya lo hacen en captura; aca ni entramos).
   - Insertar texto     -> clic derecho cancela el modo (ya implementado).
   - Edicion de fusion  -> clic derecho cierra la edicion (selection.js).
   - Editor de texto enfocado -> menu nativo del navegador (edicion de
     texto). Aca tampoco entramos.

   COMO EJECUTA CADA ENTRADA (cero codigo de accion nuevo):
   - comando -> el item lleva data-ekko-command y el dispatcher del
     puente (panelCommandBridge.js) lo resuelve: paneles, recientes,
     historial y avisos funcionan identicos a la cinta.
   - boton   -> dispara el click del boton real de la interfaz (mismo
     selector data-fusion-btn): reutiliza TODO el cableado existente.
   - fn      -> llama un global que ya existe (deleteImage,
     duplicateSelectedItem, bringFront...). Nunca implementa la accion.
   ========================================================================= */

import { describeSelection, SPECIES } from "../capabilities.js";

const CANVAS_ID = "editorCanvas";
const MENU_ID = "ekko-context-menu";

let menuEl = null;
let cierresInstalados = false;

/* ------------------------------------------------------------------
   SNAPSHOT Y CLASIFICACION (solo lectura)
   ------------------------------------------------------------------ */

function snapActual() {
    try { return window.EKKO_TOOLBAR_STORE?.compute?.() || null; }
    catch (_) { return null; }
}

/* Contexto C0-C8 + C9 (modo nodos) + CX (mezclas con texto que la propuesta
   v2 no define: se atiende con lo basico). */
export function clasificarContexto(snap) {
    if (typeof window !== "undefined" && window.nodeEditMode === true) return "C9";
    if (!snap || !snap.hasSelection) return "C0";
    const s = snap.summary;
    if (!s || !s.count) return "C0";
    if (s.hasMixed) return "C5";
    if (s.count === 1) {
        const sp = [...s.species][0];
        if (sp === SPECIES.RASTER) return "C2";
        if (sp === SPECIES.TEXT) return "C3";
        if (sp === SPECIES.VECTOR) {
            const owner = s.list[0]?.owner;
            if (owner?.data?.isSmartFusion) return "C1F";
            if (owner?.className === "Group") return "C4";
            return "C1";
        }
        return "CX";
    }
    /* count >= 2 */
    const especies = [...s.species];
    if (especies.length === 1 && especies[0] === SPECIES.VECTOR) {
        return s.fusions.length ? "C8" : "C6";
    }
    if (especies.length === 2 && especies.includes(SPECIES.RASTER)
        && especies.includes(SPECIES.VECTOR)) return "C7";
    return "CX";
}

/* ------------------------------------------------------------------
   ACCIONES (todas reutilizan codigo existente)
   ------------------------------------------------------------------ */

function seleccionarTodo() {
    const designLayer = paper.project.layers.find(l => l.name === "designLayer")
        || paper.project.activeLayer;
    const items = (typeof window.EKKO_OWNER_GRAPH?.collectOwners === "function")
        ? window.EKKO_OWNER_GRAPH.collectOwners(designLayer)
        : (designLayer?.children || []);
    if (items.length && typeof window.commitSelectionContext === "function") {
        window.commitSelectionContext(items, items[items.length - 1], "select-all");
    } else if (items.length && typeof window.selectItem === "function") {
        window.selectItem(items[items.length - 1]);
    }
    try { paper.view.update(); } catch (_) {}
}

function deseleccionarTodo() {
    if (typeof window.deselectItem === "function") { window.deselectItem(); return; }
    try { paper.project.deselectAll?.(); } catch (_) {}
    window.selectedItems = [];
    window.selectedItem = null;
}

const fnApilado = {
    frente: () => window.bringFront?.(),
    subir: () => window.bringForward?.(),
    bajar: () => window.sendBackward?.(),
    fondo: () => window.sendBack?.()
};

/* ------------------------------------------------------------------
   MATRIZ DE ENTRADAS POR CONTEXTO
   tool    -> nombre canonico de capabilities.js: gatea con enabledTools
   comando -> data-ekko-command (dispatcher del puente)
   boton   -> selector del boton real de la interfaz
   fn      -> global existente
   bloqueada -> entrada "util bloqueada": se muestra atenuada con motivo
   ------------------------------------------------------------------ */

const APILADO = [
    { etiqueta: "Al frente", grupo: "Apilado", fn: fnApilado.frente },
    { etiqueta: "Subir capa", grupo: "Apilado", fn: fnApilado.subir },
    { etiqueta: "Bajar capa", grupo: "Apilado", fn: fnApilado.bajar },
    { etiqueta: "Al fondo", grupo: "Apilado", fn: fnApilado.fondo }
];

const EDITAR = [
    { etiqueta: "Duplicar", grupo: "Editar", fn: () => window.duplicateSelectedItem?.() },
    { etiqueta: "Eliminar", grupo: "Editar", fn: () => window.deleteImage?.(window.selectedItem) }
];

const FUSIONAR_BLOQUEADA = {
    etiqueta: "Fusionar", grupo: "Fusión", tool: "fusion",
    bloqueada: "Fusionar necesita una imagen y un vector seleccionados"
};

function entradasDe(contexto, snap) {
    const t = name => snap.enabledTools?.has?.(name) || false;

    switch (contexto) {
        case "C9": { // modo nodos activo — el gesto de salida es DOBLE clic derecho
            return [
                /* Reutilizan los botones reales de la emergente: el mismo
                   handler medido (incluye la limpieza que hace "Listo"). */
                { etiqueta: "Listo (salir del modo)", grupo: "Nodos", boton: "#btnCtxExitNodeEdit" },
                { etiqueta: "Eliminar Nodo", grupo: "Nodos", boton: "#btnCtxDeleteNode" }
            ];
        }

        case "C0": {
            const base = [
                { etiqueta: "Pegar", grupo: "Portapapeles", fn: () => window.pasteSelected?.() },
                { etiqueta: "Seleccionar Todo", grupo: "Selección", fn: seleccionarTodo }
            ];
            if (snap.hasSelection) {
                base.push({ etiqueta: "Deseleccionar", grupo: "Selección", fn: deseleccionarTodo });
            }
            return base;
        }

        case "C1": { // 1 vector simple
            const items = [
                { etiqueta: "Editar Nodos", grupo: "Editar", tool: "editNodes", boton: "[data-fusion-btn='editNodes']" },
                { etiqueta: "Tijera", grupo: "Editar", tool: "cutSegment", boton: "[data-fusion-btn='cutSegment']" },
                ...EDITAR,
                { etiqueta: "Contorno", grupo: "Geometría", tool: "outline", comando: "contorno" },
                { etiqueta: "Calar", grupo: "Geometría", tool: "calado", boton: "[data-fusion-btn='calado']" },
                { etiqueta: "Rellenar", grupo: "Geometría", tool: "rellenar", comando: "rellenar" },
                { etiqueta: "Sólidos ⇄ Huecos", grupo: "Geometría", tool: "solidHole", comando: "solidHole" },
                { etiqueta: "Auditar Vectores", grupo: "Geometría", tool: "audit", boton: "#btnAuditVectors" },
                ...APILADO
            ];
            if (!t("fusion")) items.push({ ...FUSIONAR_BLOQUEADA, forzarBloqueada: true });
            return items;
        }

        case "C1F": { // 1 fusion (vector con imagen adentro)
            return [
                { etiqueta: "Editar Imagen Interna", grupo: "Fusión", tool: "editFusionImage", boton: "[data-fusion-btn='editFusionImage']" },
                { etiqueta: "Quitar Fusión", grupo: "Fusión", comando: "releaseSmartFusion" },
                { etiqueta: "Editar Nodos", grupo: "Editar", tool: "editNodes", boton: "[data-fusion-btn='editNodes']" },
                ...EDITAR,
                { etiqueta: "Contorno", grupo: "Geometría", tool: "outline", comando: "contorno" },
                ...APILADO
            ];
        }

        case "C2": { // 1 imagen
            const items = [];
            if (t("removeBg")) items.push({ etiqueta: "Quitar Fondo", grupo: "Imagen", tool: "removeBg", boton: "[data-fusion-btn='removeBg']" });
            if (t("editCutout")) items.push({ etiqueta: "Editar Fondo", grupo: "Imagen", tool: "editCutout", comando: "abrirEditorFondo" });
            if (t("traceImage")) items.push({ etiqueta: "Trazar Imagen", grupo: "Imagen", tool: "traceImage", comando: "traceImage" });
            items.push(
                { etiqueta: "Contorno", grupo: "Imagen", tool: "outline", comando: "contorno" },
                ...EDITAR,
                ...APILADO
            );
            if (!t("fusion")) items.push({ ...FUSIONAR_BLOQUEADA, forzarBloqueada: true });
            return items;
        }

        case "C3": { // 1 texto — D3: SIN controles de texto
            const items = [
                { etiqueta: "Texto a Vector", grupo: "Convertir", tool: "textToVector", boton: "[data-fusion-btn='textToVector']" },
                { etiqueta: "Contorno", grupo: "Convertir", tool: "outline", comando: "contorno" },
                ...EDITAR,
                ...APILADO
            ];
            if (!t("fusion")) items.push({ ...FUSIONAR_BLOQUEADA, forzarBloqueada: true });
            return items;
        }

        case "C4": { // grupo SVG solo-vectores
            return [
                { etiqueta: "Desagrupar", grupo: "Estructura", tool: "ungroup", comando: "ungroup" },
                { etiqueta: "Descomponer Vector", grupo: "Estructura", tool: "decomposeVector", comando: "decomposeVector" },
                { etiqueta: "Editar Nodos", grupo: "Editar", tool: "editNodes", boton: "[data-fusion-btn='editNodes']" },
                ...EDITAR,
                { etiqueta: "Contorno", grupo: "Geometría", tool: "outline", comando: "contorno" },
                { etiqueta: "Auditar Vectores", grupo: "Geometría", tool: "audit", boton: "#btnAuditVectors" },
                ...APILADO
            ];
        }

        case "C5": { // grupo mixto (SVG con imagen) — D2
            return [
                { etiqueta: "Desagrupar", grupo: "Estructura", tool: "ungroup", comando: "ungroup" },
                /* D2: regla PROPIA del menu. El motor no habilita estas dos
                   aca (resolveToolNames devuelve solo ungroup); borrar o
                   duplicar el grupo entero es una accion de seleccion, no
                   de edicion por especie. */
                { etiqueta: "Duplicar", grupo: "Editar", fn: () => window.duplicateSelectedItem?.(), siempre: true },
                { etiqueta: "Eliminar", grupo: "Editar", fn: () => window.deleteImage?.(window.selectedItem), siempre: true },
                ...APILADO
            ];
        }

        case "C6": { // 2+ vectores
            const items = [];
            if (t("boolean")) {
                items.push(
                    { etiqueta: "Unión", grupo: "Booleanas", comando: "booleanUnion" },
                    { etiqueta: "Intersección", grupo: "Booleanas", comando: "booleanIntersect" },
                    { etiqueta: "Restar", grupo: "Booleanas", comando: "booleanSubtract" },
                    { etiqueta: "Diferencia", grupo: "Booleanas", comando: "booleanDifference" }
                );
            }
            items.push(
                { etiqueta: "Agrupar", grupo: "Estructura", tool: "group", fn: () => window.groupSelectedItems?.() },
                { etiqueta: "Tijera", grupo: "Geometría", tool: "cutSegment", boton: "[data-fusion-btn='cutSegment']" },
                { etiqueta: "Contorno", grupo: "Geometría", tool: "outline", comando: "contorno" },
                { etiqueta: "Sólidos ⇄ Huecos", grupo: "Geometría", tool: "solidHole", comando: "solidHole" },
                { etiqueta: "Auditar Vectores", grupo: "Geometría", tool: "audit", boton: "#btnAuditVectors" },
                /* Alinear/Distribuir: presentes pero discretos (el cliente
                   pidio que esten sin ser prioridad). Acciones directas que
                   ya existen en window (canvasControlsIntegration). */
                { etiqueta: "Centrar Horizontal", grupo: "Alinear", fn: () => window.centerSelection?.("h") },
                { etiqueta: "Centrar Vertical", grupo: "Alinear", fn: () => window.centerSelection?.("v") },
                { etiqueta: "Distribuir Horizontal", grupo: "Alinear", tool: "distribute", fn: () => window.distributeSelection?.("h") },
                { etiqueta: "Distribuir Vertical", grupo: "Alinear", tool: "distribute", fn: () => window.distributeSelection?.("v") },
                ...EDITAR,
                ...APILADO
            );
            if (!t("fusion")) items.push({ ...FUSIONAR_BLOQUEADA, forzarBloqueada: true });
            return items;
        }

        case "C7": { // imagen + vector
            const items = [];
            if (t("fusion")) items.push({ etiqueta: "Fusionar", grupo: "Fusión", comando: "performSmartFusion" });
            items.push(
                { etiqueta: "Contorno", grupo: "Geometría", tool: "outline", comando: "contorno" },
                ...EDITAR,
                ...APILADO
            );
            return items;
        }

        case "C8": { // fusiones (1 o varias)
            const items = [
                { etiqueta: "Quitar Fusión", grupo: "Fusión", comando: "releaseSmartFusion" }
            ];
            if (snap.summary.count === 1) {
                items.push({ etiqueta: "Editar Imagen Interna", grupo: "Fusión", tool: "editFusionImage", boton: "[data-fusion-btn='editFusionImage']" });
            }
            items.push(...EDITAR, ...APILADO);
            return items;
        }

        default: // CX: mezclas con texto y otros casos sin definir en v2
            return [...EDITAR, ...APILADO];
    }
}

/* ------------------------------------------------------------------
   HIT-TEST: clic derecho selecciona lo que esta bajo el cursor
   (estandar Windows) sin pisar una seleccion multiple vigente.
   ------------------------------------------------------------------ */

function seleccionarBajoCursor(evento) {
    try {
        const canvas = document.getElementById(CANVAS_ID);
        if (!canvas || typeof paper === "undefined") return;
        const rect = canvas.getBoundingClientRect();
        const punto = paper.view.viewToProject(new paper.Point(
            evento.clientX - rect.left, evento.clientY - rect.top));
        const hit = paper.project.hitTest(punto, {
            fill: true, stroke: true, segments: false, handles: false,
            tolerance: 8 / (paper.view.zoom || 1)
        });
        if (!hit?.item) return;
        const snap = describeSelection([hit.item]);
        const owner = snap.list[0]?.owner || null;
        if (!owner) return; // UI overlay o pieza de mockup: no se selecciona
        const yaEsta = (window.selectedItems || []).some(it => it === owner || it === hit.item);
        if (!yaEsta && typeof window.selectItem === "function") window.selectItem(owner);
    } catch (_) {}
}

/* ------------------------------------------------------------------
   RENDER Y CICLO DE VIDA DEL MENU
   ------------------------------------------------------------------ */

function estiloInyectado() {
    if (document.getElementById("ekko-context-menu-style")) return;
    const style = document.createElement("style");
    style.id = "ekko-context-menu-style";
    style.textContent = `
.ekko-ctx-menu {
  position: fixed; z-index: 99999; min-width: 190px; max-width: 280px;
  background: #111827; border: 1px solid #374151; border-radius: 8px;
  box-shadow: 0 10px 30px rgba(0,0,0,.45); padding: 5px;
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  user-select: none;
}
.ekko-ctx-menu .ekko-ctx-grupo {
  font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
  color: #9ca3af; padding: 5px 9px 3px; cursor: default;
}
.ekko-ctx-menu .ekko-ctx-sep { height: 1px; background: #374151; margin: 4px 6px; }
.ekko-ctx-menu .ekko-ctx-item {
  display: block; width: 100%; text-align: left; border: 0; background: none;
  color: #e5e7eb; font-size: 13px; line-height: 1; padding: 7px 10px;
  border-radius: 5px; cursor: pointer; white-space: nowrap;
}
.ekko-ctx-menu .ekko-ctx-item:hover { background: #374151; }
.ekko-ctx-menu .ekko-ctx-item.ekko-ctx-bloqueada {
  opacity: .45; cursor: not-allowed;
}
.ekko-ctx-menu .ekko-ctx-item.ekko-ctx-bloqueada:hover { background: none; }
.ekko-ctx-menu .ekko-ctx-icono { opacity: .55; margin-right: 2px; }
`;
    document.head.appendChild(style);
}

function habilitado(item, snap) {
    if (item.siempre) return true;                 // regla propia del menu (D2)
    if (item.bloqueada && item.forzarBloqueada) return false;
    if (item.tool) return !!snap.enabledTools?.has?.(item.tool);
    return true;
}

function construirMenu(contexto, snap) {
    const menu = document.createElement("div");
    menu.id = MENU_ID;
    menu.className = "ekko-ctx-menu";
    menu.setAttribute("role", "menu");
    menu.data = { ekkoContextMenu: true, uiOnly: true };

    let grupoPrevio = null;
    for (const item of entradasDe(contexto, snap)) {
        if (item.grupo && item.grupo !== grupoPrevio) {
            if (grupoPrevio !== null) {
                const sep = document.createElement("div");
                sep.className = "ekko-ctx-sep";
                menu.appendChild(sep);
            }
            const h = document.createElement("div");
            h.className = "ekko-ctx-grupo";
            h.textContent = item.grupo;
            menu.appendChild(h);
            grupoPrevio = item.grupo;
        }
        const activa = habilitado(item, snap);
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ekko-ctx-item" + (activa ? "" : " ekko-ctx-bloqueada");
        btn.setAttribute("role", "menuitem");
        btn.textContent = (activa ? "" : "🔒 ") + item.etiqueta;
        if (!activa) {
            btn.title = item.bloqueada || "Acción no disponible para la selección actual";
            btn.addEventListener("click", ev => {
                ev.preventDefault();
                window.ekkoNotice?.(btn.title, { kind: "warn" })
                    || window.EKKO_NOTICE?.notice?.(btn.title, { kind: "warn" });
                cerrar();
            });
        } else if (item.comando) {
            /* El dispatcher del puente resuelve el comando en captura;
               aca solo cerramos despues (mismo nodo, orden de registro). */
            btn.dataset.ekkoCommand = item.comando;
        } else if (item.boton) {
            btn.addEventListener("click", () => {
                const real = document.querySelector(item.boton);
                if (!real) { cerrar(); return; }
                if (real.classList.contains("ekko-locked") || real.disabled) {
                    const motivo = real.getAttribute("data-ekko-reason")
                        || "Acción no disponible para la selección actual";
                    window.ekkoNotice?.(motivo, { kind: "warn" })
                        || window.EKKO_NOTICE?.notice?.(motivo, { kind: "warn" });
                } else {
                    real.click();
                }
                cerrar();
            });
        } else if (item.fn) {
            btn.addEventListener("click", () => { cerrar(); item.fn(); });
        }
        menu.appendChild(btn);
    }
    return menu;
}

function instalarCierres() {
    if (cierresInstalados) return;
    cierresInstalados = true;
    document.addEventListener("click", evento => {
        if (!menuEl) return;
        if (menuEl.contains(evento.target)) return; // adentro: la accion fluye
        cerrar();
    }, true);
    document.addEventListener("keydown", evento => {
        if (menuEl && evento.key === "Escape") cerrar();
    }, true);
    document.addEventListener("wheel", () => { if (menuEl) cerrar(); }, { passive: true });
    window.addEventListener("resize", () => { if (menuEl) cerrar(); });
    document.addEventListener("contextmenu", evento => {
        if (!menuEl) return;
        if (menuEl.contains(evento.target)) { evento.preventDefault(); return; }
        cerrar(); // clic derecho en otra parte: el menu viejo no persiste
    }, true);
}

export function cerrar() {
    if (!menuEl) return false;
    const viejo = menuEl;
    menuEl = null;
    try { viejo.remove(); } catch (_) {}
    return true;
}

export function isOpen() { return !!menuEl; }

export function abrirEn(clientX, clientY) {
    const snap = snapActual();
    if (!snap) return false;
    /* El modo nodos YA se atiende en el manejador del canvas (C9): aca no
       se bloquea. Los otros modos (insertar texto, edicion de fusion)
       siguen teniendo su gesto propio y no abren menu. */
    if (window.insertTextMode || window.fusionEditActive) return false;

    const contexto = clasificarContexto(snap);
    const entradas = entradasDe(contexto, snap);
    if (!entradas.length) return false;

    estiloInyectado();
    cerrar();
    const menu = construirMenu(contexto, snap);
    document.body.appendChild(menu);

    /* Ajuste a la ventana: medir una vez montado. */
    const caja = menu.getBoundingClientRect();
    const x = Math.max(4, Math.min(clientX, window.innerWidth - caja.width - 8));
    const y = Math.max(4, Math.min(clientY, window.innerHeight - caja.height - 8));
    menu.style.left = x + "px";
    menu.style.top = y + "px";

    menuEl = menu;
    instalarCierres();
    return true;
}

/* ------------------------------------------------------------------
   ENTRADA: contextmenu sobre el lienzo, en BURBUJA (los gestos
   existentes corren antes, en captura, y preventDefault nos avisa).
   ------------------------------------------------------------------ */

function installContextMenu() {
    if (window._ekkoContextMenuInstalled) return;
    window._ekkoContextMenuInstalled = true;
    let ultimoContextmenuNodos = 0;
    const canvas = document.getElementById(CANVAS_ID);
    if (!canvas) return;
    canvas.addEventListener("contextmenu", evento => {
        /* MODO NODOS: el gesto lo define el cliente. UN clic derecho abre el
           menu de nodos (Listo / Eliminar Nodo); DOBLE clic derecho sale del
           modo directo, para que el "salir/aceptar" no se confunda con el
           clic que abre el menu. Los handlers de captura de contextualMenu.js
           y nodeEditor.js ya cortaron el menu del navegador. */
        if (window.nodeEditMode) {
            evento.preventDefault();
            const ahora = Date.now();
            if (ahora - ultimoContextmenuNodos < 450) {
                ultimoContextmenuNodos = 0;
                cerrar();
                try { window.exitNodeEditMode?.(); } catch (_) {}
                return;
            }
            ultimoContextmenuNodos = ahora;
            abrirEn(evento.clientX, evento.clientY);
            return;
        }
        ultimoContextmenuNodos = 0;

        /* Gestos ya atendidos en captura (insertar texto): no hay menu.
           Edicion de fusion: su cierre es el gesto, tampoco. */
        if (evento.defaultPrevented) return;
        if (window.fusionEditActive) return;
        if (window.insertTextMode) return;
        const editor = document.getElementById("ekko-text-editor");
        if (editor && document.activeElement === editor) return;

        evento.preventDefault();
        seleccionarBajoCursor(evento);
        abrirEn(evento.clientX, evento.clientY);
    });
}

/* ------------------------------------------------------------------
   API PUBLICA (y puerta de prueba para las sondas)
   ------------------------------------------------------------------ */

if (typeof window !== "undefined") {
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", installContextMenu, { once: true });
    } else {
        installContextMenu();
    }
    window.EKKO_CONTEXT_MENU = Object.freeze({
        abrirEn, cerrar, isOpen,
        /* Para sondas: que contexto y entradas habria AHORA, sin abrir nada. */
        diagnostico() {
            const snap = snapActual();
            if (!snap) return null;
            const contexto = clasificarContexto(snap);
            return {
                contexto,
                entradas: entradasDe(contexto, snap).map(it => ({
                    etiqueta: it.etiqueta,
                    grupo: it.grupo || null,
                    habilitada: habilitado(it, snap)
                }))
            };
        }
    });
}

import { isProductElement, isValidFusionReceptor, isClosedClientVector, canConvertToCalado, findFusionVector, findFusionRaster } from "./fusionCore.js";
import { canConvertSelectionToCalado, convertSelectionToSolid } from "./calado.js";
import { semanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { dispatchUngroup, dispatchVectorDecomposition, canDecomposeVector, getUngroupRoute, UNGROUP_ROUTE } from "./ungroupRoutes.js";
import { getPublicOwner } from "./designGeometry.js";

/* =========================================================================
   EKKO STUDIO — PANEL COMMAND BRIDGE / FASE 4.2
   Fuente única para sincronizar los comandos visibles en:
   - panel superior (#topBar)
   - barra profesional (#pro-layout-toolbar)
   - barra emergente (#contextual-toolbar)

   No ejecuta operaciones geométricas. Solo decide qué comandos se muestran.
========================================================================= */

const PRO_COMMAND_IDS = {
    proBtnFusionar: "fusion",
    proBtnQuitarFusion: "unfusion",
    proBtnCalado: "calado",
    proBtnRellenar: "rellenar",
    proBtnTextToVector: "textToVector",
    proBtnGroup: "group",
    proBtnUngroup: "ungroup",
    proBtnDecomposeVector: "decomposeVector",
    proBtnEditNodes: "editNodes",
    proBtnDistributeH: "distribute",
    proBtnDistributeV: "distribute",
    proBtnToggleRulers: "rulers",
    proBtnToggleGuides: "guides",
    proBtnToggleMeasurements: "measurements",
    proBtnCenterH: "align",
    proBtnCenterV: "align",
    proBtnCenterBoth: "align",
    proBtnAlignLeft: "align",
    proBtnAlignCenterH: "align",
    proBtnAlignRight: "align",
    proBtnAlignTop: "align",
    proBtnAlignCenterV: "align",
    proBtnAlignBottom: "align"
};

const CONTEXT_COMMANDS = {
    none: ["zoom", "rulers", "guides", "measurements"],
    image: ["removeBg", "traceImage", "group", "zoom", "rulers", "guides", "measurements"],
    text: ["textToVector", "group", "align", "zoom", "rulers", "guides", "measurements"],
    vector: ["editNodes", "calado", "rellenar", "outline", "decomposeVector", "group", "align", "zoom", "rulers", "guides", "measurements"],
    multiple: ["group", "align", "distribute", "zoom", "rulers", "guides", "measurements"],
    fusion: ["calado", "rellenar", "unfusion", "editFusionImage", "zoom", "rulers", "guides", "measurements"],
    mixed: ["fusion", "group", "align", "zoom", "rulers", "guides", "measurements"]
};

let initialized = false;
let refreshTimer = null;
let commandDispatcherInstalled = false;

// Registry of commands declared by data-ekko-command.  The bridge is the
// single UI entry point; the registry only delegates to existing owners.
const COMMAND_HANDLERS = Object.freeze({
    rellenar: () => convertSelectionToSolid(),
    performSmartFusion: () => typeof window.performSmartFusion === "function"
        ? window.performSmartFusion()
        : null,
    releaseSmartFusion: () => {
        if (typeof window.releaseSmartFusion !== "function") return null;
        const selected = window.selectedItems && window.selectedItems.length
            ? [...window.selectedItems]
            : (window.selectedItem ? window.selectedItem : null);
        return window.releaseSmartFusion(selected);
    },
    ungroup: () => dispatchUngroup(),
    decomposeVector: () => dispatchVectorDecomposition()
});

export function dispatchEKKOCommand(command, element = null) {
    const handler = COMMAND_HANDLERS[command];
    if (typeof handler !== "function") {
        console.warn(`[EKKO COMMANDS] Comando no registrado: ${command}`);
        return null;
    }
    try {
        const result = handler(element);
        window.EKKO_DIAG?.logEvent?.("command.dispatch", {
            command,
            elementId: element?.id || null,
            ok: true
        });
        return result;
    } catch (error) {
        window.EKKO_DIAG?.logEvent?.("command.dispatch", {
            command,
            elementId: element?.id || null,
            ok: false,
            error: String(error)
        });
        console.error(`[EKKO COMMANDS] Fallo en ${command}`, error);
        return null;
    }
}

function installCommandDispatcher() {
    // Listen on document, not #workspace: the floating contextual toolbar is
    // moved to document.body at runtime (contextualMenu.js), so workspace
    // scoped clicks never reach its [data-ekko-command] buttons (Rellenar,
    // Desagrupar, Descomponer...). The selector already scopes the handler.
    if (commandDispatcherInstalled) return;

    document.addEventListener("click", event => {
        const element = event.target?.closest?.("[data-ekko-command]");
        if (!element || !document.contains(element)) return;
        if (element.disabled || element.classList.contains("ekko-command-hidden")) return;

        // Capture declared commands before any future inline/bubble handler.
        event.preventDefault();
        event.stopPropagation();
        dispatchEKKOCommand(element.dataset.ekkoCommand, element);
    }, true);
    commandDispatcherInstalled = true;
}

function unwrap(item) {
    return getPublicOwner(item) || null;
}

function getSelectedItems() {
    if (window.selectedItems && window.selectedItems.length) return [...window.selectedItems];
    return window.selectedItem ? [window.selectedItem] : [];
}

function classifySelection() {
    const selected = getSelectedItems();
    if (!selected.length) return { context: "none", counts: {} };

    const counts = {
        raster: 0,
        vector: 0,
        text: 0,
        fusion: 0,
        other: 0
    };

    selected.forEach(raw => {
        const item = unwrap(raw);
        if (!item) {
            counts.other++;
            return;
        }

        if (item.data && item.data.isSmartFusion) {
            counts.fusion++;
        } else if (item.className === "Raster") {
            counts.raster++;
        } else if (item.className === "PointText" || (item.data && (item.data.isText || item.data.isCurvedGroup || item.data.isSpacedGroup))) {
            counts.text++;
        } else if (["Path", "CompoundPath", "Group", "Shape", "SymbolItem", "PlacedSymbol"].includes(item.className)) {
            counts.vector++;
        } else {
            counts.other++;
        }
    });

    const typeCount = ["raster", "vector", "text", "fusion", "other"].filter(type => counts[type] > 0).length;
    let context = "multiple";
    let canUngroup = false;
    let canDecompose = false;
    let canFusion = false;
    let canCalado = false;
    let canRellenar = false;
    const singleTarget = selected.length === 1 ? unwrap(selected[0]) : null;
    if (singleTarget) {
        try { canCalado = canConvertSelectionToCalado(singleTarget); } catch (e) { canCalado = false; }
        try { canRellenar = semanticKind(singleTarget) === VECTOR_KIND.HOLE; } catch (e) { canRellenar = false; }
        // Fallback defensivo para CompoundPath dentro de clipGroup. El botón
        // debe aparecer para un sólido público, aunque el wrapper no se haya
        // resuelto todavía por la ruta principal de Calado.
        if (!canCalado) {
            try {
                const candidate = findFusionVector(singleTarget) || singleTarget;
                canCalado = !!candidate &&
                    !isProductElement(candidate) &&
                    isClosedClientVector(candidate) &&
                    canConvertToCalado(candidate);
            } catch (e) { canCalado = false; }
        }
    }

    if (selected.length === 2) {
        const items = selected.map(unwrap).filter(Boolean);
        const raster = items.map(findFusionRaster).find(Boolean);
        const vector = items.map(findFusionVector).find(Boolean);
        canFusion = !!(raster && vector && !isProductElement(raster) && isValidFusionReceptor(vector));
    }

    if (singleTarget) {
        try { canUngroup = getUngroupRoute(singleTarget) !== UNGROUP_ROUTE.NONE; }
        catch (_) { canUngroup = false; }
        try { canDecompose = canDecomposeVector(singleTarget); }
        catch (_) { canDecompose = false; }
    }

    if (counts.fusion === selected.length) {
        context = "fusion";
    } else if (selected.length === 2 && counts.raster === 1 && counts.vector === 1) {
        context = "mixed";
    } else if (selected.length === 1 && counts.raster === 1) {
        context = "image";
    } else if (selected.length === 1 && counts.text === 1) {
        context = "text";
    } else if (selected.length === 1 && counts.vector === 1) {
        context = "vector";
    } else if (selected.length > 1) {
        // Toda selección múltiple conserva el contexto "multiple".
        // Incluso si todos sus elementos son vectores, debe habilitar
        // Agrupar, Alinear y Distribuir como conjunto.
        context = "multiple";
    }

    return { context, counts, canUngroup, canDecompose, canFusion, canCalado, canRellenar };
}

function tagProfessionalButtons() {
    Object.entries(PRO_COMMAND_IDS).forEach(([id, command]) => {
        const button = document.getElementById(id);
        if (button) {
            button.dataset.fusionBtn = command;
            button.dataset.commandSurface = "shared";
        }
    });
}

function getSharedCommandElements() {
    tagProfessionalButtons();
    return [...document.querySelectorAll("#topBar [data-fusion-btn], #pro-layout-toolbar [data-fusion-btn], #contextual-toolbar [data-fusion-btn]")];
}

function applyCommandVisibility() {
    const selection = classifySelection();
    const allowed = new Set(CONTEXT_COMMANDS[selection.context] || CONTEXT_COMMANDS.none);
    if (selection.canUngroup) allowed.add("ungroup");
    if (selection.canDecompose) allowed.add("decomposeVector");
    else allowed.delete("decomposeVector");
    if (!selection.canFusion) allowed.delete("fusion");
    if (!selection.canCalado) allowed.delete("calado");
    if (!selection.canRellenar) allowed.delete("rellenar");
    const elements = getSharedCommandElements();

    elements.forEach(element => {
        const command = element.dataset.fusionBtn;
        const show = allowed.has(command);
        element.dataset.commandSurface = "shared";
        element.classList.toggle("ekko-command-hidden", !show);
        element.style.display = show ? "" : "none";
    });

    window.EKKO_COMMAND_STATE = {
        context: selection.context,
        counts: selection.counts,
        canUngroup: selection.canUngroup,
        canDecompose: selection.canDecompose,
        canFusion: selection.canFusion,
        canCalado: selection.canCalado,
        canRellenar: selection.canRellenar,
        allowedCommands: [...allowed],
        timestamp: Date.now()
    };

    return window.EKKO_COMMAND_STATE;
}

function enforceCommandVisibility() {
    applyCommandVisibility();
    // contextualMenu.js y canvasControlsIntegration.js también actualizan
    // estilos después de la selección. Reaplicamos al final de ese ciclo.
    setTimeout(applyCommandVisibility, 0);
    setTimeout(applyCommandVisibility, 60);
}

function scheduleRefresh() {
    if (refreshTimer) cancelAnimationFrame(refreshTimer);
    refreshTimer = requestAnimationFrame(() => {
        refreshTimer = null;
        enforceCommandVisibility();
    });
}

function wrapToolbarRefresh() {
    const original = window.refreshAllToolbars;
    if (typeof original !== "function" || original.__ekkoCommandBridgeWrapped) return;

    const wrapped = function () {
        const result = original.apply(this, arguments);
        scheduleRefresh();
        return result;
    };

    wrapped.__ekkoCommandBridgeWrapped = true;
    window.refreshAllToolbars = wrapped;
}

function observeProfessionalToolbar() {
    const workspace = document.getElementById("workspace");
    if (!workspace || workspace.__ekkoCommandObserver) return;

    const observer = new MutationObserver(() => {
        tagProfessionalButtons();
        scheduleRefresh();
    });

    observer.observe(workspace, { childList: true, subtree: true });
    workspace.__ekkoCommandObserver = observer;
}

export function refreshSharedCommands() {
    wrapToolbarRefresh();
    enforceCommandVisibility();
    return window.EKKO_COMMAND_STATE;
}

export function initPanelCommandBridge() {
    if (initialized) return;
    initialized = true;

    tagProfessionalButtons();
    installCommandDispatcher();
    observeProfessionalToolbar();
    wrapToolbarRefresh();
    applyCommandVisibility();

    window.refreshEKKOSharedCommands = refreshSharedCommands;
    console.log("%c[EKKO COMMANDS] Superficies de comandos sincronizadas.", "color:#7c3aed;font-weight:bold;");
}

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
        initPanelCommandBridge();
        setTimeout(refreshSharedCommands, 0);
    }, { once: true });
} else {
    initPanelCommandBridge();
}

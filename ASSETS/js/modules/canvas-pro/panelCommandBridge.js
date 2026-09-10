/* =========================================================================
   EKKO STUDIO — PANEL COMMAND BRIDGE / FASE 2
   Fuente única para sincronizar los comandos visibles en:
   - panel superior (#topBar)
   - barra profesional (#pro-layout-toolbar)
   - barra emergente (#contextual-toolbar)

   No ejecuta operaciones geométricas. Solo decide qué comandos se muestran.
========================================================================= */

const PRO_COMMAND_IDS = {
    proBtnFusionar: "fusion",
    proBtnQuitarFusion: "unfusion",
    proBtnGroup: "group",
    proBtnUngroup: "ungroup",
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
    text: ["group", "align", "zoom", "rulers", "guides", "measurements"],
    vector: ["editNodes", "outline", "group", "align", "zoom", "rulers", "guides", "measurements"],
    multiple: ["group", "align", "distribute", "zoom", "rulers", "guides", "measurements"],
    fusion: ["unfusion", "editFusionImage", "zoom", "rulers", "guides", "measurements"],
    mixed: ["fusion", "group", "align", "zoom", "rulers", "guides", "measurements"]
};

let initialized = false;
let refreshTimer = null;

function unwrap(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup && item.children) {
        return item.children.find(child => !child.clipMask && !(child.data && (child.data.isMask || child.data.wasClipMask))) || item;
    }
    return item;
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

    return { context, counts };
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
        allowedCommands: [...allowed],
        timestamp: Date.now()
    };

    return window.EKKO_COMMAND_STATE;
}

function scheduleRefresh() {
    if (refreshTimer) cancelAnimationFrame(refreshTimer);
    refreshTimer = requestAnimationFrame(() => {
        refreshTimer = null;
        applyCommandVisibility();
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
    return applyCommandVisibility();
}

export function initPanelCommandBridge() {
    if (initialized) return;
    initialized = true;

    tagProfessionalButtons();
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

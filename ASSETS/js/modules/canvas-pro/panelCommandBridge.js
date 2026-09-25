import { isProductElement, isValidFusionReceptor, isClosedClientVector, canConvertToCalado, findFusionVector, findFusionRaster } from "./fusionCore.js";
import { canConvertSelectionToCalado, convertSelectionToSolid } from "./calado.js";
import { semanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { dispatchUngroup, dispatchVectorDecomposition, canDecomposeVector, getUngroupRoute, UNGROUP_ROUTE } from "./ungroupRoutes.js";
import { getPublicOwner, getOwnerLocalGeometry } from "./designGeometry.js";
import { installOwnerGeometry, recalculateDynamicSubtractions, normalizeSubtractiveOperand } from "./geometricUngroup.js";

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
    proBtnAlignBottom: "align",
    // Boolean operations
    proBtnBooleanUnion: "booleanUnion",
    proBtnBooleanSubtract: "booleanSubtract",
    proBtnBooleanIntersect: "booleanIntersect",
    proBtnBooleanDifference: "booleanDifference"
};

const CONTEXT_COMMANDS = {
    none: ["zoom", "rulers", "guides", "measurements"],
    image: ["removeBg", "traceImage", "group", "zoom", "rulers", "guides", "measurements"],
    text: ["textToVector", "group", "align", "zoom", "rulers", "guides", "measurements"],
    vector: ["editNodes", "calado", "rellenar", "outline", "decomposeVector", "group", "align", "zoom", "rulers", "guides", "measurements", "booleanUnion", "booleanSubtract", "booleanIntersect", "booleanDifference"],
    multiple: ["group", "align", "distribute", "zoom", "rulers", "guides", "measurements", "booleanUnion", "booleanSubtract", "booleanIntersect", "booleanDifference"],
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
    decomposeVector: () => dispatchVectorDecomposition(),
    // Boolean operations (vector ↔ vector)
    booleanUnion: () => performBooleanOperation("union"),
    booleanSubtract: () => performBooleanOperation("subtract"),
    booleanIntersect: () => performBooleanOperation("intersect"),
    booleanDifference: () => performBooleanOperation("difference"),
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

// =========================================================================
// BOOLEANAS VECTOR <-> VECTOR
// =========================================================================
// Paper.js lee coordenadas crudas de segmento e ignora `item.matrix` mientras
// `applyMatrix` es false. Por eso cada operando se hornea en coordenadas de
// proyecto antes de operar y el resultado aceptado vuelve al marco local del
// propietario con installOwnerGeometry (geometryIsLocal = false).
//
// La union es la unica operacion que se puede repetir sobre el resultado sin
// perder material: por eso las formas que se solapan por completo deben fundirse
// en un solo owner (ver exportSVG.js / union anti-doble-grabado).
//
// NOTA: "difference" NO usa exclude(). Con operandos de orientacion homogenea
// el kernel de Paper devuelve un CompoundPath de area ~0 en lugar de la
// diferencia simetrica. Se compone con las dos mitades, que si se apoyan en
// subtract() y unite(), las primitivas ya verificadas por el CSG.
const BOOLEAN_OPERATIONS = Object.freeze({
    union: { method: "unite", oriented: false },
    subtract: { method: "subtract", oriented: true },
    intersect: { method: "intersect", oriented: false },
    difference: { method: "difference", oriented: true }
});

const BOOLEAN_MIN_AREA = 1e-6;
const BOOLEAN_AREA_TOLERANCE = 1e-6;

function bakeBooleanOperand(item) {
    const clone = item.clone({ insert: false });
    try {
        const matrix = item.globalMatrix?.clone?.() || clone.matrix?.clone?.();
        clone.applyMatrix = false;
        clone.matrix = new paper.Matrix();
        if (matrix && !matrix.isIdentity()) clone.transform(matrix);
        clone.applyMatrix = true;
    } catch (_) {}
    return clone;
}

function booleanStackPath(item) {
    const path = [];
    const seen = new Set();
    let node = item;
    while (node && !seen.has(node)) {
        seen.add(node);
        if (typeof node.index === "number") path.unshift(node.index);
        node = node.parent;
    }
    return path;
}

// Z-order real: la forma mas baja es el material y la de encima es el cutter.
// Sin esto "Restar" dependeria del orden de seleccion, que es arbitrario.
function compareBooleanStack(a, b) {
    const left = booleanStackPath(a);
    const right = booleanStackPath(b);
    const length = Math.max(left.length, right.length);
    for (let i = 0; i < length; i++) {
        const lv = left[i] ?? -1;
        const rv = right[i] ?? -1;
        if (lv !== rv) return lv - rv;
    }
    return 0;
}

function isBooleanOperand(owner) {
    if (!owner || !owner.project) return false;
    if (owner.className !== "Path" && owner.className !== "CompoundPath") return false;
    const data = owner.data || {};
    if (data.mockup || data.isMask || data.isFusionMask || data.isSmartFusion) return false;
    try { if (isProductElement(owner)) return false; } catch (_) { return false; }
    // Un calado es un hueco: no se funde, se conserva y sigue perforando.
    try { if (semanticKind(owner) === VECTOR_KIND.HOLE) return false; } catch (_) {}
    return true;
}

function booleanOperandOwners() {
    const seen = new Set();
    return getSelectedItems()
        .map(unwrap)
        .filter(isBooleanOperand)
        .filter(owner => {
            if (seen.has(owner)) return false;
            seen.add(owner);
            return true;
        });
}

function commitBooleanResult(keeper, ownsHistory = false) {
    try { recalculateDynamicSubtractions?.(); } catch (_) {}
    window.deselectItem?.();
    if (typeof window.commitSelection === "function") {
        window.commitSelection(keeper, keeper ? [keeper] : []);
    }
    if (keeper) {
        try { keeper.selected = true; } catch (_) {}
    }
    window.updateSelectionBox?.(keeper);
    window.updateContextualMenu?.(keeper);
    paper.view?.update?.();
    if (ownsHistory) {
        // Mark the already-open transaction dirty so commitHistoryTransaction
        // stores the pre-boolean state for Undo.
        window.saveHistory?.();
        window.commitHistoryTransaction?.("boolean");
    }
    return keeper;
}

// Diferencia simetrica A xor B = (A - B) + (B - A). Ambas mitadas son disjuntas,
// de modo que la union de las dos no reintroduce material. Como el XOR es
// asociativo, plegar el resultado contra cada operando successive da la
// diferencia simetrica n-aria sin acumulacion de error.
function booleanDifference(keep, drop) {
    const left = keep.subtract(drop, { insert: false });
    if (!left) return null;
    const right = drop.subtract(keep, { insert: false });
    if (!right) {
        try { left.remove(); } catch (_) {}
        return null;
    }
    const merged = left.unite(right, { insert: false });
    try { left.remove(); } catch (_) {}
    try { right.remove(); } catch (_) {}
    return merged;
}

function performBooleanOperation(operation) {
    const spec = BOOLEAN_OPERATIONS[operation];
    if (!spec) return null;

    const owners = booleanOperandOwners();
    if (owners.length < 2) {
        console.warn("[EKKO BOOLEAN] Se necesitan 2 vectores solids. Los calados, el mockup y las mascaras no participan.");
        return null;
    }

    // Use one explicit history transaction for the whole boolean mutation.
    // A direct save can be swallowed by an already active transform/fusion
    // transaction, leaving Undo with no pre-boolean snapshot.
    const ownsHistory = !window._ekkoHistoryTransaction?.active;
    if (ownsHistory) window.beginHistoryTransaction?.("boolean");
    const rejectBoolean = reason => {
        if (ownsHistory) window.cancelHistoryTransaction?.(reason || "boolean-failed");
        return null;
    };

    const ordered = owners.slice().sort(compareBooleanStack);
    const base = ordered[0];
    const baked = ordered.map(bakeBooleanOperand);
    const sourceArea = baked.reduce((total, geometry) => total + Math.abs(geometry?.area || 0), 0);

    let result = baked[0];
    let failure = null;

    for (let i = 1; i < baked.length && !failure; i++) {
        const subject = result;
        let cutter = baked[i];
        // El CSG ya demostro que subtract() necesita operandos con orientacion
        // uniforme: un CompoundPath de texto descomuesto puede reportar mal
        // isClockwise() y devolver un area mayor que la original en vez de
        // perforar. Normalizar contra el sujeto es la misma defensa.
        if (spec.oriented) {
            try { cutter = normalizeSubtractiveOperand(cutter, subject); } catch (_) {}
        }
        try {
            const next = spec.method === "difference"
                ? booleanDifference(subject, cutter)
                : subject[spec.method](cutter, { insert: false });
            try { subject.remove(); } catch (_) {}
            if (cutter !== baked[i]) { try { cutter.remove(); } catch (_) {} }
            result = next;
            if (!result) failure = "sin geometria resultante";
        } catch (error) {
            console.error(`[EKKO BOOLEAN] Fallo en ${operation}:`, error);
            failure = String(error?.message || error);
        }
    }

    baked.forEach(geometry => {
        if (geometry && geometry !== result) {
            try { geometry.remove(); } catch (_) {}
        }
    });

    if (failure || !result) {
        try { result?.remove(); } catch (_) {}
        window.EKKO_DIAG?.logEvent?.("boolean.reject", { operation, reason: failure || "empty" });
        console.warn(`[EKKO BOOLEAN] ${operation} descartada: ${failure || "resultado vacio"}. Los vectores originales se conservan.`);
        return rejectBoolean(failure || "empty");
    }

    // Guardas: una interseccion de formas que no se tocan, o un resultado que
    // crece mas que la suma de sus operandos, indican un fallo del kernel.
    const resultArea = Math.abs(result.area || 0);
    if (resultArea <= BOOLEAN_MIN_AREA) {
        try { result.remove(); } catch (_) {}
        window.EKKO_DIAG?.logEvent?.("boolean.reject", { operation, reason: "empty-area" });
        console.warn(`[EKKO BOOLEAN] ${operation} sin area resultante. Los vectores originales se conservan.`);
        return rejectBoolean("empty-area");
    }
    if (resultArea > sourceArea * (1 + BOOLEAN_AREA_TOLERANCE) + BOOLEAN_MIN_AREA) {
        try { result.remove(); } catch (_) {}
        window.EKKO_DIAG?.logEvent?.("boolean.reject", { operation, reason: "area-overflow" });
        console.warn(`[EKKO BOOLEAN] ${operation} descartada: el area resultante excede la suma de las formas.`);
        return rejectBoolean("area-overflow");
    }

    // even-odd: las siluetas disjuntas que devuelve el kernel se renderizan
    // exactamente como la materia prevista y los contornos anidados se leen
    // como huecos reales, no como opacidad cero.
    try { result.fillRule = "evenodd"; } catch (_) {}

    // Capture the new geometry in owner-local space before installing it.
    // installOwnerGeometry can promote a Path to a CompoundPath; afterwards
    // getOwnerLocalGeometry(keeper) would read the old geomBase and CSG would
    // restore the pre-boolean shape.
    let booleanResultLocal = null;
    try {
        booleanResultLocal = result.clone({ insert: false });
        booleanResultLocal.applyMatrix = false;
        const baseGlobal = base.globalMatrix?.clone?.() || new paper.Matrix();
        booleanResultLocal.transform(baseGlobal.inverted());
        booleanResultLocal.applyMatrix = false;
        booleanResultLocal.matrix = new paper.Matrix();
        booleanResultLocal.fillRule = result.fillRule || "evenodd";
    } catch (_) {
        try { booleanResultLocal?.remove?.(); } catch (_) {}
        booleanResultLocal = null;
    }

    let keeper = null;
    try {
        keeper = installOwnerGeometry(base, result, false);
    } catch (error) {
        console.error(`[EKKO BOOLEAN] No se pudo instalar el resultado:`, error);
        try { result.remove(); } catch (_) {}
        return rejectBoolean("install-failed");
    }

    if (!keeper) {
        window.EKKO_DIAG?.logEvent?.("boolean.reject", { operation, reason: "no-keeper" });
        return rejectBoolean("no-keeper");
    }

    // installOwnerGeometry solo propaga fillRule cuando el propietario pasa a
    // CompoundPath. Un resultado de una sola silueta lo perderia y volveria a
    // nonzero, que es la regla con la que el kernel de Paper orientó los
    // contornos anidados. even-odd es la convencion del proyecto.
    try {
        keeper.fillRule = "evenodd";
        keeper.data = { ...(keeper.data || {}), fillRule: "evenodd" };
    } catch (_) {}

    // El resultado es una forma nueva: geomBase debe contener la geometría
    // booleana real, no la silueta anterior del primer operando.
    try {
        if (booleanResultLocal) {
            keeper.data = { ...(keeper.data || {}), geomBase: booleanResultLocal };
            if (booleanResultLocal.pathData) keeper.data.geomBasePathData = booleanResultLocal.pathData;
        } else {
            const local = getOwnerLocalGeometry(keeper);
            if (local) {
                local.applyMatrix = false;
                local.matrix = new paper.Matrix();
                keeper.data = { ...(keeper.data || {}), geomBase: local };
                if (local.pathData) keeper.data.geomBasePathData = local.pathData;
            }
        }
    } catch (_) {}

    // Los operandos consumidos desaparecen: la forma resultante los contiene.
    ordered.slice(1).forEach(owner => {
        try { owner.remove(); } catch (_) {}
    });

    window.EKKO_DIAG?.logEvent?.("boolean.applied", {
        operation,
        operands: ordered.length,
        area: resultArea
    });

    return commitBooleanResult(keeper, ownsHistory);
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
    let canBoolean = false;
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

    // Solo cuentan los vectores que el kernel puede usar como operandos: un
    // Group, un calado o una mascara no son fusionables.
    if (booleanOperandOwners().length >= 2) {
        canBoolean = true;
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

    return { context, counts, canUngroup, canDecompose, canFusion, canCalado, canRellenar, canBoolean };
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
    if (selection.canBoolean) {
        allowed.add("booleanUnion");
        allowed.add("booleanSubtract");
        allowed.add("booleanIntersect");
        allowed.add("booleanDifference");
    } else {
        allowed.delete("booleanUnion");
        allowed.delete("booleanSubtract");
        allowed.delete("booleanIntersect");
        allowed.delete("booleanDifference");
    }
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
    // Superficie de diagnostico: permite verificar una booleana sin pasar por
    // el DOM y confirma que la operacion respeta la semantica vectorial.
    window.EKKO_BOOLEAN = Object.freeze({
        union: () => performBooleanOperation("union"),
        subtract: () => performBooleanOperation("subtract"),
        intersect: () => performBooleanOperation("intersect"),
        difference: () => performBooleanOperation("difference"),
        isOperand: isBooleanOperand,
        operandCount: () => booleanOperandOwners().length
    });
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


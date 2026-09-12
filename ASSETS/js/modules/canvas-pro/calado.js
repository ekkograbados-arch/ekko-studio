/* =========================================================================
   EKKO STUDIO — CALADO
   Conversión semántica de un vector sólido o una fusión sólida en calado.

   La geometría no se redibuja: cambia la semántica del receptor y se
   recalculan las sustracciones. Un calado existente es no-op.
========================================================================= */
import {
    isProductElement,
    canConvertToCalado,
    getContentItem,
    findFusionVector,
    isClosedClientVector,
    cloneAbsolute,
    updateFusionRecord
} from "./fusionCore.js";
import { syncFusionVirtualHole } from "./fusionController.js";

function selectedItems() {
    if (Array.isArray(window.selectedItems) && window.selectedItems.length) {
        return [...window.selectedItems].filter(Boolean);
    }
    return window.selectedItem ? [window.selectedItem] : [];
}

function findFusionGroup(item) {
    if (!item) return null;
    let current = item;
    while (current) {
        if (current.data?.isSmartFusion) {
            if (current.data.clipGroup && current.children) {
                const nested = Array.from(current.children).find(child =>
                    child?.data?.isSmartFusion && child.children?.length >= 2
                );
                if (nested) return nested;
            }
            return current;
        }
        current = current.parent;
    }
    return null;
}

function getVectorTarget(item) {
    const fusion = findFusionGroup(item);
    if (fusion) return { fusion, vector: fusion.data?.originalVectorData || null };
    const content = getContentItem(item);
    const vector = findFusionVector(content) ||
        (isClosedClientVector(content) ? content : null);
    return { fusion: null, vector };
}

function ensureMockupContainment(target) {
    if (!target || !target.parent || target.parent.data?.clipGroup) return target;
    if (!window.currentMockup || !window.clipMask || typeof window.clipItem !== "function") return target;

    const parent = target.parent;
    const index = parent.children.indexOf(target);
    let wrapped = target;
    const previousInfiniteMode = window.infiniteCanvasMode;
    try {
        // Calado pertenece al área del mockup aunque el modo de lienzo
        // infinito esté activo para otros objetos.
        window.infiniteCanvasMode = false;
        wrapped = window.clipItem(target) || target;
    } finally {
        window.infiniteCanvasMode = previousInfiniteMode;
    }

    if (wrapped !== target) {
        wrapped.data = {
            ...(wrapped.data || {}),
            clipGroup: true,
            caladoContainment: true,
            label: "Calado"
        };
        parent.insertChild(Math.max(0, index), wrapped);
        return wrapped;
    }
    return target;
}

function markHole(target) {
    if (!target) return null;
    const previousFill = target.data?.originalFillColor?.clone?.() || target.fillColor?.clone?.();
    const previousStroke = target.data?.originalStrokeColor?.clone?.() || target.strokeColor?.clone?.();
    const previousStrokeWidth = target.data?.originalStrokeWidth || target.strokeWidth || 0;

    target.data = {
        ...(target.data || {}),
        isHole: true,
        isCalado: true,
        isFusionReceptor: true,
        isSolidShape: false,
        label: "Calado",
        originalFillColor: previousFill || new paper.Color("#64748b"),
        originalStrokeColor: previousStroke || new paper.Color("#334155"),
        originalStrokeWidth: previousStrokeWidth || (1 / (paper.view.zoom || 1))
    };
    if (!target.data.geomBase) {
        const base = cloneAbsolute(target);
        if (base) {
            base.data = { ...(base.data || {}), isHole: true };
            target.data.geomBase = base;
            try { base.remove(); } catch (e) {}
        }
    }

    // Un calado sigue siendo visible, seleccionable y editable. La semántica
    // isHole controla el CSG; no se vuelve transparente ni pierde contorno.
    target.fillColor = previousFill || new paper.Color("#64748b");
    target.strokeColor = previousStroke || new paper.Color("#334155");
    target.strokeWidth = previousStrokeWidth || (1 / (paper.view.zoom || 1));
    target.opacity = 1;
    return ensureMockupContainment(target);
}

function markFusionHole(fusion) {
    if (!fusion || fusion.data?.originalIsHole === true) return false;
    const currentMask = fusion.children?.find(child => child?.clipMask || child?.data?.isFusionMask);
    fusion.data = {
        ...(fusion.data || {}),
        isHole: true,
        isCalado: true,
        originalIsHole: true,
        receiverKind: "hole",
        fusionMode: "intersecar",
        label: "Fusión Calada"
    };
    if (currentMask) {
        currentMask.data = {
            ...(currentMask.data || {}),
            isHole: true,
            isFusionMask: true,
            ownerContainmentKey: fusion.data.ownerContainmentKey || null
        };
    }
    updateFusionRecord(fusion, {
        originalIsHole: true,
        receiverKind: "hole",
        mode: "intersecar"
    });
    syncFusionVirtualHole(fusion);
    return true;
}

export function canConvertSelectionToCalado(item = null) {
    const targets = item ? [item] : selectedItems();
    if (targets.length !== 1) return false;
    const resolved = getVectorTarget(targets[0]);
    if (resolved.fusion) return resolved.fusion.data?.originalIsHole !== true;
    return !!resolved.vector && !isProductElement(resolved.vector) && canConvertToCalado(resolved.vector);
}

export function convertSelectionToCalado(item = null) {
    const targets = item ? [item] : selectedItems();
    if (targets.length !== 1) {
        alert("Seleccioná un vector sólido o una fusión sólida para aplicar Calado.");
        return null;
    }
    const resolved = getVectorTarget(targets[0]);
    if (resolved.fusion) {
        if (resolved.fusion.data?.originalIsHole === true) return resolved.fusion;
        if (typeof window.saveHistory === "function") window.saveHistory();
        markFusionHole(resolved.fusion);
        if (typeof window.recalculateSmartFusion === "function") {
            window.recalculateSmartFusion(resolved.fusion);
        }
        if (typeof window.recalculateDynamicSubtractions === "function") {
            window.recalculateDynamicSubtractions();
        }
        if (typeof window.selectItem === "function") window.selectItem(resolved.fusion);
        paper.view.update();
        return resolved.fusion;
    }
    const vector = resolved.vector;
    if (!vector || isProductElement(vector) || !canConvertToCalado(vector)) return null;
    if (typeof window.saveHistory === "function") window.saveHistory();
    const finalItem = markHole(vector) || vector;
    if (typeof window.recalculateDynamicSubtractions === "function") {
        window.recalculateDynamicSubtractions();
    }
    if (typeof window.selectItem === "function") window.selectItem(finalItem);
    paper.view.update();
    return finalItem;
}

if (typeof window !== "undefined") {
    window.convertSelectionToCalado = convertSelectionToCalado;
    window.canConvertSelectionToCalado = canConvertSelectionToCalado;
}

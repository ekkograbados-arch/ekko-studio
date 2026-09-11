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
    const target = getContentItem(item);
    return { fusion: null, vector: target };
}

function markHole(target) {
    if (!target) return;
    target.data = {
        ...(target.data || {}),
        isHole: true,
        isCalado: true,
        isFusionReceptor: true,
        isSolidShape: false,
        label: "Calado"
    };
    if (!target.data.geomBase) {
        const base = cloneAbsolute(target);
        if (base) {
            base.data = { ...(base.data || {}), isHole: true };
            target.data.geomBase = base;
            try { base.remove(); } catch (e) {}
        }
    }
    target.fillColor = new paper.Color(0, 0, 0, 0.0001);
    target.strokeColor = null;
    target.strokeWidth = 0;
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
    markHole(vector);
    if (typeof window.recalculateDynamicSubtractions === "function") {
        window.recalculateDynamicSubtractions();
    }
    if (typeof window.selectItem === "function") window.selectItem(targets[0]);
    paper.view.update();
    return vector;
}

if (typeof window !== "undefined") {
    window.convertSelectionToCalado = convertSelectionToCalado;
    window.canConvertSelectionToCalado = canConvertSelectionToCalado;
}

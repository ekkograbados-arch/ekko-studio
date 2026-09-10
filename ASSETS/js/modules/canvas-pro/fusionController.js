/* =========================================================================
   EKKO STUDIO — FUSION CONTROLLER / FASE 4 CLEAN ARCHITECTURE

   Fuente única para el ciclo de vida de una fusión:
   - registro por fusionId
   - resolución de máscara actual
   - sincronización de hueco virtual
   - eliminación segura del registro
   - limpieza profunda de selección

   No decide la interfaz ni ejecuta el Snap. smartFusion.js coordina la
   operación visual y fusionEditMode.js coordina la edición interna.
========================================================================= */

import {
    createFusionRecord,
    getFusionById,
    updateFusionRecord,
    unregisterFusion,
    getCurrentFusionMask,
    cloneAbsolute,
    registerVirtualHole,
    updateVirtualHole,
    unregisterVirtualHole,
    isFusionItem
} from "./fusionCore.js";

function getRecordGroup(recordOrItem) {
    if (!recordOrItem) return null;
    if (recordOrItem.group) return recordOrItem.group;
    if (recordOrItem.data?.isSmartFusion) return recordOrItem;
    return null;
}

export function registerFusion(fusionItem, overrides = {}) {
    const record = createFusionRecord(fusionItem, overrides);
    if (!record) return null;
    syncFusionVirtualHole(record);
    return record;
}

export function resolveFusionRecord(fusionItem) {
    if (!fusionItem) return null;
    if (fusionItem.fusionId) return getFusionById(fusionItem.fusionId);
    if (fusionItem.data?.fusionId) return getFusionById(fusionItem.data.fusionId);
    if (fusionItem.data?.isSmartFusion) return createFusionRecord(fusionItem);
    return null;
}

export function getFusionMask(fusionItem) {
    return getCurrentFusionMask(getRecordGroup(fusionItem) || fusionItem);
}

export function syncFusionVirtualHole(fusionOrRecord) {
    const record = fusionOrRecord?.fusionId
        ? (fusionOrRecord.group ? fusionOrRecord : getFusionById(fusionOrRecord.fusionId))
        : resolveFusionRecord(fusionOrRecord);

    if (!record || !record.fusionId) return null;
    const group = getRecordGroup(record);
    const shouldBeHole = record.mode === "intersecar" && record.originalIsHole === true;

    if (!shouldBeHole) {
        unregisterVirtualHole(record.fusionId);
        return null;
    }

    const mask = getCurrentFusionMask(group);
    if (!mask) return null;

    let absoluteMask = null;
    try {
        absoluteMask = cloneAbsolute(mask);
        if (!absoluteMask) return null;
        const updated = updateVirtualHole(record.fusionId, absoluteMask, group);
        return updated;
    } finally {
        if (absoluteMask) {
            try { absoluteMask.remove(); } catch (e) {}
        }
    }
}

export function refreshFusion(fusionItem, overrides = {}) {
    const record = updateFusionRecord(fusionItem, overrides);
    if (!record) return null;
    syncFusionVirtualHole(record);
    return record;
}

export function removeFusionRecord(fusionId) {
    if (!fusionId) return;
    unregisterVirtualHole(fusionId);
    unregisterFusion(fusionId);
}

export function clearFusionSelection(item) {
    const visited = new Set();
    const clear = node => {
        if (!node || visited.has(node)) return;
        visited.add(node);
        try { node.selected = false; } catch (e) {}
        if (node.children) Array.from(node.children).forEach(clear);
    };
    clear(item);
}

export function isFusionSelection(item) {
    return !!(item && (isFusionItem(item) || item.data?.isSmartFusion));
}

export function getFusionVirtualHoles() {
    return Array.isArray(window._fusionVirtualHoles)
        ? window._fusionVirtualHoles
        : [];
}

if (typeof window !== "undefined") {
    window.EKKO_FUSION_CONTROLLER = {
        registerFusion,
        resolveFusionRecord,
        getFusionMask,
        syncFusionVirtualHole,
        refreshFusion,
        removeFusionRecord,
        clearFusionSelection,
        isFusionSelection,
        getFusionVirtualHoles
    };
}

/* =========================================================================
   EKKO STUDIO — FUSION CONTROLLER / FUENTE ÚNICA DE VERDAD
   Registro, selección, duplicación, eliminación, rehidratación y huecos
   virtuales de Fusionar.
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

const fusionEditTransactions = new Map();

function cloneDetached(item) {
    if (!item || typeof item.clone !== "function") return null;
    try { return item.clone({ insert: false }); } catch (e) { return null; }
}

function disposeDetached(item) {
    try { item?.remove?.(); } catch (e) {}
}

function getRecordGroup(recordOrItem) {
    if (!recordOrItem) return null;
    if (recordOrItem.group) return recordOrItem.group;
    if (recordOrItem.data?.isSmartFusion) return recordOrItem;
    return null;
}

function collectFusionItems(item, result = []) {
    if (!item) return result;
    if (item.data?.isSmartFusion) result.push(item);
    if (item.children) Array.from(item.children).forEach(child => collectFusionItems(child, result));
    return result;
}

function makeFusionId() {
    return `fus_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

export function registerFusion(fusionItem, overrides = {}) {
    const record = createFusionRecord(fusionItem, overrides);
    if (!record) return null;
    syncFusionVirtualHole(record);
    return record;
}

export function resolveFusionRecord(fusionItem) {
    if (!fusionItem) return null;
    const id = fusionItem.fusionId || fusionItem.data?.fusionId;
    if (id) {
        const record = getFusionById(id);
        if (record?.group?.project) return record;
        if (record && !record.group?.project) removeFusionRecord(id);
    }
    if (fusionItem.data?.isSmartFusion) return registerFusion(fusionItem);
    return null;
}

export function getFusionMask(fusionItem) {
    return getCurrentFusionMask(getRecordGroup(fusionItem) || fusionItem);
}

/**
 * Starts an internal image-edit transaction without destroying the public
 * fusion record. The edit module may temporarily remove visual children, but
 * the identity and original snapshots remain owned by this controller.
 */
export function beginFusionEdit(fusionItem) {
    const record = resolveFusionRecord(fusionItem);
    const group = getRecordGroup(record);
    if (!record || !group || !record.fusionId) return null;
    if (fusionEditTransactions.has(record.fusionId)) {
        return fusionEditTransactions.get(record.fusionId);
    }

    const mask = getCurrentFusionMask(group);
    const raster = group.children?.find(child => child.className === "Raster") || null;
    const transaction = {
        fusionId: record.fusionId,
        record,
        group,
        mode: record.mode,
        originalIsHole: record.originalIsHole === true,
        containmentScope: record.containmentScope || null,
        containmentKey: record.containmentKey || null,
        ownerContainmentKey: record.ownerContainmentKey || null,
        originalVectorData: cloneDetached(record.originalVectorData),
        originalRasterData: cloneDetached(record.originalRasterData),
        maskSnapshot: mask ? cloneAbsolute(mask) : null,
        rasterId: raster?.id ?? null,
        startedAt: Date.now()
    };

    record.editing = true;
    record.editStartedAt = transaction.startedAt;
    fusionEditTransactions.set(record.fusionId, transaction);
    unregisterVirtualHole(record.fusionId);
    return transaction;
}

export function getFusionEditTransaction(fusionId) {
    return fusionEditTransactions.get(fusionId) || null;
}

function disposeFusionEditTransaction(transaction) {
    if (!transaction) return;
    disposeDetached(transaction.originalVectorData);
    disposeDetached(transaction.originalRasterData);
    disposeDetached(transaction.maskSnapshot);
}

/** Re-attaches a committed visual group to the original fusion identity. */
export function commitFusionEdit(fusionItem, overrides = {}) {
    const id = fusionItem?.data?.fusionId || fusionItem?.fusionId || overrides.fusionId;
    const transaction = id ? fusionEditTransactions.get(id) : null;
    const record = fusionItem ? updateFusionRecord(fusionItem, { ...overrides, fusionId: id }) : null;
    if (record) {
        record.editing = false;
        delete record.editStartedAt;
        syncFusionVirtualHole(record);
    }
    if (id) fusionEditTransactions.delete(id);
    disposeFusionEditTransaction(transaction);
    return record;
}

/** Cancels the transaction and returns its immutable restoration snapshot. */
export function cancelFusionEdit(fusionId) {
    const transaction = fusionEditTransactions.get(fusionId) || null;
    if (!transaction) return null;
    const record = getFusionById(fusionId);
    if (record) {
        record.editing = false;
        delete record.editStartedAt;
    }
    fusionEditTransactions.delete(fusionId);
    unregisterVirtualHole(fusionId);
    return transaction;
}

export function syncFusionVirtualHole(fusionOrRecord) {
    const record = fusionOrRecord?.fusionId
        ? (fusionOrRecord.group ? fusionOrRecord : getFusionById(fusionOrRecord.fusionId))
        : resolveFusionRecord(fusionOrRecord);

    if (!record || !record.fusionId) return null;
    const group = getRecordGroup(record);
    const shouldBeHole = record.mode === "intersecar" && record.originalIsHole === true;

    if (!shouldBeHole || !group?.project) {
        unregisterVirtualHole(record.fusionId);
        return null;
    }

    const mask = getCurrentFusionMask(group);
    if (!mask || !mask.project) {
        unregisterVirtualHole(record.fusionId);
        return null;
    }

    let absoluteMask = null;
    try {
        absoluteMask = cloneAbsolute(mask);
        if (!absoluteMask) {
            unregisterVirtualHole(record.fusionId);
            return null;
        }
        return updateVirtualHole(record.fusionId, absoluteMask, group);
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

export function removeFusionForItem(item) {
    const ids = new Set();
    collectFusionItems(item).forEach(fusion => {
        if (fusion.data?.fusionId) ids.add(fusion.data.fusionId);
    });
    ids.forEach(removeFusionRecord);
    return ids.size;
}

export function clearFusionRuntime() {
    const holes = Array.isArray(window._fusionVirtualHoles) ? window._fusionVirtualHoles : [];
    holes.forEach(entry => { try { entry.geom?.remove(); } catch (e) {} });
    window._fusionVirtualHoles = [];
    fusionEditTransactions.forEach(disposeFusionEditTransaction);
    fusionEditTransactions.clear();
    window._fusionRecords = [];
}

export function rebuildFusionRegistry(root = null) {
    clearFusionRuntime();
    const project = typeof paper !== "undefined" ? paper.project : null;
    if (!project) return [];
    const roots = root?.children ? Array.from(root.children) : Array.from(project.layers || []);
    const candidates = [];
    roots.forEach(item => collectFusionItems(item, candidates));
    // Solo el contenedor superior representa una fusión pública. Los hijos
    // internos pueden repetir isSmartFusion cuando existe clipGroup.
    const topLevel = candidates.filter(item => !item.parent?.data?.isSmartFusion);
    const usedIds = new Set();
    const records = [];
    topLevel.forEach(item => {
        let id = item.data?.fusionId || makeFusionId();
        if (usedIds.has(id)) id = makeFusionId();
        usedIds.add(id);
        collectFusionItems(item).forEach(node => {
            node.data = { ...(node.data || {}), fusionId: id, isSmartFusion: true };
        });
        const record = registerFusion(item, { fusionId: id });
        if (record) records.push(record);
    });
    return records;
}

export function rekeyFusionClone(item) {
    const fusionItems = collectFusionItems(item);
    if (!fusionItems.length) return null;
    const fusionId = makeFusionId();
    fusionItems.forEach(fusion => {
        fusion.data = { ...(fusion.data || {}), fusionId, isSmartFusion: true };
    });
    removeFusionRecord(fusionId);
    const record = registerFusion(item, { fusionId });
    return record;
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
    return Array.isArray(window._fusionVirtualHoles) ? window._fusionVirtualHoles : [];
}

if (typeof window !== "undefined") {
    window.EKKO_FUSION_CONTROLLER = {
        registerFusion,
        resolveFusionRecord,
        getFusionMask,
        beginFusionEdit,
        getFusionEditTransaction,
        commitFusionEdit,
        cancelFusionEdit,
        syncFusionVirtualHole,
        refreshFusion,
        removeFusionRecord,
        removeFusionForItem,
        clearFusionRuntime,
        rebuildFusionRegistry,
        rekeyFusionClone,
        clearFusionSelection,
        isFusionSelection,
        getFusionVirtualHoles
    };
}

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



/* -------------------------------------------------------------------------
   TRANSFORM OWNER / TRANSACTION API
   Every public transform goes through this block. A mockup clipGroup is
   containment only; a real fusion group is the owner of mask and raster.
------------------------------------------------------------------------- */
const transformObservers = new Set();
let activeTransformTransaction = null;

function isRealFusionGroup(item) {
    return !!(item?.data?.isSmartFusion && !item.data?.clipGroup &&
        item.children?.some(child => child?.clipMask || child?.data?.isFusionMask));
}

export function resolvePublicTransformOwner(item) {
    if (!item) return null;
    if (isRealFusionGroup(item)) return item;
    const record = resolveFusionRecord(item);
    if (record?.group && isRealFusionGroup(record.group)) return record.group;
    let current = item;
    while (current && current !== (typeof paper !== "undefined" ? paper.project : null)) {
        if (isRealFusionGroup(current)) return current;
        if (current.data?.clipGroup) {
            const content = Array.from(current.children || []).find(child =>
                !child.clipMask && !child.data?.isMask && !child.data?.mockup &&
                !child.data?.wasClipMask
            );
            return content || null;
        }
        current = current.parent;
    }
    return item;
}

function toParentDelta(owner, delta) {
    const d = delta?.clone ? delta.clone() : new paper.Point(delta?.x || 0, delta?.y || 0);
    const parent = owner?.parent;
    if (!parent?.globalToLocal || !owner?.localToGlobal) return d;
    const origin = owner.localToGlobal(new paper.Point(0, 0));
    return parent.globalToLocal(origin.add(d)).subtract(parent.globalToLocal(origin));
}

function toParentPoint(owner, point) {
    if (owner?.parent?.globalToLocal) return owner.parent.globalToLocal(point);
    return point?.clone ? point.clone() : new paper.Point(point?.x || 0, point?.y || 0);
}

function applyOperation(item, operation) {
    if (!item || !operation) return false;
    const op = operation.type || "translate";
    try {
        if (op === "translate") {
            const delta = operation.delta || new paper.Point(0, 0);
            const local = toParentDelta(item, delta);
            if (typeof item.translate === "function") item.translate(local);
            else if (item.position) item.position = item.position.add(local);
            return true;
        }
        if (op === "rotate") {
            const center = toParentPoint(item, operation.center || item.bounds.center);
            item.rotate(Number(operation.angle) || 0, center);
            return true;
        }
        if (op === "scale") {
            const center = toParentPoint(item, operation.center || item.bounds.center);
            item.scale(Number(operation.sx) || 1, Number(operation.sy) || 1, center);
            return true;
        }
        if (op === "matrix" && operation.matrix) {
            item.transform(operation.matrix);
            return true;
        }
    } catch (error) {
        if (window.EKKO_DEBUG) console.warn("[EKKO TRANSFORM] operation failed", error);
    }
    return false;
}

function transformDetachedGeomBases(owner, operation) {
    const visited = new Set();
    const visit = node => {
        if (!node || visited.has(node.id)) return;
        visited.add(node.id);
        const base = node.data?.geomBase;
        if (base && !base.parent && base !== node) applyOperation(base, operation);
        if (node.children) Array.from(node.children).forEach(visit);
    };
    visit(owner);
}

function fusionMatrixInvariant(group) {
    const mask = getCurrentFusionMask(group);
    const raster = Array.from(group?.children || []).find(child => child.className === "Raster");
    const ownerMatrix = group?.globalMatrix;
    if (!mask || !raster || !ownerMatrix) return { valid: true, maxError: 0, mask: null, raster: null };
    try {
        const inv = ownerMatrix.inverted();
        const relMask = inv.concatenate(mask.globalMatrix);
        const relRaster = inv.concatenate(raster.globalMatrix);
        const serial = matrix => ({ a: matrix.a, b: matrix.b, c: matrix.c, d: matrix.d, tx: matrix.tx, ty: matrix.ty });
        return { valid: true, maxError: 0, mask: serial(relMask), raster: serial(relRaster) };
    } catch (e) { return { valid: false, maxError: Infinity, mask: null, raster: null }; }
}

function compareFusionInvariant(before, after) {
    if (!before || !after || !before.mask || !after.mask || !before.raster || !after.raster) return after;
    const keys = ["a", "b", "c", "d", "tx", "ty"];
    let error = 0;
    keys.forEach(key => {
        error = Math.max(error, Math.abs(before.mask[key] - after.mask[key]), Math.abs(before.raster[key] - after.raster[key]));
    });
    return { ...after, valid: after.valid && Number.isFinite(error) && error < 1e-5, maxError: error };
}

export function transformFusion(fusionOrItem, operation = {}, options = {}) {
    const owner = resolvePublicTransformOwner(fusionOrItem);
    if (!owner || !isRealFusionGroup(owner)) return { applied: false, owner: null, invariant: null };
    const before = fusionMatrixInvariant(owner);
    const applied = applyOperation(owner, operation);
    if (applied) transformDetachedGeomBases(owner, operation);
    const after = compareFusionInvariant(before, fusionMatrixInvariant(owner));
    const record = resolveFusionRecord(owner);
    if (record) syncFusionVirtualHole(record);
    const identity = {
        id: owner.id ?? null,
        fusionId: owner.data?.fusionId || record?.fusionId || null,
        className: owner.className,
        label: owner.data?.label || "Fusion",
        parentId: owner.parent?.id ?? null
    };
    window._ekkoFusionTransformDiagnostics = {
        applied, owner: identity, matrixInvariant: after,
        beforeInvariant: before, operation: operation.type || "matrix",
        at: Date.now()
    };
    return { applied, owner, invariant: after, identity };
}

export function transformPublicItem(item, operation = {}) {
    const owner = resolvePublicTransformOwner(item);
    if (!owner || owner.clipMask || owner.data?.mockup || owner.data?.isMask) {
        return { applied: false, owner: null };
    }
    if (isRealFusionGroup(owner)) return transformFusion(owner, operation);
    const applied = applyOperation(owner, operation);
    if (applied) transformDetachedGeomBases(owner, operation);
    return { applied, owner };
}

export function beginTransformTransaction(kind, targets = [], startPoint = null) {
    if (typeof window.beginHistoryTransaction === "function") {
        window.beginHistoryTransaction("transform:" + kind);
    }
    const entries = (Array.isArray(targets) ? targets : []).map(entry => ({
        item: entry.item || entry, owner: resolvePublicTransformOwner(entry.target || entry.item || entry),
        targetId: (entry.target || entry.item || entry)?.id ?? null,
        targetClass: (entry.target || entry.item || entry)?.className || null
    })).filter(entry => entry.owner && !entry.owner.clipMask && !entry.owner.data?.mockup);
    activeTransformTransaction = {
        kind, active: true, startedAt: Date.now(), previousPoint: startPoint?.clone?.() || startPoint,
        cumulativeDelta: new paper.Point(0, 0), entries,
        targetIdentity: entries.map(entry => ({ id: entry.targetId, className: entry.targetClass,
            ownerId: entry.owner.id ?? null, ownerClass: entry.owner.className,
            fusionId: entry.owner.data?.fusionId || null }))
    };
    window._ekkoTransformTransaction = {
        active: true, kind, targetIdentity: activeTransformTransaction.targetIdentity,
        transformOwner: activeTransformTransaction.targetIdentity.map(x => x.ownerId),
        cumulativeDelta: { x: 0, y: 0 }, status: "active"
    };
    return activeTransformTransaction;
}

export function accumulateDragDelta(event, targets = null) {
    if (!activeTransformTransaction || !activeTransformTransaction.active) {
        beginTransformTransaction("drag", targets || [], event?.point || null);
    }
    const tx = activeTransformTransaction;
    const point = event?.point?.clone?.() || event?.point;
    let delta = null;
    if (point && tx.previousPoint) delta = point.subtract(tx.previousPoint);
    else if (event?.delta) delta = event.delta.clone ? event.delta.clone() : new paper.Point(event.delta.x, event.delta.y);
    else delta = new paper.Point(0, 0);
    tx.previousPoint = point || tx.previousPoint;
    tx.cumulativeDelta = tx.cumulativeDelta.add(delta);
    let movedCount = 0;
    tx.entries.forEach(entry => {
        if (entry.owner?.data?.locked) return;
        if (transformPublicItem(entry.owner, { type: "translate", delta }).applied) movedCount++;
    });
    const cumulative = { x: tx.cumulativeDelta.x, y: tx.cumulativeDelta.y };
    window._ekkoLastDragEventDelta = { x: delta.x, y: delta.y };
    window._ekkoLastDragAccumulatedDelta = cumulative;
    window._ekkoLastDragCommonDelta = cumulative;
    window._ekkoLastDragMovedCount = movedCount;
    window._ekkoLastDragTargetLevel = tx.targetIdentity.map(x => x.ownerId);
    window._ekkoTransformTransaction = { ...window._ekkoTransformTransaction,
        active: true, cumulativeDelta: cumulative, movedCount,
        targetIdentity: tx.targetIdentity, status: "accumulating" };
    notifyTransformObservers({ event, delta, cumulativeDelta: cumulative, transaction: tx });
    return { delta, cumulativeDelta: cumulative, movedCount, transaction: tx };
}

export function notifyTransformObservers(payload = {}) {
    transformObservers.forEach(callback => { try { callback(payload); } catch (e) {} });
}
export function addTransformObserver(callback) {
    if (typeof callback === "function") transformObservers.add(callback);
    return () => transformObservers.delete(callback);
}
export function finalizeTransformTransaction(status = "committed") {
    if (!activeTransformTransaction) return null;
    const tx = activeTransformTransaction;
    tx.active = false; tx.status = status; tx.finishedAt = Date.now();
    const fusions = new Set();
    tx.entries.forEach(entry => {
        if (isRealFusionGroup(entry.owner)) {
            const record = resolveFusionRecord(entry.owner);
            if (record) fusions.add(record.fusionId);
        }
    });
    fusions.forEach(id => syncFusionVirtualHole(getFusionById(id)));
    window._ekkoTransformTransaction = {
        active: false, kind: tx.kind, status, targetIdentity: tx.targetIdentity,
        transformOwner: tx.targetIdentity.map(x => x.ownerId),
        cumulativeDelta: { x: tx.cumulativeDelta.x, y: tx.cumulativeDelta.y },
        finishedAt: tx.finishedAt
    };
    activeTransformTransaction = null;
    return tx;
}

export function assertFusionRegistryState(reason = "runtime") {
    const records = Array.isArray(window._fusionRecords) ? window._fusionRecords : [];
    const holes = Array.isArray(window._fusionVirtualHoles) ? window._fusionVirtualHoles : [];
    const paperCount = typeof paper !== "undefined" && paper.project
        ? paper.project.getItems({ match: item => isRealFusionGroup(item) }).filter(item => !item.parent?.data?.isSmartFusion).length
        : null;
    const ids = records.map(record => record.fusionId);
    const uniqueIds = new Set(ids);
    const result = { reason, paperFusionCount: paperCount, recordCount: records.length,
        virtualHoleCount: holes.length, duplicateIds: ids.length !== uniqueIds.size,
        countsEqual: paperCount === null || paperCount === records.length,
        at: Date.now() };
    window._ekkoHistoryFusionAssertion = result;
    return result;
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
        getFusionVirtualHoles,
        resolvePublicTransformOwner,
        transformFusion,
        transformPublicItem,
        beginTransformTransaction,
        accumulateDragDelta,
        finalizeTransformTransaction,
        addTransformObserver,
        notifyTransformObservers,
        assertFusionRegistryState
    };
}

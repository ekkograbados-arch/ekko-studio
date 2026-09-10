/* =========================================================================
   EKKO STUDIO — FUSION CORE / FASE 4.1
   Contrato común de objetos, geometrías y huecos virtuales.

   Este módulo no ejecuta la fusión por sí solo. Centraliza las reglas que
   smartFusion.js, fusionEditMode.js, selection.js y exportSVG.js deben usar.
========================================================================= */

const PRODUCT_FLAGS = [
    "mockup",
    "isMask",
    "wasClipMask",
    "isMockupPart",
    "productTemplate",
    "systemGenerated",
    "isProductMask"
];

function hasPaper() {
    return typeof paper !== "undefined" && paper && paper.project;
}

function walkParents(item, callback) {
    let current = item;
    while (current) {
        if (callback(current)) return true;
        current = current.parent;
    }
    return false;
}

export function isProductElement(item) {
    if (!item) return true;
    if (item.clipMask) return true;
    if (typeof window !== "undefined" && item === window.currentMockup) return true;

    return walkParents(item, current => {
        if (current.clipMask) return true;
        if (current.data && PRODUCT_FLAGS.some(flag => current.data[flag] === true)) return true;
        if (typeof window !== "undefined" && current === window.currentMockup) return true;
        return false;
    });
}

export function isClientDesignElement(item) {
    if (!item || isProductElement(item)) return false;
    const data = item.data || {};
    return data.userImported === true ||
        data.source === "client-svg" ||
        data.decomposedLayer === true ||
        data.isFusionReceptor === true ||
        data.isHole === true ||
        data.isSolidShape === true ||
        data.isCalado === true ||
        item.className === "Path" ||
        item.className === "CompoundPath" ||
        item.className === "Group" ||
        item.className === "Shape";
}

export function getContentItem(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup && item.children) {
        return item.children.find(child =>
            !child.clipMask && !(child.data && (child.data.isMask || child.data.wasClipMask || child.data.mockup))
        ) || item;
    }
    return item;
}

function isFusionVectorNode(item) {
    return item && (
        item.className === "CompoundPath" ||
        (item.className === "Path" && item.closed === true) ||
        (item.className === "Shape" && item.closed !== false)
    );
}

function findSingleDescendant(item, predicate) {
    if (!item || isProductElement(item)) return null;
    if (predicate(item)) return item;
    if (!item.children) return null;

    const matches = [];
    Array.from(item.children).forEach(child => {
        const match = findSingleDescendant(child, predicate);
        if (match) matches.push(match);
    });
    return matches.length === 1 ? matches[0] : null;
}

export function findFusionVector(item) {
    return findSingleDescendant(item, child => {
        if (child.clipMask || child.data?.isMask || child.data?.wasClipMask) return false;
        return isFusionVectorNode(child);
    });
}

export function findFusionRaster(item) {
    return findSingleDescendant(item, child => {
        if (child.clipMask || child.data?.isMask || child.data?.wasClipMask) return false;
        return child.className === "Raster";
    });
}

export function isClosedClientVector(item) {
    const target = findFusionVector(item) || getContentItem(item);
    if (!target || isProductElement(target) || !isClientDesignElement(target)) return false;
    return target.className === "CompoundPath" ||
        (target.className === "Path" && target.closed === true) ||
        (target.className === "Shape" && target.closed !== false);
}

export function isValidFusionReceptor(item) {
    const target = findFusionVector(item) || getContentItem(item);
    if (!target || isProductElement(target) || !isClosedClientVector(target)) return false;
    if (target.data && target.data.isSmartFusion) return false;
    return target.data?.isFusionReceptor === true ||
        target.data?.isHole === true ||
        target.data?.isCalado === true ||
        target.data?.isSolidShape === true ||
        target.className === "CompoundPath" ||
        (target.className === "Path" && target.closed === true) ||
        (target.className === "Shape" && target.closed !== false);
}

function bakeMatrixIntoPath(path, matrix) {
    if (!path || !matrix || matrix.isIdentity()) return;

    if (path.segments) {
        path.segments.forEach(segment => {
            const originalPoint = segment.point.clone();
            segment.point = matrix.transform(originalPoint);

            if (segment.handleIn) {
                const absoluteHandle = originalPoint.add(segment.handleIn);
                segment.handleIn = matrix.transform(absoluteHandle)
                    .subtract(segment.point);
            }

            if (segment.handleOut) {
                const absoluteHandle = originalPoint.add(segment.handleOut);
                segment.handleOut = matrix.transform(absoluteHandle)
                    .subtract(segment.point);
            }
        });
    }

    if (path.children) {
        Array.from(path.children).forEach(child => bakeMatrixIntoPath(child, matrix));
    }
}

export function cloneAbsolute(item) {
    if (!item || !hasPaper()) return null;

    const clone = item.clone({ insert: false });
    const globalMatrix = item.globalMatrix ? item.globalMatrix.clone() : new paper.Matrix();
    paper.project.activeLayer.addChild(clone);

    if (clone.className === "Path" || clone.className === "CompoundPath") {
        bakeMatrixIntoPath(clone, globalMatrix);
        clone.matrix = new paper.Matrix();
    } else if (!globalMatrix.isIdentity()) {
        clone.transform(globalMatrix);
    }

    return clone;
}

export function calculateCoverPlacement(maskItem, rasterItem) {
    if (!maskItem || !rasterItem) return null;
    const maskBounds = maskItem.bounds;
    const rasterBounds = rasterItem.bounds;
    if (!maskBounds || !rasterBounds || rasterBounds.width <= 0 || rasterBounds.height <= 0) return null;

    const scale = Math.max(
        maskBounds.width / rasterBounds.width,
        maskBounds.height / rasterBounds.height
    );

    const scaledWidth = rasterBounds.width * scale;
    const scaledHeight = rasterBounds.height * scale;
    const delta = maskBounds.center.subtract(rasterBounds.center.multiply(scale));

    return {
        scale,
        center: maskBounds.center.clone(),
        delta,
        scaledWidth,
        scaledHeight
    };
}

function ensureRegistry() {
    if (typeof window === "undefined") return [];
    if (!Array.isArray(window._fusionVirtualHoles)) window._fusionVirtualHoles = [];
    return window._fusionVirtualHoles;
}

export function registerVirtualHole(geometry, fusionId, fusionGroup = null) {
    if (!geometry || !fusionId) return null;
    const registry = ensureRegistry();
    const existing = registry.find(entry => entry.fusionId === fusionId);
    const clone = geometry.clone({ insert: false });
    clone.matrix = new paper.Matrix();

    if (existing) {
        try { existing.geom.remove(); } catch (e) {}
        existing.geom = clone;
        existing.fusionGroup = fusionGroup || existing.fusionGroup || null;
        return existing;
    }

    const entry = { geom: clone, fusionId, fusionGroup };
    registry.push(entry);
    return entry;
}

export function updateVirtualHole(fusionId, geometry, fusionGroup = null) {
    return registerVirtualHole(geometry, fusionId, fusionGroup);
}

export function unregisterVirtualHole(fusionId) {
    const registry = ensureRegistry();
    window._fusionVirtualHoles = registry.filter(entry => {
        if (entry.fusionId !== fusionId) return true;
        try { entry.geom.remove(); } catch (e) {}
        return false;
    });
}

export function clearVirtualHoles() {
    const registry = ensureRegistry();
    registry.forEach(entry => {
        try { entry.geom.remove(); } catch (e) {}
    });
    window._fusionVirtualHoles = [];
}

export function getVirtualHoleEntries() {
    return ensureRegistry();
}

if (typeof window !== "undefined") {
    window.EKKO_FUSION_CORE = {
        isProductElement,
        isClientDesignElement,
        getContentItem,
        findFusionVector,
        findFusionRaster,
        isClosedClientVector,
        isValidFusionReceptor,
        cloneAbsolute,
        calculateCoverPlacement,
        registerVirtualHole,
        updateVirtualHole,
        unregisterVirtualHole,
        clearVirtualHoles,
        getVirtualHoleEntries
    };
}


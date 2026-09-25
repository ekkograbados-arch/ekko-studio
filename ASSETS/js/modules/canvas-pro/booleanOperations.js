/*
 * EKKO Studio — explicit vector boolean operations.
 *
 * CSG used for physical holes is reactive and automatic. This module is the
 * user-facing operation: the client can deliberately unite, intersect or
 * subtract selected vector owners. The result is a new public vector owner;
 * masks, mockups and laser parameters are never operands.
 */
import {
    getPublicOwner,
    getPublicOwners,
    toWorldGeometry
} from "./designGeometry.js";
import { getStackingUnit, setSemanticKind, VECTOR_KIND, semanticKind } from "./vectorSemantics.js";

function selectedOwners(items = null) {
    const source = items || (Array.isArray(window.selectedItems) && window.selectedItems.length
        ? window.selectedItems
        : (window.selectedItem ? [window.selectedItem] : []));
    const result = [];
    const seen = new Set();
    source.forEach(raw => {
        const direct = getPublicOwner(raw);
        const candidates = getPublicOwners([raw]);
        const owners = candidates.length ? candidates : (direct ? [direct] : []);
        owners.forEach(owner => {
            if (!owner || seen.has(owner) || owner.data?.locked || owner.data?.mockup ||
                owner.data?.isMask || owner.data?.isSmartFusion || owner.data?.isCutLine === true) return;
            if (!["Path", "CompoundPath", "Shape"].includes(owner.className)) return;
            if (owner.closed !== true && owner.className === "Path") return;
            seen.add(owner);
            result.push(owner);
        });
    });
    return result;
}

function worldGeometry(owner) {
    const geometry = toWorldGeometry(owner);
    if (!geometry) return null;
    try { geometry.applyMatrix = true; } catch (_) {}
    return geometry;
}

function geometryChildren(geometry) {
    if (!geometry) return [];
    if (geometry.className === "CompoundPath" ||
        (typeof paper !== "undefined" && paper.CompoundPath && geometry instanceof paper.CompoundPath)) {
        return (geometry.children || []).map(child => child.clone({ insert: false }));
    }
    return [geometry.clone({ insert: false })];
}

function disposeAll(items) {
    (items || []).forEach(item => {
        try { item?.remove?.(); } catch (_) {}
    });
}

function orderByStacking(owners) {
    return owners.slice().sort((a, b) => {
        const au = getStackingUnit(a) || a;
        const bu = getStackingUnit(b) || b;
        if (au.parent && au.parent === bu.parent) return (au.index ?? 0) - (bu.index ?? 0);
        return owners.indexOf(a) - owners.indexOf(b);
    });
}

function makeResultOwner(result, owners, operation) {
    if (!result || typeof paper === "undefined" || !paper.project) return null;
    const layer = paper.project.layers?.find(item => item.name === "designLayer") || paper.project.activeLayer;
    if (!layer) return null;
    const localResult = result.clone({ insert: false });
    try {
        const inverseLayer = layer.globalMatrix?.inverted?.();
        if (inverseLayer) localResult.transform(inverseLayer);
        localResult.applyMatrix = false;
        localResult.matrix = new paper.Matrix();
    } catch (_) {}
    const compound = new paper.CompoundPath({ insert: false });
    const children = geometryChildren(localResult);
    if (!children.length) {
        localResult.remove?.();
        return null;
    }
    children.forEach(child => compound.addChild(child));
    localResult.remove?.();
    compound.applyMatrix = false;
    compound.matrix = new paper.Matrix();
    compound.fillRule = result.fillRule || owners[0]?.data?.originalFillRule || "nonzero";
    compound.fillColor = owners[owners.length - 1]?.fillColor?.clone?.() ||
        owners[0]?.fillColor?.clone?.() || new paper.Color("#111827");
    compound.strokeColor = owners[owners.length - 1]?.strokeColor?.clone?.() ||
        owners[0]?.strokeColor?.clone?.() || null;
    compound.strokeWidth = owners[owners.length - 1]?.strokeWidth || owners[0]?.strokeWidth || 0;
    const topData = owners[owners.length - 1]?.data || {};
    compound.data = {
        ...topData,
        locked: false,
        label: `Boolean ${operation}`,
        source: "vector-boolean",
        userImported: true,
        isFusionReceptor: true,
        isSolidShape: true,
        isHole: false,
        originalIsHole: false,
        booleanOperation: operation,
        geomBase: compound.clone({ insert: false })
    };
    compound.data.geomBase.applyMatrix = false;
    compound.data.geomBase.matrix = new paper.Matrix();
    setSemanticKind(compound, VECTOR_KIND.SOLID);
    layer.addChild(compound);
    if (window.currentMockup) compound.insertBelow(window.currentMockup);
    if (!window.infiniteCanvasMode && typeof window.clipItem === "function") {
        const contained = window.clipItem(compound);
        if (contained && contained !== compound) return getPublicOwner(contained) || compound;
    }
    return compound;
}

function cleanEmptyContainment(item) {
    let parent = item?.parent || item;
    while (parent && parent !== paper.project) {
        const next = parent.parent;
        if (parent.data?.clipGroup === true) {
            const useful = (parent.children || []).filter(child =>
                !child.clipMask && !(child.data && (child.data.isMask || child.data.mockup || child.data.wasClipMask)));
            if (!useful.length) parent.remove();
        }
        parent = next;
    }
}

function commitSelection(owner) {
    if (!owner) return null;
    window.deselectItem?.();
    if (window.commitSelection) window.commitSelection(owner, [owner]);
    else window.selectItem?.(owner);
    window.updateSelectionBox?.(owner);
    window.updateContextualMenu?.(owner);
    return owner;
}

export function booleanSelection(operation = "union", items = null) {
    const normalized = String(operation || "union").toLowerCase();
    if (!["union", "intersect", "subtract"].includes(normalized)) return null;
    const owners = orderByStacking(selectedOwners(items));
    if (owners.length < 2) {
        alert("Seleccioná al menos dos vectores para una operación booleana.");
        return null;
    }
    if (owners.some(owner => semanticKind(owner) === VECTOR_KIND.HOLE) && normalized === "union") {
        // Unir un hueco con un sólido es una operación ambigua para el
        // cliente. Keep the operation explicit and safe: the user can Calado
        // or Rellenar first, then union solids.
        alert("Para unir, convertí primero los huecos a sólidos o usá Calado/Rellenar.");
        return null;
    }
    if (typeof window.saveHistory === "function") window.saveHistory();
    const geometries = owners.map(worldGeometry);
    if (geometries.some(geometry => !geometry)) {
        disposeAll(geometries);
        return null;
    }
    let result = geometries[0];
    try {
        if (normalized === "union") {
            for (let i = 1; i < geometries.length; i += 1) {
                result = result.unite(geometries[i], { insert: false });
            }
        } else if (normalized === "intersect") {
            for (let i = 1; i < geometries.length; i += 1) {
                result = result.intersect(geometries[i], { insert: false });
            }
        } else {
            // Subtraction consumes from the bottom-most owner upwards. This
            // matches the layer order shown to the client and avoids an
            // accidental dependency on the click order.
            for (let i = 1; i < geometries.length; i += 1) {
                result = result.subtract(geometries[i], { insert: false });
            }
        }
    } catch (error) {
        console.error("[EKKO BOOLEAN]", error);
        disposeAll(geometries);
        return null;
    }
    if (!result || Math.abs(result.area || 0) <= 1e-7) {
        result?.remove?.();
        disposeAll(geometries);
        alert("La operación booleana no produjo una geometría válida.");
        return null;
    }
    const owner = makeResultOwner(result, owners, normalized);
    result.remove?.();
    disposeAll(geometries);
    if (!owner) return null;
    owners.forEach(old => {
        const parent = old.parent;
        old.remove();
        cleanEmptyContainment(parent);
    });
    window.recalculateDynamicSubtractions?.();
    paper.view.update();
    return commitSelection(owner);
}

export function unionSelected(items = null) { return booleanSelection("union", items); }
export function intersectSelected(items = null) { return booleanSelection("intersect", items); }
export function subtractSelected(items = null) { return booleanSelection("subtract", items); }

if (typeof window !== "undefined") {
    window.EKKO_BOOLEAN = { booleanSelection, unionSelected, intersectSelected, subtractSelected };
    window.unionSelected = unionSelected;
    window.intersectSelected = intersectSelected;
    window.subtractSelected = subtractSelected;
}

import { isMockupOrMask, isContainmentWrapper, getPublicOwner, getPublicOwners, getOwnerLocalGeometry, toWorldGeometry, worldPointToOwner, getPublicWorldBounds } from "./designGeometry.js";
import { getCanonicalDesignLayer, realGeometryIntersects, isAboveInRenderOrder, getStackingUnit, VECTOR_KIND } from "./vectorSemantics.js";


/*
 * Diagnostic-only CSG trace.  This module deliberately does not enable the
 * trace, create geometry, or read Paper.js geometry unless the caller opts in
 * with ?runtimeDiag=1&csgTrace=1 or window.EKKO_CSG_TRACE = true/{enabled:true}.
 * The trace is observational: no owner, fill, z-order, boolean operand, or
 * result is changed by these helpers.
 */
let activeCSGTracePass = null;
const CSG_TRACE_SCHEMA = 'ekko-csg-trace/1';

function csgTraceRequested() {
    try {
        const search = typeof window !== 'undefined' ? String(window.location?.search || '') : '';
        const configured = typeof window !== 'undefined' ? window.EKKO_CSG_TRACE : null;
        return /(?:^|[?&])csgTrace=1(?:&|$)/.test(search) ||
            configured === true || configured?.enabled === true;
    } catch (_) { return false; }
}

function csgTraceSafe(value) {
    try {
        return JSON.parse(JSON.stringify(value, (_key, item) => {
            if (typeof item === 'number' && !Number.isFinite(item)) return String(item);
            if (typeof item === 'function') return `[Function:${item.name || 'anonymous'}]`;
            return item;
        }));
    } catch (_) { return null; }
}

function csgColorSnapshot(color) {
    if (!color) return null;
    try {
        return {
            css: typeof color.toCSS === 'function' ? color.toCSS(true) : null,
            string: typeof color.toString === 'function' ? color.toString() : String(color),
            red: Number.isFinite(color.red) ? color.red : null,
            green: Number.isFinite(color.green) ? color.green : null,
            blue: Number.isFinite(color.blue) ? color.blue : null,
            alpha: Number.isFinite(color.alpha) ? color.alpha : null
        };
    } catch (_) { return '[UnreadableColor]'; }
}

function csgBoundsSnapshot(bounds) {
    if (!bounds) return null;
    try {
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
            left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom };
    } catch (_) { return null; }
}

function csgGeometrySnapshot(geometry) {
    if (!geometry) return { present: false, valid: false };
    try {
        const bounds = csgBoundsSnapshot(geometry.bounds);
        const area = Number(geometry.area);
        let segments = 0;
        const seen = new Set();
        const count = item => {
            if (!item || seen.has(item)) return;
            seen.add(item);
            if (item.segments) segments += item.segments.length;
            item.children?.forEach(count);
        };
        count(geometry);
        const validBounds = !!bounds && [bounds.x, bounds.y, bounds.width, bounds.height]
            .every(Number.isFinite) && bounds.width >= 0 && bounds.height >= 0;
        return { present: true, className: geometry.className || null,
            area: Number.isFinite(area) ? area : null, segments,
            bounds, valid: validBounds && Number.isFinite(area) && Math.abs(area) >= 0 };
    } catch (error) {
        return { present: true, valid: false, error: String(error?.message || error) };
    }
}

function csgParentChain(item) {
    const chain = [];
    const seen = new Set();
    let current = item;
    while (current && !seen.has(current)) {
        seen.add(current);
        let data = {};
        try { data = current.data || {}; } catch (_) {}
        chain.push({ className: current.className || current.constructor?.name || null,
            id: current.id ?? null, semanticId: data.semanticId ?? data.ownerId ?? data.fusionId ?? null,
            index: typeof current.index === 'number' ? current.index : null,
            name: current.name || null });
        current = current.parent;
    }
    return chain;
}

function csgItemSnapshot(item, depth = 0, seen = new Set()) {
    if (!item || seen.has(item) || depth > 16) return depth > 16 ? '[MaxDepth]' : null;
    seen.add(item);
    try {
        const data = item.data || {};
        const snapshot = {
            className: item.className || item.constructor?.name || null,
            id: item.id ?? null,
            name: item.name || null,
            semanticId: data.semanticId ?? data.ownerId ?? data.fusionId ?? null,
            role: data.role ?? null,
            isHole: data.isHole ?? null,
            originalIsHole: data.originalIsHole ?? null,
            isMask: data.isMask ?? null,
            mockup: data.mockup ?? null,
            isSmartFusion: data.isSmartFusion ?? null,
            fillColor: csgColorSnapshot(item.fillColor),
            strokeColor: csgColorSnapshot(item.strokeColor),
            opacity: Number.isFinite(item.opacity) ? item.opacity : null,
            visible: item.visible !== false,
            index: typeof item.index === 'number' ? item.index : null,
            fillRule: item.fillRule || data.originalFillRule || null,
            geomBase: csgGeometrySnapshot(data.geomBase),
            liveGeometry: csgGeometrySnapshot(item),
            bounds: csgBoundsSnapshot(item.bounds),
            parentChain: csgParentChain(item),
            children: []
        };
        if (item.children) Array.from(item.children).forEach(child => {
            const childSnapshot = csgItemSnapshot(child, depth + 1, seen);
            if (childSnapshot) snapshot.children.push(childSnapshot);
        });
        return snapshot;
    } catch (error) {
        return { className: null, id: null, error: String(error?.message || error) };
    }
}

function csgItemRef(item) {
    if (!item) return null;
    try {
        const data = item.data || {};
        return { className: item.className || item.constructor?.name || null,
            id: item.id ?? null, semanticId: data.semanticId ?? data.ownerId ?? data.fusionId ?? null,
            isHole: data.isHole ?? null, originalIsHole: data.originalIsHole ?? null,
            isMask: data.isMask ?? null, mockup: data.mockup ?? null,
            fillColor: csgColorSnapshot(item.fillColor), strokeColor: csgColorSnapshot(item.strokeColor),
            opacity: Number.isFinite(item.opacity) ? item.opacity : null,
            bounds: csgBoundsSnapshot(item.bounds), index: typeof item.index === 'number' ? item.index : null,
            parentChain: csgParentChain(item) };
    } catch (error) { return { error: String(error?.message || error) }; }
}

function csgVisibleTree(layer) {
    try {
        return layer ? csgItemSnapshot(layer) : null;
    } catch (_) { return null; }
}

function csgOwnersSnapshot(items) {
    try {
        return getPublicOwners(items || []).map(owner => csgItemSnapshot(owner)).filter(Boolean);
    } catch (error) { return [{ error: String(error?.message || error) }]; }
}

function csgTraceEvent(pass, type, details = {}) {
    if (!pass) return;
    try { pass.events.push({ at: new Date().toISOString(), type, ...csgTraceSafe(details) }); }
    catch (_) {}
}

function csgTraceForCurrentPass() {
    if (!csgTraceRequested()) return null;
    try {
        const global = window;
        const existing = global.EKKO_CSG_TRACE;
        if (existing?.__ekkoCsgTraceApi) return existing;
        const api = {
            __ekkoCsgTraceApi: true,
            schema: CSG_TRACE_SCHEMA,
            enabled: true,
            startedAt: new Date().toISOString(),
            _stateSequence: 0,
            _passes: [],
            clear() { this._passes.length = 0; this._stateSequence = 0; return { ok: true }; },
            getPasses() { return this._passes.slice(); },
            report() { return csgTraceSafe({ schema: this.schema, enabled: this.enabled, startedAt: this.startedAt, passes: this._passes }); },
            setEnabled(value) { this.enabled = !!value; return { enabled: this.enabled }; }
        };
        global.EKKO_CSG_TRACE = api;
        return api;
    } catch (_) { return null; }
}

function csgTraceBegin(layer, items) {
    const api = csgTraceForCurrentPass();
    if (!api || !api.enabled) return null;
    try {
        const pass = { id: `CSG-${String(++api._stateSequence).padStart(5, '0')}`, startedAt: new Date().toISOString(),
            targetLayer: csgItemSnapshot(layer, 0, new Set()), items: csgOwnersSnapshot(items), subItems: [], candidatePairs: [], operations: [], events: [], finalVisibleTree: null };
        // Retain the complete pass; the caller explicitly enabled this trace.
        api._passes.push(pass);
        return pass;
    } catch (_) { return null; }
}

function csgTraceFinish(pass, layer, items, reason = null) {
    if (!pass) return;
    try {
        pass.finishedAt = new Date().toISOString();
        pass.reason = reason;
        pass.finalVisibleTree = csgVisibleTree(layer);
        pass.finalOwners = csgOwnersSnapshot(items);
    } catch (_) {}
}

function csgTraceOperation(pass, operation, details = {}) {
    if (!pass) return;
    try { pass.operations.push({ at: new Date().toISOString(), operation, ...csgTraceSafe(details) }); }
    catch (_) {}
}
/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/geometricUngroup.js
ACCIÓN: REEMPLAZAR COMPLETAMENTE
ESTADO: PENDIENTE DE VALIDACIÓN CONTRA CONTRATO
DEPENDENCIAS DIRECTAS: ASSETS/js/modules/canvas-pro/selection.js
======================================================================== */

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Architecture v36.3 - Deep Recursive Extraction & Wrapper Group Sanitization) - Deep Recursive Extraction & Containment Hierarchy Engine)
Descripción:
    Motor geométrico de Descomposición por Jerarquía de Contención y Capas SVG para EKKO Studio.
    Optimizado para corte y grabado láser.
========================================================================= */

function isPath(item) {
    return item && (item.className === 'Path' || (typeof paper !== 'undefined' && paper.Path && item instanceof paper.Path));
}

function isCompoundPath(item) {
    return item && (item.className === 'CompoundPath' || (typeof paper !== 'undefined' && paper.CompoundPath && item instanceof paper.CompoundPath));
}

function isGroup(item) {
    return item && (item.className === 'Group' || (typeof paper !== 'undefined' && paper.Group && item instanceof paper.Group));
}

function isPlacedSymbol(item) {
    return item && (item.className === 'PlacedSymbol' || item.className === 'SymbolItem' ||
        (typeof paper !== 'undefined' && ((paper.PlacedSymbol && item instanceof paper.PlacedSymbol) || (paper.SymbolItem && item instanceof paper.SymbolItem))));
}

/**
 * Obtiene la matriz acumulada global de un elemento recorriendo sus ancestros
 */
function getMatrixRelativeTo(item, root) {
    let mat = item.matrix ? item.matrix.clone() : new paper.Matrix();
    let curr = item.parent;
    const visited = new Set();
    while (curr && curr !== root && curr !== paper.project && !visited.has(curr)) {
        visited.add(curr);
        if (curr.matrix && !curr.matrix.isIdentity()) {
            mat = curr.matrix.chain(mat);
        }
        curr = curr.parent;
    }
    return mat;
}

/**
 * Aplica y hornea la matriz de transformación en los segmentos y curvas de un trazado
 */
function bakeMatrixIntoPath(path, matrix, visited = new Set()) {
    if (!path || !matrix || matrix.isIdentity() || visited.has(path)) return;
    visited.add(path);
    if (path.segments) {
        path.segments.forEach(seg => {
            const originalPoint = seg.point.clone();
            const originalHandleIn = seg.handleIn ? seg.handleIn.clone() : null;
            const originalHandleOut = seg.handleOut ? seg.handleOut.clone() : null;
            seg.point = matrix.transform(originalPoint);
            if (originalHandleIn) {
                const absoluteHandle = originalPoint.add(originalHandleIn);
                seg.handleIn = matrix.transform(absoluteHandle).subtract(seg.point);
            }
            if (originalHandleOut) {
                const absoluteHandle = originalPoint.add(originalHandleOut);
                seg.handleOut = matrix.transform(absoluteHandle).subtract(seg.point);
            }
        });
    }
    if (path.children && Array.isArray(path.children)) {
        path.children.forEach(child => bakeMatrixIntoPath(child, matrix, visited));
    }
}

/**
 * Descompone cualquier estructura en trazados atómicos cerrados simples (paper.Path)
 */
let docOrderCounter = 0;
let decompositionScopeCounter = 0;
function flattenToAtomicPaths(item, accumulatedMatrix = null, parentMeta = {}, visited = new Set()) {
    if (!item || visited.has(item)) return [];
    visited.add(item);
    const currentMatrix = accumulatedMatrix ? accumulatedMatrix.chain(item.matrix || new paper.Matrix()) : (item.matrix ? item.matrix.clone() : new paper.Matrix());
    const atomicPaths = [];
    const isFromCompound = parentMeta.isFromCompound || isCompoundPath(item);

    if (isPath(item)) {
        // One coordinate contract: the clone keeps its geometry in the
        // decomposition root's local space.  No segment baking is performed;
        // the returned public owner carries the root world matrix.
        const cloned = item.clone({ insert: false });
        cloned.applyMatrix = false;
        cloned.matrix = currentMatrix.clone();
        if (cloned.segments && cloned.segments.length >= 3) {
            cloned.closed = true;
            const sourceData = item.data || {};
            cloned.data = {
                // Preserve the canonical source contract on every atomic
                // contour.  Do not reduce an imported CompoundPath to a
                // depth-only classification: source fill rule, explicit
                // contour metadata and source index must survive ungroup.
                ...parentMeta,
                ...sourceData,
                docOrder: docOrderCounter++,
                originalFillColor: item.fillColor ? item.fillColor.clone() :
                    (sourceData.originalFillColor?.clone?.() || null),
                originalStrokeColor: item.strokeColor ? item.strokeColor.clone() :
                    (sourceData.originalStrokeColor?.clone?.() || null),
                originalStrokeWidth: item.strokeWidth || sourceData.originalStrokeWidth || 0,
                // La metadata explícita del SVG tiene prioridad sobre la
                // clasificación geométrica de fallback.
                originalIsHole: typeof sourceData.originalIsHole === 'boolean' ? sourceData.originalIsHole :
                    (typeof parentMeta.originalIsHole === 'boolean' ? parentMeta.originalIsHole : undefined),
                sourceContourIndex: sourceData.sourceContourIndex ?? parentMeta.sourceContourIndex ?? null,
                isFromCompound: isFromCompound,
                originalClockwise: cloned.clockwise,
                sourceWinding: typeof sourceData.sourceWinding === 'boolean'
                    ? sourceData.sourceWinding : cloned.clockwise
            };
            atomicPaths.push(cloned);
        } else {
            cloned.remove();
        }
    } else if (isCompoundPath(item)) {
        if (item.children && item.children.length > 0) {
            item.children.forEach(child => {
                atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix, {
                    isFromCompound: true,
                    compoundFill: item.fillColor,
                    source: item.data?.source,
                    userImported: item.data?.userImported,
                    originalFillRule: item.data?.originalFillRule,
                    sourceFillRuleExplicit: item.data?.sourceFillRuleExplicit,
                    originalIsHole: typeof item.data?.originalIsHole === 'boolean' ? item.data.originalIsHole : undefined,
                    contourRole: item.data?.contourRole,
                    sourceContourIndex: item.data?.sourceContourIndex,
                    isHole: typeof item.data?.isHole === 'boolean' ? item.data.isHole : undefined
                }, visited));
            });
        }
  } else if (isGroup(item)) {
  if (item.children && item.children.length > 0) {
    const childrenCopy = [...item.children];
    // A group's flag is not inherited blindly: descendants keep their own
    // source metadata and are classified by explicit child metadata first.
    childrenCopy.forEach(child => {
      if (child.clipMask) return;
      atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix, {
        isFromCompound: false
      }, visited));
    });
  }
} else if (isPlacedSymbol(item)) {
        const def = (item.symbol && item.symbol.item) || item.definition || (item.symbol && item.symbol.definition);
        if (def) {
            const defClone = def.clone({ insert: false });
            atomicPaths.push(...flattenToAtomicPaths(defClone, currentMatrix, { isFromCompound: false }, visited));
            defClone.remove();
        }
    }
    return atomicPaths;
}

/**
 * Obtiene un punto interior estricto y garantizado de un paper.Path.
 */
function getInteriorTestPoint(path) {
    if (!path || !path.bounds) return null;
    const center = path.bounds.center;
    if (path.contains(center)) return center;
    if (path.curves && path.curves.length > 0) {
        for (let c = 0; c < path.curves.length; c++) {
            const curve = path.curves[c];
            const pt = curve.getPointAtTime(0.5);
            const normal = curve.getNormalAtTime(0.5).normalize(2);
            const inward1 = pt.add(normal);
            if (path.contains(inward1)) return inward1;
            const inward2 = pt.subtract(normal);
            if (path.contains(inward2)) return inward2;
        }
    }
    return center;
}

function isContainedIn(child, parent) {
    if (!child || !parent || child === parent) return false;
    if (!parent.bounds.contains(child.bounds) && !parent.bounds.intersects(child.bounds)) {
        return false;
    }
    const testPoints = [];
    const interior = getInteriorTestPoint(child);
    if (interior) testPoints.push(interior);
    if (child.segments && child.segments.length > 0) {
        const step = Math.max(1, Math.floor(child.segments.length / 6));
        for (let i = 0; i < child.segments.length; i += step) {
            testPoints.push(child.segments[i].point);
        }
    }
    if (testPoints.length === 0) return false;
    let containedCount = 0;
    for (let i = 0; i < testPoints.length; i++) {
        if (parent.contains(testPoints[i])) {
            containedCount++;
        }
    }
    return containedCount >= Math.ceil(testPoints.length * 0.5);
}

/**
 * Construye el árbol topológico de contención geométrica y calcula profundidades relativas.
 */
function buildContainmentTree(atomicPaths) {
  // ✅ NO reordenar por área: el árbol de contención se construye sobre
  // el orden original del documento. El área solo se usa como criterio
  // para validar contención (un hijo debe ser más chico que su padre).
  atomicPaths.sort((a, b) => (a.data?.docOrder || 0) - (b.data?.docOrder || 0));
    const nodes = atomicPaths.map((path, idx) => ({
        id: idx,
        path: path,
        area: Math.abs(path.area),
        parent: null,
        children: [],
        depth: 0,
        isHole: false,
        docOrder: path.data?.docOrder || idx
    }));

    for (let i = 0; i < nodes.length; i++) {
        const candidate = nodes[i];
        let bestParent = null;
        for (let j = 0; j < nodes.length; j++) {
            if (i === j) continue;
            const potentialParent = nodes[j];
            if (potentialParent.area > candidate.area && isContainedIn(candidate.path, potentialParent.path)) {
                if (!bestParent || potentialParent.area < bestParent.area) {
                    bestParent = potentialParent;
                }
            }
        }
        if (bestParent) {
            candidate.parent = bestParent;
            bestParent.children.push(candidate);
        }
    }

    function computeDepth(node, currentDepth) {
        node.depth = currentDepth;
        node.children.forEach(child => computeDepth(child, currentDepth + 1));
    }

    nodes.filter(n => n.parent === null).forEach(root => computeDepth(root, 0));
    return { nodes };
}

function resolveItemSemantics(node, rootTarget) {
    const path = node?.path;
    const meta = path?.data || {};
    // Explicit source metadata is authoritative.  It is intentionally tested
    // before any topology fallback so an original real hole cannot be turned
    // into a solid or a cosmetic transparent path during ungroup.
    if (typeof meta.originalIsHole === "boolean") return meta.originalIsHole;
    if (typeof meta.contourRole === "string") return meta.contourRole === "hole";
    if (typeof meta.isHole === "boolean" &&
        (meta.source === "svg" || meta.source === "client-svg")) return meta.isHole;

    const sourceRule = String(meta.originalFillRule || rootTarget?.data?.originalFillRule || "").toLowerCase();
    const isClientSource = meta.source === "client-svg" || meta.userImported === true ||
        rootTarget?.data?.source === "client-svg";
    if (isClientSource && (sourceRule === "nonzero" || sourceRule === "non-zero")) {
        // For nonzero SVG, a contour toggles filled/unfilled only when its
        // winding opposes the immediately containing contour.  Same-winding
        // depth-1 islands therefore remain solids (008.svg: 3 islands),
        // unlike depth parity.
        if (!node.parent) return false;
        const windingSign = contour => {
            const data = contour?.path?.data || {};
            const clockwise = typeof data.sourceWinding === "boolean"
                ? data.sourceWinding : !!data.originalClockwise;
            return clockwise ? 1 : -1;
        };
        // Nonzero fill is the signed sum of every enclosing contour.  A
        // contour is a hole only when crossing it takes a nonzero winding
        // sum to zero.  This keeps same-winding islands solid (and also
        // handles a hole nested inside such an island) instead of merely
        // comparing the immediate parent's direction.
        const ancestors = [];
        let parent = node.parent;
        while (parent) {
            ancestors.unshift(parent);
            parent = parent.parent;
        }
        const before = ancestors.reduce((sum, ancestor) => sum + windingSign(ancestor), 0);
        return before !== 0 && before + windingSign(node) === 0;
    }

    // Explicit evenodd, or a non-source object without reliable source
    // semantics, is the controlled topology fallback.
    return (Number(node?.depth) || 0) % 2 === 1;
}

export function getGlobalUnsubtractedPath(item) {
    // Sole world-geometry producer: geomBase is owner-local and the complete
    // owner global matrix is applied exactly once by the canonical layer.

    const world = toWorldGeometry(item);
    if (world) {
        // Paper.js boolean operations (subtract/unite/intersect) read raw
        // segment coordinates and ignore an item's .matrix while applyMatrix is
        // false. toWorldGeometry leaves the owner world transform in .matrix, so
        // without baking it here a moved hole is still cut at its pristine
        // owner-local position and its subtraction never follows the move.
        try { world.applyMatrix = true; } catch (_) {}
    }
    return world;
}

// CSG operands are calculated in project/global coordinates. Before adding
// the result back under a transformed Path/CompoundPath, convert it to the
// owner's local coordinate system. Otherwise a moved fusion mask is rebuilt
// with identity coordinates and drifts from its Raster after mouse-up.
function attachGlobalGeometryToOwnerLocal(geometry, owner) {
    if (!geometry || !owner) return geometry;
    try {
        const ownerGlobal = owner.globalMatrix;
        const inverse = ownerGlobal?.inverted?.();
        if (inverse && typeof geometry.transform === "function") {
            geometry.transform(inverse);
        }
    } catch (e) {}
    return geometry;
}

function copyOwnerState(source, target) {
    if (!source || !target) return target;
    target.data = { ...(source.data || {}) };
    target.name = source.name;
    target.visible = source.visible !== false;
    target.opacity = source.opacity;
    target.blendMode = source.blendMode;
    target.locked = source.locked === true;
    target.clipped = source.clipped === true;
    target.clipMask = source.clipMask === true;
    target.applyMatrix = false;
    if (source.matrix?.clone) target.matrix = source.matrix.clone();
    if (source.fillColor?.clone) target.fillColor = source.fillColor.clone();
    else target.fillColor = source.fillColor || null;
    if (source.strokeColor?.clone) target.strokeColor = source.strokeColor.clone();
    else target.strokeColor = source.strokeColor || null;
    target.strokeWidth = source.strokeWidth;
    target.strokeScaling = source.strokeScaling;
    target.fillRule = source.fillRule;
    target.dashArray = source.dashArray?.slice?.() || source.dashArray || null;
    return target;
}

function remapOwnerReferences(oldOwner, replacement, parentBeforeRemove = null) {
    if (!oldOwner || !replacement || oldOwner === replacement) return replacement;
    const oldId = oldOwner.id;
    const replace = item => item === oldOwner ? replacement : item;

    if (Array.isArray(window.selectedItems)) {
        window.selectedItems = window.selectedItems.map(replace);
    }
    if (window.selectedItem === oldOwner) window.selectedItem = replacement;
    if (Array.isArray(window._ekkoHistorySelection)) {
        window._ekkoHistorySelection = window._ekkoHistorySelection.map(replace);
    }

    // A public owner can live inside a product containment wrapper or a
    // fusion group. Keep those explicit references valid after a Path has to
    // become a CompoundPath because a boolean produced multiple contours.
    let ancestor = parentBeforeRemove || oldOwner.parent;
    const visited = new Set();
    while (ancestor && !visited.has(ancestor)) {
        visited.add(ancestor);
        const data = ancestor.data || {};
        for (const key of ["publicOwner", "owner", "maskGroup", "originalVector", "group"]) {
            if (data[key] === oldOwner) data[key] = replacement;
        }
        if (data.publicOwnerId === oldId) data.publicOwnerId = replacement.id;
        if (data.transformOwnerId === oldId) data.transformOwnerId = replacement.id;
        ancestor = ancestor.parent;
    }
    return replacement;
}

function replacePublicOwner(owner, replacement) {
    if (!owner || !replacement || owner === replacement) return owner;
    const parent = owner.parent;
    const index = typeof owner.index === "number"
        ? owner.index
        : (parent?.children?.indexOf?.(owner) ?? 0);
    copyOwnerState(owner, replacement);
    if (replacement.data) {
        if (replacement.data.ownerId === owner.id) replacement.data.ownerId = replacement.id;
        if (replacement.data.publicOwnerId === owner.id) replacement.data.publicOwnerId = replacement.id;
        if (replacement.data.transformOwnerId === owner.id) replacement.data.transformOwnerId = replacement.id;
    }
    if (parent?.insertChild) parent.insertChild(index, replacement);
    else parent?.addChild?.(replacement);
    remapOwnerReferences(owner, replacement, parent);
    owner.remove();
    try { window.EKKO_FUSION_CONTROLLER?.rebuildFusionRegistry?.(); } catch (_) {}
    return replacement;
}

/**
 * Install a detached boolean result into its public owner.
 *
 * Paper.js Path and CompoundPath do not share a child API. A subtraction can
 * legitimately turn one closed Path into a CompoundPath with several
 * contours, so calling addChildren() on the original Path used to abort CSG
 * for perfectly valid small holes and imported vector bases.
 */
export function installOwnerGeometry(owner, geometry, geometryIsLocal = false) {
    if (!owner || !geometry) return owner;
    const geometryFillRule = geometry.fillRule;
    if (!geometryIsLocal) attachGlobalGeometryToOwnerLocal(geometry, owner);

    if (owner instanceof paper.CompoundPath) {
        owner.removeChildren();
        if (geometry instanceof paper.CompoundPath) owner.addChildren(geometry.removeChildren());
        else if (geometry instanceof paper.Path) owner.addChild(geometry);
        if (geometryFillRule) {
            owner.fillRule = geometryFillRule;
            owner.data = { ...(owner.data || {}), fillRule: geometryFillRule };
        }
        return owner;
    }

    if (owner instanceof paper.Path) {
        if (geometry instanceof paper.Path) {
            const segments = geometry.segments.map(segment => segment.clone());
            owner.removeSegments();
            owner.addSegments(segments);
            geometry.remove();
            return owner;
        }
        const children = geometry instanceof paper.CompoundPath
            ? geometry.removeChildren()
            : (Array.isArray(geometry.children) ? geometry.removeChildren() : [geometry]);
        if (children.length === 1 && children[0] instanceof paper.Path) {
            const segments = children[0].segments.map(segment => segment.clone());
            owner.removeSegments();
            owner.addSegments(segments);
            children[0].remove();
            return owner;
        }
        const replacement = new paper.CompoundPath({ insert: false });
        replacement.addChildren(children);
        const installed = replacePublicOwner(owner, replacement);
        if (geometryFillRule && installed) {
            installed.fillRule = geometryFillRule;
            installed.data = { ...(installed.data || {}), fillRule: geometryFillRule };
        }
        return installed;
    }

    // A future owner type may be a Group. Keep the operation defensive rather
    // than mutating an object with an incompatible Paper.js child API.
    if (owner.removeChildren && owner.addChild) {
        owner.removeChildren();
        owner.addChild(geometry);
    }
    return owner;
}

/**
 * A text-to-vector CompoundPath keeps its counters as internal contours until
 * the user explicitly decomposes it. Those contours are still real geometry,
 * not a visual transparency: expose them to CSG as virtual cutters so every
 * solid below the compound is perforated immediately.
 */
function collectInternalVirtualHoles(items) {
    const result = [];
    const visited = new Set();
    const visit = item => {
        if (!item || visited.has(item)) return;
        const owner = getPublicOwner(item, new Set());
        if (!owner) {
            item.children?.forEach(visit);
            return;
        }
        if (visited.has(owner)) return;
        visited.add(owner);

        if (!owner.data?.isSmartFusion && owner.data?.geomBase) {
            const base = owner.data.geomBase;
            const children = Array.isArray(base?.children) ? base.children : [];
            children.forEach((child, index) => {
                const data = child?.data || {};
                const isHoleContour = data.semanticKind === VECTOR_KIND.HOLE ||
                    data.isHole === true || data.originalIsHole === true;
                if (!isHoleContour) return;
                const geometry = child.clone({ insert: false });
                geometry.applyMatrix = false;
                geometry.matrix = new paper.Matrix();
                try {
                    const matrix = owner.globalMatrix?.clone?.() || owner.matrix?.clone?.();
                    if (matrix && !matrix.isIdentity()) geometry.transform(matrix);
                } catch (_) {}
                geometry.applyMatrix = true;
                result.push({
                    geom: geometry,
                    fusionId: `internal:${owner.id}:${index}`,
                    group: owner,
                    ownerContainmentKey: owner.data?.containmentKey || null,
                    internal: true
                });
            });
        }

        // Semantic owners own their internal contours. Plain structural groups
        // must still be traversed so nested user vectors are discovered.
        if (!owner.data?.semanticKind && !owner.data?.isSmartFusion) {
            owner.children?.forEach(visit);
        }
    };
    (Array.isArray(items) ? items : [items]).forEach(visit);
    return result;
}

// CSG geometry is kept in project coordinates, but a detached SVG hole must
// never subtract or render outside the active product boundary. The original
// hole item is not modified; only the temporary boolean operand is confined.
function bakeGeometryClone(geometry) {
    const clone = geometry?.clone?.({ insert: false });
    if (!clone) return null;
    const matrix = clone.matrix?.clone?.();
    clone.applyMatrix = false;
    clone.matrix = new paper.Matrix();
    if (matrix && !matrix.isIdentity()) clone.transform(matrix);
    clone.applyMatrix = true;
    return clone;
}

function geometryClockwise(geometry) {
    const first = geometry instanceof paper.CompoundPath
        ? (geometry.children?.[0] || null)
        : geometry;
    if (!first) return true;
    try {
        if (typeof first.isClockwise === 'function') return first.isClockwise();
        if (typeof first.clockwise === 'boolean') return first.clockwise;
    } catch (_) {}
    return true;
}

/**
 * Paper.js boolean subtraction expects consistently oriented operands.
 * Decomposed vector owners are CompoundPaths, and a one-child CompoundPath
 * has no reliable `isClockwise()` value; in several font contours that made
 * subtract() return an area larger than the original instead of drilling a
 * hole. Normalize the operand to a simple positive Path (or a same-winding
 * CompoundPath) before every CSG subtraction. Verified load-bearing: without
 * the uniform orientation, valid small-hole cuts are rejected by the area
 * check. Rendering safety additionally comes from rebuilding every accepted
 * result as an even-odd compound (see evenOddResult).
 */
function normalizeSubtractiveOperand(geometry, reference = null, preserveCompoundTopology = false) {
    if (!geometry) return geometry;
    const targetClockwise = reference ? geometryClockwise(reference) : true;
    if (geometry instanceof paper.CompoundPath) {
        const sourceChildren = Array.from(geometry.children || []);
        if (sourceChildren.length === 1 && sourceChildren[0] instanceof paper.Path) {
            const path = bakeGeometryClone(sourceChildren[0]);
            if (path) {
                try { path.setClockwise(targetClockwise); } catch (_) {}
                geometry.remove();
                return path;
            }
        }
        if (sourceChildren.length > 1 && preserveCompoundTopology) {
            const preserved = bakeGeometryClone(geometry);
            if (preserved) {
                geometry.remove();
                return preserved;
            }
        }
        if (sourceChildren.length > 1) {
            const compound = new paper.CompoundPath({ insert: false });
            compound.applyMatrix = false;
            compound.matrix = new paper.Matrix();
            sourceChildren.forEach(child => {
                const normalized = bakeGeometryClone(child);
                if (!normalized) return;
                try { normalized.setClockwise?.(targetClockwise); } catch (_) {}
                compound.addChild(normalized);
            });
            geometry.remove();
            return compound;
        }
    }
    const path = bakeGeometryClone(geometry);
    if (path) {
        try { path.setClockwise?.(targetClockwise); } catch (_) {}
        geometry.remove();
        return path;
    }
    return geometry;
}

/**
 * Rebuild an accepted boolean result as an even-odd compound. Boolean
 * outputs are disjoint contours, so even-odd renders exactly the intended
 * material while being immune to per-contour winding quirks.
 */
function evenOddResult(geometry) {
    if (!geometry) return geometry;
    if (geometry instanceof paper.CompoundPath) {
        geometry.fillRule = 'evenodd';
        return geometry;
    }
    return geometry;
}

function interiorPointOf(geometry) {
    try {
        const leaf = geometry instanceof paper.CompoundPath
            ? (geometry.children?.[0] || null)
            : geometry;
        const point = leaf?.getInteriorPoint?.();
        if (point) return point;
        return geometry.bounds?.center || null;
    } catch (_) {
        return geometry?.bounds?.center || null;
    }
}

/**
 * True when a hole cutter actually overlaps a solid's material. Bounds
 * overlap alone is not enough (grazing contours), and Paper booleans can
 * miss tiny overlaps, so several sample points of the cutter vote inside
 * the base under even-odd semantics. Used to excuse spurious candidacies:
 * a hole with no real overlap never needed a cut from that solid.
 */
function contourSamplePoints(geometry, count = 8) {
    const points = [];
    try {
        const leaf = geometry instanceof paper.CompoundPath
            ? (geometry.children?.[0] || null)
            : geometry;
        const length = leaf?.length || 0;
        if (length > 0) {
            for (let k = 0; k < count; k++) {
                const point = leaf.getPointAt((length * k) / count);
                if (point) points.push(point);
            }
        }
    } catch (_) {}
    return points;
}

function holeOverlapsSolid(holeGeom, baseGeom) {
    if (!holeGeom || !baseGeom) return false;
    // Either direction counts: a hole grazing a solid, or a small solid
    // island sitting entirely inside a hole region, both need the cut.
    const holeProbes = [];
    const holeInterior = interiorPointOf(holeGeom);
    if (holeInterior) holeProbes.push(holeInterior);
    holeProbes.push(...contourSamplePoints(holeGeom));
    if (!holeProbes.length && holeGeom.bounds?.center) holeProbes.push(holeGeom.bounds.center);
    if (holeProbes.some(point => evenOddContains(baseGeom, point))) return true;
    const solidProbes = [];
    const solidInterior = interiorPointOf(baseGeom);
    if (solidInterior) solidProbes.push(solidInterior);
    solidProbes.push(...contourSamplePoints(baseGeom));
    if (!solidProbes.length && baseGeom.bounds?.center) solidProbes.push(baseGeom.bounds.center);
    return solidProbes.some(point => evenOddContains(holeGeom, point));
}

/**
 * Even-odd point-in-fill over a world-baked geometry. Paper's own
 * `contains()` is winding-based and unreliable on multi-contour results;
 * counting leaf containment gives the even-odd answer the renderer uses.
 */
function evenOddContains(baseGeometry, point) {
    if (!baseGeometry || !point) return false;
    try {
        const leaves = baseGeometry instanceof paper.CompoundPath
            ? Array.from(baseGeometry.children || [])
            : [baseGeometry];
        let hits = 0;
        leaves.forEach(leaf => {
            try { if (leaf?.contains?.(point)) hits += 1; } catch (_) {}
        });
        return hits % 2 === 1;
    } catch (_) {
        return false;
    }
}

function buildEvenOddComposite(baseGeometry, holeEntries) {
    if (!baseGeometry || !holeEntries?.length) return null;
    const composite = new paper.CompoundPath({ insert: false });
    composite.applyMatrix = false;
    composite.matrix = new paper.Matrix();
    composite.fillRule = 'evenodd';
    const included = [];
    const append = geometry => {
        if (!geometry) return;
        if (geometry instanceof paper.CompoundPath) {
            const children = geometry.removeChildren();
            children.forEach(append);
            return;
        }
        if (geometry instanceof paper.Path) {
            const clone = bakeGeometryClone(geometry);
            if (clone) composite.addChild(clone);
        }
    };
    append(baseGeometry.clone?.({ insert: false }) || baseGeometry);
    holeEntries.forEach(entry => {
        const hole = entry.geom?.clone?.({ insert: false }) || entry.geom;
        if (!hole) return;
        // Clip the cutter to the solid. A hole contour that merely overlaps
        // the solid bounds would otherwise paint stray fill outside the
        // material once composed under even-odd.
        let clipped = null, clipFailed = false;
        try {
            const clipBase = baseGeometry.clone?.({ insert: false });
            if (clipBase) {
                clipped = clipBase.intersect(hole, { insert: false });
                clipBase.remove();
            }
        } catch (_) { clipFailed = true; clipped = null; }
        if (clipped && Math.abs(clipped.area || 0) > 1e-12) {
            append(clipped);
            try { hole.remove(); } catch (_) {}
            included.push(entry);
            return;
        }
        if (clipped) { try { clipped.remove(); } catch (_) {} }
        if (!clipFailed) {
            // Empty clip with a working boolean: the cutter is genuinely
            // outside this solid. Skipping it (instead of appending the
            // whole contour) avoids a stray filled speck. When the interior
            // still votes inside, it is a Paper precision miss: keep it.
            const interior = interiorPointOf(hole);
            if (interior && !evenOddContains(baseGeometry, interior)) {
                try { hole.remove(); } catch (_) {}
                return;
            }
        }
        append(hole);
        included.push(entry);
    });
    if (composite.children.length <= 1) {
        try { composite.remove(); } catch (_) {}
        return null;
    }
    return { composite, included };
}

// CSG geometry is kept in project coordinates, but a detached SVG hole must
// never subtract or render outside the active product boundary. The original
// hole item is not modified; only the temporary boolean operand is confined.
//
// The product mask is the real mockup silhouette (often a CompoundPath), not
// its bounding box: a hole can sit inside the bbox yet over an area with no
// material. Such holes are recorded in outOfProductKeys so the report can
// tell "nothing to cut here" apart from a genuinely unresolved cutter.
function confineSubtractiveGeometry(geometry, holeKey = null, outOfProductKeys = null) {
    if (!geometry || !window.clipMask || window.infiniteCanvasMode) return geometry;
    const markOutOfProduct = () => { if (holeKey && outOfProductKeys) outOfProductKeys.add(holeKey); };
    const boundaryContains = (boundary, point) => {
        try { return !!boundary?.contains?.(point); } catch (_) { return false; }
    };
    let boundary = null;
    try {
        boundary = getGlobalUnsubtractedPath(window.clipMask);
        if (!boundary && window.clipMask) {
            boundary = window.clipMask.clone({ insert: false });
            try {
                const maskWorld = window.clipMask.globalMatrix?.clone?.();
                boundary.applyMatrix = false;
                boundary.matrix = new paper.Matrix();
                if (maskWorld && !maskWorld.isIdentity()) boundary.transform(maskWorld);
                boundary.applyMatrix = true;
            } catch (_) {}
        }
        // Fast robust path first: bbox math plus point-in-fill votes. This
        // avoids Paper.js boolean quirks with tiny operands fully inside the
        // silhouette, and correctly rejects holes over material-free notches.
        // A single center probe is not enough near concave silhouette edges,
        // so the interior votes by majority; ties fall through to the
        // boolean clip below.
        const gb = geometry.bounds, bb = boundary?.bounds;
        if (gb && bb) {
            if (!bb.intersects(gb)) {
                markOutOfProduct();
                geometry.remove();
                return null;
            }
            if (typeof bb.contains === 'function' && bb.contains(gb)) {
                const probes = [gb.center,
                    new paper.Point(gb.x + gb.width * 0.2, gb.y + gb.height * 0.2),
                    new paper.Point(gb.x + gb.width * 0.8, gb.y + gb.height * 0.2),
                    new paper.Point(gb.x + gb.width * 0.2, gb.y + gb.height * 0.8),
                    new paper.Point(gb.x + gb.width * 0.8, gb.y + gb.height * 0.8)];
                let insideVotes = 0;
                probes.forEach(point => { if (boundaryContains(boundary, point)) insideVotes += 1; });
                if (insideVotes >= 3) return geometry;
                if (insideVotes === 0) {
                    markOutOfProduct();
                    geometry.remove();
                    return null;
                }
            }
        }
        const before = csgGeometrySnapshot(geometry);
        const confined = geometry.intersect(boundary, { insert: false });
        csgTraceOperation(activeCSGTracePass, 'confine.intersect', {
            success: !!confined, input: before, boundary: csgGeometrySnapshot(boundary), output: csgGeometrySnapshot(confined),
            accepted: !!confined && Math.abs(confined.area || 0) > 1e-12
        });
        if (confined && Math.abs(confined.area || 0) > 1e-12) {
            geometry.remove();
            return confined;
        }
        // No intersection: either truly outside the product, or a boolean
        // precision miss on a boundary-crossing operand. The interior vote
        // tells them apart so only material-free holes are excused.
        if (gb) {
            const probes = [gb.center,
                new paper.Point(gb.x + gb.width * 0.2, gb.y + gb.height * 0.2),
                new paper.Point(gb.x + gb.width * 0.8, gb.y + gb.height * 0.2),
                new paper.Point(gb.x + gb.width * 0.2, gb.y + gb.height * 0.8),
                new paper.Point(gb.x + gb.width * 0.8, gb.y + gb.height * 0.8)];
            let insideVotes = 0;
            probes.forEach(point => { if (boundaryContains(boundary, point)) insideVotes += 1; });
            if (insideVotes === 0) markOutOfProduct();
        }
        geometry.remove();
        return null;
    } catch (e) {
        csgTraceOperation(activeCSGTracePass, 'confine.intersect', {
            success: false, error: String(e?.stack || e), input: csgGeometrySnapshot(geometry),
            boundary: csgGeometrySnapshot(boundary), accepted: true, fallback: 'retain-unconfined-operand'
        });
        // If Paper.js cannot boolean-intersect this boundary, clipItem still
        // provides the final visual containment; never destroy the operand.
    } finally {
        try { boundary?.remove?.(); } catch (e) {}
    }
    return geometry;
}



function applyHoleVisualStyle(item) {
    if (!item) return;
    /*
     * A real hole is a semantic cutter, never a painted contour.
     *
     * The former implementation used the source stroke (or a dark fallback)
     * to draw every hole. That made the editor's visual guide look like the
     * mechanism that produced the hole and allowed source styles from
     * templates such as 007.svg to leak into the cutter contract. It also
     * made opacity/transparency appear to be part of the boolean operation.
     *
     * The owner remains a real, closed, selectable Paper.js geometry with
     * opacity 1. Its only visual effect is the CSG subtraction applied to
     * solids below it. Selection and node-edit overlays are responsible for
     * showing an active hole while it is selected.
     */
    const before = {
        fillColor: csgColorSnapshot(item.fillColor),
        strokeColor: csgColorSnapshot(item.strokeColor),
        opacity: item.opacity
    };
    item.data = {
        ...(item.data || {}),
        semanticKind: VECTOR_KIND.HOLE,
        isHole: true,
        isSolidShape: false,
        holeRenderMode: 'semantic-cutter-no-paint'
    };

    const clearPaint = node => {
        if (!node || node.clipMask || node.data?.isMask || node.data?.mockup) return;
        node.visible = true;
        node.opacity = 1;
        if (node instanceof paper.Path || node instanceof paper.CompoundPath) {
            node.fillColor = null;
            node.strokeColor = null;
            node.strokeWidth = 0;
        }
        node.children?.forEach(clearPaint);
    };
    clearPaint(item);
    csgTraceEvent(activeCSGTracePass, 'hole-visual-style', {
        owner: csgItemSnapshot(item), before,
        after: {
            fillColor: csgColorSnapshot(item.fillColor),
            strokeColor: csgColorSnapshot(item.strokeColor),
            opacity: item.opacity
        },
        visualMode: 'semantic-cutter-no-paint',
        physicalCSGRequired: true,
        colorIsNotSemantic: true
    });
}

// Render-order authority lives in vectorSemantics.js. CSG must use the same
// stacking-unit comparator as selection, ordering and audit code.

function extractSubtractiveItems(topList) {
    const result = [];
    const visited = new Set();
    function collectRecursive(item, ancestors = new Set()) {
        if (!item || visited.has(item)) return;
        visited.add(item);

        // Resolve each item with its own guarded owner path. `ancestors` is
        // kept separately so an owner that resolves back to an ancestor is
        // rejected without preventing valid children from being visited.
        const content = getPublicOwner(item, new Set());
        if (!content) return;
        const resolvedToAncestor = ancestors.has(content) && content !== item;
        if (resolvedToAncestor) {
            item.children?.forEach(child => {
                if (!child.clipMask && !(child.data && (child.data.wasClipMask || child.data.isMask))) {
                    collectRecursive(child, new Set(ancestors));
                }
            });
            return;
        }
        if (!visited.has(content)) visited.add(content);

        // Una fusión sólida participa del CSG mediante su máscara, no como
        // un grupo completo que también contiene la imagen. Una fusión que
        // reemplazó un hueco se representa mediante su hueco virtual.
        if (content.data?.isSmartFusion) {
            const fusionMask = content.children?.find(child =>
                child.clipMask || child.data?.isFusionMask
            );
            if (fusionMask && !fusionMask.data?.isHole && fusionMask.data?.geomBase) {
                result.push(fusionMask);
            }
            return;
        }

        const nextAncestors = new Set(ancestors);
        nextAncestors.add(item);
        nextAncestors.add(content);
        if (isGroup(content) && content.children && content.children.length > 0) {
            content.children.forEach(c => {
                if (!c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask))) {
                    collectRecursive(c, nextAncestors);
                }
            });
        } else if (content.data && content.data.geomBase) {
            result.push(content);
        }
    }
    topList.forEach(topItem => {
        collectRecursive(topItem);
    });
    return result;
}

export function recalculateDynamicSubtractions(targetLayer = null, virtualHoleEntries = null) {
    const layer = targetLayer || getCanonicalDesignLayer() || null;
    const report = {
        schema: 'ekko-csg-report/1',
        targetLayer: layer?.name || null,
        filteredItemCount: 0,
        subtractiveItemCount: 0,
        candidatePairs: 0,
        acceptedPairs: 0,
        rejectedPairs: 0,
        failedBooleans: [],
        status: 'started',
        completed: false,
        holeOwnerCount: 0,
        acceptedHoleCount: 0,
        unresolvedHoles: 0,
        acceptedHoleKeys: [],
        unresolvedHoleKeys: [],
        outOfProductHoleKeys: []
    };
    const traceSeedItems = layer?.children ? [...layer.children] : [];
    const tracePass = csgTraceBegin(layer, traceSeedItems);
    const previousTracePass = activeCSGTracePass;
    activeCSGTracePass = tracePass;
    let tracedItems = [];
    let traceReason = null;
    let subItems = [];
    const requiredHoleTargets = new Map();
    const successfulHoleTargets = new Map();
    let internalVirtualHoles = [];
    let holeGeometryCache = new Map();
    const physicalHoleKeys = new Set();
    const outOfProductHoleKeys = new Set();
    const holeKeyOf = item => item?.data?.containmentKey || item?.id || null;
    const solidKeyOf = item => item?.data?.containmentKey || item?.id || null;
    const requireHoleTarget = (holeKey, solidKey) => {
        if (!holeKey || !solidKey) return;
        if (!requiredHoleTargets.has(holeKey)) requiredHoleTargets.set(holeKey, new Set());
        requiredHoleTargets.get(holeKey).add(solidKey);
    };
    const resolveHoleTarget = (holeKey, solidKey) => {
        if (!holeKey || !solidKey) return;
        if (!successfulHoleTargets.has(holeKey)) successfulHoleTargets.set(holeKey, new Set());
        successfulHoleTargets.get(holeKey).add(solidKey);
    };
    try {
    const providedVirtualHoles = Array.isArray(virtualHoleEntries)
        ? virtualHoleEntries
        : (Array.isArray(window._fusionVirtualHoles) ? window._fusionVirtualHoles : []);
    if (!layer || !layer.children) { traceReason = 'no-layer-or-children'; report.status = traceReason; return report; }
    const items = [...layer.children].filter(item =>
        item && !item.data?.mockup && !item.data?.isMask && !item.data?.isSelectionBox &&
        !item.data?.isHandle && !item.data?.isSmartGuide && !item.data?.isMeasurement &&
        !item.data?.isTracePreview && !item.data?.isNodeEditOverlay
    );
    tracedItems = items;
    report.filteredItemCount = items.length;
    if (tracePass) tracePass.filteredItems = csgOwnersSnapshot(items);
    if (items.length === 0) { traceReason = 'no-eligible-layer-items'; report.status = traceReason; return report; }
    subItems = extractSubtractiveItems(items);
    internalVirtualHoles = collectInternalVirtualHoles(items);
    const scopedVirtualHoles = [...providedVirtualHoles, ...internalVirtualHoles];
    report.subtractiveItemCount = subItems.length;
    report.holeOwnerCount = subItems.filter(item => item?.data?.isHole === true).length;
    subItems.filter(item => item?.data?.isHole === true).forEach(item => {
        const key = holeKeyOf(item);
        if (key) physicalHoleKeys.add(key);
    });
    if (tracePass) tracePass.subItems = subItems.map(item => csgItemSnapshot(item)).filter(Boolean);
    if (subItems.length === 0) { traceReason = 'no-subtractive-items'; report.status = traceReason; return report; }

    function countSegments(item, visited = new Set()) {
        if (!item || visited.has(item)) return 0;
        visited.add(item);
        if (item.segments) return item.segments.length;
        if (item.children) {
            let total = 0;
            item.children.forEach(c => { total += countSegments(c, visited); });
            return total;
        }
        return 0;
    }

    function subtractionMetrics(originalArea, result, operandArea) {
        const resultArea = Math.abs(Number(result?.area) || 0);
        const operand = Math.abs(Number(operandArea) || 0);
        const scale = Math.max(originalArea, resultArea, operand, 1);
        const tolerance = Math.max(1e-12, scale * 1e-12);
        const areaDelta = originalArea - resultArea;
        const validArea = Number.isFinite(resultArea) && resultArea > 1e-12 &&
            resultArea <= originalArea + tolerance && areaDelta > tolerance;
        const validBounds = !!result?.bounds &&
            Number.isFinite(result.bounds.width) && Number.isFinite(result.bounds.height) &&
            result.bounds.width > 1e-9 && result.bounds.height > 1e-9;
        return { resultArea, operandArea: operand, areaDelta, tolerance, validArea, validBounds };
    }

    holeGeometryCache = new Map();
    for (const item of subItems) {
        if (!item?.data?.isHole) continue;
        const geometry = getGlobalUnsubtractedPath(item);
        holeGeometryCache.set(item, geometry);
    }

    for (let itemIndex = 0; itemIndex < subItems.length; itemIndex++) {
        let item = subItems[itemIndex];
        if (item && item.data && item.data.geomBase && !item.data.isHole) {
            // The rendered children may contain previous CSG cuts. They are
            // never the canonical editable source; geomBase is restored first.
            item.data.csgMaterialized = false;
            const pristine = getGlobalUnsubtractedPath(item);
            if (pristine) {
                const restored = installOwnerGeometry(item, pristine);
                if (restored !== item) {
                    item = restored;
                    subItems[itemIndex] = restored;
                }
            }
            item.visible = true;
        } else if (item && item.data && item.data.isHole) {
            item.visible = true;
            // El CSG usa isHole como semántica; el objeto sigue siendo visible,
            // seleccionable y con contorno dentro del editor.
            applyHoleVisualStyle(item);
        }
    }

    for (let j = 0; j < subItems.length; j++) {
        let solid = subItems[j];
        if (!solid || !solid.data || solid.data.isHole || !solid.data.geomBase ||
            isMockupOrMask(solid)) continue;
        let pristineBase = getGlobalUnsubtractedPath(solid);
        pristineBase = normalizeSubtractiveOperand(pristineBase, null, true);
        if (!pristineBase) continue;
        const pristineArea = Math.abs(pristineBase.area || 0);
        const pristineBounds = pristineBase.bounds;
        const solidKey = solidKeyOf(solid);

        const intersectingHoles = [];
        for (let i = 0; i < subItems.length; i++) {
            if (i === j) continue;
            const holeItem = subItems[i];
            const holeData = holeItem?.data || {};
            const pair = { solid: csgItemRef(solid), hole: csgItemRef(holeItem),
                containmentKey: { solid: solid?.data?.containmentKey ?? null, hole: holeData.containmentKey ?? null },
                containmentKeyDecision: 'not-used-as-csg-rejection', status: 'rejected', reasons: [] };
            if (!holeItem || !holeItem.data || !holeItem.data.isHole) {
                pair.reasons.push('not-hole');
                if (tracePass) tracePass.candidatePairs.push(pair);
                continue;
            }
            report.candidatePairs += 1;
            pair.ownerMaskWrapper = { isMaskOrMockup: !!isMockupOrMask(holeItem), isContainmentWrapper: !!isContainmentWrapper(holeItem) };
            if (pair.ownerMaskWrapper.isMaskOrMockup) {
                pair.reasons.push('owner-mask-wrapper');
                if (tracePass) tracePass.candidatePairs.push(pair);
                continue;
            }
            // A nested contour keeps its source owner for diagnostics, but
            // physical CSG always obeys the actual render order. If the client
            // moves a decomposed hole below its former solid, it must stop
            // cutting that solid; semantic provenance cannot override Z.
            const containmentOwnerMatch = !!(
                holeData.ownerContainmentKey &&
                holeData.ownerContainmentKey === solid.data?.containmentKey
            );
            const zAllowed = isAboveInRenderOrder(holeItem, solid);
            const holeStackingUnit = getStackingUnit(holeItem);
            const solidStackingUnit = getStackingUnit(solid);
            pair.zOrder = {
                holeAboveSolid: zAllowed,
                containmentOwnerMatch,
                holeIndex: holeStackingUnit?.index ?? holeItem.index ?? null,
                solidIndex: solidStackingUnit?.index ?? solid.index ?? null,
                holeOwnerIndex: holeItem.index ?? null,
                solidOwnerIndex: solid.index ?? null
            };
            if (!zAllowed) {
                pair.reasons.push('z-order');
                if (tracePass) tracePass.candidatePairs.push(pair);
                continue;
            }
            const rawHoleBase = holeGeometryCache.get(holeItem);
            if (!rawHoleBase || !rawHoleBase.bounds || !pristineBounds.intersects(rawHoleBase.bounds)) {
                pair.reasons.push(rawHoleBase ? 'bounds-disjoint' : 'owner-geometry-invalid');
                if (tracePass) tracePass.candidatePairs.push(pair);
                continue;
            }
            let holeBase = normalizeSubtractiveOperand(rawHoleBase.clone({ insert: false }), pristineBase);
            pair.holeWorldGeometry = csgGeometrySnapshot(holeBase);
            if (!holeBase) {
                pair.reasons.push('owner-geometry-invalid');
                if (tracePass) tracePass.candidatePairs.push(pair);
                continue;
            }
            holeBase = confineSubtractiveGeometry(holeBase, holeKeyOf(holeItem), outOfProductHoleKeys);
            pair.confinedGeometry = csgGeometrySnapshot(holeBase);
            if (!holeBase) {
                pair.reasons.push('geometry-confine');
                if (tracePass) tracePass.candidatePairs.push(pair);
                continue;
            }
            // For a nested contour the owner relationship is definitive only
            // after the independent Z-order check above. It also covers tiny
            // font/SVG counters where Paper's point-in-polygon test falls below
            // numeric precision; the actual result is still built as real
            // geometry (subtract or the even-odd composite fallback).
            const geometryCandidate = realGeometryIntersects(pristineBase, holeBase) ||
                (containmentOwnerMatch && zAllowed);
            if (geometryCandidate) {
                pair.status = 'candidate';
                const holeKey = holeKeyOf(holeItem);
                requireHoleTarget(holeKey, solidKey);
                pair.holeKey = holeKey;
                pair.solidKey = solidKey;
                pair.reasons.push(containmentOwnerMatch ? 'candidate-containing-solid' : 'candidate');
                if (tracePass) tracePass.candidatePairs.push(pair);
                intersectingHoles.push({ geom: holeBase, holeKey });
            } else {
                pair.reasons.push('no-intersection');
                if (tracePass) tracePass.candidatePairs.push(pair);
                holeBase.remove();
            }
        }

        // === EKKO SMART FUSION v46: Huecos virtuales (imagen fusionada dentro de hueco) también restan del sólido ===
        if (Array.isArray(scopedVirtualHoles)) {
            scopedVirtualHoles.forEach(function(vh) {
                if (!vh || !vh.geom) return;
                if (isMockupOrMask(solid)) return;
                // Virtual holes carry their live fusion group. Apply the same
                // Z-order contract as physical hole owners when available.
                if (vh.group && !isAboveInRenderOrder(vh.group, solid)) return;
                const vhKey = vh.fusionId || `virtual:${vh.group?.id || 'unknown'}`;
                let vhClone = normalizeSubtractiveOperand(vh.geom.clone({ insert: false }), pristineBase);
                vhClone = confineSubtractiveGeometry(vhClone, vhKey, outOfProductHoleKeys);
                if (!vhClone) return;
                if (pristineBounds.intersects(vhClone.bounds)) {
                    intersectingHoles.push({
                        geom: vhClone,
                        holeKey: vhKey,
                        virtual: true
                    });
                } else {
                    vhClone.remove();
                }
            });
        }

        if (intersectingHoles.length === 0) {
            csgTraceOperation(tracePass, 'solid-pass', { solid: csgItemSnapshot(solid), pristine: csgGeometrySnapshot(pristineBase),
                holeCount: 0, accepted: false, rejection: 'no-intersecting-holes' });
            pristineBase.remove();
            continue;
        }

        const successfulCuts = [];
        let mergedHole = null;
        try {
            for (let k = 0; k < intersectingHoles.length; k++) {
                const curHole = intersectingHoles[k].geom;
                if (!mergedHole) {
                    mergedHole = curHole.clone({ insert: false });
                } else {
                    if (mergedHole.bounds.intersects(curHole.bounds)) {
                        try {
                            const leftBefore = csgGeometrySnapshot(mergedHole);
                            const rightBefore = csgGeometrySnapshot(curHole);
                            const united = mergedHole.unite(curHole, { insert: false });
                            const accepted = !!united && Number.isFinite(united.area) && Math.abs(united.area) > 1e-12;
                            csgTraceOperation(tracePass, 'unite', { success: !!united, accepted,
                                leftBefore, rightBefore, result: csgGeometrySnapshot(united),
                                rejection: united && !accepted ? 'empty-or-degenerate-result' : null });
                            if (accepted) {
                                mergedHole.remove();
                                mergedHole = united;
                                continue;
                            }
                        } catch (e) {
                            csgTraceOperation(tracePass, 'unite', { success: false, accepted: false,
                                error: String(e?.stack || e), leftBefore: csgGeometrySnapshot(mergedHole), rightBefore: csgGeometrySnapshot(curHole),
                                rejection: 'caught-error' });
                            report.failedBooleans.push({ operation: 'unite', error: String(e?.message || e) });
                        }
                    }
                    const cp = new paper.CompoundPath({ insert: false });
                    if (mergedHole instanceof paper.CompoundPath) {
                        cp.addChildren(mergedHole.removeChildren());
                        mergedHole.remove();
                    } else {
                        cp.addChild(mergedHole);
                    }
                    if (curHole instanceof paper.CompoundPath) {
                        cp.addChildren(curHole.removeChildren());
                    } else {
                        cp.addChild(curHole.clone({ insert: false }));
                    }
                    mergedHole = cp;
                }
            }
        } catch (err) {
            csgTraceOperation(tracePass, 'merge-hole', { success: false, accepted: false,
                error: String(err?.stack || err), rejection: 'caught-error' });
            report.failedBooleans.push({ operation: 'merge-hole', error: String(err?.message || err) });
            mergedHole = null;
        }
        csgTraceOperation(tracePass, 'merge-hole', { success: !!mergedHole, accepted: !!mergedHole,
            result: csgGeometrySnapshot(mergedHole), holeCount: intersectingHoles.length });

        let finalSubtracted = null;
        if (mergedHole) {
            try {
                const solidBefore = csgGeometrySnapshot(pristineBase);
                const holeBefore = csgGeometrySnapshot(mergedHole);
                const testSub = pristineBase.subtract(mergedHole, { insert: false });
                if (testSub) {
                    const metrics = subtractionMetrics(
                        pristineArea,
                        testSub,
                        Math.abs(mergedHole.area || 0)
                    );
                    const testSegments = countSegments(testSub);
                    const accepted = testSegments >= 3 && metrics.validArea && metrics.validBounds;
                    csgTraceOperation(tracePass, 'subtract.merged', { success: true, accepted,
                        solidBefore, holeBefore, result: csgGeometrySnapshot(testSub),
                        testArea: metrics.resultArea, testSegments, pristineArea,
                        areaDelta: metrics.areaDelta, tolerance: metrics.tolerance,
                        rejection: accepted ? null : (!metrics.validArea ? 'area' : (testSegments < 3 ? 'segments' : 'bounds')) });
                    if (accepted) {
                        finalSubtracted = evenOddResult(testSub);
                        intersectingHoles.forEach(entry => {
                            successfulCuts.push({ holeKey: entry.holeKey, virtual: entry.virtual === true });
                        });
                    } else {
                        testSub.remove();
                    }
                } else {
                    csgTraceOperation(tracePass, 'subtract.merged', { success: false, accepted: false,
                        solidBefore, holeBefore, result: null, rejection: 'null-result' });
                }
            } catch (e) {
                csgTraceOperation(tracePass, 'subtract.merged', { success: false, accepted: false,
                    solidBefore: csgGeometrySnapshot(pristineBase), holeBefore: csgGeometrySnapshot(mergedHole),
                    error: String(e?.stack || e), rejection: 'caught-error' });
                report.failedBooleans.push({ operation: 'subtract.merged', error: String(e?.message || e) });
            }
            mergedHole.remove();
        }

        if (!finalSubtracted) {
            let currentProgress = pristineBase.clone({ insert: false });
            let madeProgress = false;
            for (let k = 0; k < intersectingHoles.length; k++) {
                const entry = intersectingHoles[k];
                const singleHole = entry.geom;
                try {
                    const progressBefore = csgGeometrySnapshot(currentProgress);
                    const holeBefore = csgGeometrySnapshot(singleHole);
                    const progressArea = Math.abs(currentProgress.area || 0);
                    const stepSub = currentProgress.subtract(singleHole, { insert: false });
                    if (stepSub) {
                        const metrics = subtractionMetrics(
                            progressArea,
                            stepSub,
                            Math.abs(singleHole.area || 0)
                        );
                        const stepSegments = countSegments(stepSub);
                        const accepted = stepSegments >= 3 && metrics.validArea && metrics.validBounds;
                        csgTraceOperation(tracePass, 'subtract.step', { success: true, accepted,
                            solidBefore: progressBefore, holeBefore, result: csgGeometrySnapshot(stepSub),
                            stepArea: metrics.resultArea, stepSegments, pristineArea: progressArea,
                            areaDelta: metrics.areaDelta, tolerance: metrics.tolerance,
                            rejection: accepted ? null : (!metrics.validArea ? 'area' : (stepSegments < 3 ? 'segments' : 'bounds')) });
                        if (accepted) {
                            currentProgress.remove();
                            currentProgress = stepSub;
                            madeProgress = true;
                            successfulCuts.push({ holeKey: entry.holeKey, virtual: entry.virtual === true });
                        } else {
                            stepSub.remove();
                        }
                    } else {
                        csgTraceOperation(tracePass, 'subtract.step', { success: false, accepted: false,
                            solidBefore: progressBefore, holeBefore, result: null, rejection: 'null-result' });
                    }
                } catch (e) {
                    csgTraceOperation(tracePass, 'subtract.step', { success: false, accepted: false,
                        solidBefore: csgGeometrySnapshot(currentProgress), holeBefore: csgGeometrySnapshot(singleHole),
                        error: String(e?.stack || e), rejection: 'caught-error' });
                    report.failedBooleans.push({ operation: 'subtract.step', error: String(e?.message || e) });
                }
            }
            if (!finalSubtracted) {
                const built = buildEvenOddComposite(pristineBase, intersectingHoles);
                const composite = built?.composite || null;
                if (composite) {
                    currentProgress.remove();
                    finalSubtracted = composite;
                    const includedSet = new Set(built.included || []);
                    intersectingHoles.forEach(entry => {
                        if (includedSet.has(entry)) {
                            successfulCuts.push({ holeKey: entry.holeKey, virtual: entry.virtual === true });
                        }
                    });
                    csgTraceOperation(tracePass, 'subtract.evenodd-fallback', {
                        accepted: true,
                        solid: csgItemSnapshot(solid),
                        contourCount: composite.children?.length || 0
                    });
                } else if (madeProgress) {
                    finalSubtracted = evenOddResult(currentProgress);
                }
            }
            if (!finalSubtracted) currentProgress.remove();
        }

        csgTraceOperation(tracePass, 'solid-pass', { solid: csgItemSnapshot(solid), pristine: csgGeometrySnapshot(pristineBase),
            holeCount: intersectingHoles.length, final: csgGeometrySnapshot(finalSubtracted), accepted: !!finalSubtracted,
            rejection: finalSubtracted ? null : 'no-valid-subtract-result' });
        if (finalSubtracted) {
            if (solid.data.nodeEditActive === true) {
                // Node editing works on the canonical positive geometry. Do
                // not replace it with the temporary cut result until the edit
                // session ends; otherwise the next node gesture would edit
                // the hole boundary instead of the solid.
                finalSubtracted.remove();
                solid.data.csgMaterialized = false;
                solid.visible = true;
            } else {
                const installed = installOwnerGeometry(solid, finalSubtracted);
                if (installed !== solid) {
                    solid = installed;
                    subItems[j] = installed;
                }
                solid.data.csgMaterialized = true;
                solid.visible = true;
                successfulCuts.forEach(entry => {
                    if (entry.virtual) return;
                    resolveHoleTarget(entry.holeKey, solidKey);
                    report.acceptedPairs += 1;
                });
            }
        } else {
            solid.data.csgMaterialized = false;
        }
        // Excuse spurious candidacies: a hole with no actual overlap with
        // this solid never needed a cut from it. Without this, a grazing
        // contour (bounds overlap, zero material overlap) would stay
        // required forever and falsely block the scene/export.
        try {
            intersectingHoles.forEach(entry => {
                if (!entry || entry.virtual) return;
                if (successfulHoleTargets.get(entry.holeKey)?.has(solidKey)) return;
                if (!holeOverlapsSolid(entry.geom, pristineBase)) {
                    requiredHoleTargets.get(entry.holeKey)?.delete(solidKey);
                }
            });
        } catch (_) {}
        pristineBase.remove();
        intersectingHoles.forEach(entry => { try { entry.geom.remove(); } catch(e) {} });
    }

    if (typeof paper !== 'undefined' && paper.view) {
        paper.view.update();
    }
    traceReason = 'completed';
    } finally {
        const fullyResolvedHoleKeys = new Set();
        requiredHoleTargets.forEach((targets, holeKey) => {
            if (!targets || targets.size === 0) return;
            const successful = successfulHoleTargets.get(holeKey);
            if (successful && [...targets].every(target => successful.has(target))) {
                fullyResolvedHoleKeys.add(holeKey);
            }
        });
        report.rejectedPairs = Math.max(0, report.candidatePairs - report.acceptedPairs);
        report.acceptedHoleKeys = [...fullyResolvedHoleKeys];
        report.acceptedHoleCount = fullyResolvedHoleKeys.size;
        report.outOfProductHoleKeys = [...outOfProductHoleKeys].filter(key => physicalHoleKeys.has(key));
        // A hole over a material-free notch of the product silhouette cannot
        // cut anything: it is ignorable, not a cutter needing attention.
        report.unresolvedHoleKeys = [...physicalHoleKeys].filter(key =>
            !fullyResolvedHoleKeys.has(key) && !outOfProductHoleKeys.has(key));
        report.unresolvedHoles = report.unresolvedHoleKeys.length;
        report.status = traceReason || report.status;
        report.completed = traceReason === 'completed' || report.status === 'no-subtractive-items' || report.status === 'no-eligible-layer-items';
        internalVirtualHoles.forEach(entry => { try { entry.geom.remove(); } catch (_) {} });
        holeGeometryCache.forEach(geometry => { try { geometry?.remove?.(); } catch (_) {} });
        if (typeof window !== 'undefined') window.EKKO_CSG_LAST_REPORT = report;
        csgTraceFinish(tracePass, layer, tracedItems, traceReason);
        activeCSGTracePass = previousTracePass;
    }
    return report;
}

function isAncestorOf(potentialAncestor, node) {
    let curr = node && node.parent;
    const visited = new Set();
    while (curr && !visited.has(curr)) {
        if (curr === potentialAncestor) return true;
        visited.add(curr);
        curr = curr.parent;
    }
    return false;
}

function getRootNode(node) {
    let curr = node;
    const visited = new Set();
    while (curr && curr.parent && !visited.has(curr)) {
        visited.add(curr);
        curr = curr.parent;
    }
    return curr;
}

/**
 * DESCOMPOSICIÓN INTEGRAL POR JERARQUÍA DE CONTENCIÓN Y CAPAS
 */
export function decomposeByContainmentHierarchy(rootTarget, isClipped = false) {
    if (!rootTarget || rootTarget.data?.locked || rootTarget.data?.mockup || rootTarget.data?.isMask) {
        return null;
    }

    const targetLayer = rootTarget.layer || paper.project.activeLayer;
    docOrderCounter = 0;
    const shouldClip = isClipped || (typeof window !== 'undefined' && typeof window.clipItem === 'function' && !window.infiniteCanvasMode && !!window.clipMask);
    const containmentScope = rootTarget.data?.containmentScope ||
        `scope_${++decompositionScopeCounter}`;

    // Flatten source children into root-local coordinates.  The new public
    // owners receive the same world transform as the removed root.
    const rootMatrix = rootTarget.matrix?.clone?.() || new paper.Matrix();
    const inverseRoot = rootMatrix.inverted ? rootMatrix.inverted() : new paper.Matrix();
    const atomicPaths = flattenToAtomicPaths(rootTarget, inverseRoot);
    const rootWorld = rootTarget.globalMatrix?.clone?.() || rootMatrix.clone();
    const layerWorld = targetLayer?.globalMatrix?.clone?.() || new paper.Matrix();
    const ownerMatrix = layerWorld.inverted ? layerWorld.inverted().concatenate(rootWorld) : rootWorld;
    if (!atomicPaths || atomicPaths.length === 0) {
        return null;
    }

    if (atomicPaths.length === 1) {
        const single = atomicPaths[0];
        const compound = new paper.CompoundPath({ insert: false });
        compound.addChild(single.clone({ insert: false }));
        single.remove();

        const geomBase = compound.clone({ insert: false });
        geomBase.applyMatrix = false;
        geomBase.matrix = new paper.Matrix();
        compound.applyMatrix = false;
        compound.matrix = ownerMatrix.clone();

        const singleIsHole = typeof single.data?.originalIsHole === "boolean"
            ? single.data.originalIsHole
            : !!rootTarget.data?.isHole;
        // The decomposed owner is a new public object, but it must carry the
        // source topology/identity contract.  In particular, resetting the
        // CompoundPath fill rule to Paper's default makes a real hole (and
        // internal glyph holes) behave as a solid after ungroup.
        compound.fillRule = single.data?.originalFillRule || rootTarget.data?.originalFillRule || "evenodd";
        compound.data = {
            ...(rootTarget.data || {}),
            locked: false,
            label: (rootTarget.data && rootTarget.data.label) ? rootTarget.data.label : "Capa Independiente",
            semanticKind: singleIsHole ? VECTOR_KIND.HOLE : VECTOR_KIND.SOLID,
            isHole: singleIsHole,
            isSolidShape: !singleIsHole,
            isFusionReceptor: singleIsHole,
            fillRule: single.data?.originalFillRule || rootTarget.data?.originalFillRule || "evenodd",
            originalFillRule: single.data?.originalFillRule || rootTarget.data?.originalFillRule || "evenodd",
            originalIsHole: typeof single.data?.originalIsHole === "boolean" ? single.data.originalIsHole : undefined,
            contourRole: single.data?.contourRole || (singleIsHole ? "hole" : "outer"),
            sourceContourIndex: single.data?.sourceContourIndex ?? null,
            source: single.data?.source || rootTarget.data?.source,
            userImported: single.data?.userImported ?? rootTarget.data?.userImported,
            geomBase: geomBase,
            layerDepth: 0,
            containmentId: 0,
            containmentScope,
            containmentKey: `${containmentScope}:0`,
            ownerContainmentKey: `${containmentScope}:0`,
            decomposedLayer: true
        };

        if (singleIsHole) {
            compound.data.originalFillColor = single.data?.originalFillColor?.clone?.() || rootTarget.data?.originalFillColor?.clone?.() || null;
            compound.data.originalStrokeColor = single.data?.originalStrokeColor?.clone?.() || rootTarget.data?.originalStrokeColor?.clone?.() || null;
            compound.data.originalStrokeWidth = single.data?.originalStrokeWidth || rootTarget.data?.originalStrokeWidth || 0;
            applyHoleVisualStyle(compound);
        } else {
            compound.fillColor = rootTarget.fillColor || single.fillColor || new paper.Color('#111827');
            compound.strokeColor = rootTarget.strokeColor || single.strokeColor || null;
            compound.strokeWidth = rootTarget.strokeWidth || single.strokeWidth || 0;
        }

        let finalItem = compound;
        if (shouldClip && typeof window !== 'undefined' && typeof window.clipItem === 'function') {
            finalItem = window.clipItem(compound);
        }

        if (targetLayer) {
            targetLayer.addChild(finalItem);
            if (window.currentMockup) {
                finalItem.insertBelow(window.currentMockup);
            }
        }
        rootTarget.remove();
        return { handled: true, simple: true, items: [finalItem] };
    }

    const { nodes } = buildContainmentTree(atomicPaths);

    const sortedByDepth = [...nodes].sort((a, b) => a.depth - b.depth);
    sortedByDepth.forEach(node => {
        node.isHole = resolveItemSemantics(node, rootTarget);
    });

    // Identidad única para esta descomposición. containmentId solo no es
    // suficiente porque distintos SVG pueden reutilizar el mismo índice.
    function nearestSolidOwner(node) {
        if (!node?.isHole) return node;
        let parent = node.parent;
        while (parent && parent.isHole) parent = parent.parent;
        return parent || null;
    }
    nodes.forEach(node => {
        const owner = nearestSolidOwner(node);
        node.containmentScope = containmentScope;
        node.containmentKey = `${containmentScope}:${node.id}`;
        node.ownerContainmentKey = owner
            ? `${containmentScope}:${owner.id}`
            : null;
    });

nodes.sort((a, b) => {
  const rootA = getRootNode(a);
  const rootB = getRootNode(b);
  if (rootA !== rootB) {
    // ✅ REGLA ABSOLUTA: El orden de apilamiento viene del docOrder original.
    // Los objetos que aparecían primero en el SVG quedan atrás (abajo en Z).
    return a.docOrder - b.docOrder;
  }
  // Dentro de la misma jerarquía: ancestros primero (para que los contenedores
  // se inserten antes que sus contenidos y queden atrás en Z).
  if (isAncestorOf(a, b)) return -1;
  if (isAncestorOf(b, a)) return 1;
  // Mismo nivel: orden por docOrder original
  return a.docOrder - b.docOrder;
});

    const resultingItems = [];

    nodes.forEach((node) => {
        const isHole = node.isHole;
        const compoundItem = new paper.CompoundPath({ insert: false });
        // flattenToAtomicPaths bakes the complete source-to-project matrix
        // into path segments.  Keep the new owner identity-free (identity
        // matrix), while explicitly retaining even-odd topology.
        const pathClone = node.path.clone({ insert: false });
        pathClone.applyMatrix = false;
        compoundItem.addChild(pathClone);
        compoundItem.fillRule = node.path.data?.originalFillRule || rootTarget.data?.originalFillRule || "evenodd";

        const geomBase = new paper.CompoundPath({ insert: false });
        geomBase.applyMatrix = false;
        const baseClone = node.path.clone({ insert: false });
        baseClone.applyMatrix = false;
        geomBase.addChild(baseClone);
        geomBase.matrix = new paper.Matrix();
        geomBase.fillRule = node.path.data?.originalFillRule || rootTarget.data?.originalFillRule || "evenodd";
        compoundItem.applyMatrix = false;
        compoundItem.matrix = ownerMatrix.clone();

        compoundItem.data = {
            locked: false,
            label: isHole ? `Calado Activo (Nivel ${node.depth})` : `Masa Sólida (Nivel ${node.depth})`,
            semanticKind: isHole ? VECTOR_KIND.HOLE : VECTOR_KIND.SOLID,
            isHole: isHole,
            isSolidShape: !isHole,
            isFusionReceptor: isHole,
            fillRule: node.path.data?.originalFillRule || rootTarget.data?.originalFillRule || "evenodd",
            originalFillRule: node.path.data?.originalFillRule || rootTarget.data?.originalFillRule || "evenodd",
            preserveCompoundTopology: true,
            contourIndex: node.id,
            sourceContourIndex: node.path.data?.sourceContourIndex ?? node.id,
            contourDepth: node.depth,
            contourRole: isHole ? "hole" : "outer",
            originalIsHole: typeof node.path.data?.originalIsHole === "boolean" ? node.path.data.originalIsHole : isHole,
            source: node.path.data?.source || rootTarget.data?.source,
            userImported: node.path.data?.userImported ?? rootTarget.data?.userImported,
            // A decomposed path is a new public owner; never inherit a
            // text-vector/fusion id that would alias the removed wrapper.
            fusionId: null,
            geomBase: geomBase,
            layerDepth: node.depth,
            containmentId: node.id,
            containmentScope: node.containmentScope,
            containmentKey: node.containmentKey,
            ownerContainmentKey: node.ownerContainmentKey,
            decomposedLayer: true
        };

        if (isHole) {
            compoundItem.data.originalFillColor = node.path.data?.originalFillColor?.clone?.() || null;
            compoundItem.data.originalStrokeColor = node.path.data?.originalStrokeColor?.clone?.() || null;
            compoundItem.data.originalStrokeWidth = node.path.data?.originalStrokeWidth || 0;
            applyHoleVisualStyle(compoundItem);
        } else {
            compoundItem.fillColor = node.path.data?.originalFillColor || rootTarget.fillColor || new paper.Color('#111827');
            compoundItem.strokeColor = node.path.data?.originalStrokeColor || rootTarget.strokeColor || null;
            compoundItem.strokeWidth = node.path.data?.originalStrokeWidth || rootTarget.strokeWidth || 0;
        }

        resultingItems.push(compoundItem);
        node.path.remove();
    });

    const finalDeliveredItems = [];
    resultingItems.forEach(item => {
        let finalItem = item;
        if (shouldClip && typeof window !== 'undefined' && typeof window.clipItem === 'function') {
            finalItem = window.clipItem(item);
        }
        if (targetLayer) {
            targetLayer.addChild(finalItem);
            if (window.currentMockup) {
                finalItem.insertBelow(window.currentMockup);
            }
        }
        
        // CORRECCIÓN FORENSE: Sanitizar si es un wrapper abstracto (clipGroup) para evitar marcarlo como isHole corrupto (v36.3)
        if (finalItem !== item) {
            if (!finalItem.data) finalItem.data = {};
            const ownerId = item.id || item.data?.ownerId || item.data?.containmentKey;
            finalItem.data = { ...finalItem.data, role: "mockup-containment", clipGroup: true,
                publicOwnerId: ownerId, isHole: undefined, geomBase: undefined };
            item.data = { ...(item.data || {}), publicOwner: true, ownerId };
        }

        // Return/commit only the public owner. The containment wrapper remains
        // a clipping implementation detail and is never public selection.
        finalDeliveredItems.push(getPublicOwner(finalItem) || item);
    });

    rootTarget.remove();

    if (targetLayer) {
        recalculateDynamicSubtractions(targetLayer);
    }

    return { handled: true, simple: false, items: finalDeliveredItems };
}

export function geometricUngroupCompound(item) {
    return decomposeByContainmentHierarchy(item);
}

export function geometricUngroupOneLevel(group) {
    return decomposeByContainmentHierarchy(group);
}

if (typeof window !== 'undefined') {
    // Query/explicit opt-in creates the public collector immediately; normal
    // studio loads leave no trace object and execute the original route.
    csgTraceForCurrentPass();
    window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
    window.decomposeByContainmentHierarchy = decomposeByContainmentHierarchy;
    window.geometricUngroupCompound = decomposeByContainmentHierarchy;
    window.geometricUngroupOneLevel = decomposeByContainmentHierarchy;
    window.getGlobalUnsubtractedPath = getGlobalUnsubtractedPath;
    window.isContainedIn = isContainedIn;
}

// Alias para compatibilidad con outlineGeometry.js
export const installGeometryInOwner = installOwnerGeometry;

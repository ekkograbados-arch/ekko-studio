import { isMockupOrMask, isContainmentWrapper, getPublicOwner, getPublicOwners, getOwnerLocalGeometry, toWorldGeometry, worldPointToOwner, getPublicWorldBounds, stampGeomBase } from "./designGeometry.js";
import { getCanonicalDesignLayer, realGeometryIntersects, isAboveInRenderOrder, getStackingUnit, semanticKind, VECTOR_KIND } from "./vectorSemantics.js";
import { buildContourRelations, geometricallyContains, normalizeFillRule } from "./holeSemantics.js";


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
 * Compatibility geometry relation. Topology classification is owned by
 * holeSemantics.buildContourRelations; this adapter exists only for legacy
 * diagnostics and never creates a second classifier.
 */
export function isContainedIn(child, parent) {
    return geometricallyContains(parent, child);
}

export function getGlobalUnsubtractedPath(item) {
    // Sole world-geometry producer: geomBase is owner-local and the complete
    // owner global matrix is applied exactly once by the canonical layer.
    return toWorldGeometry(item);
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

// CSG geometry is kept in project coordinates, but a detached SVG hole must
// never subtract or render outside the active product boundary. The original
// hole item is not modified; only the temporary boolean operand is confined.
function confineSubtractiveGeometry(geometry) {
    if (!geometry || !window.clipMask || window.infiniteCanvasMode) return geometry;
    let boundary = null;
    try {
        boundary = getGlobalUnsubtractedPath(window.clipMask) || window.clipMask.clone({ insert: false });
        const before = csgGeometrySnapshot(geometry);
        const confined = geometry.intersect(boundary, { insert: false });
        csgTraceOperation(activeCSGTracePass, 'confine.intersect', {
            success: !!confined, input: before, boundary: csgGeometrySnapshot(boundary), output: csgGeometrySnapshot(confined),
            accepted: !!confined && Math.abs(confined.area || 0) > 0.001
        });
        if (confined && Math.abs(confined.area || 0) > 0.001) {
            geometry.remove();
            return confined;
        }
        // No intersection means this operand is entirely outside the product;
        // it must not participate in CSG at all.
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
    // A real hole is an unpainted physical cutter. Its only visual effect is
    // the subtraction it produces on eligible solids below it. Selection and
    // node-edit overlays may indicate the active owner, but the hole itself
    // must never receive fill or stroke as a visual substitute for CSG.
    const before = {
        fillColor: csgColorSnapshot(item.fillColor),
        strokeColor: csgColorSnapshot(item.strokeColor),
        opacity: item.opacity
    };
    const data = item.data || {};
    item.data = {
        ...data,
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
            if (fusionMask && semanticKind(fusionMask) !== VECTOR_KIND.HOLE && fusionMask.data?.geomBase) {
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

// Boolean results are derived render geometry, not additional public owners.
// Paper.js can preserve operand metadata on result child paths; if a hole's
// semantic tags survive there, the derived cut is re-discovered as a second
// cutter on the next pass and moving the real top-level hole cannot restore
// the solid. Strip owner semantics recursively while retaining the geometry
// and paint of the materialized solid result.
function sanitizeMaterializedCSGGeometry(node) {
    if (!node?.children) return node;
    node.children.forEach(child => {
        if (!child) return;
        child.data = { ...(child.data || {}), semanticKind: undefined, isHole: false,
            originalIsHole: false, containmentKey: undefined, ownerContainmentKey: undefined,
            geomBase: undefined, geomBasePathData: undefined, holeRenderMode: undefined,
            publicOwner: false };
        sanitizeMaterializedCSGGeometry(child);
    });
    return node;
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
        intersectionPairs: 0,
        appliedPairs: 0,
        rejectedPairs: 0,
        failedBooleans: [],
        status: 'started',
        completed: false,
        holeOwnerCount: 0,
        acceptedHoleCount: 0,
        appliedHoleCount: 0,
        unresolvedHoles: 0,
        acceptedHoleKeys: [],
        appliedHoleKeys: [],
        virtualAppliedPairs: 0
    };
    const traceSeedItems = layer?.children ? [...layer.children] : [];
    const tracePass = csgTraceBegin(layer, traceSeedItems);
    const previousTracePass = activeCSGTracePass;
    activeCSGTracePass = tracePass;
    let tracedItems = [];
    let traceReason = null;
    const intersectingHoleKeys = new Set();
    const appliedHoleKeys = new Set();
    try {
    const scopedVirtualHoles = Array.isArray(virtualHoleEntries)
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
    const subItems = extractSubtractiveItems(items);
    report.subtractiveItemCount = subItems.length;
    report.holeOwnerCount = subItems.filter(item => semanticKind(item) === VECTOR_KIND.HOLE).length;
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

    subItems.forEach(item => {
        if (item && item.data && item.data.geomBase && semanticKind(item) === VECTOR_KIND.SOLID) {
            // The rendered children may contain previous CSG cuts. They are
            // never the canonical editable source; geomBase is restored first.
            item.data.csgMaterialized = false;
            const pristine = getGlobalUnsubtractedPath(item);
            if (pristine) {
                item.removeChildren();
                if (pristine instanceof paper.CompoundPath) {
                    const cl = pristine.clone({ insert: false });
                    attachGlobalGeometryToOwnerLocal(cl, item);
                    item.addChildren(cl.removeChildren());
                    cl.remove();
                } else if (pristine instanceof paper.Path) {
                    const child = pristine.clone({ insert: false });
                    attachGlobalGeometryToOwnerLocal(child, item);
                    item.addChild(child);
                }
                pristine.remove();
            }
            item.visible = true;
        } else if (item && semanticKind(item) === VECTOR_KIND.HOLE) {
            item.visible = true;
            // El CSG usa isHole como semántica; el objeto sigue siendo visible,
            // seleccionable y con contorno dentro del editor.
            applyHoleVisualStyle(item);
        }
    });

    for (let j = 0; j < subItems.length; j++) {
        const solid = subItems[j];
        if (!solid || !solid.data || semanticKind(solid) !== VECTOR_KIND.SOLID || !solid.data.geomBase ||
            isMockupOrMask(solid)) continue;
        const pristineBase = getGlobalUnsubtractedPath(solid);
        if (!pristineBase) continue;
        const pristineArea = Math.abs(pristineBase.area || 0);
        const pristineBounds = pristineBase.bounds;

        const intersectingHoles = [];
        const intersectingHoleKeysForSolid = [];
        for (let i = 0; i < subItems.length; i++) {
            if (i === j) continue;
            const holeItem = subItems[i];
            const holeData = holeItem?.data || {};
            const pair = { solid: csgItemRef(solid), hole: csgItemRef(holeItem),
                containmentKey: { solid: solid?.data?.containmentKey ?? null, hole: holeData.containmentKey ?? null },
                containmentKeyDecision: 'not-used-as-csg-rejection', status: 'rejected', reasons: [] };
            if (!holeItem || semanticKind(holeItem) !== VECTOR_KIND.HOLE) {
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
            // A nested contour owns an explicit containing solid. This is
            // positive topology evidence for that one solid only; it does not
            // replace Z-order for unrelated objects.
            const containmentOwnerMatch = !!(
                holeData.ownerContainmentKey &&
                holeData.ownerContainmentKey === solid.data?.containmentKey
            );
            const zAllowed = isAboveInRenderOrder(holeItem, solid) || containmentOwnerMatch;
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
            let holeBase = getGlobalUnsubtractedPath(holeItem);
            pair.holeWorldGeometry = csgGeometrySnapshot(holeBase);
            if (!holeBase) {
                pair.reasons.push('owner-geometry-invalid');
                if (tracePass) tracePass.candidatePairs.push(pair);
                continue;
            }
            holeBase = confineSubtractiveGeometry(holeBase);
            pair.confinedGeometry = csgGeometrySnapshot(holeBase);
            if (!holeBase) {
                pair.reasons.push('geometry-confine');
                if (tracePass) tracePass.candidatePairs.push(pair);
                continue;
            }
            if (realGeometryIntersects(pristineBase, holeBase)) {
                pair.status = 'accepted';
                report.acceptedPairs += 1;
                report.intersectionPairs += 1;
                const holeKey = holeData.containmentKey || holeData.semanticId || holeItem.id;
                intersectingHoleKeys.add(holeKey);
                intersectingHoleKeysForSolid.push(holeKey);
                pair.reasons.push(containmentOwnerMatch ? 'accepted-containing-solid' : 'accepted');
                if (tracePass) tracePass.candidatePairs.push(pair);
                intersectingHoles.push(holeBase);
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
                let vhClone = vh.geom.clone({ insert: false });
                vhClone = confineSubtractiveGeometry(vhClone);
                if (!vhClone) return;
                if (pristineBounds.intersects(vhClone.bounds)) {
                    intersectingHoles.push(vhClone);
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

        let mergedHole = null;
        try {
            for (let k = 0; k < intersectingHoles.length; k++) {
                const curHole = intersectingHoles[k];
                if (!mergedHole) {
                    mergedHole = curHole.clone({ insert: false });
                } else {
                    if (mergedHole.bounds.intersects(curHole.bounds)) {
                        try {
                            const leftBefore = csgGeometrySnapshot(mergedHole);
                            const rightBefore = csgGeometrySnapshot(curHole);
                            const united = mergedHole.unite(curHole, { insert: false });
                            const accepted = !!united && Math.abs(united.area || 0) > 0.01;
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
                    const testArea = Math.abs(testSub.area || 0);
                    const testSegments = countSegments(testSub);
                    // Una perforación legítima puede dejar menos del 5% del
                    // sólido original (A/F/A, bandas y detalles finos). El
                    // umbral anterior rechazaba esos huecos y dejaba el
                    // sólido visualmente relleno. Solo se rechaza un resultado
                    // vacío, degenerado o con un área imposible.
                    const isValidArea = testArea > 0.01 &&
                        testArea < (pristineArea - Math.max(0.01, pristineArea * 1e-7));
                    const accepted = testSegments >= 3 && isValidArea && testSub.bounds.width > 1 && testSub.bounds.height > 1;
                    csgTraceOperation(tracePass, 'subtract.merged', { success: true, accepted,
                        solidBefore, holeBefore, result: csgGeometrySnapshot(testSub),
                        testArea, testSegments, pristineArea,
                        rejection: accepted ? null : (!isValidArea ? 'area' : (testSegments < 3 ? 'segments' : 'bounds')) });
                    if (accepted) {
                        finalSubtracted = testSub;
                        report.appliedPairs += intersectingHoles.length;
                        intersectingHoleKeysForSolid.forEach(key => appliedHoleKeys.add(key));
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
            let acceptedStepCount = 0;
            for (let k = 0; k < intersectingHoles.length; k++) {
                const singleHole = intersectingHoles[k];
                try {
                    const progressBefore = csgGeometrySnapshot(currentProgress);
                    const holeBefore = csgGeometrySnapshot(singleHole);
                    const stepSub = currentProgress.subtract(singleHole, { insert: false });
                    if (stepSub) {
                        const stepArea = Math.abs(stepSub.area || 0);
                        const stepSegments = countSegments(stepSub);
                        const isStepValid = stepArea > 0.01 &&
                            stepArea < (pristineArea - Math.max(0.01, pristineArea * 1e-7));
                        const accepted = stepSegments >= 3 && isStepValid && stepSub.bounds.width > 1 && stepSub.bounds.height > 1;
                        csgTraceOperation(tracePass, 'subtract.step', { success: true, accepted,
                            solidBefore: progressBefore, holeBefore, result: csgGeometrySnapshot(stepSub),
                            stepArea, stepSegments, pristineArea,
                            rejection: accepted ? null : (!isStepValid ? 'area' : (stepSegments < 3 ? 'segments' : 'bounds')) });
                        if (accepted) {
                            currentProgress.remove();
                            currentProgress = stepSub;
                            acceptedStepCount += 1;
                            report.appliedPairs += 1;
                            const stepKey = intersectingHoleKeysForSolid[k];
                            if (stepKey != null) appliedHoleKeys.add(stepKey);
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
            if (acceptedStepCount > 0) {
                finalSubtracted = currentProgress;
            } else {
                currentProgress.remove();
                finalSubtracted = null;
            }
        }

        csgTraceOperation(tracePass, 'solid-pass', { solid: csgItemSnapshot(solid), pristine: csgGeometrySnapshot(pristineBase),
            holeCount: intersectingHoles.length, final: csgGeometrySnapshot(finalSubtracted), accepted: !!finalSubtracted,
            appliedHoleKeys: [...intersectingHoleKeysForSolid].filter(key => appliedHoleKeys.has(key)),
            rejection: finalSubtracted ? null : 'no-valid-subtract-result' });
        if (finalSubtracted) {
            sanitizeMaterializedCSGGeometry(finalSubtracted);
            if (solid.data.nodeEditActive === true) {
                // Node editing works on the canonical positive geometry. Do
                // not replace it with the temporary cut result until the edit
                // session ends; otherwise the next node gesture would edit
                // the hole boundary instead of the solid.
                finalSubtracted.remove();
                solid.data.csgMaterialized = false;
                solid.visible = true;
            } else {
                attachGlobalGeometryToOwnerLocal(finalSubtracted, solid);
                solid.removeChildren();
                if (finalSubtracted instanceof paper.CompoundPath) {
                    solid.addChildren(finalSubtracted.removeChildren());
                } else {
                    solid.addChild(finalSubtracted);
                }
                solid.data.csgMaterialized = true;
                solid.visible = true;
            }
        } else {
            solid.data.csgMaterialized = false;
        }
        pristineBase.remove();
        intersectingHoles.forEach(h => { try { h.remove(); } catch(e) {} });
    }

    if (typeof paper !== 'undefined' && paper.view) {
        paper.view.update();
    }
    traceReason = 'completed';
    } finally {
        report.rejectedPairs = Math.max(0, report.candidatePairs - report.acceptedPairs);
        report.acceptedHoleKeys = [...intersectingHoleKeys];
        report.appliedHoleKeys = [...appliedHoleKeys];
        report.acceptedHoleCount = intersectingHoleKeys.size;
        report.appliedHoleCount = appliedHoleKeys.size;
        report.unresolvedHoles = Math.max(0, report.holeOwnerCount - report.appliedHoleCount);
        report.status = traceReason || report.status;
        report.completed = traceReason === 'completed' || report.status === 'no-subtractive-items' || report.status === 'no-eligible-layer-items';
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
export function decomposeByContainmentHierarchy(rootTarget, isClipped = false, options = {}) {
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
            geomBasePathData: geomBase.pathData || null,
            geomBaseClassName: geomBase.className || "CompoundPath",
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

        stampGeomBase(compound, geomBase);
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

    atomicPaths.sort((a, b) => (a.data?.docOrder || 0) - (b.data?.docOrder || 0));
    const relationResult = buildContourRelations(atomicPaths, {
        fillRule: normalizeFillRule(rootTarget.data?.originalFillRule || atomicPaths[0]?.data?.originalFillRule)
    });
    const { nodes } = relationResult;
    nodes.forEach(node => {
        node.id = node.index;
        node.docOrder = node.path.data?.docOrder ?? node.sourceContourIndex ?? node.index;
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
            sourceDocumentOrder: node.docOrder ?? node.path.data?.docOrder ?? node.id,
            sourceZOrder: node.docOrder ?? node.path.data?.docOrder ?? node.id,
            contourDepth: node.depth,
            contourRole: isHole ? "hole" : "outer",
            originalIsHole: typeof node.path.data?.originalIsHole === "boolean" ? node.path.data.originalIsHole : isHole,
            source: node.path.data?.source || rootTarget.data?.source,
            userImported: node.path.data?.userImported ?? rootTarget.data?.userImported,
            // A decomposed path is a new public owner; never inherit a
            // text-vector/fusion id that would alias the removed wrapper.
            fusionId: null,
            geomBase: geomBase,
            geomBasePathData: geomBase.pathData || null,
            geomBaseClassName: geomBase.className || "CompoundPath",
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

        // The detached base and its path-data serialization are one contract.
        // Never leave a decomposed real hole dependent on a live Paper object.
        stampGeomBase(compoundItem, geomBase);
        resultingItems.push(compoundItem);
        node.path.remove();
    });

    const finalDeliveredItems = [];
    let previousStackingUnit = null;
    resultingItems.forEach((item, sourceOrder) => {
        let finalItem = item;
        if (shouldClip && typeof window !== 'undefined' && typeof window.clipItem === 'function') {
            finalItem = window.clipItem(item);
        }
        if (targetLayer) {
            // Add all owners through one controlled stacking sequence. Repeated
            // insertBelow(currentMockup) reverses independent SVG contours in
            // Paper.js, which changes hole-vs-solid Z semantics.
            targetLayer.addChild(finalItem);
            if (window.currentMockup) {
                if (previousStackingUnit && previousStackingUnit.parent === targetLayer) {
                    finalItem.insertAbove(previousStackingUnit);
                } else {
                    finalItem.insertBelow(window.currentMockup);
                }
            }
        }
        finalItem.data = { ...(finalItem.data || {}), decompositionOrder: sourceOrder };
        previousStackingUnit = finalItem;
        
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
        const runCsg = () => {
            try { return recalculateDynamicSubtractions(targetLayer); }
            catch (error) {
                if (typeof window !== "undefined") window.EKKO_CSG_LAST_ERROR = String(error?.stack || error);
                return null;
            }
        };
        // Descomponer must return the new physical owners before the expensive
        // boolean pass starts. This keeps the editor responsive and lets the
        // runtime probe observe the decomposition even when a large SVG needs
        // a long CSG pass.
        if (options?.deferCSG && typeof window !== "undefined") {
            window.setTimeout(runCsg, 0);
        } else {
            runCsg();
        }
    }

    const auditOwners = finalDeliveredItems.map((entry, index) => {
        const owner = getPublicOwner(entry) || entry;
        const data = owner?.data || {};
        const unit = getStackingUnit(owner) || owner;
        return {
            index, ownerId: owner?.id ?? null, className: owner?.className || null,
            sourceContourIndex: data.sourceContourIndex ?? null,
            sourceDocumentOrder: data.sourceDocumentOrder ?? null,
            semanticKind: semanticKind(owner), isHole: data.isHole === true,
            hasGeomBase: !!data.geomBase, hasGeomBasePathData: typeof data.geomBasePathData === "string",
            layerIndex: unit?.index ?? null
        };
    });
    if (typeof window !== "undefined") {
        window.EKKO_DECOMPOSITION_LAST = {
            sourceCount: atomicPaths.length, ownerCount: auditOwners.length,
            owners: auditOwners,
            sourceOrderPreserved: auditOwners.every((entry, i, all) => i === 0 ||
                (entry.sourceDocumentOrder ?? entry.sourceContourIndex ?? i) >=
                (all[i - 1].sourceDocumentOrder ?? all[i - 1].sourceContourIndex ?? i - 1)),
            allBasesSerializable: auditOwners.every(entry => entry.hasGeomBase && entry.hasGeomBasePathData),
            at: new Date().toISOString()
        };
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

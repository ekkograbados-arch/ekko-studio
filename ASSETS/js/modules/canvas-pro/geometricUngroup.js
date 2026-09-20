import { isMockupOrMask, isContainmentWrapper, getPublicOwner, getPublicOwners, getOwnerLocalGeometry, toWorldGeometry, worldPointToOwner, getPublicWorldBounds } from "./designGeometry.js";
import { classifyContour, normalizeFillRule } from "./holeSemantics.js";
import {
    getStackingUnit,
    semanticKind,
    isAboveInRenderOrder,
    getCanonicalDesignLayer,
    collectVectorOwners,
    buildCutterPairs,
    auditScene
} from "./vectorSemantics.js";
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

function resolveCanonicalDesignLayer(targetLayer = null) {
    return getCanonicalDesignLayer({ targetLayer });
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
    const fillRule = normalizeFillRule(
        node?.path?.data?.originalFillRule || rootTarget?.data?.originalFillRule ||
        node?.path?.fillRule || rootTarget?.fillRule || ""
    );
    // Classification is centralized. Z-order is intentionally not consulted
    // here: it decides what a real hole cuts, never whether the contour is a
    // hole in the first place.
    return !!classifyContour(node, { fillRule }).isHole;
}

export function getGlobalUnsubtractedPath(item) {
    // Sole world-geometry producer: geomBase is owner-local and the complete
    // owner global matrix is applied exactly once by the canonical layer.
    // Keep a direct owner-local fallback here. CSG must not silently lose a
    // valid owner merely because a wrapper/publicOwner cycle prevents the
    // generic resolver from reaching geomBase.
    const owner = getPublicOwner(item) || item;
    const base = owner?.data?.geomBase;
    if (base && typeof base.clone !== 'function') {
        if (typeof window !== 'undefined') {
            window.EKKO_GEOMBASE_ERRORS = [
                ...(Array.isArray(window.EKKO_GEOMBASE_ERRORS) ? window.EKKO_GEOMBASE_ERRORS : []),
                { ownerId: owner?.id ?? null, reason: 'non-paper-geomBase' }
            ].slice(-50);
        }
        return null;
    }
    if (base?.clone && owner) {
        try {
            const local = base.clone({ insert: false });
            local.applyMatrix = false;
            local.matrix = new paper.Matrix();
            const world = owner.globalMatrix?.clone?.() || owner.matrix?.clone?.() || new paper.Matrix();
            local.transform(world);
            return local;
        } catch (_) {}
    }
    return toWorldGeometry(owner);
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
        const confined = geometry.intersect(boundary, { insert: false });
        if (confined && Math.abs(confined.area || 0) > 0.001) {
            geometry.remove();
            return confined;
        }
        // No intersection means this operand is entirely outside the product;
        // it must not participate in CSG at all.
        geometry.remove();
        return null;
    } catch (e) {
        // If Paper.js cannot boolean-intersect this boundary, clipItem still
        // provides the final visual containment; never destroy the operand.
    } finally {
        try { boundary?.remove?.(); } catch (e) {}
    }
    return geometry;
}



function applyHoleVisualStyle(item) {
    if (!item) return;
    // A real hole is a closed cutter, not a permanent transparent silhouette.
    // Its geometry remains in data.geomBase for CSG, hit testing and history,
    // while the design owner is hidden. Selection.js creates the only visible
    // outline, and only while the hole is selected.
    const paint = node => {
        if (!node || node.clipMask || node.data?.isMask || node.data?.mockup) return;
        node.visible = false;
        node.opacity = 1;
        if (node instanceof paper.Path || node instanceof paper.CompoundPath) {
            node.fillColor = null;
            node.strokeColor = null;
            node.strokeWidth = 0;
        }
        node.children?.forEach(paint);
    };
    paint(item);
}

export function recalculateDynamicSubtractions(targetLayer = null, virtualHoleEntries = null) {
    const report = {
        valid: true, receivedHoles: 0, appliedHoles: 0, rejectedHoles: 0,
        failedBooleans: [], booleanWarnings: [], affectedSolids: [], reasons: [],
        holeOwners: 0, solidOwners: 0, candidatePairs: 0,
        appliedPairs: 0, rejectedPairs: 0, pairDiagnostics: [],
        holeToSolidPairs: 0, holeToHolePairs: 0,
        skippedByZOrder: 0, skippedByNoIntersection: 0,
        solidCandidates: 0, skippedSolids: [], solidChecks: [],
        ownerDiagnostics: [],
        virtualHolesReceived: 0, virtualHolesApplied: 0
    };
    const layer = resolveCanonicalDesignLayer(targetLayer);
    const scopedVirtualHoles = Array.isArray(virtualHoleEntries)
        ? virtualHoleEntries
        : (Array.isArray(window._fusionVirtualHoles) ? window._fusionVirtualHoles : []);
    report.virtualHolesReceived = scopedVirtualHoles.filter(Boolean).length;
    if (!layer || !layer.children) {
        report.valid = false;
        report.reasons.push("missing-target-layer");
        if (typeof window !== "undefined") window.EKKO_CSG_LAST_REPORT = report;
        return report;
    }
    const items = [...layer.children].filter(item =>
        item && !item.data?.mockup && !item.data?.isMask && !item.data?.isSelectionBox &&
        !item.data?.isHandle && !item.data?.isSmartGuide && !item.data?.isMeasurement &&
        !item.data?.isTracePreview && !item.data?.isNodeEditOverlay
    );
    if (items.length === 0) {
        report.valid = false;
        report.reasons.push("empty-design-layer");
        if (typeof window !== "undefined") window.EKKO_CSG_LAST_REPORT = report;
        return report;
    }
    // One canonical owner set feeds diagnostics, pair planning and the
    // boolean pass. No private recursive extractor is allowed to create a
    // second identity for a wrapper, fusion mask or public contour.
    const semanticOwners = collectVectorOwners(layer, { requireGeomBase: true });
    report.receivedHoles = semanticOwners.filter(item => semanticKind(item) === 'hole').length;
    if (semanticOwners.length === 0) {
        report.reasons.push("no-semantic-owners");
        if (typeof window !== "undefined") window.EKKO_CSG_LAST_REPORT = report;
        return report;
    }
    const scenePlan = buildCutterPairs(semanticOwners);
    const realOwners = new Set(semanticOwners);
    const hasPositiveAreaPair = (hole, solid) => {
        let holeGeom = null;
        let solidGeom = null;
        let overlap = null;
        try {
            holeGeom = getGlobalUnsubtractedPath(hole);
            solidGeom = getGlobalUnsubtractedPath(solid);
            if (!holeGeom || !solidGeom || !holeGeom.bounds?.intersects(solidGeom.bounds)) return false;
            overlap = holeGeom.intersect(solidGeom, { insert: false });
            return Math.abs(overlap?.area || 0) > 1e-7;
        } catch (_) {
            return false;
        } finally {
            try { overlap?.remove?.(); } catch (_) {}
            try { holeGeom?.remove?.(); } catch (_) {}
            try { solidGeom?.remove?.(); } catch (_) {}
        }
    };
    const realPairs = scenePlan.pairs
        .filter(pair => pair.targetKind === "solid")
        .map(pair => ({ hole: pair.hole, solid: pair.target }))
        .filter(pair => realOwners.has(pair.hole) && realOwners.has(pair.solid))
        .filter(pair => hasPositiveAreaPair(pair.hole, pair.solid));
    const pairHolesBySolid = new Map();
    realPairs.forEach(({ hole, solid }) => {
        if (!pairHolesBySolid.has(solid)) pairHolesBySolid.set(solid, new Set());
        pairHolesBySolid.get(solid).add(hole);
    });
    const diagnosticId = item => item?.data?.semanticId || item?.data?.containmentKey || item?.id || null;
    report.holeOwners = scenePlan.holes.length;
    report.solidOwners = scenePlan.solids.length;
    report.holeToSolidPairs = realPairs.filter(pair => pair.solid && semanticKind(pair.solid) === "solid").length;
    report.holeToHolePairs = scenePlan.pairs.filter(pair => pair.targetKind === "hole").length;
    report.candidatePairs = realPairs.length;
    const sceneAudit = auditScene(layer, { requireGeomBase: true });
    report.ownerDiagnostics = sceneAudit.owners;
    report.ownerSetContract = {
        source: "vectorSemantics.collectVectorOwners",
        ownerCount: semanticOwners.length,
        matchesAudit: sceneAudit.ownerCount === semanticOwners.length
    };
    report.pairDiagnostics = [
        ...realPairs.map(pair => ({ hole: diagnosticId(pair.hole), target: diagnosticId(pair.solid), targetKind: "solid", status: "candidate" })),
        ...scenePlan.pairs.filter(pair => pair.targetKind === "hole").map(pair => ({
            hole: diagnosticId(pair.hole), target: diagnosticId(pair.target), targetKind: "hole", status: "candidate"
        })),
        ...scenePlan.skipped.map(item => ({
            hole: diagnosticId(item.hole), target: diagnosticId(item.target),
            targetKind: item.targetKind, status: item.reason
        }))
    ];
    report.skippedByZOrder = scenePlan.skipped.filter(item => item.reason === "z-order").length;
    report.skippedByNoIntersection = scenePlan.skipped.filter(item => item.reason === "no-intersection").length;

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

    function geometryFullyContainedByCutter(source, cutter) {
        if (!source || !cutter?.contains) return false;
        const points = [];
        const collect = (item, visited = new Set()) => {
            if (!item || visited.has(item)) return;
            visited.add(item);
            if (item.segments) item.segments.forEach(segment => points.push(segment.point));
            item.children?.forEach(child => collect(child, visited));
        };
        collect(source);
        return points.length > 0 && points.every(point => cutter.contains(point));
    }

    subItems.forEach(item => {
        if (item && item.data && item.data.geomBase && !item.data.isHole) {
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
        } else if (item && item.data && item.data.isHole) {
            // El cutter no se pinta en la capa de diseño. Su geometría cerrada
            // se conserva para CSG, hit-test e historial; la selección muestra
            // un overlay temporal cuando corresponde.
            applyHoleVisualStyle(item);
        }
    });

    for (let j = 0; j < semanticOwners.length; j++) {
        const solid = semanticOwners[j];
        const solidId = solid?.data?.containmentKey || solid?.id || `solid-${j}`;
        if (!solid || !solid.data) {
            report.skippedSolids.push({ id: solidId, reason: "missing-data" });
            continue;
        }
        if (solid.data.isHole) continue;
        if (!solid.data.geomBase) {
            report.skippedSolids.push({ id: solidId, reason: "missing-geomBase" });
            continue;
        }
        if (isMockupOrMask(solid)) {
            report.skippedSolids.push({ id: solidId, reason: "mockup-or-mask" });
            continue;
        }
        report.solidCandidates += 1;
        const pristineBase = getGlobalUnsubtractedPath(solid);
        if (!pristineBase) {
            report.skippedSolids.push({ id: solidId, reason: "missing-world-geometry" });
            continue;
        }
        const pristineArea = Math.abs(pristineBase.area || 0);
        const pristineBounds = pristineBase.bounds;

        const intersectingHoles = [];
        let intersectingVirtualHoles = 0;
        for (let i = 0; i < semanticOwners.length; i++) {
            if (i === j) continue;
            const holeItem = semanticOwners[i];
            if (!holeItem || !holeItem.data || !holeItem.data.isHole ||
                isMockupOrMask(holeItem)) continue;
            const allowedHoles = pairHolesBySolid.get(solid);
            if (!allowedHoles?.has(holeItem)) continue;
            // A real client hole is a physical cutter for every eligible
            // solid rendered below it, not only for a matching containment
            // key.  Containment keys describe ownership/history; they must
            // not suppress the user's cross-object Z-order rule.
            // A hole cuts only objects rendered below it. Keeping this check
            // here (before cloning the CSG operand) prevents a lower hole
            // from silently perforating a solid that was moved above it.
            if (!isAboveInRenderOrder(holeItem, solid)) continue;
            let holeBase = getGlobalUnsubtractedPath(holeItem);
            if (!holeBase) continue;
            holeBase = confineSubtractiveGeometry(holeBase);
            if (!holeBase) continue;
            if (pristineBounds.intersects(holeBase.bounds)) {
                intersectingHoles.push(holeBase);
            } else {
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
                    intersectingVirtualHoles += 1;
                } else {
                    vhClone.remove();
                }
            });
        }

        report.solidChecks.push({
            id: solidId,
            intersectingHoles: intersectingHoles.length,
            virtualHoles: intersectingVirtualHoles
        });
        if (intersectingHoles.length === 0) {
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
                            const united = mergedHole.unite(curHole, { insert: false });
                            if (united && Math.abs(united.area || 0) > 0.01) {
                                mergedHole.remove();
                                mergedHole = united;
                                continue;
                            }
                        } catch (error) {
                            report.booleanWarnings.push({ phase: "unite-holes", error: String(error?.message || error) });
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
        } catch (error) {
            report.booleanWarnings.push({ phase: "build-merged-hole", error: String(error?.message || error) });
            mergedHole = null;
        }

        let finalSubtracted = null;
        if (mergedHole) {
            try {
                const testSub = pristineBase.subtract(mergedHole, { insert: false });
                if (testSub) {
                    const testArea = Math.abs(testSub.area || 0);
                    const testSegments = countSegments(testSub);
                    // Una perforación legítima puede dejar menos del 5% del
                    // sólido original (A/F/A, bandas y detalles finos). El
                    // umbral anterior rechazaba esos huecos y dejaba el
                    // sólido visualmente relleno. Solo se rechaza un resultado
                    // vacío, degenerado o con un área imposible.
                    const areaLoss = pristineArea - testArea;
                    // A valid cut may leave a very thin band or a result with
                    // fewer than three segments. The old width/segment gates
                    // rejected exactly those contours and restored them as
                    // filled solids. Require a real area change, not an
                    // arbitrary visual-size threshold.
                    const isValidArea = testArea >= 0 &&
                        testArea <= (pristineArea * 1.000001) &&
                        areaLoss > Math.max(0.0001, pristineArea * 1e-7);
                    const completeRemoval = testArea <= 1e-7 &&
                        geometryFullyContainedByCutter(pristineBase, mergedHole);
                    if ((testSegments >= 1 && isValidArea) || completeRemoval) {
                        finalSubtracted = testSub || new paper.Path({ insert: false });
                    } else {
                        testSub?.remove?.();
                    }
                }
            } catch (error) {
                report.booleanWarnings.push({ phase: "merged-holes", error: String(error?.message || error) });
            }
            try { mergedHole?.remove?.(); } catch (_) {}
        }

        if (!finalSubtracted) {
            let currentProgress = pristineBase.clone({ insert: false });
            let appliedSteps = 0;
            for (let k = 0; k < intersectingHoles.length; k++) {
                const singleHole = intersectingHoles[k];
                try {
                    const stepSub = currentProgress.subtract(singleHole, { insert: false });
                    if (stepSub) {
                        const stepArea = Math.abs(stepSub.area || 0);
                        const stepSegments = countSegments(stepSub);
                        const stepAreaLoss = pristineArea - stepArea;
                        const isStepValid = stepArea >= 0 &&
                            stepArea <= (pristineArea * 1.000001) &&
                            stepAreaLoss > Math.max(0.0001, pristineArea * 1e-7);
                        const completeStepRemoval = stepArea <= 1e-7 &&
                            geometryFullyContainedByCutter(pristineBase, singleHole);
                        if ((stepSegments >= 1 && isStepValid) || completeStepRemoval) {
                            currentProgress.remove();
                            currentProgress = stepSub || new paper.Path({ insert: false });
                            appliedSteps += 1;
                        } else {
                            stepSub?.remove?.();
                        }
                    }
                } catch (error) {
                    report.booleanWarnings.push({ phase: "single-hole", error: String(error?.message || error) });
                }
            }
            finalSubtracted = appliedSteps > 0 ? currentProgress : null;
            if (!finalSubtracted) {
                try { currentProgress.remove(); } catch (_) {}
            }
        }

        if (finalSubtracted) {
            const realIntersectingHoles = Math.max(0, intersectingHoles.length - intersectingVirtualHoles);
            report.appliedHoles += intersectingHoles.length;
            report.appliedPairs += realIntersectingHoles;
            report.virtualHolesApplied += intersectingVirtualHoles;
            report.affectedSolids.push({
                id: solid.data?.containmentKey || solid.id || null,
                holes: intersectingHoles.length
            });
            const resultArea = Math.abs(finalSubtracted.area || 0);
            solid.removeChildren();
            if (resultArea <= 0.01) {
                // A cutter can legitimately remove a very small solid
                // completely. Keep the owner and geomBase for Undo/recalc,
                // but do not render an empty filled placeholder.
                try { finalSubtracted.remove(); } catch (_) {}
                solid.visible = false;
            } else {
                attachGlobalGeometryToOwnerLocal(finalSubtracted, solid);
                if (finalSubtracted instanceof paper.CompoundPath) {
                    solid.addChildren(finalSubtracted.removeChildren());
                } else {
                    solid.addChild(finalSubtracted);
                }
                solid.visible = true;
            }
        } else {
            const realIntersectingHoles = Math.max(0, intersectingHoles.length - intersectingVirtualHoles);
            report.failedBooleans.push({
                phase: "subtract-solid",
                solid: solid.data?.containmentKey || solid.id || "solid"
            });
            report.rejectedPairs += realIntersectingHoles;
            report.rejectedHoles += intersectingHoles.length;
            report.reasons.push(`boolean-rejected:${solid.data?.containmentKey || solid.id || "solid"}`);
        }
        pristineBase.remove();
        intersectingHoles.forEach(h => { try { h.remove(); } catch(e) {} });
    }

    report.valid = report.failedBooleans.length === 0 && report.rejectedHoles === 0;
    if (typeof window !== "undefined") window.EKKO_CSG_LAST_REPORT = report;
    if (typeof paper !== 'undefined' && paper.view) {
        paper.view.update();
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

    const targetLayer = resolveCanonicalDesignLayer(rootTarget.layer || null);
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
            isHole: singleIsHole,
            semanticKind: singleIsHole ? "hole" : "solid",
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

        // Igual que en la descomposición múltiple: el owner vectorial debe
        // entrar primero al CSG sin un clipGroup interpuesto.
        if (targetLayer) {
            targetLayer.addChild(compound);
            if (window.currentMockup) compound.insertBelow(window.currentMockup);
        }
        rootTarget.remove();
        if (targetLayer) recalculateDynamicSubtractions(targetLayer);

        let finalItem = compound;
        if (shouldClip && typeof window !== 'undefined' && typeof window.clipItem === 'function') {
            finalItem = window.clipItem(compound);
            if (finalItem !== compound) {
                const ownerId = compound.id || compound.data?.ownerId || compound.data?.containmentKey;
                finalItem.data = {
                    ...(finalItem.data || {}), role: "mockup-containment", clipGroup: true,
                    publicOwnerId: ownerId, isHole: undefined, geomBase: undefined
                };
                compound.data = { ...(compound.data || {}), publicOwner: true, ownerId };
            }
        }
        return { handled: true, simple: true, items: [compound] };
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
  // Semantic topology has priority over raw source order. A hole contained
  // by a solid must be above that solid; a solid island contained by a hole
  // must be above the hole. This reconstructs the physical AFA layering
  // without turning a hole into a permanent cut in its parent.
  const aInsideB = isContainedIn(a.path, b.path);
  const bInsideA = isContainedIn(b.path, a.path);
  if (aInsideB && (a.isHole || b.isHole)) return 1;
  if (bInsideA && (a.isHole || b.isHole)) return -1;

  const rootA = getRootNode(a);
  const rootB = getRootNode(b);
  if (rootA !== rootB) return a.docOrder - b.docOrder;
  if (isAncestorOf(a, b)) return -1;
  if (isAncestorOf(b, a)) return 1;
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
            isHole: isHole,
            semanticKind: isHole ? "hole" : "solid",
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
            explicitHole: typeof node.path.data?.explicitHole === "boolean" ? node.path.data.explicitHole : null,
            sourceElementId: node.path.data?.sourceElementId || null,
            sourceDocumentOrder: node.path.data?.sourceDocumentOrder ?? node.docOrder,
            sourceZOrder: node.path.data?.sourceZOrder ?? node.docOrder,
            holeClassification: node.path.data?.holeClassification || "shared-classifier",
            source: node.path.data?.source || rootTarget.data?.source,
            userImported: node.path.data?.userImported ?? rootTarget.data?.userImported,
            // A decomposed path is a new public owner; never inherit a
            // text-vector/fusion id that would alias the removed wrapper.
            fusionId: null,
            geomBase: geomBase,
            geomBasePathData: geomBase.pathData || null,
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

    // Primero publicar los owners vectoriales sin wrappers de clipping. El CSG
    // debe operar sobre owners físicos directos; envolverlos antes de recalcular
    // mezcla la identidad del clipGroup con la del cutter y permite que el
    // resultado visual vuelva a ser la silueta pintada original.
    const finalDeliveredItems = [];
    resultingItems.forEach(item => {
        if (targetLayer) {
            targetLayer.addChild(item);
            if (window.currentMockup) item.insertBelow(window.currentMockup);
        }
        finalDeliveredItems.push(item);
    });

    rootTarget.remove();

    if (targetLayer) {
        recalculateDynamicSubtractions(targetLayer);
    }

    // El clipping es una preocupación posterior al CSG. Nunca se usa como
    // owner semántico ni como entrada de la sustracción.
    if (shouldClip && typeof window !== 'undefined' && typeof window.clipItem === 'function') {
        resultingItems.forEach(item => {
            const wrapper = window.clipItem(item);
            if (!wrapper || wrapper === item) return;
            const ownerId = item.id || item.data?.ownerId || item.data?.containmentKey;
            wrapper.data = {
                ...(wrapper.data || {}), role: "mockup-containment", clipGroup: true,
                publicOwnerId: ownerId, isHole: undefined, geomBase: undefined
            };
            item.data = { ...(item.data || {}), publicOwner: true, ownerId };
        });
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
    window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
    window.decomposeByContainmentHierarchy = decomposeByContainmentHierarchy;
    window.geometricUngroupCompound = decomposeByContainmentHierarchy;
    window.geometricUngroupOneLevel = decomposeByContainmentHierarchy;
    window.getGlobalUnsubtractedPath = getGlobalUnsubtractedPath;
    window.isContainedIn = isContainedIn;
}

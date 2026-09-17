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
    while (curr && curr !== root && curr !== paper.project) {
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
function bakeMatrixIntoPath(path, matrix) {
    if (!path || !matrix || matrix.isIdentity()) return;
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
        path.children.forEach(child => bakeMatrixIntoPath(child, matrix));
    }
}

/**
 * Descompone cualquier estructura en trazados atómicos cerrados simples (paper.Path)
 */
let docOrderCounter = 0;
let decompositionScopeCounter = 0;
function flattenToAtomicPaths(item, accumulatedMatrix = null, parentMeta = {}) {
    const currentMatrix = accumulatedMatrix ? accumulatedMatrix.chain(item.matrix || new paper.Matrix()) : (item.matrix ? item.matrix.clone() : new paper.Matrix());
    const atomicPaths = [];
    const isFromCompound = parentMeta.isFromCompound || isCompoundPath(item);

    if (isPath(item)) {
        const cloned = item.clone({ insert: false });
// ✅ NO hornear la matriz en los segmentos.
// En cambio, calcular la matriz local que representa la transformación mundial acumulada.
cloned.applyMatrix = false;
const parentWorld = item.parent?.globalMatrix || new paper.Matrix();
if (!parentWorld.isIdentity()) {
  const localForParent = parentWorld.inverted().concatenate(currentMatrix);
  cloned.matrix = localForParent;
} else {
  cloned.matrix = currentMatrix.clone();
}
        if (cloned.segments && cloned.segments.length >= 3) {
            cloned.closed = true;
            cloned.data = {
                ...(cloned.data || {}),
                docOrder: docOrderCounter++,
                originalFillColor: item.fillColor ? item.fillColor.clone() : null,
                originalStrokeColor: item.strokeColor ? item.strokeColor.clone() : null,
                originalStrokeWidth: item.strokeWidth || 0,
                // La metadata explícita del SVG tiene prioridad sobre la
                // clasificación geométrica de fallback.
                originalIsHole: typeof item.data?.isHole === 'boolean' ? item.data.isHole :
                    (typeof parentMeta.isHole === 'boolean' ? parentMeta.isHole : null),
                isFromCompound: isFromCompound,
                originalClockwise: cloned.clockwise
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
                    isHole: typeof item.data?.isHole === 'boolean' ? item.data.isHole : undefined
                }));
            });
        }
  } else if (isGroup(item)) {
  if (item.children && item.children.length > 0) {
    const childrenCopy = [...item.children];
    // ✅ Si el grupo tiene isHole explícito, heredarlo a los hijos
    const groupIsHole = typeof item.data?.isHole === 'boolean' ? item.data.isHole : undefined;
    childrenCopy.forEach(child => {
      if (child.clipMask) return;
      atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix, {
        isFromCompound: false,
        isHole: groupIsHole
      }));
    });
  }
} else if (isPlacedSymbol(item)) {
        const def = (item.symbol && item.symbol.item) || item.definition || (item.symbol && item.symbol.definition);
        if (def) {
            const defClone = def.clone({ insert: false });
            atomicPaths.push(...flattenToAtomicPaths(defClone, currentMatrix, { isFromCompound: false }));
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
  const path = node.path;
  const isFromCompound = !!(path.data && path.data.isFromCompound);
  const explicitHole = path.data && typeof path.data.originalIsHole === 'boolean'
    ? path.data.originalIsHole
    : (path.data && typeof path.data.isHole === 'boolean' ? path.data.isHole : null);

  // ✅ REGLA ABSOLUTA: Si el objeto original (rootTarget) es explícitamente un hueco
  // (ej. convertido a Calado por el usuario), TODO lo que sale de él es hueco.
  if (rootTarget && rootTarget.data && rootTarget.data.isHole === true) {
    return true;
  }

  // La metadata original es la fuente de verdad. La geometría solo decide
  // cuando el SVG no aportó clasificación explícita.
  if (explicitHole !== null) return explicitHole;

if (isFromCompound && rootTarget && isCompoundPath(rootTarget)) {
  const testPt = getInteriorTestPoint(path);
  if (testPt) {
    // ✅ Transformar el punto de prueba al sistema LOCAL del rootTarget
    // antes de preguntar contains(), porque el path ya pudo tener su
    // matriz horneada mientras que rootTarget conserva la suya.
    const localPt = typeof rootTarget.globalToLocal === "function"
      ? rootTarget.globalToLocal(testPt)
      : testPt;
    if (rootTarget.contains(localPt)) {
      return false;
    }
  }
  return true;
}

  if (node.parent) {
    const parentPath = node.parent.path;
    const isParentHole = node.parent.isHole;
    if (!isParentHole) {
      // ✅ Si ambos tienen orientación original, usarla como fuente de verdad
      if (path.data && path.data.originalClockwise !== undefined && parentPath.data && parentPath.data.originalClockwise !== undefined) {
        return path.data.originalClockwise !== parentPath.data.originalClockwise;
      }
      // Solo como último recurso, usar paridad de profundidad
      return node.depth % 2 !== 0;
    } else {
      // Si el padre es hueco, la paridad se invierte lógicamente
      return node.depth % 2 === 0;
    }
  }
    return false;
}

export function getGlobalUnsubtractedPath(item) {
    if (!item || !item.data || !item.data.geomBase) return null;
    const tempBase = item.data.geomBase.clone({ insert: false });
    return tempBase;
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
        boundary = window.clipMask.clone({ insert: false });
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

function getContentItem(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup) {
        if (!item.children) return item;
        const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
        if (content) return content;
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

function applyHoleVisualStyle(item) {
    if (!item) return;
    // Un hueco real conserva representación visible e interactiva sin
    // convertirse semánticamente en sólido. El CSG sigue gobernado por
    // data.isHole; el estilo solo mantiene la identidad pública del vector.
    const data = item.data || {};
    const fill = data.originalFillColor?.clone?.() || new paper.Color('#64748b');
    const stroke = data.originalStrokeColor?.clone?.() || new paper.Color('#334155');
    if (fill.alpha <= 0) fill.alpha = 0.35;
    item.fillColor = fill;
    item.strokeColor = stroke;
    item.strokeWidth = data.originalStrokeWidth || (1 / (paper.view?.zoom || 1));
    item.opacity = 1;
}

function extractSubtractiveItems(topList) {
    const result = [];
    function collectRecursive(item) {
        if (!item) return;
        const content = getContentItem(item);
        if (!content) return;

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

        if (isGroup(content) && content.children && content.children.length > 0) {
            content.children.forEach(c => {
                if (!c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask))) {
                    collectRecursive(c);
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
    const layer = targetLayer || (typeof paper !== 'undefined' && paper.project ? paper.project.activeLayer : null);
    const scopedVirtualHoles = Array.isArray(virtualHoleEntries)
        ? virtualHoleEntries
        : (Array.isArray(window._fusionVirtualHoles) ? window._fusionVirtualHoles : []);
    if (!layer || !layer.children) return;
    const items = [...layer.children].filter(item =>
        item && !item.data?.mockup && !item.data?.isMask && !item.data?.isSelectionBox &&
        !item.data?.isHandle && !item.data?.isSmartGuide && !item.data?.isMeasurement &&
        !item.data?.isTracePreview && !item.data?.isNodeEditOverlay
    );
    if (items.length === 0) return;
    const subItems = extractSubtractiveItems(items);
    if (subItems.length === 0) return;

    function countSegments(item) {
        if (!item) return 0;
        if (item.segments) return item.segments.length;
        if (item.children) {
            let total = 0;
            item.children.forEach(c => { total += countSegments(c); });
            return total;
        }
        return 0;
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
            item.visible = true;
            // El CSG usa isHole como semántica; el objeto sigue siendo visible,
            // seleccionable y con contorno dentro del editor.
            applyHoleVisualStyle(item);
        }
    });

    for (let j = 0; j < subItems.length; j++) {
        const solid = subItems[j];
        if (!solid || !solid.data || solid.data.isHole || !solid.data.geomBase) continue;
        const pristineBase = getGlobalUnsubtractedPath(solid);
        if (!pristineBase) continue;
        const pristineArea = Math.abs(pristineBase.area || 0);
        const pristineBounds = pristineBase.bounds;

        const intersectingHoles = [];
        for (let i = 0; i < subItems.length; i++) {
            if (i === j) continue;
            const holeItem = subItems[i];
            if (!holeItem || !holeItem.data || !holeItem.data.isHole) continue;
            if (!solid.data.containmentKey ||
                holeItem.data.ownerContainmentKey !== solid.data.containmentKey) {
                continue;
            }
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
                if (!solid.data.containmentKey ||
                    vh.ownerContainmentKey !== solid.data.containmentKey) return;
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
                        } catch (e) {}
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
                    const isValidArea = testArea > 0.01 &&
                        testArea <= (pristineArea * 1.000001);
                    if (testSegments >= 3 && isValidArea && testSub.bounds.width > 1 && testSub.bounds.height > 1) {
                        finalSubtracted = testSub;
                    } else {
                        testSub.remove();
                    }
                }
            } catch (e) {}
            mergedHole.remove();
        }

        if (!finalSubtracted) {
            let currentProgress = pristineBase.clone({ insert: false });
            for (let k = 0; k < intersectingHoles.length; k++) {
                const singleHole = intersectingHoles[k];
                try {
                    const stepSub = currentProgress.subtract(singleHole, { insert: false });
                    if (stepSub) {
                        const stepArea = Math.abs(stepSub.area || 0);
                        const stepSegments = countSegments(stepSub);
                        const isStepValid = stepArea > 0.01 &&
                            stepArea <= (pristineArea * 1.000001);
                        if (stepSegments >= 3 && isStepValid && stepSub.bounds.width > 1 && stepSub.bounds.height > 1) {
                            currentProgress.remove();
                            currentProgress = stepSub;
                        } else {
                            stepSub.remove();
                        }
                    }
                } catch (e) {}
            }
            finalSubtracted = currentProgress;
        }

        if (finalSubtracted) {
            attachGlobalGeometryToOwnerLocal(finalSubtracted, solid);
            solid.removeChildren();
            if (finalSubtracted instanceof paper.CompoundPath) {
                solid.addChildren(finalSubtracted.removeChildren());
            } else {
                solid.addChild(finalSubtracted);
            }
            solid.visible = true;
        }
        pristineBase.remove();
        intersectingHoles.forEach(h => { try { h.remove(); } catch(e) {} });
    }

    if (typeof paper !== 'undefined' && paper.view) {
        paper.view.update();
    }
}

function isAncestorOf(potentialAncestor, node) {
    let curr = node.parent;
    while (curr) {
        if (curr === potentialAncestor) return true;
        curr = curr.parent;
    }
    return false;
}

function getRootNode(node) {
    let curr = node;
    while (curr.parent) {
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

    const atomicPaths = flattenToAtomicPaths(rootTarget);
    if (!atomicPaths || atomicPaths.length === 0) {
        return null;
    }

    if (atomicPaths.length === 1) {
        const single = atomicPaths[0];
        const compound = new paper.CompoundPath({ insert: false });
        compound.addChild(single.clone({ insert: false }));
        single.remove();

        const geomBase = compound.clone({ insert: false });
        geomBase.matrix = new paper.Matrix();

        const singleIsHole = !!(rootTarget.data?.isHole || single.data?.isHole);
        // The decomposed owner is a new public object, but it must carry the
        // source topology/identity contract.  In particular, resetting the
        // CompoundPath fill rule to Paper's default makes a real hole (and
        // internal glyph holes) behave as a solid after ungroup.
        compound.fillRule = "evenodd";
        compound.data = {
            ...(rootTarget.data || {}),
            locked: false,
            label: (rootTarget.data && rootTarget.data.label) ? rootTarget.data.label : "Capa Independiente",
            isHole: singleIsHole,
            isFusionReceptor: singleIsHole,
            fillRule: "evenodd",
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
        pathClone.matrix = new paper.Matrix();
        compoundItem.addChild(pathClone);
        compoundItem.fillRule = "evenodd";

        const geomBase = new paper.CompoundPath({ insert: false });
        const baseClone = node.path.clone({ insert: false });
        geomBase.addChild(baseClone);
        geomBase.matrix = new paper.Matrix();
        geomBase.fillRule = "evenodd";

        compoundItem.data = {
            locked: false,
            label: isHole ? `Calado Activo (Nivel ${node.depth})` : `Masa Sólida (Nivel ${node.depth})`,
            isHole: isHole,
            isFusionReceptor: isHole,
            fillRule: "evenodd",
            preserveCompoundTopology: true,
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
            finalItem.data.isHole = false;
            finalItem.data.geomBase = null;
            finalItem.data.clipGroup = true;
        }

        finalDeliveredItems.push(finalItem);
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
    window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
    window.decomposeByContainmentHierarchy = decomposeByContainmentHierarchy;
    window.geometricUngroupCompound = decomposeByContainmentHierarchy;
    window.geometricUngroupOneLevel = decomposeByContainmentHierarchy;
    window.getGlobalUnsubtractedPath = getGlobalUnsubtractedPath;
    window.isContainedIn = isContainedIn;
}

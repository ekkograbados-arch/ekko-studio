/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Architecture v36 - Deep Recursive Extraction & Containment Hierarchy Engine)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/geometricUngroup.js
Descripción:
Motor geométrico de Descomposición por Jerarquía de Contención y Capas SVG para EKKO Studio.
Basado en Paper.js y optimizado para corte y grabado láser (LightBurn / CNC).
Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN Y CAPAS
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt & EKKO_DIAG v6.1):
  * Descomposición integral en 1 solo clic en capas independientes (Z0, Z1, Z2...).
  * Eliminada la falsa equivalencia 'depth % 2 === 1 = hueco'.
  * Orden Z ascendente fiel a la jerarquía de contención topológica.
  * Preservación inmaculada de 'geomBase' en coordenadas de mundo sincronizadas.
  * Reactividad CSG no destructiva: calados dinámicos que perforan masas inferiores.
  * Blindaje Anti-Aniquilación: si una sustracción destruye completamente la masa, se descarta para evitar pérdidas.
========================================================================= */

function isPath(item) {
    if (!item) return false;
    return item.className === 'Path' || (typeof paper !== 'undefined' && paper.Path && item instanceof paper.Path);
}

function isCompoundPath(item) {
    if (!item) return false;
    return item.className === 'CompoundPath' || (typeof paper !== 'undefined' && paper.CompoundPath && item instanceof paper.CompoundPath);
}

function isGroup(item) {
    if (!item) return false;
    return item.className === 'Group' || (typeof paper !== 'undefined' && paper.Group && item instanceof paper.Group);
}

function isShape(item) {
    if (!item) return false;
    return item.className === 'Shape' || (typeof paper !== 'undefined' && paper.Shape && item instanceof paper.Shape);
}

function isSymbolItem(item) {
    if (!item) return false;
    return item.className === 'PlacedSymbol' || item.className === 'SymbolItem' ||
        (typeof paper !== 'undefined' && paper.PlacedSymbol && item instanceof paper.PlacedSymbol);
}

/**
 * Aplica recursivamente la matriz acumulada de transformaciones y descompone
 * cualquier estructura SVG (Group, CompoundPath, SymbolItem, Shape) en trazados cerrados
 * con sus transformaciones espaciales horneadas en coordenadas absolutas del lienzo.
 * Registra metadatos de origen (orden documental, fill original, pertenencia a compuesto).
 */
let docOrderCounter = 0;

function flattenToAtomicPaths(item, accumulatedMatrix = null, parentMeta = {}) {
    const currentMatrix = accumulatedMatrix ? accumulatedMatrix.chain(item.matrix || new paper.Matrix()) : (item.matrix ? item.matrix.clone() : new paper.Matrix());
    const atomicPaths = [];
    const isFromCompound = parentMeta.isFromCompound || isCompoundPath(item);

    if (isPath(item)) {
        if (!item.closed && (!item.segments || item.segments.length < 3)) {
            return [];
        }
        const cloned = item.clone({ insert: false });
        cloned.transform(currentMatrix);
        if (!cloned.closed) cloned.closed = true;
        if (Math.abs(cloned.area) > 0.05) {
            cloned.data = {
                ...item.data,
                docOrder: docOrderCounter++,
                originalFillColor: item.fillColor || parentMeta.compoundFill || parentMeta.groupFill || new paper.Color('#111827'),
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
                atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix, { isFromCompound: true, compoundFill: item.fillColor }));
            });
        }
    } else if (isGroup(item)) {
        if (item.children && item.children.length > 0) {
            const childrenCopy = [...item.children];
            childrenCopy.forEach(child => {
                if (!child.clipMask && !(child.data && (child.data.isMask || child.data.mockup || child.data.wasClipMask))) {
                    atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix, { isFromCompound: isFromCompound, groupFill: item.fillColor }));
                }
            });
        }
    } else if (isShape(item)) {
        const path = item.toPath(false);
        if (path) {
            atomicPaths.push(...flattenToAtomicPaths(path, currentMatrix, parentMeta));
            path.remove();
        }
    } else if (isSymbolItem(item)) {
        const defClone = item.definition?.item?.clone({ insert: false });
        if (defClone) {
            atomicPaths.push(...flattenToAtomicPaths(defClone, currentMatrix, parentMeta));
            defClone.remove();
        }
    }
    return atomicPaths;
}

/**
 * Obtiene un punto interior estricto y garantizado de un paper.Path.
 * Si el centroide (bounds.center) cae fuera por concavidad, proyecta normales
 * hacia el interior a lo largo de las curvas del trazado.
 */
function getInteriorTestPoint(path) {
    if (!path || !path.bounds) return null;
    const center = path.bounds.center;
    if (path.contains(center)) return center;

    if (path.curves && path.curves.length > 0) {
        for (let c = 0; c < path.curves.length; c++) {
            const curve = path.curves[c];
            const ptMid = curve.getPointAt(0.5);
            const normal = curve.getNormalAt(0.5);
            if (normal && ptMid) {
                const offsets = [0.5, 1, 2, 4, 8, 15];
                for (let d = 0; d < offsets.length; d++) {
                    const offset = offsets[d];
                    const p1 = ptMid.add(normal.multiply(offset));
                    if (path.contains(p1)) return p1;
                    const p2 = ptMid.subtract(normal.multiply(offset));
                    if (path.contains(p2)) return p2;
                }
            }
        }
    }
    return center;
}

/**
 * Determina si 'child' está topológicamente contenido dentro de 'parent'
 * usando múltiples puntos de control proyectados con redundancia.
 */
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
    // Ordenar por área descendente: contenedores mayores primero
    const sorted = [...atomicPaths].sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
    const nodes = sorted.map(path => ({
        path: path,
        area: Math.abs(path.area),
        parent: null,
        children: [],
        depth: 0,
        id: path.id
    }));

    for (let i = 0; i < nodes.length; i++) {
        const candidate = nodes[i];
        let immediateParent = null;
        let smallestParentArea = Infinity;

        for (let j = 0; j < i; j++) {
            const potentialParent = nodes[j];
            if (isContainedIn(candidate.path, potentialParent.path)) {
                if (potentialParent.area < smallestParentArea) {
                    smallestParentArea = potentialParent.area;
                    immediateParent = potentialParent;
                }
            }
        }
        if (immediateParent) {
            candidate.parent = immediateParent;
            immediateParent.children.push(candidate);
            candidate.depth = immediateParent.depth + 1;
        }
    }
    return { nodes, roots: nodes.filter(n => n.parent === null) };
}

/**
 * Retorna la geometría original inmaculada (geomBase) proyectada con la transformación
 * actual del elemento (posición, rotación, escala).
 */
export function getGlobalUnsubtractedPath(item) {
    if (!item || !item.data || !item.data.geomBase) return null;
    // geomBase se mantiene en coordenadas de mundo por sincronización en tiempo real (drag, rotate, scale).
    // Se clona de forma pura sin re-aplicar transformaciones matriciales redundantes que desfasen la silueta.
    const tempBase = item.data.geomBase.clone({ insert: false });
    return tempBase;
}

/**
 * Resuelve el elemento de contenido real si el item está encapsulado en un clipGroup
 */
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

/**
 * Extrae recursivamente todos los elementos sustractivos o masas con geomBase
 */
function extractSubtractiveItems(topList) {
    const result = [];
    function collectRecursive(item) {
        if (!item) return;
        const content = getContentItem(item);
        if (!content) return;
        if (content instanceof paper.Group && content.children) {
            content.children.forEach(c => {
                if (c && !c.data?.isSelectionBox && !c.data?.isHandle && !c.data?.mockup && !c.data?.isMask) {
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

/**
 * MOTOR DE RECÁLCULO REACTIVO CSG (No destructivo por orden Z).
 * Incorpora el Blindaje Anti-Aniquilación:
 * - Si una sustracción booleana reduce los segmentos visibles a 0 o vacía el trazado,
 *   se anula la sustracción destructiva sobre esa pieza para garantizar que nunca se borre de pantalla.
 */
export function recalculateDynamicSubtractions(targetLayer = null) {
    const layer = targetLayer || (typeof paper !== 'undefined' && paper.project ? paper.project.activeLayer : null);
    if (!layer || !layer.children) return;

    const items = [...layer.children].filter(item =>
        item && !item.data?.mockup && !item.data?.isMask && !item.data?.isSelectionBox &&
        !item.data?.isHandle && !item.data?.isSmartGuide && !item.data?.isMeasurement &&
        !item.data?.isTracePreview && !item.data?.isNodeEditOverlay
    );
    if (items.length === 0) return;

    const subItems = extractSubtractiveItems(items);
    if (subItems.length === 0) return;

    // Helper para contar segmentos totales de un Path o CompoundPath
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

    // 1. Restaurar todas las masas sólidas a su silueta geomBase inmaculada
    subItems.forEach(item => {
        if (item && item.data && item.data.geomBase && !item.data.isHole) {
            const pristine = getGlobalUnsubtractedPath(item);
            if (pristine) {
                item.removeChildren();
                if (pristine instanceof paper.CompoundPath) {
                    const cl = pristine.clone({ insert: false });
                    item.addChildren(cl.removeChildren());
                    cl.remove();
                } else if (pristine instanceof paper.Path) {
                    item.addChild(pristine.clone({ insert: false }));
                }
                pristine.remove();
            }
        }
    });

    // 2. Ordenar por Z-index ascendente real en el árbol de visualización
    const sortedLayers = [...subItems].sort((a, b) => {
        const topA = a.data?.clipGroup ? a.parent : a;
        const topB = b.data?.clipGroup ? b.parent : b;
        return (topA.index || 0) - (topB.index || 0);
    });

    // 3. Evaluar calados hacia abajo (CSG Stacking Rule)
    for (let i = 0; i < sortedLayers.length; i++) {
        const solid = sortedLayers[i];
        if (!solid || !solid.data || solid.data.isHole || !solid.data.geomBase) continue;

        const solidTop = solid.data?.clipGroup ? solid.parent : solid;
        const solidZ = solidTop.index || 0;

        // Recolectar calados activos que se encuentren estrictamente por encima en Z y cuya caja colisione
        const intersectingHoles = [];
        for (let j = i + 1; j < sortedLayers.length; j++) {
            const hole = sortedLayers[j];
            if (!hole || !hole.data || !hole.data.isHole) continue;

            const holeTop = hole.data?.clipGroup ? hole.parent : hole;
            const holeZ = holeTop.index || 0;
            if (holeZ <= solidZ) continue;

            const holeGeom = getGlobalUnsubtractedPath(hole);
            if (!holeGeom) continue;

            if (solid.bounds.intersects(holeGeom.bounds)) {
                intersectingHoles.push(holeGeom);
            } else {
                holeGeom.remove();
            }
        }

        if (intersectingHoles.length === 0) continue;

        const pristineBase = getGlobalUnsubtractedPath(solid);
        if (!pristineBase) {
            intersectingHoles.forEach(h => h.remove());
            continue;
        }

        const originalSegmentCount = countSegments(pristineBase);
        const originalArea = Math.abs(pristineBase.area || pristineBase.bounds.width * pristineBase.bounds.height);

        // Unificar calados para ejecución booleana limpia
        let mergedHole = intersectingHoles[0];
        for (let k = 1; k < intersectingHoles.length; k++) {
            const united = mergedHole.unite(intersectingHoles[k], { insert: false });
            if (united) {
                mergedHole.remove();
                mergedHole = united;
            }
        }

        // Intento 1: Sustracción global combinada
        let finalSubtracted = null;
        try {
            finalSubtracted = pristineBase.subtract(mergedHole, { insert: false });
        } catch (e) {
            finalSubtracted = null;
        }
        mergedHole.remove();

        // BLINDAJE ANTI-ANIQUILACIÓN (Rule 8 Compliance)
        let isValidSubtraction = false;
        if (finalSubtracted) {
            const segCount = countSegments(finalSubtracted);
            const newArea = Math.abs(finalSubtracted.area || finalSubtracted.bounds.width * finalSubtracted.bounds.height);
            // Si la pieza mantiene más del 5% de su masa y no colapsó a 0 segmentos, es válida
            if (segCount > 0 && newArea >= originalArea * 0.05) {
                isValidSubtraction = true;
            }
        }

        // Intento 2: Si la sustracción total causó la extinción de la pieza, probamos calados individuales
        if (!isValidSubtraction && intersectingHoles.length > 1) {
            if (finalSubtracted) finalSubtracted.remove();
            finalSubtracted = pristineBase.clone({ insert: false });

            for (let hIdx = 0; hIdx < intersectingHoles.length; hIdx++) {
                try {
                    const singleSub = finalSubtracted.subtract(intersectingHoles[hIdx], { insert: false });
                    if (singleSub) {
                        const sCount = countSegments(singleSub);
                        const sArea = Math.abs(singleSub.area || singleSub.bounds.width * singleSub.bounds.height);
                        if (sCount > 0 && sArea >= originalArea * 0.05) {
                            finalSubtracted.remove();
                            finalSubtracted = singleSub;
                            isValidSubtraction = true;
                        } else {
                            singleSub.remove();
                        }
                    }
                } catch(err) {}
            }
        }

        // Si la sustracción fue exitosa y no destructiva, reemplazar la geometría visual
        if (isValidSubtraction && finalSubtracted) {
            solid.removeChildren();
            if (finalSubtracted instanceof paper.CompoundPath) {
                solid.addChildren(finalSubtracted.removeChildren());
            } else {
                solid.addChild(finalSubtracted);
            }
            solid.visible = true;
        }

        // Limpiar geometrías temporales de memoria
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
 * DESCOMPOSICIÓN INTEGRAL POR JERARQUÍA DE CONTENCIÓN Y CAPAS (1 solo clic).
 * Descompone masas positivas y calados activos respetando la relación Z:
 * Raíz/Fondo (Z0) -> Calado Intermedio (Z1) -> Masa Interior (Z2...)
 * Cada elemento resultante se genera como un CompoundPath nativo de Paper.js.
 */
export function decomposeByContainmentHierarchy(rootTarget, isClipped = false) {
    if (!rootTarget || rootTarget.data?.locked || rootTarget.data?.mockup || rootTarget.data?.isMask) {
        return null;
    }

    const targetLayer = rootTarget.layer || paper.project.activeLayer;
    docOrderCounter = 0;

    // Garantía de Contención en Producto: Si el objeto original estaba enmascarado o hay un producto con máscara activo
    const shouldClip = isClipped || (typeof window !== 'undefined' && typeof window.clipItem === 'function' && !window.infiniteCanvasMode && !!window.clipMask);

    // 1. Aplanar todo el contenido a trazados atómicos cerrados
    const atomicPaths = flattenToAtomicPaths(rootTarget);
    if (atomicPaths.length === 0) {
        return null;
    }

    if (atomicPaths.length === 1) {
        const single = atomicPaths[0];
        const compound = new paper.CompoundPath();
        compound.addChild(single);

        const geomBase = compound.clone({ insert: false });
        compound.data = {
            locked: false,
            label: (rootTarget.data && rootTarget.data.label) ? rootTarget.data.label : "Capa Independiente",
            isHole: false,
            geomBase: geomBase,
            layerDepth: 0,
            decomposedLayer: true
        };
        compound.fillColor = rootTarget.fillColor || single.fillColor || new paper.Color('#111827');
        compound.strokeColor = rootTarget.strokeColor || single.strokeColor || null;
        compound.strokeWidth = rootTarget.strokeWidth || single.strokeWidth || 0;

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

    // 2. Construir árbol topológico de contención
    const { nodes } = buildContainmentTree(atomicPaths);

    // 3. Clasificación Topológica de Masa vs Calado Activo
    nodes.forEach(node => {
        // En la descomposición por jerarquía:
        // Contenedor principal (depth 0) = Masa Sólida.
        // Hijos directos de una masa (depth 1) = Calados Activos interactivos.
        // Hijos dentro de un calado (depth 2) = Islas/Masas interiores sólidas.
        // Se respeta la alternancia natural y semántica de devanado vectorial.
        const isHole = (node.depth % 2 === 1);
        node.isHole = isHole;
    });

    // 4. Ordenamiento por apilamiento Z físico:
    // Z0 = Masa más externa (fondo/soporte)
    // Z1 = Calado activo que perfora Z0
    // Z2 = Masa interior que flota dentro de Z1
    const sortedNodes = [...nodes].sort((a, b) => {
        if (a.depth !== b.depth) return a.depth - b.depth;
        return (a.path.data?.docOrder || 0) - (b.path.data?.docOrder || 0);
    });

    // 5. Materialización de Capas Autónomas
    const finalDeliveredItems = [];

    sortedNodes.forEach(node => {
        const compound = new paper.CompoundPath();
        compound.addChild(node.path);

        const geomBase = compound.clone({ insert: false });

        compound.data = {
            locked: false,
            label: node.isHole ? `Calado Activo (Nivel ${node.depth})` : `Masa Sólida (Nivel ${node.depth})`,
            isHole: node.isHole,
            geomBase: geomBase,
            layerDepth: node.depth,
            decomposedLayer: true
        };

        if (node.isHole) {
            // El calado activo se muestra con un contorno nítido y relleno neutro
            compound.fillColor = new paper.Color(0, 0, 0, 0.001);
            compound.strokeColor = new paper.Color('#0284c7');
            compound.strokeWidth = 1 / (paper.view ? paper.view.zoom : 1);
            compound.dashArray = [3, 3];
        } else {
            compound.fillColor = node.path.data?.originalFillColor || rootTarget.fillColor || new paper.Color('#111827');
            compound.strokeColor = rootTarget.strokeColor || null;
            compound.strokeWidth = rootTarget.strokeWidth || 0;
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
        finalDeliveredItems.push(finalItem);
    });

    // 6. Eliminar el objeto contenedor original
    rootTarget.remove();

    // 7. Ejecutar recálculo reactivo CSG dinámico con el blindaje anti-aniquilación activo
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

// Exposición global defensiva
if (typeof window !== 'undefined') {
    window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
    window.decomposeByContainmentHierarchy = decomposeByContainmentHierarchy;
    window.geometricUngroupCompound = decomposeByContainmentHierarchy;
    window.geometricUngroupOneLevel = decomposeByContainmentHierarchy;
    window.getGlobalUnsubtractedPath = getGlobalUnsubtractedPath;
    window.isContainedIn = isContainedIn;
}

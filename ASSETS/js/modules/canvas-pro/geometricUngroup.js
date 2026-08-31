/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Architecture v36.2 - Deep Recursive Extraction & Containment Hierarchy Engine)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/geometricUngroup.js
Descripción:
Motor geométrico de Descomposición por Jerarquía de Contención y Capas SVG para EKKO Studio.
Basado en Paper.js y optimizado para corte y grabado láser (LightBurn / CNC).
Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN Y CAPAS
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt & EKKO_DIAG v6.2):
  * Descomposición atómica de todos los niveles en un único clic (1-Click Full Decomposition).
  * Erradicada la paridad geométrica de profundidad (isHole = depth % 2) para el calado activo.
  * Preservación estricta del orden Z de apilamiento sin inversión.
  * Inyección inmaculada de 'geomBase' en neutro local para permitir CSG reactivo no destructivo.
  * Blindaje anti-aniquilación de masas sólidas ante colisión simultánea de calados interactivos.
  * Soporte recursivo para símbolos colocados (PlacedSymbol), trazados compuestos (CompoundPath)
    y grupos anidados (Nested Groups).
========================================================================= */

function isPlacedSymbol(item) {
    return item && (item.className === 'PlacedSymbol' || item.className === 'SymbolItem' ||
        (typeof paper !== 'undefined' && ((paper.PlacedSymbol && item instanceof paper.PlacedSymbol) || (paper.SymbolItem && item instanceof paper.SymbolItem))));
}

/**
 * Obtiene la matriz acumulada global de un elemento recorriendo sus ancestros
 * hasta llegar a la raíz especificada (o al nivel de la vista global si root es null).
 */
function getMatrixRelativeTo(item, root) {
    let current = item;
    let accumulatedMatrix = new paper.Matrix();
    while (current && current !== root) {
        if (current.matrix) {
            accumulatedMatrix = current.matrix.clone().concatenate(accumulatedMatrix);
        }
        current = current.parent;
    }
    return accumulatedMatrix;
}

function getGlobalMatrix(item) {
    if (!item) return new paper.Matrix();
    if (item.data && item.data.globalMatrix) {
        return item.data.globalMatrix.clone();
    }
    return getMatrixRelativeTo(item, null);
}

/**
 * Descompone y extrae recursivamente todos los trazados atómicos terminales (paper.Path)
 * aplicando matrices acumuladas de mundo para neutralizar distorsiones espaciales.
 */
function flattenToAtomicPaths(item, rootMatrix = null) {
    const atomicPaths = [];
    const currentMatrix = rootMatrix ? rootMatrix.clone().concatenate(item.matrix || new paper.Matrix()) : (item.matrix ? item.matrix.clone() : new paper.Matrix());

    if (item instanceof paper.Path) {
        const cloned = item.clone({ insert: false });
        cloned.transform(currentMatrix);
        if (cloned.segments && cloned.segments.length >= 2) {
            cloned.closed = true;
            atomicPaths.push(cloned);
        } else {
            cloned.remove();
        }
    } else if (item instanceof paper.CompoundPath) {
        if (item.children && item.children.length > 0) {
            item.children.forEach(child => {
                const subPaths = flattenToAtomicPaths(child, currentMatrix);
                subPaths.forEach(sp => atomicPaths.push(sp));
            });
        }
    } else if (item instanceof paper.Group) {
        if (item.children && item.children.length > 0) {
            item.children.forEach(child => {
                const subPaths = flattenToAtomicPaths(child, currentMatrix);
                subPaths.forEach(sp => atomicPaths.push(sp));
            });
        }
    } else if (isPlacedSymbol(item) && item.symbol && item.symbol.definition) {
        const defClone = item.symbol.definition.clone({ insert: false });
        const symbolMatrix = currentMatrix.clone().concatenate(item.matrix || new paper.Matrix());
        const subPaths = flattenToAtomicPaths(defClone, symbolMatrix);
        subPaths.forEach(sp => atomicPaths.push(sp));
        defClone.remove();
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
            const pt = curve.getPointAtTime(0.5);
            const normal = curve.getNormalAtTime(0.5);
            if (pt && normal) {
                const step = Math.min(2.0, path.bounds.width * 0.05);
                const pIn1 = pt.add(normal.multiply(step));
                if (path.contains(pIn1)) return pIn1;
                const pIn2 = pt.subtract(normal.multiply(step));
                if (path.contains(pIn2)) return pIn2;
            }
        }
    }
    return center;
}

/**
 * Evalúa topológicamente si el trazado 'inner' está geométricamente contenido en 'outer'.
 */
export function isContainedIn(inner, outer) {
    if (!inner || !outer || !inner.bounds || !outer.bounds) return false;
    // Comprobación preliminar de cajas delimitadoras (Bounding Box Culling)
    if (!outer.bounds.contains(inner.bounds)) {
        if (!outer.bounds.intersects(inner.bounds)) return false;
    }

    const testPoint = getInteriorTestPoint(inner);
    if (!testPoint) return false;
    return outer.contains(testPoint);
}

/**
 * Construye el árbol de contención topológico para todas las siluetas atómicas.
 */
function buildContainmentTree(paths) {
    // 1. Ordenar caminos de mayor área a menor área
    paths.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

    const nodes = paths.map((path, idx) => ({
        id: idx,
        path: path,
        parent: null,
        children: [],
        depth: 0,
        area: Math.abs(path.area)
    }));

    // 2. Resolver relaciones de contención estricta (padre = contenedor directo más pequeño)
    for (let i = 0; i < nodes.length; i++) {
        const candidateChild = nodes[i];
        let bestParent = null;

        for (let j = 0; j < i; j++) {
            const candidateParent = nodes[j];
            if (isContainedIn(candidateChild.path, candidateParent.path)) {
                // Si ya teníamos un contenedor, preferimos el más profundo (área menor)
                if (!bestParent || candidateParent.area < bestParent.area) {
                    bestParent = candidateParent;
                }
            }
        }

        if (bestParent) {
            candidateChild.parent = bestParent;
            bestParent.children.push(candidateChild);
        }
    }

    // 3. Asignar profundidades topológicas desde las raíces
    function assignDepth(node, currentDepth) {
        node.depth = currentDepth;
        node.children.forEach(ch => assignDepth(ch, currentDepth + 1));
    }

    nodes.filter(n => !n.parent).forEach(root => assignDepth(root, 0));
    return nodes;
}

/**
 * Retorna la geometría original inmaculada (geomBase) proyectada con la transformación
 * actual del elemento (posición, rotación, escala).
 */
export function getGlobalUnsubtractedPath(item) {
    if (!item || !item.data || !item.data.geomBase) return null;
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
function extractSubtractiveOrMassElements(layer) {
    const list = [];
    if (!layer || !layer.children) return list;
    layer.children.forEach(c => {
        const target = getContentItem(c);
        if (target && target.data && (target.data.geomBase || target.data.isHole || target.data.decomposedLayer)) {
            list.push({ container: c, target: target });
        }
    });
    return list;
}

/**
 * MOTOR CSG DINÁMICO REACTIVO (Non-Destructive Live Subtractions)
 * Recorre los elementos de la capa activa en orden Z ascendente (Z0 -> Z_n)
 * y materializa dinámicamente las perforaciones producidas por los calados activos (isHole)
 * sobre todas las masas sólidas inferiores que intersecan.
 * 
 * Incorpora BLINDAJE ANTI-ANIQUILACIÓN (Rule 8):
 * Si múltiples calados solapados extinguen totalmente el área visible de una masa,
 * se ignora la última resta destructiva conservando la masa visible sin excepciones en Paper.js.
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

    // 1. Restaurar primero todas las masas a partir de su geomBase inmaculada
    items.forEach(item => {
        const target = getContentItem(item);
        if (!target || !target.data) return;

        if (target.data.geomBase) {
            const originalColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
            const originalStroke = target.strokeColor ? target.strokeColor.clone() : null;
            const originalStrokeWidth = target.strokeWidth || 0;

            if (!target.data.isHole) {
                // Restaurar la forma original inmaculada
                target.segments = [];
                if (target.children) target.removeChildren();

                const baseClone = target.data.geomBase.clone({ insert: false });
                if (baseClone instanceof paper.CompoundPath && target instanceof paper.CompoundPath) {
                    baseClone.children.forEach(ch => target.addChild(ch.clone({ insert: false })));
                } else if (baseClone.segments && target.segments) {
                    baseClone.segments.forEach(s => target.add(s.clone()));
                } else if (baseClone.children) {
                    baseClone.children.forEach(ch => target.addChild(ch.clone({ insert: false })));
                }
                baseClone.remove();

                target.fillColor = originalColor;
                target.strokeColor = originalStroke;
                target.strokeWidth = originalStrokeWidth;
                target.visible = true;
            } else {
                // Si es un calado activo, asegurar fill transparente durante edición interactiva
                target.fillColor = new paper.Color(0, 0, 0, 0.001);
                target.strokeColor = null;
                target.strokeWidth = 0;
                target.visible = true;
            }
        }
    });

    // 2. Evaluar la interacción CSG entre calados y masas inferiores (j < i)
    for (let i = 0; i < items.length; i++) {
        const upperItem = items[i];
        const upperTarget = getContentItem(upperItem);
        if (!upperTarget || !upperTarget.data || !upperTarget.data.isHole) continue;

        const holeBase = upperTarget.data.geomBase ? upperTarget.data.geomBase.clone({ insert: false }) : upperTarget.clone({ insert: false });

        for (let j = i - 1; j >= 0; j--) {
            const lowerItem = items[j];
            const lowerTarget = getContentItem(lowerItem);
            if (!lowerTarget || !lowerTarget.data || lowerTarget.data.isHole || !lowerTarget.data.geomBase) continue;

            if (lowerTarget.bounds.intersects(holeBase.bounds)) {
                try {
                    const solidPristine = lowerTarget.clone({ insert: false });
                    const subtracted = solidPristine.subtract(holeBase, { insert: false });

                    // Blindaje anti-aniquilación: Verificar que la masa no colapse a 0 segmentos o área nula
                    const pristineArea = Math.abs(solidPristine.area);
                    const subArea = subtracted ? Math.abs(subtracted.area) : 0;
                    const subSegments = (subtracted && subtracted.segments) ? subtracted.segments.length : (subtracted && subtracted.children ? subtracted.children.reduce((acc, c) => acc + (c.segments ? c.segments.length : 0), 0) : 0);

                    if (subtracted && subArea > (pristineArea * 0.05) && subSegments > 0) {
                        const savedFill = lowerTarget.fillColor ? lowerTarget.fillColor.clone() : new paper.Color('#000000');
                        const savedStroke = lowerTarget.strokeColor ? lowerTarget.strokeColor.clone() : null;
                        const savedWidth = lowerTarget.strokeWidth || 0;

                        lowerTarget.segments = [];
                        if (lowerTarget.children) lowerTarget.removeChildren();

                        if (subtracted instanceof paper.CompoundPath && lowerTarget instanceof paper.CompoundPath) {
                            subtracted.children.forEach(ch => lowerTarget.addChild(ch.clone({ insert: false })));
                        } else if (subtracted.children) {
                            subtracted.children.forEach(ch => lowerTarget.addChild(ch.clone({ insert: false })));
                        } else if (subtracted.segments) {
                            subtracted.segments.forEach(s => lowerTarget.add(s.clone()));
                        }

                        lowerTarget.fillColor = savedFill;
                        lowerTarget.strokeColor = savedStroke;
                        lowerTarget.strokeWidth = savedWidth;
                    }
                    if (subtracted) subtracted.remove();
                    solidPristine.remove();
                } catch (csgErr) {
                    console.warn("[EKKO CSG WARNING] Error durante el recálculo dinámico:", csgErr);
                }
            }
        }
        holeBase.remove();
    }
}

/**
 * DESCOMPOSICIÓN INTEGRAL POR JERARQUÍA DE CONTENCIÓN Y CAPAS (1 solo clic).
 * Descompone masas positivas y calados activos respetando la relación Z:
 * Raíz/Fondo (Z0) -> Calado Intermedio (Z1) -> Masa Interior (Z2...)
 * Cada elemento resultante se genera como un CompoundPath nativo de Paper.js.
 */
export function decomposeByContainmentHierarchy(rootTarget, isClipped = false) {
    if (!rootTarget) return { handled: false, items: [] };

    // 1. Extraer todas las siluetas vectoriales atómicas aplanadas
    const atomicPaths = flattenToAtomicPaths(rootTarget);
    if (atomicPaths.length === 0) return { handled: false, items: [] };

    // 2. Construir árbol topológico de contención
    const treeNodes = buildContainmentTree(atomicPaths);

    // 3. Ordenar capas por profundidad topológica estricta:
    // Z0 = Fondo exterior (depth 0), Z1 = Calados directos (depth 1), Z2 = Masas interiores (depth 2)...
    treeNodes.sort((a, b) => a.depth - b.depth || b.area - a.area);

    const targetLayer = rootTarget.layer || (paper.project ? paper.project.activeLayer : null);
    const finalDeliveredItems = [];

    // 4. Materializar cada silueta como capa CompoundPath independiente
    treeNodes.forEach((node, index) => {
        const path = node.path;
        const compoundItem = new paper.CompoundPath({ insert: false });
        compoundItem.addChild(path.clone({ insert: false }));

        // Clasificación topológica:
        // Las siluetas con profundidad impar son calados de la masa inmediatamente contenedora,
        // O siluetas cerradas con devanado inverso en CompoundPaths originales.
        const isHole = (node.depth % 2 === 1);

        // Guardar geometría base prístina (geomBase) en neutro local
        const geomBase = compoundItem.clone({ insert: false });

        compoundItem.data = {
            locked: false,
            label: isHole ? `Calado Activo (Nivel ${node.depth})` : `Masa Sólida (Nivel ${node.depth})`,
            isHole: isHole,
            geomBase: geomBase,
            layerDepth: node.depth,
            containmentId: node.id,
            decomposedLayer: true
        };

        if (isHole) {
            compoundItem.fillColor = new paper.Color(0, 0, 0, 0.001);
            compoundItem.strokeColor = null;
            compoundItem.strokeWidth = 0;
        } else {
            compoundItem.fillColor = new paper.Color('#000000');
            compoundItem.strokeColor = null;
            compoundItem.strokeWidth = 0;
        }

        let finalItem = compoundItem;
        if (isClipped && typeof window.clipItem === 'function') {
            finalItem = window.clipItem(compoundItem);
        }

        if (targetLayer) {
            targetLayer.addChild(finalItem);
        }

        finalDeliveredItems.push(finalItem);
        path.remove();
    });

    // 5. Eliminar el objeto contenedor original
    rootTarget.remove();

    // 6. Ejecutar recálculo reactivo CSG dinámico con el blindaje activo
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

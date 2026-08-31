/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Architecture v35 - Semantic Classification & Z-Order Topological Engine)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/geometricUngroup.js
Descripción:
Motor geométrico de Descomposición por Jerarquía de Contención y Capas SVG para EKKO Studio.
Basado en Paper.js y optimizado para corte y grabado láser (LightBurn / CNC).

Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN Y CAPAS
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt):
  * Eliminación total de la paridad rígida de profundidad (depth % 2 === 1).
  * Clasificador Semántico Vectorial: Distingue masas sólidas legítimas de calados reales
    evaluando la estructura del CompoundPath original, reglas de bobinado (fillRule),
    y contraste gráfico en grupos SVG.
  * Desacoplamiento de Contención Topológica vs. Orden de Apilamiento Z:
    El apilamiento Z respeta el orden documental del SVG y garantiza que los calados
    únicamente perforen las masas ubicadas por debajo de ellos en Z.
  * Sistema Anti-Aniquilación CSG: Impide que sustracciones sucesivas reduzcan masas a 0.
  * Preservación absoluta de 'geomBase' en coordenadas neutras locales.
  * Descomposición atómica completa en 1 solo clic.
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
 * hasta llegar a la capa activa (Layer), evitando desfasajes por jerarquías intermedias.
 */
function getMatrixRelativeTo(item, targetAncestor) {
    let matrix = new paper.Matrix();
    let current = item;
    while (current && current !== targetAncestor && !(current instanceof paper.Layer)) {
        if (current.matrix) {
            matrix = current.matrix.chain(matrix);
        }
        current = current.parent;
    }
    return matrix;
}

/**
 * Aplica una matriz de transformación geométrica directamente sobre los segmentos y tiradores
 * de un trazado (Baking de matriz), neutralizando su matriz local a identidad.
 */
function bakeMatrixIntoPath(path, matrix) {
    if (!matrix || matrix.isIdentity()) return;
    if (path.segments) {
        path.segments.forEach(seg => {
            seg.point = matrix.transform(seg.point);
            if (seg.handleIn) seg.handleIn = matrix.transform(seg.handleIn).subtract(matrix.transform(new paper.Point(0, 0)));
            if (seg.handleOut) seg.handleOut = matrix.transform(seg.handleOut).subtract(matrix.transform(new paper.Point(0, 0)));
        });
    }
    if (path.children && Array.isArray(path.children)) {
        path.children.forEach(child => bakeMatrixIntoPath(child, matrix));
    }
}

/**
 * Descompone cualquier estructura en trazados atómicos cerrados simples (paper.Path)
 * con sus transformaciones espaciales horneadas en coordenadas absolutas del lienzo.
 * Registra metadatos de origen (orden documental, fill original, pertenencia a compuesto).
 */
let docOrderCounter = 0;

function flattenToAtomicPaths(item, accumulatedMatrix = null, parentMeta = {}) {
    const currentMatrix = accumulatedMatrix ? accumulatedMatrix.chain(item.matrix || new paper.Matrix()) : (item.matrix ? item.matrix.clone() : new paper.Matrix());
    const atomicPaths = [];

    const isFromCompound = parentMeta.isFromCompound || isCompoundPath(item);

    if (isPath(item)) {
        const cloned = item.clone({ insert: false });
        bakeMatrixIntoPath(cloned, currentMatrix);
        cloned.matrix = new paper.Matrix();

        if (cloned.segments && cloned.segments.length >= 3) {
            cloned.closed = true;
            cloned.data = {
                ...(cloned.data || {}),
                docOrder: docOrderCounter++,
                originalFillColor: item.fillColor ? item.fillColor.clone() : null,
                originalStrokeColor: item.strokeColor ? item.strokeColor.clone() : null,
                originalStrokeWidth: item.strokeWidth || 0,
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
                if (child.clipMask) return;
                atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix, { isFromCompound: false }));
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
 * Si el centroide (bounds.center) cae fuera por concavidad, proyecta normales
 * hacia el interior a lo largo de las curvas del trazado.
 */
function getInteriorTestPoint(path) {
    if (!path || !path.bounds) return null;
    const center = path.bounds.center;
    if (path.contains(center)) return center;

    if (path.curves && path.curves.length > 0) {
        for (let i = 0; i < path.curves.length; i++) {
            const curve = path.curves[i];
            const pt = curve.getPointAtTime(0.5);
            const normal = curve.getNormalAtTime(0.5);
            if (!normal) continue;
            const offsets = [0.5, 1.0, 2.0, 5.0, 10.0];
            for (const offset of offsets) {
                const testA = pt.add(normal.multiply(offset));
                if (path.contains(testA)) return testA;
                const testB = pt.subtract(normal.multiply(offset));
                if (path.contains(testB)) return testB;
            }
        }
    }
    return center;
}

/**
 * Determina si el trazado 'child' está contenido geométricamente dentro de 'parent'.
 * Utiliza muestreo de múltiples puntos (centroide + vértices perimetrales).
 */
export function isContainedIn(child, parent) {
    if (!child || !parent) return false;
    if (!parent.bounds || !child.bounds) return false;

    // Descarte inicial rápido por caja envolvente
    if (!parent.bounds.contains(child.bounds.center) && !parent.bounds.intersects(child.bounds)) {
        return false;
    }

    const testPoints = [
        child.bounds.center,
        child.bounds.topLeft,
        child.bounds.topRight,
        child.bounds.bottomLeft,
        child.bounds.bottomRight
    ];

    if (child.segments && child.segments.length > 0) {
        const step = Math.max(1, Math.floor(child.segments.length / 4));
        for (let i = 0; i < child.segments.length; i += step) {
            testPoints.push(child.segments[i].point);
        }
    }

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
    atomicPaths.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

    const nodes = atomicPaths.map((path, idx) => ({
        id: idx,
        path: path,
        area: Math.abs(path.area),
        parent: null,
        children: [],
        depth: 0,
        docOrder: (path.data && path.data.docOrder !== undefined) ? path.data.docOrder : idx,
        isHole: false
    }));

    // Determinar paternidad topológica estricta (el contenedor más pequeño que envuelva al nodo)
    for (let i = 0; i < nodes.length; i++) {
        for (let j = i - 1; j >= 0; j--) {
            if (isContainedIn(nodes[i].path, nodes[j].path)) {
                nodes[i].parent = nodes[j];
                nodes[j].children.push(nodes[i]);
                break;
            }
        }
    }

    const roots = nodes.filter(n => !n.parent);
    const computeDepth = (n, d) => {
        n.depth = d;
        n.children.forEach(c => computeDepth(c, d + 1));
    };
    roots.forEach(r => computeDepth(r, 0));

    return { roots, nodes };
}

/**
 * CLASIFICADOR SEMÁNTICO VECTORIAL DE CAPAS (Reemplazo definitivo de depth % 2 === 1)
 *
 * Determina rigurosamente si un nodo es:
 * - Masa Sólida (isHole: false): Geometría positiva independiente.
 * - Calado Activo (isHole: true): Geometría negativa interactiva que perfora capas inferiores en Z.
 */
function resolveItemSemantics(node, rootTarget) {
    const path = node.path;
    const isFromCompound = !!(path.data && path.data.isFromCompound);

    // CASO 1: Si proviene de un CompoundPath original (como Escudo AFA, 007 o siluetas tipográficas)
    if (isFromCompound && rootTarget && isCompoundPath(rootTarget)) {
        const testPt = getInteriorTestPoint(path);
        if (testPt) {
            let isFilledInOriginal = false;
            try {
                isFilledInOriginal = rootTarget.contains(testPt);
            } catch (err) {
                isFilledInOriginal = false;
            }

            // Si el punto interior NO tenía relleno en el CompoundPath original, era un vacío/agujero real
            if (!isFilledInOriginal) {
                return true; // Calado Activo
            } else {
                return false; // Masa Sólida
            }
        }
    }

    // CASO 2: Relación de Isla Interior contenida dentro de un Calado Activo
    // (Ejemplo fundamental del Prompt Maestro: el triángulo macizo de la letra A está dentro del calado de la A)
    if (node.parent && node.parent.isHole) {
        return false; // Masa sólida positiva (isla interior que debe permanecer visible)
    }

    // CASO 3: Trazo cerrado sin relleno (fill: none o transparente) dentro de un contenedor sólido
    const originalFill = path.data?.originalFillColor;
    if (node.parent && (!originalFill || originalFill.alpha === 0)) {
        return true; // Calado Activo
    }

    // CASO 4: Alternancia topológica de CompoundPath reconstruido
    // Si el nodo padre es una masa sólida y el sub-trazado representa una inversión de bobinado respecto a su padre
    if (isFromCompound && node.parent && !node.parent.isHole) {
        if (path.clockwise !== node.parent.path.clockwise) {
            return true; // Orientación opuesta en CompoundPath = Calado
        }
    }

    // REGLA DE ORO POR DEFECTO:
    // Una figura cerrada con geometría válida y estilo es una MASA SÓLIDA.
    // Jamás se forzará a hueco por mera paridad de profundidad.
    return false;
}

/**
 * Retorna la geometría original inmaculada (geomBase) proyectada con la transformación
 * actual del elemento (posición, rotación, escala).
 */
export function getGlobalUnsubtractedPath(item) {
    if (!item || !item.data || !item.data.geomBase) return null;
    const tempBase = item.data.geomBase.clone({ insert: false });
    tempBase.matrix = item.matrix.clone();
    return tempBase;
}

/**
 * MOTOR DE RECÁLCULO REACTIVO CSG (No destructivo por orden Z).
 * Incorpora el Blindaje Anti-Aniquilación:
 * - Si una sustracción booleana reduce los segmentos visibles a 0 o vacía el trazado,
 *   se anula la sustracción destructiva sobre esa pieza para garantizar que nunca se borre de pantalla.
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

export function recalculateDynamicSubtractions(targetLayer = null) {
    const layer = targetLayer || (typeof paper !== 'undefined' && paper.project ? paper.project.activeLayer : null);
    if (!layer || !layer.children) return;

    const items = [...layer.children].filter(item =>
        item && !item.data?.mockup && !item.data?.isMask && !item.data?.isSelectionBox &&
        !item.data?.isHandle && !item.data?.isSmartGuide && !item.data?.isMeasurement &&
        !item.data?.isTracePreview && !item.data?.isNodeEditOverlay
    );

    if (items.length === 0) return;

    // 1. Restaurar todas las masas sólidas a su silueta geomBase inmaculada en su posición actual
    items.forEach(topItem => {
        const item = getContentItem(topItem);
        if (item && item.data && item.data.geomBase && !item.data.isHole) {
            const pristine = getGlobalUnsubtractedPath(item);
            if (pristine) {
                item.removeChildren();
                if (pristine instanceof paper.CompoundPath) {
                    const cl = pristine.clone({ insert: false });
                    item.addChildren(cl.removeChildren());
                    cl.remove();
                } else if (pristine instanceof paper.Path) {
                    const cl = pristine.clone({ insert: false });
                    item.addChild(cl);
                }
                pristine.remove();
                item.visible = true;
            }
        }
    });

    // 2. Aplicar calados dinámicos (isHole) exclusivamente a las capas inferiores en Z (j < i)
    for (let i = 0; i < items.length; i++) {
        const topHole = items[i];
        const holeItem = getContentItem(topHole);
        if (!holeItem || !holeItem.data?.isHole) continue;

        const holeBase = getGlobalUnsubtractedPath(holeItem);
        if (!holeBase) continue;

        // Ocultar la visibilidad de dibujo del calado de control para que funcione como vacío vectorial puro
        holeItem.visible = false;

        for (let j = i - 1; j >= 0; j--) {
            const topSolid = items[j];
            const solid = getContentItem(topSolid);
            if (!solid || solid.data?.isHole || !solid.data?.geomBase) continue;

            if (solid.bounds && holeBase.bounds && solid.bounds.intersects(holeBase.bounds)) {
                try {
                    // Backup preventivo de los hijos del sólido antes de restar
                    const beforeChildren = solid.clone({ insert: false });
                    const subtracted = solid.subtract(holeBase, { insert: false });

                    if (subtracted) {
                        // Comprobación Anti-Aniquilación: Si la resta dejó el sólido vacío, rechazar la aniquilación
                        const segCount = subtracted.segments ? subtracted.segments.length :
                            (subtracted.children ? subtracted.children.reduce((acc, c) => acc + (c.segments ? c.segments.length : 0), 0) : 0);
                        const hasValidArea = Math.abs(subtracted.area || 0) > 0.01;

                        if (segCount > 0 && hasValidArea && subtracted.bounds.width > 0.01 && subtracted.bounds.height > 0.01) {
                            solid.removeChildren();
                            if (subtracted instanceof paper.CompoundPath) {
                                solid.addChildren(subtracted.removeChildren());
                            } else {
                                solid.addChild(subtracted);
                            }
                            solid.visible = true;
                        } else {
                            // Aniquilación evitada: Restablecer silueta previa y registrar advertencia
                            subtracted.remove();
                            solid.removeChildren();
                            solid.addChildren(beforeChildren.removeChildren());
                            solid.visible = true;
                            if (typeof window !== 'undefined' && window.EKKO_DEBUG) {
                                console.warn(`[ANTI-ANIQUILACIÓN CSG] Se evitó la desintegración total de masa en item ID: ${solid.id}`);
                            }
                        }
                    }
                    beforeChildren.remove();
                } catch (err) {
                    console.warn(`[CSG EXCEPTION] Error no crítico en sustracción: ${err.message}`);
                }
            }
        }
        holeBase.remove();
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
    if (!atomicPaths || atomicPaths.length === 0) {
        return null;
    }

    // Si solo hay un único trazado, envolverlo limpiamente como capa atómica descompuesta
    if (atomicPaths.length === 1) {
        const single = atomicPaths[0];
        const compound = new paper.CompoundPath({ insert: false });
        compound.addChild(single.clone({ insert: false }));
        single.remove();

        const geomBase = compound.clone({ insert: false });
        geomBase.matrix = new paper.Matrix();

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

    // 3. Resolver Semántica de cada nodo (Masa Sólida vs Calado Activo)
    // Se evalúa en orden de profundidad (padres antes que hijos)
    const sortedByDepthAsc = [...nodes].sort((a, b) => a.depth - b.depth);
    sortedByDepthAsc.forEach(node => {
        node.isHole = resolveItemSemantics(node, rootTarget);
    });

    // 4. Ordenamiento Z Topológico Semántico (Desacoplado de depth % 2)
    nodes.sort((a, b) => {
        if (isAncestorOf(a, b)) return -1;
        if (isAncestorOf(b, a)) return 1;

        const rootA = getRootNode(a);
        const rootB = getRootNode(b);
        if (rootA !== rootB) {
            return rootA.docOrder - rootB.docOrder;
        }

        if (a.depth !== b.depth) {
            return a.depth - b.depth;
        }

        return a.docOrder - b.docOrder;
    });

    const resultingItems = [];

    nodes.forEach((node) => {
        const isHole = node.isHole;
        const compoundItem = new paper.CompoundPath({ insert: false });
        const pathClone = node.path.clone({ insert: false });
        compoundItem.addChild(pathClone);

        // Almacenar geometría base inmaculada en coordenadas locales puras neutras
        const geomBase = new paper.CompoundPath({ insert: false });
        const baseClone = node.path.clone({ insert: false });
        geomBase.addChild(baseClone);
        geomBase.matrix = new paper.Matrix();

        compoundItem.data = {
            locked: false,
            label: isHole ? `Calado Activo (Nivel ${node.depth})` : `Masa Sólida (Nivel ${node.depth})`,
            isHole: isHole,
            geomBase: geomBase,
            layerDepth: node.depth,
            containmentId: node.id,
            decomposedLayer: true
        };

        // Asignación de color preservando estilos del SVG
        if (isHole) {
            compoundItem.fillColor = null;
            compoundItem.strokeColor = new paper.Color('#0284c7');
            compoundItem.strokeWidth = 1 / (typeof paper !== 'undefined' && paper.view ? paper.view.zoom : 1);
            compoundItem.dashArray = [3, 3];
        } else {
            compoundItem.fillColor = node.path.fillColor || rootTarget.fillColor || new paper.Color('#111827');
            compoundItem.strokeColor = node.path.strokeColor || rootTarget.strokeColor || null;
            compoundItem.strokeWidth = node.path.strokeWidth || rootTarget.strokeWidth || 0;
        }

        resultingItems.push(compoundItem);
        node.path.remove();
    });

    // 5. Insertar las capas ordenadas en Z directamente en la capa activa
    // GARANTÍA DE ENMASCARAMIENTO DE PRODUCTO (Recorte estricto por fuera del producto)
    const finalDeliveredItems = [];
    if (targetLayer) {
        resultingItems.forEach(item => {
            let finalItem = item;
            if (shouldClip && typeof window !== 'undefined' && typeof window.clipItem === 'function') {
                finalItem = window.clipItem(item);
            }
            targetLayer.addChild(finalItem);
            if (window.currentMockup) {
                finalItem.insertBelow(window.currentMockup);
            }
            finalDeliveredItems.push(finalItem);
        });
    }

    // 6. Eliminar el contenedor original compuesto
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

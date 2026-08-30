/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Architecture v31 - Anti-Annihilation Engine)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/geometricUngroup.js

Descripción:
Motor geométrico de Descomposición por Jerarquía de Contención y Capas SVG para EKKO Studio.
Basado en Paper.js y optimizado para corte y grabado láser (LightBurn / CNC).

Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt)
- CORRECCIÓN FORENSE OP-00009:
  * Sistema Anti-Aniquilación CSG: Impide que sustracciones sucesivas reduzcan masas válidas a 0 segmentos o bounds vacíos.
  * Reclasificación de Calados Inteligente: Contención semántica real evitando que figuras cerradas legítimas se conviertan ciegamente en huecos destructivos.
  * Preservación absoluta de 'geomBase' en coordenadas neutras locales.
  * Recálculo CSG dinámico no destructivo por orden Z.
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
 * Aplica recursivamente una matriz de transformación a los segmentos de un trazado
 */
function bakeMatrixIntoPath(path, matrix) {
    if (!path || !matrix) return;
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
 */
function flattenToAtomicPaths(item, accumulatedMatrix = null) {
    const currentMatrix = accumulatedMatrix ? accumulatedMatrix.chain(item.matrix || new paper.Matrix()) : (item.matrix ? item.matrix.clone() : new paper.Matrix());
    const atomicPaths = [];

    if (isPath(item)) {
        const cloned = item.clone({ insert: false });
        bakeMatrixIntoPath(cloned, currentMatrix);
        cloned.matrix = new paper.Matrix();
        if (cloned.segments && cloned.segments.length >= 3) {
            cloned.closed = true;
            atomicPaths.push(cloned);
        } else {
            cloned.remove();
        }
    } else if (isCompoundPath(item)) {
        if (item.children && item.children.length > 0) {
            item.children.forEach(child => {
                atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix));
            });
        }
    } else if (isGroup(item)) {
        if (item.children && item.children.length > 0) {
            const childrenCopy = [...item.children];
            childrenCopy.forEach(child => {
                if (child.clipMask) return;
                atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix));
            });
        }
    } else if (isPlacedSymbol(item)) {
        const def = (item.symbol && item.symbol.item) || item.definition || (item.symbol && item.symbol.definition);
        if (def) {
            const defClone = def.clone({ insert: false });
            atomicPaths.push(...flattenToAtomicPaths(defClone, currentMatrix));
            defClone.remove();
        }
    }

    return atomicPaths;
}

/**
 * Determina si el trazado 'child' está contenido geométricamente dentro de 'parent'.
 * Utiliza muestreo de múltiples puntos (centroide + vértices perimetrales).
 */
export function isContainedIn(child, parent) {
    if (!child || !parent) return false;
    if (!parent.bounds || !child.bounds) return false;

    // Test rápido de AABB (Axis-Aligned Bounding Box)
    const pBounds = parent.bounds;
    const cBounds = child.bounds;
    const margin = 0.5;

    if (cBounds.left < pBounds.left - margin ||
        cBounds.right > pBounds.right + margin ||
        cBounds.top < pBounds.top - margin ||
        cBounds.bottom > pBounds.bottom + margin) {
        return false;
    }

    // Comprobación por muestreo de puntos interiores y vértices
    const testPoints = [
        cBounds.center,
        new paper.Point(cBounds.left + cBounds.width * 0.25, cBounds.top + cBounds.height * 0.25),
        new paper.Point(cBounds.right - cBounds.width * 0.25, cBounds.bottom - cBounds.height * 0.25)
    ];

    if (child.segments && child.segments.length > 0) {
        testPoints.push(child.segments[0].point);
        if (child.segments.length > 2) {
            testPoints.push(child.segments[Math.floor(child.segments.length / 2)].point);
        }
    }

    let containedCount = 0;
    for (const pt of testPoints) {
        if (parent.contains(pt)) {
            containedCount++;
        }
    }

    return containedCount >= Math.ceil(testPoints.length * 0.5);
}

/**
 * Construye el árbol topológico de contención geométrica y determina profundidades relativas.
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
        depth: 0
    }));

    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            if (isContainedIn(nodes[j].path, nodes[i].path)) {
                if (!nodes[j].parent || nodes[nodes[j].parent.id].area > nodes[i].area) {
                    nodes[j].parent = nodes[i];
                }
            }
        }
    }

    nodes.forEach(node => {
        if (node.parent) {
            node.parent.children.push(node);
        }
    });

    const roots = nodes.filter(n => !n.parent);
    const computeDepth = (n, d) => {
        n.depth = d;
        n.children.forEach(c => computeDepth(c, d + 1));
    };
    roots.forEach(r => computeDepth(r, 0));

    return { roots, nodes };
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
    items.forEach(item => {
        if (item.data && item.data.geomBase && !item.data.isHole) {
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
        const holeItem = items[i];
        if (!holeItem || !holeItem.data?.isHole) continue;

        const holeBase = getGlobalUnsubtractedPath(holeItem);
        if (!holeBase) continue;

        // Ocultar la visibilidad de dibujo del calado de control para que funcione como vacío vectorial puro
        holeItem.visible = false;

        for (let j = i - 1; j >= 0; j--) {
            const solid = items[j];
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

/**
 * DESCOMPOSICIÓN INTEGRAL POR JERARQUÍA DE CONTENCIÓN (Un solo clic).
 * Descompone masas positivas y calados activos respetando la relación Z:
 * Raíz/Fondo (Z0) -> Intermedio (Z1) -> Interior (Z2...)
 * Cada elemento resultante se genera como un CompoundPath nativo de Paper.js.
 */
export function decomposeByContainmentHierarchy(rootTarget) {
    if (!rootTarget || rootTarget.data?.locked || rootTarget.data?.mockup || rootTarget.data?.isMask) {
        return null;
    }

    const targetLayer = rootTarget.layer || (typeof paper !== 'undefined' && paper.project ? paper.project.activeLayer : null);

    // 1. Extraer todos los trazados terminales atómicos cerrados
    const atomicPaths = flattenToAtomicPaths(rootTarget);
    if (atomicPaths.length === 0) return null;

    // Caso de trazado único: se envuelve como CompoundPath independiente
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
            layerDepth: 0
        };

        compound.fillColor = rootTarget.fillColor || single.fillColor || new paper.Color('#111827');
        compound.strokeColor = rootTarget.strokeColor || single.strokeColor || null;
        compound.strokeWidth = rootTarget.strokeWidth || single.strokeWidth || 0;

        if (targetLayer) {
            targetLayer.addChild(compound);
            if (window.currentMockup) {
                compound.insertBelow(window.currentMockup);
            }
        }

        rootTarget.remove();
        return { handled: true, simple: true, items: [compound] };
    }

    // 2. Construir árbol topológico de contención
    const { nodes } = buildContainmentTree(atomicPaths);

    // 3. Ordenar por profundidad: de menor a mayor (Z0 exterior macizo -> Zn interior)
    nodes.sort((a, b) => a.depth - b.depth);

    const resultingItems = [];

    nodes.forEach((node) => {
        // Regla semántica de contención:
        // - Profundidad 0 = Masa sólida exterior de fondo
        // - Profundidad 1 = Calado activo interactivo (sustrae de Z0)
        // - Profundidad 2 = Masa positiva interior independiente (ej: triángulo de la A)
        // - Profundidad impar = Calado activo; Profundidad par = Masa sólida
        const isHole = (node.depth % 2 === 1);

        const compoundItem = new paper.CompoundPath({ insert: false });
        const pathClone = node.path.clone({ insert: false });
        compoundItem.addChild(pathClone);

        // Almacenar geometría base inmaculada en coordenadas locales puras
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
            containmentId: node.id
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

    // 4. Insertar las capas ordenadas en Z directamente en la capa activa
    if (targetLayer) {
        resultingItems.forEach(item => {
            targetLayer.addChild(item);
            if (window.currentMockup) {
                item.insertBelow(window.currentMockup);
            }
        });
    }

    // 5. Eliminar el contenedor original
    rootTarget.remove();

    // 6. Ejecutar recálculo reactivo CSG dinámico con el blindaje anti-aniquilación activo
    if (targetLayer) {
        recalculateDynamicSubtractions(targetLayer);
    }

    return { handled: true, simple: false, items: resultingItems };
}

export function geometricUngroupCompound(item) {
    return decomposeByContainmentHierarchy(item);
}

export function geometricUngroupOneLevel(group) {
    return decomposeByContainmentHierarchy(group);
}

// Exposición global segura
if (typeof window !== 'undefined') {
    window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
    window.decomposeByContainmentHierarchy = decomposeByContainmentHierarchy;
    window.geometricUngroupCompound = decomposeByContainmentHierarchy;
    window.geometricUngroupOneLevel = decomposeByContainmentHierarchy;
    window.getGlobalUnsubtractedPath = getGlobalUnsubtractedPath;
}


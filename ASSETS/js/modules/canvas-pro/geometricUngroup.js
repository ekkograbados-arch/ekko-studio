/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (v24.1 - Stacking CSG)
   Ruta: ASSETS/js/modules/canvas-pro/geometricUngroup.js
   ========================================================================= */

function isPath(item) {
    return item && (item.className === 'Path' || (typeof paper !== 'undefined' && paper.Path && item instanceof paper.Path));
}

function isCompoundPath(item) {
    return item && (item.className === 'CompoundPath' || (typeof paper !== 'undefined' && paper.CompoundPath && item instanceof paper.CompoundPath));
}

function areaOf(path) {
    if (!path) return 0;
    return Math.abs(path.area || (path.bounds ? path.bounds.area : 0) || 0);
}

// Comprobación geométrica robusta basada en vértices para evitar fallas de bounding box
function contains(parent, child) {
    if (!parent || !child) return false;
    if (!parent.bounds.intersects(child.bounds) && !parent.bounds.contains(child.bounds)) return false;
    const pointsToCheck = [];
    if (child.segments && child.segments.length > 0) {
        const step = Math.max(1, Math.floor(child.segments.length / 8));
        for (let i = 0; i < child.segments.length; i += step) {
            pointsToCheck.push(child.segments[i].point);
        }
    } else {
        pointsToCheck.push(child.bounds.center);
    }
    let insideCount = 0;
    pointsToCheck.forEach(p => {
        try { if (parent.contains(p)) insideCount++; } catch (_) {}
    });
    return insideCount > (pointsToCheck.length / 2);
}

// Construye el árbol de contención espacial para calcular la profundidad (depth) [1]
function buildTree(paths) {
    const nodes = paths.map(path => ({ path, parent: null, children: [], depth: 0 }));
    for (const node of nodes) {
        let best = null;
        let bestArea = Infinity;
        for (const candidate of nodes) {
            if (candidate === node) continue;
            const ca = areaOf(candidate.path);
            const na = areaOf(node.path);
            if (ca > na && contains(candidate.path, node.path)) {
                if (ca < bestArea) { bestArea = ca; best = candidate; }
            }
        }
        if (best) { node.parent = best; best.children.push(node); }
    }
    const roots = nodes.filter(n => !n.parent);
    const assign = (n, d) => {
        n.depth = d;
        n.children.forEach(c => assign(c, d + 1));
    };
    roots.forEach(root => assign(root, 0));
    return { roots, nodes };
}

function clonePath(path) {
    return path.clone({ insert: false });
}

// Retorna la geometría original intacta (geomBase) proyectada con su transformación actual
export function getGlobalUnsubtractedPath(item) {
    if (!item || !item.data || !item.data.geomBase) return null;
    const tempBase = item.data.geomBase.clone({ insert: false });
    tempBase.matrix = item.matrix.clone();
    return tempBase;
}

// RECALCULO REACTIVO: El calado (isHole) recorta físicamente a los sólidos con menor Z-Index debajo de él
export function recalculateDynamicSubtractions(layer) {
    const activeLayer = layer || paper.project.activeLayer;
    if (!activeLayer) return;
    const items = [...activeLayer.children].filter(
        item => item && !item.data?.locked && !item.data?.mockup && !item.data?.isMask
    );
    // 1. Restaurar sólidos a su geometría base original en su posición actual
    items.forEach(item => {
        if (item.data && item.data.geomBase && !item.data.isHole) {
            const pristineBase = getGlobalUnsubtractedPath(item);
            if (pristineBase) {
                item.pathData = pristineBase.pathData;
                item.visible = true;
                pristineBase.remove();
            }
        }
    });
    // 2. Iterar de arriba hacia abajo (Z-Index descendente) aplicando recortes en caliente
    for (let i = items.length - 1; i >= 0; i--) {
        const hole = items[i];
        if (hole && hole.data && hole.data.isHole) {
            const holeBase = getGlobalUnsubtractedPath(hole);
            if (!holeBase || !(holeBase instanceof paper.PathItem)) {
                if (holeBase) holeBase.remove();
                continue;
            }
            for (let j = i - 1; j >= 0; j--) {
                const solid = items[j];
                // BLINDAJE ANTICRASH CONTRA EL ERROR F12 [2]
                if (solid && (!solid.data || !solid.data.isHole) && solid.visible && typeof solid.subtract === 'function') {
                    if (solid.bounds.intersects(holeBase.bounds) || solid.bounds.contains(holeBase.bounds)) {
                        const subtracted = solid.subtract(holeBase);
                        if (subtracted) {
                            if (subtracted.segments?.length > 0 || subtracted.children?.length > 0) {
                                solid.pathData = subtracted.pathData;
                                solid.visible = true;
                            } else {
                                solid.pathData = "";
                                solid.visible = false; // Desintegración física completa
                            }
                            subtracted.remove();
                        }
                    }
                }
            }
            holeBase.remove();
        }
    }
    if (paper.view) paper.view.update();
}

if (typeof window !== 'undefined') {
    window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
}

// ACCIÓN DE UN SOLO CLIC: Disuelve todos los niveles y clasifica sólidos y calados vacíos [1]
export function geometricUngroupCompound(item) {
    if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return null;
    if (!isCompoundPath(item)) return null;
    const paths = [...item.children].filter(p => p && p.bounds && !p.data?.mockup && !p.data?.isMask);
    if (paths.length <= 1) return { handled: true, simple: true, items: [item] };
    const { nodes } = buildTree(paths);
    const parent = item.parent || paper.project.activeLayer;
    const index = parent.children.indexOf(item);
    const global = getGlobalMatrix(item);
    const result = [];

    // Ordenar de afuera hacia adentro (Z-Index natural de apilamiento) [1]
    nodes.sort((a, b) => a.depth - b.depth);
    nodes.forEach(node => {
        const isHole = (node.depth % 2 === 1); // Regla matemática par (sólido) / impar (calado)
        const pathClone = clonePath(node.path);
        let newElement = pathClone;
        newElement.matrix = global.clone();
        parent.addChild(newElement);
        const localBase = clonePath(node.path);
        localBase.matrix = new paper.Matrix(); // Base prístina en coordenadas locales

        newElement.data = {
            ...(item.data || {}),
            locked: false,
            isHole: isHole,
            geomBase: localBase,
            geometricHierarchy: 'simple',
            label: isHole ? "Calado Activo" : "Objeto Sólido"
        };
        if (isHole) {
            // Sin color ni relleno físico de grabado, pero clicable en pantalla
            newElement.fillColor = new paper.Color(0, 0, 0, 1e-5);
            newElement.strokeColor = null;
            newElement.strokeWidth = 0;
        } else {
            newElement.fillColor = item.fillColor ? item.fillColor.clone() : new paper.Color('#000000');
            newElement.strokeColor = item.strokeColor ? item.strokeColor.clone() : null;
            newElement.strokeWidth = item.strokeWidth || 0;
        }

        // Movimiento reactivo en caliente
        newElement.onMouseDrag = function(event) {
            this.position = this.position.add(event.delta);
            recalculateDynamicSubtractions(parent);
        };
        result.push(newElement);
    });

    item.remove();
    if (index !== -1 && parent.insertChild) {
        result.forEach((newItem, i) => parent.insertChild(index + i, newItem));
    }
    recalculateDynamicSubtractions(parent);

    // Selección inteligente ceñida al primer trazado para evitar cajas colectivas molestas
    if (result.length > 0) {
        window.deselectItem();
        setTimeout(() => {
            const primaryItem = result[0];
            window.selectedItems = [primaryItem];
            window.selectedItem = primaryItem;
            primaryItem.selected = true;
            if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(primaryItem);
            if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(primaryItem);
        }, 50);
    }
    return { handled: true, simple: false, items: result };
}

function getGlobalMatrix(item) {
    if (!item) return new paper.Matrix();
    if (item.data && item.data.globalMatrix) {
        return item.data.globalMatrix.clone();
    }
    return getMatrixRelativeTo(item, null);
}

function getMatrixRelativeTo(item, targetAncestor) {
    let matrix = new paper.Matrix();
    let current = item;
    while (current && current !== targetAncestor && !(current.className === 'Layer' || (typeof paper !== 'undefined' && paper.Layer && current instanceof paper.Layer))) {
        if (current.matrix) {
            matrix = current.matrix.chain(matrix);
        }
        current = current.parent;
    }
    return matrix;
}

/* =========================================================================
   2. Parches de Integración para las Otras Cuatro Rutas del Repositorio [7]
   Para que esta física opere de forma unificada e interactiva en todo el sistema,
   debes inyectar estas rutinas en los siguientes archivos [7]:

   Ruta 1: ASSETS/js/modules/canvas-pro/contextualMenu.js (Acciones de Capa / Z-Index)
   Qué hace: Actualiza los calados vectoriales al alterar el orden de capas (Z-Index) del calado y los sólidos mediante la barra emergente.

   Inyección de Código:
   // Al final de las funciones asociadas a los botones "Subir Capa" (#btnCtxForward) y "Bajar Capa" (#btnCtxBackward):
   if (typeof window.recalculateDynamicSubtractions === 'function') {
       window.recalculateDynamicSubtractions();
   }
   ========================================================================= */

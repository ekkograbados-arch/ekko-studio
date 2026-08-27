/* =========================================================================
Modulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Edition - v22.1)
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/geometricUngroup.js
Descripción: Motor de desagrupado geométrico progresivo "de afuera hacia adentro"
             y "de más a menos". Descompone CompoundPaths en jerarquías de
             sólidos y calados celestes reactivos (HoleControllers).
             Soporta vinculación dinámica retroactiva e imantación de huecos.
             Garantiza la física de calados reales y previene transparencias visuales.
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

function getContentItem(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup) {
        var content = item.children.find(function(c) {
            return !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask));
        });
        if (content) return content;
        var fallback = item.children.find(function(c) {
            return !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup));
        });
        if (fallback) return fallback;
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

function getMatrixRelativeTo(item, targetAncestor) {
    let matrix = new paper.Matrix();
    let current = item;
    while (current && current !== targetAncestor && current.className !== 'Layer') {
        if (current.matrix) {
            matrix = current.matrix.chain(matrix);
        }
        current = current.parent;
    }
    return matrix;
}

function getGlobalMatrix(item) {
    if (!item) return new paper.Matrix();
    if (item.data && item.data.globalMatrix) {
        return item.data.globalMatrix.clone();
    }
    return getMatrixRelativeTo(item, null);
}

function areaOf(path) {
    if (!path) return 0;
    return Math.abs(path.area || (path.bounds ? path.bounds.area : 0) || 0);
}

function contains(parent, child) {
    if (!parent || !child) return false;
    const p = child.bounds?.center;
    if (!p) return false;
    if (typeof parent.contains === 'function') {
        try { return parent.contains(p); } catch (_) {}
    }
    return parent.bounds ? parent.bounds.contains(p) : false;
}

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
                if (ca < bestArea) {
                    bestArea = ca;
                    best = candidate;
                }
            }
        }
        if (best) {
            node.parent = best;
            best.children.push(node);
        }
    }
    const roots = nodes.filter(n => !n.parent);
    const assign = (n, d) => {
        n.depth = d;
        n.children.forEach(c => assign(c, d + 1));
    };
    roots.forEach(root => assign(root, 0));
    return roots;
}

function clonePath(path) {
    return path.clone({ insert: false });
}

function hasDeeperSolids(node) {
    if (!node.children || node.children.length === 0) return false;
    return node.children.some(child => {
        // child is a hole (odd depth)
        return child.children && child.children.length > 0; // if child (hole) has children, those must be solids!
    });
}

function makeNode(node, global, isClipped, item, parent, target) {
    const hasChildren = node.children.length > 0;
    const isHoleType = node.depth % 2 === 1;

    // 1. ELEMENTO SIMPLE (Sin hijos)
    if (!hasChildren) {
        const leaf = clonePath(node.path);
        leaf.fillColor = isHoleType ? new paper.Color(255, 255, 255, 0.01) : (node.path.fillColor ? node.path.fillColor.clone() : new paper.Color('#000000'));
        leaf.strokeColor = node.path.strokeColor ? node.path.strokeColor.clone() : new paper.Color('#000000');
        leaf.strokeWidth = node.path.strokeWidth || 1;
        
        let newItem;
        if (isClipped) {
            newItem = window.clipItem(leaf);
            if (newItem === leaf) {
                newItem.matrix = global.clone().chain(leaf.matrix);
            } else {
                newItem.matrix = item.matrix.clone();
                leaf.matrix = getMatrixRelativeTo(leaf, target).clone().chain(leaf.matrix);
            }
        } else {
            newItem = leaf;
            newItem.matrix = global.clone().chain(leaf.matrix);
            parent.addChild(newItem);
        }
        
        newItem.data = {
            ...(item.data || {}),
            locked: false,
            geometricRole: isHoleType ? 'hole' : 'solid',
            geometricHierarchy: 'simple',
            label: isHoleType ? "Hueco" : (item.data?.label || "Objeto")
        };
        return newItem;
    }

    // 2. ELEMENTO COMPUESTO (Sólido con calados, ej: Letra "A")
    // Si es un sólido (even depth) y NO tiene sólidos más profundos en sus calados,
    // lo representamos directamente como un CompoundPath real para mantener calado físico sólido.
    if (!isHoleType && !hasDeeperSolids(node)) {
        const shell = new paper.CompoundPath({ insert: false });
        const outer = clonePath(node.path);
        shell.addChild(outer);
        
        node.children.forEach(hole => {
            shell.addChild(clonePath(hole.path));
        });
        
        shell.fillColor = node.path.fillColor ? node.path.fillColor.clone() : new paper.Color('#000000');
        shell.strokeColor = node.path.strokeColor ? node.path.strokeColor.clone() : new paper.Color('#000000');
        shell.strokeWidth = node.path.strokeWidth || 1;
        
        let newItem;
        if (isClipped) {
            newItem = window.clipItem(shell);
            if (newItem === shell) {
                newItem.matrix = global.clone().chain(shell.matrix);
            } else {
                newItem.matrix = item.matrix.clone();
                shell.matrix = getMatrixRelativeTo(shell, target).clone().chain(shell.matrix);
            }
        } else {
            newItem = shell;
            newItem.matrix = global.clone().chain(shell.matrix);
            parent.addChild(newItem);
        }
        
        newItem.data = {
            ...(item.data || {}),
            locked: false,
            geometricRole: 'solid',
            geometricHierarchy: 'compound',
            label: item.data?.label || "Objeto Compuesto"
        };
        return newItem;
    }

    // 3. GRUPO GEOMÉTRICO (Estructura de anidamiento complejo, ej: El Escudo o el Cutout)
    const group = new paper.Group({ insert: false });
    group.data = {
        ...(item.data || {}),
        locked: false,
        geometricHierarchy: 'compound',
        geometricDepth: node.depth,
        geometricRole: isHoleType ? 'hole' : 'solid',
        label: isHoleType ? "Grupo Calado Compuesto" : "Grupo Sólido Compuesto"
    };

    // Si es un sólido con calados profundos, su "corteza" o silueta exterior simple
    // se agrega al grupo como el fondo del diseño de este nivel.
    if (!isHoleType) {
        const outerShell = clonePath(node.path);
        outerShell.fillColor = node.path.fillColor ? node.path.fillColor.clone() : new paper.Color('#000000');
        outerShell.strokeColor = node.path.strokeColor ? node.path.strokeColor.clone() : new paper.Color('#000000');
        outerShell.strokeWidth = node.path.strokeWidth || 1;
        outerShell.data = {
            ...(item.data || {}),
            locked: false,
            geometricRole: 'solid',
            geometricHierarchy: 'simple',
            label: "Silueta Exterior"
        };
        group.addChild(outerShell);
    } else {
        // Si es un calado compuesto (ej: el cutout del escudo), el calado en sí mismo
        // se agrega como el primer hijo del grupo representando la frontera del calado.
        const holeShell = clonePath(node.path);
        holeShell.fillColor = new paper.Color(255, 255, 255, 0.01);
        holeShell.strokeColor = node.path.strokeColor ? node.path.strokeColor.clone() : new paper.Color('#000000');
        holeShell.strokeWidth = node.path.strokeWidth || 1;
        holeShell.data = {
            ...(item.data || {}),
            locked: false,
            geometricRole: 'hole',
            geometricHierarchy: 'simple',
            label: "Hueco"
        };
        group.addChild(holeShell);
    }

    // Procesar recursivamente todos los hijos del árbol geométrico
    node.children.forEach(child => {
        const childItem = makeNode(child, global, isClipped, item, parent, target);
        if (childItem) {
            childItem.remove(); // Desprender para insertarlo dentro de nuestro grupo
            group.addChild(childItem);
        }
    });

    let finalGroupItem;
    if (isClipped) {
        finalGroupItem = window.clipItem(group);
        if (finalGroupItem === group) {
            finalGroupItem.matrix = global.clone().chain(group.matrix);
        } else {
            finalGroupItem.matrix = item.matrix.clone();
            group.matrix = getMatrixRelativeTo(group, target).clone().chain(group.matrix);
        }
    } else {
        finalGroupItem = group;
        finalGroupItem.matrix = global.clone().chain(group.matrix);
        parent.addChild(finalGroupItem);
    }
    return finalGroupItem;
}

// Vincula retroactivamente huecos/calados con sus respectivos outers sólidos
function linkHolesToOuters(items) {
    if (!items || items.length === 0) return;
    const outersToUpdate = new Set();
    const solidCandidates = [];
    const holeItems = [];

    items.forEach(it => {
        const actual = it.data?.clipGroup ? getContentItem(it) : it;
        if (!actual) return;
        
        if (it.data?.geometricRole === 'solid') {
            solidCandidates.push(it);
        } else if (it.data?.geometricRole === 'hole') {
            holeItems.push(it);
        }
    });

    // Buscar también en la capa de diseño activa para imantación global retroactiva
    if (typeof paper !== 'undefined' && paper.project && paper.project.activeLayer) {
        paper.project.activeLayer.children.forEach(c => {
            if (c && c.data?.geometricRole === 'solid' && !solidCandidates.includes(c)) {
                solidCandidates.push(c);
            }
        });
    }

    holeItems.forEach(holeItem => {
        const holeCenter = holeItem.bounds.center;
        let bestOuter = null;
        let minArea = Infinity;
        
        solidCandidates.forEach(outItem => {
            if (outItem === holeItem) return;
            const visualOuter = outItem.data?.clipGroup ? getContentItem(outItem) : outItem;
            if (visualOuter && visualOuter.bounds.contains(holeCenter)) {
                let contained = false;
                if (typeof visualOuter.contains === 'function') {
                    try { contained = visualOuter.contains(holeCenter); } catch (_) { contained = visualOuter.bounds.contains(holeCenter); }
                } else {
                    contained = visualOuter.bounds.contains(holeCenter);
                }
                
                if (contained) {
                    const area = visualOuter.bounds.area || (visualOuter.bounds.width * visualOuter.bounds.height);
                    if (area < minArea) {
                        minArea = area;
                        bestOuter = outItem;
                    }
                }
            }
        });
        
        if (bestOuter) {
            holeItem.data = holeItem.data || {};
            holeItem.data.isHoleController = true;
            holeItem.data.outerItemId = bestOuter.id;
            holeItem.data.label = "Hueco";
            
            // Si el holeItem es un grupo, aplicamos estética celeste punteada SOLO a su primer hijo (el path)
            // para evitar propagación masiva de color que vuelva transparentes a los sólidos anidados
            const visualHole = isGroup(holeItem) ? holeItem.children[0] : (holeItem.data?.clipGroup ? getContentItem(holeItem) : holeItem);
            if (visualHole) {
                visualHole.strokeColor = '#009dec';
                visualHole.strokeWidth = 1.5 / paper.view.zoom;
                visualHole.dashArray = [4, 4];
                visualHole.fillColor = new paper.Color(0, 157, 236, 0.001);
            }
            
            bestOuter.data = bestOuter.data || {};
            bestOuter.data.isOuterWithHoles = true;
            const targetOuter = bestOuter.data.clipGroup ? getContentItem(bestOuter) : bestOuter;
            bestOuter.data.originalPath = targetOuter.clone({ insert: false });
            bestOuter.data.holeIds = bestOuter.data.holeIds || [];
            if (!bestOuter.data.holeIds.includes(holeItem.id)) {
                bestOuter.data.holeIds.push(holeItem.id);
            }
            
            if (typeof window.ekkoOuters !== 'undefined') {
                window.ekkoOuters.set(bestOuter.id, bestOuter);
            }
            outersToUpdate.add(bestOuter);
        }
    });

    outersToUpdate.forEach(outer => {
        if (typeof window.updateOuterPathGeometry === 'function') {
            window.updateOuterPathGeometry(outer);
        }
    });
}

export function geometricUngroupCompound(item) {
    if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return null;
    const isClipped = !!item.data?.clipGroup;
    const target = isClipped ? getContentItem(item) : item;
    if (!isCompoundPath(target)) return null;
    const paths = [...target.children].filter(p => p && p.bounds && !p.data?.mockup && !p.data?.isMask);
    if (paths.length <= 1) return { handled: true, simple: true, items: [item] };
    const roots = buildTree(paths);
    const parent = item.parent || paper.project.activeLayer;
    const index = parent.children.indexOf(item);
    const global = getGlobalMatrix(target);
    const result = [];

    // SI HAY UN SOLO CONTORNO EXTERIOR PRINCIPAL (RAÍZ), SEPARAMOS LA GEOMETRÍA DIRECTAMENTE EN EL 1ER CLIC
    if (roots.length === 1) {
        const root = roots[0];

        // 1. Crear el contorno exterior como un contorno simple, cerrado y sólido, completamente libre de calados
        const shellPath = clonePath(root.path);
        shellPath.fillColor = target.fillColor || new paper.Color('#000000');
        shellPath.strokeColor = target.strokeColor || new paper.Color('#000000');
        shellPath.strokeWidth = target.strokeWidth || 1;
        let configuredShell;
        if (isClipped) {
            configuredShell = window.clipItem(shellPath);
            if (configuredShell === shellPath) {
                configuredShell.matrix = global.clone().chain(shellPath.matrix);
            } else {
                configuredShell.matrix = item.matrix.clone();
                shellPath.matrix = getMatrixRelativeTo(shellPath, target).clone().chain(shellPath.matrix);
            }
        } else {
            configuredShell = shellPath;
            configuredShell.matrix = global.clone().chain(shellPath.matrix);
            parent.addChild(configuredShell);
        }
        configuredShell.data = {
            ...(item.data || {}),
            locked: false,
            geometricRole: 'solid',
            geometricHierarchy: 'simple',
            label: item.data?.label || "Objeto"
        };
        result.push(configuredShell);

        // 2. Procesar los hijos de nivel 1 de forma recursiva (los calados y elementos internos)
        root.children.forEach(child => {
            const childItem = makeNode(child, global, isClipped, item, parent, target);
            if (childItem) {
                result.push(childItem);
            }
        });
    } else {
        // Si hay múltiples raíces independientes, procesamos cada una
        roots.forEach(root => {
            const built = makeNode(root, global, isClipped, item, parent, target);
            if (built) {
                result.push(built);
            }
        });
    }
    item.remove();
    const finalFiltered = [];
    result.forEach(it => {
        if (it && (it.parent === parent || (isClipped && it.parent))) {
            finalFiltered.push(it);
        }
    });

    // Sincronizar calados y outers para el mantenimiento físico de transparencias
    linkHolesToOuters(finalFiltered);

    // Insertar los elementos resultantes en la misma posición de capa (index) para preservar el z-index original y evitar fugas sobre el mockup
    finalFiltered.forEach((child, i) => {
        if (child && child.parent) {
            child.parent.insertChild(index + i, child);
        }
    });
    if (finalFiltered.length > 0) {
        window.deselectItem();
        setTimeout(() => {
            // CORRECCIÓN DE ORO: Seleccionar solo el primer elemento generado (el contorno exterior)
            // para evitar la caja de selección global y permitir el arrastre individual inmediato de cualquier pieza.
            const primaryItem = finalFiltered[0];
            window.selectedItems = [primaryItem];
            window.selectedItem = primaryItem;
            primaryItem.selected = true;
            if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
            if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
        }, 50);
    }
    return { handled: true, simple: false, items: finalFiltered };
}

export function geometricUngroupOneLevel(item, isClipped = false, oldClipGroup = null) {
    if (!item || item.data?.geometricHierarchy !== 'compound' || !isGroup(item)) return null;
    const parent = oldClipGroup ? oldClipGroup.parent : (item.parent || paper.project.activeLayer);
    const index = oldClipGroup ? parent.children.indexOf(oldClipGroup) : parent.children.indexOf(item);
    const children = [...item.children];
    const matrix = getGlobalMatrix(item);
    const addedItems = [];
    children.forEach(child => {
        const targetAncestor = isClipped ? oldClipGroup : item;
        const relMatrix = getMatrixRelativeTo(child, targetAncestor);
        const globalMatrix = getGlobalMatrix(child);
        child.remove();
        let newItem;
        if (isClipped && oldClipGroup) {
            newItem = window.clipItem(child);
            if (newItem === child) {
                newItem.matrix = globalMatrix;
            } else {
                newItem.matrix = oldClipGroup.matrix.clone();
                child.matrix = relMatrix;
            }
        } else {
            newItem = child;
            newItem.matrix = globalMatrix;
            parent.addChild(newItem);
        }
        addedItems.push(newItem);
    });
    item.remove();
    if (isClipped && oldClipGroup) {
        oldClipGroup.clipped = false;
        oldClipGroup.remove();
    }

    // Vincular calados con outers para preservar el calado físico al desagrupar el grupo
    linkHolesToOuters(addedItems);

    addedItems.forEach((child, i) => {
        if (child && child.parent) {
            parent.insertChild(index + i, child);
        }
    });
    if (addedItems.length > 0) {
        window.deselectItem();
        setTimeout(() => {
            const primaryItem = addedItems[0];
            window.selectedItems = [primaryItem];
            window.selectedItem = primaryItem;
            primaryItem.selected = true;
            if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
            if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
            paper.view.update();
        }, 50);
    }
    return { handled: true, items: addedItems };
}

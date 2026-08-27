/* =========================================================================
   Modulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Edition - v23.0)
   Ruta de reemplazo: ASSETS/js/modules/canvas-pro/geometricUngroup.js
   Descripción: Motor de desagrupado geométrico progresivo y reactivo.
                Cumple estrictamente con la filosofía de EKKO Studio V23:
                - Los huecos físicos reales de la geometría siempre permanecen como tal.
                - Sin simulación de huecos con cuerpos celestes o transparencias artificiales.
                - Permite descomponer trazados compuestos con múltiples raíces independientes.
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

// Construye un árbol de contención geométrica para clasificar contornos exteriores y sus huecos nested.
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

// Función recursiva para recolectar todos los descendientes de un nodo en el árbol de contención
function collectDescendantPaths(node, list) {
  node.children.forEach(child => {
    list.push(clonePath(child.path));
    collectDescendantPaths(child, list);
  });
}

// Vincula retroactivamente huecos/calados con sus respectivos outers sólidos y actualiza la lista en caliente
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
  // Buscar también en la capa de diseño para imantación global
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
      const visualHole = holeItem.data?.clipGroup ? getContentItem(holeItem) : holeItem;
      const visualOuter = bestOuter.data?.clipGroup ? getContentItem(bestOuter) : bestOuter;
      if (visualHole && visualOuter) {
        // Estilo limpio y geométrico real: sin celeste ni punteado artificial
        visualHole.strokeColor = visualOuter.strokeColor ? visualOuter.strokeColor.clone() : new paper.Color('#000000');
        visualHole.strokeWidth = visualOuter.strokeWidth || 1;
        visualHole.dashArray = null; // Sin punteado celeste artificial
        visualHole.fillColor = new paper.Color(255, 255, 255, 0.001); // Transparente para hover y selección, dejando ver el fondo real
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
      const updatedOuter = window.updateOuterPathGeometry(outer);
      if (updatedOuter && updatedOuter !== outer) {
        const idx = items.indexOf(outer);
        if (idx !== -1) {
          items[idx] = updatedOuter;
        }
        if (window.selectedItem === outer) {
          window.selectedItem = updatedOuter;
        }
        if (window.selectedItems) {
          const sIdx = window.selectedItems.indexOf(outer);
          if (sIdx !== -1) {
            window.selectedItems[sIdx] = updatedOuter;
          }
        }
      }
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

  // LÓGICA DE DIVISIÓN PROGRESIVA UNIFICADA:
  // Separamos cada raíz de sus hijos directos.
  roots.forEach(root => {
    // 1. El contorno raíz se convierte en un contorno simple, sólido e independiente
    const rootPathClone = clonePath(root.path);
    rootPathClone.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
    rootPathClone.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
    rootPathClone.strokeWidth = target.strokeWidth || 0;
    
    let newOuter;
    if (isClipped) {
      newOuter = window.clipItem(rootPathClone);
      newOuter.matrix = item.matrix.clone();
    } else {
      newOuter = rootPathClone;
      newOuter.matrix = global.clone();
      parent.addChild(newOuter);
    }
    newOuter.data = {
      ...(item.data || {}),
      locked: false,
      geometricRole: 'solid',
      geometricHierarchy: 'simple',
      label: item.data?.label || "Objeto"
    };
    result.push(newOuter);

    // 2. Cada hijo directo se extrae de forma independiente.
    // - Si el hijo tiene descendientes, se crea como un CompoundPath (es un elemento compuesto, ej: la "A")
    // - Si el hijo no tiene descendientes, se crea como un Path simple (es un elemento simple, ej: franjas, "F" o el triángulo de la "A")
    root.children.forEach(child => {
      const childPathClone = clonePath(child.path);
      const descendants = [];
      collectDescendantPaths(child, descendants);

      let newChild;
      if (descendants.length > 0) {
        // Tiene hijos nested -> elemento compuesto (ej: letra "A" con su triángulo)
        const compoundChildren = [childPathClone, ...descendants];
        const newCompound = new paper.CompoundPath({
          children: compoundChildren,
          insert: false,
          fillRule: 'evenodd'
        });
        newCompound.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
        newCompound.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
        newCompound.strokeWidth = target.strokeWidth || 0;
        
        if (isClipped) {
          newChild = window.clipItem(newCompound);
          newChild.matrix = item.matrix.clone();
        } else {
          newChild = newCompound;
          newChild.matrix = global.clone();
          parent.addChild(newChild);
        }
        newChild.data = {
          ...(item.data || {}),
          locked: false,
          geometricRole: 'solid', // Por defecto actúa como sólido
          geometricHierarchy: 'compound',
          label: "Objeto Compuesto"
        };
      } else {
        // No tiene hijos nested -> elemento simple (ej: bandas, "F" o el triángulo desprendido)
        childPathClone.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
        childPathClone.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
        childPathClone.strokeWidth = target.strokeWidth || 0;
        
        if (isClipped) {
          newChild = window.clipItem(childPathClone);
          newChild.matrix = item.matrix.clone();
        } else {
          newChild = childPathClone;
          newChild.matrix = global.clone();
          parent.addChild(newChild);
        }
        newChild.data = {
          ...(item.data || {}),
          locked: false,
          geometricRole: 'hole', // Actúa como calado para linkHolesToOuters
          geometricHierarchy: 'simple',
          label: "Hueco"
        };
      }
      result.push(newChild);
    });
  });

  // Quitar el CompoundPath original del lienzo de forma limpia
  item.remove();

  const finalFiltered = result.filter(it => it && (it.parent === parent || (isClipped && it.parent)));

  // Sincronizar calados y sólidos reales mediante vinculación interactiva física (linkHolesToOuters)
  linkHolesToOuters(finalFiltered);

  // Insertar los nuevos elementos en el mismo índice para preservar el apilamiento original (z-index)
  if (index !== -1 && parent.insertChild) {
    finalFiltered.forEach((newItem, i) => {
      parent.insertChild(index + i, newItem);
    });
  }

  // Refrescar la pantalla
  if (typeof paper !== 'undefined' && paper.view) {
    paper.view.update();
  }

  // Selección automática del primer elemento generado para evitar la caja de selección de arrastre
  if (finalFiltered.length > 0) {
    window.deselectItem();
    setTimeout(() => {
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


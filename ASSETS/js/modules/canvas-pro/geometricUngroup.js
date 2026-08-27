/* =========================================================================
   Modulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Edition - v23.0 - Pure Geometry & Sync)
   Ruta de reemplazo: ASSETS/js/modules/canvas-pro/geometricUngroup.js
   Descripción: Motor de desagrupado geométrico progresivo y reactivo.
                Cumple estrictamente con la filosofía de EKKO Studio V23:
                - Los huecos físicos reales de la geometría siempre permanecen como tal.
                - Sin simulación de huecos con cuerpos celestes o transparencias artificiales.
                - Permite descomponer trazados compuestos con múltiples raíces independientes.
                - Evita desarmar trazados de raíz única (como la letra "A") protegiendo
                  su naturaleza y calado físico nativo.
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

  // Si hay una sola raíz en todo el trazado compuesto (por ejemplo, una letra "A" con su triángulo interior):
  // Es una única entidad geométrica con huecos físicos reales, no se descompone más para no destruir su naturaleza.
  if (roots.length === 1) {
    return { handled: true, simple: true, items: [item] };
  }

  // Si hay múltiples raíces independientes (por ejemplo: estrellas, bandas, letras mezcladas en un solo CompoundPath):
  // Separamos cada raíz en su propio elemento (que mantendrá sus propios huecos físicos correspondientes).
  roots.forEach(root => {
    const rootPathClone = clonePath(root.path);
    const descendants = [];
    collectDescendantPaths(root, descendants);

    let newElement;
    if (descendants.length > 0) {
      // Tiene huecos: creamos un CompoundPath para mantener la física real de la geometría
      const compoundChildren = [rootPathClone, ...descendants];
      const newCompound = new paper.CompoundPath({
        children: compoundChildren,
        insert: false,
        fillRule: 'evenodd'
      });
      newCompound.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
      newCompound.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
      newCompound.strokeWidth = target.strokeWidth || 0;
      
      if (isClipped) {
        newElement = window.clipItem(newCompound);
        newElement.matrix = item.matrix.clone();
      } else {
        newElement = newCompound;
        newElement.matrix = global.clone();
        parent.addChild(newElement);
      }
      newElement.data = {
        ...(item.data || {}),
        locked: false,
        geometricHierarchy: 'compound',
        label: item.data?.label || "Objeto Compuesto"
      };
    } else {
      // Es una forma simple sin huecos
      rootPathClone.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
      rootPathClone.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
      rootPathClone.strokeWidth = target.strokeWidth || 0;
      
      if (isClipped) {
        newElement = window.clipItem(rootPathClone);
        newElement.matrix = item.matrix.clone();
      } else {
        newElement = rootPathClone;
        newElement.matrix = global.clone();
        parent.addChild(newElement);
      }
      newElement.data = {
        ...(item.data || {}),
        locked: false,
        geometricHierarchy: 'simple',
        label: item.data?.label || "Objeto"
      };
    }
    result.push(newElement);
  });

  // Quitar el CompoundPath original del lienzo de forma limpia
  item.remove();

  const finalFiltered = result.filter(it => it && (it.parent === parent || (isClipped && it.parent)));

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

  // Selección automática del primer elemento para evitar la caja de selección global de arrastre
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

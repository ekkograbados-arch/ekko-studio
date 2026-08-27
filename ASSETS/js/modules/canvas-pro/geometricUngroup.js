/* =========================================================================
   Modulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Edition - v23.0 - Pure Geometry & Sync v9)
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
    if (!item.children) return item;
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

// Comprobación geométrica robusta basada en vértices para evitar errores de cajas delimitadoras en formas curvas (ej. laureles)
function contains(parent, child) {
  if (!parent || !child) return false;
  
  // Rápida comprobación preliminar por intersección de límites de Paper.js
  if (!parent.bounds.intersects(child.bounds) && !parent.bounds.contains(child.bounds)) {
    return false;
  }
  
  const pointsToCheck = [];
  if (child.segments && child.segments.length > 0) {
    // Tomar hasta 8 puntos distribuidos a lo largo del contorno del hijo
    const step = Math.max(1, Math.floor(child.segments.length / 8));
    for (let i = 0; i < child.segments.length; i += step) {
      pointsToCheck.push(child.segments[i].point);
    }
  } else {
    pointsToCheck.push(child.bounds.center);
  }
  
  let insideCount = 0;
  pointsToCheck.forEach(p => {
    try {
      if (parent.contains(p)) {
        insideCount++;
      }
    } catch (_) {}
  });
  
  // Se considera contenido si más del 50% de sus puntos de contorno físico caen dentro de la forma del padre
  return insideCount > (pointsToCheck.length / 2);
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

// Determina si una rama contiene sólidos anidados en profundidades pares (por ejemplo, Depth 2, 4, etc.)
function hasNestedSolids(rootNode) {
  let found = false;
  const check = (node) => {
    if (node.depth > 0 && node.depth % 2 === 0) {
      found = true;
      return;
    }
    node.children.forEach(check);
  };
  rootNode.children.forEach(check);
  return found;
}

// Descompone un nodo complejo extrayendo la corteza (silueta exterior con sus huecos directos) y promoviendo sus nietos sólidos
function decomposeNode(node, global, isClipped, item, parent, target) {
  const elements = [];
  
  // 1. Crear la corteza (shell) de este nivel (el marco sólido exterior con sus huecos directos de primer nivel)
  const shellChildren = [clonePath(node.path)];
  node.children.forEach(child => {
    shellChildren.push(clonePath(child.path));
  });
  
  let configuredShell;
  if (shellChildren.length > 1) {
    // Si tiene huecos directos (Depth 1), creamos un CompoundPath para mantener la transparencia física real
    const shellCompound = new paper.CompoundPath({
      children: shellChildren,
      insert: false,
      fillRule: 'evenodd'
    });
    shellCompound.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
    shellCompound.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
    shellCompound.strokeWidth = target.strokeWidth || 0;
    
    if (isClipped) {
      configuredShell = window.clipItem(shellCompound);
      configuredShell.matrix = item.matrix.clone();
    } else {
      configuredShell = shellCompound;
      configuredShell.matrix = global.clone();
      parent.addChild(configuredShell);
    }
  } else {
    // Es una forma simple sin huecos directos
    const shellPath = shellChildren[0];
    shellPath.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
    shellPath.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
    shellPath.strokeWidth = target.strokeWidth || 0;
    
    if (isClipped) {
      configuredShell = window.clipItem(shellPath);
      configuredShell.matrix = item.matrix.clone();
    } else {
      configuredShell = shellPath;
      configuredShell.matrix = global.clone();
      parent.addChild(configuredShell);
    }
  }
  
  configuredShell.data = {
    ...(item.data || {}),
    locked: false,
    geometricHierarchy: 'simple',
    label: item.data?.label || "Objeto"
  };
  elements.push(configuredShell);
  
  // 2. Extraer los nietos sólidos (los hijos de nuestros huecos directos, que se ubican en Depth 2)
  node.children.forEach(hole => {
    hole.children.forEach(solidGrandchild => {
      const rootPathClone = clonePath(solidGrandchild.path);
      const descendants = [];
      collectDescendantPaths(solidGrandchild, descendants);
      
      let newElement;
      if (descendants.length > 0) {
        // El nieto sólido posee huecos (ej. la letra "A" con su triángulo interior)
        // Creamos un CompoundPath para mantener la física real de la geometría de la letra intacta
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
        // Es una forma simple sin huecos (ej. las bandas verticales, la letra "F")
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
      elements.push(newElement);
    });
  });
  
  return elements;
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

  // Si hay una sola raíz en todo el trazado compuesto y no tiene sólidos anidados:
  // Es una única entidad geométrica simple con calados físicos (como una letra "A"), se protege de desagrupar más.
  if (roots.length === 1 && !hasNestedSolids(roots[0])) {
    return { handled: true, simple: true, items: [item] };
  }

  // Si hay una sola raíz pero sí tiene sólidos anidados (como el Cuerpo del Escudo):
  // Descomponemos esta raíz en sus niveles correspondientes de forma controlada.
  if (roots.length === 1 && hasNestedSolids(roots[0])) {
    const decomposed = decomposeNode(roots[0], global, isClipped, item, parent, target);
    result.push(...decomposed);
  } else {
    // Si hay múltiples raíces independientes (estrellas, laureles, escudo mezclados):
    // REGLA DE ORO DE DESAGRUPADO (1er clic): Se separan únicamente las raíces independientes a nivel global,
    // manteniendo la jerarquía interna de cada una 100% unificada e intacta (sin deconstrucción prematura).
    roots.forEach(root => {
      const rootPathClone = clonePath(root.path);
      const descendants = [];
      collectDescendantPaths(root, descendants);

      let newElement;
      if (descendants.length > 0) {
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
        result.push(newElement);
      } else {
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
        result.push(newElement);
      }
    });
  }

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

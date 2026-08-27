/* =========================================================================
   Modulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Edition - v23.0 - Pure Geometry & Sync v11)
   Ruta de reemplazo: ASSETS/js/modules/canvas-pro/geometricUngroup.js
   Descripción: Motor de desagrupado geométrico progresivo y reactivo.
                Cumple estrictamente con la filosofía de EKKO Studio V23:
                - Los huecos físicos reales de la geometría siempre permanecen como tal.
                - Sin simulación de huecos con cuerpos celestes o transparencias artificiales.
                - Descompone CompoundPaths en jerarquías de elementos simples o compuestos,
                  nivel por nivel, de afuera hacia adentro.
                - Permite desagrupar hasta llegar a la mínima expresión de elementos simples
                  (ya sean sólidos/rellenos o huecos/vacíos/calados físicos).
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

// Establece la profundidad global de los nodos de forma recursiva
function establishGlobalDepths(roots) {
  const walk = (node, currentDepth) => {
    if (typeof node.path.data.globalDepth === 'undefined') {
      node.path.data.globalDepth = currentDepth;
    }
    node.children.forEach(child => walk(child, currentDepth + 1));
  };
  roots.forEach(root => walk(root, 0));
}

// Configura el relleno y borde de un trazado según su rol físico (Sólido vs Hueco)
function configurePathFill(path, targetFillColor, targetStrokeColor, targetStrokeWidth) {
  const depth = (typeof path.data?.globalDepth !== 'undefined') ? path.data.globalDepth : 0;
  if (depth % 2 === 0) {
    // SÓLIDO (Profundidad par: 0, 2, 4...) -> Se rellena con color negro o de la imagen
    path.fillColor = targetFillColor ? targetFillColor.clone() : new paper.Color('#000000');
    path.strokeColor = targetStrokeColor ? targetStrokeColor.clone() : null;
    path.strokeWidth = targetStrokeWidth || 0;
  } else {
    // HUECO / VACÍO FÍSICO (Profundidad impar: 1, 3, 5...) -> Es 100% transparente y calado real
    path.fillColor = new paper.Color(255, 255, 255, 0.001); // Hit-testable pero visualmente invisible
    path.strokeColor = targetStrokeColor ? targetStrokeColor.clone() : new paper.Color('#000000');
    path.strokeWidth = targetStrokeWidth || 1;
  }
}

export function geometricUngroupCompound(item) {
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return null;
  const isClipped = !!item.data?.clipGroup;
  const target = isClipped ? getContentItem(item) : item;
  if (!isCompoundPath(target)) return null;
  
  const paths = [...target.children].filter(p => p && p.bounds && !p.data?.mockup && !p.data?.isMask);
  if (paths.length <= 1) return { handled: true, simple: true, items: [item] };

  const roots = buildTree(paths);
  establishGlobalDepths(roots);

  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const global = getGlobalMatrix(target);
  const result = [];

  // SI HAY UNA SOLA RAÍZ Y NO TIENE HIJOS, ES UN ELEMENTO SIMPLE
  if (roots.length === 1 && roots[0].children.length === 0) {
    return { handled: true, simple: true, items: [item] };
  }

  // CONSTRUCTOR RECURSIVO DE ESTRUCTURAS GEOMÉTRICAS (Mantiene Física Real de Huecos)
  const buildGeometricNode = (node) => {
    const hasChildren = node.children.length > 0;
    if (!hasChildren) {
      // Elemento simple (sin estructura interna profunda)
      const pathClone = clonePath(node.path);
      configurePathFill(pathClone, target.fillColor, target.strokeColor, target.strokeWidth);
      
      let newElement;
      if (isClipped) {
        newElement = window.clipItem(pathClone);
        newElement.matrix = item.matrix.clone();
      } else {
        newElement = pathClone;
        newElement.matrix = global.clone();
        parent.addChild(newElement);
      }
      
      newElement.data = {
        ...(item.data || {}),
        locked: false,
        globalDepth: node.path.data.globalDepth,
        geometricHierarchy: 'simple',
        label: node.path.data.globalDepth % 2 === 1 ? "Hueco" : "Objeto"
      };
      return newElement;
    } else {
      // Elemento compuesto (se representa como un Group para soportar fillColors independientes en sus componentes)
      const group = new paper.Group({ insert: false });
      
      // Añadir la corteza (shell) de este nivel
      const outerPath = clonePath(node.path);
      configurePathFill(outerPath, target.fillColor, target.strokeColor, target.strokeWidth);
      outerPath.data = {
        ...(item.data || {}),
        locked: false,
        globalDepth: node.path.data.globalDepth,
        geometricHierarchy: 'simple',
        label: node.path.data.globalDepth % 2 === 1 ? "Hueco" : "Objeto"
      };
      group.addChild(outerPath);
      
      // Añadir hijos recursivamente dentro del grupo compuesto
      node.children.forEach(childNode => {
        const childItem = buildGeometricNode(childNode);
        if (childItem) {
          childItem.remove(); // Desprender para agruparlo limpiamente
          group.addChild(childItem);
        }
      });
      
      let finalGroupItem;
      if (isClipped) {
        finalGroupItem = window.clipItem(group);
        finalGroupItem.matrix = item.matrix.clone();
      } else {
        finalGroupItem = group;
        finalGroupItem.matrix = global.clone();
        parent.addChild(finalGroupItem);
      }
      
      finalGroupItem.data = {
        ...(item.data || {}),
        locked: false,
        geometricHierarchy: 'compound',
        label: node.path.data.globalDepth % 2 === 1 ? "Grupo Calado Compuesto" : "Grupo Sólido Compuesto"
      };
      
      return finalGroupItem;
    }
  };

  // Si hay una sola raíz en todo el trazado compuesto (ej: el Cuerpo del Escudo)
  // Decomponemos un único nivel de esta raíz, promoviendo sus hijos directos (Nivel 1) a elementos independientes.
  if (roots.length === 1) {
    const root = roots[0];
    
    // 1. Crear la silueta o contorno exterior como un contorno simple
    const shellPath = clonePath(root.path);
    configurePathFill(shellPath, target.fillColor, target.strokeColor, target.strokeWidth);
    
    let configuredShell;
    if (isClipped) {
      configuredShell = window.clipItem(shellPath);
      configuredShell.matrix = item.matrix.clone();
    } else {
      configuredShell = shellPath;
      configuredShell.matrix = global.clone();
      parent.addChild(configuredShell);
    }
    configuredShell.data = {
      ...(item.data || {}),
      locked: false,
      globalDepth: root.path.data.globalDepth,
      geometricHierarchy: 'simple',
      label: root.path.data.globalDepth % 2 === 1 ? "Hueco" : "Objeto"
    };
    result.push(configuredShell);

    // 2. Promover cada hijo directo de primer nivel a un elemento independiente (sea simple o un grupo compuesto)
    root.children.forEach(childNode => {
      const childItem = buildGeometricNode(childNode);
      if (childItem) {
        result.push(childItem);
      }
    });

  } else {
    // Si hay múltiples raíces independientes (estrellas, laureles, escudo mezclados):
    // Separamos únicamente las raíces independientes a nivel global
    roots.forEach(rootNode => {
      const built = buildGeometricNode(rootNode);
      if (built) {
        result.push(built);
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

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Edition - v24.0 - Pure Geometry & Inside-Out Stacking Hierarchy)
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/geometricUngroup.js
Descripción: Motor de desagrupado geométrico instantáneo de un solo clic, con
             sistema de Calado Activo Dinámico (Cookie Cutter) gobernado por Z-Index.
Cumple estrictamente con la filosofía de EKKO Studio:
- Los huecos de la geometría son calados reales (vacío físico para grabado láser).
- El calado se calcula dinámicamente según el orden de apilamiento (Z-Index).
- Un clic desagrupa absolutamente todos los niveles del objeto en trazados independientes.
========================================================================= */

// --- FUNCIONES AUXILIARES DE COMPROBACIÓN ---

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

// Comprobación geométrica basada en contornos de puntos para evitar fallas de cajas delimitadoras (bounding box)
function contains(parent, child) {
  if (!parent || !child) return false;
  if (!parent.bounds.intersects(child.bounds) && !parent.bounds.contains(child.bounds)) {
    return false;
  }
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
    try {
      if (parent.contains(p)) {
        insideCount++;
      }
    } catch (_) {}
  });
  return insideCount > (pointsToCheck.length / 2);
}

// Construye el árbol de contención espacial para calcular la profundidad (depth) de cada trazo
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
  return { roots, nodes };
}

function clonePath(path) {
  return path.clone({ insert: false });
}

// =========================================================================
// SISTEMA DE CALADO ACTIVO DINÁMICO (COOKIE CUTTER) BASADO EN Z-INDEX
// =========================================================================

/**
 * Retorna el trazado original completo de un elemento (sin restar) en coordenadas globales.
 * Aplica la matriz de transformación del elemento sobre su geometría base original (geomBase).
 */
export function getGlobalUnsubtractedPath(item) {
  if (!item || !item.data || !item.data.geomBase) return null;
  const tempBase = item.data.geomBase.clone({ insert: false });
  tempBase.matrix = item.matrix.clone();
  return tempBase;
}

/**
 * Recalcula todas las sustracciones vectoriales del lienzo en caliente de abajo hacia arriba.
 * Un calado (isHole = true) recortará físicamente a todo elemento sólido que esté por debajo (Z-Index menor).
 */
export function recalculateDynamicSubtractions(layer) {
  const activeLayer = layer || paper.project.activeLayer;
  if (!activeLayer) return;

  // 1. Obtener todos los hijos de la capa actual que no estén bloqueados ni sean del mockup de producto
  // En Paper.js, activeLayer.children está ordenado de menor Z-index (abajo) a mayor Z-index (arriba).
  const items = [...activeLayer.children].filter(
    item => item && !item.data?.locked && !item.data?.mockup && !item.data?.isMask
  );

  // 2. Restaurar todos los elementos sólidos a su geometría base original sin alterar su posición actual (matrix)
  items.forEach(item => {
    if (item.data && item.data.geomBase) {
      if (!item.data.isHole) {
        const pristineBase = getGlobalUnsubtractedPath(item);
        if (pristineBase) {
          item.pathData = pristineBase.pathData;
          item.visible = true;
          pristineBase.remove();
        }
      }
    }
  });

  // 3. Iterar de arriba hacia abajo (Z-Index decreciente)
  // Cada elemento marcado como calado (isHole = true) recortará físicamente a los sólidos inferiores
  for (let i = items.length - 1; i >= 0; i--) {
    const hole = items[i];
    if (hole && hole.data && hole.data.isHole) {
      const holeBase = getGlobalUnsubtractedPath(hole);
      if (!holeBase) continue;

      // Recorrer todos los elementos que están por debajo de este calado (j < i)
      for (let j = i - 1; j >= 0; j--) {
        const solid = items[j];
        if (solid && (!solid.data || !solid.data.isHole) && solid.visible) {
          // Comprobación de intersección geométrica real
          if (solid.bounds.intersects(holeBase.bounds) || solid.bounds.contains(holeBase.bounds)) {
            // Sustracción booleana vectorial en Paper.js
            const subtracted = solid.subtract(holeBase);
            if (subtracted) {
              // Si el resultado no tiene segmentos, significa que fue completamente desintegrado por el calado superior
              if (subtracted.segments?.length > 0 || subtracted.children?.length > 0) {
                solid.pathData = subtracted.pathData;
                solid.visible = true;
              } else {
                solid.pathData = "";
                solid.visible = false;
              }
              subtracted.remove(); // Liberar memoria de Paper.js
            }
          }
        }
      }
      holeBase.remove(); // Liberar memoria
    }
  }

  // Actualizar la vista del lienzo reactivamente
  if (paper.view) {
    paper.view.update();
  }
}

// Exportar globalmente para que los botones de "Subir Capa", "Bajar Capa", Arrastres y Eliminación la ejecuten
if (typeof window !== 'undefined') {
  window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
}

// =========================================================================
// ACCIÓN PRINCIPAL: DESAGRUPAR CON 1 CLIC (SHATTER TO LAYERED CHANNELS)
// =========================================================================

export function geometricUngroupCompound(item) {
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return null;
  const isClipped = !!item.data?.clipGroup;
  const target = isClipped ? getContentItem(item) : item;
  if (!isCompoundPath(target)) return null;

  // Extraer sub-trazados hijos del CompoundPath
  const paths = [...target.children].filter(p => p && p.bounds && !p.data?.mockup && !p.data?.isMask);
  if (paths.length <= 1) return { handled: true, simple: true, items: [item] };

  // Construir la jerarquía espacial para clasificar sólidos y calados
  const { nodes } = buildTree(paths);
  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const global = getGlobalMatrix(target);
  const result = [];

  // Ordenar nodos por profundidad ascendente (Z-Index natural de afuera hacia adentro)
  // Esto asegura que la base sólida quede abajo, y los calados e islas internas encima.
  nodes.sort((a, b) => a.depth - b.depth);

  nodes.forEach(node => {
    const isHole = (node.depth % 2 === 1); // Regla matemática de Oro de profundidad par/impar
    const pathClone = clonePath(node.path);

    // Crear un elemento independiente de Paper.js
    let newElement;
    if (isClipped) {
      newElement = window.clipItem(pathClone);
      newElement.matrix = item.matrix.clone();
    } else {
      newElement = pathClone;
      newElement.matrix = global.clone();
      parent.addChild(newElement);
    }

    // Guardar la geometría prístina original (geomBase) en coordenadas locales
    const localBase = clonePath(node.path);
    localBase.matrix = new paper.Matrix(); // Garantizar que se guarde en coordenadas locales limpias
    
    newElement.data = {
      ...(item.data || {}),
      locked: false,
      isHole: isHole,
      geomBase: localBase,
      geometricHierarchy: 'simple',
      label: isHole ? "Calado Activo" : "Objeto Sólido"
    };

    // Estilización matemática de fabricación
    if (isHole) {
      // Un calado no tiene relleno físico de color, pero le damos una opacidad infinitesimal
      // para que el motor de selección de Paper.js permita hacer clic adentro sin problemas.
      newElement.fillColor = new paper.Color(0, 0, 0, 1e-5); 
      newElement.strokeColor = null;
      newElement.strokeWidth = 0;
    } else {
      newElement.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
      newElement.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
      newElement.strokeWidth = target.strokeWidth || 0;
    }

    // --- MANEJADORES DE EVENTO INTERACTIVO EN CALIENTE ---

    // Al arrastrar, movemos el elemento y actualizamos los calados dinámicamente en vivo
    newElement.onMouseDrag = function(event) {
      this.position = this.position.add(event.delta);
      recalculateDynamicSubtractions(parent);
    };

    result.push(newElement);
  });

  // Eliminar el elemento agrupado original
  item.remove();
  const finalFiltered = result.filter(it => it && (it.parent === parent || (isClipped && it.parent)));

  // Insertar en el mismo orden jerárquico respetando el Z-Index relativo
  if (index !== -1 && parent.insertChild) {
    finalFiltered.forEach((newItem, i) => {
      parent.insertChild(index + i, newItem);
    });
  }

  // Ejecutar el primer ciclo de corte vectorial dinámico en vivo
  recalculateDynamicSubtractions(parent);

  // Selección inteligente: enfocar el primer elemento para evitar cajas de selección colectiva molestas
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

  recalculateDynamicSubtractions(parent);

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

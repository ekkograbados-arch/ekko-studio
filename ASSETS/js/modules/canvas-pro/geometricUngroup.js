/* =========================================================================
   Modulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Edition - v23.0 - Pure Geometry & Sync v14)
   Ruta de reemplazo: ASSETS/js/modules/canvas-pro/geometricUngroup.js
   Descripción: Motor de desagrupado geométrico progresivo y reactivo.
                Cumple estrictamente con la filosofía de EKKO Studio V23:
                - Los huecos físicos reales de la geometría siempre permanecen como tal.
                - Sin simulación de huecos con cuerpos celestes o transparencias artificiales.
                - Descompone CompoundPaths en jerarquías de elementos simples o compuestos,
                  nivel por nivel, de afuera hacia adentro.
                - Permite desagrupar hasta llegar a la mínima expresión de elementos simples
                  (ya sean sólidos/rellenos o huecos/vacíos/calados físicos sin relleno).
                - Sincronización geométrica total 100% inmune a desalineaciones y arrastres.
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
  const clone = path.clone({ insert: false });
  if (path.data) {
    clone.data = JSON.parse(JSON.stringify(path.data));
  }
  return clone;
}

// Establece la profundidad global de los nodos de forma recursiva
function establishGlobalDepths(roots) {
  const walk = (node, currentDepth) => {
    if (node.path && node.path.data) {
      if (typeof node.path.data.globalDepth === 'undefined') {
        node.path.data.globalDepth = currentDepth;
      }
    }
    node.children.forEach(child => walk(child, currentDepth + 1));
  };
  roots.forEach(root => walk(root, 0));
}

// Función recursiva para recolectar todos los descendientes de un nodo en el árbol de contención
function collectDescendantPaths(node, list) {
  node.children.forEach(child => {
    list.push(clonePath(child.path));
    collectDescendantPaths(child, list);
  });
}

// Configura el relleno y borde de un trazado según su rol físico real (Sólido vs Hueco)
function configurePathFill(path, targetFillColor, targetStrokeColor, targetStrokeWidth) {
  const depth = (path.data && typeof path.data.globalDepth !== 'undefined') ? path.data.globalDepth : 0;
  
  if (depth % 2 === 0) {
    // SÓLIDO (Profundidad par: 0, 2, 4...) -> Relleno sólido macizo
    path.fillColor = targetFillColor ? targetFillColor.clone() : new paper.Color('#000000');
    path.strokeColor = targetStrokeColor ? targetStrokeColor.clone() : null;
    path.strokeWidth = targetStrokeWidth || 0;
  } else {
    // HUECO VACÍO FÍSICO (Profundidad impar: 1, 3, 5...) -> Vacío real, sin relleno (null)
    path.fillColor = null; // FÍSICAMENTE HUECO, ABSOLUTAMENTE VACÍO (SIN TRANSPARENCIAS RELLENAS)
    path.strokeColor = targetStrokeColor ? targetStrokeColor.clone() : new paper.Color('#000000');
    path.strokeWidth = targetStrokeWidth || 1;
  }
}

// Sincroniza dinámicamente la geometría de un CompoundPath OuterWithHoles reconstruyendo sus sub-trazados
export function updateOuterCompoundPathGeometry(outerItem) {
  if (!outerItem || !outerItem.data || !outerItem.data.holeIds) return;
  
  const holeIds = outerItem.data.holeIds;
  const targetPaths = [outerItem.children[0]]; // Mantener la silueta outer de base
  
  holeIds.forEach(holeId => {
    const holeItem = paper.project.getItem({ id: holeId });
    if (holeItem && holeItem.parent) {
      let activePath = holeItem;
      if (isGroup(holeItem)) {
        activePath = holeItem.children.find(c => c.data && c.data.isHoleController) || holeItem.children[0];
      }
      
      if (activePath && (isPath(activePath) || isCompoundPath(activePath))) {
        const clonedHole = activePath.clone({ insert: false });
        const pathMatrix = getGlobalMatrix(activePath);
        const outerMatrix = getGlobalMatrix(outerItem);
        const relMatrix = outerMatrix.inverted().chain(pathMatrix);
        clonedHole.matrix = relMatrix;
        
        if (isCompoundPath(clonedHole)) {
          clonedHole.children.forEach(c => targetPaths.push(clonePath(c)));
        } else {
          targetPaths.push(clonedHole);
        }
      }
    }
  });
  
  outerItem.removeChildren();
  outerItem.addChildren(targetPaths);
  
  if (paper.view) {
    paper.view.update();
  }
}
window.updateOuterPathGeometry = updateOuterCompoundPathGeometry;

// Constructor recursivo para calados físicos y sólidos anidados
function buildHoleTree(node, outerItem, groupToAppend, targetColor, targetStrokeColor, targetStrokeWidth, isClipped, item, global, parent) {
  const isHole = node.path.data.globalDepth % 2 === 1;
  
  if (isHole) {
    // Es un Hueco físico independiente (HoleController)
    const pathClone = clonePath(node.path);
    pathClone.fillColor = null; // Vacío físico real
    pathClone.strokeColor = targetStrokeColor ? targetStrokeColor.clone() : new paper.Color('#000000');
    pathClone.strokeWidth = targetStrokeWidth || 1;
    
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
      isHoleController: true,
      outerItemId: outerItem.id,
      globalDepth: node.path.data.globalDepth,
      geometricHierarchy: 'simple',
      label: "Hueco"
    };
    
    outerItem.data.holeIds.push(newElement.id);
    groupToAppend.addChild(newElement);
    
    // Construir recursivamente los descendientes de este hueco
    node.children.forEach(childNode => {
      buildHoleTree(childNode, outerItem, groupToAppend, targetColor, targetStrokeColor, targetStrokeWidth, isClipped, item, global, parent);
    });
  } else {
    // Es un Sólido interno (ej. el triángulo de la "A")
    const pathClone = clonePath(node.path);
    pathClone.fillColor = targetColor ? targetColor.clone() : new paper.Color('#000000');
    pathClone.strokeColor = targetStrokeColor ? targetStrokeColor.clone() : null;
    pathClone.strokeWidth = targetStrokeWidth || 0;
    
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
      label: "Objeto"
    };
    
    groupToAppend.addChild(newElement);
    
    if (node.children.length > 0) {
      // Si este sólido tiene a su vez huecos más internos, actúa como outer de ese nivel
      const solidChildren = [clonePath(node.path)];
      node.children.forEach(gNode => solidChildren.push(clonePath(gNode.path)));
      
      const solidCompound = new paper.CompoundPath({
        children: solidChildren,
        insert: false,
        fillRule: 'evenodd'
      });
      solidCompound.fillColor = targetColor ? targetColor.clone() : new paper.Color('#000000');
      solidCompound.strokeColor = targetStrokeColor ? targetStrokeColor.clone() : null;
      solidCompound.strokeWidth = targetStrokeWidth || 0;
      
      newElement.remove();
      let replacedElement;
      if (isClipped) {
        replacedElement = window.clipItem(solidCompound);
        replacedElement.matrix = item.matrix.clone();
      } else {
        replacedElement = solidCompound;
        replacedElement.matrix = global.clone();
        parent.addChild(replacedElement);
      }
      
      replacedElement.data = {
        ...(item.data || {}),
        locked: false,
        isOuterWithHoles: true,
        holeIds: [],
        originalPath: clonePath(node.path),
        globalDepth: node.path.data.globalDepth,
        geometricHierarchy: 'simple',
        label: "Objeto"
      };
      groupToAppend.addChild(replacedElement);
      
      node.children.forEach(gNode => {
        buildHoleTree(gNode, replacedElement, groupToAppend, targetColor, targetStrokeColor, targetStrokeWidth, isClipped, item, global, parent);
      });
    }
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

  // CONSTRUCTOR RECURSIVO DE ESTRUCTURAS GEOMÉTRICAS UNIFICADAS (Para 1er Clic de Desagrupar)
  const buildUnifiedCompoundNode = (node) => {
    const hasChildren = node.children.length > 0;
    if (!hasChildren) {
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
      // Elemento compuesto unificado (se representa como CompoundPath con fillRule 'evenodd')
      const descendants = [];
      collectDescendantPaths(node, descendants);
      
      const compoundChildren = [clonePath(node.path), ...descendants];
      const newCompound = new paper.CompoundPath({
        children: compoundChildren,
        insert: false,
        fillRule: 'evenodd'
      });
      
      newCompound.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
      newCompound.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
      newCompound.strokeWidth = target.strokeWidth || 0;
      
      let finalCompoundItem;
      if (isClipped) {
        finalCompoundItem = window.clipItem(newCompound);
        finalCompoundItem.matrix = item.matrix.clone();
      } else {
        finalCompoundItem = newCompound;
        finalCompoundItem.matrix = global.clone();
        parent.addChild(finalCompoundItem);
      }
      
      finalCompoundItem.data = {
        ...(item.data || {}),
        locked: false,
        globalDepth: node.path.data.globalDepth,
        geometricHierarchy: 'compound',
        label: "Objeto Compuesto"
      };
      
      return finalCompoundItem;
    }
  };

  // CASO A: SI HAY UNA SOLA RAÍZ EN LA SELECCIÓN ACTUAL (ej: el Cuerpo del Escudo)
  // Decomponemos un único nivel de esta raíz, promoviendo sus hijos directos (Nivel 1) a elementos independientes.
  if (roots.length === 1) {
    const root = roots[0];
    
    // 1. Crear la corteza (shell) o contorno exterior como un CompoundPath con sus huecos directos de primer nivel
    // Esto garantiza que visualmente y físicamente el escudo sea calado de forma nativa en el 2do clic.
    const shellChildren = [clonePath(root.path)];
    root.children.forEach(childNode => {
      shellChildren.push(clonePath(childNode.path));
    });
    
    const shellCompound = new paper.CompoundPath({
      children: shellChildren,
      insert: false,
      fillRule: 'evenodd'
    });
    shellCompound.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
    shellCompound.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
    shellCompound.strokeWidth = target.strokeWidth || 0;
    
    let configuredShell;
    if (isClipped) {
      configuredShell = window.clipItem(shellCompound);
      configuredShell.matrix = item.matrix.clone();
    } else {
      configuredShell = shellCompound;
      configuredShell.matrix = global.clone();
      parent.addChild(configuredShell);
    }
    
    configuredShell.data = {
      ...(item.data || {}),
      locked: false,
      isOuterWithHoles: true,
      holeIds: [], // Se poblará dinámicamente con los HoleControllers independientes
      originalPath: clonePath(root.path),
      globalDepth: root.path.data.globalDepth,
      geometricHierarchy: 'simple',
      label: "Objeto"
    };
    result.push(configuredShell);

    // 2. Promover cada hijo directo de primer nivel a un elemento independiente (sea simple o un grupo compuesto unificado)
    root.children.forEach(childNode => {
      const hasChildren = childNode.children.length > 0;
      if (!hasChildren) {
        // Es una forma simple (ej. bandas, "F"): se crea como HoleController directo
        const pathClone = clonePath(childNode.path);
        pathClone.fillColor = null; // Vacío real
        pathClone.strokeColor = target.strokeColor ? target.strokeColor.clone() : new paper.Color('#000000');
        pathClone.strokeWidth = target.strokeWidth || 1;
        
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
          isHoleController: true,
          outerItemId: configuredShell.id,
          globalDepth: childNode.path.data.globalDepth,
          geometricHierarchy: 'simple',
          label: "Hueco"
        };
        
        configuredShell.data.holeIds.push(newElement.id);
        result.push(newElement);
      } else {
        // Es un elemento compuesto (ej. letras "A"): se crea como un Group con estructura geométrica interna
        const group = new paper.Group({ insert: false });
        
        buildHoleTree(childNode, configuredShell, group, target.fillColor, target.strokeColor, target.strokeWidth, isClipped, item, global, parent);
        
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
          label: "Objeto Compuesto"
        };
        result.push(finalGroupItem);
      }
    });

  } else {
    // CASO B: SI HAY MÚLTIPLES RAÍCES INDEPENDIENTES (estrellas, laureles, escudo mezclados)
    // Separamos únicamente las raíces independientes a nivel global
    roots.forEach(rootNode => {
      const built = buildUnifiedCompoundNode(rootNode);
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

// =========================================================================
// HOOKS DE SINCRONIZACIÓN GEOMÉTRICA GLOBAL (100% INMUNE A DESALINEACIONES)
// =========================================================================
function installHoleSyncHooks() {
  if (typeof paper === 'undefined' || !paper.Item) {
    setTimeout(installHoleSyncHooks, 100);
    return;
  }
  
  if (paper.Item.prototype.data?.hooksInstalled) return;

  // 1. Hook para position setter
  const desc = Object.getOwnPropertyDescriptor(paper.Item.prototype, 'position');
  if (desc && desc.set) {
    const originalPositionSetter = desc.set;
    Object.defineProperty(paper.Item.prototype, 'position', {
      set: function(newPos) {
        const oldPos = this.position.clone();
        originalPositionSetter.call(this, newPos);
        const delta = newPos.subtract(oldPos);
        if (delta.length > 0 && this.data && this.data.isOuterWithHoles && this.data.holeIds) {
          this.data.holeIds.forEach(holeId => {
            const holeItem = paper.project.getItem({ id: holeId });
            if (holeItem && !holeItem.selected) {
              holeItem.position = holeItem.position.add(delta);
            }
          });
        }
      },
      get: desc.get,
      configurable: true
    });
  }

  // 2. Hook para translate
  const originalTranslate = paper.Item.prototype.translate;
  paper.Item.prototype.translate = function(delta) {
    originalTranslate.call(this, delta);
    if (this.data && this.data.isOuterWithHoles && this.data.holeIds) {
      this.data.holeIds.forEach(holeId => {
        const holeItem = paper.project.getItem({ id: holeId });
        if (holeItem && !holeItem.selected) {
          holeItem.translate(delta);
        }
      });
    }
  };

  // 3. Hook para rotate
  const originalRotate = paper.Item.prototype.rotate;
  paper.Item.prototype.rotate = function(angle, center) {
    const rotCenter = center || this.position;
    originalRotate.call(this, angle, rotCenter);
    if (this.data && this.data.isOuterWithHoles && this.data.holeIds) {
      this.data.holeIds.forEach(holeId => {
        const holeItem = paper.project.getItem({ id: holeId });
        if (holeItem && !holeItem.selected) {
          holeItem.rotate(angle, rotCenter);
        }
      });
    }
  };

  // 4. Hook para scale
  const originalScale = paper.Item.prototype.scale;
  paper.Item.prototype.scale = function(hor, ver, center) {
    const scaleCenter = center || this.position;
    originalScale.call(this, hor, ver, scaleCenter);
    if (this.data && this.data.isOuterWithHoles && this.data.holeIds) {
      this.data.holeIds.forEach(holeId => {
        const holeItem = paper.project.getItem({ id: holeId });
        if (holeItem && !holeItem.selected) {
          holeItem.scale(hor, ver, scaleCenter);
        }
      });
    }
  };

  paper.Item.prototype.data = paper.Item.prototype.data || {};
  paper.Item.prototype.data.hooksInstalled = true;
  console.log("🔥 Hooks de sincronización geométrica global instalados con éxito en Paper.js.");
}

// Hook de arrastre reactivo secundario para HoleControllers individuales
function installHoleDragHook() {
  if (typeof paper === 'undefined' || !paper.tools || paper.tools.length === 0) {
    setTimeout(installHoleDragHook, 100);
    return;
  }
  
  const selectTool = paper.tools.find(t => t.onMouseDrag && !t.data?.holeHooked);
  if (!selectTool) return;
  
  const originalOnMouseDrag = selectTool.onMouseDrag;
  selectTool.onMouseDrag = function(event) {
    // Si arrastramos el escudo/silueta principal, los HoleControllers ya se mueven gracias a los hooks globales.
    originalOnMouseDrag.call(this, event);
    
    if (window.dragging && window.selectedItems) {
      window.selectedItems.forEach(item => {
        let outerItemId = null;
        if (item.data && item.data.isHoleController) {
          outerItemId = item.data.outerItemId;
        } else if (isGroup(item)) {
          const hc = item.children.find(c => c.data && c.data.isHoleController);
          if (hc) outerItemId = hc.data.outerItemId;
        }
        
        if (outerItemId) {
          const outerItem = paper.project.getItem({ id: outerItemId });
          if (outerItem && typeof window.updateOuterPathGeometry === 'function') {
            window.updateOuterPathGeometry(outerItem);
          }
        }
      });
    }
  };
  
  selectTool.data = selectTool.data || {};
  selectTool.data.holeHooked = true;
  console.log("🚀 Hook de arrastre interactivo secundario registrado con éxito en Paper.js.");
}

if (typeof window !== 'undefined') {
  installHoleSyncHooks();
  setTimeout(installHoleDragHook, 500);
  window.addEventListener("DOMContentLoaded", () => {
    installHoleSyncHooks();
    setTimeout(installHoleDragHook, 500);
  });
}

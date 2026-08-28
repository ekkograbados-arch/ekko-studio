/* =========================================================================
   Modulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Edition - v25.0 - Pure Geometry & Real-Time Laser Sync)
   Ruta de reemplazo: ASSETS/js/modules/canvas-pro/geometricUngroup.js
   Descripción: Motor de desagrupado geométrico progresivo, reactivo y universal.
                Cumple al 100% con la filosofía y las "Reglas de Oro" de EKKO Studio V23:
                - Los calados permanecen como ausencias físicas reales de material.
                - Sin simulación de huecos con cuerpos celestes o transparencias artificiales.
                - Descompone CompoundPaths en jerarquías de elementos simples o compuestos,
                  nivel por nivel, de afuera hacia adentro.
                - Integra un Hook Global en el ciclo de renderizado de Paper.js para
                  recalcular de forma síncrona y reactiva las sustracciones de los HoleControllers
                  calculando matrices relativas inversas (evitando conflictos de coordenadas).
========================================================================= */

// Inicializar el set global de seguimiento para optimización extrema de rendimiento
if (typeof window !== 'undefined') {
  window.activeOuterItemIds = window.activeOuterItemIds || new Set();
}

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

// Obtiene la matriz de transformación global de Paper.js
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

// Función recursiva para recolectar todos los descendientes de un nodo en el árbol de contención
function collectDescendantPaths(node, list) {
  node.children.forEach(child => {
    list.push(clonePath(child.path));
    collectDescendantPaths(child, list);
  });
}

// =========================================================================
// HOOK GLOBAL DE CALADO REACTIVO EN VIVO (Paper.js Render Cycle Integration)
// Recalcula dinámicamente las sustracciones físicas antes de refrescar pantalla
// resolviendo las coordenadas locales mediante matrices inversas absolutas.
// =========================================================================
if (typeof window !== 'undefined' && typeof window.updateOuterPathGeometry !== 'function') {
  window.updateOuterPathGeometry = function(outerItem) {
    if (!outerItem || !outerItem.data?.isOuterWithHoles || !outerItem.data?.originalPath) return;
    
    // Clonar la base sólida original (que no posee calados iniciales)
    let base = outerItem.data.originalPath.clone({ insert: false });
    
    // Obtener los HoleControllers activos referenciados
    const holeIds = outerItem.data.holeIds || [];
    const activeHoles = [];
    holeIds.forEach(id => {
      const hole = paper.project.getItem({ id: id });
      if (hole && hole.parent) {
        activeHoles.push(hole);
      }
    });
    
    // Restar físicamente cada HoleController utilizando booleanos nativos de Paper.js
    activeHoles.forEach(hole => {
      let holePath = hole;
      if (hole.className === 'Group') {
        // Para grupos compuestos (ej: letra "A"), el primer hijo representa el contorno exterior del calado
        holePath = hole.children.find(c => !c.clipMask) || hole;
      }
      
      // Obtener las transformaciones globales absolutas
      const holeGlobal = getGlobalMatrix(holePath);
      const outerGlobal = getGlobalMatrix(outerItem);
      
      // Calcular la matriz relativa inversa para llevar la geometría al espacio local de base
      const relMatrix = outerGlobal.inverted().chain(holeGlobal);
      
      // Clonar el HoleController y aplicarle la transformación local correspondiente
      const holeLocal = holePath.clone({ insert: false });
      holeLocal.matrix = relMatrix;
      
      // Realizar la resta booleana nativa en Paper.js
      const subtracted = base.subtract(holeLocal);
      if (subtracted) {
        base.remove();
        base = subtracted;
      }
      holeLocal.remove();
    });
    
    // Reemplazar la estructura geométrica interna de outerItem (que siempre es CompoundPath) de forma segura
    if (outerItem instanceof paper.CompoundPath) {
      outerItem.children.forEach(c => c.remove());
      if (base instanceof paper.CompoundPath) {
        base.children.forEach(c => outerItem.addChild(c.clone()));
      } else {
        outerItem.addChild(base.clone());
      }
    }
    
    base.remove();
  };
}

// Inyección del Hook en el prototipo de Paper.js View para automatización a prueba de fallos
if (typeof paper !== 'undefined' && paper.View && paper.View.prototype && !paper.View.prototype._hooked) {
  paper.View.prototype._hooked = true;
  const originalUpdate = paper.View.prototype.update;
  paper.View.prototype.update = function() {
    if (paper.project && window.activeOuterItemIds && window.activeOuterItemIds.size > 0) {
      window.activeOuterItemIds.forEach(id => {
        const outerItem = paper.project.getItem({ id: id });
        if (outerItem && outerItem.data && outerItem.data.isOuterWithHoles) {
          try {
            window.updateOuterPathGeometry(outerItem);
          } catch (e) {
            console.error("[EKKO SYNC ERROR] Fallo al recalcular sustracción física:", e);
          }
        } else {
          window.activeOuterItemIds.delete(id); // Limpieza de referencias huérfanas
        }
      });
    }
    return originalUpdate.apply(this, arguments);
  };
}

// =========================================================================
// MOTOR DE DESAGRUPADO GEOMÉTRICO PRINCIPAL
// =========================================================================
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

  // =========================================================================
  // CASO B: SI HAY MÚLTIPLES RAÍCES INDEPENDIENTES (1er Clic: estrellas, laurel, escudo mezclados)
  // =========================================================================
  if (roots.length > 1) {
    roots.forEach(rootNode => {
      const rootPathClone = clonePath(rootNode.path);
      const descendants = [];
      collectDescendantPaths(rootNode, descendants);

      let newElement;
      if (descendants.length > 0) {
        // Es compuesta unificada (ej: el Cuerpo del Escudo completo)
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
          label: rootNode.path.data?.label || "Cuerpo del Escudo"
        };
      } else {
        // Es simple (ej: estrellas, laurel)
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
          label: rootNode.path.data?.label || "Objeto"
        };
      }

      // Preservamos el estado de HoleController si el original ya lo era
      if (item.data?.isHoleController) {
        newElement.data.isHoleController = true;
        newElement.data.outerItemId = item.data.outerItemId;
      } else {
        delete newElement.data.isHoleController;
        delete newElement.data.outerItemId;
      }

      result.push(newElement);
    });

  } else {
    // =========================================================================
    // CASO A: SI HAY UNA SOLA RAÍZ EN LA SELECCIÓN (Cuerpo del Escudo en 2do clic, o letra "A" en 3er clic)
    // =========================================================================
    const root = roots[0];
    
    // Verificamos si tiene nietos (estrucura profunda como el Cuerpo del Escudo)
    let hasGrandchildren = false;
    root.children.forEach(child => {
      if (child.children.length > 0) {
        hasGrandchildren = true;
      }
    });

    if (hasGrandchildren) {
      // -----------------------------------------------------------------------
      // 2do Clic: Descomposición del Cuerpo del Escudo en Silueta y Huecos Reactivos
      // -----------------------------------------------------------------------
      
      // 1. Crear el contorno base sólido de Nivel 0 (La base sólida del Escudo) como CompoundPath
      const basePathClone = clonePath(root.path);
      basePathClone.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
      basePathClone.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
      basePathClone.strokeWidth = target.strokeWidth || 0;
      
      const shellCompound = new paper.CompoundPath({
        children: [basePathClone],
        insert: false,
        fillRule: 'evenodd'
      });
      
      let basePath;
      if (isClipped) {
        basePath = window.clipItem(shellCompound);
        basePath.matrix = item.matrix.clone();
      } else {
        basePath = shellCompound;
        basePath.matrix = global.clone();
        parent.addChild(basePath);
      }
      basePath.data = {
        ...(item.data || {}),
        locked: false,
        geometricHierarchy: 'simple',
        label: "Silueta del Escudo"
      };

      if (item.data?.isHoleController) {
        basePath.data.isHoleController = true;
        basePath.data.outerItemId = item.data.outerItemId;
      } else {
        delete basePath.data.isHoleController;
        delete basePath.data.outerItemId;
      }

      // Activar comportamiento de Calado Reactivo Geométrico Real
      basePath.data.isOuterWithHoles = true;
      basePath.data.originalPath = clonePath(root.path);
      basePath.data.holeIds = [];
      
      // Registrar en el set reactivo global
      window.activeOuterItemIds.add(basePath.id);

      // 2. Promover cada hijo directo (Nivel 1: bandas, "F", letras "A") como Hueco Físico (HoleController)
      root.children.forEach(childNode => {
        const childPathClone = clonePath(childNode.path);
        const descendants = [];
        collectDescendantPaths(childNode, descendants);
        
        let newElement;
        if (descendants.length > 0) {
          // El hijo es compuesto (ej: letra "A" con su triángulo)
          // Creación de un paper.Group puro con jerarquía "compound" para representar el hueco compuesto interactivo.
          // Esto preserva el triángulo interior como sólido visible negro y el contorno como hueco de corte reactivo.
          const group = new paper.Group({
            insert: false
          });
          
          // El contorno exterior de la "A" es un corte vacío puro (hueco físico, fillColor/strokeColor = null)
          childPathClone.fillColor = null;
          childPathClone.strokeColor = null;
          childPathClone.strokeWidth = 0;
          childPathClone.data = {
            geometricHierarchy: 'simple',
            label: "Hueco"
          };
          group.addChild(childPathClone);
          
          // Los descendientes (triángulo interior de la "A") se agregan como sólidos negros macizos
          descendants.forEach(desc => {
            const descClone = desc.clone();
            descClone.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
            descClone.strokeColor = null;
            descClone.strokeWidth = 0;
            descClone.data = {
              geometricHierarchy: 'simple',
              label: "Objeto"
            };
            group.addChild(descClone);
          });
          
          if (isClipped) {
            newElement = window.clipItem(group);
            newElement.matrix = item.matrix.clone();
          } else {
            newElement = group;
            newElement.matrix = global.clone();
            parent.addChild(newElement);
          }
          newElement.data = {
            ...(item.data || {}),
            locked: false,
            geometricHierarchy: 'compound',
            label: "Objeto Compuesto"
          };
        } else {
          // El hijo es simple (ej: bandas, "F")
          childPathClone.fillColor = null; // Vacío real interactivo sin parches celestes
          childPathClone.strokeColor = null; // EL HUECO ES HUECO, NO TIENE CONTORNO NI NADA (v23)
          childPathClone.strokeWidth = 0;
          
          if (isClipped) {
            newElement = window.clipItem(childPathClone);
            newElement.matrix = item.matrix.clone();
          } else {
            newElement = childPathClone;
            newElement.matrix = global.clone();
            parent.addChild(newElement);
          }
          newElement.data = {
            ...(item.data || {}),
            locked: false,
            geometricHierarchy: 'simple',
            label: "Hueco"
          };
        }
        
        // Registrar rigurosamente el elemento como HoleController del basePath
        newElement.data.isHoleController = true;
        newElement.data.outerItemId = basePath.id;
        
        basePath.data.holeIds.push(newElement.id);
        result.push(newElement);
      });

      result.unshift(basePath);

      // Ejecutar la primera sustracción síncrona
      if (typeof window.updateOuterPathGeometry === 'function') {
        window.updateOuterPathGeometry(basePath);
      }

    } else {
      // -----------------------------------------------------------------------
      // 3er Clic: Descomposición de Elemento Compuesto de 2 Niveles (ej: letra "A" independiente)
      // -----------------------------------------------------------------------
      
      // 1. Promover el contorno exterior de la letra "A" (como contorno vacío físico / HoleController)
      const outlineClone = clonePath(root.path);
      outlineClone.fillColor = null; // Vacío real transparente
      outlineClone.strokeColor = null; // EL HUECO ES HUECO, NO TIENE CONTORNO NI NADA (v23)
      outlineClone.strokeWidth = 0;
      
      let configuredOutline;
      if (isClipped) {
        configuredOutline = window.clipItem(outlineClone);
        configuredOutline.matrix = item.matrix.clone();
      } else {
        configuredOutline = outlineClone;
        configuredOutline.matrix = global.clone();
        parent.addChild(configuredOutline);
      }
      configuredOutline.data = {
        ...(item.data || {}),
        locked: false,
        geometricHierarchy: 'simple',
        label: "Hueco"
      };

      // Si el elemento desarmado ya era un HoleController, transferimos su estatus al outline
      if (item.data?.isHoleController) {
        configuredOutline.data.isHoleController = true;
        configuredOutline.data.outerItemId = item.data.outerItemId;
        
        // Actualizar el mapa de IDs en el escudo base para mantener la resta activa
        const outerItem = paper.project.getItem({ id: item.data.outerItemId });
        if (outerItem && outerItem.data?.holeIds) {
          const idx = outerItem.data.holeIds.indexOf(item.id);
          if (idx !== -1) {
            outerItem.data.holeIds[idx] = configuredOutline.id;
          } else {
            outerItem.data.holeIds.push(configuredOutline.id);
          }
        }
      } else {
        delete configuredOutline.data.isHoleController;
        delete configuredOutline.data.outerItemId;
      }

      result.push(configuredOutline);

      // 2. Promover cada hijo (el triángulo interior de la "A") como SÓLIDO negro macizo independiente
      root.children.forEach(childNode => {
        const childClone = clonePath(childNode.path);
        childClone.fillColor = target.fillColor ? target.fillColor.clone() : new paper.Color('#000000');
        childClone.strokeColor = target.strokeColor ? target.strokeColor.clone() : null;
        childClone.strokeWidth = target.strokeWidth || 0;
        
        let configuredChild;
        if (isClipped) {
          configuredChild = window.clipItem(childClone);
          configuredChild.matrix = item.matrix.clone();
        } else {
          configuredChild = childClone;
          configuredChild.matrix = global.clone();
          parent.addChild(configuredChild);
        }
        configuredChild.data = {
          ...(item.data || {}),
          locked: false,
          geometricHierarchy: 'simple',
          label: "Objeto"
        };
        
        // El triángulo es un sólido macizo, por lo tanto se sanea y limpia de la cadena de calados
        delete configuredChild.data.isHoleController;
        delete configuredChild.data.outerItemId;
        
        result.push(configuredChild);
      });

      // Recalcular la sustracción del escudo padre con la nueva referencia del outline
      if (configuredOutline.data.isHoleController && configuredOutline.data.outerItemId) {
        const outerItem = paper.project.getItem({ id: configuredOutline.data.outerItemId });
        if (outerItem && typeof window.updateOuterPathGeometry === 'function') {
          window.updateOuterPathGeometry(outerItem);
        }
      }
    }
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

  const isHole = !!item.data?.isHoleController;
  const outerItemId = item.data?.outerItemId;

  children.forEach((child, i) => {
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
    
    // Si el grupo era un HoleController (ej. letra "A" compuesta en el 3er clic), transferimos el estatus de calado al outline exterior (Hijo 0)
    if (isHole && i === 0) {
      newItem.data.isHoleController = true;
      newItem.data.outerItemId = outerItemId;
      newItem.data.label = "Hueco";
      
      const outerItem = paper.project.getItem({ id: outerItemId });
      if (outerItem && outerItem.data?.holeIds) {
        const idx = outerItem.data.holeIds.indexOf(item.id);
        if (idx !== -1) {
          outerItem.data.holeIds[idx] = newItem.id;
        } else {
          outerItem.data.holeIds.push(newItem.id);
        }
        
        // Sincronizar el calado síncronamente
        if (typeof window.updateOuterPathGeometry === 'function') {
          window.updateOuterPathGeometry(outerItem);
        }
      }
    } else {
      // Los sólidos promovidos de profundidad par (triángulo de la "A") se limpian de metadatos de calado
      delete newItem.data.isHoleController;
      delete newItem.data.outerItemId;
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
// FUNCIÓN DE VERIFICACIÓN DE LÍMITE DE DESAGRUPADO (Previene romper vectores para el Láser)
// =========================================================================
export function canUngroupItem(item) {
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return false;
  const target = item.data?.clipGroup ? getContentItem(item) : item;
  if (!target) return false;
  
  // Grupos tradicionales se pueden desagrupar
  if (isGroup(target) && !target.data?.clipGroup) return true;
  
  // Textos vectorizados se pueden desagrupar por letras
  if (target instanceof paper.PointText && target.content && target.content.length > 1) return true;
  
  // CompoundPaths compuestos se pueden deconstruir
  if (isCompoundPath(target)) {
    const paths = [...target.children].filter(p => p && p.bounds && !p.data?.mockup && !p.data?.isMask);
    return paths.length > 1; // Si tiene más de un trazado cerrado adentro, se puede desagrupar
  }
  
  return false;
}

// Registro global seguro
if (typeof window !== 'undefined') {
  window.canUngroupItem = canUngroupItem;
}

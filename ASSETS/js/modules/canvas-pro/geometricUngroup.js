/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js
Versión: v25.0 PRO - Motor de Descomposición por Jerarquía de Contención en 1 Clic
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

/**
 * Obtiene la matriz acumulada global de un elemento
 */
function getGlobalMatrix(item) {
  if (!item) return new paper.Matrix();
  if (item.data && item.data.globalMatrix) {
    return item.data.globalMatrix.clone();
  }
  let matrix = new paper.Matrix();
  let curr = item;
  while (curr && !(curr.className === 'Layer' || (typeof paper !== 'undefined' && paper.Layer && curr instanceof paper.Layer))) {
    if (curr.matrix) {
      matrix = curr.matrix.chain(matrix);
    }
    curr = curr.parent;
  }
  return matrix;
}

/**
 * Extrae recursivamente todos los contornos cerrados (Path) atómicos de una estructura,
 * absorbiendo matrices y desarmando grupos y trazados compuestos en un solo paso.
 */
function flattenToAtomicPaths(item, inheritedMatrix = null) {
  const atomicPaths = [];
  const currentMatrix = inheritedMatrix ? inheritedMatrix.chain(item.matrix) : item.matrix.clone();

  if (isPath(item)) {
    const clone = item.clone({ insert: false });
    clone.matrix = currentMatrix;
    clone.data = { ...(item.data || {}) };
    atomicPaths.push(clone);
  } else if (isCompoundPath(item) || isGroup(item)) {
    if (item.children) {
      const kids = [...item.children];
      kids.forEach(child => {
        if (!child.data?.mockup && !child.data?.isMask && !child.data?.isSelectionBox) {
          atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix));
        }
      });
    }
  }
  return atomicPaths;
}

/**
 * Determina si el trazado 'child' está contenido geométricamente dentro de 'parent'.
 * Utiliza muestreo multisequencial sobre los puntos perimetrales y el centroide.
 */
function isContainedIn(child, parent) {
  if (!child.bounds || !parent.bounds) return false;
  // Descarte rápido por bounding box
  if (!parent.bounds.intersects(child.bounds) && !parent.bounds.contains(child.bounds)) {
    return false;
  }

  const samplePoints = [child.bounds.center];
  if (child.segments && child.segments.length > 0) {
    const step = Math.max(1, Math.floor(child.segments.length / 8));
    for (let i = 0; i < child.segments.length; i += step) {
      samplePoints.push(child.segments[i].point);
    }
  }

  let insideVotes = 0;
  for (let p of samplePoints) {
    try {
      if (parent.contains(p)) insideVotes++;
    } catch (_) {}
  }
  return insideVotes > (samplePoints.length / 2);
}

/**
 * Construye el árbol topológico de contención anidada (De afuera hacia adentro).
 */
function buildContainmentTree(paths) {
  const nodes = paths.map(path => ({
    path,
    parent: null,
    children: [],
    depth: 0,
    area: Math.abs(path.area)
  }));

  // Ordenar de mayor a menor área para evaluar inclusión lógica
  nodes.sort((a, b) => b.area - a.area);

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (isContainedIn(nodes[j].path, nodes[i].path)) {
        // Encontrar el contenedor más íntimo
        if (!nodes[j].parent || nodes[i].area < nodes[j].parent.area) {
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
 * Recupera la geometría original sin sustracción con sus transformaciones aplicadas.
 */
export function getGlobalUnsubtractedPath(item) {
  if (!item || !item.data || !item.data.geomBase) return null;
  const tempBase = item.data.geomBase.clone({ insert: false });
  tempBase.matrix = item.matrix.clone();
  return tempBase;
}

/**
 * MOTOR DE RECÁLCULO REACTIVO CSG (No destructivo por orden Z).
 * Las geometrías negativas (isHole) sustraen masa física de las capas inferiores
 * preservando la geometría base original intacta.
 */
export function recalculateDynamicSubtractions(layer) {
  const activeLayer = layer || (typeof paper !== 'undefined' && paper.project ? paper.project.activeLayer : null);
  if (!activeLayer) return;

  const items = [...activeLayer.children].filter(
    item => item && !item.data?.locked && !item.data?.mockup && !item.data?.isMask &&
            !item.data?.isSelectionBox && !item.data?.isHandle && !item.data?.isMeasurement
  );

  // 1. Restaurar todas las masas sólidas a su geometría base original
  items.forEach(item => {
    if (item.data && item.data.geomBase && !item.data.isHole) {
      const pristine = getGlobalUnsubtractedPath(item);
      if (pristine) {
        item.pathData = pristine.pathData;
        item.visible = true;
        pristine.remove();
      }
    }
  });

  // 2. Iterar en orden descendente de Z (de arriba hacia abajo)
  for (let i = items.length - 1; i >= 0; i--) {
    const hole = items[i];
    if (hole && hole.data && hole.data.isHole) {
      const holeBase = getGlobalUnsubtractedPath(hole);
      if (!holeBase || !(holeBase instanceof paper.PathItem)) {
        if (holeBase) holeBase.remove();
        continue;
      }

      // Sustrae únicamente de las capas que se encuentran por DEBAJO en el orden Z
      for (let j = i - 1; j >= 0; j--) {
        const solid = items[j];
        if (!solid || solid.data?.isHole || !solid.data?.geomBase) continue;

        if (solid.bounds && hole.bounds && solid.bounds.intersects(hole.bounds)) {
          try {
            const subtracted = solid.subtract(holeBase, { insert: false });
            if (subtracted) {
              if (subtracted.pathData && subtracted.pathData.trim().length > 0) {
                solid.pathData = subtracted.pathData;
                solid.visible = true;
              } else {
                solid.pathData = "";
                solid.visible = false; // Desintegración física si fue sustraído totalmente
              }
              subtracted.remove();
            }
          } catch (err) {
            console.warn("[EKKO CSG RECALC ERROR]", err);
          }
        }
      }
      holeBase.remove();
    }
  }

  if (typeof paper !== 'undefined' && paper.view) {
    paper.view.update();
  }
}

/**
 * DESCOMPOSICIÓN INTEGRAL POR JERARQUÍA DE CONTENCIÓN (Un solo clic).
 * Descompone masas positivas y huecos activos respetando la relación Z:
 * Raíz/Fondo (Z0) -> Intermedio (Z1) -> Interior (Z2...)
 */
export function decomposeByContainmentHierarchy(rootTarget) {
  if (!rootTarget || rootTarget.data?.locked || rootTarget.data?.mockup || rootTarget.data?.isMask) {
    return null;
  }

  // 1. Desarmar toda la estructura a siluetas atómicas en un solo paso
  const atomicPaths = flattenToAtomicPaths(rootTarget);
  if (atomicPaths.length === 0) return null;

  // 2. Construir árbol de contención anidada
  const { nodes } = buildContainmentTree(atomicPaths);

  const parent = rootTarget.parent || paper.project.activeLayer;
  const insertIndex = parent.children.indexOf(rootTarget);
  const resultingItems = [];

  // 3. Ordenar por profundidad: de menor a mayor (Z0 exterior macizo -> Zn interior)
  // El exterior queda al fondo de la pila Z y los elementos anidados por encima
  nodes.sort((a, b) => a.depth - b.depth);

  nodes.forEach((node, idx) => {
    const isHole = (node.depth % 2 === 1); // Regla de alternancia par = sólido, impar = calado activo
    const pathItem = node.path.clone({ insert: false });

    // Preservar la geometría base inmaculada sin transformaciones destructivas
    const geomBase = pathItem.clone({ insert: false });
    geomBase.matrix = new paper.Matrix();

    pathItem.data = {
      locked: false,
      isHole: isHole,
      geomBase: geomBase,
      layerDepth: node.depth,
      label: isHole ? `Hueco Activo (Nivel ${node.depth})` : `Masa Positiva (Nivel ${node.depth})`
    };

    if (isHole) {
      // El hueco es una entidad física invisible que actúa geométricamente
      pathItem.fillColor = null;
      pathItem.strokeColor = null;
      pathItem.strokeWidth = 0;
      pathItem.opacity = 0.001; // Permite selección interactiva sin proyectar color de relleno
    } else {
      pathItem.fillColor = rootTarget.fillColor ? rootTarget.fillColor.clone() : new paper.Color(0);
      pathItem.strokeColor = rootTarget.strokeColor ? rootTarget.strokeColor.clone() : null;
      pathItem.strokeWidth = rootTarget.strokeWidth || 0;
    }

    // Movimiento reactivo en tiempo real
    pathItem.onMouseDrag = function(event) {
      this.position = this.position.add(event.delta);
      recalculateDynamicSubtractions(parent);
    };

    resultingItems.push(pathItem);
  });

  // Limpiar paths atómicos temporales
  atomicPaths.forEach(p => p.remove());

  // 4. Remover el contenedor original e insertar las capas en orden Z ascendente
  rootTarget.remove();

  if (insertIndex !== -1 && parent.insertChild) {
    resultingItems.forEach((item, i) => parent.insertChild(insertIndex + i, item));
  } else {
    resultingItems.forEach(item => parent.addChild(item));
  }

  // 5. Ejecutar la sustracción dinámica CSG inicial
  recalculateDynamicSubtractions(parent);

  return { handled: true, items: resultingItems };
}

// Exposición en el entorno global
if (typeof window !== 'undefined') {
  window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
  window.decomposeByContainmentHierarchy = decomposeByContainmentHierarchy;
  // Compatibilidad con invocaciones históricas
  window.geometricUngroupCompound = decomposeByContainmentHierarchy;
}
Módulo 2: Actualización en ASSETS/js/modules/canvas-pro/contextualMenu.js
Reemplazo unificado de la función ungroupSelectedItem para erradicar las ramificaciones que impedían la desagrupación en un clic
:
import { decomposeByContainmentHierarchy, recalculateDynamicSubtractions } from "./geometricUngroup.js";

export function ungroupSelectedItem() {
  if (typeof window !== 'undefined') {
    console.log("%c[EKKO UNGROUP] Ejecutando Descomposición por Jerarquía de Contención (1 Clic) 🔓", "color: #ffffff; background: #0284c7; padding: 4px 8px; font-weight: bold; border-radius: 4px;");
  }

  if (window.nodeEditMode && typeof window.exitNodeEditMode === 'function') {
    window.exitNodeEditMode();
  }

  const rawSelected = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);

  if (rawSelected.length === 0) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  let allCreatedItems = [];

  rawSelected.forEach(item => {
    if (!item || (item.data && item.data.locked)) return;

    const actualItem = item.data?.clipGroup ? getContentItem(item) : item;
    if (!actualItem) return;

    // Ejecutar descomposición completa en un solo clic sobre cualquier grupo o trazado compuesto
    const result = decomposeByContainmentHierarchy(actualItem);
    if (result && result.items) {
      allCreatedItems.push(...result.items);
    }
  });

  // Selección individual del elemento primario resultante
  if (allCreatedItems.length > 0) {
    window.deselectItem();
    setTimeout(() => {
      const primary = allCreatedItems[allCreatedItems.length - 1]; // Selecciona la capa superior (ej. triángulo)
      window.selectedItems = [primary];
      window.selectedItem = primary;
      primary.selected = true;

      if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(primary);
      if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(primary);
    }, 50);
  }
}

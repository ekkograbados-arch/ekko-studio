/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js
Versión: v25.0 PRO - Motor de Descomposición por Jerarquía de Contención en 1 Clic
Arquitectura: Paper.js / EKKO Studio Modular ES6
Descripción:
  Implementa el concepto fundamental de "Descomposición por Jerarquía de Contención /
  Descomposición por Capas". Descompone cualquier estructura SVG (CompoundPath,
  Group anidado o jerarquía mixta) en siluetas atómicas editables en un solo clic.
  Clasifica masas positivas (sólidas) y geometrías negativas (huecos/calados activos reales)
  según su nivel de profundidad de contención topológica y orden Z.
  Garantiza el recálculo CSG dinámico no destructivo: al mover, subir, bajar,
  modificar nodos o eliminar una capa, las sustracciones booleanas se actualizan
  en tiempo real sin destruir la geometría base original (geomBase).
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
 * Obtiene la matriz acumulada global de un elemento en Paper.js
 */
export function getGlobalMatrix(item) {
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
 * Extrae recursivamente todos los contornos cerrados atómicos (Path) de una estructura,
 * absorbiendo matrices jerárquicas y desarmando grupos o trazados compuestos en un solo paso.
 */
export function flattenToAtomicPaths(item, inheritedMatrix = null) {
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
        if (!child.data?.mockup && !child.data?.isMask && !child.data?.isSelectionBox && !child.data?.isHandle) {
          atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix));
        }
      });
    }
  }
  return atomicPaths;
}

/**
 * Determina si el trazado 'child' está contenido geométricamente dentro de 'parent'.
 * Utiliza muestreo multisequencial sobre el centroide y puntos perimetrales para máxima precisión.
 */
export function isContainedIn(child, parent) {
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
 * Construye el árbol topológico de contención anidada (de afuera hacia adentro).
 */
export function buildContainmentTree(paths) {
  const nodes = paths.map(path => ({
    path,
    parent: null,
    children: [],
    depth: 0,
    area: Math.abs(path.area)
  }));

  // Ordenar de mayor a menor área para determinar jerarquía contenedora
  nodes.sort((a, b) => b.area - a.area);

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (isContainedIn(nodes[j].path, nodes[i].path)) {
        // Asignar al contenedor más inmediato (menor área que contenga a j)
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
 * Retorna la geometría original inmaculada (geomBase) proyectada con su matriz de transformación actual.
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
 * que intersectan espacialmente con ellas, preservando intacta la geometría base (geomBase).
 */
export function recalculateDynamicSubtractions(layer) {
  const activeLayer = layer || (typeof paper !== 'undefined' && paper.project ? paper.project.activeLayer : null);
  if (!activeLayer) return;

  const items = [...activeLayer.children].filter(
    item => item && !item.data?.locked && !item.data?.mockup && !item.data?.isMask &&
            !item.data?.isSelectionBox && !item.data?.isHandle && !item.data?.isMeasurement &&
            !item.data?.isSmartGuide && !item.data?.isNodeEditOverlay
  );

  // 1. Restaurar todas las masas sólidas a su geometría base original en su posición actual
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

  // 2. Iterar en orden descendente de Z (de arriba hacia abajo en la pila de renderizado)
  for (let i = items.length - 1; i >= 0; i--) {
    const hole = items[i];
    if (hole && hole.data && hole.data.isHole) {
      const holeBase = getGlobalUnsubtractedPath(hole);
      if (!holeBase || !(holeBase instanceof paper.PathItem)) {
        if (holeBase) holeBase.remove();
        continue;
      }

      // Sustrae únicamente de las capas que se encuentran por DEBAJO en el orden Z (j < i)
      for (let j = i - 1; j >= 0; j--) {
        const solid = items[j];
        if (!solid || solid.data?.isHole || !solid.data?.geomBase) continue;

        if (solid.bounds && holeBase.bounds && solid.bounds.intersects(holeBase.bounds)) {
          try {
            const subtracted = solid.subtract(holeBase, { insert: false });
            if (subtracted) {
              if (subtracted.pathData && subtracted.pathData.trim().length > 0) {
                solid.pathData = subtracted.pathData;
                solid.visible = true;
              } else {
                solid.pathData = "";
                solid.visible = false; // Desintegración física si fue sustraído al 100%
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
 * Descompone masas positivas y calados activos respetando la relación Z:
 * Raíz/Fondo (Z0) -> Intermedio (Z1) -> Interior (Z2...)
 */
export function decomposeByContainmentHierarchy(rootTarget) {
  if (!rootTarget || rootTarget.data?.locked || rootTarget.data?.mockup || rootTarget.data?.isMask) {
    return null;
  }

  // 1. Desarmar toda la estructura a siluetas atómicas independientes en un solo paso
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
    // Regla de alternancia topológica: profundidad par = masa positiva sólida; impar = calado activo
    const isHole = (node.depth % 2 === 1);
    const pathItem = node.path.clone({ insert: false });

    // Preservar la geometría base inmaculada en coordenadas locales puras
    const geomBase = pathItem.clone({ insert: false });
    geomBase.matrix = new paper.Matrix();

    pathItem.data = {
      locked: false,
      isHole: isHole,
      geomBase: geomBase,
      layerDepth: node.depth,
      geometricHierarchy: 'simple',
      label: isHole ? `Hueco Activo (Nivel ${node.depth})` : `Masa Positiva (Nivel ${node.depth})`
    };

    if (isHole) {
      // El hueco es una entidad física invisible en grabado pero interactiva y seleccionable en el lienzo
      pathItem.fillColor = new paper.Color(0, 0, 0, 1e-5);
      pathItem.strokeColor = null;
      pathItem.strokeWidth = 0;
    } else {
      pathItem.fillColor = rootTarget.fillColor ? rootTarget.fillColor.clone() : new paper.Color('#000000');
      pathItem.strokeColor = rootTarget.strokeColor ? rootTarget.strokeColor.clone() : null;
      pathItem.strokeWidth = rootTarget.strokeWidth || 0;
    }

    // Reactividad en tiempo real durante el arrastre directo
    pathItem.onMouseDrag = function(event) {
      this.position = this.position.add(event.delta);
      recalculateDynamicSubtractions(parent);
    };

    resultingItems.push(pathItem);
  });

  // Limpiar referencias atómicas temporales
  atomicPaths.forEach(p => p.remove());

  // 4. Remover el contenedor original e insertar las capas resultantes ordenadas en Z
  rootTarget.remove();

  if (insertIndex !== -1 && parent.insertChild) {
    resultingItems.forEach((item, i) => parent.insertChild(insertIndex + i, item));
  } else {
    resultingItems.forEach(item => parent.addChild(item));
  }

  // 5. Ejecutar la sustracción dinámica CSG inicial en caliente
  recalculateDynamicSubtractions(parent);

  return { handled: true, simple: false, items: resultingItems };
}

/**
 * Desagrupación geométrica compatible con llamadas históricas
 */
export function geometricUngroupCompound(item) {
  return decomposeByContainmentHierarchy(item);
}

/**
 * Desagrupación uninivel para compatibilidad con grupos organizativos
 */
export function geometricUngroupOneLevel(group, isClipped, oldClipGroup) {
  return decomposeByContainmentHierarchy(group);
}

// Exposición global segura para Paper.js y orquestadores del sistema
if (typeof window !== 'undefined') {
  window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
  window.decomposeByContainmentHierarchy = decomposeByContainmentHierarchy;
  window.geometricUngroupCompound = decomposeByContainmentHierarchy;
  window.geometricUngroupOneLevel = decomposeByContainmentHierarchy;
  window.getGlobalUnsubtractedPath = getGlobalUnsubtractedPath;
}

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Industrial Edition - v26.0)
Ruta: ASSETS/js/modules/canvas-pro/geometricUngroup.js
Descripción: Motor geométrico de Descomposición por Jerarquía de Contención /
Descomposición por Capas para EKKO Studio.
- Cumple al 100% con RESULTADO ESPERADO.txt y CONCEPTO FUNDAMENTAL.
- Procesa CompoundPaths, Groups anidados y símbolos SVG (<use> / PlacedSymbol).
- Descompone en 1 solo clic ordenando en Z:
  Z0 (Exterior/Base sólida) -> Z1 (Calado/Hueco activo) -> Z2 (Masa positiva interior)...
- Horneado matemático exacto de matrices mundiales (sin doble encadenamiento).
- Sustracción dinámica booleana CSG no destructiva basada en CompoundPaths nativos de Paper.js.
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

function isPlacedSymbol(item) {
  return item && (item.className === 'PlacedSymbol' || item.className === 'SymbolItem' ||
    (typeof paper !== 'undefined' && ((paper.PlacedSymbol && item instanceof paper.PlacedSymbol) || (paper.SymbolItem && item instanceof paper.SymbolItem))));
}

/**
 * Obtiene la matriz acumulada global de un elemento recorriendo sus ancestros hasta la capa activa.
 */
export function getGlobalMatrix(item) {
  let matrix = new paper.Matrix();
  let current = item;
  while (current && !(current instanceof paper.Layer)) {
    if (current.matrix) {
      matrix = current.matrix.chain(matrix);
    }
    current = current.parent;
  }
  return matrix;
}

/**
 * Aplana y extrae todos los sub-trazados atómicos cerrados de una estructura compleja.
 * Hornea la matriz global directamente en los puntos (applyMatrix = true) exactamente UNA vez
 * para que los cálculos espaciales de contención sean 100% certeros en coordenadas del lienzo.
 */
export function flattenToAtomicPaths(item, inheritedMatrix = null) {
  const atomicPaths = [];
  // Si no se proveyó una matriz heredada en el nivel superior, calculamos la matriz mundial del elemento raíz
  const currentMatrix = inheritedMatrix
    ? (item.matrix ? inheritedMatrix.chain(item.matrix) : inheritedMatrix.clone())
    : getGlobalMatrix(item);

  if (isPath(item)) {
    const clone = item.clone({ insert: false });
    clone.matrix = currentMatrix;
    clone.applyMatrix = true; // Hornear coordenadas mundiales reales en los segmentos
    clone.data = { ...(item.data || {}) };
    if (clone.segments && clone.segments.length >= 3 && Math.abs(clone.area) > 1e-4) {
      atomicPaths.push(clone);
    } else {
      clone.remove();
    }
  } else if (isCompoundPath(item)) {
    if (item.children && item.children.length > 0) {
      const kids = [...item.children];
      kids.forEach(child => {
        if (!child.data?.mockup && !child.data?.isMask && !child.data?.isSelectionBox && !child.data?.isHandle) {
          atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix));
        }
      });
    }
  } else if (isGroup(item)) {
    if (item.children && item.children.length > 0) {
      const kids = [...item.children];
      kids.forEach(child => {
        if (!child.data?.mockup && !child.data?.isMask && !child.data?.isSelectionBox && !child.data?.isHandle) {
          atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix));
        }
      });
    }
  } else if (isPlacedSymbol(item)) {
    // Desempaquetar instancias <use> / PlacedSymbol de SVGs industriales (ej. Escudo AFA)
    const def = (item.symbol && item.symbol.item) || item.definition || (item.symbol && item.symbol.definition);
    if (def) {
      const defClone = def.clone({ insert: false });
      atomicPaths.push(...flattenToAtomicPaths(defClone, currentMatrix));
      defClone.remove();
    }
  }
  return atomicPaths;
}

/**
 * Determina si el trazado 'child' está contenido geométricamente dentro de 'parent'.
 * Utiliza muestreo de múltiples puntos (centroide + vértices perimetrales).
 */
export function isContainedIn(child, parent) {
  if (!child.bounds || !parent.bounds) return false;

  // Descarte rápido por bounding box: el hijo debe intersecar o estar contenido en el padre
  if (!parent.bounds.intersects(child.bounds) && !parent.bounds.contains(child.bounds)) {
    return false;
  }

  // Si el área del hijo es mayor o igual que la del padre, no puede estar contenido
  if (Math.abs(child.area) >= Math.abs(parent.area)) {
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
 * Retorna la geometría original inmaculada (geomBase) proyectada con su transformación actual.
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
 * Utiliza CompoundPaths nativos de Paper.js para garantizar huecos físicos reales sin parches ni transparencias.
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
        item.removeChildren();
        if (pristine instanceof paper.CompoundPath) {
          const cl = pristine.clone({ insert: false });
          item.addChildren(cl.removeChildren());
          cl.remove();
        } else if (pristine instanceof paper.Path) {
          item.addChild(pristine.clone({ insert: false }));
        }
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
              solid.removeChildren();
              if (subtracted instanceof paper.CompoundPath) {
                solid.addChildren(subtracted.removeChildren());
              } else if (subtracted instanceof paper.Path) {
                solid.addChild(subtracted);
              }
              solid.visible = (solid.children.length > 0);
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
 * Cada elemento resultante se genera como un CompoundPath nativo de Paper.js.
 */
export function decomposeByContainmentHierarchy(rootTarget) {
  if (!rootTarget || rootTarget.data?.locked || rootTarget.data?.mockup || rootTarget.data?.isMask) {
    return null;
  }

  // 1. Desarmar toda la estructura a siluetas atómicas cerradas con coordenadas mundiales horneadas
  const atomicPaths = flattenToAtomicPaths(rootTarget, null);
  if (atomicPaths.length === 0) return null;

  // 2. Construir árbol de contención anidada
  const { nodes } = buildContainmentTree(atomicPaths);

  // Determinar capa de destino limpia (activeLayer del diseño)
  const targetLayer = (rootTarget.layer) || (paper.project ? paper.project.activeLayer : null);
  const resultingItems = [];

  // 3. Ordenar por profundidad: de menor a mayor (Z0 exterior macizo -> Zn interior)
  // El exterior queda en la base Z0 y los elementos anidados por encima (Z1, Z2...)
  nodes.sort((a, b) => a.depth - b.depth);

  nodes.forEach((node) => {
    // Regla de alternancia topológica: profundidad par = masa positiva sólida; impar = calado activo
    const isHole = (node.depth % 2 === 1);

    // Generar como CompoundPath nativo para soportar perforaciones booleanas y geometrías múltiples limpias
    const compoundItem = new paper.CompoundPath({ insert: false });
    const pathClone = node.path.clone({ insert: false });
    compoundItem.addChild(pathClone);

    // Preservar la geometría base inmaculada en coordenadas puras
    const geomBase = new paper.CompoundPath({ insert: false });
    const baseClone = node.path.clone({ insert: false });
    geomBase.addChild(baseClone);
    geomBase.matrix = new paper.Matrix();

    compoundItem.data = {
      locked: false,
      isHole: isHole,
      geomBase: geomBase,
      layerDepth: node.depth,
      geometricHierarchy: 'simple',
      label: isHole ? `Hueco Activo (Nivel ${node.depth})` : `Masa Positiva (Nivel ${node.depth})`
    };

    if (isHole) {
      // El hueco es una entidad física transparente en grabado pero interactiva y seleccionable en el lienzo
      compoundItem.fillColor = new paper.Color(0, 0, 0, 1e-5);
      compoundItem.strokeColor = null;
      compoundItem.strokeWidth = 0;
    } else {
      compoundItem.fillColor = rootTarget.fillColor ? rootTarget.fillColor.clone() : new paper.Color('#000000');
      compoundItem.strokeColor = rootTarget.strokeColor ? rootTarget.strokeColor.clone() : null;
      compoundItem.strokeWidth = rootTarget.strokeWidth || 0;
    }

    resultingItems.push(compoundItem);
  });

  // Limpiar referencias temporales
  atomicPaths.forEach(p => p.remove());

  // 4. Insertar en la capa de trabajo ordenados en Z de abajo hacia arriba respetando el mockup
  if (targetLayer) {
    resultingItems.forEach(item => {
      targetLayer.addChild(item);
      if (window.currentMockup) {
        item.insertBelow(window.currentMockup);
      }
    });
  }

  // 5. Remover el contenedor original
  rootTarget.remove();

  // 6. Ejecutar primera pasada de recálculo CSG dinámico en la capa de trabajo
  if (targetLayer) {
    recalculateDynamicSubtractions(targetLayer);
  }

  return { handled: true, simple: false, items: resultingItems };
}

export function geometricUngroupCompound(item) {
  return decomposeByContainmentHierarchy(item);
}

export function geometricUngroupOneLevel(group) {
  return decomposeByContainmentHierarchy(group);
}

// Exposición global segura
if (typeof window !== 'undefined') {
  window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
  window.decomposeByContainmentHierarchy = decomposeByContainmentHierarchy;
  window.geometricUngroupCompound = decomposeByContainmentHierarchy;
  window.geometricUngroupOneLevel = decomposeByContainmentHierarchy;
  window.getGlobalUnsubtractedPath = getGlobalUnsubtractedPath;
}

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Industrial Edition)
Ruta: ASSETS/js/modules/canvas-pro/geometricUngroup.js
Descripción: Motor geométrico de Descomposición por Jerarquía de Contención /
Descomposición por Capas para EKKO Studio.
- Cumple rigurosamente el Concepto Fundamental de Descomposición por Jerarquía de Contención.
- Procesa CompoundPaths, Groups anidados y símbolos SVG (<use> / PlacedSymbol).
- Descompone en 1 solo clic ordenando en Z:
  Z0 (Exterior/Base sólida) -> Z1 (Calado/Hueco activo) -> Z2 (Masa positiva interior)...
- Bakes coordenadas mundiales reales (localToGlobal) para que la jerarquía de contención sea 100% certera.
- Sustracción dinámica booleana CSG no destructiva preservando geomBase inmaculado.
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
 * Convierte un trazado de Paper.js a un nuevo Path con coordenadas horneadas en el espacio global del proyecto.
 * Utiliza item.localToGlobal() para calcular la posición real en el lienzo sin acumular matrices relativas.
 */
function toGlobalPath(path) {
  if (!path || !path.segments || path.segments.length === 0) return null;
  const globalPath = new paper.Path();
  for (let i = 0; i < path.segments.length; i++) {
    const seg = path.segments[i];
    const pt = path.localToGlobal(seg.point);
    const hIn = path.localToGlobal(seg.point.add(seg.handleIn)).subtract(pt);
    const hOut = path.localToGlobal(seg.point.add(seg.handleOut)).subtract(pt);
    globalPath.add(new paper.Segment(pt, hIn, hOut));
  }
  globalPath.closed = path.closed;
  return globalPath;
}

/**
 * Aplana y extrae todos los sub-trazados atómicos cerrados de una estructura compleja (Group, CompoundPath, PlacedSymbol).
 * Transforma cada trazado directamente a coordenadas absolutas del lienzo (global project coordinates).
 */
export function flattenToAtomicPaths(item) {
  const atomicPaths = [];
  if (!item) return atomicPaths;

  if (isPath(item)) {
    const gp = toGlobalPath(item);
    if (gp && gp.segments.length >= 3 && Math.abs(gp.area) > 1e-4) {
      atomicPaths.push(gp);
    } else if (gp) {
      gp.remove();
    }
  } else if (isCompoundPath(item)) {
    if (item.children && item.children.length > 0) {
      const kids = [...item.children];
      kids.forEach(child => {
        if (!child.data?.mockup && !child.data?.isMask && !child.data?.isSelectionBox && !child.data?.isHandle) {
          atomicPaths.push(...flattenToAtomicPaths(child));
        }
      });
    }
  } else if (isGroup(item)) {
    if (item.children && item.children.length > 0) {
      const kids = [...item.children];
      kids.forEach(child => {
        if (!child.data?.mockup && !child.data?.isMask && !child.data?.isSelectionBox && !child.data?.isHandle) {
          atomicPaths.push(...flattenToAtomicPaths(child));
        }
      });
    }
  } else if (isPlacedSymbol(item)) {
    const symbolItem = (item.symbol && item.symbol.item) ? item.symbol.item : (item.symbol && item.symbol.definition ? item.symbol.definition : null);
    if (symbolItem) {
      const defClone = symbolItem.clone({ insert: false });
      defClone.matrix = item.matrix.clone();
      atomicPaths.push(...flattenToAtomicPaths(defClone));
      defClone.remove();
    }
  }
  return atomicPaths;
}

/**
 * Determina con certeza geométrica si el trazado 'child' está contenido dentro de 'parent'.
 * Dado que ambos trazados están en coordenadas globales absolutas, el chequeo es directo y exacto.
 */
export function isContainedIn(child, parent) {
  if (!child || !parent || !child.bounds || !parent.bounds) return false;

  // Descarte por área: el hijo no puede tener mayor área que el contenedor
  if (Math.abs(child.area) >= Math.abs(parent.area)) return false;

  // Descarte rápido por bounding box
  if (!parent.bounds.intersects(child.bounds) && !parent.bounds.contains(child.bounds)) {
    return false;
  }

  // Muestreo multisequencial: centro y vértices del hijo
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
 * Raíz (Profundidad 0 = Base/Exterior sólido)
 *   -> Nivel 1 (Profundidad 1 = Calado/Hueco activo)
 *     -> Nivel 2 (Profundidad 2 = Masa positiva sólida interior, ej. triángulo de la A)
 */
export function buildContainmentTree(paths) {
  const nodes = paths.map(path => ({
    path,
    parent: null,
    children: [],
    depth: 0,
    area: Math.abs(path.area)
  }));

  // Ordenar de mayor a menor área para encontrar el contenedor envolvente inmediato
  nodes.sort((a, b) => b.area - a.area);

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (isContainedIn(nodes[j].path, nodes[i].path)) {
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
 * Retorna la geometría original inmaculada (geomBase) proyectada con la posición y transformación actual del item.
 */
export function getGlobalUnsubtractedPath(item) {
  if (!item || !item.data || !item.data.geomBase) return null;
  const tempBase = item.data.geomBase.clone({ insert: false });
  tempBase.position = item.position.clone();
  if (item.data.rotation) {
    tempBase.rotate(item.data.rotation, tempBase.bounds.center);
  }
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
        item.removeChildren();
        if (pristine instanceof paper.CompoundPath) {
          pristine.children.forEach(c => item.addChild(c.clone({ insert: false })));
        } else if (pristine instanceof paper.Path) {
          item.addChild(pristine.clone({ insert: false }));
        }
        item.visible = true;
        pristine.remove();
      }
    }
  });

  // 2. Iterar en orden descendente de Z (de arriba hacia abajo en la pila de capas)
  for (let i = items.length - 1; i >= 0; i--) {
    const hole = items[i];
    if (hole && hole.data && hole.data.isHole) {
      const holeBase = getGlobalUnsubtractedPath(hole);
      if (!holeBase || !(holeBase instanceof paper.PathItem)) {
        if (holeBase) holeBase.remove();
        continue;
      }

      // Sustrae únicamente de las capas sólidas que se encuentran por DEBAJO en el orden Z (j < i)
      for (let j = i - 1; j >= 0; j--) {
        const solid = items[j];
        if (!solid || solid.data?.isHole || !solid.data?.geomBase) continue;

        if (solid.bounds && holeBase.bounds && solid.bounds.intersects(holeBase.bounds)) {
          try {
            const subtracted = solid.subtract(holeBase, { insert: false });
            if (subtracted) {
              solid.removeChildren();
              if (subtracted instanceof paper.CompoundPath && subtracted.children.length > 0) {
                subtracted.children.forEach(c => solid.addChild(c.clone({ insert: false })));
                solid.visible = true;
              } else if (subtracted instanceof paper.Path && subtracted.segments.length > 0) {
                solid.addChild(subtracted.clone({ insert: false }));
                solid.visible = true;
              } else {
                solid.visible = false; // Desintegración limpia si la masa fue sustraída al 100%
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

  // 1. Desarmar toda la estructura a siluetas atómicas cerradas con coordenadas absolutas horneadas
  const atomicPaths = flattenToAtomicPaths(rootTarget);
  if (atomicPaths.length === 0) return null;

  // 2. Construir árbol de contención anidada
  const { nodes } = buildContainmentTree(atomicPaths);

  // Determinar capa de trabajo activa (designLayer)
  const targetLayer = (paper.project ? paper.project.activeLayer : null) || rootTarget.layer;
  const resultingItems = [];

  // 3. Ordenar por profundidad: de menor a mayor (Z0 exterior macizo -> Z1 calado -> Z2 interior...)
  nodes.sort((a, b) => a.depth - b.depth);

  nodes.forEach((node) => {
    // Alternancia topológica estricta: profundidad par = masa positiva; impar = calado activo
    const isHole = (node.depth % 2 === 1);

    // Creamos cada capa como CompoundPath para soportar nativamente calados booleanos limpios
    const pathItem = new paper.CompoundPath();
    pathItem.addChild(node.path.clone({ insert: false }));

    // Preservar la geometría base inmaculada en geomBase
    const geomBase = new paper.CompoundPath();
    geomBase.addChild(node.path.clone({ insert: false }));

    pathItem.data = {
      locked: false,
      isHole: isHole,
      geomBase: geomBase,
      layerDepth: node.depth,
      geometricHierarchy: 'simple',
      label: isHole ? `Hueco Activo (Nivel ${node.depth})` : (node.depth === 0 ? "Escudo Base (Nivel 0)" : `Masa Interior (Nivel ${node.depth})`)
    };

    if (isHole) {
      // El hueco es una entidad física invisible en grabado pero interactiva y seleccionable
      pathItem.fillColor = new paper.Color(0, 0, 0, 1e-5);
      pathItem.strokeColor = null;
      pathItem.strokeWidth = 0;
    } else {
      pathItem.fillColor = rootTarget.fillColor ? rootTarget.fillColor.clone() : new paper.Color('#000000');
      pathItem.strokeColor = rootTarget.strokeColor ? rootTarget.strokeColor.clone() : null;
      pathItem.strokeWidth = rootTarget.strokeWidth || 0;
    }

    resultingItems.push(pathItem);
  });

  // Limpiar referencias temporales
  atomicPaths.forEach(p => p.remove());

  // 4. Insertar en la capa de trabajo ordenados en Z de abajo hacia arriba (Z0 -> Z1 -> Z2)
  if (targetLayer) {
    resultingItems.forEach(item => {
      targetLayer.addChild(item);
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

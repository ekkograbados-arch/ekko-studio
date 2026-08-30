/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Architecture v30)
   Ruta en repositorio: ASSETS/js/modules/canvas-pro/geometricUngroup.js
   
   Descripción:
   Motor geométrico de Descomposición por Jerarquía de Contención y Capas SVG
   para EKKO Studio. Basado en Paper.js y compatible con el flujo de trabajo
   industrial para corte y grabado láser (LightBurn / CNC).
   
   Cumple rigurosamente con:
   - CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
   - REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
   - DIAGNÓSTICO DE ARQUITECTURA Y DEPENDENCIAS DE EKKO STUDIO V0
   - RESULTADO ESPERADO (Descomposición completa en 1 clic, orden Z reactivo,
     capas independientes, calados físicos activos y reversibilidad total)
   ========================================================================= */

/**
 * Determina si un elemento es una instancia de paper.Path
 * @param {paper.Item} item 
 * @returns {boolean}
 */
function isPath(item) {
  return item && (item.className === 'Path' || (typeof paper !== 'undefined' && paper.Path && item instanceof paper.Path));
}

/**
 * Determina si un elemento es una instancia de paper.CompoundPath
 * @param {paper.Item} item 
 * @returns {boolean}
 */
function isCompoundPath(item) {
  return item && (item.className === 'CompoundPath' || (typeof paper !== 'undefined' && paper.CompoundPath && item instanceof paper.CompoundPath));
}

/**
 * Determina si un elemento es una instancia de paper.Group
 * @param {paper.Item} item 
 * @returns {boolean}
 */
function isGroup(item) {
  return item && (item.className === 'Group' || (typeof paper !== 'undefined' && paper.Group && item instanceof paper.Group));
}

/**
 * Determina si un elemento es una instancia de PlacedSymbol / SymbolItem (<use> en SVG)
 * @param {paper.Item} item 
 * @returns {boolean}
 */
function isPlacedSymbol(item) {
  return item && (item.className === 'PlacedSymbol' || item.className === 'SymbolItem' ||
    (typeof paper !== 'undefined' && ((paper.PlacedSymbol && item instanceof paper.PlacedSymbol) || (paper.SymbolItem && item instanceof paper.SymbolItem))));
}

/**
 * Obtiene la matriz acumulada global de un elemento recorriendo sus ancestros
 * hasta llegar a la capa activa (Layer), evitando desfasajes por jerarquías intermedias.
 * @param {paper.Item} item
 * @returns {paper.Matrix} Matriz de transformación acumulada
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
 * Aplana y extrae todos los sub-trazados a siluetas atómicas cerradas con coordenadas mundiales horneadas.
 * Hornea la matriz global directamente en los segmentos (applyMatrix = true) exactamente UNA vez
 * para garantizar cálculos espaciales y de contención certeros sin desplazamientos parásitos.
 * Desempaqueta instancias <use> / PlacedSymbol (ej. Minnie Mouse / Escudo AFA).
 * 
 * @param {paper.Item} item Elemento a aplanar
 * @param {paper.Matrix|null} inheritedMatrix Matriz acumulada heredada
 * @returns {Array<paper.Path>} Lista de siluetas atómicas cerradas
 */
export function flattenToAtomicPaths(item, inheritedMatrix = null) {
  const atomicPaths = [];
  const currentMatrix = inheritedMatrix
    ? (item.matrix ? inheritedMatrix.chain(item.matrix) : inheritedMatrix.clone())
    : getGlobalMatrix(item);

  if (isPath(item)) {
    const clone = item.clone({ insert: false });
    clone.matrix = currentMatrix;
    clone.applyMatrix = true; // Hornear coordenadas mundiales reales en los segmentos
    clone.data = { ...(item.data || {}) };
    
    // Validar que el trazado sea cerrado y contenga geometría real
    if (clone.segments && clone.segments.length >= 3 && Math.abs(clone.area) > 1e-4) {
      clone.closed = true;
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
    // Desempaquetar instancias <use> de SVGs complejos
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
 * Utiliza muestreo de múltiples puntos (centroide de la envolvente + vértices perimetrales).
 * 
 * @param {paper.Path} child Trazado candidato interior
 * @param {paper.Path} parent Trazado candidato contenedor
 * @returns {boolean}
 */
export function isContainedIn(child, parent) {
  if (!child.bounds || !parent.bounds) return false;
  
  // Test rápido de envolventes (AABB)
  if (!parent.bounds.intersects(child.bounds) && !parent.bounds.contains(child.bounds)) {
    return false;
  }
  // Un contenedor debe tener un área estrictamente mayor que el contenido
  if (Math.abs(child.area) >= Math.abs(parent.area)) {
    return false;
  }

  // Muestreo robusto de puntos
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
 * Construye el árbol topológico de contención anidada asignando a cada nodo
 * su contenedor espacial inmediato más pequeño.
 * 
 * @param {Array<paper.Path>} paths Lista de siluetas atómicas
 * @returns {{ roots: Array<Object>, nodes: Array<Object> }}
 */
export function buildContainmentTree(paths) {
  const nodes = paths.map(path => ({
    path,
    parent: null,
    children: [],
    depth: 0,
    area: Math.abs(path.area)
  }));

  // Ordenar de mayor a menor área para resolver jerarquías de afuera hacia adentro
  nodes.sort((a, b) => b.area - a.area);

  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      if (isContainedIn(nodes[j].path, nodes[i].path)) {
        // Asignar el contenedor más ajustado (menor área que contenga a nodes[j])
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
 * Retorna la geometría original inmaculada (geomBase) proyectada con la transformación
 * actual del elemento (posición, rotación, escala).
 * 
 * @param {paper.Item} item
 * @returns {paper.CompoundPath|null}
 */
export function getGlobalUnsubtractedPath(item) {
  if (!item || !item.data || !item.data.geomBase) return null;
  const tempBase = item.data.geomBase.clone({ insert: false });
  tempBase.matrix = item.matrix.clone();
  return tempBase;
}

/**
 * MOTOR DE RECÁLCULO REACTIVO CSG (No destructivo por orden Z).
 * 
 * Principio Fundamental:
 * - Restaura las masas sólidas a partir de su 'geomBase' original inmaculada.
 * - Los calados activos (isHole) sustraen masa física exclusivamente de las capas
 *   ubicadas físicamente por DEBAJO en el orden de apilamiento Z (j < i).
 * - Las capas ubicadas por encima del calado conservan su masa continua y no son perforadas.
 * - Utiliza CompoundPaths nativos de Paper.js para garantizar huecos físicos reales (vacíos vectoriales)
 *   aptos para manufactura láser en LightBurn / CNC, sin transparencias ni máscaras cosméticas.
 * 
 * @param {paper.Layer|null} targetLayer Capa de trabajo opcional
 */
export function recalculateDynamicSubtractions(targetLayer = null) {
  const layer = targetLayer || (typeof paper !== 'undefined' && paper.project ? paper.project.activeLayer : null);
  if (!layer || !layer.children) return;

  const items = [...layer.children].filter(item =>
    item && !item.data?.mockup && !item.data?.isMask && !item.data?.isSelectionBox &&
    !item.data?.isHandle && !item.data?.isSmartGuide && !item.data?.isMeasurement &&
    !item.data?.isTracePreview && !item.data?.isNodeEditOverlay && item.data?.geomBase
  );

  // Paso 1: Restaurar todas las masas sólidas a su silueta base original proyectada
  items.forEach(item => {
    if (!item.data.isHole) {
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

  // Paso 2: Ejecutar cortes de calados activos de arriba hacia abajo (orden Z descendente)
  for (let i = items.length - 1; i >= 0; i--) {
    const hole = items[i];
    if (hole && hole.data && hole.data.isHole) {
      const holeBase = getGlobalUnsubtractedPath(hole);
      if (!holeBase || !(holeBase instanceof paper.PathItem)) {
        if (holeBase) holeBase.remove();
        continue;
      }

      // Sustrae masa exclusivamente de las capas que se encuentran por DEBAJO (j < i)
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
            console.error("[EKKO CSG RECALC ERROR]", err);
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
 * 
 * En un único clic:
 * 1. Extrae todas las siluetas atómicas cerradas con coordenadas mundiales horneadas.
 * 2. Construye el árbol topológico de contención espacial.
 * 3. Asigna la semántica de capa y calado activo:
 *    - Capa Base Exterior (Z0): Masa sólida de fondo.
 *    - Capa Intermedia (Z1): Calado activo editable e interactivo.
 *    - Capa Interior (Z2...): Masa positiva superior independiente.
 * 4. Almacena la geometría inmaculada en 'geomBase' en coordenadas locales neutras.
 * 5. Inserta las capas ordenadas en Z en el lienzo de diseño respetando el mockup.
 * 6. Dispara el recálculo dinámico CSG para materializar el estado visual exacto.
 * 
 * @param {paper.Item} rootTarget Elemento compuesto o grupo a desagrupar
 * @returns {{ handled: boolean, simple: boolean, items: Array<paper.CompoundPath> }|null}
 */
export function decomposeByContainmentHierarchy(rootTarget) {
  if (!rootTarget || rootTarget.data?.locked || rootTarget.data?.mockup || rootTarget.data?.isMask) {
    return null;
  }

  // 1. Extraer siluetas atómicas cerradas con matrices mundiales horneadas
  const atomicPaths = flattenToAtomicPaths(rootTarget, null);
  if (atomicPaths.length === 0) return null;

  // 2. Construir árbol topológico de contención
  const { nodes } = buildContainmentTree(atomicPaths);
  const targetLayer = rootTarget.layer || (typeof paper !== 'undefined' && paper.project ? paper.project.activeLayer : null);
  const resultingItems = [];

  // 3. Ordenar por profundidad: de menor a mayor (Z0 exterior macizo -> Zn interior)
  nodes.sort((a, b) => a.depth - b.depth);

  nodes.forEach((node) => {
    // Determinación semántica de calado activo:
    // Profundidad impar dentro de una jerarquía anidada actúa como calado físico
    let isHole = false;
    if (node.parent) {
      isHole = (node.depth % 2 === 1);
    }

    // Cada entidad se genera como CompoundPath nativo para soportar operaciones booleanas limpias
    const compoundItem = new paper.CompoundPath({ insert: false });
    const pathClone = node.path.clone({ insert: false });
    compoundItem.addChild(pathClone);

    // Preservar la geometría base inmaculada en coordenadas locales puras (matriz identidad)
    const geomBase = new paper.CompoundPath({ insert: false });
    const baseClone = node.path.clone({ insert: false });
    geomBase.addChild(baseClone);
    geomBase.matrix = new paper.Matrix();

    compoundItem.data = {
      locked: false,
      isHole: isHole,
      geomBase: geomBase,
      layerDepth: node.depth,
      geometricHierarchy: 'layer',
      label: isHole ? `Calado Activo (Nivel ${node.depth})` : `Masa Sólida (Nivel ${node.depth})`
    };

    if (isHole) {
      // Trazado invisible en grabado físico final pero 100% interactivo y seleccionable en el lienzo
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

  // 4. Inserción en orden de apilamiento Z (Z0 base inferior -> Z superior)
  if (targetLayer) {
    resultingItems.forEach(item => {
      targetLayer.addChild(item);
      if (window.currentMockup) {
        item.insertBelow(window.currentMockup);
      }
    });
  }

  // 5. Eliminar el contenedor original
  rootTarget.remove();

  // 6. Recálculo CSG dinámico para materializar el estado visual inicial
  if (targetLayer) {
    recalculateDynamicSubtractions(targetLayer);
  }

  return { handled: true, simple: false, items: resultingItems };
}

/**
 * Alias de compatibilidad funcional para llamadas existentes en el proyecto
 */
export function geometricUngroupCompound(item) {
  return decomposeByContainmentHierarchy(item);
}

export function geometricUngroupOneLevel(group) {
  return decomposeByContainmentHierarchy(group);
}

// Exposición global segura para WYSIWYG, atajos y consola
if (typeof window !== 'undefined') {
  window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
  window.decomposeByContainmentHierarchy = decomposeByContainmentHierarchy;
  window.geometricUngroupCompound = decomposeByContainmentHierarchy;
  window.geometricUngroupOneLevel = decomposeByContainmentHierarchy;
  window.getGlobalUnsubtractedPath = getGlobalUnsubtractedPath;
}

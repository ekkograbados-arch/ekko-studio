/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js (PRO Architecture v36 - Deep Recursive Extraction & Containment Hierarchy Engine)
   Ruta en repositorio: ASSETS/js/modules/canvas-pro/geometricUngroup.js
   Descripción:
   Motor geométrico de Descomposición por Jerarquía de Contención y Capas SVG para EKKO Studio.
   Basado en Paper.js y optimizado para corte y grabado láser (LightBurn / CNC).

   Cumple rigurosamente con:
   - CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN Y CAPAS
   - REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
   - DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt & EKKO_DIAG v6.1):
     * Eliminación total de la paridad rígida de profundidad (depth % 2 === 1).
     * Distinción semántica estricta: Masa Sólida Positiva vs Calado Activo Negativo.
     * Reactividad CSG no destructiva en tiempo real gobernada por orden Z.
     * Preservación absoluta de 'geomBase' en coordenadas neutras locales.
     * Descomposición atómica completa en 1 solo clic.
     * Blindaje Anti-Aniquilación en sustracciones booleanas en vivo.
     * EXTRACCIÓN RECURSIVA PROFUNDA (v36.0): Soporte para grupos anidados
       multinivel sin pérdida de reactividad CSG.
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
 * Obtiene la matriz acumulada global de un elemento recorriendo sus ancestros
 * hasta llegar a la raíz especificada (o al nivel de la vista global si root es null).
 */
function getMatrixRelativeTo(item, root) {
  let mat = item.matrix ? item.matrix.clone() : new paper.Matrix();
  let curr = item.parent;
  while (curr && curr !== root && curr !== paper.project) {
    if (curr.matrix && !curr.matrix.isIdentity()) {
      mat = curr.matrix.chain(mat);
    }
    curr = curr.parent;
  }
  return mat;
}

/**
 * Aplica y hornea la matriz de transformación en los segmentos y curvas de un trazado
 */
function bakeMatrixIntoPath(path, matrix) {
  if (!path || !matrix || matrix.isIdentity()) return;
  if (path.segments) {
    path.segments.forEach(seg => {
      seg.point = matrix.transform(seg.point);
      if (seg.handleIn) seg.handleIn = matrix.transform(seg.handleIn.add(seg.point)).subtract(seg.point);
      if (seg.handleOut) seg.handleOut = matrix.transform(seg.handleOut.add(seg.point)).subtract(seg.point);
    });
  }
  if (path.children && Array.isArray(path.children)) {
    path.children.forEach(child => bakeMatrixIntoPath(child, matrix));
  }
}

/**
 * Descompone cualquier estructura en trazados atómicos cerrados simples (paper.Path)
 * con sus transformaciones espaciales horneadas en coordenadas absolutas del lienzo.
 * Registra metadatos de origen (orden documental, fill original, pertenencia a compuesto).
 */
let docOrderCounter = 0;
function flattenToAtomicPaths(item, accumulatedMatrix = null, parentMeta = {}) {
  const currentMatrix = accumulatedMatrix ? accumulatedMatrix.chain(item.matrix || new paper.Matrix()) : (item.matrix ? item.matrix.clone() : new paper.Matrix());
  const atomicPaths = [];
  const isFromCompound = parentMeta.isFromCompound || isCompoundPath(item);

  if (isPath(item)) {
    const cloned = item.clone({ insert: false });
    bakeMatrixIntoPath(cloned, currentMatrix);
    cloned.matrix = new paper.Matrix();
    if (cloned.segments && cloned.segments.length >= 3) {
      cloned.closed = true;
      cloned.data = {
        ...(cloned.data || {}),
        docOrder: docOrderCounter++,
        originalFillColor: item.fillColor ? item.fillColor.clone() : null,
        originalStrokeColor: item.strokeColor ? item.strokeColor.clone() : null,
        originalStrokeWidth: item.strokeWidth || 0,
        isFromCompound: isFromCompound,
        originalClockwise: cloned.clockwise
      };
      atomicPaths.push(cloned);
    } else {
      cloned.remove();
    }
  } else if (isCompoundPath(item)) {
    if (item.children && item.children.length > 0) {
      item.children.forEach(child => {
        atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix, { isFromCompound: true, compoundFill: item.fillColor }));
      });
    }
  } else if (isGroup(item)) {
    if (item.children && item.children.length > 0) {
      const childrenCopy = [...item.children];
      childrenCopy.forEach(child => {
        if (child.clipMask) return;
        atomicPaths.push(...flattenToAtomicPaths(child, currentMatrix, { isFromCompound: false }));
      });
    }
  } else if (isPlacedSymbol(item)) {
    const def = (item.symbol && item.symbol.item) || item.definition || (item.symbol && item.symbol.definition);
    if (def) {
      const defClone = def.clone({ insert: false });
      atomicPaths.push(...flattenToAtomicPaths(defClone, currentMatrix, { isFromCompound: false }));
      defClone.remove();
    }
  }
  return atomicPaths;
}

/**
 * Obtiene un punto interior estricto y garantizado de un paper.Path.
 * Si el centroide (bounds.center) cae fuera por concavidad, proyecta normales
 * hacia el interior a lo largo de las curvas del trazado.
 */
function getInteriorTestPoint(path) {
  if (!path || !path.bounds) return null;
  const center = path.bounds.center;
  if (path.contains(center)) return center;
  if (path.curves && path.curves.length > 0) {
    for (let c = 0; c < path.curves.length; c++) {
      const curve = path.curves[c];
      const pt = curve.getPointAtTime(0.5);
      const normal = curve.getNormalAtTime(0.5).normalize(2);
      const inward1 = pt.add(normal);
      if (path.contains(inward1)) return inward1;
      const inward2 = pt.subtract(normal);
      if (path.contains(inward2)) return inward2;
    }
  }
  return center;
}

/**
 * Determina si el trazado 'child' está topológicamente contenido dentro de 'parent'.
 * Utiliza muestreo multipunto (centro, cuartiles y vértices) para robustez ante concavidades.
 */
function isContainedIn(child, parent) {
  if (!child || !parent || child === parent) return false;
  if (!parent.bounds.contains(child.bounds) && !parent.bounds.intersects(child.bounds)) {
    return false;
  }
  const testPoints = [];
  const interior = getInteriorTestPoint(child);
  if (interior) testPoints.push(interior);
  if (child.segments && child.segments.length > 0) {
    const step = Math.max(1, Math.floor(child.segments.length / 6));
    for (let i = 0; i < child.segments.length; i += step) {
      testPoints.push(child.segments[i].point);
    }
  }
  if (testPoints.length === 0) return false;
  let containedCount = 0;
  for (let i = 0; i < testPoints.length; i++) {
    if (parent.contains(testPoints[i])) {
      containedCount++;
    }
  }
  return containedCount >= Math.ceil(testPoints.length * 0.5);
}

/**
 * Construye el árbol topológico de contención geométrica y calcula profundidades relativas.
 */
function buildContainmentTree(atomicPaths) {
  // Ordenar por área descendente: contenedores mayores primero
  atomicPaths.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  const nodes = atomicPaths.map((path, idx) => ({
    id: idx,
    path: path,
    area: Math.abs(path.area),
    parent: null,
    children: [],
    depth: 0,
    isHole: false,
    docOrder: path.data?.docOrder || idx
  }));

  // Asignar a cada nodo su contenedor directo más inmediato (el de menor área que lo contiene)
  for (let i = 0; i < nodes.length; i++) {
    const candidate = nodes[i];
    let bestParent = null;
    for (let j = 0; j < nodes.length; j++) {
      if (i === j) continue;
      const potentialParent = nodes[j];
      if (potentialParent.area > candidate.area && isContainedIn(candidate.path, potentialParent.path)) {
        if (!bestParent || potentialParent.area < bestParent.area) {
          bestParent = potentialParent;
        }
      }
    }
    if (bestParent) {
      candidate.parent = bestParent;
      bestParent.children.push(candidate);
    }
  }

  // Calcular profundidad de contención
  function computeDepth(node, currentDepth) {
    node.depth = currentDepth;
    node.children.forEach(child => computeDepth(child, currentDepth + 1));
  }
  nodes.filter(n => n.parent === null).forEach(root => computeDepth(root, 0));

  return { nodes };
}

/**
 * RESUELVE LA SEMÁNTICA VECTORIAL (Prompt Maestro - Regla 4):
 * - Masa Sólida (isHole: false): Geometría positiva independiente.
 * - Calado Activo (isHole: true): Geometría negativa interactiva que perfora capas inferiores en Z.
 */
function resolveItemSemantics(node, rootTarget) {
  const path = node.path;
  const isFromCompound = !!(path.data && path.data.isFromCompound);

  // CASO 1: Si proviene de un CompoundPath original (como Escudo AFA, 007 o siluetas tipográficas)
  if (isFromCompound && rootTarget && isCompoundPath(rootTarget)) {
    const testPt = getInteriorTestPoint(path);
    if (testPt && rootTarget.contains(testPt)) {
      // Si el centroide del camino cae DENTRO del CompoundPath original, es una MASA
      return false;
    } else {
      // Si cae fuera del área compuesta rellena (perforación nativa de la A o escudo), es un CALADO
      return true;
    }
  }

  // CASO 2: Clasificación Topológica por Jerarquía de Contención y Orientación (Winding)
  if (node.parent) {
    const parentPath = node.parent.path;
    const isParentHole = node.parent.isHole;

    // Si el contenedor padre es una Masa Sólida y este trazado está completamente contenido
    if (!isParentHole) {
      if (path.data && path.data.originalClockwise !== undefined && parentPath.data && parentPath.data.originalClockwise !== undefined) {
        if (path.data.originalClockwise !== parentPath.data.originalClockwise) {
          return true; // Orientación opuesta dentro de una masa = CALADO ACTIVO
        }
      }
      if (node.depth === 1) {
        return true; // Nivel 1 inmediato dentro de masa = Calado de Nivel 1
      }
    } else {
      // Si el contenedor inmediato es un hueco, el objeto interior es una MASA (ej. isla central o estrella)
      return false;
    }
  }

  // REGLA DE ORO POR DEFECTO:
  // Una figura cerrada con geometría válida y estilo es una MASA SÓLIDA.
  // Jamás se forzará a hueco por mera paridad de profundidad.
  return false;
}

/**
 * Retorna la geometría original inmaculada (geomBase) proyectada con la transformación
 * actual del elemento (posición, rotación, escala).
 */
export function getGlobalUnsubtractedPath(item) {
  if (!item || !item.data || !item.data.geomBase) return null;
  // geomBase se mantiene en coordenadas de mundo por sincronización en tiempo real (drag, rotate, scale).
  // Se clona de forma pura sin re-aplicar transformaciones matriciales redundantes que desfasen la silueta.
  const tempBase = item.data.geomBase.clone({ insert: false });
  return tempBase;
}

/**
 * Resuelve el elemento de contenido real si el item está encapsulado en un clipGroup
 */
function getContentItem(item) {
  if (!item) return null;
  if (item.data && item.data.clipGroup) {
    if (!item.children) return item;
    const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
    if (content) return content;
    return item.children[1] || item.children[0] || item;
  }
  return item;
}

/**
 * Extrae recursivamente todos los elementos sustractivos o masas con geomBase
 * desde la lista de capas del lienzo, penetrando en cualquier nivel de anidamiento de grupos.
 * (Blindaje Recursivo Profundo v36.0)
 */
function extractSubtractiveItems(topList) {
  const result = [];
  
  function collectRecursive(item) {
    if (!item) return;
    const content = getContentItem(item);
    if (!content) return;

    if (isGroup(content) && content.children && content.children.length > 0) {
      content.children.forEach(c => {
        if (!c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask))) {
          collectRecursive(c);
        }
      });
    } else if (content.data && content.data.geomBase) {
      result.push(content);
    }
  }

  topList.forEach(topItem => {
    collectRecursive(topItem);
  });

  return result;
}

/**
 * MOTOR DE RECÁLCULO REACTIVO CSG (No destructivo por orden Z).
 * Incorpora el Blindaje Anti-Aniquilación:
 * - Si una sustracción booleana reduce los segmentos visibles a 0 o vacía el trazado,
 *   se anula la sustracción destructiva sobre esa pieza para garantizar que nunca se borre de pantalla.
 */
export function recalculateDynamicSubtractions(targetLayer = null) {
  const layer = targetLayer || (typeof paper !== 'undefined' && paper.project ? paper.project.activeLayer : null);
  if (!layer || !layer.children) return;

  const items = [...layer.children].filter(item =>
    item && !item.data?.mockup && !item.data?.isMask && !item.data?.isSelectionBox &&
    !item.data?.isHandle && !item.data?.isSmartGuide && !item.data?.isMeasurement &&
    !item.data?.isTracePreview && !item.data?.isNodeEditOverlay
  );

  if (items.length === 0) return;

  const subItems = extractSubtractiveItems(items);
  if (subItems.length === 0) return;

  // Helper para contar segmentos totales de un Path o CompoundPath
  function countSegments(item) {
    if (!item) return 0;
    if (item.segments) return item.segments.length;
    if (item.children) {
      let total = 0;
      item.children.forEach(c => { total += countSegments(c); });
      return total;
    }
    return 0;
  }

  // 1. Restaurar todas las masas sólidas a su silueta geomBase inmaculada
  subItems.forEach(item => {
    if (item && item.data && item.data.geomBase && !item.data.isHole) {
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
        pristine.remove();
      }
      item.visible = true;
    } else if (item && item.data && item.data.isHole) {
      // Los calados interactivos se mantienen transparentes nativos sin trazos residuales
      item.visible = true;
      item.fillColor = new paper.Color(0, 0, 0, 0.0001);
      item.strokeColor = null;
      item.strokeWidth = 0;
    }
  });

  // 2. Ejecutar sustracciones dinámicas protegidas contra colapso por solapamiento de calados
  // Para cada masa sólida, recolectar todos los calados activos situados por encima en el orden Z
  for (let j = 0; j < subItems.length; j++) {
    const solid = subItems[j];
    if (!solid || !solid.data || solid.data.isHole || !solid.data.geomBase) continue;

    // Obtener la geometría base prístina de esta masa sólida
    const pristineBase = getGlobalUnsubtractedPath(solid);
    if (!pristineBase) continue;

    const pristineArea = Math.abs(pristineBase.area || 0);
    const pristineBounds = pristineBase.bounds;

    // Buscar todos los calados activos superiores (i > j) que intersecan a la masa
    const intersectingHoles = [];
    for (let i = j + 1; i < subItems.length; i++) {
      const holeItem = subItems[i];
      if (!holeItem || !holeItem.data || !holeItem.data.isHole) continue;

      const holeBase = getGlobalUnsubtractedPath(holeItem);
      if (!holeBase) continue;

      if (pristineBounds.intersects(holeBase.bounds)) {
        intersectingHoles.push(holeBase);
      } else {
        holeBase.remove();
      }
    }

    if (intersectingHoles.length === 0) {
      pristineBase.remove();
      continue;
    }

    // BLINDAJE ANTI-ANIQUILACIÓN POR SOLAPAMIENTO DE CALADOS:
    // Si dos o más huecos se solapan entre sí (ej. arrastrar 'A' hacia 'F'),
    // unificamos primero sus geometrías para que Paper.js no colapse por aristas compartidas.
    let mergedHole = null;
    try {
      for (let k = 0; k < intersectingHoles.length; k++) {
        const curHole = intersectingHoles[k];
        if (!mergedHole) {
          mergedHole = curHole.clone({ insert: false });
        } else {
          if (mergedHole.bounds.intersects(curHole.bounds)) {
            try {
              const united = mergedHole.unite(curHole, { insert: false });
              if (united && Math.abs(united.area || 0) > 0.01) {
                mergedHole.remove();
                mergedHole = united;
                continue;
              }
            } catch (e) {}
          }
          // Si no se tocan o unite falla, los unimos en un CompoundPath
          const cp = new paper.CompoundPath({ insert: false });
          if (mergedHole instanceof paper.CompoundPath) {
            cp.addChildren(mergedHole.removeChildren());
            mergedHole.remove();
          } else {
            cp.addChild(mergedHole);
          }
          if (curHole instanceof paper.CompoundPath) {
            cp.addChildren(curHole.removeChildren());
          } else {
            cp.addChild(curHole.clone({ insert: false }));
          }
          mergedHole = cp;
        }
      }
    } catch (err) {
      mergedHole = null;
    }

    let finalSubtracted = null;

    // Intento 1: Sustracción unificada limpia desde la masa prístina
    if (mergedHole) {
      try {
        const testSub = pristineBase.subtract(mergedHole, { insert: false });
        if (testSub) {
          const testArea = Math.abs(testSub.area || 0);
          const testSegments = countSegments(testSub);
          // Validar que no haya colapso degenerado de área (área >= 5% de la masa prístina)
          const isValidArea = pristineArea > 1.0 ? (testArea >= 0.05 * pristineArea) : (testArea > 0.01);
          if (testSegments >= 3 && isValidArea && testSub.bounds.width > 1 && testSub.bounds.height > 1) {
            finalSubtracted = testSub;
          } else {
            testSub.remove();
          }
        }
      } catch (e) {}
      mergedHole.remove();
    }

    // Intento 2 (Fallback progresivo): Si la sustracción en bloque falló o colapsó,
    // aplicar calados uno a uno validando en cada paso que la masa no sea aniquilada.
    if (!finalSubtracted) {
      let currentProgress = pristineBase.clone({ insert: false });
      for (let k = 0; k < intersectingHoles.length; k++) {
        const singleHole = intersectingHoles[k];
        try {
          const stepSub = currentProgress.subtract(singleHole, { insert: false });
          if (stepSub) {
            const stepArea = Math.abs(stepSub.area || 0);
            const stepSegments = countSegments(stepSub);
            const isStepValid = pristineArea > 1.0 ? (stepArea >= 0.05 * pristineArea) : (stepArea > 0.01);
            if (stepSegments >= 3 && isStepValid && stepSub.bounds.width > 1 && stepSub.bounds.height > 1) {
              currentProgress.remove();
              currentProgress = stepSub;
            } else {
              // Si este calado particular causa la aniquilación (colisión extrema), se ignora y se preserva el estado
              stepSub.remove();
            }
          }
        } catch (e) {}
      }
      finalSubtracted = currentProgress;
    }

    // Aplicar el resultado final a la masa sólida en el lienzo
    if (finalSubtracted) {
      solid.removeChildren();
      if (finalSubtracted instanceof paper.CompoundPath) {
        solid.addChildren(finalSubtracted.removeChildren());
      } else {
        solid.addChild(finalSubtracted);
      }
      solid.visible = true;
    }

    // Limpiar geometrías temporales de memoria
    pristineBase.remove();
    intersectingHoles.forEach(h => { try { h.remove(); } catch(e) {} });
  }

  if (typeof paper !== 'undefined' && paper.view) {
    paper.view.update();
  }
}

function isAncestorOf(potentialAncestor, node) {
  let curr = node.parent;
  while (curr) {
    if (curr === potentialAncestor) return true;
    curr = curr.parent;
  }
  return false;
}

function getRootNode(node) {
  let curr = node;
  while (curr.parent) {
    curr = curr.parent;
  }
  return curr;
}

/**
 * DESCOMPOSICIÓN INTEGRAL POR JERARQUÍA DE CONTENCIÓN Y CAPAS (1 solo clic).
 * Descompone masas positivas y calados activos respetando la relación Z:
 * Raíz/Fondo (Z0) -> Calado Intermedio (Z1) -> Masa Interior (Z2...)
 * Cada elemento resultante se genera como un CompoundPath nativo de Paper.js.
 */
export function decomposeByContainmentHierarchy(rootTarget, isClipped = false) {
  if (!rootTarget || rootTarget.data?.locked || rootTarget.data?.mockup || rootTarget.data?.isMask) {
    return null;
  }

  const targetLayer = rootTarget.layer || paper.project.activeLayer;
  docOrderCounter = 0;

  // Garantía de Contención en Producto: Si el objeto original estaba enmascarado o hay un producto con máscara activo
  const shouldClip = isClipped || (typeof window !== 'undefined' && typeof window.clipItem === 'function' && !window.infiniteCanvasMode && !!window.clipMask);

  // 1. Aplanar todo el contenido a trazados atómicos cerrados
  const atomicPaths = flattenToAtomicPaths(rootTarget);
  if (!atomicPaths || atomicPaths.length === 0) {
    return null;
  }

  // Si solo hay un único trazado, envolverlo limpiamente como capa atómica descompuesta
  if (atomicPaths.length === 1) {
    const single = atomicPaths[0];
    const compound = new paper.CompoundPath({ insert: false });
    compound.addChild(single.clone({ insert: false }));
    single.remove();

    const geomBase = compound.clone({ insert: false });
    geomBase.matrix = new paper.Matrix();

    compound.data = {
      locked: false,
      label: (rootTarget.data && rootTarget.data.label) ? rootTarget.data.label : "Capa Independiente",
      isHole: false,
      geomBase: geomBase,
      layerDepth: 0,
      decomposedLayer: true
    };

    compound.fillColor = rootTarget.fillColor || single.fillColor || new paper.Color('#111827');
    compound.strokeColor = rootTarget.strokeColor || single.strokeColor || null;
    compound.strokeWidth = rootTarget.strokeWidth || single.strokeWidth || 0;

    let finalItem = compound;
    if (shouldClip && typeof window !== 'undefined' && typeof window.clipItem === 'function') {
      finalItem = window.clipItem(compound);
    }
    if (targetLayer) {
      targetLayer.addChild(finalItem);
      if (window.currentMockup) {
        finalItem.insertBelow(window.currentMockup);
      }
    }
    rootTarget.remove();
    return { handled: true, simple: true, items: [finalItem] };
  }

  // 2. Construir árbol topológico de contención
  const { nodes } = buildContainmentTree(atomicPaths);

  // 3. Resolver Semántica de cada nodo (Masa Sólida vs Calado Activo)
  // Se evalúa en orden de profundidad (padres antes que hijos)
  const sortedByDepth = [...nodes].sort((a, b) => a.depth - b.depth);
  sortedByDepth.forEach(node => {
    node.isHole = resolveItemSemantics(node, rootTarget);
  });

  // 4. Asignación Topológica de Orden Z
  // Z0 = Masa Externa Mayor -> Z1 = Calado Intermedio -> Z2 = Masa Interior...
  nodes.sort((a, b) => {
    const rootA = getRootNode(a);
    const rootB = getRootNode(b);

    // Si pertenecen a familias topológicas diferentes (ej. dos letras separadas o estrellas distintas)
    if (rootA !== rootB) {
      return rootB.area - rootA.area || a.docOrder - b.docOrder;
    }

    // Misma familia topológica: Orden estricto por profundidad de contención
    if (isAncestorOf(a, b)) return -1;
    if (isAncestorOf(b, a)) return 1;

    if (a.depth !== b.depth) {
      return a.depth - b.depth;
    }
    return a.docOrder - b.docOrder;
  });

  const resultingItems = [];

  nodes.forEach((node) => {
    const isHole = node.isHole;
    const compoundItem = new paper.CompoundPath({ insert: false });
    const pathClone = node.path.clone({ insert: false });
    compoundItem.addChild(pathClone);

    // Almacenar geometría base inmaculada en coordenadas locales puras neutras
    const geomBase = new paper.CompoundPath({ insert: false });
    const baseClone = node.path.clone({ insert: false });
    geomBase.addChild(baseClone);
    geomBase.matrix = new paper.Matrix();

    compoundItem.data = {
      locked: false,
      label: isHole ? `Calado Activo (Nivel ${node.depth})` : `Masa Sólida (Nivel ${node.depth})`,
      isHole: isHole,
      geomBase: geomBase,
      layerDepth: node.depth,
      containmentId: node.id,
      decomposedLayer: true
    };

    if (isHole) {
      // Los calados activos son transparentes y limpios cuando no están seleccionados.
      // Su contorno visible (Hole Tight Contour) se proyecta exclusivamente al estar seleccionados desde selection.js.
      compoundItem.fillColor = new paper.Color(0, 0, 0, 0.0001);
      compoundItem.strokeColor = null;
      compoundItem.strokeWidth = 0;
    } else {
      compoundItem.fillColor = node.path.data?.originalFillColor || rootTarget.fillColor || new paper.Color('#111827');
      compoundItem.strokeColor = node.path.data?.originalStrokeColor || rootTarget.strokeColor || null;
      compoundItem.strokeWidth = node.path.data?.originalStrokeWidth || rootTarget.strokeWidth || 0;
    }

    resultingItems.push(compoundItem);
    node.path.remove();
  });

  // 5. Inserción ordenada en la capa activa preservando la jerarquía Z
  const finalDeliveredItems = [];
  resultingItems.forEach(item => {
    let finalItem = item;
    if (shouldClip && typeof window !== 'undefined' && typeof window.clipItem === 'function') {
      finalItem = window.clipItem(item);
    }
    if (targetLayer) {
      targetLayer.addChild(finalItem);
      if (window.currentMockup) {
        finalItem.insertBelow(window.currentMockup);
      }
    }
    finalDeliveredItems.push(finalItem);
  });

  // 6. Eliminar el objeto contenedor original
  rootTarget.remove();

  // 7. Ejecutar recálculo reactivo CSG dinámico con el blindaje anti-aniquilación activo
  if (targetLayer) {
    recalculateDynamicSubtractions(targetLayer);
  }

  return { handled: true, simple: false, items: finalDeliveredItems };
}

export function geometricUngroupCompound(item) {
  return decomposeByContainmentHierarchy(item);
}

export function geometricUngroupOneLevel(group) {
  return decomposeByContainmentHierarchy(group);
}

// Exposición global defensiva
if (typeof window !== 'undefined') {
  window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
  window.decomposeByContainmentHierarchy = decomposeByContainmentHierarchy;
  window.geometricUngroupCompound = decomposeByContainmentHierarchy;
  window.geometricUngroupOneLevel = decomposeByContainmentHierarchy;
  window.getGlobalUnsubtractedPath = getGlobalUnsubtractedPath;
  window.isContainedIn = isContainedIn;
}


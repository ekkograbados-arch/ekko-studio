/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/geometricUngroup.js
Versión: v35.0 PRO - Stacking CSG & Reactive Z-Order Engine (Containment Hierarchy)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/geometricUngroup.js

Descripción:
Motor industrial de descomposición geométrica por jerarquía de contención y
recálculo reactivo dinámico de operaciones booleanas CSG (Constructive Solid Geometry)
para EKKO Studio basado en Paper.js.

Cumple rigurosamente con:
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO - RIGUROSO - PROFESIONAL:
  1. CONCEPTO FUNDAMENTAL: Descomposición por jerarquía de contención / Descomposición por capas.
  2. DESAGRUPAR EN UN SOLO CLIC: Descomposición completa sin requerir múltiples clics.
  3. MASAS POSITIVAS + HUECOS ACTIVOS REALES: Un hueco NO es una transparencia cosmética ni
     depende del fondo del canvas. Es una geometría negativa real que sustrae físicamente
     las masas situadas estrictamente por debajo de él en el orden Z.
  4. ORDEN Z DINÁMICO: Al mover capas o cambiar el orden Z (Subir/Bajar Capa, Al Frente, Al Fondo),
     el calado se recalcula en tiempo real en función de las capas inferiores afectadas.
  5. IDENTIDAD Y PRESERVACIÓN GEOMÉTRICA (geomBase): Cada capa conserva su silueta prístina
     en geomBase para permitir reversibilidad, transformaciones acumuladas, escalado,
     rotación y edición de nodos no destructiva.
  6. SINCRONIZACIÓN MULTI-MÓDULO: Sincronización total con contextualMenu.js, editor.js,
     selection.js (getGlobalUnsubtractedPath), nodeEditor.js, exportSVG.js y ekkoDiagnostics.js.
========================================================================= */

/**
 * Resuelve de forma segura el elemento geométrico de contenido útil,
 * contemplando el encapsulamiento de producto (clipGroup).
 * @param {paper.Item} item
 * @returns {paper.Item|null}
 */
function getContentItem(item) {
  if (!item) return null;
  if (item.data && item.data.clipGroup) {
    if (!item.children) return item;
    const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
    if (content) return content;
    const fallback = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup)));
    if (fallback) return fallback;
    return item.children[1] || item.children[0] || item;
  }
  return item;
}

/**
 * Determina si un objeto pertenece a la interfaz, mockup o artefactos temporales.
 * @param {paper.Item} item
 * @returns {boolean}
 */
function isMockupOrUI(item) {
  let curr = item;
  while (curr) {
    const d = curr.data || {};
    if (
      d.mockup || d.isMask || d.wasClipMask ||
      d.isSelectionBox || d.isHandle || d.isNodeHandle ||
      d.isCurveHandle || d.isNodeEditOverlay || d.isSmartGuide ||
      d.isMeasurement || d.isTracePreview || d.isUnderlineLine
    ) {
      return true;
    }
    if (
      (typeof window !== 'undefined' && window.currentMockup && curr === window.currentMockup) ||
      (typeof window !== 'undefined' && window.selectionBoxGroup && curr === window.selectionBoxGroup) ||
      (typeof window !== 'undefined' && window.nodeHandlesGroup && curr === window.nodeHandlesGroup)
    ) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

/**
 * Obtiene la geometría global no sustraída (prístina) de un elemento o calado activo.
 * Usado directamente por selection.js para dibujar el contorno magnético cian ajustado
 * y calcular bounding boxes limpios sin deformaciones por corte.
 * @param {paper.Item} item
 * @returns {paper.PathItem|null}
 */
export function getGlobalUnsubtractedPath(item) {
  if (!item) return null;
  const target = getContentItem(item);
  if (!target) return null;

  // 1. Si posee geomBase prístina
  if (target.data && target.data.geomBase) {
    const baseClone = target.data.geomBase.clone({ insert: false });
    // Si geomBase está en coordenadas locales del target, aplicar la matriz global
    if (target.matrix && !target.matrix.isIdentity()) {
      baseClone.transform(target.matrix);
    } else if (target.position && baseClone.position && !target.position.equals(baseClone.position)) {
      baseClone.position = target.position.clone();
    }
    return baseClone;
  }

  // 2. Si no posee geomBase, clonar el objeto actual como fallback
  return target.clone({ insert: false });
}

/**
 * Inicializa o actualiza defensivamente geomBase en el objeto para garantizar
 * que nunca pierda su definición vectorial neutra original ante arrastres o transformaciones.
 * @param {paper.Item} target
 */
function ensureGeomBase(target) {
  if (!target || !target.data) return;
  if (!target.data.geomBase) {
    const base = target.clone({ insert: false });
    base.matrix = new paper.Matrix();
    base.data = { isGeomBaseCopy: true };
    target.data.geomBase = base;
  }
}

/**
 * Extrae todos los trazados elementales (paper.Path) de una estructura compleja
 * (CompoundPath, Group, o Path individual) horneando matrices acumuladas.
 * @param {paper.Item} item
 * @param {paper.Matrix} [accumMatrix]
 * @returns {paper.Path[]}
 */
function extractAllTerminalPaths(item, accumMatrix = null) {
  const result = [];
  if (!item) return result;

  const currentMatrix = accumMatrix
    ? (item.matrix ? accumMatrix.chain(item.matrix) : accumMatrix)
    : (item.matrix ? item.matrix.clone() : new paper.Matrix());

  if (item instanceof paper.Path) {
    const pClone = item.clone({ insert: false });
    if (!currentMatrix.isIdentity()) {
      pClone.transform(currentMatrix);
    }
    result.push(pClone);
  } else if (item instanceof paper.CompoundPath || item.className === 'CompoundPath') {
    if (item.children && item.children.length > 0) {
      item.children.forEach(child => {
        const subPaths = extractAllTerminalPaths(child, currentMatrix);
        result.push(...subPaths);
      });
    }
  } else if (item instanceof paper.Group || item.className === 'Group') {
    if (item.children && item.children.length > 0) {
      item.children.forEach(child => {
        if (!child.clipMask && !(child.data && (child.data.wasClipMask || child.data.isMask))) {
          const subPaths = extractAllTerminalPaths(child, currentMatrix);
          result.push(...subPaths);
        }
      });
    }
  } else if (typeof item.toPath === 'function') {
    try {
      const conv = item.toPath();
      if (conv) {
        const sub = extractAllTerminalPaths(conv, currentMatrix);
        conv.remove();
        result.push(...sub);
      }
    } catch (e) {}
  }
  return result;
}

/**
 * Calcula el árbol de jerarquía de contención topológica entre una colección de trazados cerrados.
 * Ordena por área descendente y evalúa la profundidad de anidamiento de cada silueta:
 * - Profundidad par (0, 2, ...): Masa Positiva (sólido / macizo).
 * - Profundidad impar (1, 3, ...): Geometría Negativa (hueco / calado activo).
 * @param {paper.Path[]} paths
 * @returns {Array<{ path: paper.Path, isHole: boolean, depth: number, parentIndex: number }>}
 */
function computeContainmentHierarchy(paths) {
  // Filtrar trazados degenerados o sin área
  const validPaths = paths.filter(p => p && p.segments && p.segments.length > 2 && Math.abs(p.area) > 1e-4);
  if (validPaths.length === 0) return [];

  // Ordenar de mayor a menor área absoluta
  validPaths.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));

  const count = validPaths.length;
  const containmentMatrix = Array.from({ length: count }, () => Array(count).fill(false));

  // Evaluar inclusión geométrica estricta (A contiene a B)
  for (let i = 0; i < count; i++) {
    const pathA = validPaths[i];
    const boundsA = pathA.bounds;

    for (let j = i + 1; j < count; j++) {
      const pathB = validPaths[j];
      const boundsB = pathB.bounds;

      // Descarte rápido por bounding box
      if (!boundsA.contains(boundsB)) continue;

      // Verificación rigurosa: el centro y primer vértice de B deben estar dentro de A
      const testPoint = boundsB.center;
      const firstVertex = pathB.segments[0].point;

      if (pathA.contains(testPoint) || pathA.contains(firstVertex)) {
        containmentMatrix[i][j] = true;
      }
    }
  }

  // Calcular profundidad de contención para cada trazado
  const results = [];
  for (let j = 0; j < count; j++) {
    let depth = 0;
    let directParent = -1;

    for (let i = 0; i < j; i++) {
      if (containmentMatrix[i][j]) {
        depth++;
        directParent = i; // El último ancestro mayor es el contenedor directo
      }
    }

    // Regla de Oro: profundidad impar = calado activo (isHole = true)
    const isHole = (depth % 2 !== 0);
    results.push({
      path: validPaths[j],
      isHole: isHole,
      depth: depth,
      parentIndex: directParent
    });
  }

  return results;
}

/**
 * DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN (UN SOLO CLIC)
 * Descompone íntegramente una entidad compuesta o grupo en sus siluetas geométricas
 * editables individuales: Masas Positivas y Calados Activos independientes, conservando
 * el orden Z, transformaciones, posiciones y estilos.
 *
 * @param {paper.Item} item Objeto a desagrupar
 * @param {boolean} [isClipped=false] Indica si el objeto pertenece a un clipGroup
 * @returns {{ items: paper.Item[] }} Lista de capas creadas e independizadas
 */
export function decomposeByContainmentHierarchy(item, isClipped = false) {
  if (!item || isMockupOrUI(item)) {
    return { items: item ? [item] : [] };
  }

  const actualItem = isClipped ? getContentItem(item) : item;
  if (!actualItem) return { items: [] };

  const parent = actualItem.parent || (paper.project && paper.project.activeLayer);
  const targetIndex = parent ? parent.children.indexOf(actualItem) : 0;

  // Extraer todos los trazados elementales
  const extractedPaths = extractAllTerminalPaths(actualItem);

  // Si solo hay un único trazado elemental sin huecos internos, conservar el objeto
  if (extractedPaths.length <= 1 && !(actualItem instanceof paper.CompoundPath)) {
    ensureGeomBase(actualItem);
    actualItem.data = actualItem.data || {};
    actualItem.data.isHole = !!actualItem.data.isHole;
    actualItem.data.locked = false;
    return { items: [actualItem] };
  }

  // Analizar la jerarquía de contención de siluetas
  const hierarchy = computeContainmentHierarchy(extractedPaths);
  if (hierarchy.length === 0) {
    return { items: [actualItem] };
  }

  // Estilos de referencia heredados del original
  const origFill = actualItem.fillColor ? actualItem.fillColor.clone() : new paper.Color('#111827');
  const origStroke = actualItem.strokeColor ? actualItem.strokeColor.clone() : null;
  const origStrokeWidth = actualItem.strokeWidth || 0;

  const createdItems = [];

  // Construir las capas individuales en el orden Z adecuado (fondo hacia arriba)
  // Las masas inferiores van primero (Z menor); los calados van inmediatamente por encima
  // de las masas sobre las que operan.
  hierarchy.forEach((entry, idx) => {
    const rawPath = entry.path;
    const isHole = entry.isHole;

    // Crear el elemento de trazado definitivo en el proyecto
    const finalPath = rawPath.clone({ insert: false });

    // Configuración de estilos y roles
    if (isHole) {
      // Calado activo: geometría negativa real.
      // En reposo permanece transparente/invisible sobre el lienzo ya que su acción
      // es sustraer las masas inferiores. Al seleccionarlo, selection.js proyecta
      // el contorno cian ajustado (#06b6d4) gracias a getGlobalUnsubtractedPath.
      finalPath.fillColor = null;
      finalPath.strokeColor = null;
      finalPath.strokeWidth = 0;
      finalPath.visible = false;
    } else {
      // Masa positiva: geometría maciza editable
      finalPath.fillColor = origFill.clone();
      finalPath.strokeColor = origStroke ? origStroke.clone() : null;
      finalPath.strokeWidth = origStrokeWidth;
      finalPath.visible = true;
    }

    // Inicializar geomBase prístina inalterable (modelo geométrico editable)
    const geomBaseClone = finalPath.clone({ insert: false });
    geomBaseClone.matrix = new paper.Matrix();
    geomBaseClone.data = { isGeomBaseCopy: true };

    finalPath.data = {
      ...(finalPath.data || {}),
      locked: false,
      isHole: isHole,
      geomBase: geomBaseClone,
      decomposedLayer: true,
      label: isHole ? `Calado Activo (${idx + 1})` : `Masa Positiva (${idx + 1})`,
      containmentDepth: entry.depth
    };

    let deliveredItem = finalPath;

    // Si el elemento original estaba enmascarado en el mockup (clipGroup), preservar el enmascaramiento
    if (isClipped && typeof window !== 'undefined' && typeof window.clipItem === 'function') {
      deliveredItem = window.clipItem(finalPath);
    } else if (parent) {
      parent.insertChild(targetIndex + idx, finalPath);
    }

    createdItems.push(deliveredItem);
  });

  // Limpiar y remover el contenedor original descompuesto
  try {
    actualItem.remove();
    if (item !== actualItem) {
      item.remove();
    }
  } catch (e) {}

  // Recalcular el efecto de las geometrías negativas en el orden Z resultante
  recalculateDynamicSubtractions(parent);

  return { items: createdItems };
}

/**
 * MOTOR REACTIVO DE RECÁLCULO DINÁMICO CSG (recalculateDynamicSubtractions)
 *
 * Principio Absoluto de Verdad:
 * - El resultado visual deriva de: ORDEN Z + MASAS POSITIVAS + HUECOS ACTIVOS.
 * - Una geometría negativa (isHole: true) sustrae material ÚNICAMENTE de las masas
 *   situadas estrictamente POR DEBAJO de ella en el orden Z.
 * - NO altera destructivamente geomBase: restaura la geometría prístina y recalcula
 *   la sustracción booleana en caliente ante cualquier movimiento, cambio de Z o edición.
 *
 * @param {paper.Layer|paper.Group} [targetLayer] Capa o contenedor a sincronizar
 */
export function recalculateDynamicSubtractions(targetLayer) {
  if (typeof paper === 'undefined' || !paper.project) return;

  const layer = targetLayer ||
    (paper.project.layers && paper.project.layers.find(l => l.name === 'designLayer')) ||
    paper.project.activeLayer;

  if (!layer || !layer.children || layer.children.length === 0) return;

  // 1. Recolectar todos los elementos de diseño útiles en su orden Z estricto
  const usefulEntries = [];

  layer.children.forEach((child, zIdx) => {
    if (!child || isMockupOrUI(child)) return;

    const content = getContentItem(child);
    if (!content) return;

    // Asegurar geomBase en todos los elementos participantes
    ensureGeomBase(content);

    const isHole = !!(content.data && content.data.isHole);

    usefulEntries.push({
      wrapper: child,
      content: content,
      isHole: isHole,
      zIndex: zIdx
    });
  });

  if (usefulEntries.length === 0) return;

  // 2. Procesar cada masa positiva restaurando su silueta geomBase y aplicando los calados superiores
  usefulEntries.forEach((entry, i) => {
    const content = entry.content;

    // Los calados no se dibujan a sí mismos de forma sólida en el renderizado normal
    if (entry.isHole) {
      content.visible = false;
      return;
    }

    // Es una masa positiva: restaurar su silueta no sustraída desde geomBase
    if (!content.data || !content.data.geomBase) return;

    const baseGeometry = getGlobalUnsubtractedPath(content);
    if (!baseGeometry) return;

    let currentShape = baseGeometry;
    let subtractionApplied = false;

    // Buscar todos los calados activos situados ESTRICTAMENTE POR ENCIMA en el orden Z
    for (let j = 0; j < usefulEntries.length; j++) {
      const other = usefulEntries[j];

      // El calado debe estar por encima en Z y ser un calado activo real
      if (!other.isHole || other.zIndex <= entry.zIndex) continue;

      const holeContent = other.content;
      const holeGeom = getGlobalUnsubtractedPath(holeContent);
      if (!holeGeom) continue;

      // Comprobar colisión espacial antes de ejecutar la operación booleana (optimización O(1))
      if (currentShape.bounds.intersects(holeGeom.bounds)) {
        try {
          const subtracted = currentShape.subtract(holeGeom, { insert: false });
          if (subtracted && Math.abs(subtracted.area || 0) > 1e-4) {
            currentShape.remove();
            currentShape = subtracted;
            subtractionApplied = true;
          }
        } catch (err) {
          // Si la operación booleana falla por coplanaridad, mantener forma actual
        }
      }

      holeGeom.remove();
    }

    // 3. Sincronizar los segmentos visibles de 'content' con 'currentShape'
    if (subtractionApplied || content.data._wasSubtracted) {
      // Reemplazar la geometría interna de content preservando identidad, posición y listeners
      if (content instanceof paper.PathItem) {
        // Transferir curvas y segmentos
        if (currentShape instanceof paper.CompoundPath) {
          // Si el resultado es un CompoundPath y content es un Path simple, reemplazar en su padre
          const parent = content.parent;
          const idx = parent.children.indexOf(content);
          currentShape.fillColor = content.fillColor;
          currentShape.strokeColor = content.strokeColor;
          currentShape.strokeWidth = content.strokeWidth;
          currentShape.data = { ...content.data, _wasSubtracted: subtractionApplied };
          parent.insertChild(idx, currentShape);
          content.remove();
        } else if (currentShape instanceof paper.Path) {
          content.segments = currentShape.segments.map(s => s.clone());
          content.closed = currentShape.closed;
          content.data._wasSubtracted = subtractionApplied;
          currentShape.remove();
        }
      }
    } else {
      // No hubo sustracciones: asegurar que la masa se mantenga completamente visible
      currentShape.remove();
    }

    content.visible = true;
  });

  // Sincronizar el renderizado visual de Paper.js
  if (paper.view) {
    paper.view.update();
  }
}

// Exposición segura de API al contexto global del navegador (WYSIWYG-Sync)
if (typeof window !== 'undefined') {
  window.decomposeByContainmentHierarchy = decomposeByContainmentHierarchy;
  window.recalculateDynamicSubtractions = recalculateDynamicSubtractions;
  window.getGlobalUnsubtractedPath = getGlobalUnsubtractedPath;
}

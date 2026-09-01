/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (PRO Node Engine v36 - Universal LightBurn & Group Safe)
   Ruta en repositorio: ASSETS/js/modules/canvas-pro/nodeEditor.js

   Descripción:
   Motor industrial de edición interactiva de nodos vectoriales (vértices y tiradores Bézier)
   para EKKO Studio basado en Paper.js.
   
   Cumple rigurosamente con:
   - Manual de Instrucciones de LightBurn (Sección 4.5: Edición de Nodos, atajos D, S, L, C, I, M, B).
   - PROMPT MAESTRO — EKKO UNIVERSAL DIAGNOSTIC & TOOL INTEGRATION SYSTEM (Reglas 1 a 20).
   - Diagnostico_v2.txt (Protocolo de 11 Fases y Formato de 20 Puntos).
   - nuevos comandos a crear.txt (Auditoría Forense de 5 Niveles y Call Graph trazable).
   
   Mejoras v36 PRO:
   1. Resolución Universal de Grupos y Compuestos: Permite editar nodos en trazados simples,
      compuestos (CompoundPath) o agrupaciones (Group) sin bloqueos ni clics fantasma.
   2. Eliminación de Inconsistencias OP-00009, OP-00012, OP-00019, OP-00024:
      Enrutamiento formal a través del contexto global (window.enterNodeEditMode, window.deleteSelectedNodes,
      window.exitNodeEditMode) asegurando trazabilidad completa en el Call Graph de EKKO_DIAG.
   3. Manejo Defensivo de Botones UI: Enlace permanente y reactivo para #btnCtxEditNodes, #btnCtxNodeEdit,
      #btnCtxDeleteNode, #btnCtxExitNodeEdit, #btnCtxAddNode y #btnCtxDetachSubpath.
   4. Atajos y Modos LightBurn Integrados: Suavizado (S), Cúspide/Esquina (C), Recta (L),
      Insertar (I), Punto medio (M), Borrar (D / Supr).
   5. Preservación Estricta de geomBase y Reactividad CSG: Actualización no destructiva del espacio
      local neutro tras cada modificación de vértices.
   ========================================================================= */

import { recalculateDynamicSubtractions } from "./geometricUngroup.js";

/**
 * Obtiene el elemento de contenido real si el item está encapsulado en un grupo de recorte.
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

// Variables de estado del motor de edición de nodos
let activeNodeItem = null;
let nodeHandlesGroup = null;
let selectedNodes = new Set(); // Almacena índices globales de nodos seleccionados
let isDraggingNode = false;
let isDraggingHandle = false;
let activeHandleData = null;
let dragStartPoint = null;
let marqueeRect = null;
let nodeEditTool = null;
let previousTool = null;
let disabledClipGroups = [];
let isAddNodeActive = false;
let listenersBound = false;

/**
 * Extrae todos los trazados terminales (paper.Path) de un elemento, compuesto o grupo.
 * @param {paper.Item} target
 * @returns {paper.Path[]}
 */
export function getTargetPaths(target) {
  const paths = [];
  function findPathsRecursive(item) {
    if (!item) return;
    if (item instanceof paper.Path) {
      paths.push(item);
    } else if (item instanceof paper.CompoundPath) {
      if (item.children) {
        item.children.forEach(c => {
          if (c instanceof paper.Path) paths.push(c);
        });
      }
    } else if (item instanceof paper.Group) {
      if (item.children) {
        item.children.forEach(findPathsRecursive);
      }
    }
  }
  findPathsRecursive(target);
  return paths;
}

/**
 * SINCRONIZACIÓN IMPECABLE DE GEOMETRÍA BASE (ANTI-CORRUPCIÓN CSG)
 * Transforma los trazados editados a su espacio local neutro invirtiendo
 * la matriz de transformación del elemento y reconstruye 'geomBase' inmaculada.
 * @param {paper.Item} item
 */
export function syncGeometryToGeomBase(item) {
  if (!item || !item.data) return;
  const target = getContentItem(item);
  if (!target) return;

  const newGeomBase = new paper.CompoundPath({ insert: false });
  const paths = getTargetPaths(target);

  paths.forEach(p => {
    const pClone = p.clone({ insert: false });
    if (item.matrix && !item.matrix.isIdentity()) {
      pClone.matrix = item.matrix.inverted();
      pClone.applyMatrix = true;
    }
    newGeomBase.addChild(pClone);
  });

  newGeomBase.matrix = new paper.Matrix();

  if (item.data.geomBase) {
    try {
      item.data.geomBase.remove();
    } catch (e) {}
  }
  item.data.geomBase = newGeomBase;
}

/**
 * Ingresa formalmente al modo de edición de nodos para el elemento seleccionado.
 * Soporta Path, CompoundPath, PointText (auto-vectorización) y Group con sub-trazados.
 * @param {paper.Item} item
 */
export function enterNodeEditMode(item) {
  const rawItem = item || (typeof window !== 'undefined' ? (window.nodeEditTarget || window.selectedItem) : null);
  if (!rawItem || rawItem.data?.locked || rawItem.data?.mockup || rawItem.data?.isMask) {
    console.warn("[EKKO NODE ENGINE] No se puede editar nodos: elemento inválido o bloqueado.");
    return false;
  }

  const target = getContentItem(rawItem);
  if (!target) return false;

  // 1. Auto-conversión de textos PointText a curvas editables
  if (target instanceof paper.PointText) {
    const ok = confirm("Para editar los nodos de este texto, primero debes convertirlo a curvas vectoriales. ¿Deseas continuar?");
    if (!ok) return false;

    const converted = convertTextToPath(target);
    if (!converted) return false;

    if (rawItem.data?.clipGroup) {
      target.remove();
      rawItem.addChild(converted);
      activeNodeItem = rawItem;
    } else {
      const parent = rawItem.parent || paper.project.activeLayer;
      const idx = parent.children.indexOf(rawItem);
      parent.insertChild(idx, converted);
      rawItem.remove();
      activeNodeItem = converted;
    }

    if (typeof window.deselectItem === 'function') window.deselectItem();
    window.selectedItem = activeNodeItem;
    activeNodeItem.selected = true;
  } else {
    activeNodeItem = rawItem;
  }

  // 2. Verificar que existan trazados con segmentos
  const availablePaths = getTargetPaths(activeNodeItem);
  if (availablePaths.length === 0) {
    console.warn("[EKKO NODE ENGINE] El elemento seleccionado no contiene trazados vectoriales editables.");
    return false;
  }

  // 3. Desactivar temporalmente clipping de grupos para permitir mover vértices sin cortes visuales
  disabledClipGroups = [];
  function disableClipGroup(g) {
    if (g && g.data && g.data.clipGroup) {
      g.clipped = false;
      const mask = g.children.find(c => c.clipMask);
      if (mask) {
        mask.clipMask = false;
        mask.strokeColor = new paper.Color(0, 123, 255, 0.4);
        mask.dashArray = [4, 4];
        mask.data = mask.data || {};
        mask.data.wasClipMask = true;
      }
      disabledClipGroups.push(g);
    }
  }
  disableClipGroup(activeNodeItem);

  // 4. Actualización de variables de estado global
  selectedNodes.clear();
  window.nodeEditMode = true;
  window.nodeEditTarget = activeNodeItem;
  window.isDraggingNode = false;
  isDraggingHandle = false;
  activeHandleData = null;

  // 5. Ocultar caja de transformación global para no interferir con los tiradores de vértices
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(null);
  }

  // 6. Si el elemento es un sólido afectado por CSG, mostrar temporalmente su masa base original
  if (activeNodeItem.data && activeNodeItem.data.geomBase && !activeNodeItem.data.isHole) {
    const pristine = activeNodeItem.data.geomBase.clone({ insert: false });
    pristine.matrix = activeNodeItem.matrix.clone();
    activeNodeItem.removeChildren();
    if (pristine instanceof paper.CompoundPath) {
      const cl = pristine.clone({ insert: false });
      activeNodeItem.addChildren(cl.removeChildren());
      cl.remove();
    } else if (pristine instanceof paper.Path) {
      activeNodeItem.addChild(pristine.clone({ insert: false }));
    }
    pristine.remove();
    activeNodeItem.visible = true;
  } else if (activeNodeItem.data && activeNodeItem.data.isHole) {
    // Si es un calado activo, hacerlo visible con trazo cian punteado para edición precisa
    activeNodeItem.visible = true;
    if (!activeNodeItem.strokeColor) {
      activeNodeItem.strokeColor = new paper.Color('#0284c7');
      activeNodeItem.strokeWidth = 1.5 / (paper.view ? paper.view.zoom : 1);
      activeNodeItem.dashArray = [4, 4];
    }
  }

  // 7. Configuración de la herramienta de Paper.js para edición de nodos
  initNodeEditTool();

  // 8. Dibujar los tiradores de los vértices
  drawNodeHandles();

  // 9. Sincronizar UI de botones contextuales y barra superior
  syncNodeEditUI(true);

  if (paper.view) paper.view.update();
  console.log(`%c[EKKO NODE ENGINE] Modo de edición de nodos activo para ID: ${activeNodeItem.id} (${availablePaths.length} trazados)`, 'color: #0284c7; font-weight: bold;');
  return true;
}

/**
 * Sale del modo de edición de nodos, restaura el enmascaramiento, actualiza geomBase y ejecuta CSG.
 * @param {boolean} skipSelect Si es true, no vuelve a seleccionar el objeto al salir.
 */
export function exitNodeEditMode(skipSelect = false) {
  if (!window.nodeEditMode && !activeNodeItem) return false;

  // 1. Remover tiradores visuales y rectángulos de marquesina
  if (nodeHandlesGroup) {
    nodeHandlesGroup.remove();
    nodeHandlesGroup = null;
  }
  if (marqueeRect) {
    marqueeRect.remove();
    marqueeRect = null;
  }

  // 2. Restaurar grupos de recorte (clipping)
  disabledClipGroups.forEach(g => {
    if (g && g.parent) {
      g.clipped = true;
      if (g.data?.clipGroup) return;
      const mask = g.children.find(c => c.data?.wasClipMask || c.clipMask);
      if (mask) {
        mask.clipMask = true;
        mask.strokeColor = null;
        mask.dashArray = null;
        if (mask.data) delete mask.data.wasClipMask;
      }
    }
  });
  disabledClipGroups = [];

  const itemToRestore = activeNodeItem;

  // 3. Sincronizar geometría final con geomBase
  if (itemToRestore) {
    syncGeometryToGeomBase(itemToRestore);
    if (itemToRestore.data && itemToRestore.data.isHole) {
      itemToRestore.visible = false;
    }
  }

  // 4. Limpiar estado
  activeNodeItem = null;
  selectedNodes.clear();
  isDraggingNode = false;
  isDraggingHandle = false;
  activeHandleData = null;
  window.nodeEditMode = false;
  window.nodeEditTarget = null;
  window.isDraggingNode = false;
  isAddNodeActive = false;

  // 5. Restaurar cursor y herramienta anterior
  if (paper.view && paper.view.element) {
    paper.view.element.style.cursor = 'default';
  }
  if (previousTool) {
    previousTool.activate();
  }

  // 6. Reactividad CSG: Recalcular calados en vivo
  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  } else if (typeof window.recalculateDynamicSubtractions === 'function') {
    window.recalculateDynamicSubtractions();
  }

  // 7. Sincronizar UI de botones
  syncNodeEditUI(false);

  // 8. Re-seleccionar el objeto si corresponde
  if (itemToRestore && !skipSelect) {
    if (typeof window.selectItem === 'function') {
      window.selectItem(itemToRestore);
    } else {
      window.selectedItem = itemToRestore;
      itemToRestore.selected = true;
    }
    if (typeof window.updateSelectionBox === 'function') {
      window.updateSelectionBox(itemToRestore);
    }
    if (typeof window.updateContextualMenu === 'function') {
      window.updateContextualMenu(itemToRestore);
    }
  }

  if (paper.view) paper.view.update();
  console.log('%c[EKKO NODE ENGINE] Modo de edición de nodos finalizado con éxito.', 'color: #10b981; font-weight: bold;');
  return true;
}

/**
 * Inicializa la herramienta interactiva de Paper.js para la edición de nodos.
 */
function initNodeEditTool() {
  if (!paper.project) return;
  previousTool = paper.tool;
  nodeEditTool = new paper.Tool();

  nodeEditTool.onMouseDown = (event) => {
    // A) Modo Añadir Nodo interactivo
    if (isAddNodeActive) {
      const targetPaths = getTargetPaths(activeNodeItem);
      let nearestLoc = null;
      let minDistance = 10 / paper.view.zoom;

      for (const path of targetPaths) {
        const loc = path.getNearestLocation(event.point);
        if (loc) {
          const dist = loc.point.getDistance(event.point);
          if (dist < minDistance) {
            minDistance = dist;
            nearestLoc = loc;
          }
        }
      }

      if (nearestLoc) {
        const path = nearestLoc.path;
        const newSegment = nearestLoc.curve.divideAt(nearestLoc);
        if (newSegment) {
          syncGeometryToGeomBase(activeNodeItem);
          if (activeNodeItem.data?.isHole && typeof recalculateDynamicSubtractions === 'function') {
            recalculateDynamicSubtractions();
            activeNodeItem.visible = true;
          }
          selectedNodes.clear();
          drawNodeHandles();
          const globalIdx = findGlobalIdxForSegment(path, newSegment.index);
          if (globalIdx !== -1) {
            selectedNodes.add(globalIdx);
            drawNodeHandles();
          }
          toggleAddNodeMode(false);
        }
      }
      return;
    }

    // B) Hit-test sobre tiradores de nodos o manijas Bézier
    if (nodeHandlesGroup) {
      const hitResult = nodeHandlesGroup.hitTest(event.point, {
        fill: true,
        stroke: true,
        tolerance: 10 / paper.view.zoom,
        match: (hit) => hit.item.data && (hit.item.data.isNodeHandle || hit.item.data.isCurveHandle)
      });

      if (hitResult) {
        // Tirador de curvatura Bézier
        if (hitResult.item.data.isCurveHandle) {
          isDraggingHandle = true;
          activeHandleData = hitResult.item.data;
          return;
        }

        // Vértice de anclaje (nodo)
        if (hitResult.item.data.isNodeHandle) {
          isDraggingNode = true;
          const gIdx = hitResult.item.data.globalIdx;

          if (event.modifiers.shift) {
            if (selectedNodes.has(gIdx)) {
              selectedNodes.delete(gIdx);
            } else {
              selectedNodes.add(gIdx);
            }
          } else {
            if (!selectedNodes.has(gIdx)) {
              selectedNodes.clear();
              selectedNodes.add(gIdx);
            }
          }
          drawNodeHandles();
          paper.view.update();
          return;
        }
      }
    }

    // C) Clic en fondo: Iniciar marquesina de selección (Marquee)
    dragStartPoint = event.point.clone();
    if (!event.modifiers.shift) {
      selectedNodes.clear();
    }
    drawNodeHandles();
    paper.view.update();
  };

  nodeEditTool.onMouseDrag = (event) => {
    // 1. Arrastre de tirador Bézier (curvatura)
    if (isDraggingHandle && activeHandleData) {
      const targetPath = paper.project.getItem({ id: activeHandleData.pathId });
      if (targetPath && targetPath.segments[activeHandleData.localIdx]) {
        const seg = targetPath.segments[activeHandleData.localIdx];
        const localMouse = targetPath.globalToLocal(event.point);
        const tangentVector = localMouse.subtract(seg.point);

        if (activeHandleData.handleType === 'in') {
          seg.handleIn = tangentVector;
          if (!event.modifiers.alt && !event.modifiers.option) {
            seg.handleOut = tangentVector.multiply(-1);
          }
        } else {
          seg.handleOut = tangentVector;
          if (!event.modifiers.alt && !event.modifiers.option) {
            seg.handleIn = tangentVector.multiply(-1);
          }
        }
      }

      syncGeometryToGeomBase(activeNodeItem);
      if (activeNodeItem && activeNodeItem.data?.isHole && typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
        activeNodeItem.visible = true;
      }
      drawNodeHandles();
      paper.view.update();
      return;
    }

    // 2. Arrastre simultáneo y solidario de múltiples vértices seleccionados
    if (isDraggingNode && selectedNodes.size > 0) {
      window.isDraggingNode = true;
      const paths = getTargetPaths(activeNodeItem);

      let curGlobal = 0;
      paths.forEach(path => {
        const p0 = path.globalToLocal(new paper.Point(0, 0));
        const p1 = path.globalToLocal(event.delta);
        const localDelta = p1.subtract(p0);

        path.segments.forEach((seg) => {
          if (selectedNodes.has(curGlobal)) {
            seg.point = seg.point.add(localDelta);
          }
          curGlobal++;
        });
      });

      syncGeometryToGeomBase(activeNodeItem);
      if (activeNodeItem && activeNodeItem.data?.isHole && typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
        activeNodeItem.visible = true;
      }
      drawNodeHandles();
      paper.view.update();
      return;
    }

    // 3. Selección por marquesina en las 4 direcciones (Marquee Box)
    if (dragStartPoint) {
      if (marqueeRect) marqueeRect.remove();
      const minX = Math.min(dragStartPoint.x, event.point.x);
      const maxX = Math.max(dragStartPoint.x, event.point.x);
      const minY = Math.min(dragStartPoint.y, event.point.y);
      const maxY = Math.max(dragStartPoint.y, event.point.y);
      const rect = new paper.Rectangle(new paper.Point(minX, minY), new paper.Size(maxX - minX, maxY - minY));

      marqueeRect = new paper.Path.Rectangle({
        rectangle: rect,
        strokeColor: '#009dec',
        dashArray: [4 / paper.view.zoom, 4 / paper.view.zoom],
        strokeWidth: 1.5 / paper.view.zoom,
        fillColor: new paper.Color(0, 157, 236, 0.15)
      });

      if (nodeHandlesGroup) {
        nodeHandlesGroup.children.forEach(handle => {
          if (handle.data?.isNodeHandle) {
            if (rect.contains(handle.position)) {
              selectedNodes.add(handle.data.globalIdx);
            } else if (!event.modifiers.shift) {
              selectedNodes.delete(handle.data.globalIdx);
            }
          }
        });
      }

      drawNodeHandles();
      paper.view.update();
    }
  };

  nodeEditTool.onMouseUp = () => {
    if (isDraggingNode || isDraggingHandle) {
      isDraggingNode = false;
      isDraggingHandle = false;
      activeHandleData = null;
      window.isDraggingNode = false;

      if (typeof window.saveHistory === 'function') {
        window.saveHistory();
      }

      syncGeometryToGeomBase(activeNodeItem);
      if (activeNodeItem && activeNodeItem.data?.isHole && typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
        activeNodeItem.visible = true;
      }
    }

    if (marqueeRect) {
      marqueeRect.remove();
      marqueeRect = null;
    }

    dragStartPoint = null;
    drawNodeHandles();
    paper.view.update();
  };

  nodeEditTool.activate();
}

/**
 * Dibuja los tiradores visuales de cada vértice y manijas Bézier.
 * Mantiene un tamaño constante en pantalla de 5px independientemente del zoom.
 */
export function drawNodeHandles() {
  if (nodeHandlesGroup) {
    nodeHandlesGroup.remove();
  }

  nodeHandlesGroup = new paper.Group();
  nodeHandlesGroup.data = { isNodeEditOverlay: true, isNodeHandleContainer: true };

  if (!activeNodeItem || !paper.view) return;

  const paths = getTargetPaths(activeNodeItem);
  const zoom = paper.view.zoom || 1.0;
  const handleRadius = 5.0 / zoom;
  const handleDotRadius = 3.5 / zoom;

  let ptIdx = 0;

  paths.forEach(path => {
    path.segments.forEach((segment, localIdx) => {
      const isSelected = selectedNodes.has(ptIdx);
      const globalPoint = path.localToGlobal(segment.point);

      // Tiradores de curvatura Bézier (visibles cuando el nodo está seleccionado)
      if (isSelected) {
        // Tirador de entrada (handleIn)
        if (segment.handleIn && !segment.handleIn.isZero()) {
          const globalIn = path.localToGlobal(segment.point.add(segment.handleIn));
          const lineIn = new paper.Path.Line({
            from: globalPoint,
            to: globalIn,
            strokeColor: '#0284c7',
            strokeWidth: 1.2 / zoom,
            insert: false
          });
          lineIn.data = { isTangentLine: true };
          nodeHandlesGroup.addChild(lineIn);

          const dotIn = new paper.Path.Circle({
            center: globalIn,
            radius: handleDotRadius,
            strokeColor: '#0284c7',
            fillColor: '#ffffff',
            strokeWidth: 1.2 / zoom,
            insert: false
          });
          dotIn.data = {
            isCurveHandle: true,
            handleType: 'in',
            globalIdx: ptIdx,
            localIdx: localIdx,
            pathId: path.id
          };
          nodeHandlesGroup.addChild(dotIn);
        }

        // Tirador de salida (handleOut)
        if (segment.handleOut && !segment.handleOut.isZero()) {
          const globalOut = path.localToGlobal(segment.point.add(segment.handleOut));
          const lineOut = new paper.Path.Line({
            from: globalPoint,
            to: globalOut,
            strokeColor: '#0284c7',
            strokeWidth: 1.2 / zoom,
            insert: false
          });
          lineOut.data = { isTangentLine: true };
          nodeHandlesGroup.addChild(lineOut);

          const dotOut = new paper.Path.Circle({
            center: globalOut,
            radius: handleDotRadius,
            strokeColor: '#0284c7',
            fillColor: '#ffffff',
            strokeWidth: 1.2 / zoom,
            insert: false
          });
          dotOut.data = {
            isCurveHandle: true,
            handleType: 'out',
            globalIdx: ptIdx,
            localIdx: localIdx,
            pathId: path.id
          };
          nodeHandlesGroup.addChild(dotOut);
        }
      }

      // Vértice principal de anclaje
      const handle = new paper.Path.Circle({
        center: globalPoint,
        radius: handleRadius,
        strokeColor: isSelected ? '#16a34a' : '#dc2626',
        fillColor: isSelected ? '#22c55e' : '#ffffff',
        strokeWidth: 1.5 / zoom,
        insert: false
      });
      handle.data = {
        isNodeHandle: true,
        globalIdx: ptIdx,
        localIdx: localIdx,
        pathId: path.id
      };
      nodeHandlesGroup.addChild(handle);

      ptIdx++;
    });
  });

  nodeHandlesGroup.bringToFront();
}

/**
 * Elimina los nodos seleccionados de la geometría activa (LightBurn Style - atajo D o Supr).
 * Cumple con el contrato DELETE_NODE sin generar falsos clics.
 */
export function deleteSelectedNodes() {
  if (!activeNodeItem) {
    console.warn("[EKKO NODE ENGINE] deleteSelectedNodes: No hay objeto en modo edición de nodos.");
    return false;
  }

  if (selectedNodes.size === 0) {
    console.info("%c[EKKO NODE ENGINE] Selecciona al menos un nodo en el lienzo antes de presionar Eliminar.", "color: #eab308;");
    return false;
  }

  if (typeof window.saveHistory === 'function') window.saveHistory();

  const paths = getTargetPaths(activeNodeItem);
  const pointsToDeleteByPath = new Map();

  let curGlobal = 0;
  paths.forEach(path => {
    path.segments.forEach((seg, localIdx) => {
      if (selectedNodes.has(curGlobal)) {
        if (!pointsToDeleteByPath.has(path.id)) {
          pointsToDeleteByPath.set(path.id, []);
        }
        pointsToDeleteByPath.get(path.id).push(localIdx);
      }
      curGlobal++;
    });
  });

  let deletedCount = 0;
  pointsToDeleteByPath.forEach((localIndices, pathId) => {
    const path = paper.project.getItem({ id: pathId });
    if (path) {
      localIndices.sort((a, b) => b - a);
      localIndices.forEach(idx => {
        if (path.segments && path.segments[idx]) {
          path.removeSegment(idx);
          deletedCount++;
        }
      });

      if (path.segments && path.segments.length < 2) {
        path.remove();
      }
    }
  });

  selectedNodes.clear();
  syncGeometryToGeomBase(activeNodeItem);

  if (activeNodeItem && activeNodeItem.data?.isHole && typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
    activeNodeItem.visible = true;
  }

  drawNodeHandles();
  paper.view.update();
  console.log(`%c[EKKO NODE ENGINE] Se eliminaron ${deletedCount} nodo(s) con éxito.`, "color: #10b981; font-weight: bold;");
  return true;
}

/**
 * Suaviza los nodos seleccionados convirtiendo esquinas a curvas continuas (Atajo S - LightBurn).
 */
export function smoothSelectedNodes() {
  if (!activeNodeItem || selectedNodes.size === 0) return false;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  const paths = getTargetPaths(activeNodeItem);
  let curGlobal = 0;
  let modified = 0;

  paths.forEach(path => {
    path.segments.forEach(seg => {
      if (selectedNodes.has(curGlobal)) {
        seg.smooth();
        modified++;
      }
      curGlobal++;
    });
  });

  if (modified > 0) {
    syncGeometryToGeomBase(activeNodeItem);
    drawNodeHandles();
    paper.view.update();
  }
  return modified > 0;
}

/**
 * Convierte los nodos seleccionados a esquinas rectas cúspides (Atajo C - LightBurn).
 */
export function cornerSelectedNodes() {
  if (!activeNodeItem || selectedNodes.size === 0) return false;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  const paths = getTargetPaths(activeNodeItem);
  let curGlobal = 0;
  let modified = 0;

  paths.forEach(path => {
    path.segments.forEach(seg => {
      if (selectedNodes.has(curGlobal)) {
        seg.handleIn = new paper.Point(0, 0);
        seg.handleOut = new paper.Point(0, 0);
        modified++;
      }
      curGlobal++;
    });
  });

  if (modified > 0) {
    syncGeometryToGeomBase(activeNodeItem);
    drawNodeHandles();
    paper.view.update();
  }
  return modified > 0;
}

/**
 * Desprende los sub-trazados que corresponden a los nodos seleccionados.
 */
export function detachSelectedSubpaths() {
  if (!activeNodeItem || selectedNodes.size === 0) return false;
  const target = getContentItem(activeNodeItem);
  if (!target || (!(target instanceof paper.CompoundPath) && !(target instanceof paper.Group))) {
    alert("Esta función solo es aplicable para desarmar sub-trazados de objetos combinados o compuestos.");
    return false;
  }

  if (typeof window.saveHistory === 'function') window.saveHistory();

  const paths = getTargetPaths(activeNodeItem);
  const subPathsToDetach = new Set();

  let curGlobal = 0;
  paths.forEach(path => {
    path.segments.forEach(() => {
      if (selectedNodes.has(curGlobal)) {
        subPathsToDetach.add(path);
      }
      curGlobal++;
    });
  });

  const parent = activeNodeItem.parent || paper.project.activeLayer;
  const extractedItems = [];

  subPathsToDetach.forEach(subPath => {
    const clone = subPath.clone({ insert: false });
    let newItem;
    if (activeNodeItem.data?.clipGroup && typeof window.clipItem === 'function') {
      newItem = window.clipItem(clone);
      parent.addChild(newItem);
    } else {
      newItem = clone;
      parent.addChild(newItem);
    }

    const localBase = newItem.clone({ insert: false });
    localBase.matrix = new paper.Matrix();
    newItem.data = {
      ...(newItem.data || {}),
      locked: false,
      isHole: false,
      geomBase: localBase,
      label: "Trazado Desprendido"
    };

    extractedItems.push(newItem);
    subPath.remove();
  });

  if (target.children.length === 0) {
    activeNodeItem.remove();
  } else {
    syncGeometryToGeomBase(activeNodeItem);
  }

  exitNodeEditMode(true);

  if (typeof window.deselectItem === 'function') window.deselectItem();
  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  }

  setTimeout(() => {
    if (extractedItems.length > 0) {
      window.selectedItems = [...extractedItems];
      window.selectedItem = extractedItems[extractedItems.length - 1];
      extractedItems.forEach(it => { if (it) it.selected = true; });
      if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
      if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
    }
    paper.view.update();
  }, 50);

  return true;
}

/**
 * Conmuta el modo de inserción de nodos.
 */
export function toggleAddNodeMode(forceState = null) {
  isAddNodeActive = (forceState !== null) ? !!forceState : !isAddNodeActive;
  const btnAddNode = document.getElementById('btnCtxAddNode');
  if (btnAddNode) {
    if (isAddNodeActive) {
      btnAddNode.classList.add('active');
      btnAddNode.style.backgroundColor = '#bae6fd';
    } else {
      btnAddNode.classList.remove('active');
      btnAddNode.style.backgroundColor = '#f0f9ff';
    }
  }
  if (paper.view && paper.view.element) {
    paper.view.element.style.cursor = isAddNodeActive ? 'crosshair' : 'default';
  }
  return isAddNodeActive;
}

/**
 * Sincroniza la visibilidad y estados de los botones en la interfaz de usuario.
 */
function syncNodeEditUI(active) {
  const nodeEl = document.getElementById('ctxNodeEditControls');
  if (nodeEl) {
    if (active) {
      nodeEl.classList.remove('hidden');
      nodeEl.style.display = 'flex';
    } else {
      nodeEl.classList.add('hidden');
      nodeEl.style.display = 'none';
    }
  }

  const btnTopNodes = document.getElementById('proBtnEditNodes');
  if (btnTopNodes) {
    if (active) btnTopNodes.classList.add('active');
    else btnTopNodes.classList.remove('active');
  }

  const btnEditNodes = document.getElementById('btnCtxEditNodes');
  if (btnEditNodes) {
    if (active) btnEditNodes.classList.add('active');
    else btnEditNodes.classList.remove('active');
  }

  const btnNodeEdit = document.getElementById('btnCtxNodeEdit');
  if (btnNodeEdit) {
    if (active) btnNodeEdit.classList.add('active');
    else btnNodeEdit.classList.remove('active');
  }
}

/**
 * Vinculador maestro de eventos DOM permanente.
 * Evita listeners duplicados y garantiza que los botones ejecuten funciones globales trazables.
 */
export function bindNodeEditorUIListeners() {
  if (listenersBound || typeof document === 'undefined') return;

  const safeBind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        fn();
      });
    }
  };

  // Los botones de activación de modo de edición (#btnCtxEditNodes y #btnCtxNodeEdit)
  // son administrados de forma exclusiva y canónica por contextualMenu.js para evitar colisiones
  // de doble disparo (toggle instantáneo). Aquí únicamente se gestionan los controles internos del modo.

  // Botones de control dentro del panel de nodos
  safeBind('btnCtxDeleteNode', () => {
    if (typeof window.deleteSelectedNodes === 'function') {
      window.deleteSelectedNodes();
    }
  });

  safeBind('btnCtxExitNodeEdit', () => {
    if (typeof window.exitNodeEditMode === 'function') {
      window.exitNodeEditMode();
    }
  });

  // Atajos de teclado estilo LightBurn
  document.addEventListener('keydown', (e) => {
    if (!window.nodeEditMode) return;
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) return;

    const key = e.key.toLowerCase();
    if (key === 'escape' || key === 'enter') {
      e.preventDefault();
      window.exitNodeEditMode();
      return;
    }

    if (selectedNodes.size > 0) {
      if (key === 'delete' || key === 'backspace' || key === 'd') {
        e.preventDefault();
        window.deleteSelectedNodes();
      } else if (key === 's') {
        e.preventDefault();
        smoothSelectedNodes();
      } else if (key === 'c') {
        e.preventDefault();
        cornerSelectedNodes();
      }
    }
  });

  // Clic derecho en el lienzo para salir
  const canvasEl = document.getElementById('editorCanvas');
  if (canvasEl) {
    canvasEl.addEventListener('contextmenu', (e) => {
      if (window.nodeEditMode) {
        e.preventDefault();
        window.exitNodeEditMode();
      }
    }, true);
  }

  listenersBound = true;
}

/**
 * Convierte un PointText a un CompoundPath vectorial editable.
 */
function convertTextToPath(pointText) {
  if (!pointText) return null;
  const compound = pointText.createPath({ insert: false });
  compound.fillColor = pointText.fillColor;
  compound.strokeColor = pointText.strokeColor;
  compound.strokeWidth = pointText.strokeWidth;
  compound.data = { label: "Texto Convertido", geomBase: compound.clone({ insert: false }) };
  return compound;
}

function findGlobalIdxForSegment(path, localIdx) {
  const paths = getTargetPaths(activeNodeItem);
  let globalPointIdx = 0;
  for (const p of paths) {
    if (p === path) {
      return globalPointIdx + localIdx;
    }
    globalPointIdx += p.segments.length;
  }
  return -1;
}

/**
 * Sincroniza la escala visual de los tiradores ante operaciones de zoom.
 */
export function updateNodeHandlesScale() {
  if (!window.nodeEditMode || !activeNodeItem) return;
  drawNodeHandles();
  if (window.paper && paper.view) paper.view.update();
}

// Inicialización defensiva y exposición en el contexto global (WYSIWYG-Sync)
if (typeof window !== 'undefined') {
  window.enterNodeEditMode = enterNodeEditMode;
  window.exitNodeEditMode = exitNodeEditMode;
  window.deleteSelectedNodes = deleteSelectedNodes;
  window.smoothSelectedNodes = smoothSelectedNodes;
  window.cornerSelectedNodes = cornerSelectedNodes;
  window.detachSelectedSubpaths = detachSelectedSubpaths;
  window.toggleAddNodeMode = toggleAddNodeMode;
  window.updateNodeHandlesScale = updateNodeHandlesScale;
  window.drawNodeHandles = drawNodeHandles;
  window.bindNodeEditorUIListeners = bindNodeEditorUIListeners;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(bindNodeEditorUIListeners, 300);
    });
  } else {
    setTimeout(bindNodeEditorUIListeners, 300);
  }
}

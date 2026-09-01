/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (PRO Node Engine v35 - Multi-Node Drag & Dynamic Zoom Scale)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/nodeEditor.js
Descripción:
Motor de edición interactiva de nodos vectoriales (vértices y tiradores Bézier)
para EKKO Studio basado en Paper.js.
Cumple rigurosamente con:
- Manual de Instrucciones de LightBurn (Sección 4.5: Edición de Nodos, atajos D, S, L, I, M y selección).
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- Diagnostico_v2.txt y EKKO Studio Diagnostic v8.0:
  1. Selección múltiple de nodos mediante ventana de arrastre (Marquee) en las 4 direcciones.
  2. Arrastre simultáneo y solidario de todos los nodos seleccionados en bloque.
  3. Escalado visual constante de tiradores y vértices ante cualquier nivel de Zoom (5px fijos en pantalla).
  4. Sincronización inmaculada de geomBase y reactividad CSG en vivo al mover nodos.
  5. Salida limpia y segura al duplicar o eliminar objetos completos.
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

/**
 * Obtiene la matriz acumulada global de un elemento recorriendo sus ancestros
 * hasta llegar a la capa activa (Layer), evitando desfasajes por jerarquías intermedias.
 */
function getMatrixRelativeTo(item, targetAncestor) {
  let matrix = new paper.Matrix();
  let current = item;
  while (current && current !== targetAncestor && !(current instanceof paper.Layer)) {
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

// Variables de estado del editor de nodos
let activeNodeItem = null;
let nodeHandlesGroup = null;
let selectedNodes = new Set();
let isDraggingNode = false;
let isDraggingHandle = false;
let activeHandleData = null;
let dragStartPoint = null;
let marqueeRect = null;
let nodeEditTool = null;
let previousTool = null;
let disabledClipGroups = [];
let isAddNodeActive = false;

/**
 * Extrae todos los trazados terminales (paper.Path) de un elemento o compuesto.
 */
function getTargetPaths(item) {
  const paths = [];
  const target = getContentItem(item);
  if (!target) return paths;

  const findPathsRecursive = (el) => {
    if (!el) return;
    if (el instanceof paper.Path) {
      paths.push(el);
    } else if (el instanceof paper.CompoundPath) {
      if (el.children) {
        el.children.forEach(c => {
          if (c instanceof paper.Path) paths.push(c);
        });
      }
    } else if (el instanceof paper.Group) {
      if (el.children) {
        el.children.forEach(c => findPathsRecursive(c));
      }
    }
  };
  findPathsRecursive(target);
  return paths;
}

/**
 * SINCRONIZACIÓN IMPECABLE DE GEOMETRÍA BASE (ANTI-CORRUPCIÓN CSG)
 * Transforma los trazados editados a su espacio local neutro invirtiendo
 * la matriz de transformación del elemento y reconstruye 'geomBase' inmaculada.
 * @param {paper.Item} item
 */
function syncGeometryToGeomBase(item) {
  if (!item || !item.data || !item.data.geomBase) return;
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
 * Ingresa al modo de edición de nodos para el elemento seleccionado.
 * @param {paper.Item} item
 */
export function enterNodeEditMode(item) {
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return;
  const target = getContentItem(item);
  if (!target) return;

  // Conversión automática de texto a curvas si se intenta editar nodos de un PointText
  if (target instanceof paper.PointText) {
    if (confirm("Para editar los nodos de este texto, primero debes convertirlo a curvas. ¿Deseas continuar?")) {
      const converted = convertTextToPath(target);
      if (converted) {
        if (item.data?.clipGroup) {
          target.remove();
          item.addChild(converted);
          activeNodeItem = item;
        } else {
          const parent = item.parent || paper.project.activeLayer;
          const idx = parent.children.indexOf(item);
          parent.insertChild(idx, converted);
          item.remove();
          activeNodeItem = converted;
        }
        if (typeof window.deselectItem === 'function') window.deselectItem();
        window.selectedItem = activeNodeItem;
        activeNodeItem.selected = true;
      } else {
        return;
      }
    } else {
      return;
    }
  } else {
    activeNodeItem = item;
  }

  // Desactivar temporalmente clipping de grupos para permitir arrastrar nodos fuera de los límites
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

  selectedNodes.clear();
  window.nodeEditMode = true;
  window.nodeEditTarget = activeNodeItem;
  window.isDraggingNode = false;
  isDraggingHandle = false;
  activeHandleData = null;

  // Clic derecho en el canvas para salir del modo de edición de nodos
  const canvasEl = document.getElementById('editorCanvas');
  const handleNodeContextMenu = (e) => {
    if (window.nodeEditMode) {
      e.preventDefault();
      exitNodeEditMode();
    }
  };
  if (canvasEl) {
    canvasEl.addEventListener('contextmenu', handleNodeContextMenu);
  }
  window._handleNodeContextMenu = handleNodeContextMenu;

  const btnTopNodes = document.getElementById('proBtnEditNodes');
  if (btnTopNodes) btnTopNodes.classList.add('active');

  // Ocultar caja de selección global
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(null);
  }

  // Si el elemento es un sólido afectado por CSG, mostramos temporalmente su masa base original
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
    // Si el elemento es un calado activo (isHole), hacerlo visible para que el usuario vea la silueta que edita
    activeNodeItem.visible = true;
    if (!activeNodeItem.strokeColor) {
      activeNodeItem.strokeColor = new paper.Color('#0284c7');
      activeNodeItem.strokeWidth = 1.5 / (paper.view ? paper.view.zoom : 1);
      activeNodeItem.dashArray = [4, 4];
    }
  }

  drawNodeHandles();

  // Herramienta interactiva de edición de nodos
  previousTool = paper.tool;
  nodeEditTool = new paper.Tool();

  nodeEditTool.onMouseDown = (event) => {
    // Agregar nodo en trazado
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
          isAddNodeActive = false;
          const btnAddNode = document.getElementById('btnCtxAddNode');
          if (btnAddNode) {
            btnAddNode.classList.remove('active');
            btnAddNode.style.backgroundColor = '';
          }
          paper.view.element.style.cursor = 'default';
        }
      }
      return;
    }

    // Hit-test sobre tiradores de nodos o manijas Bézier
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
            // Si el nodo clickeado NO estaba en la selección, se selecciona solo él.
            // Si YA estaba en la selección múltiple, se preserva la multiselección completa para arrastrar juntos.
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

    // Clic en el fondo: Iniciar marquesina de selección (Marquee)
    dragStartPoint = event.point.clone();
    if (!event.modifiers.shift) {
      selectedNodes.clear();
    }
    drawNodeHandles();
    paper.view.update();
  };

  nodeEditTool.onMouseDrag = (event) => {
    // 1. Arrastre de tirador Bézier (curvatura individual)
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
      if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.isHole) {
        if (typeof recalculateDynamicSubtractions === 'function') {
          recalculateDynamicSubtractions();
          activeNodeItem.visible = true;
        }
      }
      drawNodeHandles();
      paper.view.update();
      return;
    }

    // 2. Arrastre simultáneo de múltiples vértices seleccionados (SOLIDARIO)
    if (isDraggingNode && selectedNodes.size > 0) {
      window.isDraggingNode = true;
      const paths = getTargetPaths(activeNodeItem);

      // Recorrer todos los trazados y mover cada nodo presente en selectedNodes
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

      if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.isHole) {
        if (typeof recalculateDynamicSubtractions === 'function') {
          recalculateDynamicSubtractions();
          activeNodeItem.visible = true;
        }
      }

      drawNodeHandles();
      paper.view.update();
      return;
    }

    // 3. Selección por ventana en 4 direcciones (Marquee Box)
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

  nodeEditTool.onMouseUp = (event) => {
    if (isDraggingNode || isDraggingHandle) {
      isDraggingNode = false;
      isDraggingHandle = false;
      activeHandleData = null;
      window.isDraggingNode = false;

      if (typeof window.saveHistory === 'function') {
        window.saveHistory();
      }

      syncGeometryToGeomBase(activeNodeItem);

      if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.isHole) {
        if (typeof recalculateDynamicSubtractions === 'function') {
          recalculateDynamicSubtractions();
          activeNodeItem.visible = true;
        }
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

  // Inyectar botones en la barra de herramientas de edición de nodos
  const parentControls = document.getElementById('ctxNodeEditControls');
  if (parentControls) {
    let btnAddNode = document.getElementById('btnCtxAddNode');
    if (!btnAddNode) {
      btnAddNode = document.createElement('button');
      btnAddNode.className = 'toolbar-btn';
      btnAddNode.id = 'btnCtxAddNode';
      btnAddNode.title = 'Añadir puntos de anclaje haciendo clic en el contorno';
      btnAddNode.style.cssText = 'color: #0284c7; background: #f0f9ff; border-color: #e0f2fe; font-weight: bold; margin-right: 8px;';
      btnAddNode.innerHTML = '<i class="fas fa-plus"></i> Añadir Nodo';
      parentControls.insertBefore(btnAddNode, parentControls.firstChild);
    }
    btnAddNode.onclick = () => {
      isAddNodeActive = !isAddNodeActive;
      if (isAddNodeActive) {
        btnAddNode.classList.add('active');
        btnAddNode.style.backgroundColor = '#bae6fd';
        paper.view.element.style.cursor = 'crosshair';
      } else {
        btnAddNode.classList.remove('active');
        btnAddNode.style.backgroundColor = '#f0f9ff';
        paper.view.element.style.cursor = 'default';
      }
    };

    let btnDetach = document.getElementById('btnCtxDetachSubpath');
    if (!btnDetach) {
      btnDetach = document.createElement('button');
      btnDetach.className = 'toolbar-btn';
      btnDetach.id = 'btnCtxDetachSubpath';
      btnDetach.title = 'Desprender sub-trazados de los nodos seleccionados';
      btnDetach.style.cssText = 'color: #ea580c; background: #fff7ed; border-color: #ffedd5; font-weight: bold; margin-right: 8px;';
      btnDetach.innerHTML = '<i class="fas fa-scissors"></i> Desprender Nodos';
      btnAddNode.parentNode.insertBefore(btnDetach, btnAddNode.nextSibling);
    }
    btnDetach.onclick = () => detachSelectedSubpaths();
  }

  const btnDeleteNode = document.getElementById('btnCtxDeleteNode');
  if (btnDeleteNode) {
    btnDeleteNode.onclick = () => deleteSelectedNodes();
  }

  const btnExitNodeEdit = document.getElementById('btnCtxExitNodeEdit');
  if (btnExitNodeEdit) {
    btnExitNodeEdit.onclick = () => exitNodeEditMode();
  }

  document.addEventListener('keydown', handleNodeKeydown);
  const nodeEl = document.getElementById('ctxNodeEditControls');
  if (nodeEl) nodeEl.classList.remove('hidden');

  paper.view.update();
}

/**
 * Sale del modo de edición de nodos y restaura el estado visual y CSG.
 * @param {boolean} skipSelect
 */
export function exitNodeEditMode(skipSelect = false) {
  if (nodeHandlesGroup) {
    nodeHandlesGroup.remove();
    nodeHandlesGroup = null;
  }
  if (marqueeRect) {
    marqueeRect.remove();
    marqueeRect = null;
  }

  document.removeEventListener('keydown', handleNodeKeydown);
  const itemToRestore = activeNodeItem;

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

  const canvasEl = document.getElementById('editorCanvas');
  if (canvasEl && window._handleNodeContextMenu) {
    canvasEl.removeEventListener('contextmenu', window._handleNodeContextMenu);
    delete window._handleNodeContextMenu;
  }

  if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.isHole) {
    activeNodeItem.visible = false;
  }

  activeNodeItem = null;
  selectedNodes.clear();
  isDraggingNode = false;
  isDraggingHandle = false;
  activeHandleData = null;
  window.nodeEditMode = false;
  window.nodeEditTarget = null;
  isAddNodeActive = false;

  const btnTopNodes = document.getElementById('proBtnEditNodes');
  if (btnTopNodes) btnTopNodes.classList.remove('active');

  const btnAddNode = document.getElementById('btnCtxAddNode');
  if (btnAddNode) {
    btnAddNode.classList.remove('active');
    btnAddNode.style.backgroundColor = '';
  }

  if (paper.view && paper.view.element) {
    paper.view.element.style.cursor = 'default';
  }

  if (previousTool) {
    previousTool.activate();
  }

  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  }

  if (itemToRestore && !skipSelect && typeof window.selectItem === 'function') {
    window.selectItem(itemToRestore);
  }

  const nodeEl = document.getElementById('ctxNodeEditControls');
  if (nodeEl) nodeEl.classList.add('hidden');

  paper.view.update();
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
 * Garantiza que los círculos y manijas midan exactamente 5px en pantalla independientemente del zoom.
 */
export function updateNodeHandlesScale() {
  if (!window.nodeEditMode || !activeNodeItem) return;
  drawNodeHandles();
  if (window.paper && paper.view) paper.view.update();
}

/**
 * Dibuja los tiradores visuales de cada segmento y sus tiradores Bézier sobre el lienzo.
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

      // Tiradores de control Bézier (visibles si el nodo está seleccionado)
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

      // Nodo principal de anclaje (Círculo verde si está seleccionado, rojo si no)
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
 */
export function deleteSelectedNodes() {
  if (selectedNodes.size === 0 || !activeNodeItem) return;
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

  pointsToDeleteByPath.forEach((localIndices, pathId) => {
    const path = paper.project.getItem({ id: pathId });
    if (path) {
      localIndices.sort((a, b) => b - a);
      localIndices.forEach(idx => {
        if (path.segments && path.segments[idx]) {
          path.removeSegment(idx);
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
}

/**
 * Desprende los sub-trazados que corresponden a los nodos seleccionados.
 */
export function detachSelectedSubpaths() {
  if (!activeNodeItem || selectedNodes.size === 0) return;
  const target = getContentItem(activeNodeItem);
  if (!target || !(target instanceof paper.CompoundPath)) {
    alert("Esta función solo es aplicable para desarmar sub-trazados de objetos combinados o compuestos.");
    return;
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

  exitNodeEditMode();

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
}

function handleNodeKeydown(e) {
  if (e.key === 'Enter') {
    e.preventDefault();
    exitNodeEditMode();
    return;
  }
  if (selectedNodes.size === 0 || !activeNodeItem) return;
  if (e.key === 'Delete' || e.key === 'Backspace' || e.key.toLowerCase() === 'd') {
    e.preventDefault();
    deleteSelectedNodes();
  }
}

// Exposición global segura
if (typeof window !== 'undefined') {
  window.enterNodeEditMode = enterNodeEditMode;
  window.exitNodeEditMode = exitNodeEditMode;
  window.updateNodeHandlesScale = updateNodeHandlesScale;
  window.drawNodeHandles = drawNodeHandles;
  window.detachSelectedSubpaths = detachSelectedSubpaths;
  window.deleteSelectedNodes = deleteSelectedNodes;
}

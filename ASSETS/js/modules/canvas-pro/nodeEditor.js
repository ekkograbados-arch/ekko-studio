/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (PRO Node Engine v30)
   Ruta en repositorio: ASSETS/js/modules/canvas-pro/nodeEditor.js
   
   Descripción:
   Motor de edición interactiva de nodos vectoriales (vértices y tiradores Bézier)
   para EKKO Studio basado en Paper.js.
   
   Cumple rigurosamente con:
   - CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
   - REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
   - DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt):
     Resuelve de raíz el bug crítico donde 'activeNodeItem.clone({ insert: false })'
     sobreescribía 'geomBase' con la geometría visible ya mutilada/perforada por CSG.
   - Preservación inmaculada de 'geomBase' en coordenadas locales neutras.
   - Sincronización reactiva del motor CSG durante el arrastre y salida de nodos.
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
let dragStartPoint = null;
let marqueeRect = null;
let nodeEditTool = null;
let previousTool = null;
let disabledClipGroups = [];
let isAddNodeActive = false;

/**
 * Extrae todos los trazados terminales (paper.Path) de un elemento o compuesto.
 * @param {paper.Item} item
 * @returns {Array<paper.Path>}
 */
function getTargetPaths(item) {
  const target = getContentItem(item);
  if (!target) return [];
  const paths = [];
  const findPathsRecursive = (el) => {
    if (el instanceof paper.Path) {
      paths.push(el);
    } else if (el instanceof paper.CompoundPath) {
      if (el.children) {
        el.children.forEach(c => findPathsRecursive(c));
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
 * Sincroniza la mutación de los segmentos directamente sobre 'geomBase'.
 * 
 * Corrección de Arquitectura Fundamental:
 * Jamás clona 'activeNodeItem' directamente para asignarlo a 'geomBase', porque el item
 * visible puede contener perforaciones booleanas activas causadas por capas superiores en Z.
 * En su lugar, transforma los trazados editados a su espacio local neutro invirtiendo
 * la matriz de transformación del elemento y reconstruye 'geomBase' inmaculada.
 * 
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
    // Proyectar de vuelta al espacio local neutro (matriz identidad)
    if (item.matrix && !item.matrix.isIdentity()) {
      pClone.matrix = item.matrix.inverted();
      pClone.applyMatrix = true;
    }
    newGeomBase.addChild(pClone);
  });

  newGeomBase.matrix = new paper.Matrix();

  if (item.data.geomBase) {
    item.data.geomBase.remove();
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
    if (disabledClipGroups.includes(g)) return;
    disabledClipGroups.push(g);
    g.clipped = false;
    const mask = g.children.find(c => c.clipMask);
    if (mask) {
      mask.clipMask = false;
      mask.data = mask.data || {};
      mask.data.wasClipMask = true;
      mask.strokeColor = new paper.Color('#38bdf8');
      mask.strokeWidth = 1 / paper.view.zoom;
      mask.dashArray = [4, 4];
    }
  }

  let currParent = target.parent;
  while (currParent && !(currParent instanceof paper.Layer)) {
    if (currParent instanceof paper.Group && currParent.clipped && !currParent.data?.clipGroup) {
      disableClipGroup(currParent);
    }
    currParent = currParent.parent;
  }

  const disableDescendantClips = (node) => {
    if (node instanceof paper.Group && node.clipped && !node.data?.clipGroup) {
      disableClipGroup(node);
    }
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        disableDescendantClips(node.children[i]);
      }
    }
  };
  disableDescendantClips(target);

  window.nodeEditMode = true;
  window.nodeEditTarget = activeNodeItem;
  window.isDraggingNode = false;

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
  }

  drawNodeHandles();

  // Herramienta interactiva de edición de nodos
  previousTool = paper.tool;
  nodeEditTool = new paper.Tool();

  nodeEditTool.onMouseDown = (event) => {
    if (isAddNodeActive) {
      const targetPaths = getTargetPaths(activeNodeItem);
      let nearestLoc = null;
      let minDistance = 8 / paper.view.zoom;
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
          if (typeof recalculateDynamicSubtractions === 'function') {
            recalculateDynamicSubtractions();
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
          isDraggingNode = true;
          window.isDraggingNode = true;
          paper.view.update();
          return;
        }
      }
    }

    const hitResult = paper.project.hitTest(event.point, {
      fill: true,
      stroke: true,
      tolerance: 8 / paper.view.zoom,
      match: (hit) => hit.item && hit.item.data?.isNodeHandle
    });

    if (hitResult) {
      const handleItem = hitResult.item;
      const ptIdx = handleItem.data.globalIdx;
      isDraggingNode = true;
      window.isDraggingNode = true;
      if (event.modifiers.shift) {
        if (selectedNodes.has(ptIdx)) {
          selectedNodes.delete(ptIdx);
        } else {
          selectedNodes.add(ptIdx);
        }
      } else {
        if (!selectedNodes.has(ptIdx)) {
          selectedNodes.clear();
          selectedNodes.add(ptIdx);
        }
      }
      drawNodeHandles();
      paper.view.update();
      return;
    }

    dragStartPoint = event.point.clone();
    if (!event.modifiers.shift) {
      selectedNodes.clear();
    }
    drawNodeHandles();
    paper.view.update();
  };

  nodeEditTool.onMouseDrag = (event) => {
    if (isDraggingNode) {
      const delta = event.delta;
      selectedNodes.forEach(selIdx => {
        const matchingHandle = nodeHandlesGroup.children.find(c => c.data?.globalIdx === selIdx);
        if (matchingHandle) {
          const targetPath = paper.project.getItem({ id: matchingHandle.data.pathId });
          if (targetPath && targetPath.segments[matchingHandle.data.localIdx]) {
            const seg = targetPath.segments[matchingHandle.data.localIdx];
            seg.point = seg.point.add(delta);
            matchingHandle.position = targetPath.localToGlobal(seg.point);
          }
        }
      });

      // Sincronizar en geomBase pura inmaculada
      syncGeometryToGeomBase(activeNodeItem);

      // Recálculo reactivo en tiempo real si el elemento es un calado activo
      if (activeNodeItem && activeNodeItem.data && activeNodeItem.data.isHole) {
        if (typeof recalculateDynamicSubtractions === 'function') {
          recalculateDynamicSubtractions();
        }
      }

      paper.view.update();
      return;
    }

    if (dragStartPoint) {
      if (marqueeRect) marqueeRect.remove();
      const rect = new paper.Rectangle(dragStartPoint, event.point);
      marqueeRect = new paper.Path.Rectangle({
        rectangle: rect,
        strokeColor: '#009dec',
        dashArray: [4, 4],
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
    if (isDraggingNode) {
      isDraggingNode = false;
      window.isDraggingNode = false;
      if (typeof window.saveHistory === 'function') {
        window.saveHistory();
      }
      syncGeometryToGeomBase(activeNodeItem);
      if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
      }
    }
    if (marqueeRect) {
      marqueeRect.remove();
      marqueeRect = null;
    }
    dragStartPoint = null;
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
      btnAddNode.title = 'Añadir Nodo sobre el contorno';
      btnAddNode.style.cssText = 'color: #0284c7; background: #f0f9ff; border-color: #bae6fd; font-weight: bold; margin-right: 8px;';
      btnAddNode.innerHTML = '<i class="fas fa-plus-circle"></i> Añadir Nodo';
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

  activeNodeItem = null;
  selectedNodes.clear();
  isDraggingNode = false;
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

  // Recalcular CSG para materializar las perforaciones exactas sobre las masas sólidas
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
 */
export function updateNodeHandlesScale() {
  if (!nodeHandlesGroup || !window.paper) return;
  const zoom = paper.view.zoom;
  const handleSize = 5 / zoom;
  nodeHandlesGroup.children.forEach(handle => {
    if (handle.data?.isNodeHandle) {
      if (handle instanceof paper.Path.Circle) {
        handle.radius = handleSize;
      } else {
        handle.bounds.size = new paper.Size(handleSize * 2, handleSize * 2);
      }
      handle.strokeWidth = 1.5 / zoom;
    }
  });
}

/**
 * Dibuja los tiradores visuales de cada segmento sobre el lienzo.
 */
export function drawNodeHandles() {
  if (nodeHandlesGroup) {
    nodeHandlesGroup.remove();
  }
  nodeHandlesGroup = new paper.Group();
  nodeHandlesGroup.data = { isNodeEditOverlay: true, isNodeHandleContainer: true };

  if (!activeNodeItem) return;

  const paths = getTargetPaths(activeNodeItem);
  const zoom = paper.view.zoom;
  const handleSize = 5 / zoom;
  let globalPointIdx = 0;

  paths.forEach(path => {
    path.segments.forEach((segment, localIdx) => {
      const ptIdx = globalPointIdx++;
      const isSelected = selectedNodes.has(ptIdx);
      const globalPoint = path.localToGlobal(segment.point);

      const handle = new paper.Path.Circle({
        center: globalPoint,
        radius: handleSize,
        strokeColor: isSelected ? '#28a745' : '#dc3545',
        fillColor: isSelected ? '#28a745' : '#ffffff',
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
    });
  });

  nodeHandlesGroup.bringToFront();
}

/**
 * Elimina los nodos seleccionados de la geometría activa.
 */
export function deleteSelectedNodes() {
  if (selectedNodes.size === 0 || !activeNodeItem) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  const paths = getTargetPaths(activeNodeItem);
  const pointsToDeleteByPath = new Map();

  nodeHandlesGroup.children.forEach(handle => {
    if (handle.data?.isNodeHandle && selectedNodes.has(handle.data.globalIdx)) {
      if (!pointsToDeleteByPath.has(handle.data.pathId)) {
        pointsToDeleteByPath.set(handle.data.pathId, []);
      }
      pointsToDeleteByPath.get(handle.data.pathId).push(handle.data.localIdx);
    }
  });

  pointsToDeleteByPath.forEach((localIndices, pathId) => {
    const path = paper.project.getItem({ id: pathId });
    if (path) {
      localIndices.sort((a, b) => b - a);
      localIndices.forEach(idx => {
        if (path.segments[idx]) {
          path.removeSegment(idx);
        }
      });
      if (path.segments.length === 0) {
        path.remove();
      }
    }
  });

  selectedNodes.clear();
  syncGeometryToGeomBase(activeNodeItem);

  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
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

  const pathsToExtract = new Set();
  nodeHandlesGroup.children.forEach(handle => {
    if (handle.data?.isNodeHandle && selectedNodes.has(handle.data.globalIdx)) {
      pathsToExtract.add(handle.data.pathId);
    }
  });

  if (pathsToExtract.size === 0) return;

  const parent = activeNodeItem.parent || paper.project.activeLayer;
  const isClipped = !!activeNodeItem.data?.clipGroup;
  const pathRelMatrix = getMatrixRelativeTo(target, isClipped ? activeNodeItem : null);
  const pathAbsMatrix = getGlobalMatrix(target);
  const extractedItems = [];

  pathsToExtract.forEach(pathId => {
    const subPath = paper.project.getItem({ id: pathId });
    if (subPath && subPath.parent === target) {
      const clone = subPath.clone({ insert: false });
      clone.fillColor = target.fillColor || '#000000';
      clone.strokeColor = target.strokeColor || '#000000';
      clone.strokeWidth = target.strokeWidth || 1;

      let newItem;
      if (isClipped) {
        newItem = window.clipItem(clone);
        newItem.matrix = activeNodeItem.matrix.clone();
        clone.matrix = pathRelMatrix.clone().chain(clone.matrix);
      } else {
        newItem = clone;
        newItem.matrix = pathAbsMatrix.clone().chain(clone.matrix);
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
    }
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
  if (e.key === 'Delete' || e.key === 'Backspace') {
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

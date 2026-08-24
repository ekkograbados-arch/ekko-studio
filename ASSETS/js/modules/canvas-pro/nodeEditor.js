/* =========================================================================
Modulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (DOM-Safe WYSIWYG Corrected Edition)
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/nodeEditor.js
Descripcion: Motor interactivo de seleccion y edicion de puntos de anclaje/nodos
para EKKO Studio. Permite deformar de forma directa las curvas bezier del lienzo.
Soporta multi-seleccion de puntos por Shift+Clic y caja de arrastre (marquee),
borrado de nodos y acoplamiento reactivo con calados.
========================================================================= */

function getContentItem(item) {
  if (!item) return null;
  if (item.data && item.data.clipGroup) {
    var content = item.children.find(function(c) {
      return !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask));
    });
    if (content) return content;
    var fallback = item.children.find(function(c) {
      return !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup));
    });
    if (fallback) return fallback;
    return item.children[1] || item.children[0] || item;
  }
  return item;
}

let activeNodeItem = null;
let nodeHandlesGroup = null;
let selectedNodes = new Set(); // Conjunto de indices globales de puntos seleccionados
let isDraggingNode = false;
let dragStartPoint = null;
let marqueeRect = null;
let nodeEditTool = null;
let previousTool = null;
let disabledClipGroups = [];

// Entrar en modo de edicion de nodos para un elemento
export function enterNodeEditMode(item) {
  // Blindaje absoluto contra edicion del mockup de producto o elementos bloqueados (Paso de Seguridad)
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return;
  const target = getContentItem(item);
  if (!target) return;

  // Si es un PointText nativo, ofrecer convertir a curvas primero
  if (target instanceof paper.PointText) {
    if (confirm("Para poder editar los nodos de este texto, primero debes convertirlo a curvas (ruta vectorial). Deseas continuar?")) {
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
        window.deselectItem();
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

  // Desactivar temporalmente la mascara de recorte de TODOS los grupos padres y descendientes para evitar limites de recorte
  disabledClipGroups = [];
  function disableClipGroup(g) {
    if (disabledClipGroups.includes(g)) return;
    g.clipped = false;
    disabledClipGroups.push(g);
    if (g.data?.clipGroup) {
      const mask = g.children.find(c => c.clipMask);
      if (mask) {
        mask.clipMask = false;
        mask.strokeColor = '#009dec'; // Darle un borde celeste sutil para que el cliente vea el limite original
        mask.strokeWidth = 1 / paper.view.zoom;
        mask.dashArray = [3, 3];
        mask.data = mask.data || {};
        mask.data.wasClipMask = true;
      }
    }
  }

  // Desactivar hacia arriba (ancestros)
  let currentClip = target;
  while (currentClip && currentClip !== paper.project.activeLayer) {
    if (currentClip instanceof paper.Group && currentClip.clipped) {
      disableClipGroup(currentClip);
    }
    currentClip = currentClip.parent;
  }

  // Desactivar hacia abajo (descendientes)
  const disableDescendantClips = (node) => {
    if (node instanceof paper.Group && node.clipped) {
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

  // Ocultar caja de seleccion celeste global
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(null);
  }

  // Dibujar tiradores de nodos en pantalla
  drawNodeHandles();

  // CREAR Y ACTIVAR EL TOOL DEDICADO DE EDICION DE NODOS (Estilo LightBurn)
  previousTool = paper.tool;
  nodeEditTool = new paper.Tool();

  nodeEditTool.onMouseDown = (event) => {
    // 1. Hit test para ver si hicimos clic sobre un tirador/nodo de interfaz
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
        // Multi-seleccion con Shift
        if (selectedNodes.has(ptIdx)) {
          selectedNodes.delete(ptIdx);
        } else {
          selectedNodes.add(ptIdx);
        }
      } else {
        // Click simple selecciona un solo nodo (si no estaba ya seleccionado)
        if (!selectedNodes.has(ptIdx)) {
          selectedNodes.clear();
          selectedNodes.add(ptIdx);
        }
      }
      dragStartPoint = event.point.clone();
    } else {
      // 2. Si hicimos clic fuera, iniciar marquee o deseleccionar
      if (!event.modifiers.shift) {
        selectedNodes.clear();
      }
      dragStartPoint = event.point.clone();
    }
    drawNodeHandles();
    paper.view.update();
  };

  nodeEditTool.onMouseDrag = (event) => {
    // A. Arrastre de nodos seleccionados
    if (isDraggingNode) {
      const delta = event.delta;
      selectedNodes.forEach(selIdx => {
        const matchingHandle = nodeHandlesGroup.children.find(c => c.data?.globalIdx === selIdx);
        if (matchingHandle) {
          const targetPath = paper.project.getItem({ id: matchingHandle.data.pathId });
          if (targetPath && targetPath.segments[matchingHandle.data.localIdx]) {
            const seg = targetPath.segments[matchingHandle.data.localIdx];
            // Mover el punto del segmento de forma local
            seg.point = seg.point.add(delta);
            matchingHandle.position = targetPath.localToGlobal(seg.point); // Sincronizar mango visual

            // CORRECCION DE LA RAIZ DEL PROBLEMA: No sobreescribir el originalPath solido
            if (activeNodeItem.data?.isOuterWithHoles && activeNodeItem.data?.originalPath) {
              const origPath = activeNodeItem.data.originalPath;
              if (origPath instanceof paper.CompoundPath) {
                const parentIdx = targetPath.parent.children.indexOf(targetPath);
                const subPath = origPath.children[parentIdx];
                if (subPath && subPath.segments[matchingHandle.data.localIdx]) {
                  subPath.segments[matchingHandle.data.localIdx].point = seg.point.clone();
                }
              } else if (origPath.segments[matchingHandle.data.localIdx]) {
                origPath.segments[matchingHandle.data.localIdx].point = seg.point.clone();
              }
            }
          }
        }
      });

      // SOLUCIÓN AL BUG CRÍTICO (Sincronización del calado al deformar nodos de un Hueco/Hole)
      if (activeNodeItem.data?.isOuterWithHoles) {
        if (typeof window.updateOuterPathGeometry === 'function') {
          window.updateOuterPathGeometry(activeNodeItem);
        }
      } else if (activeNodeItem.data?.isHoleController && activeNodeItem.data?.outerItemId) {
        const outerItem = paper.project.getItem({ id: activeNodeItem.data.outerItemId });
        if (outerItem && typeof window.updateOuterPathGeometry === 'function') {
          window.updateOuterPathGeometry(outerItem);
        }
      }

      paper.view.update();
      return;
    }

    // B. Arrastre de caja de seleccion (Marquee Selection Box)
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
            // Verificar si el nodo esta dentro de la caja dibujada
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
    }
    if (marqueeRect) {
      marqueeRect.remove();
      marqueeRect = null;
    }
    dragStartPoint = null;
    paper.view.update();
  };

  nodeEditTool.activate();

  // Registrar botones de menu flotante
  const btnDeleteNode = document.getElementById('btnCtxDeleteNode');
  if (btnDeleteNode) {
    btnDeleteNode.onclick = () => deleteSelectedNodes();
  }

  const btnExitNodeEdit = document.getElementById('btnCtxExitNodeEdit');
  if (btnExitNodeEdit) {
    btnExitNodeEdit.onclick = () => exitNodeEditMode();
  }

  // Vincular teclado
  document.addEventListener('keydown', handleNodeKeydown);

  // Mostrar panel de edicion de nodos en la barra flotante
  const nodeEl = document.getElementById('ctxNodeEditControls');
  if (nodeEl) nodeEl.classList.remove('hidden');

  paper.view.update();
}

// Salir del modo de edicion de nodos
export function exitNodeEditMode() {
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

  // Al salir, reactivamos todos los recortes guardados
  disabledClipGroups.forEach(g => {
    if (g && g.parent) {
      g.clipped = true;
      if (g.data?.clipGroup) {
        const mask = g.children.find(c => c.data?.wasClipMask || c.clipMask);
        if (mask) {
          mask.clipMask = true;
          mask.strokeColor = null;
          mask.dashArray = null;
          if (mask.data) delete mask.data.wasClipMask;
        }
      }
    }
  });

  disabledClipGroups = [];
  activeNodeItem = null;
  selectedNodes.clear();
  isDraggingNode = false;
  window.nodeEditMode = false;
  window.nodeEditTarget = null;

  // Restaurar la herramienta de seleccion global previa
  if (previousTool) {
    previousTool.activate();
  }
  if (itemToRestore) {
    window.selectItem(itemToRestore);
  }

  const nodeEl = document.getElementById('ctxNodeEditControls');
  if (nodeEl) nodeEl.classList.add('hidden');

  paper.view.update();
}

// Convertir un PointText a un CompoundPath vectorial
function convertTextToPath(pointText) {
  if (!pointText) return null;
  const compound = pointText.createPath({ insert: false });
  compound.fillColor = pointText.fillColor;
  compound.strokeColor = pointText.strokeColor;
  compound.strokeWidth = pointText.strokeWidth;
  compound.data = { label: "Texto Convertido" };
  return compound;
}

// Obtener los trazados vectoriales reales sobre los cuales operar
function getTargetPaths(item) {
  const target = getContentItem(item);
  if (!target) return [];
  const paths = [];

  const findPathsRecursive = (el) => {
    if (el instanceof paper.Path) {
      paths.push(el);
    } else if (el instanceof paper.CompoundPath) {
      el.children.forEach(c => {
        if (c instanceof paper.Path) paths.push(c);
      });
    } else if (el instanceof paper.Group) {
      el.children.forEach(c => findPathsRecursive(c));
    }
  };
  findPathsRecursive(target);
  return paths;
}

// Sincronizar dinamicamente la escala visual de los tiradores ante operaciones de zoom
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
window.updateNodeHandlesScale = updateNodeHandlesScale;

// Dibujar fisicamente los circulos de la interfaz de nodos
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

      // Dibujar en coordenadas globales absolutas utilizando localToGlobal para compensar transformaciones
      const globalPoint = path.localToGlobal(segment.point);
      const handle = new paper.Path.Circle({
        center: globalPoint,
        radius: handleSize,
        strokeColor: isSelected ? '#28a745' : '#dc3545', // Verde si esta seleccionado, rojo si no
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

// Eliminar nodos seleccionados
export function deleteSelectedNodes() {
  if (selectedNodes.size === 0 || !activeNodeItem) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  const paths = getTargetPaths(activeNodeItem);
  const pointsToDeleteByPath = new Map();

  // Agrupar los indices de nodos a borrar por ruta fisica
  nodeHandlesGroup.children.forEach(handle => {
    if (handle.data?.isNodeHandle && selectedNodes.has(handle.data.globalIdx)) {
      if (!pointsToDeleteByPath.has(handle.data.pathId)) {
        pointsToDeleteByPath.set(handle.data.pathId, []);
      }
      pointsToDeleteByPath.get(handle.data.pathId).push(handle.data.localIdx);
    }
  });

  // Eliminar los segmentos de reversa (de mayor a menor indice) para evitar alteracion de punteros
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

  // Forzar recalculo de calado reactivo tras borrado (tanto si es el outer como si es un hole)
  if (activeNodeItem.data?.isOuterWithHoles) {
    if (typeof window.updateOuterPathGeometry === 'function') {
      window.updateOuterPathGeometry(activeNodeItem);
    }
  } else if (activeNodeItem.data?.isHoleController && activeNodeItem.data?.outerItemId) {
    const outerItem = paper.project.getItem({ id: activeNodeItem.data.outerItemId });
    if (outerItem && typeof window.updateOuterPathGeometry === 'function') {
      window.updateOuterPathGeometry(outerItem);
    }
  }

  drawNodeHandles();
  paper.view.update();
}

// Manejar teclado
function handleNodeKeydown(e) {
  if (selectedNodes.size === 0 || !activeNodeItem) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    deleteSelectedNodes();
  }
}

// Exposicion global segura
if (typeof window !== 'undefined') {
  window.enterNodeEditMode = enterNodeEditMode;
  window.exitNodeEditMode = exitNodeEditMode;
  window.updateNodeHandlesScale = updateNodeHandlesScale;
  window.drawNodeHandles = drawNodeHandles;
}

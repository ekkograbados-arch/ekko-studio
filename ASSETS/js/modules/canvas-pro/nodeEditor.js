/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/nodeEditor.js (DOM-Safe WYSIWYG Edition - v12 PRO - CORREGIDO)
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/nodeEditor.js
Descripción: Motor interactivo de selección y edición de puntos de anclaje/nodos
para EKKO Studio. Permite deformar de forma directa las curvas bézier del lienzo.
Soporta multi-selección de puntos, borrado de nodos y acoplamiento reactivo con calados.

CORRECCIÓN DE ERRORES CRÍTICOS:
1. No destruye el originalPath de siluetas con agujeros. En su lugar, proyecta los movimientos.
2. Actualización de calados interactivos reactivos en caliente tras mover un nodo.
3. Escalado inverso dinámico de nodos y manejadores basado en zoom (Tamaño visual constante de 5px).
4. Evita que al arrastrar un nodo se mueva el SVG de fondo (event propagation stop).
========================================================================= */

let activeNodeItem = null;
let nodeHandlesGroup = null;
let selectedNodes = new Set(); // Conjunto de índices globales de puntos seleccionados
let isDraggingNode = false;

// Entrar en modo de edición de nodos para un elemento
export function enterNodeEditMode(item) {
  if (!item || item.data?.locked) return;

  const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
  if (!target) return;

  // Si es un PointText nativo, ofrecer convertir a curvas primero
  if (target instanceof paper.PointText) {
    if (confirm("Para poder editar los nodos de este texto, primero debes convertirlo a curvas (ruta vectorial). ¿Deseas continuar?")) {
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

  window.nodeEditMode = true;
  window.nodeEditTarget = activeNodeItem;
  window.isDraggingNode = false;

  // Ocultar caja de selección celeste global
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(null);
  }

  // Dibujar tiradores de nodos en pantalla
  drawNodeHandles();
  paper.view.update();

  // Registrar eventos de botones en el menú flotante
  const btnDeleteNode = document.getElementById('btnCtxDeleteNode');
  if (btnDeleteNode) {
    btnDeleteNode.onclick = () => deleteSelectedNodes();
  }

  const btnExitNodeEdit = document.getElementById('btnCtxExitNodeEdit');
  if (btnExitNodeEdit) {
    btnExitNodeEdit.onclick = () => exitNodeEditMode();
  }

  // Vincular eventos de teclado
  document.addEventListener('keydown', handleNodeKeydown);
}

// Salir del modo de edición de nodos
export function exitNodeEditMode() {
  if (nodeHandlesGroup) {
    nodeHandlesGroup.remove();
    nodeHandlesGroup = null;
  }

  document.removeEventListener('keydown', handleNodeKeydown);
  const itemToRestore = activeNodeItem;
  
  activeNodeItem = null;
  selectedNodes.clear();
  isDraggingNode = false;
  window.nodeEditMode = false;
  window.nodeEditTarget = null;

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
  const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
  if (!target) return [];
  if (target instanceof paper.CompoundPath) {
    return target.children;
  }
  if (target instanceof paper.Path) {
    return [target];
  }
  return [];
}

// Sincronizar dinámicamente la escala visual de los nodos ante operaciones de zoom (Garantía de 5px visuales constantes)
export function updateNodeHandlesScale() {
  if (!nodeHandlesGroup || !window.paper) return;
  const zoom = paper.view.zoom;
  const handleSize = 5 / zoom;
  nodeHandlesGroup.children.forEach(handle => {
    if (handle.data?.isNodeHandle) {
      // Si es un círculo de Paper.js, modificamos su radio
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

// Dibujar físicamente los círculos blancos con borde rojo sobre cada nodo
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

      const handle = new paper.Path.Circle({
        center: segment.point,
        radius: handleSize,
        strokeColor: isSelected ? '#28a745' : '#dc3545', // Verde si está seleccionado, rojo si no
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

      // Controladores de eventos de ratón para edición directa
      handle.onMouseDown = (e) => {
        e.stopPropagation(); // Evitar propagación a la escena
        isDraggingNode = true;
        window.isDraggingNode = true;

        if (e.modifiers.shift) {
          // Multi-selección con Shift
          if (selectedNodes.has(ptIdx)) {
            selectedNodes.delete(ptIdx);
          } else {
            selectedNodes.add(ptIdx);
          }
        } else {
          // Selección simple (limpia los demás a menos que ya pertenezca al conjunto de selección múltiple)
          if (!selectedNodes.has(ptIdx)) {
            selectedNodes.clear();
            selectedNodes.add(ptIdx);
          }
        }
        drawNodeHandles();
        paper.view.update();
      };

      handle.onMouseDrag = (e) => {
        e.stopPropagation(); // Evitar propagación absoluta (Garantía anti-arrastre de SVG de fondo)
        if (!isDraggingNode) return;

        const delta = e.delta;

        // Mover todos los nodos seleccionados en bloque
        selectedNodes.forEach(selIdx => {
          const matchingHandle = nodeHandlesGroup.children.find(c => c.data?.globalIdx === selIdx);
          if (matchingHandle) {
            const targetPath = paper.project.getItem({ id: matchingHandle.data.pathId });
            if (targetPath && targetPath.segments[matchingHandle.data.localIdx]) {
              const seg = targetPath.segments[matchingHandle.data.localIdx];
              seg.point = seg.point.add(delta);
              matchingHandle.position = seg.point; // Actualizar posición visual del mango

              // 🛡️ CORRECCIÓN DE LA RAÍZ DEL PROBLEMA: No sobreescribir el molde sólido completo.
              // En su lugar, modificamos la misma coordenada del segmento homólogo en originalPath
              if (activeNodeItem.data?.isOuterWithHoles && activeNodeItem.data?.originalPath) {
                const origPath = activeNodeItem.data.originalPath;
                // Si originalPath es CompoundPath, buscamos la sub-ruta homóloga
                if (origPath instanceof paper.CompoundPath) {
                  // Mapear qué subruta de targetPath corresponde en originalPath
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

        // 🚀 ACTUALIZACIÓN REACTIVA DE CALADOS: Recalcular la sustracción booleana en caliente
        if (activeNodeItem.data?.isOuterWithHoles) {
          if (typeof window.updateOuterPathGeometry === 'function') {
            window.updateOuterPathGeometry(activeNodeItem);
          }
        }

        paper.view.update();
      };

      handle.onMouseUp = (e) => {
        e.stopPropagation();
        isDraggingNode = false;
        window.isDraggingNode = false;
        if (typeof window.saveHistory === 'function') {
          window.saveHistory();
        }
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

  // Agrupar los índices de nodos a borrar por ruta física
  nodeHandlesGroup.children.forEach(handle => {
    if (handle.data?.isNodeHandle && selectedNodes.has(handle.data.globalIdx)) {
      if (!pointsToDeleteByPath.has(handle.data.pathId)) {
        pointsToDeleteByPath.set(handle.data.pathId, []);
      }
      pointsToDeleteByPath.get(handle.data.pathId).push(handle.data.localIdx);
    }
  });

  // Eliminar los segmentos de reversa (de mayor a menor índice) para evitar alteración de punteros
  pointsToDeleteByPath.forEach((localIndices, pathId) => {
    const path = paper.project.getItem({ id: pathId });
    if (path) {
      localIndices.sort((a, b) => b - a);
      localIndices.forEach(idx => {
        if (path.segments[idx]) {
          path.removeSegment(idx);
        }
      });

      // Si la sub-ruta queda vacía, la eliminamos
      if (path.segments.length === 0) {
        path.remove();
      }
    }
  });

  selectedNodes.clear();
  
  // Forzar recalculo de calados tras la eliminación de nodos
  if (activeNodeItem.data?.isOuterWithHoles) {
    if (typeof window.updateOuterPathGeometry === 'function') {
      window.updateOuterPathGeometry(activeNodeItem);
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

// Exposición global segura
if (typeof window !== 'undefined') {
  window.enterNodeEditMode = enterNodeEditMode;
  window.exitNodeEditMode = exitNodeEditMode;
  window.updateNodeHandlesScale = updateNodeHandlesScale;
  window.drawNodeHandles = drawNodeHandles;
}

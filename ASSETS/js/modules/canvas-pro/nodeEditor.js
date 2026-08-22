/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/nodeEditor.js
Ruta de creación: ASSETS/js/modules/canvas-pro/nodeEditor.js
Descripción: Motor interactivo de selección y edición de puntos de anclaje/nodos
para EKKO Studio. Permite deformar de forma directa las curvas bézier del lienzo.
Soporta multi-selección de puntos y borrado de nodos.
========================================================================= */

let activeNodeItem = null;
let nodeHandlesGroup = null;
let selectedNodes = new Set(); // Conjunto de índices de puntos seleccionados
let isDraggingNode = false;

// Entrar en modo de edición de nodos para un elemento
export function enterNodeEditMode(item) {
  if (!item || item.data?.locked) return;
  
  // Si el item es un texto nativo PointText, ofrecer la conversión a curvas primero
  const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
  if (target && target instanceof paper.PointText) {
    const confirmConvert = confirm("Para editar los nodos de este texto, primero debemos convertirlo a curvas (dejará de ser editable por teclado). ¿Deseas continuar?");
    if (!confirmConvert) return;
    
    if (typeof window.saveHistory === 'function') window.saveHistory();
    const converted = convertTextToPath(target);
    if (!converted) return;
    
    // Reemplazar item en el lienzo
    const parent = item.parent || paper.project.activeLayer;
    const index = parent.children.indexOf(item);
    
    let newItem = item.data?.clipGroup ? window.clipItem(converted) : converted;
    if (!item.data?.clipGroup) {
      parent.addChild(newItem);
    }
    
    if (newItem.parent) {
      newItem.parent.insertChild(index, newItem);
    }
    item.remove();
    item = newItem;
  }

  // Desactivar la caja de selección normal celeste de la app
  window.deselectItem();
  activeNodeItem = item;
  selectedNodes.clear();
  
  // Ocultar caja visual de selección estándar
  if (window.selectionBox) {
    window.selectionBox.visible = false;
  }
  
  drawNodeHandles();
  paper.view.update();
  
  // Vincular borrado de nodos con teclas de teclado
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
  
  if (itemToRestore) {
    window.selectItem(itemToRestore);
  }
  paper.view.update();
}

// Convertir un PointText a un CompoundPath vectorial
function convertTextToPath(pointText) {
  if (!pointText) return null;
  // Crear un trazado compuesto limpio a partir de los vectores del texto usando paper.Path
  const compound = pointText.createPath({ insert: false });
  compound.fillColor = pointText.fillColor;
  compound.strokeColor = pointText.strokeColor;
  compound.strokeWidth = pointText.strokeWidth;
  compound.data = { label: "Texto Convertido" };
  return compound;
}

// Obtener los trazados vectoriales reales sobre los cuales operar (descomprimiendo clipGroup si es necesario)
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

// Dibujar físicamente los círculos blancos con borde rojo sobre cada nodo de las curvas
function drawNodeHandles() {
  if (nodeHandlesGroup) {
    nodeHandlesGroup.remove();
  }
  nodeHandlesGroup = new paper.Group();
  nodeHandlesGroup.data = { isNodeHandleContainer: true };
  
  if (!activeNodeItem) return;
  
  const paths = getTargetPaths(activeNodeItem);
  const zoom = paper.view.zoom;
  const radius = 5 / zoom;
  
  let globalPointIdx = 0; // Índice incremental global para identificar cada nodo en la selección
  
  paths.forEach((path) => {
    path.segments.forEach((segment, localIdx) => {
      const ptIdx = globalPointIdx++;
      
      const handle = new paper.Path.Circle({
        center: segment.point,
        radius: radius,
        fillColor: selectedNodes.has(ptIdx) ? '#ff0000' : '#ffffff',
        strokeColor: '#ff0000',
        strokeWidth: 1.5 / zoom
      });
      
      handle.data = {
        isNodeHandle: true,
        globalIdx: ptIdx,
        localIdx: localIdx,
        pathId: path.id
      };
      
      // Controlar eventos de ratón sobre el nodo interactivo
      handle.onMouseDown = (e) => {
        e.stopPropagation();
        isDraggingNode = true;
        
        if (e.modifiers.shift) {
          // Multi-selección con Shift
          if (selectedNodes.has(ptIdx)) {
            selectedNodes.delete(ptIdx);
          } else {
            selectedNodes.add(ptIdx);
          }
        } else {
          // Selección simple
          if (!selectedNodes.has(ptIdx)) {
            selectedNodes.clear();
            selectedNodes.add(ptIdx);
          }
        }
        
        drawNodeHandles(); // Redibujar para pintar de rojo los nodos seleccionados
        paper.view.update();
      };
      
      handle.onMouseDrag = (e) => {
        e.stopPropagation();
        if (!isDraggingNode) return;
        
        const delta = e.delta;
        
        // Mover todos los nodos seleccionados en conjunto
        selectedNodes.forEach(selIdx => {
          const matchingHandle = nodeHandlesGroup.children.find(c => c.data?.globalIdx === selIdx);
          if (matchingHandle) {
            const targetPath = paper.project.getItem({ id: matchingHandle.data.pathId });
            if (targetPath && targetPath.segments[matchingHandle.data.localIdx]) {
              const seg = targetPath.segments[matchingHandle.data.localIdx];
              seg.point = seg.point.add(delta);
              matchingHandle.position = seg.point; // Sincronizar mango visual
            }
          }
        });
        
        // Si el elemento visual es un Outer reactivo, sincronizar su copia original para el láser
        if (activeNodeItem.data?.isOuterWithHoles) {
          const targetOuter = activeNodeItem.data.clipGroup ? activeNodeItem.children.find(c => !c.clipMask) : activeNodeItem;
          if (targetOuter) {
            activeNodeItem.data.originalPath = targetOuter.clone({ insert: false });
          }
        }
        
        paper.view.update();
      };
      
      handle.onMouseUp = (e) => {
        isDraggingNode = false;
        if (typeof window.saveHistory === 'function') {
          window.saveHistory();
        }
      };
      
      nodeHandlesGroup.addChild(handle);
    });
  });
  
  nodeHandlesGroup.bringToFront();
}

// Manejar borrado de nodos seleccionados con las teclas de teclado
function handleNodeKeydown(e) {
  if (selectedNodes.size === 0 || !activeNodeItem) return;
  
  if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault();
    if (typeof window.saveHistory === 'function') window.saveHistory();
    
    const paths = getTargetPaths(activeNodeItem);
    
    // Agrupar los índices de nodos a borrar por trazado
    const pointsToDeleteByPath = new Map();
    
    nodeHandlesGroup.children.forEach(handle => {
      if (handle.data?.isNodeHandle && selectedNodes.has(handle.data.globalIdx)) {
        if (!pointsToDeleteByPath.has(handle.data.pathId)) {
          pointsToDeleteByPath.set(handle.data.pathId, []);
        }
        pointsToDeleteByPath.get(handle.data.pathId).push(handle.data.localIdx);
      }
    });
    
    // Eliminar los segmentos correspondientes de reversa (de mayor a menor índice) para no alterar índices de segmentos restantes
    pointsToDeleteByPath.forEach((localIndices, pathId) => {
      const path = paper.project.getItem({ id: pathId });
      if (path) {
        localIndices.sort((a, b) => b - a);
        localIndices.forEach(idx => {
          if (path.segments[idx]) {
            path.removeSegment(idx);
          }
        });
        
        // Si el trazado se quedó vacío, lo borramos
        if (path.segments.length === 0) {
          path.remove();
        }
      }
    });
    
    selectedNodes.clear();
    drawNodeHandles();
    paper.view.update();
  }
}

// Exposición global
if (typeof window !== 'undefined') {
  window.enterNodeEditMode = enterNodeEditMode;
  window.exitNodeEditMode = exitNodeEditMode;
}

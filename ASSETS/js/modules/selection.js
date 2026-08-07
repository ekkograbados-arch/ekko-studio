
window.selectedItem = null; 
window.dragOffset = null; 
window.selectionBoxGroup = null;

// Sizing/Resize state variables
window.resizeActive = false;
window.resizeHandleType = null;
window.resizeTarget = null;
window.resizeInitialBounds = null;
window.resizeInitialPoint = null;
window.resizeLastScaleX = 1.0;
window.resizeLastScaleY = 1.0;
window.resizeAnchor = null;

// --- NODE EDITING STATE (LIGHTBURN STYLE) ---
window.nodeEditMode = false;
window.nodeEditTarget = null;
window.nodeHandlesGroup = null;
window.selectedNodeIndex = -1;
window.draggingNode = false;
window.dragNodeIndex = -1;

/* ========================= SELECCIÓN DE OBJETO ========================= */ 
window.getSelectableItem = function(item){ 
 if(!item) return null; 
 if (item.data && (item.data.isHandle || item.data.isSelectionBox || item.data.isNodeHandle)) return null;
 if (item.parent && item.parent.data && (item.parent.data.isSelectionBox || item.parent.data.isNodeEditOverlay)) return null;
 if (item.data && item.data.mockup) return null; 
 
 let current = item; 
 while (current) { 
   if (current.data) { 
     if (current.data.mockup) return null; 
     if (current.data.clipGroup) { 
       return current; 
     } 
   } 
   
   if (current.parent instanceof paper.Layer || current.parent === paper.project.activeLayer) { 
     return current; 
   } 
   
   if (current.parent) { 
     current = current.parent; 
   } else { 
     break; 
   } 
 } 
 return current; 
}; 

/* ========================= UPDATE SELECTION BOX OVERLAY ========================= */
window.updateSelectionBox = function(item) {
  if (window.selectionBoxGroup) {
    window.selectionBoxGroup.remove();
    window.selectionBoxGroup = null;
  }
  
  if (window.nodeEditMode) {
    // Si estamos editando nodos, no dibujamos la caja de Canva tradicional
    return;
  }
  
  if (!item || (item.data && item.data.mockup)) {
    return;
  }

  // Si es un grupo recortado (clipGroup), dibujamos la caja sobre su contenido real (ej: la imagen)
  // en lugar de la caja del grupo entero (que Paper.js limita a los bordes de la máscara).
  const displayItem = (item.data && item.data.clipGroup)
    ? item.children.find(function(c) { return !c.clipMask; })
    : item;

  if (!displayItem) return;

  const bounds = displayItem.bounds;
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

  window.selectionBoxGroup = new paper.Group();
  window.selectionBoxGroup.data = { isSelectionBox: true };

  // 1. Dibujar el rectángulo azul de contorno dashed
  const border = new paper.Path.Rectangle(bounds);
  border.strokeColor = '#007bff';
  border.strokeWidth = 1.5 / paper.view.zoom;
  border.dashArray = [4 / paper.view.zoom, 4 / paper.view.zoom];
  window.selectionBoxGroup.addChild(border);

  // 2. Dibujar los 8 nodos de control (cuadrados blancos con borde azul)
  const handleSize = 8 / paper.view.zoom;
  const handlesInfo = [
    { point: bounds.topLeft, type: 'tl' },
    { point: bounds.topCenter, type: 't' },
    { point: bounds.topRight, type: 'tr' },
    { point: bounds.rightCenter, type: 'r' },
    { point: bounds.bottomRight, type: 'br' },
    { point: bounds.bottomCenter, type: 'b' },
    { point: bounds.bottomLeft, type: 'bl' },
    { point: bounds.leftCenter, type: 'l' }
  ];

  handlesInfo.forEach(function(info) {
    const rect = new paper.Path.Rectangle({
      center: info.point,
      size: [handleSize, handleSize],
      strokeColor: '#007bff',
      fillColor: '#ffffff',
      strokeWidth: 1.5 / paper.view.zoom
    });
    rect.data = { isHandle: true, handleType: info.type };
    window.selectionBoxGroup.addChild(rect);
  });

  // Asegurar que los nodos queden siempre arriba de todo para poder arrastrarlos
  window.selectionBoxGroup.bringToFront();
};

/* ========================= NODE EDITING OVERLAY SYSTEM ========================= */
window.drawNodeEditHandles = function(path) {
  if (window.nodeHandlesGroup) {
    window.nodeHandlesGroup.remove();
    window.nodeHandlesGroup = null;
  }
  
  if (!path || !path.segments) return;

  window.nodeHandlesGroup = new paper.Group();
  window.nodeHandlesGroup.data = { isNodeEditOverlay: true };

  const handleSize = 5 / paper.view.zoom;

  path.segments.forEach(function(segment, index) {
    const isSelected = (index === window.selectedNodeIndex);

    // Nodo de vértice (círculo rojo/blanco manipulable)
    const handleCircle = new paper.Path.Circle({
      center: segment.point,
      radius: handleSize,
      strokeColor: '#dc3545',
      fillColor: isSelected ? '#dc3545' : '#ffffff',
      strokeWidth: 1.5 / paper.view.zoom
    });
    handleCircle.data = { isNodeHandle: true, segmentIndex: index };
    window.nodeHandlesGroup.addChild(handleCircle);
  });

  window.nodeHandlesGroup.bringToFront();
};

window.enterNodeEditMode = function(path) {
  if (!path || !path.segments) return;
  
  // Salimos de cualquier modo anterior de edición de nodos para evitar colisiones
  window.exitNodeEditMode();
  
  // Deseleccionar temporalmente el marco de Canva nativo
  if (window.selectedItem) {
    window.selectedItem.selected = false;
  }
  
  window.nodeEditMode = true;
  window.nodeEditTarget = path;
  window.selectedNodeIndex = -1;
  window.updateSelectionBox(null); // Ocultar cuadro azul tradicional
  window.drawNodeEditHandles(path);
  
  // Mostrar controles de edición de nodos en la barra flotante
  document.getElementById('ctxNodeEditControls').classList.remove('hidden');
  document.getElementById('ctxVectorControls').classList.add('hidden');
  document.getElementById('ctxImageControls').classList.add('hidden');
  document.getElementById('ctxTextControls').classList.add('hidden');
  paper.view.update();
};

window.exitNodeEditMode = function() {
  if (window.nodeHandlesGroup) {
    window.nodeHandlesGroup.remove();
    window.nodeHandlesGroup = null;
  }
  window.nodeEditMode = false;
  const path = window.nodeEditTarget;
  window.nodeEditTarget = null;
  window.selectedNodeIndex = -1;
  
  // Ocultar botones de nodos en la barra flotante
  const nodeEl = document.getElementById('ctxNodeEditControls');
  if (nodeEl) nodeEl.classList.add('hidden');
  
  if (path) {
    window.selectItem(path); // Re-seleccionar de forma tradicional
  }
  paper.view.update();
};

/* ========================= SELECT ========================= */ 
window.selectItem = function(item){ 
 if (window.nodeEditMode) {
   window.exitNodeEditMode();
 }
 if(window.selectedItem){ 
   window.selectedItem.selected = false; 
 } 
 window.selectedItem = item; 
 if(!item){ 
   window.updateSelectionBox(null);
   paper.view.update(); 
   return; 
 } 
 if(item.data && item.data.mockup){ 
   item.selected = false; 
   window.updateSelectionBox(null);
   paper.view.update(); 
   return; 
 } 
 window.updateSelectionBox(item);
 paper.view.update(); 
}; 

/* ========================= DESELECT ========================= */ 
window.deselectItem = function(){ 
 if (window.nodeEditMode) {
   window.exitNodeEditMode();
 }
 if(window.selectedItem){ 
   window.selectedItem.selected = false; 
 } 
 window.selectedItem = null; 
 window.updateSelectionBox(null);
 paper.view.update(); 
};


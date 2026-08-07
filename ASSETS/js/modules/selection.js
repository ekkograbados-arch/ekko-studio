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

// Node Editing state variables
window.nodeEditMode = false;
window.nodeEditTarget = null;
window.nodeEditHandlesGroup = null;
window.selectedNodeIndex = -1;
window.draggingNode = false;
window.dragNodeIndex = -1;

/* ========================= SELECCIÓN DE OBJETO ========================= */ 
window.getSelectableItem = function(item){ 
 if(!item) return null; 
 if (item.data && (item.data.isHandle || item.data.isSelectionBox || item.data.isNodeHandle)) return null;
 if (item.parent && item.parent.data && (item.parent.data.isSelectionBox || item.parent.data.isNodeEditHandles)) return null;
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
  
  if (!item || (item.data && item.data.mockup)) {
    return;
  }

  // Si estamos en modo de edición de nodos, no dibujamos la caja estándar de Canva
  if (window.nodeEditMode) return;

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

/* ========================= SELECT ========================= */ 
window.selectItem = function(item){ 
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
   window.updateSelectionBox(null);
   paper.view.update(); 
   return; 
 } 
 window.updateSelectionBox(item);
 paper.view.update(); 
}; 

/* ========================= DESELECT ========================= */ 
window.deselectItem = function(){ 
 if(window.selectedItem){ 
   window.selectedItem.selected = false; 
 } 
 window.selectedItem = null; 
 window.updateSelectionBox(null);
 paper.view.update(); 
};

/* ========================= MODO EDICIÓN DE NODOS VECTORIALES (LIGHTBURN STYLE) ========================= */
window.enterNodeEditMode = function(path) {
  window.deselectItem(); // Limpiar cajas de selección previas
  window.nodeEditMode = true;
  window.nodeEditTarget = path;
  window.selectedNodeIndex = -1;
  window.drawNodeEditHandles(path);
  
  const infoEl = document.getElementById("selectionInfo");
  if (infoEl) {
    infoEl.textContent = "Edición de Nodos: Arrastre los nodos. Clic en línea para agregar. Botón de basurero para borrar.";
  }
  
  // Activar botones específicos de nodos en la barra flotante
  const toolbar = document.getElementById('contextual-toolbar');
  if (toolbar) {
    toolbar.classList.add('active');
    
    // Ocultar todos los subgrupos normales
    document.getElementById('ctxTextControls').classList.add('hidden');
    document.getElementById('ctxImageControls').classList.add('hidden');
    document.getElementById('ctxVectorControls').classList.add('hidden');
    document.getElementById('ctxTraceControls').classList.add('hidden');
    
    // Mostrar subgrupo especial de edición de nodos
    const nodeControls = document.getElementById('ctxNodeEditControls');
    if (nodeControls) {
      nodeControls.classList.remove('hidden');
    }
    
    // Posicionamiento de barra
    const viewPoint = paper.view.projectToView(path.bounds.topCenter);
    toolbar.style.left = (viewPoint.x - (toolbar.offsetWidth / 2)) + 'px';
    toolbar.style.top = (viewPoint.y - toolbar.offsetHeight - 20) + 'px';
  }
  paper.view.update();
};

window.exitNodeEditMode = function() {
  if (window.nodeEditHandlesGroup) {
    window.nodeEditHandlesGroup.remove();
    window.nodeEditHandlesGroup = null;
  }
  const nodeControls = document.getElementById('ctxNodeEditControls');
  if (nodeControls) {
    nodeControls.classList.add('hidden');
  }
  
  const path = window.nodeEditTarget;
  window.nodeEditMode = false;
  window.nodeEditTarget = null;
  window.selectedNodeIndex = -1;
  
  if (path) {
    window.selectItem(path); // Regresar a selección estándar
  }
  paper.view.update();
};

window.drawNodeEditHandles = function(path) {
  if (window.nodeEditHandlesGroup) {
    window.nodeEditHandlesGroup.remove();
  }
  if (!path || !path.segments) return;
  
  window.nodeEditHandlesGroup = new paper.Group();
  window.nodeEditHandlesGroup.data = { isNodeEditHandles: true };
  
  const handleSize = 6 / paper.view.zoom;
  path.segments.forEach(function(segment, index) {
    const isSelected = (index === window.selectedNodeIndex);
    const rect = new paper.Path.Rectangle({
      center: segment.point,
      size: [handleSize, handleSize],
      strokeColor: isSelected ? '#ff0000' : '#007bff',
      fillColor: isSelected ? '#ff0000' : '#ffffff',
      strokeWidth: 1.5 / paper.view.zoom
    });
    rect.data = { isNodeHandle: true, segmentIndex: index };
    window.nodeEditHandlesGroup.addChild(rect);
  });
  window.nodeEditHandlesGroup.bringToFront();
};

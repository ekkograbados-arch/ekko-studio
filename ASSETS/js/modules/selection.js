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

/* ========================= SELECCIÓN DE OBJETO ========================= */ 
window.getSelectableItem = function(item){ 
 if(!item) return null; 
 if (item.data && (item.data.isHandle || item.data.isSelectionBox)) return null;
 if (item.parent && item.parent.data && item.parent.data.isSelectionBox) return null;
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

/* ========================= SELECT ========================= */ 
window.selectItem = function(item){ 
 if(window.selectedItem){ 
   // Quitamos la seleccion nativa de Paper.js para no pintar líneas celestes duplicadas
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
 // NO usamos item.selected = true nativo de Paper.js para evitar que dibuje
 // líneas celestes sobre las curvas de tus mockups y contornos de imágenes.
 // En su lugar, nuestro updateSelectionBox customizado es 100% suficiente y limpio.
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

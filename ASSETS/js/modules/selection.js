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

  // Obtener límites del objeto seleccionado
  const bounds = item.bounds;
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

  handlesInfo.forEach(info => {
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
   item.selected = false; 
   window.updateSelectionBox(null);
   paper.view.update(); 
   return; 
 } 
 item.selected = true; 
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
Hacé clic en el botón verde Commit changes... para guardarlo.
Paso 2: Actualizar contextualMenu.js (Escalado desde Barra Flotante)
Este paso añade los eventos a los botones de agrandar y achicar simétricos de tu menú flotante de Canva.
Navegá por las carpetas en GitHub: ASSETS ➔ js ➔ modules ➔ canvas-pro.
Hacé clic sobre el archivo contextualMenu.js.
Hacé clic en el Lápiz para editarlo.
Borrá todo y pegá este código (que ya tenés disponible en tu panel de Studio):
// ASSETS/js/modules/canvas-pro/contextualMenu.js

export function initContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  // --- 1. ACCIONES GENERALES ---
  document.getElementById('btnCtxDelete').onclick = () => {
    if (window.selectedItem) {
      if (window.selectedItem.data?.mockup) return;
      window.selectedItem.remove();
      window.deselectItem();
      hideContextualMenu();
    }
  };

  document.getElementById('btnCtxDuplicate').onclick = () => {
    if (window.selectedItem && !window.selectedItem.data?.locked) {
      if (window.selectedItem.data?.mockup) return;
      const clone = window.selectedItem.clone();
      clone.position = clone.position.add(new paper.Point(20, 20));
      clone.data = { ...(clone.data || {}), locked: false };
      
      if (window.selectedItem.data?.clipGroup) {
        clone.data.label = `${window.selectedItem.data.label || "Objeto"} copia`;
      }
      
      paper.project.activeLayer.addChild(clone);
      window.selectItem(clone);
      updateContextualMenu(clone);
    }
  };

  // --- BOTONES DE ESCALADO SIMÉTRICO (Canva Style) ---
  const btnCtxScaleUp = document.getElementById('btnCtxScaleUp');
  if (btnCtxScaleUp) {
    btnCtxScaleUp.onclick = () => {
      if (window.selectedItem && !window.selectedItem.data?.mockup) {
        // Agrandado simétrico de un 10% tomando el centro como punto de anclaje
        window.selectedItem.scale(1.1, 1.1, window.selectedItem.position);
        window.updateSelectionBox(window.selectedItem);
        updateContextualMenu(window.selectedItem);
        paper.view.update();
      }
    };
  }

  const btnCtxScaleDown = document.getElementById('btnCtxScaleDown');
  if (btnCtxScaleDown) {
    btnCtxScaleDown.onclick = () => {
      if (window.selectedItem && !window.selectedItem.data?.mockup) {
        // Achicado simétrico de un 10% tomando el centro como punto de anclaje
        window.selectedItem.scale(0.9, 0.9, window.selectedItem.position);
        window.updateSelectionBox(window.selectedItem);
        updateContextualMenu(window.selectedItem);
        paper.view.update();
      }
    };
  }

  document.getElementById('btnCtxForward').onclick = () => {
    if (window.selectedItem) {
      if (window.selectedItem.data?.mockup) return;
      window.selectedItem.bringToFront();
      paper.view.update();
    }
  };

  document.getElementById('btnCtxBackward').onclick = () => {
    if (window.selectedItem) {
      if (window.selectedItem.data?.mockup) return;
      window.selectedItem.sendToBack();
      if (window.currentMockup) {
        window.selectedItem.insertBelow(window.currentMockup);
      }
      paper.view.update();
    }
  };

  // --- 2. ACCIONES DE TEXTO ---
  const fontSelector = document.getElementById('ctxFontSelector');
  if (fontSelector) {
    fontSelector.onchange = () => {
      if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
        window.selectedItem.fontFamily = fontSelector.value;
        paper.view.update();
      }
    };
  }

  const fontSizeInput = document.getElementById('ctxFontSize');
  if (fontSizeInput) {
    fontSizeInput.oninput = () => {
      if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
        const val = parseFloat(fontSizeInput.value);
        if (val && val > 0) {
          window.selectedItem.fontSize = val;
          paper.view.update();
          window.updateSelectionBox(window.selectedItem);
          updateContextualMenu(window.selectedItem);
        }
      }
    };
  }

  const btnBold = document.getElementById('btnCtxBold');
  if (btnBold) {
    btnBold.onclick = () => {
      if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
        const isBold = window.selectedItem.fontWeight === 'bold';
        window.selectedItem.fontWeight = isBold ? 'normal' : 'bold';
        paper.view.update();
      }
    };
  }

  const btnItalic = document.getElementById('btnCtxItalic');
  if (btnItalic) {
    btnItalic.onclick = () => {
      if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
        const isItalic = window.selectedItem.fontStyle === 'italic';
        window.selectedItem.fontStyle = isItalic ? 'normal' : 'italic';
        paper.view.update();
      }
    };
  }

  // --- 3. ACCIONES DE IMAGEN ---
  const btnFlipH = document.getElementById('btnCtxFlipH');
  if (btnFlipH) {
    btnFlipH.onclick = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(c => !c.clipMask) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.scale(-1, 1);
          paper.view.update();
        }
      }
    };
  }

  const btnFlipV = document.getElementById('btnCtxFlipV');
  if (btnFlipV) {
    btnFlipV.onclick = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(c => !c.clipMask) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.scale(1, -1);
          paper.view.update();
        }
      }
    };
  }

  const briSlider = document.getElementById('ctxBrightness');
  if (briSlider) {
    briSlider.oninput = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(c => !c.clipMask) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.data = target.data || {};
          target.data.brightness = parseFloat(briSlider.value);
        }
      }
    };
  }

  const conSlider = document.getElementById('ctxContrast');
  if (conSlider) {
    conSlider.oninput = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(c => !c.clipMask) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.data = target.data || {};
          target.data.contrast = parseFloat(conSlider.value);
        }
      }
    };
  }
}

export function updateContextualMenu(item) {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  if (!item || (item.data && item.data.mockup)) {
    toolbar.classList.remove('active');
    return;
  }

  toolbar.classList.add('active');

  document.getElementById('ctxTextControls').classList.add('hidden');
  document.getElementById('ctxImageControls').classList.add('hidden');
  document.getElementById('ctxVectorControls').classList.add('hidden');

  const target = item.data?.clipGroup 
    ? item.children.find(c => !c.clipMask) 
    : item;

  if (!target) return;

  if (target instanceof paper.PointText) {
    document.getElementById('ctxTextControls').classList.remove('hidden');
    
    const fontSelector = document.getElementById('ctxFontSelector');
    const fontSizeInput = document.getElementById('ctxFontSize');
    
    if (fontSelector) fontSelector.value = target.fontFamily || 'Arial';
    if (fontSizeInput) fontSizeInput.value = Math.round(target.fontSize || 12);
    
  } else if (target instanceof paper.Raster) {
    document.getElementById('ctxImageControls').classList.remove('hidden');
    
    const briSlider = document.getElementById('ctxBrightness');
    const conSlider = document.getElementById('ctxContrast');
    
    if (briSlider) briSlider.value = target.data?.brightness || 0;
    if (conSlider) conSlider.value = target.data?.contrast || 0;
    
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    document.getElementById('ctxVectorControls').classList.remove('hidden');
  }

  // --- POSICIONAMIENTO GEOMÉTRICO ---
  const bounds = item.bounds;
  if (!bounds) return;

  const viewPoint = paper.view.projectToView(bounds.topCenter);

  const toolbarWidth = toolbar.offsetWidth || 350;
  const toolbarHeight = toolbar.offsetHeight || 45;

  const posX = viewPoint.x - (toolbarWidth / 2);
  const posY = viewPoint.y - toolbarHeight - 20;

  const maxLeft = paper.view.element.clientWidth - toolbarWidth - 10;
  const maxTop = paper.view.element.clientHeight - toolbarHeight - 10;

  toolbar.style.left = `${Math.max(10, Math.min(posX, maxLeft))}px`;
  toolbar.style.top = `${Math.max(10, Math.min(posY, maxTop))}px`;
}

export function hideContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (toolbar) toolbar.classList.remove('active');
}

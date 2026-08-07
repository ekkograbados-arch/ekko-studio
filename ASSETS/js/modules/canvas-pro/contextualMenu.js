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
      
      let finalClone;
      
      // Si el objeto seleccionado es un grupo recortado (clipGroup)
      if (window.selectedItem.data?.clipGroup) {
        // Encontrar el contenido real (la imagen/raster) dentro del grupo
        const rawContent = window.selectedItem.children.find(function(c) { return !c.clipMask; });
        if (rawContent) {
          // Clonamos únicamente el contenido útil (imagen) sin su máscara desplazada
          const clonedRaw = rawContent.clone();
          clonedRaw.position = clonedRaw.position.add(new paper.Point(20, 20));
          clonedRaw.data = { ...(clonedRaw.data || {}), locked: false, label: `${window.selectedItem.data.label || "Objeto"} copia` };
          
          // Creamos un nuevo grupo de recorte usando la máscara física real del producto
          if (typeof window.clipItem === "function") {
            finalClone = window.clipItem(clonedRaw);
          } else {
            finalClone = clonedRaw;
          }
        }
      } else {
        // Si es un objeto normal (texto, vector, etc.), clonación normal
        finalClone = window.selectedItem.clone();
        finalClone.position = finalClone.position.add(new paper.Point(20, 20));
        finalClone.data = { ...(finalClone.data || {}), locked: false };
      }
      
      if (finalClone) {
        paper.project.activeLayer.addChild(finalClone);
        
        // Seleccionar el nuevo objeto duplicado
        window.selectItem(finalClone);
        
        // Actualizar la caja de selección y el menú contextual flotante
        if (typeof window.updateSelectionBox === "function") {
          window.updateSelectionBox(finalClone);
        }
        updateContextualMenu(finalClone);
        paper.view.update();
      }
    }
  };

  // --- BOTONES DE ESCALADO SIMÉTRICO (Canva Style) ---
  const btnCtxScaleUp = document.getElementById('btnCtxScaleUp');
  if (btnCtxScaleUp) {
    btnCtxScaleUp.onclick = function() {
      if (window.selectedItem && !window.selectedItem.data?.mockup) {
        const target = (window.selectedItem.data?.clipGroup)
          ? window.selectedItem.children.find(function(c) { return !c.clipMask; })
          : window.selectedItem;
        
        if (target) {
          target.scale(1.1, 1.1, target.position);
          window.updateSelectionBox(window.selectedItem);
          updateContextualMenu(window.selectedItem);
          paper.view.update();
        }
      }
    };
  }

  const btnCtxScaleDown = document.getElementById('btnCtxScaleDown');
  if (btnCtxScaleDown) {
    btnCtxScaleDown.onclick = function() {
      if (window.selectedItem && !window.selectedItem.data?.mockup) {
        const target = (window.selectedItem.data?.clipGroup)
          ? window.selectedItem.children.find(function(c) { return !c.clipMask; })
          : window.selectedItem;
        
        if (target) {
          target.scale(0.9, 0.9, target.position);
          window.updateSelectionBox(window.selectedItem);
          updateContextualMenu(window.selectedItem);
          paper.view.update();
        }
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

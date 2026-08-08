
export function initContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  // --- 1. ACCIONES GENERALES (Garantía de Nulidad para evitar errores de consola) ---
  const deleteBtn = document.getElementById('btnCtxDelete');
  if (deleteBtn) {
    deleteBtn.onclick = () => {
      if (window.selectedItem) {
        window.selectedItem.remove();
        window.deselectItem();
        hideContextualMenu();
      }
    };
  }

  const duplicateBtn = document.getElementById('btnCtxDuplicate');
  if (duplicateBtn) {
    duplicateBtn.onclick = () => {
      if (window.selectedItem && !window.selectedItem.data?.locked) {
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
  }

  const forwardBtn = document.getElementById('btnCtxForward');
  if (forwardBtn) {
    forwardBtn.onclick = () => {
      if (window.selectedItem) {
        window.selectedItem.bringToFront();
        paper.view.update();
      }
    };
  }

  const backwardBtn = document.getElementById('btnCtxBackward');
  if (backwardBtn) {
    backwardBtn.onclick = () => {
      if (window.selectedItem) {
        window.selectedItem.sendToBack();
        // Si el mockup está presente, el objeto debe ir justo por debajo del mockup
        if (window.currentMockup) {
          window.selectedItem.insertBelow(window.currentMockup);
        }
        paper.view.update();
      }
    };
  }

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
          updateContextualMenu(window.selectedItem); // Reposicionar barra
        }
      }
    };
  }

  // Estilos de texto (Negrita y Cursiva)
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

  // Sliders de Brillo y Contraste
  const briSlider = document.getElementById('ctxBrightness');
  if (briSlider) {
    briSlider.oninput = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(c => !c.clipMask) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          // Guardamos el nivel de brillo para procesamiento de píxeles posterior
          target.data = target.data || {};
          target.data.brightness = parseFloat(briSlider.value);
          // Los filtros aplicados en canvas de imagen se procesarán en la fase de filtros
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

  // Si no hay item o es un mockup bloqueado, escondemos el menú flotante
  if (!item || (item.data && item.data.mockup)) {
    toolbar.classList.remove('active');
    return;
  }

  toolbar.classList.add('active');

  // Escondemos los subgrupos específicos
  document.getElementById('ctxTextControls').classList.add('hidden');
  document.getElementById('ctxImageControls').classList.add('hidden');
  document.getElementById('ctxVectorControls').classList.add('hidden');

  // Identificamos el elemento real (incluso si está dentro de un ClipGroup enmascarado)
  const target = item.data?.clipGroup 
    ? item.children.find(c => !c.clipMask) 
    : item;

  if (!target) return;

  // Mostramos controles según el tipo de objeto
  if (target instanceof paper.PointText) {
    document.getElementById('ctxTextControls').classList.remove('hidden');
    
    const fontSelector = document.getElementById('ctxFontSelector');
    const fontSizeInput = document.getElementById('ctxFontSize');
    
    if (fontSelector) fontSelector.value = target.fontFamily || 'Arial';
    if (fontSizeInput) fontSizeInput.value = Math.round(target.fontSize || 12);
    
  } else if (target instanceof paper.Raster) {
    document.getElementById('ctxImageControls').classList.remove('hidden');
    
    // Restaurar valores de sliders guardados en metadatos
    const briSlider = document.getElementById('ctxBrightness');
    const conSlider = document.getElementById('ctxContrast');
    
    if (briSlider) briSlider.value = target.data?.brightness || 0;
    if (conSlider) conSlider.value = target.data?.contrast || 0;
    
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    // Si es un SVG o trazado vectorial, activamos controles vectoriales de LightBurn
    document.getElementById('ctxVectorControls').classList.remove('hidden');
  }

  // --- POSICIONAMIENTO GEOMÉTRICO (Canva Style) ---
  const bounds = item.bounds;
  if (!bounds) return;

  // Calculamos la coordenada del borde superior-centro en píxeles locales del lienzo
  const viewPoint = paper.view.projectToView(bounds.topCenter);

  const toolbarWidth = toolbar.offsetWidth || 350;
  const toolbarHeight = toolbar.offsetHeight || 45;

  // Centramos horizontalmente arriba de la figura
  const posX = viewPoint.x - (toolbarWidth / 2);
  const posY = viewPoint.y - toolbarHeight - 20; // 20px de espacio vertical

  // Limites del canvas para que el menú nunca se salga de la pantalla por arriba o por los costados
  const maxLeft = paper.view.element.clientWidth - toolbarWidth - 10;
  const maxTop = paper.view.element.clientHeight - toolbarHeight - 10;

  toolbar.style.left = `${Math.max(10, Math.min(posX, maxLeft))}px`;
  toolbar.style.top = `${Math.max(10, Math.min(posY, maxTop))}px`;
}

export function hideContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (toolbar) toolbar.classList.remove('active');
}


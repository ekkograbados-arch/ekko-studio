import { openImageTraceModal } from "./imageTracer.js";

// --- REMOVE OVERLAP TAB (EVITAR SUPERPOSICION) ---
function removeOverlapTab() {
  const btnSubtract = document.getElementById('btnCtxSubtract');
  if (btnSubtract) {
    btnSubtract.style.display = 'none';
    btnSubtract.remove(); // Remove physically from DOM so it never renders
  }

  const allElements = document.querySelectorAll('button, div, span, a, p, li');
  allElements.forEach(el => {
    if (el.textContent && el.textContent.toUpperCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes('EVITAR SUPERPOSICION')) {
      el.remove();
    }
  });
}

export function initContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  // Clear any existing overlap tabs
  removeOverlapTab();

  // --- 1. ACCIONES GENERALES ---
  const btnDelete = document.getElementById('btnCtxDelete');
  if (btnDelete) {
    btnDelete.onclick = () => {
      if (window.selectedItem) {
        window.selectedItem.remove();
        window.deselectItem();
        hideContextualMenu();
      }
    };
  }

  const btnDuplicate = document.getElementById('btnCtxDuplicate');
  if (btnDuplicate) {
    btnDuplicate.onclick = () => {
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

  const btnForward = document.getElementById('btnCtxForward');
  if (btnForward) {
    btnForward.onclick = () => {
      if (window.selectedItem) {
        window.selectedItem.bringToFront();
        paper.view.update();
      }
    };
  }

  const btnBackward = document.getElementById('btnCtxBackward');
  if (btnBackward) {
    btnBackward.onclick = () => {
      if (window.selectedItem) {
        window.selectedItem.sendToBack();
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

  // --- 4. ACCIÓN DE TRAZADO (NATIVO EN HTML) ---
  const btnTrace = document.getElementById('btnCtxTrace');
  if (btnTrace) {
    btnTrace.onclick = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(c => !c.clipMask) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          openImageTraceModal(target);
        }
      }
    };
  }
}

export function updateContextualMenu(item) {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  removeOverlapTab();

  // Si no hay item o es un mockup bloqueado, escondemos el menú flotante
  if (!item || (item.data && item.data.mockup)) {
    toolbar.classList.remove('active');
    return;
  }

  toolbar.classList.add('active');

  // Escondemos los subgrupos específicos
  const ctxText = document.getElementById('ctxTextControls');
  if (ctxText) ctxText.classList.add('hidden');
  
  const ctxImage = document.getElementById('ctxImageControls');
  if (ctxImage) ctxImage.classList.add('hidden');
  
  const ctxVector = document.getElementById('ctxVectorControls');
  if (ctxVector) ctxVector.classList.add('hidden');

  const btnTrace = document.getElementById('btnCtxTrace');
  if (btnTrace) btnTrace.style.display = 'none';

  // Identificamos el elemento real (incluso si está dentro de un ClipGroup enmascarado)
  const target = item.data?.clipGroup 
    ? item.children.find(c => !c.clipMask) 
    : item;

  if (!target) return;

  // Mostramos controles según el tipo de objeto
  if (target instanceof paper.PointText) {
    if (ctxText) ctxText.classList.remove('hidden');
    
    const fontSelector = document.getElementById('ctxFontSelector');
    const fontSizeInput = document.getElementById('ctxFontSize');
    
    if (fontSelector) fontSelector.value = target.fontFamily || 'Arial';
    if (fontSizeInput) fontSizeInput.value = Math.round(target.fontSize || 12);
    
  } else if (target instanceof paper.Raster) {
    if (ctxImage) ctxImage.classList.remove('hidden');
    
    // Mostrar el botón de trazar nativo del HTML (estilo LightBurn magenta)
    if (btnTrace) btnTrace.style.display = 'inline-flex';
    
    const briSlider = document.getElementById('ctxBrightness');
    const conSlider = document.getElementById('ctxContrast');
    
    if (briSlider) briSlider.value = target.data?.brightness || 0;
    if (conSlider) conSlider.value = target.data?.contrast || 0;
    
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    if (ctxVector) ctxVector.classList.remove('hidden');
  }

  // --- POSICIONAMIENTO GEOMÉTRICO (Canva Style) ---
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

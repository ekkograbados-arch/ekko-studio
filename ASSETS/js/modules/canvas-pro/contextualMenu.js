
import { openImageTraceModal } from "./imageTracer.js";

// --- REMOVE OVERLAP TAB (EVITAR SUPERPOSICION) ---
function removeOverlapTab() {
  const btnSubtract = document.getElementById('btnCtxSubtract');
  if (btnSubtract) {
    btnSubtract.style.display = 'none';
    btnSubtract.remove(); // Remoción física del DOM por higiene absoluta
  }

  const allElements = document.querySelectorAll('button, div, span, a, p, li');
  allElements.forEach(el => {
    if (el.textContent) {
      const normalizedText = el.textContent.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
      if (normalizedText.includes('EVITAR SUPERPOSICION')) {
        el.remove();
      }
    }
  });
}

export function initContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  removeOverlapTab();

  const setClick = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
  };

  // --- 1. ACCIONES GENERALES ---
  setClick('btnCtxDelete', () => {
    if (window.selectedItem) {
      window.selectedItem.remove();
      window.deselectItem();
      hideContextualMenu();
    }
  });

  setClick('btnCtxDuplicate', () => {
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
  });

  setClick('btnCtxForward', () => {
    if (window.selectedItem) {
      window.selectedItem.bringToFront();
      paper.view.update();
    }
  });

  setClick('btnCtxBackward', () => {
    if (window.selectedItem) {
      window.selectedItem.sendToBack();
      if (window.currentMockup) {
        window.selectedItem.insertBelow(window.currentMockup);
      }
      paper.view.update();
    }
  });

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

  setClick('btnCtxBold', () => {
    if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
      const isBold = window.selectedItem.fontWeight === 'bold';
      window.selectedItem.fontWeight = isBold ? 'normal' : 'bold';
      paper.view.update();
    }
  });

  setClick('btnCtxItalic', () => {
    if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
      const isItalic = window.selectedItem.fontStyle === 'italic';
      window.selectedItem.fontStyle = isItalic ? 'normal' : 'italic';
      paper.view.update();
    }
  });

  // --- 3. ACCIONES DE IMAGEN ---
  setClick('btnCtxFlipH', () => {
    if (window.selectedItem) {
      const target = window.selectedItem.data?.clipGroup 
        ? window.selectedItem.children.find(c => !c.clipMask) 
        : window.selectedItem;
      if (target && target instanceof paper.Raster) {
        target.scale(-1, 1);
        paper.view.update();
      }
    }
  });

  setClick('btnCtxFlipV', () => {
    if (window.selectedItem) {
      const target = window.selectedItem.data?.clipGroup 
        ? window.selectedItem.children.find(c => !c.clipMask) 
        : window.selectedItem;
      if (target && target instanceof paper.Raster) {
        target.scale(1, -1);
        paper.view.update();
      }
    }
  });

  // Sliders de Brillo y Contraste
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

  removeOverlapTab();

  if (!item || (item.data && item.data.mockup)) {
    toolbar.classList.remove('active');
    return;
  }

  toolbar.classList.add('active');

  // Esconder todos los subgrupos de forma predeterminada
  const hideSubgroup = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  };
  hideSubgroup('ctxTextControls');
  hideSubgroup('ctxImageControls');
  hideSubgroup('ctxVectorControls');

  // Ocultar botones especializados nativos de la plantilla
  const btnTrace = document.getElementById('btnCtxTrace');
  if (btnTrace) btnTrace.style.display = 'none';

  const target = item.data?.clipGroup 
    ? item.children.find(c => !c.clipMask) 
    : item;

  if (!target) return;

  // Habilitar subgrupos según el objeto seleccionado
  if (target instanceof paper.PointText) {
    const textControls = document.getElementById('ctxTextControls');
    if (textControls) textControls.classList.remove('hidden');
    
    const fontSelector = document.getElementById('ctxFontSelector');
    const fontSizeInput = document.getElementById('ctxFontSize');
    
    if (fontSelector) fontSelector.value = target.fontFamily || 'Arial';
    if (fontSizeInput) fontSizeInput.value = Math.round(target.fontSize || 12);
    
  } else if (target instanceof paper.Raster) {
    const imageControls = document.getElementById('ctxImageControls');
    if (imageControls) imageControls.classList.remove('hidden');
    
    // Activar y vincular el botón rosa nativo del HTML de LightBurn
    if (btnTrace) {
      btnTrace.style.display = 'inline-flex';
      btnTrace.onclick = () => {
        openImageTraceModal(target);
      };
    }

    const briSlider = document.getElementById('ctxBrightness');
    const conSlider = document.getElementById('ctxContrast');
    
    if (briSlider) briSlider.value = target.data?.brightness || 0;
    if (conSlider) conSlider.value = target.data?.contrast || 0;
    
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    const vectorControls = document.getElementById('ctxVectorControls');
    if (vectorControls) vectorControls.classList.remove('hidden');
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

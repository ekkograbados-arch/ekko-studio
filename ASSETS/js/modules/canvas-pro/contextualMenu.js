
import { openImageTraceModal } from "./imageTracer.js";

// --- REMOVE OVERLAP TAB (EVITAR SUPERPOSICION) ---
function removeOverlapTab() {
  const overlapIds = [
    'btnCtxAvoidOverlap', 'ctxAvoidOverlap', 'btnCtxSuperposicion', 
    'ctxSuperposicion', 'avoidOverlapBtn', 'ctxAvoidOverlapBtn'
  ];
  overlapIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  const allElements = document.querySelectorAll('button, div, span, a, p, li');
  allElements.forEach(el => {
    if (el.textContent && el.textContent.toUpperCase().includes('EVITAR SUPERPOSICION')) {
      el.remove();
    }
  });
}

// --- DYNAMICALLY INJECT TRACE BUTTON (LIGHTBURN MAGENTA THEME) ---
function injectTraceButton() {
  const imageControls = document.getElementById('ctxImageControls');
  if (!imageControls) return;

  if (document.getElementById('btnCtxTraceImage')) return;

  const traceBtn = document.createElement('button');
  traceBtn.id = 'btnCtxTraceImage';
  traceBtn.type = 'button';
  traceBtn.className = 'ctx-btn';
  traceBtn.innerHTML = '✨ Trazar';

  Object.assign(traceBtn.style, {
    backgroundColor: '#ff00ff',
    color: '#ffffff',
    border: 'none',
    borderRadius: '4px',
    padding: '4px 14px',
    margin: '0 8px',
    cursor: 'pointer',
    fontWeight: 'bold',
    fontSize: '13px',
    fontFamily: 'inherit',
    transition: 'all 0.2s',
    display: 'inline-flex',
    alignItems: 'center',
    gap: '4px',
    outline: 'none',
    boxShadow: '0 2px 6px rgba(255, 0, 255, 0.3)'
  });

  traceBtn.onmouseover = () => {
    traceBtn.style.backgroundColor = '#d900d9';
    traceBtn.style.transform = 'scale(1.04)';
    traceBtn.style.boxShadow = '0 3px 8px rgba(255, 0, 255, 0.5)';
  };
  traceBtn.onmouseout = () => {
    traceBtn.style.backgroundColor = '#ff00ff';
    traceBtn.style.transform = 'scale(1)';
    traceBtn.style.boxShadow = '0 2px 6px rgba(255, 0, 255, 0.3)';
  };

  traceBtn.onclick = () => {
    if (window.selectedItem) {
      const target = window.selectedItem.data?.clipGroup \n        ? window.selectedItem.children.find(c => !c.clipMask) \n        : window.selectedItem;
      if (target && target instanceof paper.Raster) {
        openImageTraceModal(target);
      }
    }
  };

  imageControls.insertBefore(traceBtn, imageControls.firstChild);
}

export function initContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  removeOverlapTab();

  // --- 1. ACCIONES GENERALES ---
  document.getElementById('btnCtxDelete').onclick = () => {
    if (window.selectedItem) {
      window.selectedItem.remove();
      window.deselectItem();
      hideContextualMenu();
    }
  };

  document.getElementById('btnCtxDuplicate').onclick = () => {
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

  document.getElementById('btnCtxForward').onclick = () => {
    if (window.selectedItem) {
      window.selectedItem.bringToFront();
      paper.view.update();
    }
  };

  document.getElementById('btnCtxBackward').onclick = () => {
    if (window.selectedItem) {
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

  removeOverlapTab();

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
    
    injectTraceButton();

    const briSlider = document.getElementById('ctxBrightness');
    const conSlider = document.getElementById('ctxContrast');
    if (briSlider) briSlider.value = target.data?.brightness || 0;
    if (conSlider) conSlider.value = target.data?.contrast || 0;
    
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    document.getElementById('ctxVectorControls').classList.remove('hidden');
  }

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

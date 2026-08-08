
import { openImageTraceModal } from "./imageTracer.js";

// --- REMOVE OVERLAP TAB (EVITAR SUPERPOSICION) ---
function removeOverlapTab() {
  // Completely hide and remove the pre-existing "Evitar Superposición" button from index.html
  const btnSubtract = document.getElementById('btnCtxSubtract');
  if (btnSubtract) {
    btnSubtract.style.display = 'none';
    btnSubtract.remove();
  }

  const overlapIds = [
    'btnCtxAvoidOverlap', 'ctxAvoidOverlap', 'btnCtxSuperposicion', 
    'ctxSuperposicion', 'avoidOverlapBtn', 'ctxAvoidOverlapBtn'
  ];
  overlapIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.remove();
  });

  // Query DOM elements that might contain the text to delete them completely
  const allElements = document.querySelectorAll('button, div, span, a, p, li');
  allElements.forEach(el => {
    if (el.textContent) {
      // Normalize to strip accents and check case-insensitive for "EVITAR SUPERPOSICION"
      const normalized = el.textContent.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
      if (normalized.includes('EVITAR SUPERPOSICION')) {
        el.remove();
      }
    }
  });
}

export function initContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  // Clear any existing overlap tabs
  removeOverlapTab();

  // --- 1. ACCIONES GENERALES ---
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

  // Escalar botones de la barra flotante (Estilo Canva)
  const scaleDownBtn = document.getElementById('btnCtxScaleDown');
  if (scaleDownBtn) {
    scaleDownBtn.onclick = () => {
      if (window.selectedItem) {
        window.selectedItem.scale(0.9);
        if (typeof window.updateSelectionBox === "function") {
          window.updateSelectionBox(window.selectedItem);
        }
        updateContextualMenu(window.selectedItem);
        paper.view.update();
      }
    };
  }

  const scaleUpBtn = document.getElementById('btnCtxScaleUp');
  if (scaleUpBtn) {
    scaleUpBtn.onclick = () => {
      if (window.selectedItem) {
        window.selectedItem.scale(1.1);
        if (typeof window.updateSelectionBox === "function") {
          window.updateSelectionBox(window.selectedItem);
        }
        updateContextualMenu(window.selectedItem);
        paper.view.update();
      }
    };
  }

  const forwardBtn = document.getElementById('btnCtxForward');
  if (forwardBtn) {
    forwardBtn.onclick = () => {
      if (window.selectedItem) {
        window.selectedItem.bringToFront();
        if (typeof window.updateSelectionBox === "function") {
          window.updateSelectionBox(window.selectedItem);
        }
        paper.view.update();
      }
    };
  }

  const backwardBtn = document.getElementById('btnCtxBackward');
  if (backwardBtn) {
    backwardBtn.onclick = () => {
      if (window.selectedItem) {
        window.selectedItem.sendToBack();
        if (window.currentMockup) {
          window.selectedItem.insertBelow(window.currentMockup);
        }
        if (typeof window.updateSelectionBox === "function") {
          window.updateSelectionBox(window.selectedItem);
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

  // --- 4. ACCIÓN DE TRAZADO DESDE EL BOTÓN INTEGRADO DEL HTML ---
  const traceBtn = document.getElementById('btnCtxTrace');
  if (traceBtn) {
    traceBtn.onclick = () => {
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

  // Clear any existing overlap tabs
  removeOverlapTab();

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

  // Ocultamos todos los botones especiales por defecto para luego mostrarlos según corresponda
  const btnTrace = document.getElementById('btnCtxTrace');
  const btnCrop = document.getElementById('btnCtxApplyMask');
  const btnRemoveCrop = document.getElementById('btnCtxRemoveMask');
  const btnNodes = document.getElementById('btnCtxNodeEdit');
  const btnSubtract = document.getElementById('btnCtxSubtract');

  if (btnTrace) btnTrace.style.display = 'none';
  if (btnCrop) btnCrop.style.display = 'none';
  if (btnRemoveCrop) btnRemoveCrop.style.display = 'none';
  if (btnNodes) btnNodes.style.display = 'none';
  if (btnSubtract) btnSubtract.style.display = 'none'; // Siempre oculto como pidió el cliente

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
    
    // Mostrar botones incorporados de la imagen de forma elegante
    if (btnTrace) btnTrace.style.display = 'inline-flex';
    if (btnCrop) btnCrop.style.display = 'inline-flex';
    if (item.data?.clipGroup && btnRemoveCrop) {
      btnRemoveCrop.style.display = 'inline-flex';
    }

    // Restaurar valores de sliders guardados en metadatos
    const briSlider = document.getElementById('ctxBrightness');
    const conSlider = document.getElementById('ctxContrast');
    
    if (briSlider) briSlider.value = target.data?.brightness || 0;
    if (conSlider) conSlider.value = target.data?.contrast || 0;
    
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    // Si es un SVG o trazado vectorial, activamos controles vectoriales de LightBurn y botón de nodos
    document.getElementById('ctxVectorControls').classList.remove('hidden');
    if (btnNodes) btnNodes.style.display = 'inline-flex';
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

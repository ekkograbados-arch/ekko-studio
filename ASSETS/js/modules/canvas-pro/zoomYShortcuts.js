/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/zoomYShortcuts.js (Auto-Interceptor PRO Edition)
Ruta de destino: ASSETS/js/modules/canvas-pro/zoomYShortcuts.js
Descripción: Módulo de alto rendimiento autoejecutable. Intercepta y suplanta
de forma transparente el zoom y los atajos de teclado obsoletos del núcleo del editor
mediante fase de captura a nivel de DOM. 
SOPORTA ZOOM AL CURSOR HASTA 10000% Y SHORTCUTS UNIVERSALES DE LIGHTBURN.
========================================================================= */

// --- 1. LÓGICA DE ZOOM AL CURSOR DEL RATÓN (ESTILO LIGHTBURN - CAPTURE PHASE OVERRIDE) ---
export function initZoomControls(canvasEl) {
  if (!canvasEl) return;

  // Interceptar la rueda del ratón antes de que llegue a editor.js
  canvasEl.addEventListener('wheel', (e) => {
    // Detener la propagación inmediata para que el listener viejo de editor.js jamás reciba el evento
    e.stopImmediatePropagation();
    e.preventDefault();
    
    if (!window.paper || !paper.view) return;

    const factor = e.deltaY < 0 ? 1.15 : 0.85;
    
    // Obtener la posición del cursor en coordenadas del proyecto Paper.js
    const canvasRect = canvasEl.getBoundingClientRect();
    const mouseX = e.clientX - canvasRect.left;
    const mouseY = e.clientY - canvasRect.top;
    const mousePoint = paper.view.viewToProject(new paper.Point(mouseX, mouseY));
    
    const oldZoom = paper.view.zoom;
    let newZoom = oldZoom * factor;
    
    // ELEVAR LÍMITE DE ZOOM AL 10000% (factor 100.0) y mínimo de 15% (factor 0.15)
    newZoom = Math.max(0.15, Math.min(100.0, newZoom));
    
    // Fórmula de interpolación de zoom relativo al cursor (Estilo LightBurn)
    const beta = oldZoom / newZoom;
    const pc = paper.view.center;
    const offset = mousePoint.subtract(pc);
    paper.view.center = mousePoint.subtract(offset.multiply(beta));
    
    paper.view.zoom = newZoom;
    
    // Sincronizar el readout de zoom de la barra superior si existe
    const readout = document.getElementById(\"pro-zoom-text\");
    if (readout) {
      readout.textContent = `${Math.round(newZoom * 100)}%`;
    }
    
    // Actualizar la escala de la caja de selección celeste global si hay selección activa
    if (window.selectedItem && typeof window.updateSelectionBox === 'function') {
      window.updateSelectionBox(window.selectedItem);
    }
    
    // Actualizar la escala visual de los nodos y manejadores en caliente (Garantía de 5px visuales)
    if (typeof window.updateNodeHandlesScale === 'function') {
      window.updateNodeHandlesScale();
    }
    
    paper.view.update();
  }, { capture: true, passive: false });
}

// Auxiliares locales para zoom por teclado
function zoomCanvas(factor) {
  if (!window.paper || !paper.view) return;
  const oldZoom = paper.view.zoom;
  let newZoom = oldZoom * factor;
  newZoom = Math.max(0.15, Math.min(100.0, newZoom));
  paper.view.zoom = newZoom;
  
  const readout = document.getElementById(\"pro-zoom-text\");
  if (readout) {
    readout.textContent = `${Math.round(newZoom * 100)}%`;
  }
  if (window.selectedItem && typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(window.selectedItem);
  }
  if (typeof window.updateNodeHandlesScale === 'function') {
    window.updateNodeHandlesScale();
  }
  paper.view.update();
}

function resetCanvasView() {
  if (!window.paper || !paper.view) return;
  paper.view.zoom = 1.0;
  const readout = document.getElementById(\"pro-zoom-text\");
  if (readout) {
    readout.textContent = \"100%\";
  }
  if (window.currentMockup) {
    paper.view.center = window.currentMockup.bounds.center;
  } else {
    paper.view.center = new paper.Point(0, 0);
  }
  if (window.selectedItem && typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(window.selectedItem);
  }
  if (typeof window.updateNodeHandlesScale === 'function') {
    window.updateNodeHandlesScale();
  }
  paper.view.update();
}


// --- 2. SISTEMA DE ATAJOS DE TECLADO UNIVERSALES ---
export function initGlobalKeyboardShortcuts() {
  // Escuchar en fase de captura para desactivar de raíz los shortcuts antiguos de editor.js
  document.addEventListener('keydown', (e) => {
    // Si el usuario está escribiendo en un input, textarea o en el editor de texto, no disparar atajos
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.id === 'ekko-text-editor')) {
      return;
    }

    const isCtrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    // A. Interceptar combinaciones de zoom obsoletas del teclado
    if (isCtrl && (key === '+' || key === '=' || key === '-' || key === '0')) {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (key === '+' || key === '=') zoomCanvas(1.15);
      if (key === '-') zoomCanvas(1 / 1.15);
      if (key === '0') resetCanvasView();
      return;
    }

    // B. Si estamos en Modo Edición de Nodos
    if (window.nodeEditMode) {
      if (key === 'delete' || key === 'backspace') {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (typeof window.deleteSelectedNodes === 'function') {
          window.deleteSelectedNodes();
        }
      }
      if (key === 'escape') {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (typeof window.exitNodeEditMode === 'function') {
          window.exitNodeEditMode();
        }
      }
      return; // No procesar atajos globales si editamos nodos
    }

    // C. Atajos de Edición Simples y Universales (Estilo Canva/Word/LightBurn)
    
    // 1. COPIAR (Ctrl + C)
    if (isCtrl && key === 'c') {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (typeof window.copySelected === 'function') {
        window.copySelected();
      } else if (window.selectedItem) {
        window.clipboardItem = window.selectedItem.clone({ insert: false });
        console.log(\"Elemento copiado al portapapeles de EKKO\");
      }
    }

    // 2. PEGAR (Ctrl + V)
    if (isCtrl && key === 'v') {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (typeof window.pasteSelected === 'function') {
        window.pasteSelected();
      } else if (window.clipboardItem) {
        if (typeof window.saveHistory === 'function') window.saveHistory();
        const clone = window.clipboardItem.clone();
        clone.position = clone.position.add(new paper.Point(15, 15)); // Desfase para que el cliente note la copia
        clone.data = { ...(clone.data || {}), locked: false };
        paper.project.activeLayer.addChild(clone);
        window.selectItem(clone);
        paper.view.update();
      }
    }

    // 3. DESHACER (Ctrl + Z)
    if (isCtrl && key === 'z' && !e.shiftKey) {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (typeof window.undo === 'function') {
        window.undo();
      } else if (typeof window.undoStack !== 'undefined' && window.undoStack.length > 0) {
        if (typeof window.saveHistory === 'function') {
          window.redoStack.push(paper.project.exportJSON({ asString: true }));
        }
        const state = window.undoStack.pop();
        paper.project.clear();
        paper.project.importJSON(state);
        window.deselectItem();
        paper.view.update();
      }
    }

    // 4. REHACER (Ctrl + Y o Ctrl + Shift + Z)
    if ((isCtrl && key === 'y') || (isCtrl && e.shiftKey && key === 'z')) {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (typeof window.redo === 'function') {
        window.redo();
      } else if (typeof window.redoStack !== 'undefined' && window.redoStack.length > 0) {
        if (typeof window.saveHistory === 'function') {
          window.undoStack.push(paper.project.exportJSON({ asString: true }));
        }
        const state = window.redoStack.pop();
        paper.project.clear();
        paper.project.importJSON(state);
        window.deselectItem();
        paper.view.update();
      }
    }

    // 5. SELECCIONAR TODO (Ctrl + A)
    if (isCtrl && key === 'a') {
      e.stopImmediatePropagation();
      e.preventDefault();
      const itemsToSelect = [];
      paper.project.activeLayer.children.forEach(item => {
        if (item.data && (item.data.mockup || item.data.isMask || item.data.isSelectionBox || item.data.isHandle || item.data.isSmartGuide)) {
          return;
        }
        itemsToSelect.push(item);
      });
      if (itemsToSelect.length > 0) {
        window.deselectItem();
        window.selectedItems = [...itemsToSelect];
        window.selectedItem = itemsToSelect[itemsToSelect.length - 1];
        itemsToSelect.forEach(it => it.selected = true);
        window.updateSelectionBox(window.selectedItem);
      }
    }

    // 6. AGRUPAR (Ctrl + G)
    if (isCtrl && key === 'g') {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (typeof window.groupSelectedItems === 'function') {
        window.groupSelectedItems();
      }
    }

    // 7. DESAGRUPAR (Ctrl + U)
    if (isCtrl && key === 'u') {
      e.stopImmediatePropagation();
      e.preventDefault();
      if (typeof window.ungroupSelectedItem === 'function') {
        window.ungroupSelectedItem();
      }
    }

    // 8. ELIMINAR ELEMENTOS SELECCIONADOS (Delete / Backspace)
    if (key === 'delete' || key === 'backspace') {
      e.stopImmediatePropagation();
      e.preventDefault();
      const selected = (window.selectedItems && window.selectedItems.length > 0)
        ? [...window.selectedItems]
        : (window.selectedItem ? [window.selectedItem] : []);
      if (selected.length > 0) {
        if (typeof window.saveHistory === 'function') window.saveHistory();
        selected.forEach(it => {
          if (it && !it.data?.locked) {
            it.remove();
          }
        });
        window.deselectItem();
        paper.view.update();
      }
    }
  }, { capture: true });
}

// --- 3. ACOPLADOR AUTOMÁTICO SÍNCRONO (POLLING ENGINE) ---
if (typeof window !== 'undefined') {
  const pollPaperAndLienzo = setInterval(() => {
    const canvasEl = document.getElementById(\"editorCanvas\");
    if (window.paper && paper.view && canvasEl) {
      clearInterval(pollPaperAndLienzo);
      initZoomControls(canvasEl);
      initGlobalKeyboardShortcuts();
      console.log(\"⚡ [EKKO Zoom & Shortcuts PRO] Acoplado dinámicamente y suplantando eventos obsoletos de editor.js.\");
    }
  }, 100);
}

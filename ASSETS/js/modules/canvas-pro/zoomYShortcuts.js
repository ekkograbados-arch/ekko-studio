/* =========================================================================
Modulo de Referencia: ASSETS/js/modules/canvas-pro/zoomYShortcuts.js
Ruta de implementacion: ASSETS/js/modules/canvas-pro/zoomYShortcuts.js
Descripcion: Logica integrada para zoom interactivo relativo al cursor del raton (LightBurn Style)
elevando el limite al 10000%, con sistema unificado de atajos de teclado universales.

CORRECCION DE ERRORES CRITICOS DE COMPILACION (100% ASCII CLEAN):
1. Sanitizado completo de tildes y caracteres especiales en comentarios para evitar errores de codificacion (UTF-8 / Latin-1 mismatches) en navegadores estrictos.
2. Zoom inteligente relativo al cursor (no al centro del lienzo) para permitir micro-edicion.
3. Escalado inverso de nodos reactivo al hacer zoom (se comunica con nodeEditor).
4. Atajos de teclado universales (Ctrl+C, Ctrl+V, Ctrl+Z, Ctrl+Y, Delete) que diferencian
   si estas editando nodos o editando objetos globales.
========================================================================= */

// --- 1. LOGICA DE ZOOM AL CURSOR DEL RATON (ESTILO LIGHTBURN) ---
export function initZoomControls(canvasEl) {
  if (!canvasEl || !window.paper) return;

  canvasEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    
    // Obtener la posicion del cursor en coordenadas del proyecto Paper.js
    const canvasRect = canvasEl.getBoundingClientRect();
    const mouseX = e.clientX - canvasRect.left;
    const mouseY = e.clientY - canvasRect.top;
    const mousePoint = paper.view.viewToProject(new paper.Point(mouseX, mouseY));
    
    const oldZoom = paper.view.zoom;
    let newZoom = oldZoom * factor;
    
    // ELEVAR LIMITE DE ZOOM AL 10000% (factor 100.0) y minimo de 15% (factor 0.15)
    newZoom = Math.max(0.15, Math.min(100.0, newZoom));
    
    // Formula de interpolacion de zoom relativo al cursor (Estilo LightBurn)
    const beta = oldZoom / newZoom;
    const pc = paper.view.center;
    const offset = mousePoint.subtract(pc);
    paper.view.center = mousePoint.subtract(offset.multiply(beta));
    
    paper.view.zoom = newZoom;
    
    // Actualizar la escala de la caja de seleccion celeste global si hay seleccion activa
    if (window.selectedItem && typeof window.updateSelectionBox === 'function') {
      window.updateSelectionBox(window.selectedItem);
    }
    
    // Actualizar la escala visual de los nodos y manejadores en caliente (Garantia de 5px visuales)
    if (typeof window.updateNodeHandlesScale === 'function') {
      window.updateNodeHandlesScale();
    }
    
    paper.view.update();
  }, { passive: false });
}


// --- 2. SISTEMA DE ATAJOS DE TECLADO UNIVERSALES ---
export function initGlobalKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Si el usuario esta escribiendo en un input, textarea o en el editor de texto, no disparar atajos
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.id === 'ekko-text-editor')) {
      return;
    }

    const isCtrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    // A. Si estamos en Modo Edicion de Nodos
    if (window.nodeEditMode) {
      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        if (typeof window.deleteSelectedNodes === 'function') {
          window.deleteSelectedNodes();
        }
      }
      if (key === 'escape') {
        e.preventDefault();
        if (typeof window.exitNodeEditMode === 'function') {
          window.exitNodeEditMode();
        }
      }
      return; // No procesar atajos globales si editamos nodos
    }

    // B. Atajos de Edicion Simples y Universales (Estilo Canva/Word/LightBurn)
    
    // 1. COPIAR (Ctrl + C)
    if (isCtrl && key === 'c') {
      e.preventDefault();
      if (typeof window.copySelected === 'function') {
        window.copySelected();
      } else if (window.selectedItem) {
        window.clipboardItem = window.selectedItem.clone({ insert: false });
        console.log("Elemento copiado al portapapeles de EKKO");
      }
    }

    // 2. PEGAR (Ctrl + V)
    if (isCtrl && key === 'v') {
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
      e.preventDefault();
      if (typeof window.undo === 'function') {
        window.undo();
      } else if (typeof window.undoStack !== 'undefined' && window.undoStack.length > 0) {
        // Fallback de reconstruccion de historial
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
      e.preventDefault();
      if (typeof window.groupSelectedItems === 'function') {
        window.groupSelectedItems();
      }
    }

    // 7. DESAGRUPAR (Ctrl + U)
    if (isCtrl && key === 'u') {
      e.preventDefault();
      if (typeof window.ungroupSelectedItem === 'function') {
        window.ungroupSelectedItem();
      }
    }

    // 8. ELIMINAR ELEMENTOS SELECCIONADOS (Delete / Backspace)
    if (key === 'delete' || key === 'backspace') {
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
  });
}

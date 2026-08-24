/* =========================================================================
Modulo de Referencia: ASSETS/js/modules/canvas-pro/zoomYShortcuts.js
Ruta de implementacion: ASSETS/js/modules/canvas-pro/zoomYShortcuts.js
Descripcion: Logica integrada para zoom interactivo relativo al cursor del raton (LightBurn Style)
elevando el limite al 10000%, con sistema unificado de atajos de teclado universales.
========================================================================= */

export function initZoomControls(canvasEl) {
  if (!canvasEl || !window.paper) return;

  canvasEl.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const canvasRect = canvasEl.getBoundingClientRect();
    const mouseX = e.clientX - canvasRect.left;
    const mouseY = e.clientY - canvasRect.top;
    const mousePoint = paper.view.viewToProject(new paper.Point(mouseX, mouseY));
    const oldZoom = paper.view.zoom;
    let newZoom = oldZoom * factor;
    newZoom = Math.max(0.15, Math.min(100.0, newZoom));
    const beta = oldZoom / newZoom;
    const pc = paper.view.center;
    const offset = mousePoint.subtract(pc);
    paper.view.center = mousePoint.subtract(offset.multiply(beta));
    paper.view.zoom = newZoom;
    if (window.selectedItem && typeof window.updateSelectionBox === 'function') {
      window.updateSelectionBox(window.selectedItem);
    }
    if (typeof window.updateNodeHandlesScale === 'function') {
      window.updateNodeHandlesScale();
    }
    paper.view.update();
  }, { passive: false });
}

export function initGlobalKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.id === 'ekko-text-editor')) {
      return;
    }
    const isCtrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

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
      return;
    }

    if (isCtrl && key === 'c') {
      e.preventDefault();
      if (typeof window.copySelected === 'function') {
        window.copySelected();
      } else if (window.selectedItem) {
        window.clipboardItem = window.selectedItem.clone({ insert: false });
        console.log("Elemento copiado al portapapeles de EKKO");
      }
    }

    if (isCtrl && key === 'v') {
      e.preventDefault();
      if (typeof window.pasteSelected === 'function') {
        window.pasteSelected();
      } else if (window.clipboardItem) {
        if (typeof window.saveHistory === 'function') window.saveHistory();
        const clone = window.clipboardItem.clone();
        clone.position = clone.position.add(new paper.Point(15, 15));
        clone.data = { ...(clone.data || {}), locked: false };
        paper.project.activeLayer.addChild(clone);
        window.selectItem(clone);
        paper.view.update();
      }
    }

    if (isCtrl && key === 'z' && !e.shiftKey) {
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

    if (isCtrl && key === 'g') {
      e.preventDefault();
      if (typeof window.groupSelectedItems === 'function') {
        window.groupSelectedItems();
      }
    }

    if (isCtrl && key === 'u') {
      e.preventDefault();
      if (typeof window.ungroupSelectedItem === 'function') {
        window.ungroupSelectedItem();
      }
    }

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

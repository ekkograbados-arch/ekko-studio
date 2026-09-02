/* =========================================================================
Modulo: ASSETS/js/modules/canvas-pro/zoomYShortcuts.js (v28.0 PRO - Unified, CSG Reactive & LightBurn Stacking)
Ruta de implementacion: ASSETS/js/modules/canvas-pro/zoomYShortcuts.js
Descripción: 
    Logica integrada para zoom interactivo relativo al cursor del raton
    (LightBurn Style) elevando el limite al 10000%, con sistema unificado
    de atajos de teclado universales.

    CORRECCIONES ARQUITECTÓNICAS V28.0:
    1. BLOQUEO DE ATAJO NATIVO DE CHROME Ctrl+D:
       Intercepta de manera absoluta la combinación Ctrl+D (Duplicar) aplicando
       e.preventDefault() y e.stopPropagation() de inmediato, impidiendo que el
       navegador intente abrir la modal nativa de añadir favoritos.
    2. ACOPLAMIENTO DE DUPLICACIÓN INTERACTIVA:
       Enruta Ctrl+D directamente hacia 'window.duplicateSelectedItem()' para
       sincronizar el portapapeles del lienzo de Paper.js.

========================================================================= */

import { recalculateDynamicSubtractions } from "./geometricUngroup.js";

export function initZoomControls(canvasEl) {
    if (!canvasEl || !window.paper) return;

    // Zoom interactivo relativo al cursor (LightBurn Style)
    canvasEl.addEventListener("wheel", (e) => {
        if (!paper.view) return;
        e.preventDefault();
        const oldZoom = paper.view.zoom;
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        let newZoom = oldZoom * zoomFactor;

        // Limites profesionales: 10% hasta 10000%
        newZoom = Math.max(0.1, Math.min(100.0, newZoom));
        const mousePosition = new paper.Point(e.offsetX, e.offsetY);
        const viewPosition = paper.view.viewToProject(mousePosition);

        paper.view.zoom = newZoom;
        const newViewPosition = paper.view.viewToProject(mousePosition);
        paper.view.center = paper.view.center.add(viewPosition.subtract(newViewPosition));

        // Actualizar indicador de zoom en barra superior
        const zoomReadout = document.getElementById("pro-zoom-text");
        if (zoomReadout) {
            zoomReadout.textContent = `${Math.round(newZoom * 100)}%`;
        }

        // Sincronizar caja de transformacion
        if (typeof window.updateSelectionBox === "function" && window.selectedItem) {
            window.updateSelectionBox(window.selectedItem);
        }

        // Sincronizar escala de tiradores de nodos
        if (typeof window.updateNodeHandlesScale === "function") {
            window.updateNodeHandlesScale();
        }

        paper.view.update();
    }, { passive: false });
}

export function initGlobalKeyboardShortcuts() {
    if (window._ekkoKeyboardShortcutsInstalled) return;
    window._ekkoKeyboardShortcutsInstalled = true;

    window.addEventListener("keydown", (e) => {
        // Ignorar atajos si el usuario esta escribiendo en un input, textarea o editor de texto
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : "";
        const isInput = activeTag === "input" || activeTag === "textarea" || activeTag === "select";
        const isTextEditor = document.activeElement && (
            document.activeElement.id === "ekko-text-editor" ||
            document.activeElement.classList.contains("ekko-inline-editor")
        );

        if (isInput || isTextEditor) return;

        const isCtrl = e.ctrlKey || e.metaKey;
        const key = e.key.toLowerCase();

        // 1. ESCAPE: Salir del modo edicion de nodos o deseleccionar
        if (key === "escape") {
            if (window.nodeEditMode && typeof window.exitNodeEditMode === "function") {
                e.preventDefault();
                window.exitNodeEditMode();
                return;
            }
            if (typeof window.deselectItem === "function") {
                window.deselectItem();
                return;
            }
        }

        // 2. ENTER: Confirmar y salir de edicion de nodos
        if (key === "enter" && window.nodeEditMode) {
            e.preventDefault();
            if (typeof window.exitNodeEditMode === "function") {
                window.exitNodeEditMode();
            }
            return;
        }

        // 3. COPIAR (Ctrl+C)
        if (isCtrl && key === "c") {
            e.preventDefault();
            if (typeof window.copySelected === "function") {
                window.copySelected();
            } else if (window.selectedItem) {
                window.clipboardItem = window.selectedItem.clone({ insert: false });
                if (typeof window.EKKO_DEBUG !== "undefined" && window.EKKO_DEBUG) {
                    console.log("[EKKO SHORTCUTS] Elemento copiado al portapapeles");
                }
            }
            return;
        }

        // 4. PEGAR (Ctrl+V)
        if (isCtrl && key === "v") {
            e.preventDefault();
            if (typeof window.pasteSelected === "function") {
                window.pasteSelected();
            } else if (window.clipboardItem) {
                if (typeof window.saveHistory === "function") window.saveHistory();
                const clone = window.clipboardItem.clone();
                clone.position = clone.position.add(new paper.Point(15, 15));
                clone.data = { ...(clone.data || {}), locked: false };
                paper.project.activeLayer.addChild(clone);

                if (window.currentMockup) {
                    clone.insertBelow(window.currentMockup);
                }

                if (typeof window.selectItem === "function") {
                    window.selectItem(clone);
                }

                if (typeof recalculateDynamicSubtractions === "function") {
                    recalculateDynamicSubtractions();
                } else if (typeof window.recalculateDynamicSubtractions === "function") {
                    window.recalculateDynamicSubtractions();
                }
                paper.view.update();
            }
            return;
        }

        // 5. DESHACER (Ctrl+Z)
        if (isCtrl && key === "z" && !e.shiftKey) {
            e.preventDefault();
            if (typeof window.undo === "function") {
                window.undo();
            } else if (typeof window.undoStack !== "undefined" && window.undoStack.length > 0) {
                if (typeof window.saveHistory === "function") {
                    window.redoStack.push(paper.project.exportJSON({ asString: true }));
                }
                const state = window.undoStack.pop();
                paper.project.clear();
                paper.project.importJSON(state);

                if (typeof window.deselectItem === "function") window.deselectItem();

                if (typeof recalculateDynamicSubtractions === "function") {
                    recalculateDynamicSubtractions();
                } else if (typeof window.recalculateDynamicSubtractions === "function") {
                    window.recalculateDynamicSubtractions();
                }
                paper.view.update();
            }
            return;
        }

        // 6. REHACER (Ctrl+Y o Ctrl+Shift+Z)
        if ((isCtrl && key === "y") || (isCtrl && e.shiftKey && key === "z")) {
            e.preventDefault();
            if (typeof window.redo === "function") {
                window.redo();
            } else if (typeof window.redoStack !== "undefined" && window.redoStack.length > 0) {
                if (typeof window.saveHistory === "function") {
                    window.undoStack.push(paper.project.exportJSON({ asString: true }));
                }
                const state = window.redoStack.pop();
                paper.project.clear();
                paper.project.importJSON(state);

                if (typeof window.deselectItem === "function") window.deselectItem();

                if (typeof recalculateDynamicSubtractions === "function") {
                    recalculateDynamicSubtractions();
                } else if (typeof window.recalculateDynamicSubtractions === "function") {
                    window.recalculateDynamicSubtractions();
                }
                paper.view.update();
            }
            return;
        }

        // 7. SELECCIONAR TODO (Ctrl+A)
        if (isCtrl && key === "a") {
            e.preventDefault();
            const itemsToSelect = [];
            const designLayer = paper.project.layers.find(l => l.name === "designLayer") || paper.project.activeLayer;
            if (designLayer && designLayer.children) {
                designLayer.children.forEach(item => {
                    if (item && !item.data?.mockup && !item.data?.isMask && !item.data?.locked) {
                        itemsToSelect.push(item);
                    }
                });
            }
            if (itemsToSelect.length > 0) {
                window.selectedItems = itemsToSelect;
                window.selectedItem = itemsToSelect[itemsToSelect.length - 1];
                itemsToSelect.forEach(it => { it.selected = true; });

                if (typeof window.updateSelectionBox === "function") {
                    window.updateSelectionBox(window.selectedItem);
                }
                if (typeof window.updateContextualMenu === "function") {
                    window.updateContextualMenu(window.selectedItem);
                }
            }
            paper.view.update();
            return;
        }

        // 8. DUPLICAR OBJETO COMPLETO CON CONTROL+D (BLINDAJE DE CHROME)
        if (isCtrl && key === "d") {
            e.preventDefault();
            e.stopPropagation(); // Frenar propagación para que Chrome no actúe
            if (typeof window.duplicateSelectedItem === "function") {
                window.duplicateSelectedItem();
            }
            return;
        }

        // 9. AGRUPAR (Ctrl+G)
        if (isCtrl && key === "g") {
            e.preventDefault();
            if (typeof window.groupSelectedItems === "function") {
                window.groupSelectedItems();
            }
            return;
        }

        // 10. DESAGRUPAR (Ctrl+U)
        if (isCtrl && key === "u") {
            e.preventDefault();
            if (typeof window.ungroupSelectedItem === "function") {
                window.ungroupSelectedItem();
            }
            return;
        }

        // 11. ELIMINAR ELEMENTOS O NODOS (Delete o Backspace)
        if (key === "delete" || key === "backspace") {
            e.preventDefault();
            if (window.nodeEditMode) {
                if (typeof window.deleteSelectedNodes === "function") {
                    window.deleteSelectedNodes();
                }
                return;
            }
            const selected = (window.selectedItems && window.selectedItems.length > 0)
                ? [...window.selectedItems]
                : (window.selectedItem ? [window.selectedItem] : []);
            if (selected.length > 0) {
                if (typeof window.saveHistory === "function") window.saveHistory();
                selected.forEach(it => {
                    if (it && !it.data?.locked) {
                        it.remove();
                    }
                });
                if (typeof window.deselectItem === "function") {
                    window.deselectItem();
                }
                if (typeof recalculateDynamicSubtractions === "function") {
                    recalculateDynamicSubtractions();
                } else if (typeof window.recalculateDynamicSubtractions === "function") {
                    window.recalculateDynamicSubtractions();
                }
                paper.view.update();
            }
            return;
        }

        // 12. ORDEN Z / APILAMIENTO ESTILO LIGHTBURN (PgUp / PgDown / Ctrl+PgUp / Ctrl+PgDown)
        if (key === "pageup") {
            e.preventDefault();
            if (isCtrl) {
                if (typeof window.bringFront === "function") window.bringFront();
            } else {
                if (typeof window.bringForward === "function") window.bringForward();
            }
            return;
        }

        if (key === "pagedown") {
            e.preventDefault();
            if (isCtrl) {
                if (typeof window.sendBack === "function") window.sendBack();
            } else {
                if (typeof window.sendBackward === "function") window.sendBackward();
            }
            return;
        }
    }, false);
}

if (typeof window !== "undefined") {
    window.initZoomControls = initZoomControls;
    window.initGlobalKeyboardShortcuts = initGlobalKeyboardShortcuts;
}

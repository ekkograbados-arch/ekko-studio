/* =========================================================================
Módulo: ASSETS/js/modules/selection.js (WYSIWYG Canva-Style Grouping - v6)
Ruta de reemplazo: ASSETS/js/modules/selection.js
Descripción: Gestión de selección múltiple, arrastre en bloque y redimensionamiento
grupal unificado estilo Canva/Figma para EKKO Studio.
Elimina el delay inicial activando la herramienta de forma reactiva de baja latencia.
========================================================================= */

window.selectedItem = null;
window.selectedItems = [];
window.dragOffset = null;
window.selectionBoxGroup = null;

// Sizing/Resize state variables
window.resizeActive = false;
window.resizeHandleType = null;
window.resizeTarget = null;
window.resizeTargets = [];
window.resizeInitialBounds = null;
window.resizeInitialPoint = null;
window.resizeLastScaleX = 1.0;
window.resizeLastScaleY = 1.0;
window.resizeAnchor = null;

// --- NODE EDITING STATE (LIGHTBURN STYLE) ---
window.nodeEditMode = false;
window.nodeEditTarget = null;
window.nodeHandlesGroup = null;
window.selectedNodeIndex = -1;
window.draggingNode = false;
window.dragNodeIndex = -1;

/* ========================= SELECCIÓN DE OBJETO ========================= */
window.getSelectableItem = function(item){
    if(!item) return null;
    if (item.data && (item.data.isHandle || item.data.isSelectionBox || item.data.isNodeHandle)) return null;
    if (item.parent && item.parent.data && (item.parent.data.isSelectionBox || item.parent.data.isNodeEditOverlay)) return null;
    if (item.data && item.data.mockup) return null;

    let current = item;
    while (current) {
        if (current.data) {
            if (current.data.mockup) return null;
            if (current.data.clipGroup) {
                return current;
            }
        }
        if (current.parent instanceof paper.Layer || current.parent === paper.project.activeLayer) {
            return current;
        }
        if (current.parent) {
            current = current.parent;
        } else {
            break;
        }
    }
    return current;
};

/* ========================= UPDATE SELECTION BOX OVERLAY ========================= */
window.updateSelectionBox = function(item) {
    if (window.selectionBoxGroup) {
        window.selectionBoxGroup.remove();
        window.selectionBoxGroup = null;
    }
    if (window.nodeEditMode) {
        return;
    }
    const selected = (window.selectedItems && window.selectedItems.length > 0)
        ? window.selectedItems
        : (item ? [item] : []);
    if (selected.length === 0) return;

    let bounds = null;
    if (selected.length === 1) {
        const singleItem = selected[0];
        const displayItem = (singleItem.data && singleItem.data.clipGroup)
            ? singleItem.children.find(function(c) { return !c.clipMask; })
            : singleItem;
        if (!displayItem) return;
        bounds = displayItem.bounds;
    } else {
        selected.forEach(function(it) {
            const displayItem = (it.data && it.data.clipGroup)
                ? it.children.find(function(c) { return !c.clipMask; })
                : it;
            if (!displayItem) return;
            if (!bounds) {
                bounds = displayItem.bounds.clone();
            } else {
                bounds = bounds.unite(displayItem.bounds);
            }
        });
    }
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

    window.selectionBoxGroup = new paper.Group();
    window.selectionBoxGroup.data = { isSelectionBox: true };

    // 1. Dibujar el rectángulo azul de contorno dashed
    const border = new paper.Path.Rectangle(bounds);
    border.strokeColor = '#007bff';
    border.strokeWidth = 1.5 / paper.view.zoom;
    border.dashArray = [4 / paper.view.zoom, 4 / paper.view.zoom];
    window.selectionBoxGroup.addChild(border);

    // 2. Dibujar los 8 nodos de control (cuadrados blancos con borde azul)
    const handleSize = 8 / paper.view.zoom;
    const handlesInfo = [
        { point: bounds.topLeft, type: 'tl' },
        { point: bounds.topCenter, type: 't' },
        { point: bounds.topRight, type: 'tr' },
        { point: bounds.rightCenter, type: 'r' },
        { point: bounds.bottomRight, type: 'br' },
        { point: bounds.bottomCenter, type: 'b' },
        { point: bounds.bottomLeft, type: 'bl' },
        { point: bounds.leftCenter, type: 'l' }
    ];

    handlesInfo.forEach(function(info) {
        const rect = new paper.Path.Rectangle({
            center: info.point,
            size: [handleSize, handleSize],
            strokeColor: '#007bff',
            fillColor: '#ffffff',
            strokeWidth: 1.5 / paper.view.zoom
        });
        rect.data = { isHandle: true, handleType: info.type };
        window.selectionBoxGroup.addChild(rect);
    });

    window.selectionBoxGroup.bringToFront();

    // 🚀 REPOSICIONAMIENTO EN TIEMPO REAL: Sincronizar elementos de interfaz flotantes HTML
    if (typeof window.applyPositionCorrections === "function") {
        window.applyPositionCorrections();
    }
};

/* ========================= NODE EDITING OVERLAY SYSTEM ========================= */
window.drawNodeEditHandles = function(path) {
    if (window.nodeHandlesGroup) {
        window.nodeHandlesGroup.remove();
        window.nodeHandlesGroup = null;
    }
    if (!path || !path.segments) return;
    window.nodeHandlesGroup = new paper.Group();
    window.nodeHandlesGroup.data = { isNodeEditOverlay: true };
    const handleSize = 5 / paper.view.zoom;
    path.segments.forEach(function(segment, index) {
        const isSelected = (index === window.selectedNodeIndex);
        const handleCircle = new paper.Path.Circle({
            center: segment.point,
            radius: handleSize,
            strokeColor: '#dc3545',
            fillColor: isSelected ? '#dc3545' : '#ffffff',
            strokeWidth: 1.5 / paper.view.zoom
        });
        handleCircle.data = { isNodeHandle: true, segmentIndex: index };
        window.nodeHandlesGroup.addChild(handleCircle);
    });
    window.nodeHandlesGroup.bringToFront();
};

window.enterNodeEditMode = function(path) {
    if (!path || !path.segments) return;
    window.exitNodeEditMode();
    if (window.selectedItem) {
        window.selectedItem.selected = false;
    }
    window.nodeEditMode = true;
    window.nodeEditTarget = path;
    window.selectedNodeIndex = -1;
    window.updateSelectionBox(null);
    window.drawNodeEditHandles(path);
    const nodeCtrl = document.getElementById('ctxNodeEditControls');
    if (nodeCtrl) nodeCtrl.classList.remove('hidden');
    const vecCtrl = document.getElementById('ctxVectorControls');
    if (vecCtrl) vecCtrl.classList.add('hidden');
    const imgCtrl = document.getElementById('ctxImageControls');
    if (imgCtrl) imgCtrl.classList.add('hidden');
    const txtCtrl = document.getElementById('ctxTextControls');
    if (txtCtrl) txtCtrl.classList.add('hidden');
    paper.view.update();
};

window.exitNodeEditMode = function() {
    if (window.nodeHandlesGroup) {
        window.nodeHandlesGroup.remove();
        window.nodeHandlesGroup = null;
    }
    window.nodeEditMode = false;
    const path = window.nodeEditTarget;
    window.nodeEditTarget = null;
    window.selectedNodeIndex = -1;
    const nodeEl = document.getElementById('ctxNodeEditControls');
    if (nodeEl) nodeEl.classList.add('hidden');
    if (path) {
        window.selectItem(path);
    }
    paper.view.update();
};

/* ========================= SELECT ========================= */
window.selectItem = function(item){
    if (window.nodeEditMode) {
        window.exitNodeEditMode();
    }
    if (window.selectedItems) {
        window.selectedItems.forEach(function(it) {
            it.selected = false;
        });
    }
    window.selectedItem = item;
    window.selectedItems = item ? [item] : [];
    if (item) {
        item.selected = true;
    }
    if(!item){
        window.updateSelectionBox(null);
        paper.view.update();
        return;
    }
    if(item.data && item.data.mockup){
        item.selected = false;
        window.selectedItems = [];
        window.selectedItem = null;
        window.updateSelectionBox(null);
        paper.view.update();
        return;
    }
    window.updateSelectionBox(item);
    if (typeof window.updateContextualMenu === 'function') {
        window.updateContextualMenu(item);
    }
    paper.view.update();
};

/* ========================= DESELECT ========================= */
window.deselectItem = function(){
    if (window.nodeEditMode) {
        window.exitNodeEditMode();
    }
    if (window.selectedItems) {
        window.selectedItems.forEach(function(it) {
            it.selected = false;
        });
        window.selectedItems = [];
    }
    if(window.selectedItem){
        window.selectedItem.selected = false;
    }
    window.selectedItem = null;
    window.updateSelectionBox(null);
    if (typeof window.hideContextualMenu === 'function') {
        window.hideContextualMenu();
    }
    paper.view.update();
};

/* ========================= FUNCIONES AUXILIARES DE ESCALADO ========================= */
window.getOppositePoint = function(bounds, handleType) {
    switch (handleType) {
        case 'tl': return bounds.bottomRight;
        case 'tr': return bounds.bottomLeft;
        case 'bl': return bounds.topRight;
        case 'br': return bounds.topLeft;
        case 't':  return bounds.bottomCenter;
        case 'b':  return bounds.topCenter;
        case 'l':  return bounds.rightCenter;
        case 'r':  return bounds.leftCenter;
        default:   return bounds.center;
    }
};

window.getHandlePoint = function(bounds, handleType) {
    switch (handleType) {
        case 'tl': return bounds.topLeft;
        case 'tr': return bounds.topRight;
        case 'bl': return bounds.bottomLeft;
        case 'br': return bounds.bottomRight;
        case 't':  return bounds.topCenter;
        case 'b':  return bounds.bottomCenter;
        case 'l':  return bounds.leftCenter;
        case 'r':  return bounds.rightCenter;
        default:   return bounds.center;
    }
};

// --- FUNCIÓN DE INICIALIZACIÓN DE EVENTOS DE MOUSE ---
window.initSelectionTool = function() {
    if (!paper.view) {
        console.warn("initSelectionTool: paper.view no está definido todavía.");
        return;
    }
    const selectTool = new paper.Tool();
    let lastClickTime = 0;

    // ACTIVADOR CANVA-STYLE DE BAJA LATENCIA (Sin Delay):
    // Fuerza la activación inmediata de la herramienta de selección en cuanto el cursor toca el lienzo.
    const canvas = document.getElementById("editorCanvas");
    if (canvas) {
        const activateToolSafely = function() {
            if (paper.tool !== selectTool) {
                selectTool.activate();
            }
        };
        canvas.addEventListener("mousedown", activateToolSafely, true);
        canvas.addEventListener("mouseenter", activateToolSafely, true);
    }

    selectTool.onMouseDown = function(event) {
        // 🚀 CANVA-STYLE CLICK OUTSIDE TO ACCEPT TEXT
        const activeEditor = document.getElementById("ekko-text-editor");
        if (activeEditor) {
            activeEditor.blur(); // synchronous blur which runs finish(true)
            paper.view.update();
        }
        // Manejar doble clic para edición de texto inline
        const currentTime = Date.now();
        if (currentTime - lastClickTime < 300) {
            lastClickTime = 0; // Evitar disparar múltiples doble clics
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) : window.selectedItem;
                if (target instanceof paper.PointText) {
                    if (typeof window.startTextEditing === 'function') {
                        window.startTextEditing(target);
                    }
                    return;
                }
            }
        }
        lastClickTime = currentTime;

        // 1. Hit test optimizado y directo contra los handles de la caja de selección celeste unificada (estilo Canva)
        let hitResult = null;
        if (window.selectionBoxGroup) {
            hitResult = window.selectionBoxGroup.hitTest(event.point, {
                fill: true,
                stroke: true,
                segments: true,
                tolerance: 12 / paper.view.zoom, // Aumentado a 12px para una captura ultra fluida del cursor/dedo
                match: function(hit) {
                    return hit.item.data && hit.item.data.isHandle;
                }
            });
        }

        if (hitResult) {
            // El usuario seleccionó un nodo de control para redimensionar el conjunto unificado
            window.resizeActive = true;
            window.resizeHandleType = hitResult.item.data.handleType;
            window.resizeTargets = [...(window.selectedItems || [])];
            
            // Calcular los límites iniciales unificados de todos los objetos seleccionados para escalar proporcionalmente
            let unifiedBounds = null;
            window.resizeTargets.forEach(function(it) {
                const displayItem = (it.data && it.data.clipGroup)
                    ? it.children.find(function(c) { return !c.clipMask; })
                    : it;
                if (!displayItem) return;
                if (!unifiedBounds) {
                    unifiedBounds = displayItem.bounds.clone();
                } else {
                    unifiedBounds = unifiedBounds.unite(displayItem.bounds);
                }
            });
            
            window.resizeInitialBounds = unifiedBounds;
            window.resizeInitialPoint = event.point.clone();
            window.resizeAnchor = window.getOppositePoint(window.resizeInitialBounds, window.resizeHandleType);
            window.resizeLastScaleX = 1.0;
            window.resizeLastScaleY = 1.0;
            return;
        }

        // 2. Hit test para elementos seleccionables normales
        const generalHit = paper.project.hitTest(event.point, {
            fill: true,
            stroke: true,
            segments: true,
            bounds: true, // 🚀 CORRECCIÓN CLAVE: Permite seleccionar imágenes, textos y códigos QR cómodamente
            tolerance: 8 / paper.view.zoom,
            match: function(hit) {
                // No interactuar con la caja de selección en sí, ni con mockups protegidos
                if (hit.item.data && (hit.item.data.isSelectionBox || hit.item.data.isHandle)) return false;
                if (hit.item.data && hit.item.data.mockup) return false;
                return true;
            }
        });

        if (generalHit) {
            const selectableItem = window.getSelectableItem(generalHit.item);
            if (selectableItem) {
                const isShiftPressed = event.modifiers && event.modifiers.shift;
                if (!window.selectedItems) {
                    window.selectedItems = [];
                }
                if (isShiftPressed) {
                    const index = window.selectedItems.indexOf(selectableItem);
                    if (index > -1) {
                        selectableItem.selected = false;
                        window.selectedItems.splice(index, 1);
                    } else {
                        selectableItem.selected = true;
                        window.selectedItems.push(selectableItem);
                    }
                    window.selectedItem = window.selectedItems.length > 0 ? window.selectedItems[window.selectedItems.length - 1] : null;
                } else {
                    if (window.selectedItems.includes(selectableItem)) {
                        // Continuar arrastre de la multi-selección actual sin resetear
                    } else {
                        window.selectedItems.forEach(function(it) {
                            it.selected = false;
                        });
                        selectableItem.selected = true;
                        window.selectedItem = selectableItem;
                        window.selectedItems = [selectableItem];
                    }
                }

                window.dragging = true;

                // Preparar arrastre múltiple sincronizado
                window.dragTargets = [];
                window.selectedItems.forEach(function(item) {
                    const dragTarget = (item.data && item.data.clipGroup)
                        ? item.children.find(function(c) { return !c.clipMask; })
                        : item;
                    if (dragTarget) {
                        window.dragTargets.push({
                            item: item,
                            target: dragTarget,
                            dragOffset: event.point.subtract(dragTarget.position)
                        });
                    }
                });

                window.updateSelectionBox(window.selectedItem);
                if (typeof window.updateContextualMenu === 'function') {
                    window.updateContextualMenu(window.selectedItem);
                }
                paper.view.update();
                return;
            }
        }

        // Si hizo clic en el vacío, deseleccionar
        window.deselectItem();
    };

    selectTool.onMouseDrag = function(event) {
        // Bloqueo preventivo: No interactuar si el objeto seleccionado está bloqueado
        if (window.selectedItem && window.selectedItem.data && window.selectedItem.data.locked) {
            return;
        }
        
        // 🚀 ESCALADO GRUPAL UNIFICADO (Estilo Canva)
        if (window.resizeActive && window.resizeTargets && window.resizeTargets.length > 0) {
            const anchor = window.resizeAnchor;
            const initialHandlePoint = window.getHandlePoint(window.resizeInitialBounds, window.resizeHandleType);
            const currentHandlePoint = event.point;
            let factorX = 1.0;
            let factorY = 1.0;
            const initialXDiff = initialHandlePoint.x - anchor.x;
            const currentXDiff = currentHandlePoint.x - anchor.x;
            if (Math.abs(initialXDiff) > 0.001) factorX = currentXDiff / initialXDiff;
            const initialYDiff = initialHandlePoint.y - anchor.y;
            const currentYDiff = currentHandlePoint.y - anchor.y;
            if (Math.abs(initialYDiff) > 0.001) factorY = currentYDiff / initialYDiff;

            // Si es un redimensionamiento de esquina, mantener aspecto proporcional por defecto
            if (['tl', 'tr', 'bl', 'br'].includes(window.resizeHandleType)) {
                const factor = (Math.abs(factorX) + Math.abs(factorY)) / 2 * (factorX < 0 ? -1 : 1);
                factorX = factor;
                factorY = factor;
            }

            // Aplicar escala incremental relativa
            const scaleFactorX = factorX / window.resizeLastScaleX;
            const scaleFactorY = factorY / window.resizeLastScaleY;

            // Escalamos todos los elementos del grupo unificado respecto al anclaje común
            window.resizeTargets.forEach(function(item) {
                if (item.data && item.data.locked) return;
                const targetToScale = (item.data && item.data.clipGroup)
                    ? item.children.find(function(c) { return !c.clipMask; })
                    : item;
                if (targetToScale) {
                    targetToScale.scale(scaleFactorX, scaleFactorY, anchor);
                }
            });

            window.resizeLastScaleX = factorX;
            window.resizeLastScaleY = factorY;
            window.updateSelectionBox(null);
            paper.view.update();
            return;
        }

        if (window.dragging && window.dragTargets && window.dragTargets.length > 0) {
            // 🚀 ARRASTRE SEGURO MÚLTIPLE SINCRONIZADO DENTRO DEL CONTORNO (MÁSCARA)
            window.dragTargets.forEach(function(dragInfo) {
                if (dragInfo.item.data && dragInfo.item.data.locked) return;
                dragInfo.target.position = event.point.subtract(dragInfo.dragOffset);
            });
            window.updateSelectionBox(window.selectedItem);
            paper.view.update();
            return;
        }
    };

    selectTool.onMouseMove = function(event) {
        const canvas = document.getElementById("editorCanvas");
        if (!canvas) return;

        if (window.resizeActive) {
            return; // Mantener cursor del resize activo
        }

        // 1. Hit-Test ultra rápido sobre los nodos de la caja de selección unificada
        let hitResult = null;
        if (window.selectionBoxGroup) {
            hitResult = window.selectionBoxGroup.hitTest(event.point, {
                fill: true,
                stroke: true,
                segments: true,
                tolerance: 12 / paper.view.zoom,
                match: function(hit) {
                    return hit.item.data && hit.item.data.isHandle;
                }
            });
        }

        if (hitResult) {
            const type = hitResult.item.data.handleType;
            let cursorStyle = 'pointer';
            if (type === 'tl' || type === 'br') cursorStyle = 'nwse-resize';
            else if (type === 'tr' || type === 'bl') cursorStyle = 'nesw-resize';
            else if (type === 't' || type === 'b') cursorStyle = 'ns-resize';
            else if (type === 'l' || type === 'r') cursorStyle = 'ew-resize';
            
            canvas.style.cursor = cursorStyle;
        } else {
            // 2. Si pasa por encima de cualquiera de los objetos seleccionados, mostrar cursor 'move'
            const generalHit = paper.project.hitTest(event.point, {
                fill: true,
                stroke: true,
                segments: true,
                bounds: true,
                tolerance: 8 / paper.view.zoom,
                match: function(hit) {
                    if (hit.item.data && (hit.item.data.isSelectionBox || hit.item.data.isHandle)) return false;
                    if (hit.item.data && hit.item.data.mockup) return false;
                    return true;
                }
            });

            if (generalHit && window.selectedItems && window.selectedItems.length > 0) {
                const hitItem = window.getSelectableItem(generalHit.item);
                if (window.selectedItems.includes(hitItem)) {
                    canvas.style.cursor = 'move';
                    return;
                }
            }
            canvas.style.cursor = 'default';
        }
    };

    selectTool.onMouseUp = function(event) {
        if (window.resizeActive || window.dragging) {
            if (typeof window.saveHistory === 'function') window.saveHistory();
        }
        window.dragging = false;
        window.resizeActive = false;
        const canvas = document.getElementById("editorCanvas");
        if (canvas) canvas.style.cursor = 'default';
        paper.view.update();
    };

    selectTool.activate();
    console.log("🎯 Eventos de selección y redimensionamiento de Paper.js registrados con éxito.");
};

// Autoejecutar de inmediato si ya se inicializó paper.js
if (typeof paper !== "undefined" && paper.view) {
    window.initSelectionTool();
}

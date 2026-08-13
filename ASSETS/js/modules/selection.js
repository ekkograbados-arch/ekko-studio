/**
 * ASSETS/js/modules/selection.js
 * Módulo para la visualización del cuadro de selección con soporte para transformación de tamaño,
 * tirador de rotación estilo Canva/LightBurn y nodos de vectores.
 */

window.selectedItem = null;
window.dragOffset = null;
window.selectionBoxGroup = null;

// Sizing/Resize/Rotation state variables
window.resizeActive = false;
window.resizeHandleType = null;
window.resizeTarget = null;
window.resizeInitialBounds = null;
window.resizeInitialPoint = null;
window.resizeLastScaleX = 1.0;
window.resizeLastScaleY = 1.0;
window.resizeAnchor = null;

window.rotateActive = false;
window.rotateTarget = null;
window.rotateCenter = null;
window.rotateStartVector = null;

// --- NODE EDITING STATE (LIGHTBURN STYLE) ---
window.nodeEditMode = false;
window.nodeEditTarget = null;
window.nodeHandlesGroup = null;
window.selectedNodeIndex = -1;
window.draggingNode = false;
window.dragNodeIndex = -1;

/* ========================= SELECCIÓN DE OBJETO ========================= */
window.getSelectableItem = function(item) {
    if (!item) return null;
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
    if (!item || (item.data && item.data.mockup)) {
        return;
    }

    const displayItem = (item.data && item.data.clipGroup) ? item.children.find(function(c) { return !c.clipMask; }) : item;
    if (!displayItem) return;
    const bounds = displayItem.bounds;
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

    // 3. Dibujar el tirador de rotación estilo Canva/LightBurn (Línea + Círculo magenta)
    const rotLine = new paper.Path.Line({
        from: bounds.topCenter,
        to: bounds.topCenter.add(new paper.Point(0, -25 / paper.view.zoom)),
        strokeColor: '#007bff',
        strokeWidth: 1.5 / paper.view.zoom
    });
    window.selectionBoxGroup.addChild(rotLine);

    const rotCircle = new paper.Path.Circle({
        center: bounds.topCenter.add(new paper.Point(0, -25 / paper.view.zoom)),
        radius: 5 / paper.view.zoom,
        fillColor: '#ff00ff', // Color de identidad de EKKO
        strokeColor: '#ffffff',
        strokeWidth: 1.5 / paper.view.zoom
    });
    rotCircle.data = { isHandle: true, handleType: 'rot' };
    window.selectionBoxGroup.addChild(rotCircle);

    window.selectionBoxGroup.bringToFront();
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
    document.getElementById('ctxNodeEditControls').classList.remove('hidden');
    document.getElementById('ctxVectorControls').classList.add('hidden');
    document.getElementById('ctxImageControls').classList.add('hidden');
    document.getElementById('ctxTextControls').classList.add('hidden');
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
window.selectItem = function(item) {
    if (window.nodeEditMode) {
        window.exitNodeEditMode();
    }
    if (window.selectedItem) {
        window.selectedItem.selected = false;
    }
    window.selectedItem = item;
    if (!item) {
        window.updateSelectionBox(null);
        paper.view.update();
        return;
    }
    if (item.data && item.data.mockup) {
        item.selected = false;
        window.updateSelectionBox(null);
        paper.view.update();
        return;
    }
    window.updateSelectionBox(item);
    paper.view.update();
};

/* ========================= DESELECT ========================= */
window.deselectItem = function() {
    if (window.nodeEditMode) {
        window.exitNodeEditMode();
    }
    if (window.selectedItem) {
        window.selectedItem.selected = false;
    }
    window.selectedItem = null;
    window.updateSelectionBox(null);
    paper.view.update();
};

/* ========================= FUNCIONES AUXILIARES DE ESCALADO ========================= */
window.getOppositePoint = function(bounds, handleType) {
    switch (handleType) {
        case 'tl': return bounds.bottomRight;
        case 'tr': return bounds.bottomLeft;
        case 'bl': return bounds.topRight;
        case 'br': return bounds.topLeft;
        case 't': return bounds.bottomCenter;
        case 'b': return bounds.topCenter;
        case 'l': return bounds.rightCenter;
        case 'r': return bounds.leftCenter;
        default: return bounds.center;
    }
};

window.getHandlePoint = function(bounds, handleType) {
    switch (handleType) {
        case 'tl': return bounds.topLeft;
        case 'tr': return bounds.topRight;
        case 'bl': return bounds.bottomLeft;
        case 'br': return bounds.bottomRight;
        case 't': return bounds.topCenter;
        case 'b': return bounds.bottomCenter;
        case 'l': return bounds.leftCenter;
        case 'r': return bounds.rightCenter;
        default: return bounds.center;
    }
};

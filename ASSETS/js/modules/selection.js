/* =========================================================================
Módulo: ASSETS/js/modules/selection.js (v13.0 PRO Industrial - Zero Orphan Selection)
Ruta en repositorio: ASSETS/js/modules/selection.js
Descripción:
Gestión integral de selección simple y múltiple, arrastre en bloque, recuadro
de selección por arrastre (marquee), redimensionamiento y rotación unificada.
Sincronizado al 100% con el motor CSG reactivo de Descomposición por Jerarquía
de Contención y Capas (recalculateDynamicSubtractions).

MEJORAS V13.0 PRO:
1. Blindaje absoluto contra "Selección Huérfana":
   - Se excluyen rigurosamente de hitTest todos los elementos de selección y tiradores
     (window.selectionBoxGroup, isSelectionBox, isHandle, isNodeHandle, etc.).
   - _getSelectableItem solo retorna elementos con parent activo en designLayer,
     eliminando la asignación de grupos temporales desvinculados o residuos de interfaz.
2. Hit-testing limpio y preciso tanto para masas sólidas como para calados activos (isHole).
3. Recálculo dinámico CSG reactivo continuo durante el arrastre, escalado y rotación.
4. Compatibilidad total con Canva/Figma style transform box y Paper.js.
========================================================================= */

// Logging controlado y conmutable para desarrollo y auditoría F12
window.EKKO_DEBUG = typeof window.EKKO_DEBUG !== 'undefined' ? window.EKKO_DEBUG : false;
const debugLog = (...args) => { if (window.EKKO_DEBUG) console.log(...args); };

if (typeof paper !== "undefined") {
    const classesToDisable = [
        paper.Item,
        paper.Path,
        paper.CompoundPath,
        paper.Group,
        paper.Shape,
        paper.Raster,
        paper.PointText,
        paper.Layer
    ];
    classesToDisable.forEach(function(cls) {
        if (cls && cls.prototype) {
            cls.prototype._drawSelected = function() {};
            cls.prototype.drawSelected = function() {};
        }
    });
}

function protectGlobal(name, fn) {
    let currentImpl = fn;
    try {
        Object.defineProperty(window, name, {
            get: function() { return currentImpl; },
            set: function(newVal) {
                if (typeof newVal === 'function') {
                    currentImpl = newVal;
                }
            },
            configurable: true,
            enumerable: true
        });
    } catch (e) {
        window[name] = fn;
    }
}

/**
 * Blindaje para resolver el elemento de contenido real
 * (evita errores 'children of undefined' en paths directos o encapsulados en clipGroup)
 */
function getContentItem(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup) {
        if (!item.children) return item;
        const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
        if (content) return content;
        const fallback = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup)));
        if (fallback) return fallback;
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

// Variables de estado global de selección y transformación
window.selectedItem = null;
window.selectedItems = [];
window.selectionBoxGroup = null;
window.dragging = false;
window.dragTargets = [];
window.dragOffset = new paper.Point(0, 0);
window.resizeActive = false;
window.resizeHandleType = null;
window.resizeInitialBounds = null;
window.resizeInitialPoint = null;
window.resizeAnchor = null;
window.resizeLastScaleX = 1.0;
window.resizeLastScaleY = 1.0;
window.resizeTargets = [];
window.rotationActive = false;
window.rotationCenter = null;
window.rotationStartAngle = 0;
window.rotationTarget = null;
window.rotationInitialAngle = 0;
window.rotationTargets = [];
window.rotationAngleLabel = null;
window.isRotationSnapped = false;
window.nodeEditMode = false;
window.nodeEditTarget = null;
window.nodeHandlesGroup = null;
window.selectedNodeIndex = -1;
window.draggingNode = false;
window.dragNodeIndex = -1;
window.marqueeActive = false;
window.marqueeStartPoint = null;
window.marqueePath = null;

/**
 * Resuelve de forma segura el elemento seleccionable perteneciente a la capa de diseño útil.
 * Garantiza que jamás se retorne un objeto huérfano, desvinculado o de interfaz.
 */
const _getSelectableItem = function(item) {
    if (!item || !item.project || !item.layer) return null;
    if (item.clipMask) return null;

    const designLayer = (paper.project && paper.project.layers)
        ? (paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer)
        : null;

    let current = item;
    while (current) {
        const d = current.data || {};
        // Descartar de inmediato elementos de interfaz, tiradores, cotas, guías y mockups
        if (d.isSelectionBox || d.isHandle || d.isNodeHandle || d.isCurveHandle ||
            d.isNodeEditOverlay || d.isSmartGuide || d.isMeasurement || d.isTracePreview ||
            d.mockup || d.isMask || d.wasClipMask) {
            return null;
        }

        if (current === window.currentMockup || current === window.selectionBoxGroup || current === window.nodeHandlesGroup) {
            return null;
        }

        // Si es un grupo recortado (clipGroup)
        if (d.clipGroup) {
            if (designLayer && (current.parent === designLayer || current.layer === designLayer)) {
                return current;
            }
            return null;
        }

        // Si su padre es directamente la capa de diseño
        if (designLayer && current.parent === designLayer) {
            return current;
        }

        // Si su padre es una capa genérica de Paper.js
        if (current.parent instanceof paper.Layer) {
            if (designLayer && current.parent === designLayer) {
                return current;
            }
            return null;
        }

        // Subir en la jerarquía mientras exista un contenedor intermedio
        if (current.parent) {
            current = current.parent;
        } else {
            // Si llegó a la raíz sin estar conectado a una capa activa, es huérfano
            return null;
        }
    }
    return null;
};

/**
 * Actualiza la caja de selección unificada con tiradores y rotador (Canva / LightBurn style)
 */
const _updateSelectionBox = function(item) {
    if (window.selectionBoxGroup) {
        window.selectionBoxGroup.remove();
        window.selectionBoxGroup = null;
    }

    if (window.nodeEditMode) {
        return;
    }

    if (window.paper && paper.project) {
        const designLayer = paper.project.layers.find(l => l.name === 'designLayer');
        if (designLayer) designLayer.activate();
    }

    const primaryItem = item || window.selectedItem;
    if (!primaryItem) return;

    // Validación estricta anti-huérfano
    if (!primaryItem.project || !primaryItem.layer || !primaryItem.parent) {
        return;
    }

    let isMockup = false;
    let curr = primaryItem;
    while (curr) {
        if (curr.data && (curr.data.mockup || curr.data.isMask)) {
            isMockup = true;
            break;
        }
        if (curr === window.currentMockup) {
            isMockup = true;
            break;
        }
        curr = curr.parent;
    }
    if (isMockup) return;

    // Filtrar elementos válidos de la selección múltiple
    const selected = (window.selectedItems && window.selectedItems.length > 0)
        ? window.selectedItems.filter(it => it && it.project && it.parent && !it.data?.isSelectionBox)
        : [primaryItem];

    if (selected.length === 0) return;

    let bounds = null;
    selected.forEach(function(it) {
        const displayItem = getContentItem(it);
        if (!displayItem) return;

        // Si el elemento fue temporalmente desintegrado o vaciado por sustracciones totales, saltar
        if (displayItem.visible === false || displayItem.pathData === "") return;

        if (!bounds) {
            bounds = displayItem.bounds.clone();
        } else {
            bounds = bounds.unite(displayItem.bounds);
        }
    });

    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

    window.selectionBoxGroup = new paper.Group();
    window.selectionBoxGroup.data = { isSelectionBox: true };

    const mainColor = '#007bff';

    // Delineado secundario punteado si hay selección múltiple
    if (selected.length > 1) {
        selected.forEach(function(it) {
            const displayItem = getContentItem(it);
            if (displayItem && displayItem.bounds) {
                if (displayItem.visible === false || displayItem.pathData === "") return;
                const singleBorder = new paper.Path.Rectangle(displayItem.bounds);
                singleBorder.strokeColor = mainColor;
                singleBorder.strokeWidth = 1 / paper.view.zoom;
                singleBorder.dashArray = [3 / paper.view.zoom, 3 / paper.view.zoom];
                singleBorder.data = { isSelectionBox: true };
                window.selectionBoxGroup.addChild(singleBorder);
            }
        });
    }

    // Marco exterior de selección unificado
    const border = new paper.Path.Rectangle(bounds);
    border.strokeColor = mainColor;
    border.strokeWidth = 1.5 / paper.view.zoom;
    border.data = { isSelectionBox: true };
    window.selectionBoxGroup.addChild(border);

    // Tiradores de redimensionamiento (8 puntos estándar)
    const handleSize = 8 / paper.view.zoom;
    const halfHandle = handleSize / 2;

    const handlePositions = [
        { type: 'tl', point: bounds.topLeft },
        { type: 't',  point: bounds.topCenter },
        { type: 'tr', point: bounds.topRight },
        { type: 'r',  point: bounds.rightCenter },
        { type: 'br', point: bounds.bottomRight },
        { type: 'b',  point: bounds.bottomCenter },
        { type: 'bl', point: bounds.bottomLeft },
        { type: 'l',  point: bounds.leftCenter }
    ];

    handlePositions.forEach(pos => {
        const handleRect = new paper.Path.Rectangle(
            new paper.Rectangle(pos.point.x - halfHandle, pos.point.y - halfHandle, handleSize, handleSize)
        );
        handleRect.fillColor = '#ffffff';
        handleRect.strokeColor = mainColor;
        handleRect.strokeWidth = 1.5 / paper.view.zoom;
        handleRect.data = { isSelectionBox: true, isHandle: true, handleType: pos.type };
        window.selectionBoxGroup.addChild(handleRect);
    });

    // Tirador superior de Rotación (LightBurn / Canva Style)
    const rotOffset = 22 / paper.view.zoom;
    const rotHandleCenter = bounds.topCenter.subtract(new paper.Point(0, rotOffset));
    const connector = new paper.Path.Line(bounds.topCenter, rotHandleCenter);
    connector.strokeColor = mainColor;
    connector.strokeWidth = 1.2 / paper.view.zoom;
    connector.data = { isSelectionBox: true };
    window.selectionBoxGroup.addChild(connector);

    const rotHandleCircle = new paper.Path.Circle({
        center: rotHandleCenter,
        radius: 7.5 / paper.view.zoom,
        fillColor: '#ffffff',
        strokeColor: mainColor,
        strokeWidth: 1.5 / paper.view.zoom
    });
    rotHandleCircle.data = { isSelectionBox: true, isHandle: true, handleType: 'rot' };
    window.selectionBoxGroup.addChild(rotHandleCircle);

    // Flecha curva indicativa de rotación interior
    const arrowRadius = 4 / paper.view.zoom;
    const arrowArc = new paper.Path.Arc(
        rotHandleCenter.add(new paper.Point(-arrowRadius, 0)),
        rotHandleCenter.add(new paper.Point(0, -arrowRadius)),
        rotHandleCenter.add(new paper.Point(arrowRadius, 0))
    );
    arrowArc.strokeColor = mainColor;
    arrowArc.strokeWidth = 1.2 / paper.view.zoom;
    arrowArc.data = { isSelectionBox: true, isHandle: true, handleType: 'rot' };
    window.selectionBoxGroup.addChild(arrowArc);

    const arrowTip = new paper.Path.RegularPolygon(
        rotHandleCenter.add(new paper.Point(arrowRadius, 0)),
        3,
        2.5 / paper.view.zoom
    );
    arrowTip.fillColor = mainColor;
    arrowTip.data = { isSelectionBox: true, isHandle: true, handleType: 'rot' };
    window.selectionBoxGroup.addChild(arrowTip);

    window.selectionBoxGroup.bringToFront();

    if (typeof window.applyPositionCorrections === "function") {
        window.applyPositionCorrections();
    }
    if (typeof window.bindRotationInputEvents === "function") {
        window.bindRotationInputEvents();
    }
    if (typeof window.syncContextualRotationInput === "function") {
        window.syncContextualRotationInput(primaryItem);
    }
};

/**
 * Selecciona un elemento del lienzo validando previamente su integridad topológica
 */
const _selectItem = function(item, isMulti = false) {
    if (window.nodeEditMode) {
        return;
    }

    if (!item) {
        window.deselectItem();
        return;
    }

    // Validación defensiva anti-huérfano: verificar que sea un elemento válido en designLayer
    const validItem = _getSelectableItem(item);
    if (!validItem) {
        window.deselectItem();
        return;
    }

    item = validItem;

    if (!window.selectedItems) window.selectedItems = [];

    if (isMulti) {
        const index = window.selectedItems.indexOf(item);
        if (index > -1) {
            item.selected = false;
            window.selectedItems.splice(index, 1);
        } else {
            item.selected = true;
            window.selectedItems.push(item);
        }
        window.selectedItem = window.selectedItems.length > 0 ? window.selectedItems[window.selectedItems.length - 1] : null;
    } else {
        window.selectedItems.forEach(function(it) {
            if (it) it.selected = false;
        });

        if (item && item.project && item.parent) {
            item.selected = true;
            window.selectedItem = item;
            window.selectedItems = [item];
        } else {
            window.selectedItem = null;
            window.selectedItems = [];
        }
    }

    if (!window.selectedItem) {
        window.updateSelectionBox(null);
        paper.view.update();
        return;
    }

    window.updateSelectionBox(window.selectedItem);

    if (typeof window.updateContextualMenu === 'function') {
        window.updateContextualMenu(window.selectedItem);
    }

    paper.view.update();
};

/**
 * Deselecciona todos los elementos y remueve las cajas de selección
 */
const _deselectItem = function() {
    if (window.nodeEditMode) {
        return;
    }

    if (window.selectedItems) {
        window.selectedItems.forEach(function(it) {
            if (it) it.selected = false;
        });
        window.selectedItems = [];
    }

    if (window.selectedItem) {
        window.selectedItem.selected = false;
    }

    window.selectedItem = null;
    window.updateSelectionBox(null);

    if (typeof window.hideContextualMenu === 'function') {
        window.hideContextualMenu();
    }

    paper.view.update();
};

const _getOppositePoint = function(bounds, handleType) {
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

const _getHandlePoint = function(bounds, handleType) {
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

/**
 * Inicializador de la herramienta principal de selección de Paper.js
 */
const _initSelectionTool = function() {
    if (!paper.view) {
        debugLog("initSelectionTool: paper.view no está definido todavía.");
        return;
    }

    const selectTool = new paper.Tool();
    let lastClickTime = 0;

    selectTool.onMouseDown = function(event) {
        if (window.nodeEditMode) return;

        if (window.insertTextMode) {
            if (typeof createEditableText === "function") {
                createEditableText(event.point);
            }
            window.insertTextMode = false;
            paper.view.element.style.cursor = "default";
            return;
        }

        const currentTime = Date.now();
        if (currentTime - lastClickTime < 300) {
            lastClickTime = 0;
            // Doble clic: Edición directa de texto o entrada en modo de nodos
            if (window.selectedItem) {
                const target = getContentItem(window.selectedItem);
                if (target instanceof paper.PointText) {
                    if (typeof window.startTextEditing === 'function') {
                        window.startTextEditing(target);
                        return;
                    }
                } else if (target instanceof paper.Path || target instanceof paper.CompoundPath) {
                    if (typeof window.enterNodeEditMode === 'function') {
                        window.enterNodeEditMode(window.selectedItem);
                        return;
                    }
                }
            }
        }
        lastClickTime = currentTime;

        // 1. Hit-test exclusivo para tiradores de la caja de selección
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
            const hType = hitResult.item.data.handleType;
            if (hType === 'rot') {
                if (!window.selectedItem) return;
                window.rotationActive = true;
                window.rotationTarget = window.selectedItem;

                let unifiedBounds = null;
                window.selectedItems.forEach(function(it) {
                    const displayItem = getContentItem(it);
                    if (!displayItem) return;
                    if (!unifiedBounds) {
                        unifiedBounds = displayItem.bounds.clone();
                    } else {
                        unifiedBounds = unifiedBounds.unite(displayItem.bounds);
                    }
                });

                window.rotationCenter = unifiedBounds ? unifiedBounds.center : window.selectedItem.bounds.center;
                window.rotationStartAngle = event.point.subtract(window.rotationCenter).angle;
                const primaryDisplay = getContentItem(window.selectedItem);
                window.rotationInitialAngle = primaryDisplay ? (primaryDisplay.data?.rotation || 0) : 0;

                window.rotationTargets = [];
                window.selectedItems.forEach(function(item) {
                    const tgt = getContentItem(item);
                    if (tgt) {
                        window.rotationTargets.push({
                            item: item,
                            target: tgt,
                            initialRotation: tgt.data?.rotation || 0,
                            initialPosition: tgt.position.clone()
                        });
                    }
                });
                return;
            }

            // Tirador de redimensionamiento
            window.resizeActive = true;
            window.resizeHandleType = hType;

            window.resizeTargets = [];
            let unifiedBounds = null;
            window.selectedItems.forEach(function(it) {
                const displayItem = getContentItem(it);
                if (!displayItem) return;
                window.resizeTargets.push({
                    item: it,
                    target: displayItem,
                    initialBounds: displayItem.bounds.clone(),
                    initialPosition: displayItem.position.clone()
                });
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

        // 2. Hit-testing general en el lienzo (soporta masas sólidas y calados activos)
        // BLINDAJE: Excluir estrictamente cajas de selección, tiradores, cotas, guías y mockups
        let generalHit = paper.project.hitTest(event.point, {
            fill: true,
            stroke: true,
            segments: true,
            tolerance: 8 / paper.view.zoom,
            match: function(hit) {
                if (!hit || !hit.item) return false;
                let curr = hit.item;
                while (curr) {
                    const d = curr.data || {};
                    if (d.isSelectionBox || d.isHandle || d.isNodeHandle || d.isCurveHandle ||
                        d.isNodeEditOverlay || d.isSmartGuide || d.isMeasurement || d.isTracePreview ||
                        d.mockup || d.isMask || d.wasClipMask) {
                        return false;
                    }
                    if (curr === window.currentMockup || curr === window.selectionBoxGroup || curr === window.nodeHandlesGroup) {
                        return false;
                    }
                    curr = curr.parent;
                }
                return true;
            }
        });

        if (generalHit) {
            const selectableItem = window.getSelectableItem(generalHit.item);
            if (selectableItem) {
                const displayItem = getContentItem(selectableItem);
                if (!displayItem || !displayItem.bounds || !displayItem.bounds.contains(event.point)) {
                    generalHit = null;
                }
            } else {
                generalHit = null;
            }
        }

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
                    if (!window.selectedItems.includes(selectableItem)) {
                        window.selectedItems.forEach(function(it) {
                            if (it) it.selected = false;
                        });
                        selectableItem.selected = true;
                        window.selectedItem = selectableItem;
                        window.selectedItems = [selectableItem];
                    }
                }

                window.dragging = true;
                window.dragTargets = [];
                window.selectedItems.forEach(function(item) {
                    const dragTarget = getContentItem(item);
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

        // 3. Arrastre por dentro de la caja de selección múltiple existente
        if (window.selectedItems && window.selectedItems.length > 1 && window.selectionBoxGroup) {
            const selectionBoxBounds = window.selectionBoxGroup.bounds;
            if (selectionBoxBounds && selectionBoxBounds.contains(event.point)) {
                window.dragging = true;
                window.dragTargets = [];
                window.selectedItems.forEach(function(item) {
                    const dragTarget = getContentItem(item);
                    if (dragTarget) {
                        window.dragTargets.push({
                            item: item,
                            target: dragTarget,
                            dragOffset: event.point.subtract(dragTarget.position)
                        });
                    }
                });
                return;
            }
        }

        // 4. Clic en espacio vacío: Deseleccionar e iniciar selección por ventana (Marquee)
        window.deselectItem();
        window.marqueeActive = true;
        window.marqueeStartPoint = event.point.clone();
        window.marqueePath = new paper.Path.Rectangle({
            from: event.point,
            to: event.point,
            strokeColor: '#007bff',
            fillColor: new paper.Color(0, 123, 255, 0.15),
            strokeWidth: 1 / paper.view.zoom,
            dashArray: [4 / paper.view.zoom, 4 / paper.view.zoom]
        });
        window.marqueePath.data = { isSelectionBox: true };
        paper.view.update();
    };

    selectTool.onMouseDrag = function(event) {
        if (window.nodeEditMode) return;

        if (window.selectedItem && window.selectedItem.data && window.selectedItem.data.locked) {
            return;
        }

        if (window.marqueeActive && window.marqueePath) {
            window.marqueePath.remove();
            window.marqueePath = new paper.Path.Rectangle({
                from: window.marqueeStartPoint,
                to: event.point,
                strokeColor: '#007bff',
                fillColor: new paper.Color(0, 123, 255, 0.15),
                strokeWidth: 1 / paper.view.zoom,
                dashArray: [4 / paper.view.zoom, 4 / paper.view.zoom]
            });
            window.marqueePath.data = { isSelectionBox: true };
            paper.view.update();
            return;
        }

        // Rotación interactiva
        if (window.rotationActive && window.rotationTarget && window.rotationTargets && window.rotationTargets.length > 0) {
            const currentAngle = event.point.subtract(window.rotationCenter).angle;
            let deltaAngle = currentAngle - window.rotationStartAngle;

            if (event.modifiers && event.modifiers.shift) {
                const totalAngle = window.rotationInitialAngle + deltaAngle;
                const snappedTotal = Math.round(totalAngle / 15) * 15;
                deltaAngle = snappedTotal - window.rotationInitialAngle;
                window.isRotationSnapped = true;
            } else {
                window.isRotationSnapped = false;
            }

            window.rotationTargets.forEach(function(targetInfo) {
                if (targetInfo.item.data && targetInfo.item.data.locked) return;
                const newRot = (targetInfo.initialRotation + deltaAngle) % 360;
                targetInfo.target.rotation = newRot;
                targetInfo.target.data = { ...(targetInfo.target.data || {}), rotation: newRot };

                if (window.rotationTargets.length > 1) {
                    targetInfo.target.position = targetInfo.initialPosition.rotate(deltaAngle, window.rotationCenter);
                }
            });

            // Recálculo reactivo CSG al rotar capas
            if (typeof window.recalculateDynamicSubtractions === 'function') {
                window.recalculateDynamicSubtractions();
            }

            const rotationNum = document.getElementById("objRotation");
            if (rotationNum && window.selectedItem) {
                const displayItem = getContentItem(window.selectedItem);
                if (displayItem) {
                    rotationNum.value = Math.round(displayItem.data?.rotation || 0) + '';
                }
            }

            window.updateSelectionBox(null);
            paper.view.update();
            return;
        }

        // Escalado grupal / individual con recálculo reactivo CSG
        if (window.resizeActive && window.resizeTargets && window.resizeTargets.length > 0) {
            const anchor = window.resizeAnchor;
            const initialHandlePoint = window.getHandlePoint(window.resizeInitialBounds, window.resizeHandleType);
            const currentHandlePoint = event.point;

            let factorX = 1.0;
            let factorY = 1.0;

            const initialXDiff = initialHandlePoint.x - anchor.x;
            const currentXDiff = currentHandlePoint.x - anchor.x;
            if (Math.abs(initialXDiff) > 0.001) {
                factorX = currentXDiff / initialXDiff;
            }

            const initialYDiff = initialHandlePoint.y - anchor.y;
            const currentYDiff = currentHandlePoint.y - anchor.y;
            if (Math.abs(initialYDiff) > 0.001) {
                factorY = currentYDiff / initialYDiff;
            }

            const isCorner = ['tl', 'tr', 'bl', 'br'].includes(window.resizeHandleType);
            const isAltPressed = event.modifiers && event.modifiers.alt;

            if (isCorner && !isAltPressed) {
                const signX = factorX < 0 ? -1 : 1;
                const signY = factorY < 0 ? -1 : 1;
                const scaleVal = Math.max(Math.abs(factorX), Math.abs(factorY));
                factorX = scaleVal * signX;
                factorY = scaleVal * signY;
            }

            if (['l', 'r'].includes(window.resizeHandleType)) factorY = 1.0;
            if (['t', 'b'].includes(window.resizeHandleType)) factorX = 1.0;

            const stepScaleX = factorX / (window.resizeLastScaleX || 1.0);
            const stepScaleY = factorY / (window.resizeLastScaleY || 1.0);

            window.resizeTargets.forEach(function(targetInfo) {
                if (targetInfo.item.data && targetInfo.item.data.locked) return;
                targetInfo.target.scale(stepScaleX, stepScaleY, anchor);
            });

            window.resizeLastScaleX = factorX;
            window.resizeLastScaleY = factorY;

            // Recálculo reactivo CSG al escalar
            if (typeof window.recalculateDynamicSubtractions === 'function') {
                window.recalculateDynamicSubtractions();
            }

            window.updateSelectionBox(null);
            paper.view.update();
            return;
        }

        // Arrastre en tiempo real con recálculo reactivo CSG en vivo
        if (window.dragging && window.dragTargets && window.dragTargets.length > 0) {
            window.dragTargets.forEach(function(dragInfo) {
                if (dragInfo.item.data && dragInfo.item.data.locked) return;
                dragInfo.target.position = event.point.subtract(dragInfo.dragOffset);
            });

            // Recálculo reactivo CSG en vivo al mover capas
            if (typeof window.recalculateDynamicSubtractions === 'function') {
                window.recalculateDynamicSubtractions();
            }

            if (typeof calculateSmartGuides === "function") {
                calculateSmartGuides(window.selectedItem, event);
            }

            window.updateSelectionBox(window.selectedItem);
            paper.view.update();
            return;
        }
    };

    selectTool.onMouseUp = function(event) {
        if (window.nodeEditMode) return;

        if (window.marqueeActive && window.marqueePath) {
            const marqueeBounds = window.marqueePath.bounds;
            window.marqueePath.remove();
            window.marqueePath = null;
            window.marqueeActive = false;

            const itemsToSelect = [];
            paper.project.activeLayer.children.forEach(function(item) {
                let isMockup = false;
                let curr = item;
                while (curr) {
                    if (curr.data && (curr.data.mockup || curr.data.isMask)) {
                        isMockup = true;
                        break;
                    }
                    if (curr === window.currentMockup) {
                        isMockup = true;
                        break;
                    }
                    curr = curr.parent;
                }
                if (isMockup) return;

                const displayItem = getContentItem(item);
                if (displayItem && displayItem.bounds && (displayItem.visible !== false && displayItem.pathData !== "") && marqueeBounds.intersects(displayItem.bounds)) {
                    itemsToSelect.push(item);
                }
            });

            if (itemsToSelect.length > 0) {
                window.selectedItems = itemsToSelect;
                window.selectedItem = itemsToSelect[itemsToSelect.length - 1];
                window.selectedItems.forEach(function(it) {
                    it.selected = true;
                });
                window.updateSelectionBox(window.selectedItem);
                if (typeof window.updateContextualMenu === 'function') {
                    window.updateContextualMenu(window.selectedItem);
                }
            } else {
                window.deselectItem();
            }
            paper.view.update();
            return;
        }

        if (window.resizeActive || window.dragging || window.rotationActive) {
            if (typeof window.saveHistory === 'function') window.saveHistory();
            // Asegurar recálculo CSG final tras soltar el ratón
            if (typeof window.recalculateDynamicSubtractions === 'function') {
                window.recalculateDynamicSubtractions();
            }
        }

        window.dragging = false;
        window.resizeActive = false;
        window.rotationActive = false;
        window.isRotationSnapped = false;
        window.rotationTargets = [];

        const canvas = document.getElementById("editorCanvas");
        if (canvas) canvas.style.cursor = 'default';

        if (typeof clearSmartGuides === "function") clearSmartGuides();

        window.updateSelectionBox(window.selectedItem);
        paper.view.update();
    };

    selectTool.onMouseMove = function(event) {
        if (window.nodeEditMode) return;
        const canvas = document.getElementById("editorCanvas");
        if (!canvas) return;
        if (window.resizeActive) return;

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
            const hType = hitResult.item.data.handleType;
            if (hType === 'rot') {
                canvas.style.cursor = 'grab';
                return;
            }
            switch (hType) {
                case 'tl': case 'br': canvas.style.cursor = 'nwse-resize'; return;
                case 'tr': case 'bl': canvas.style.cursor = 'nesw-resize'; return;
                case 't':  case 'b':  canvas.style.cursor = 'ns-resize'; return;
                case 'l':  case 'r':  canvas.style.cursor = 'ew-resize'; return;
            }
        }

        // Hit-test del cursor para indicar movimiento sobre objetos seleccionados
        let generalHit = paper.project.hitTest(event.point, {
            fill: true,
            stroke: true,
            segments: true,
            tolerance: 8 / paper.view.zoom,
            match: function(hit) {
                if (!hit || !hit.item) return false;
                let curr = hit.item;
                while (curr) {
                    const d = curr.data || {};
                    if (d.isSelectionBox || d.isHandle || d.isNodeHandle || d.isCurveHandle ||
                        d.isNodeEditOverlay || d.isSmartGuide || d.isMeasurement || d.isTracePreview ||
                        d.mockup || d.isMask || d.wasClipMask) {
                        return false;
                    }
                    if (curr === window.currentMockup || curr === window.selectionBoxGroup || curr === window.nodeHandlesGroup) return false;
                    curr = curr.parent;
                }
                return true;
            }
        });

        if (generalHit) {
            const hitItem = window.getSelectableItem(generalHit.item);
            if (hitItem) {
                const displayItem = getContentItem(hitItem);
                if (displayItem && displayItem.bounds && (displayItem.visible !== false && displayItem.pathData !== "") && displayItem.bounds.contains(event.point)) {
                    if (window.selectedItems && window.selectedItems.includes(hitItem)) {
                        canvas.style.cursor = 'move';
                        return;
                    }
                } else {
                    generalHit = null;
                }
            } else {
                generalHit = null;
            }
        }

        if (generalHit && window.selectedItems && window.selectedItems.length > 0) {
            const hitItem = window.getSelectableItem(generalHit.item);
            if (window.selectedItems.includes(hitItem)) {
                canvas.style.cursor = 'move';
                return;
            }
        }

        if (window.selectedItems && window.selectedItems.length > 1 && window.selectionBoxGroup) {
            if (window.selectionBoxGroup.bounds.contains(event.point)) {
                canvas.style.cursor = 'move';
                return;
            }
        }

        canvas.style.cursor = 'default';
    };

    selectTool.activate();
};

if (typeof paper !== "undefined" && paper.view) {
    _initSelectionTool();
}

protectGlobal('getSelectableItem', _getSelectableItem);
protectGlobal('updateSelectionBox', _updateSelectionBox);
protectGlobal('selectItem', _selectItem);
protectGlobal('deselectItem', _deselectItem);
protectGlobal('getOppositePoint', _getOppositePoint);
protectGlobal('getHandlePoint', _getHandlePoint);
protectGlobal('initSelectionTool', _initSelectionTool);

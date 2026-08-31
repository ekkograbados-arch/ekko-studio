/* =========================================================================
Módulo: ASSETS/js/modules/selection.js (v38.2 PRO Industrial - Multiselection Unity & Product Mask Lock)
Ruta en repositorio: ASSETS/js/modules/selection.js
Descripción:
Gestión integral de selección simple y múltiple, arrastre en bloque e individual,
recuadro de selección por arrastre (marquee), redimensionamiento (8 tiradores) y rotación unificada.
Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt & EKKO_DIAG v6.2):
  1. MULTISELECCIÓN LIMPIA Y UNIFICADA TRAS DESAGRUPAR:
     - Dibuja un bounding box común que envuelve todas las capas liberadas.
     - Permite arrastre solidario en bloque de todas las piezas seleccionadas.
  2. BLINDAJE DE MÁSCARA DE PRODUCTO (clipGroup Protected):
     - Mantiene la máscara concéntrica estática, transformando únicamente el contenido interno.
  3. PRIORIDAD DE SELECCIÓN INDIVIDUAL SOBRE CAJA DE MULTISELECCIÓN:
     - Al hacer clic directo sobre una pieza dentro de un bloque multiseleccionado,
       se aísla inmediatamente la pieza individual al soltar el ratón o con clic directo.
  4. HIT-TESTING TOPOLÓGICO DE CALADOS ACTIVOS (isHole):
     - Permite seleccionar, arrastrar y reposicionar calados interactivos en cualquier nivel Z.
  5. CONTORNO AJUSTADO A LA FORMA EXACTA DEL CALADO (Hole Tight Contour):
     - Proyecta la silueta cian punteada del calado para precisión micrométrica de alineación.
  6. FUNCIONES DE ANCLAJE Y MANIPULADORES (_getHandlePoint, _getOppositePoint).
  7. EMISIÓN COMPATIBLE CON AUDITORÍA FORENSE (ekkoDiagnostics.js).
========================================================================= */

// Logging controlado y conmutable para desarrollo y auditoría F12
window.EKKO_DEBUG = typeof window.EKKO_DEBUG !== 'undefined' ? window.EKKO_DEBUG : false;
const debugLog = (...args) => { if (window.EKKO_DEBUG) console.log(...args); };

// Desactivar el dibujo por defecto de Paper.js para la selección nativa
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
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

/**
 * Sincronización recursiva profunda de geomBase ante desplazamientos
 */
function syncGeomBaseDeep(item, delta) {
    if (!item || !delta || (delta.x === 0 && delta.y === 0)) return;

    function recurse(target) {
        if (!target) return;
        if (target.data && target.data.geomBase) {
            target.data.geomBase.position = target.data.geomBase.position.add(delta);
        }
        if (target instanceof paper.CompoundPath && target.children) {
            target.children.forEach(c => {
                if (c.data && c.data.geomBase) {
                    c.data.geomBase.position = c.data.geomBase.position.add(delta);
                }
            });
        }
        if (target instanceof paper.Group && target.children && target.children.length > 0) {
            target.children.forEach(child => recurse(child));
        }
    }
    recurse(item);
}

// Variables globales de estado del motor de selección
window.selectedItem = null;
window.selectedItems = [];
window.selectionBoxGroup = null;
window.dragging = false;
window.dragTargets = [];
window.resizeActive = false;
window.resizeTargets = [];
window.resizeHandleType = null;
window.resizeInitialBounds = null;
window.resizeInitialPoint = null;
window.resizeAnchor = null;
window.rotationActive = false;
window.rotationTargets = [];
window.rotationCenter = null;
window.rotationStartAngle = 0;
window.rotationInitialAngle = 0;
window.isRotationSnapped = false;
window._mouseDragOccurred = false;
window._pendingIsolateItem = null;
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
    if (!item || !item.project) return null;

    let isMockup = false;
    let curr = item;
    while (curr) {
        if (curr.data && (curr.data.mockup || curr.data.isMask || curr.data.wasClipMask || curr.data.isSelectionBox || curr.data.isHandle || curr.data.isNodeHandle || curr.data.isCurveHandle || curr.data.isNodeEditOverlay)) {
            isMockup = true;
            break;
        }
        if (curr === window.currentMockup || curr === window.selectionBoxGroup || curr === window.nodeHandlesGroup) {
            isMockup = true;
            break;
        }
        curr = curr.parent;
    }
    if (isMockup) return null;

    const designLayer = (paper.project.layers && paper.project.layers.find(l => l.name === 'designLayer')) || paper.project.activeLayer;
    let current = item;

    while (current) {
        if (current.data && current.data.clipGroup) {
            return current;
        }
        if (current.parent && (current.parent === designLayer || current.parent instanceof paper.Layer)) {
            return current;
        }
        if (current.parent) {
            current = current.parent;
        } else {
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
        const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
        if (designLayer) designLayer.activate();
    }

    const primaryItem = item || window.selectedItem;
    if (!primaryItem) return;

    // Validación estricta anti-huérfano
    if (!primaryItem.project || !primaryItem.parent) {
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

        let itemBounds = null;
        const gBase = (displayItem.data && displayItem.data.geomBase) || (it.data && it.data.geomBase);
        const isHole = !!((displayItem.data && displayItem.data.isHole) || (it.data && it.data.isHole));

        // Si es calado activo, resolver coordenadas globales exactas mediante getGlobalUnsubtractedPath
        if (isHole && typeof window.getGlobalUnsubtractedPath === 'function') {
            const holeGeom = window.getGlobalUnsubtractedPath(displayItem);
            if (holeGeom && holeGeom.bounds && holeGeom.bounds.width > 0 && holeGeom.bounds.height > 0) {
                itemBounds = holeGeom.bounds.clone();
                try { holeGeom.remove(); } catch(e) {}
            }
        }

        if (!itemBounds) {
            if (displayItem.bounds && displayItem.bounds.width > 0 && displayItem.bounds.height > 0) {
                itemBounds = displayItem.bounds.clone();
            } else if (gBase && gBase.bounds) {
                itemBounds = gBase.bounds.clone();
            }
        }

        if (itemBounds) {
            bounds = !bounds ? itemBounds.clone() : bounds.unite(itemBounds);
        }
    });

    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

    window.selectionBoxGroup = new paper.Group();
    window.selectionBoxGroup.data = { isSelectionBox: true };
    const mainColor = '#007bff';

    // CONTORNO AJUSTADO A LA FORMA EXACTA DEL CALADO (Hole Tight Contour / Magnetic Shell)
    // Permite al usuario/cliente visualizar el perímetro exacto de letras caladas (ej. "F", "A")
    // o bandas para alinear y ajustar con total precisión respecto a vértices o bordes.
    selected.forEach(function(it) {
        const displayItem = getContentItem(it);
        if (!displayItem) return;

        const isHole = !!((displayItem.data && displayItem.data.isHole) || (it.data && it.data.isHole));
        const gBase = (displayItem.data && displayItem.data.geomBase) || (it.data && it.data.geomBase);

        if (isHole) {
            let tightOutline = null;
            if (typeof window.getGlobalUnsubtractedPath === 'function') {
                tightOutline = window.getGlobalUnsubtractedPath(displayItem);
            }
            if (!tightOutline && gBase) {
                tightOutline = gBase.clone({ insert: false });
            }
            if (!tightOutline) {
                tightOutline = displayItem.clone({ insert: false });
            }
            if (tightOutline) {
                tightOutline.strokeColor = new paper.Color('#06b6d4'); // Cian técnico LightBurn
                tightOutline.strokeWidth = 1.8 / paper.view.zoom;
                tightOutline.dashArray = [3 / paper.view.zoom, 3 / paper.view.zoom];
                tightOutline.fillColor = new paper.Color(6, 182, 212, 0.08); // Relleno cian sutil semitransparente
                tightOutline.data = { isSelectionBox: true, isHoleTightOutline: true };
                window.selectionBoxGroup.addChild(tightOutline);
            }
        } else if (displayItem instanceof paper.Group && displayItem.children) {
            displayItem.children.forEach(function(child) {
                if (child && child.data && child.data.isHole) {
                    let childOutline = null;
                    if (typeof window.getGlobalUnsubtractedPath === 'function') {
                        childOutline = window.getGlobalUnsubtractedPath(child);
                    } else if (child.data.geomBase) {
                        childOutline = child.data.geomBase.clone({ insert: false });
                    }
                    if (childOutline) {
                        childOutline.strokeColor = new paper.Color('#06b6d4');
                        childOutline.strokeWidth = 1.8 / paper.view.zoom;
                        childOutline.dashArray = [3 / paper.view.zoom, 3 / paper.view.zoom];
                        childOutline.fillColor = new paper.Color(6, 182, 212, 0.08);
                        childOutline.data = { isSelectionBox: true, isHoleTightOutline: true };
                        window.selectionBoxGroup.addChild(childOutline);
                    }
                }
            });
        }
    });

    // Delineado secundario punteado si hay selección múltiple
    if (selected.length > 1) {
        selected.forEach(function(it) {
            const displayItem = getContentItem(it);
            if (!displayItem) return;
            const b = (displayItem.bounds && displayItem.bounds.width > 0) ? displayItem.bounds : (it.data?.geomBase?.bounds || null);
            if (b) {
                const singleBorder = new paper.Path.Rectangle(b);
                singleBorder.strokeColor = mainColor;
                singleBorder.strokeWidth = 1 / paper.view.zoom;
                singleBorder.dashArray = [3 / paper.view.zoom, 3 / paper.view.zoom];
                singleBorder.data = { isSelectionBox: true };
                window.selectionBoxGroup.addChild(singleBorder);
            }
        });
    }

    // Marco exterior principal envolvente unificado
    const border = new paper.Path.Rectangle(bounds);
    border.strokeColor = mainColor;
    border.strokeWidth = 1.5 / paper.view.zoom;
    border.data = { isSelectionBox: true };
    window.selectionBoxGroup.addChild(border);

    // 8 Tiradores de redimensionamiento
    const handleSize = 8 / paper.view.zoom;
    const positions = [
        { type: 'tl', point: bounds.topLeft },
        { type: 'tr', point: bounds.topRight },
        { type: 'bl', point: bounds.bottomLeft },
        { type: 'br', point: bounds.bottomRight },
        { type: 't',  point: bounds.topCenter },
        { type: 'b',  point: bounds.bottomCenter },
        { type: 'l',  point: bounds.leftCenter },
        { type: 'r',  point: bounds.rightCenter }
    ];

    positions.forEach(function(pos) {
        const handleRect = new paper.Path.Rectangle({
            center: pos.point,
            size: [handleSize, handleSize],
            fillColor: '#ffffff',
            strokeColor: mainColor,
            strokeWidth: 1.5 / paper.view.zoom,
            data: { isSelectionBox: true, isHandle: true, handleType: pos.type }
        });
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
        strokeWidth: 1.5 / paper.view.zoom,
        data: { isSelectionBox: true, isHandle: true, handleType: 'rot' }
    });
    window.selectionBoxGroup.addChild(rotHandleCircle);

    // Flecha circular de rotación
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
 * Resuelve de forma estricta el objeto de mayor índice Z ubicado bajo el cursor.
 * Prioridad absoluta:
 * 1. Recorre de mayor Z a menor Z (Top-Down) sobre la capa de diseño.
 * 2. Soporta tanto masas sólidas visibles como calados activos (isHole) o contenidos en clipGroup.
 * 3. Garantiza que un clic individual aísle exclusivamente el elemento de primer plano.
 */
function findItemAtPoint(point) {
    const layer = (paper.project && paper.project.layers)
        ? (paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer)
        : null;
    if (!layer || !layer.children) return null;

    const tol = 12 / paper.view.zoom;

    // Recorrido en orden Z descendente (de arriba a abajo)
    for (let i = layer.children.length - 1; i >= 0; i--) {
        const item = layer.children[i];
        if (!item || isMockupOrUI(item)) continue;

        const selectable = _getSelectableItem(item);
        if (!selectable) continue;

        const target = getContentItem(selectable);
        if (!target) continue;

        // Comprobación específica para Calados Activos
        if (target.data && target.data.isHole) {
            const holeBase = target.data.geomBase || target;
            if (holeBase && holeBase.bounds && holeBase.bounds.expand(tol).contains(point)) {
                if (holeBase.contains && holeBase.contains(point)) return selectable;
                const strokeHit = holeBase.hitTest(point, { stroke: true, segments: true, tolerance: tol });
                if (strokeHit) return selectable;
            }
        }

        // Comprobación para Masas y Siluetas estándar
        if (target.bounds && target.bounds.expand(tol).contains(point)) {
            const hit = target.hitTest(point, {
                fill: true,
                stroke: true,
                segments: true,
                tolerance: tol
            });
            if (hit) return selectable;

            // Verificación interna si es un grupo de piezas o paths compuestos
            if (target.children && target.children.length > 0) {
                for (let j = target.children.length - 1; j >= 0; j--) {
                    const sub = target.children[j];
                    if (!sub || isMockupOrUI(sub)) continue;
                    const subHit = sub.hitTest(point, { fill: true, stroke: true, tolerance: tol });
                    if (subHit) return selectable;
                    if (sub.contains && sub.contains(point)) return selectable;
                }
            }
        }
    }
    return null;
}

function isMockupOrUI(item) {
    let curr = item;
    while (curr) {
        const d = curr.data || {};
        if (d.isSelectionBox || d.isHandle || d.isNodeHandle || d.isCurveHandle ||
            d.isNodeEditOverlay || d.isSmartGuide || d.isMeasurement || d.isTracePreview ||
            d.mockup || d.isMask || d.wasClipMask) {
            return true;
        }
        if (curr === window.currentMockup || curr === window.selectionBoxGroup || curr === window.nodeHandlesGroup) {
            return true;
        }
        curr = curr.parent;
    }
    return false;
}

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
                    const b = (displayItem.bounds && displayItem.bounds.width > 0) ? displayItem.bounds : (it.data?.geomBase?.bounds || null);
                    if (b) {
                        unifiedBounds = !unifiedBounds ? b.clone() : unifiedBounds.unite(b);
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
                            initialPosition: tgt.position.clone(),
                            lastDeltaAngle: 0
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
                const b = (displayItem.bounds && displayItem.bounds.width > 0) ? displayItem.bounds : (it.data?.geomBase?.bounds || null);
                if (b) {
                    unifiedBounds = !unifiedBounds ? b.clone() : unifiedBounds.unite(b);
                }
                window.resizeTargets.push({
                    item: it,
                    target: displayItem,
                    initialBounds: b ? b.clone() : displayItem.bounds.clone(),
                    initialPosition: displayItem.position.clone()
                });
            });

            window.resizeInitialBounds = unifiedBounds || window.selectedItem.bounds;
            window.resizeInitialPoint = event.point.clone();
            window.resizeAnchor = window.getOppositePoint(window.resizeInitialBounds, window.resizeHandleType);
            window.resizeLastScaleX = 1.0;
            window.resizeLastScaleY = 1.0;
            return;
        }

        // 2. COMPROBACIÓN DIRECTA DE ELEMENTO (PRIORIDAD SOBRE MULTISELECCIÓN)
        const directHitItem = findItemAtPoint(event.point);
        const isShift = !!(event.modifiers && event.modifiers.shift);

        if (directHitItem) {
            window._mouseDragOccurred = false;
            window._pendingIsolateItem = null;

            if (isShift) {
                // Modo multiselección con Shift
                const idx = window.selectedItems.indexOf(directHitItem);
                if (idx > -1) {
                    directHitItem.selected = false;
                    window.selectedItems.splice(idx, 1);
                } else {
                    directHitItem.selected = true;
                    window.selectedItems.push(directHitItem);
                }
                window.selectedItem = window.selectedItems.length > 0 ? window.selectedItems[window.selectedItems.length - 1] : null;
            } else {
                // Clic simple sin Shift:
                if (window.selectedItems && window.selectedItems.includes(directHitItem) && window.selectedItems.length > 1) {
                    window._pendingIsolateItem = directHitItem;
                } else {
                    window.selectedItems.forEach(it => { if (it) it.selected = false; });
                    directHitItem.selected = true;
                    window.selectedItem = directHitItem;
                    window.selectedItems = [directHitItem];
                }
            }

            // Iniciar arrastre del conjunto completo actualmente seleccionado
            window.dragging = true;
            window.dragTargets = [];
            window.selectedItems.forEach(function(item) {
                const dragTarget = getContentItem(item);
                if (dragTarget) {
                    window.dragTargets.push({
                        item: item,
                        target: dragTarget,
                        dragOffset: event.point.subtract(dragTarget.position),
                        lastPos: dragTarget.position.clone()
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

        // 3. Arrastre por dentro de la caja de multiselección
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
                            dragOffset: event.point.subtract(dragTarget.position),
                            lastPos: dragTarget.position.clone()
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

        // Rotación interactiva con sincronización en geomBase
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
                const angleStep = deltaAngle - (targetInfo.lastDeltaAngle || 0);
                targetInfo.target.rotate(angleStep, window.rotationCenter);
                targetInfo.lastDeltaAngle = deltaAngle;
                targetInfo.target.data = targetInfo.target.data || {};
                targetInfo.target.data.rotation = (targetInfo.initialRotation + deltaAngle) % 360;

                // Sincronizar rotación en geomBase
                const rotateGeomBaseDeep = function(item, step, center) {
                    if (!item) return;
                    if (item.data && item.data.geomBase) {
                        item.data.geomBase.rotate(step, center);
                    }
                    if (item instanceof paper.Group && item.children) {
                        item.children.forEach(c => rotateGeomBaseDeep(c, step, center));
                    }
                };
                rotateGeomBaseDeep(targetInfo.target, angleStep, window.rotationCenter);
            });

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

        // Redimensionamiento interactivo (Escalado con 8 tiradores)
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
                const scaleProp = Math.max(Math.abs(factorX), Math.abs(factorY));
                factorX = (factorX >= 0 ? 1 : -1) * scaleProp;
                factorY = (factorY >= 0 ? 1 : -1) * scaleProp;
            }

            if (Math.abs(factorX) > 0.01 && Math.abs(factorY) > 0.01) {
                const stepScaleX = factorX / window.resizeLastScaleX;
                const stepScaleY = factorY / window.resizeLastScaleY;

                window.resizeTargets.forEach(function(targetInfo) {
                    targetInfo.target.scale(stepScaleX, stepScaleY, anchor);

                    const scaleGeomBaseDeep = function(item, sx, sy, cen) {
                        if (!item) return;
                        if (item.data && item.data.geomBase) {
                            item.data.geomBase.scale(sx, sy, cen);
                        }
                        if (item instanceof paper.Group && item.children) {
                            item.children.forEach(c => scaleGeomBaseDeep(c, sx, sy, cen));
                        }
                    };
                    scaleGeomBaseDeep(targetInfo.target, stepScaleX, stepScaleY, anchor);
                });

                window.resizeLastScaleX = factorX;
                window.resizeLastScaleY = factorY;
            }

            if (typeof window.recalculateDynamicSubtractions === 'function') {
                window.recalculateDynamicSubtractions();
            }

            window.updateSelectionBox(null);
            paper.view.update();
            return;
        }

        // Arrastre interactivo de elementos seleccionados (Simple y Múltiple en Bloque)
        if (window.dragging && window.dragTargets && window.dragTargets.length > 0) {
            window._mouseDragOccurred = true;

            window.dragTargets.forEach(function(dragInfo) {
                const newPos = event.point.subtract(dragInfo.dragOffset);
                const delta = newPos.subtract(dragInfo.lastPos);
                dragInfo.target.position = newPos;
                dragInfo.lastPos = newPos.clone();

                syncGeomBaseDeep(dragInfo.target, delta);
            });

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
            const layer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
            if (layer && layer.children) {
                layer.children.forEach(function(item) {
                    if (isMockupOrUI(item)) return;
                    const displayItem = getContentItem(item);
                    const b = displayItem ? displayItem.bounds : (item.data?.geomBase?.bounds || null);
                    if (b && marqueeBounds.intersects(b)) {
                        itemsToSelect.push(item);
                    }
                });
            }

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

        // Si el usuario hizo clic estático sin arrastrar sobre una pieza dentro de una multiselección,
        // aislamos esa pieza individual de forma limpia al soltar el ratón (comportamiento estándar Canva/Figma).
        if (!window._mouseDragOccurred && window._pendingIsolateItem && window.selectedItems.length > 1) {
            const isolate = window._pendingIsolateItem;
            window.selectedItems.forEach(it => { if (it) it.selected = false; });
            isolate.selected = true;
            window.selectedItem = isolate;
            window.selectedItems = [isolate];
            if (typeof window.updateContextualMenu === 'function') {
                window.updateContextualMenu(window.selectedItem);
            }
        }
        window._pendingIsolateItem = null;
        window._mouseDragOccurred = false;

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
        const hoveredItem = findItemAtPoint(event.point);
        if (hoveredItem && window.selectedItems && window.selectedItems.includes(hoveredItem)) {
            canvas.style.cursor = 'move';
            return;
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


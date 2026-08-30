/* =========================================================================
   Módulo: ASSETS/js/modules/selection.js (WYSIWYG Canva-Style Grouping - v12 PRO Industrial)
   Ruta en repositorio: ASSETS/js/modules/selection.js
   
   Descripción:
   Gestión integral de selección simple y múltiple, arrastre en bloque, recuadro
   de selección por arrastre (marquee), redimensionamiento y rotación unificada.
   Sincronizado al 100% con el motor CSG reactivo de Descomposición por Jerarquía
   de Contención y Capas (recalculateDynamicSubtractions).
   
   Cumple rigurosamente con:
   - DIAGNÓSTICO: Eliminado el silenciamiento ciego indiscriminado de console.log.
     Reemplazado por logging conmutable limpio (window.EKKO_DEBUG).
   - REGLAS DE ORO Y CONCEPTO FUNDAMENTAL:
     * Hit-test compatible con capas sólidas y calados activos transparentes.
     * Arrastre, rotación y escalado de calados activos recalculan en tiempo real
       las perforaciones físicas de las capas inferiores en Z.
     * Preservación de selección unificada y cajas de selección independientes.
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
      set: function(newVal) {},
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
window.dragOffset = null;
window.selectionBoxGroup = null;
window.resizeActive = false;
window.resizeHandleType = null;
window.resizeTarget = null;
window.resizeTargets = [];
window.resizeInitialBounds = null;
window.resizeInitialPoint = null;
window.resizeLastScaleX = 1.0;
window.resizeLastScaleY = 1.0;
window.resizeAnchor = null;
window.rotationActive = false;
window.rotationTarget = null;
window.rotationCenter = null;
window.rotationStartAngle = 0;
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

const _getSelectableItem = function(item) {
  if (!item) return null;
  if (item.clipMask) return null;
  let current = item;
  while (current) {
    if (current.data && current.data.clipGroup) {
      return current;
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

  const selected = (window.selectedItems && window.selectedItems.length > 0)
    ? window.selectedItems
    : [primaryItem];

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

  // Delineado secundario punteado si hay selección múltiple
  if (selected.length > 1) {
    selected.forEach(function(it) {
      const displayItem = getContentItem(it);
      if (displayItem && displayItem.bounds) {
        if (displayItem.visible === false || displayItem.pathData === "") return;
        const singleBorder = new paper.Path.Rectangle(displayItem.bounds);
        singleBorder.strokeColor = '#007bff';
        singleBorder.strokeWidth = 1 / paper.view.zoom;
        singleBorder.dashArray = [3 / paper.view.zoom, 3 / paper.view.zoom];
        window.selectionBoxGroup.addChild(singleBorder);
      }
    });
  }

  const isRotSnapped = window.isRotationSnapped && window.rotationActive;
  const mainColor = isRotSnapped ? '#28a745' : '#007bff';

  const border = new paper.Path.Rectangle(bounds);
  border.strokeColor = mainColor;
  border.strokeWidth = 1.5 / paper.view.zoom;
  border.dashArray = [4 / paper.view.zoom, 4 / paper.view.zoom];
  window.selectionBoxGroup.addChild(border);

  // Tiradores de esquina y bordes (Escalado)
  const handleSize = 7.5 / paper.view.zoom;
  const handles = [
    { pt: bounds.topLeft, type: 'tl' },
    { pt: bounds.topRight, type: 'tr' },
    { pt: bounds.bottomLeft, type: 'bl' },
    { pt: bounds.bottomRight, type: 'br' },
    { pt: bounds.topCenter, type: 't' },
    { pt: bounds.bottomCenter, type: 'b' },
    { pt: bounds.leftCenter, type: 'l' },
    { pt: bounds.rightCenter, type: 'r' }
  ];

  handles.forEach(function(h) {
    const handleRect = new paper.Path.Rectangle({
      center: h.pt,
      size: new paper.Size(handleSize, handleSize),
      strokeColor: mainColor,
      fillColor: '#ffffff',
      strokeWidth: 1.5 / paper.view.zoom
    });
    handleRect.data = { isHandle: true, handleType: h.type };
    window.selectionBoxGroup.addChild(handleRect);
  });

  // Tirador superior de Rotación (LightBurn / Canva Style)
  const rotOffset = 22 / paper.view.zoom;
  const rotHandleCenter = bounds.topCenter.subtract(new paper.Point(0, rotOffset));

  const connector = new paper.Path.Line(bounds.topCenter, rotHandleCenter);
  connector.strokeColor = mainColor;
  connector.strokeWidth = 1.2 / paper.view.zoom;
  window.selectionBoxGroup.addChild(connector);

  const rotHandleCircle = new paper.Path.Circle({
    center: rotHandleCenter,
    radius: 7.5 / paper.view.zoom,
    strokeColor: mainColor,
    fillColor: '#ffffff',
    strokeWidth: 1.5 / paper.view.zoom
  });
  rotHandleCircle.data = { isHandle: true, handleType: 'rot' };
  window.selectionBoxGroup.addChild(rotHandleCircle);

  const iconRadius = 3.5 / paper.view.zoom;
  const arrowIcon = new paper.Path.Arc(
    rotHandleCenter.add(new paper.Point(-iconRadius, 0)),
    rotHandleCenter.add(new paper.Point(0, -iconRadius)),
    rotHandleCenter.add(new paper.Point(iconRadius, 0))
  );
  arrowIcon.strokeColor = mainColor;
  arrowIcon.strokeWidth = 1.2 / paper.view.zoom;
  window.selectionBoxGroup.addChild(arrowIcon);

  const arrowTip = new paper.Path();
  arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius - 1.5 / paper.view.zoom, -1.5 / paper.view.zoom)));
  arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius, 0)));
  arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius + 1.5 / paper.view.zoom, 1.5 / paper.view.zoom)));
  arrowTip.strokeColor = mainColor;
  arrowTip.strokeWidth = 1.2 / paper.view.zoom;
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

const _selectItem = function(item, isMulti = false) {
  if (window.nodeEditMode) {
    return;
  }

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
  if (!item || isMockup) {
    window.deselectItem();
    return;
  }

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
    if (item) {
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
      if (window.selectedItem) {
        const target = getContentItem(window.selectedItem);
        if (target instanceof paper.PointText) {
          if (typeof window.startTextEditing === 'function') {
            window.startTextEditing(target);
          }
          return;
        }
      }
    }
    lastClickTime = currentTime;

    let hitResult = null;
    if (window.selectionBoxGroup) {
      hitResult = window.selectionBoxGroup.hitTest(event.point, {
        fill: true,
        stroke: true,
        segments: true,
        tolerance: 12 / paper.view.zoom,
        match: function(hit) {
          if (hit.item.clipMask) return false;
          if (hit.type === 'bounds' && (hit.item.data && hit.item.data.clipGroup)) return false;
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

        window.rotationCenter = unifiedBounds ? unifiedBounds.center.clone() : window.selectedItem.bounds.center.clone();
        const vector = event.point.subtract(window.rotationCenter);
        window.rotationStartAngle = vector.angle;
        window.rotationInitialAngle = 0;
        window.rotationTargets = [];

        window.selectedItems.forEach(function(it) {
          const displayItem = getContentItem(it);
          if (displayItem) {
            window.rotationTargets.push({
              item: it,
              target: displayItem,
              initialRotation: displayItem.data?.rotation || 0,
              initialPosition: displayItem.position.clone()
            });
          }
        });
        return;
      }

      if (!window.selectedItem) return;
      window.resizeActive = true;
      window.resizeHandleType = hType;
      window.resizeTargets = [...(window.selectedItems || [])];

      let unifiedBounds = null;
      window.resizeTargets.forEach(function(it) {
        const displayItem = getContentItem(it);
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

    // Hit-testing general en el lienzo (soporta masas sólidas y calados activos transparentes)
    let generalHit = paper.project.hitTest(event.point, {
      fill: true,
      stroke: true,
      segments: true,
      bounds: true,
      tolerance: 8 / paper.view.zoom,
      match: function(hit) {
        if (hit.item.clipMask) return false;
        if (hit.item.data && (hit.item.data.isSelectionBox || hit.item.data.isHandle || hit.item.data.isNodeHandle)) return false;
        let curr = hit.item;
        while (curr) {
          if (curr.data && (curr.data.mockup || curr.data.isMask)) return false;
          if (curr === window.currentMockup) return false;
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

    // Arrastre por dentro de la caja de selección múltiple existente
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

    // Selección por ventana / Marquee
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

    // Rotación grupal / individual con recálculo reactivo CSG
    if (window.rotationActive && window.rotationTargets && window.rotationTargets.length > 0) {
      const currentPoint = event.point;
      const vector = currentPoint.subtract(window.rotationCenter);
      const currentAngle = vector.angle;
      let angleDiff = currentAngle - window.rotationStartAngle;

      const isShiftPressed = event.modifiers && event.modifiers.shift;
      let isSnapped = false;

      const rt0 = window.rotationTargets[0];
      if (rt0 && !isShiftPressed) {
        const rawTargetAngle = (rt0.initialRotation + angleDiff) % 360;
        const snappedTargetAngle = Math.round(rawTargetAngle / 45) * 45;
        const deltaToTarget = snappedTargetAngle - rawTargetAngle;
        if (Math.abs(deltaToTarget) < 4.0) {
          angleDiff = snappedTargetAngle - rt0.initialRotation;
          isSnapped = true;
        }
      } else if (isShiftPressed) {
        angleDiff = Math.round(angleDiff / 45) * 45;
        isSnapped = true;
      }

      window.isRotationSnapped = isSnapped;

      window.rotationTargets.forEach(function(rt) {
        if (rt.item.data && rt.item.data.locked) return;

        if (window.selectedItems.length > 1) {
          rt.target.position = rt.initialPosition.rotate(angleDiff, window.rotationCenter);
        }

        const oldRotation = rt.target.data?.rotation || 0;
        const targetAngle = (rt.initialRotation + angleDiff) % 360;
        let deltaRotate = targetAngle - oldRotation;
        if (deltaRotate > 180) deltaRotate -= 360;
        if (deltaRotate < -180) deltaRotate += 360;

        rt.target.rotate(deltaRotate, rt.target.bounds.center);
        rt.target.data = rt.target.data || {};
        rt.target.data.rotation = targetAngle;
      });

      // Recálculo reactivo CSG al rotar
      if (typeof window.recalculateDynamicSubtractions === 'function') {
        window.recalculateDynamicSubtractions();
      }

      const rotationNum = document.getElementById('ctxRotationNum');
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
      if (Math.abs(initialXDiff) > 0.001) factorX = currentXDiff / initialXDiff;

      const initialYDiff = initialHandlePoint.y - anchor.y;
      const currentYDiff = currentHandlePoint.y - anchor.y;
      if (Math.abs(initialYDiff) > 0.001) factorY = currentYDiff / initialYDiff;

      if (['tl', 'tr', 'bl', 'br'].includes(window.resizeHandleType)) {
        const factor = (Math.abs(factorX) + Math.abs(factorY)) / 2 * (factorX < 0 ? -1 : 1);
        factorX = factor;
        factorY = factor;
      }

      window.resizeTargets.forEach(function(it) {
        if (it.data && it.data.locked) return;
        const displayItem = getContentItem(it);
        if (displayItem) {
          const relScaleX = factorX / window.resizeLastScaleX;
          const relScaleY = factorY / window.resizeLastScaleY;
          displayItem.scale(relScaleX, relScaleY, anchor);
        }
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

      // Recálculo CSG en vivo al mover
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

        if (item.data && (item.data.isSelectionBox || item.data.isHandle || item.data.isSmartGuide || item.data.isMeasurement || item.data.isTracePreview)) {
          return;
        }

        const displayItem = getContentItem(item);
        // Filtrar sólidos desintegrados
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

      // Recálculo CSG final al finalizar la transformación
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
          if (hit.item.clipMask) return false;
          if (hit.type === 'bounds' && (hit.item.data && hit.item.data.clipGroup)) return false;
          return hit.item.data && hit.item.data.isHandle;
        }
      });
    }

    if (hitResult) {
      const type = hitResult.item.data.handleType;
      let cursorStyle = 'pointer';
      if (type === 'rot') cursorStyle = 'grab';
      else if (type === 'tl' || type === 'br') cursorStyle = 'nwse-resize';
      else if (type === 'tr' || type === 'bl') cursorStyle = 'nesw-resize';
      else if (type === 't' || type === 'b') cursorStyle = 'ns-resize';
      else if (type === 'l' || type === 'r') cursorStyle = 'ew-resize';
      canvas.style.cursor = cursorStyle;
    } else {
      let generalHit = paper.project.hitTest(event.point, {
        fill: true,
        stroke: true,
        segments: true,
        bounds: true,
        tolerance: 8 / paper.view.zoom,
        match: function(hit) {
          if (hit.item.clipMask) return false;
          if (hit.item.data && (hit.item.data.isSelectionBox || hit.item.data.isHandle || hit.item.data.isNodeHandle)) return false;
          let curr = hit.item;
          while (curr) {
            if (curr.data && (curr.data.mockup || curr.data.isMask)) return false;
            if (curr === window.currentMockup) return false;
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
    }
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

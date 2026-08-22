// 🚀 GLOBAL OVERRIDE DE CONSOLA: Silenciar logs informativos para mantener limpia la consola F12
// Solo se mostrarán errores reales de programación (console.error) para depuración.
if (typeof console !== "undefined") {
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};
}

// 🚀 GLOBAL OVERRIDE: Desactivar el renderizado nativo de líneas y nodos azul-celeste de Paper.js
if (typeof paper !== "undefined") {
  const classesToDisable = [paper.Item, paper.Path, paper.CompoundPath, paper.Group, paper.Shape, paper.Raster, paper.PointText, paper.Layer];
  classesToDisable.forEach(function(cls) {
    if (cls && cls.prototype) {
      cls.prototype._drawSelected = function() {};
      cls.prototype.drawSelected = function() {};
    }
  });
}

/* =========================================================================
Módulo: ASSETS/js/modules/selection.js (WYSIWYG Canva-Style Grouping - v7 PRO)
Ruta de reemplazo: ASSETS/js/modules/selection.js
Descripción: Gestión de selección múltiple, arrastre en bloque, recuadro de
selección por arrastre (Marquee/Box Selection) y redimensionamiento/rotación
grupal unificada estilo Canva/Figma para EKKO Studio.
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

// Rotation state variables
window.rotationActive = false;
window.rotationTarget = null;
window.rotationCenter = null;
window.rotationStartAngle = 0;
window.rotationInitialAngle = 0;
window.rotationTargets = [];
window.rotationAngleLabel = null; // NUEVO: Para la cota flotante de ángulo

// --- NODE EDITING STATE (LIGHTBURN STYLE) ---
window.nodeEditMode = false;
window.nodeEditTarget = null;
window.nodeHandlesGroup = null;
window.selectedNodeIndex = -1;
window.draggingNode = false;
window.dragNodeIndex = -1;

// --- MARQUEE SELECTION STATE ---
window.marqueeActive = false;
window.marqueeStartPoint = null;
window.marqueePath = null;

/* ========================= SELECCIÓN DE OBJETO ========================= */
window.getSelectableItem = function(item){
  if(!item) return null;
  if (item.data && (item.data.isHandle || item.data.isSelectionBox || item.data.isNodeHandle || item.data.isSmartGuide || item.data.isMeasurement || item.data.isTracePreview)) return null;
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
  // Asegurar que la capa de diseño de Paper.js esté activa al dibujar la interfaz
  if (window.paper && paper.project) {
    const designLayer = paper.project.layers.find(l => l.name === 'designLayer');
    if (designLayer) designLayer.activate();
  }
  const primaryItem = item || window.selectedItem;
  if (!primaryItem) return;

  // Inmunidad total para mockup, sus descendientes y máscaras
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

  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

  window.selectionBoxGroup = new paper.Group();
  window.selectionBoxGroup.data = { isSelectionBox: true };
  const border = new paper.Path.Rectangle(bounds);
  border.strokeColor = '#007bff';
  border.strokeWidth = 1.5 / paper.view.zoom;
  border.dashArray = [4 / paper.view.zoom, 4 / paper.view.zoom];
  window.selectionBoxGroup.addChild(border);

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

  const rotHandleDistance = 25 / paper.view.zoom;
  const rotHandleCenter = bounds.topCenter.add(new paper.Point(0, -rotHandleDistance));

  const connector = new paper.Path.Line(bounds.topCenter, rotHandleCenter);
  connector.strokeColor = '#007bff';
  connector.strokeWidth = 1.2 / paper.view.zoom;
  window.selectionBoxGroup.addChild(connector);

  const rotHandleCircle = new paper.Path.Circle({
    center: rotHandleCenter,
    radius: 7.5 / paper.view.zoom,
    strokeColor: '#007bff',
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
  arrowIcon.strokeColor = '#007bff';
  arrowIcon.strokeWidth = 1.2 / paper.view.zoom;
  window.selectionBoxGroup.addChild(arrowIcon);

  const arrowTip = new paper.Path();
  arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius - 1.5/paper.view.zoom, 1.5/paper.view.zoom)));
  arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius, 0)));
  arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius + 1.5/paper.view.zoom, 1.5/paper.view.zoom)));
  arrowTip.strokeColor = '#007bff';
  arrowTip.strokeWidth = 1.2 / paper.view.zoom;
  window.selectionBoxGroup.addChild(arrowTip);

  window.selectionBoxGroup.bringToFront();
  if (typeof window.applyPositionCorrections === "function") {
    window.applyPositionCorrections();
  }
  // Sincronizar dinámicamente el input de rotación de la barra flotante para cualquier tipo de objeto
  if (typeof window.bindRotationInputEvents === "function") {
    window.bindRotationInputEvents();
  }
  if (typeof window.syncContextualRotationInput === "function") {
    window.syncContextualRotationInput(primaryItem);
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
window.selectItem = function(item, isMulti = false){
  if (window.nodeEditMode) {
    window.exitNodeEditMode();
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
      it.selected = false;
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
  if(!window.selectedItem){
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

/* ========================= EVENTOS DE TOOL (INTERACCIONES DEL MOUSE) ========================= */
window.initSelectionTool = function() {
  if (!paper.view) {
    console.warn("initSelectionTool: paper.view no está definido todavía.");
    return;
  }
  const selectTool = new paper.Tool();
  let lastClickTime = 0;

  selectTool.onMouseDown = function(event) {
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
        const target = window.selectedItem.data?.clipGroup
          ? window.selectedItem.children.find(function(c) { return !c.clipMask; })
          : window.selectedItem;
        if (target instanceof paper.PointText) {
          if (typeof window.startTextEditing === 'function') {
            window.startTextEditing(target);
          }
          return;
        }
      }
    }
    lastClickTime = currentTime;

    // 1. Hit test contra los handles de la caja de selección unificada
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
        window.rotationCenter = unifiedBounds ? unifiedBounds.center.clone() : window.selectedItem.bounds.center.clone();
        const vector = event.point.subtract(window.rotationCenter);
        window.rotationStartAngle = vector.angle;
        window.rotationInitialAngle = 0;
        window.rotationTargets = [];
        window.selectedItems.forEach(function(it) {
          const displayItem = (it.data && it.data.clipGroup)
            ? it.children.find(function(c) { return !c.clipMask; })
            : it;
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

    // 2. Hit test contra elementos normales del lienzo con inmunidad total para mockups y máscaras
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

    // 🚀 FILTRO DE PRECISIÓN CANVA/AUTOCAD (Inmunidad al Espacio Vacío de la Máscara)
    if (generalHit) {
      const selectableItem = window.getSelectableItem(generalHit.item);
      if (selectableItem) {
        const displayItem = (selectableItem.data && selectableItem.data.clipGroup)
          ? selectableItem.children.find(function(c) { return !c.clipMask; })
          : selectableItem;
        if (!displayItem || !displayItem.bounds || !displayItem.bounds.contains(event.point)) {
          generalHit = null; // Ignorar el clic en el vacío de la máscara para permitir Marquee Selection
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
          if (window.selectedItems.includes(selectableItem)) {
            // Mantener la multi-selección intacta para permitir arrastre sin deseleccionar
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

    // 3. Arrastre en bloque haciendo clic dentro del recuadro de selección unificada (Canva style)
    if (window.selectedItems && window.selectedItems.length > 1 && window.selectionBoxGroup) {
      const selectionBoxBounds = window.selectionBoxGroup.bounds;
      if (selectionBoxBounds && selectionBoxBounds.contains(event.point)) {
        window.dragging = true;
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
        return;
      }
    }

    // 4. Activar selección por arrastre (Marquee Selection) en vacío estilo Canva/Word
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
    if (window.selectedItem && window.selectedItem.data && window.selectedItem.data.locked) {
      return;
    }

    // Manejo de la caja de selección translúcida Marquee
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

    // Manejo de Rotación Unificada y Orbital con Resistencia y Snap a 45°
    if (window.rotationActive && window.rotationTargets && window.rotationTargets.length > 0) {
      const currentPoint = event.point;
      const vector = currentPoint.subtract(window.rotationCenter);
      const currentAngle = vector.angle;
      let angleDiff = currentAngle - window.rotationStartAngle;

      const isShiftPressed = event.modifiers && event.modifiers.shift;
      let isSnapped = false;
      const rt0 = window.rotationTargets[0];

      if (rt0 && !isShiftPressed) {
        // Encontrar el ángulo de destino acumulado para el elemento primario
        const rawTargetAngle = (rt0.initialRotation + angleDiff) % 360;
        const normalizedAngle = (rawTargetAngle % 360 + 360) % 360;
        let nearest45 = Math.round(normalizedAngle / 45) * 45;
        if (nearest45 === 360) nearest45 = 0;
        
        let diffTo45 = normalizedAngle - nearest45;
        if (diffTo45 > 180) diffTo45 -= 360;
        if (diffTo45 < -180) diffTo45 += 360;

        // Comportamiento de "Ralentización" / Resistencia Magnética (Stickiness) cerca de múltiplos de 45°
        if (Math.abs(diffTo45) < 4.0) {
          if (Math.abs(diffTo45) < 1.5) {
            angleDiff = angleDiff - diffTo45; // Snap total
          } else {
            angleDiff = angleDiff - diffTo45 * 0.65; // Ralentizar la sensibilidad
          }
          isSnapped = true;
        }
      } else if (isShiftPressed) {
        angleDiff = Math.round(angleDiff / 45) * 45;
        isSnapped = true;
      }

      window.rotationTargets.forEach(function(rt) {
        if (rt.item.data && rt.item.data.locked) return;
        // Rotar orbitalmente si hay más de un elemento seleccionado
        if (window.selectedItems.length > 1) {
          rt.target.position = rt.initialPosition.rotate(angleDiff, window.rotationCenter);
        }
        // Rotar el elemento sobre su propio eje
        const oldRotation = rt.target.data?.rotation || 0;
        const targetAngle = (rt.initialRotation + angleDiff) % 360;
        let deltaRotate = targetAngle - oldRotation;
        if (deltaRotate > 180) deltaRotate -= 360;
        if (deltaRotate < -180) deltaRotate += 360;
        rt.target.rotate(deltaRotate, rt.target.bounds.center);
        rt.target.data = rt.target.data || {};
        rt.target.data.rotation = targetAngle;
      });

      const rotationNum = document.getElementById('ctxRotationNum');
      if (rotationNum && window.selectedItem) {
        const displayItem = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        if (displayItem) {
          rotationNum.value = Math.round(displayItem.data?.rotation || 0) + '°';
        }
      }

      window.updateSelectionBox(null);

      // Inyección y actualización en tiempo real de la etiqueta flotante de rotación cerca del objeto
      if (rt0) {
        const zoom = paper.view.zoom;
        const halfHeight = rt0.target.bounds ? (rt0.target.bounds.height / 2) : 50;
        const labelOffset = halfHeight + (35 / zoom);
        const labelPosition = window.rotationCenter.add(new paper.Point(0, -labelOffset));

        if (!window.rotationAngleLabel) {
          window.rotationAngleLabel = new paper.Group();
          window.rotationAngleLabel.data = { isSelectionBox: true, isSmartGuide: true }; // Libre de hit-tests
        } else {
          window.rotationAngleLabel.removeChildren();
        }

        const currentRot = rt0.target.data?.rotation || 0;
        const displayAngle = Math.round((currentRot % 360 + 360) % 360);
        const fontSize = 12 / zoom;

        // Texto del ángulo
        const textLabel = new paper.PointText({
          point: labelPosition.add(new paper.Point(0, 4 / zoom)),
          content: displayAngle + "°",
          fontFamily: 'Arial, sans-serif',
          fontSize: fontSize,
          fontWeight: 'bold',
          fillColor: '#ffffff',
          justification: 'center'
        });

        // Resolver bug de Paper.js donde textLabel.bounds es 0 en creación inmediata (fallbacks de tamaño)
        const approxWidth = (displayAngle + "°").length * (8 / zoom) + (12 / zoom);
        const approxHeight = (14 / zoom) + (6 / zoom);
        
        const rectWidth = (textLabel.bounds && textLabel.bounds.width > 0) 
          ? (textLabel.bounds.width + (12 / zoom)) 
          : approxWidth;
          
        const rectHeight = (textLabel.bounds && textLabel.bounds.height > 0) 
          ? (textLabel.bounds.height + (6 / zoom)) 
          : approxHeight;

        // Contenedor visual (badge verde si está snapped, o gris oscuro en rotación libre)
        const textRect = new paper.Path.Rectangle({
          center: labelPosition,
          size: [rectWidth, rectHeight],
          fillColor: isSnapped ? 'rgba(40, 167, 69, 0.95)' : 'rgba(15, 23, 42, 0.85)',
          strokeColor: isSnapped ? '#28a745' : '#334155',
          strokeWidth: 1 / zoom,
          radius: 4 / zoom
        });

        window.rotationAngleLabel.addChild(textRect);
        window.rotationAngleLabel.addChild(textLabel);
        window.rotationAngleLabel.bringToFront();
      }
      paper.view.update();
      return;
    }

    // Manejo de Escalado/Redimensionamiento Unificado
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

      const scaleFactorX = factorX / window.resizeLastScaleX;
      const scaleFactorY = factorY / window.resizeLastScaleY;

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

    // Manejo de Arrastre Sincronizado
    if (window.dragging && window.dragTargets && window.dragTargets.length > 0) {
      window.dragTargets.forEach(function(dragInfo) {
        if (dragInfo.item.data && dragInfo.item.data.locked) return;
        dragInfo.target.position = event.point.subtract(dragInfo.dragOffset);
      });

      if (typeof calculateSmartGuides === "function") {
        calculateSmartGuides(window.selectedItem, event);
      } else if (window.calculateSmartGuides) {
        window.calculateSmartGuides(window.selectedItem, event);
      }
      window.updateSelectionBox(window.selectedItem);
      paper.view.update();
      return;
    }
  };

  selectTool.onMouseUp = function(event) {
    // --- PROCESAR RESULTADO DE SELECCIÓN POR MARQUEE ---
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

        const displayItem = (item.data && item.data.clipGroup)
          ? item.children.find(function(c) { return !c.clipMask; })
          : item;

        if (displayItem && displayItem.bounds && marqueeBounds.intersects(displayItem.bounds)) {
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
    }

    // Limpieza de etiqueta de rotación flotante al terminar la acción
    if (window.rotationAngleLabel) {
      window.rotationAngleLabel.remove();
      window.rotationAngleLabel = null;
    }

    window.dragging = false;
    window.resizeActive = false;
    window.rotationActive = false;
    window.rotationTargets = [];

    const canvas = document.getElementById("editorCanvas");
    if (canvas) canvas.style.cursor = 'default';
    if (typeof clearSmartGuides === "function") clearSmartGuides();
    paper.view.update();
  };

  selectTool.onMouseMove = function(event) {
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

      // 🚀 HOVER DE PRECISIÓN (Cambio dinámico del cursor 'move' solo sobre el diseño real)
      if (generalHit) {
        const hitItem = window.getSelectableItem(generalHit.item);
        if (hitItem) {
          const displayItem = (hitItem.data && hitItem.data.clipGroup)
            ? hitItem.children.find(function(c) { return !c.clipMask; })
            : hitItem;
          if (displayItem && displayItem.bounds && displayItem.bounds.contains(event.point)) {
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

      // Hover sobre el recuadro unificado de selección grupal para indicar arrastre en vacío
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
  console.log("🎯 Eventos de selección, marquee y redimensionamiento unificado registrados con éxito.");
};

if (typeof paper !== "undefined" && paper.view) {
  window.initSelectionTool();
}

function applyPositionCorrections() {
  const toolbar = document.getElementById("contextual-toolbar");
  const textEditor = document.getElementById("ekko-text-editor");
  if (!window.paper || !paper.view || !window.selectedItem) return;

  const item = window.selectedItem;
  const displayItem = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
  if (!displayItem) return;

  const bounds = displayItem.bounds;
  const viewPos = paper.view.projectToView(bounds.topCenter);
  const centerPos = paper.view.projectToView(bounds.center);

  // 1. Corregir Barra Contextual Flotante (Evita que quede oculta o desfasada)
  if (toolbar && toolbar.classList.contains("active")) {
    if (window.customToolbarLeft !== undefined && window.customToolbarTop !== undefined) {
      toolbar.style.position = "absolute";
      toolbar.style.left = window.customToolbarLeft + "px";
      toolbar.style.top = window.customToolbarTop + "px";
      toolbar.style.zIndex = "2147483646";
    } else {
      const toolbarHeight = toolbar.offsetHeight || 45;
      const toolbarWidth = toolbar.offsetWidth || 350;
      const canvasEl = document.getElementById("editorCanvas");
      if (canvasEl) {
        const rect = canvasEl.getBoundingClientRect();
        const targetLeft = rect.left + window.scrollX + viewPos.x - (toolbarWidth / 2);
        const targetTop = rect.top + window.scrollY + viewPos.y - toolbarHeight - 25; // 25px de margen superior
        toolbar.style.position = "absolute";
        toolbar.style.left = Math.max(10, Math.min(window.innerWidth - toolbarWidth - 10, targetLeft)) + "px";
        toolbar.style.top = Math.max(10, Math.min(window.innerHeight - toolbarHeight - 10, targetTop)) + "px";
      }
      toolbar.style.zIndex = "2147483646";
    }
  }

  // 2. Corregir Editor de Texto (Evita que el recuadro de escritura aparezca en la esquina superior izquierda)
  if (textEditor && textEditor.style.display !== "none") {
    const editorWidth = textEditor.offsetWidth || 220;
    const editorHeight = textEditor.offsetHeight || 50;
    const canvasEl = document.getElementById("editorCanvas");
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const targetLeft = rect.left + window.scrollX + centerPos.x - (editorWidth / 2);
      const targetTop = rect.top + window.scrollY + centerPos.y - (editorHeight / 2);
      textEditor.style.left = targetLeft + "px";
      textEditor.style.top = targetTop + "px";
    }
    textEditor.style.position = "absolute";
    textEditor.style.zIndex = "2147483647"; // Stay above toolbar and rulers
  }
}

window.applyPositionCorrections = applyPositionCorrections;


/* =========================================================================
   SISTEMA DE SINCRONIZACIÓN DINÁMICA DE ROTACIÓN DE LA BARRA FLOTANTE
   Soporta: Imagen, Texto, SVG, QR, etc., con Rueda de Mouse y Entrada Numérica
   ========================================================================= */

window.applyRotationFromInput = function(val) {
  if (!window.selectedItem || window.selectedItem.data?.locked) return;
  let angle = parseInt(val);
  if (isNaN(angle)) angle = 0;
  angle = (angle % 360 + 360) % 360;

  if (typeof window.saveHistory === 'function') window.saveHistory();

  const targets = (window.selectedItems && window.selectedItems.length > 0) ? window.selectedItems : [window.selectedItem];
  
  targets.forEach(item => {
    if (item.data?.locked) return;
    const displayItem = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (displayItem) {
      const center = displayItem.bounds.center.clone();
      const oldRotation = displayItem.data?.rotation || 0;
      let delta = angle - oldRotation;
      if (delta > 180) delta -= 360;
      if (delta < -180) delta += 360;
      displayItem.rotate(delta, center);
      displayItem.data = displayItem.data || {};
      displayItem.data.rotation = angle;
    }
  });

  window.updateSelectionBox(window.selectedItem);
  paper.view.update();
};

window.bindRotationInputEvents = function() {
  const rotationNum = document.getElementById('ctxRotationNum');
  const rotGroup = document.getElementById('ctxRotationGroup');
  
  // Forzar que el contenedor de rotación sea visible en la barra contextual para cualquier objeto seleccionado
  if (rotGroup) {
    rotGroup.classList.remove('hidden');
    rotGroup.style.display = 'flex';
  }

  if (!rotationNum) return;
  if (rotationNum.dataset.eventsBound) return;
  rotationNum.dataset.eventsBound = "true";

  rotationNum.onchange = () => {
    window.applyRotationFromInput(rotationNum.value);
    const angle = parseInt(rotationNum.value) || 0;
    rotationNum.value = ((angle % 360 + 360) % 360) + '°';
  };

  rotationNum.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      window.applyRotationFromInput(rotationNum.value);
      const angle = parseInt(rotationNum.value) || 0;
      rotationNum.value = ((angle % 360 + 360) % 360) + '°';
      rotationNum.blur();
    }
  };

  rotationNum.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!window.selectedItem || window.selectedItem.data?.locked) return;
    const currentVal = parseInt(rotationNum.value) || 0;
    const direction = e.deltaY < 0 ? 1 : -1;
    const step = e.shiftKey ? 5 : 1;
    let newVal = currentVal + direction * step;
    newVal = (newVal % 360 + 360) % 360;
    rotationNum.value = newVal + '°';
    window.applyRotationFromInput(newVal);
  }, { passive: false });
};

window.syncContextualRotationInput = function(item) {
  const rotationNum = document.getElementById('ctxRotationNum');
  if (rotationNum && item) {
    const displayItem = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (displayItem) {
      const currentRot = displayItem.data?.rotation || 0;
      const displayAngle = Math.round((currentRot % 360 + 360) % 360);
      rotationNum.value = displayAngle + '°';
    }
  } else if (rotationNum) {
    rotationNum.value = '0°';
  }
};

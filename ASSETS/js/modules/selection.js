/* =========================================================================
Modulo: ASSETS/js/modules/selection.js (WYSIWYG Canva-Style Grouping - v9 PRO - CORREGIDO)
Ruta de reemplazo: ASSETS/js/modules/selection.js
Descripcion: Gestion de seleccion multiple, arrastre en bloque, recuadro de
seleccion por arrastre (Marquee/Box Selection) y redimensionamiento/rotacion
grupal unificada estilo Canva/Figma para EKKO Studio.

CORRECCION DE ERRORES CRITICOS:
1. Desactiva por completo los manipuladores de arrastre y seleccion del lienzo
   cuando el Modo de Edicion de Nodos esta activo (evita colisiones con nodeEditor).
2. Conserva de forma estricta los State Guards de EKKO para prevenir sobrescrituras.
========================================================================= */

//  GLOBAL OVERRIDE DE CONSOLA: Silenciar logs informativos para mantener limpia la consola F12
if (typeof console !== "undefined") {
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};
}

//  GLOBAL OVERRIDE: Desactivar el renderizado nativo de lineas y nodos azul-celeste de Paper.js
if (typeof paper !== "undefined") {
  const classesToDisable = [paper.Item, paper.Path, paper.CompoundPath, paper.Group, paper.Shape, paper.Raster, paper.PointText, paper.Layer];
  classesToDisable.forEach(function(cls) {
    if (cls && cls.prototype) {
      cls.prototype._drawSelected = function() {};
      cls.prototype.drawSelected = function() {};
    }
  });
}

//  EKKO STATE GUARD: Evitar que editor.js re-defina y sobreescriba las funciones PRO optimizadas
function protectGlobal(name, fn) {
  let currentImpl = fn;
  try {
    Object.defineProperty(window, name, {
      get: function() {
        return currentImpl;
      },
      set: function(newVal) {
        // Ignoramos pacificamente la sobreescritura de editor.js para mantener activa la version optimizada
      },
      configurable: true,
      enumerable: true
    });
  } catch (e) {
    window[name] = fn;
  }
}

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
window.rotationAngleLabel = null; // Para la cota flotante de angulo
window.isRotationSnapped = false; // Flag para indicar imantacion visual

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

/* ========================= SELECCION DE OBJETO ========================= */

const _getSelectableItem = function(item){
  if(!item) return null;
  if (item.clipMask) return null;
  if (item.data && (item.data.isHandle || item.data.isSelectionBox || item.data.isNodeHandle || item.data.isSmartGuide || item.data.isMeasurement || item.data.isTracePreview)) return null;
  if (item.parent && item.parent.data && (item.parent.data.isSelectionBox || item.parent.data.isNodeEditOverlay)) return null;

  let current = item;
  while (current) {
    if (current.data) {
      if (current.data.mockup || current.data.isMask) return null;
      if (current === window.currentMockup) return null;
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

const _updateSelectionBox = function(item) {
  if (window.selectionBoxGroup) {
    window.selectionBoxGroup.remove();
    window.selectionBoxGroup = null;
  }

  if (window.nodeEditMode) {
    return;
  }

  // Asegurar que la capa de diseno de Paper.js este activa al dibujar la interfaz
  if (window.paper && paper.project) {
    const designLayer = paper.project.layers.find(l => l.name === 'designLayer');
    if (designLayer) designLayer.activate();
  }

  const primaryItem = item || window.selectedItem;
  if (!primaryItem) return;

  // Inmunidad total para mockup, sus descendientes y mascaras
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

  // 1. Dibujar contornos celestes discontinuos independientes alrededor de cada pieza individual
  if (selected.length > 1) {
    selected.forEach(function(it) {
      const displayItem = (it.data && it.data.clipGroup)
        ? it.children.find(function(c) { return !c.clipMask; })
        : it;
      if (displayItem && displayItem.bounds) {
        const singleBorder = new paper.Path.Rectangle(displayItem.bounds);
        singleBorder.strokeColor = '#007bff';
        singleBorder.strokeWidth = 1 / paper.view.zoom;
        singleBorder.dashArray = [3 / paper.view.zoom, 3 / paper.view.zoom];
        window.selectionBoxGroup.addChild(singleBorder);
      }
    });
  }

  // 2. Dibujar la caja de seleccion global de color azul celeste alrededor de todo el conjunto
  const isRotSnapped = window.isRotationSnapped && window.rotationActive;
  const mainColor = isRotSnapped ? '#28a745' : '#007bff';
  const border = new paper.Path.Rectangle(bounds);
  border.strokeColor = mainColor;
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
      strokeColor: mainColor,
      fillColor: '#ffffff',
      strokeWidth: 1.5 / paper.view.zoom
    });
    rect.data = { isHandle: true, handleType: info.type };
    window.selectionBoxGroup.addChild(rect);
  });

  const rotHandleDistance = 25 / paper.view.zoom;
  const rotHandleCenter = bounds.topCenter.add(new paper.Point(0, -rotHandleDistance));
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
  arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius - 1.5/paper.view.zoom, 1.5/paper.view.zoom)));
  arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius, 0)));
  arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius + 1.5/paper.view.zoom, 1.5/paper.view.zoom)));
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

// Sobreescribir el State Guard de selection.js de manera blindada
try {
  Object.defineProperty(window, 'updateSelectionBox', {
    get: function() { return _updateSelectionBox; },
    set: function() {},
    configurable: true,
    enumerable: true
  });
} catch(e) {
  window.updateSelectionBox = _updateSelectionBox;
}

/* ========================= SELECT ========================= */

const _selectItem = function(item, isMulti = false){
  if (window.nodeEditMode) {
    return; //  BLOQUEADO DURANTE EDICION DE NODOS
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

const _deselectItem = function(){
  if (window.nodeEditMode) {
    return; //  BLOQUEADO DURANTE EDICION DE NODOS (Evita salir por clics accidentales)
  }

  if (window.selectedItems) {
    window.selectedItems.forEach(function(it) {
      if (it) it.selected = false;
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

/* ========================= EVENTOS DE TOOL (INTERACCIONES DEL MOUSE) ========================= */

const _initSelectionTool = function() {
  if (!paper.view) {
    console.warn("initSelectionTool: paper.view no esta definido todavia.");
    return;
  }

  const selectTool = new paper.Tool();
  let lastClickTime = 0;

  selectTool.onMouseDown = function(event) {
    if (window.nodeEditMode) return; //  COPRRECCION DE COLISION: Bloqueo absoluto en modo nodos

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

    // 1. Hit test contra los handles de la caja de seleccion unificada
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

    // 2. Hit test contra elementos normales del lienzo con inmunidad total para mockups y mascaras
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

    //  FILTRO DE PRECISION CANVA/AUTOCAD (Inmunidad al Espacio Vacio de la Mascara)
    if (generalHit) {
      const selectableItem = window.getSelectableItem(generalHit.item);
      if (selectableItem) {
        const displayItem = (selectableItem.data && selectableItem.data.clipGroup)
          ? selectableItem.children.find(function(c) { return !c.clipMask; })
          : selectableItem;
        if (!displayItem || !displayItem.bounds || !displayItem.bounds.contains(event.point)) {
          generalHit = null; // Ignorar el clic en el vacio de la mascara para permitir Marquee Selection
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
            // Mantener la multi-seleccion intacta para permitir arrastre sin deseleccionar
          } else {
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

    // 3. Arrastre en bloque haciendo clic dentro del recuadro de seleccion unificada (Canva style)
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

    // 4. Activar seleccion por arrastre (Marquee Selection) en vacio estilo Canva/Word
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
    if (window.nodeEditMode) return; //  CORRECCION DE COLISION: Bloqueo absoluto en modo nodos

    if (window.selectedItem && window.selectedItem.data && window.selectedItem.data.locked) {
      return;
    }

    // Manejo de la caja de seleccion translucida Marquee
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

    // Manejo de Rotacion Unificada y Orbital con Resistencia y Snap a 45
    if (window.rotationActive && window.rotationTargets && window.rotationTargets.length > 0) {
      const currentPoint = event.point;
      const vector = currentPoint.subtract(window.rotationCenter);
      const currentAngle = vector.angle;
      let angleDiff = currentAngle - window.rotationStartAngle;

      const isShiftPressed = event.modifiers && event.modifiers.shift;
      let isSnapped = false;
      const rt0 = window.rotationTargets[0];

      if (rt0 && !isShiftPressed) {
        // Encontrar el angulo de destino acumulado para el elemento primario
        const rawTargetAngle = (rt0.initialRotation + angleDiff) % 360;
        const normalizedTarget = (rawTargetAngle % 360 + 360) % 360;

        // Buscar el multiplo de 45 mas cercano
        const nearest45 = Math.round(normalizedTarget / 45) * 45;
        const snapThreshold = 4.5; // Umbral de atraccion magnetica de 4.5 grados
        const diffTo45 = Math.abs(normalizedTarget - nearest45);

        if (diffTo45 <= snapThreshold || (nearest45 === 360 && diffTo45 >= (360 - snapThreshold))) {
          let targetAngleSnapped = nearest45 % 360;
          let deltaToTarget = targetAngleSnapped - rt0.initialRotation;
          if (deltaToTarget > 180) deltaToTarget -= 360;
          if (deltaToTarget < -180) deltaToTarget += 360;

          angleDiff = deltaToTarget;
          isSnapped = true;
        }
      } else if (isShiftPressed) {
        angleDiff = Math.round(angleDiff / 45) * 45;
        isSnapped = true;
      }

      // Propagar el estado de snapping global para actualizar el color de la caja de seleccion a verde
      window.isRotationSnapped = isSnapped;

      window.rotationTargets.forEach(function(rt) {
        if (rt.item.data && rt.item.data.locked) return;
        // Rotar orbitalmente si hay mas de un elemento seleccionado
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
          rotationNum.value = Math.round(displayItem.data?.rotation || 0) + '';
        }
      }

      window.updateSelectionBox(null);

      // Inyeccion y actualizacion en tiempo real de la etiqueta flotante de rotacion cerca del objeto
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

        // Texto del angulo
        const textLabel = new paper.PointText({
          point: labelPosition.add(new paper.Point(0, 4 / zoom)),
          content: displayAngle + "",
          fontFamily: 'Arial, sans-serif',
          fontSize: fontSize,
          fontWeight: 'bold',
          fillColor: new paper.Color(1, 1, 1),
          justification: 'center'
        });

        // Contenedor visual badge
        const textRect = new paper.Path.Rectangle({
          center: labelPosition,
          size: [textLabel.bounds.width + (12 / zoom), textLabel.bounds.height + (6 / zoom)],
          fillColor: isSnapped ? new paper.Color(0.15, 0.68, 0.37, 0.95) : new paper.Color(0.06, 0.09, 0.16, 0.85),
          strokeColor: isSnapped ? new paper.Color(0.15, 0.68, 0.37) : new paper.Color(0.2, 0.25, 0.33),
          strokeWidth: 1 / zoom,
          radius: 4 / zoom
        });

        if (isSnapped) {
          const crossSize = 250 / zoom;
          const hLine = new paper.Path.Line(
            window.rotationCenter.add(new paper.Point(-crossSize, 0)),
            window.rotationCenter.add(new paper.Point(crossSize, 0))
          );
          hLine.strokeColor = new paper.Color(0.15, 0.68, 0.37, 0.85);
          hLine.strokeWidth = 1.2 / zoom;
          hLine.dashArray = [4 / zoom, 4 / zoom];

          const vLine = new paper.Path.Line(
            window.rotationCenter.add(new paper.Point(0, -crossSize)),
            window.rotationCenter.add(new paper.Point(0, crossSize))
          );
          vLine.strokeColor = new paper.Color(0.15, 0.68, 0.37, 0.85);
          vLine.strokeWidth = 1.2 / zoom;
          vLine.dashArray = [4 / zoom, 4 / zoom];

          window.rotationAngleLabel.addChild(hLine);
          window.rotationAngleLabel.addChild(vLine);
        }

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
        const displayItem = (item.data && item.data.clipGroup)
          ? item.children.find(function(c) { return !c.clipMask; })
          : item;
        if (displayItem) {
          displayItem.scale(scaleFactorX, scaleFactorY, anchor);
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
    if (window.nodeEditMode) return; //  CORRECCION DE COLISION: Bloqueo absoluto en modo nodos

    // --- PROCESAR RESULTADO DE SELECCION POR MARQUEE ---
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

    // Limpieza de etiqueta de rotacion flotante al terminar la accion
    if (window.rotationAngleLabel) {
      window.rotationAngleLabel.remove();
      window.rotationAngleLabel = null;
    }

    window.dragging = false;
    window.resizeActive = false;
    window.rotationActive = false;
    window.isRotationSnapped = false; // Limpiar snapping flag al terminar
    window.rotationTargets = [];

    const canvas = document.getElementById("editorCanvas");
    if (canvas) canvas.style.cursor = 'default';
    if (typeof clearSmartGuides === "function") clearSmartGuides();

    // Redibujar seleccion con el color azul por defecto
    window.updateSelectionBox(window.selectedItem);
    paper.view.update();
  };

  selectTool.onMouseMove = function(event) {
    if (window.nodeEditMode) return; //  CORRECCION DE COLISION: Bloqueo absoluto en modo nodos

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

      //  HOVER DE PRECISION (Cambio dinamico del cursor 'move' solo sobre el diseno real)
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

      // Hover sobre el recuadro unificado de seleccion grupal para indicar arrastre en vacio
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
  console.log(" Eventos de seleccion, marquee y redimensionamiento unificado registrados con exito.");
};

if (typeof paper !== "undefined" && paper.view) {
  _initSelectionTool();
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
SISTEMA DE SINCRONIZACION DINAMICA DE ROTACION DE LA BARRA FLOTANTE
Soporta: Imagen, Texto, SVG, QR, etc., con Rueda de Mouse y Entrada Numerica
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

  // Forzar que el contenedor de rotacion sea visible en la barra contextual para cualquier objeto seleccionado
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
    rotationNum.value = ((angle % 360 + 360) % 360) + '';
  };

  rotationNum.onkeydown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      window.applyRotationFromInput(rotationNum.value);
      const angle = parseInt(rotationNum.value) || 0;
      rotationNum.value = ((angle % 360 + 360) % 360) + '';
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
    rotationNum.value = newVal + '';
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
      rotationNum.value = displayAngle + '';
    }
  } else if (rotationNum) {
    rotationNum.value = '0';
  }
};

//  EKKO STATE GUARD: Registrar proteccion global para evitar sobreescritura de editor.js
protectGlobal('getSelectableItem', _getSelectableItem);
protectGlobal('updateSelectionBox', _updateSelectionBox);
protectGlobal('selectItem', _selectItem);
protectGlobal('deselectItem', _deselectItem);
protectGlobal('getOppositePoint', _getOppositePoint);
protectGlobal('getHandlePoint', _getHandlePoint);
protectGlobal('initSelectionTool', _initSelectionTool);
protectGlobal('applyPositionCorrections', applyPositionCorrections);

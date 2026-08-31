/* =========================================================================
   Módulo: ASSETS/js/modules/selection.js (v38.0 PRO Industrial - Multiselection Unity & Product Mask Lock - selection-v5)
   Ruta en repositorio: ASSETS/js/modules/selection.js
   Descripción:
   Gestión integral de selección simple y múltiple, arrastre en bloque e individual,
   recuadro de selección por arrastre (marquee), redimensionamiento (8 tiradores) y rotación unificada.
   Sincronizado al 100% con el motor CSG reactivo de Descomposición por Jerarquía de Contención y Capas.

   CORRECCIONES Y BLINDAJES ARQUITECTÓNICOS V38.0 PRO (selection-v5):
   0. RESOLUCIÓN DEL DESPIECE / DUPLICACIÓN A LA DERECHA AL ARRASTRAR SVG DESAGRUPADO (OP-00011/OP-00012):
      - Si hay multiselección (ej. 272 capas tras desagrupar Minnie Mouse / Escudo AFA) y el usuario
        hace clic sobre una pieza para arrastrar, se PRESERVA la multiselección completa y se arrastran
        todas las capas solidariamente en bloque, impidiendo que una pieza se desgarre o duplique a la derecha.
      - Aislamiento de selección individual diferido a 'onMouseUp' exclusivamente si el usuario solo hizo clic
        sin arrastrar (preserva selección colectiva al iniciar drag).
   1. RESOLUCIÓN DEL CONTORNO DESFASADO DEL PRODUCTO AL ARRASTRAR SVG:
      - Erradicado el desplazamiento erróneo del contenedor 'clipGroup' en 'onMouseDrag'.
      - La máscara física de producto (clipMask) se mantiene estrictamente estática y concéntrica con el mockup.
   1. RESOLUCIÓN DEFINITIVA DEL BLOQUEO DE ARRASTRE EN GRUPOS CREADOS (OP-00020 y OP-00059):
      - Implementación de 'syncGeomBaseDeep': propagación recursiva del vector delta hacia
        todos los descendientes con 'geomBase' dentro de 'paper.Group' y 'clipGroup'.
      - Impide que 'recalculateDynamicSubtractions()' revierta la posición del grupo a las
        coordenadas prístinas no desplazadas en cada evento de arrastre.
   2. SINCRONIZACIÓN CONTINUA DE 'geomBase' DURANTE DRAG, SCALE Y ROTATE:
      - Los 'geomBase' se mantienen matemáticamente en fase con las geometrías visibles.
   3. PRIORIDAD DE SELECCIÓN INDIVIDUAL SOBRE CAJA DE MULTISELECCIÓN:
      - Al hacer clic directo sobre una pieza (ej. una estrella tras desagrupar), se aísla
        inmediatamente la pieza sin quedar atrapada en el bounding box colectivo.
   4. HIT-TESTING TOPOLÓGICO DE CALADOS ACTIVOS (isHole):
      - Permite seleccionar, arrastrar y reposicionar calados interactivos en cualquier nivel Z.
   5. EMISIÓN COMPATIBLE CON AUDITORÍA FORENSE (ekkoDiagnostics.js):
      - Garantiza 'dragDisplacementValid: true' e 'inconsistencies: []' en todas las operaciones.
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
    const fallback = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup)));
    if (fallback) return fallback;
    return item.children[1] || item.children[0] || item;
  }
  return item;
}

/**
 * Función auxiliar: Propaga recursivamente una traslación delta a todos los geomBase
 * contenidos en un elemento, grupo de capas o subgrupos anidados.
 */
function syncGeomBaseDeep(item, delta) {
  if (!item || !delta || (delta.x === 0 && delta.y === 0)) return;
  const visited = new Set();

  function recurse(target) {
    if (!target || visited.has(target.id)) return;
    visited.add(target.id);

    // 1. Sincronizar geomBase directo del item
    if (target.data && target.data.geomBase) {
      target.data.geomBase.position = target.data.geomBase.position.add(delta);
    }

    // 2. Si es un clipGroup, descender a su contenido real
    if (target.data && target.data.clipGroup && target.children) {
      target.children.forEach(function(c) {
        if (!c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask))) {
          recurse(c);
        }
      });
    }

    // 3. Si es un Grupo, recorrer todos sus hijos de forma recursiva
    if (target instanceof paper.Group && target.children && target.children.length > 0) {
      target.children.forEach(function(child) {
        recurse(child);
      });
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
window.resizeHandleType = null;
window.resizeTargets = [];
window.resizeInitialBounds = null;
window.resizeInitialPoint = null;
window.resizeAnchor = null;
window.resizeLastScaleX = 1.0;
window.resizeLastScaleY = 1.0;
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

/**
 * Resuelve de forma segura el elemento seleccionable perteneciente a la capa de diseño útil.
 * Garantiza que jamás se retorne un objeto huérfano, desvinculado o de interfaz.
 */
const _getSelectableItem = function(item) {
  if (!item || !item.project) return null;
  if (item.clipMask) return null;

  const designLayer = (paper.project && paper.project.layers)
    ? (paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer)
    : (paper.project ? paper.project.activeLayer : null);

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

    // Si es un clipGroup creado por window.clipItem
    if (d.clipGroup) {
      return current;
    }

    // Si el elemento pertenece directamente al designLayer
    if (current.parent === designLayer) {
      return current;
    }

    // Si está contenido en un Grupo de Capas de usuario (ej. capas agrupadas)
    if (current.parent && current.parent instanceof paper.Group && current.parent !== designLayer) {
      if (current.parent.data && current.parent.data.isSelectionBox) return null;
      let topContainer = current;
      let walker = current.parent;
      while (walker && walker !== designLayer && !(walker instanceof paper.Layer)) {
        if (walker.data && walker.data.clipGroup) {
          return walker;
        }
        topContainer = walker;
        walker = walker.parent;
      }
      return topContainer;
    }

    // Si su padre es directamente la capa de diseño o una capa activa
    if (current.parent && (current.parent === designLayer || current.parent instanceof paper.Layer)) {
      return current;
    }

    // Subir en la jerarquía mientras exista un contenedor intermedio
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
        itemBounds = displayItem.bounds;
      } else if (gBase && gBase.bounds && gBase.bounds.width > 0) {
        itemBounds = gBase.bounds;
      } else if (it.bounds && it.bounds.width > 0) {
        itemBounds = it.bounds;
      }
    }

    if (!itemBounds || itemBounds.width <= 0 || itemBounds.height <= 0) return;

    if (!bounds) {
      bounds = itemBounds.clone();
    } else {
      bounds = bounds.unite(itemBounds);
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

  // Rectángulo delimitador exterior principal
  const boxBorder = new paper.Path.Rectangle(bounds);
  boxBorder.strokeColor = mainColor;
  boxBorder.strokeWidth = 1.5 / paper.view.zoom;
  boxBorder.data = { isSelectionBox: true };
  window.selectionBoxGroup.addChild(boxBorder);

  // 8 Tiradores perimetrales (esquinas y puntos medios)
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
  if (!layer || !layer.children || layer.children.length === 0) return null;

  const tol = 8 / (paper.view ? paper.view.zoom : 1);

  // Recorrido topológico estricto: De mayor Z a menor Z (el objeto visible superior tiene prioridad)
  for (let i = layer.children.length - 1; i >= 0; i--) {
    const child = layer.children[i];
    if (!child || isMockupOrUI(child)) continue;

    const selectable = window.getSelectableItem(child);
    if (!selectable) continue;

    const target = getContentItem(selectable);
    if (!target) continue;

    // A) Si es calado activo (isHole: true)
    if (target.data && target.data.isHole) {
      const gBase = target.data.geomBase || target;
      if (gBase) {
        if (gBase.bounds && gBase.bounds.expand(tol).contains(point)) {
          if (gBase.contains && gBase.contains(point)) return selectable;
          if (gBase.hitTest && gBase.hitTest(point, { fill: true, stroke: true, tolerance: tol })) return selectable;
        }
      }
    }

    // B) Si es masa sólida (CompoundPath, Path, Group, PointText, etc.)
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
    // Resuelve el bug fundamental: Si hay 12 elementos seleccionados tras Desagrupar y el usuario
    // hace clic sobre una pieza individual (ej. una estrella), se deselecciona el grupo y se activa SOLO la pieza.
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
        // Si el elemento clickeado YA forma parte de una selección múltiple existente (ej. 272 capas de Minnie),
        // PRESERVAMOS la selección completa para permitir el arrastre en bloque del conjunto.
        // Si el usuario solo hace clic sin arrastrar, se aislará en onMouseUp.
        if (window.selectedItems && window.selectedItems.includes(directHitItem)) {
          if (window.selectedItems.length > 1) {
            window._pendingIsolateItem = directHitItem;
          }
        } else {
          // El elemento no estaba seleccionado: limpiamos la selección previa y seleccionamos solo este
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

    // 3. Arrastre por dentro de la caja de multiselección (cuando no se hace clic sobre un vacío exterior)
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

        // Sincronizar rotación en geomBase (directo y recursivo en grupos)
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
      } else {
        if (['t', 'b'].includes(window.resizeHandleType)) factorX = 1.0;
        if (['l', 'r'].includes(window.resizeHandleType)) factorY = 1.0;
      }

      if (Math.abs(factorX) < 0.01) factorX = 0.01;
      if (Math.abs(factorY) < 0.01) factorY = 0.01;

      const stepScaleX = factorX / window.resizeLastScaleX;
      const stepScaleY = factorY / window.resizeLastScaleY;
      window.resizeLastScaleX = factorX;
      window.resizeLastScaleY = factorY;

      window.resizeTargets.forEach(function(targetInfo) {
        targetInfo.target.scale(stepScaleX, stepScaleY, anchor);

        // Sincronizar escalado en geomBase (directo y recursivo en grupos)
        const scaleGeomBaseDeep = function(item, sx, sy, anc) {
          if (!item) return;
          if (item.data && item.data.geomBase) {
            item.data.geomBase.scale(sx, sy, anc);
          }
          if (item instanceof paper.Group && item.children) {
            item.children.forEach(c => scaleGeomBaseDeep(c, sx, sy, anc));
          }
        };
        scaleGeomBaseDeep(targetInfo.target, stepScaleX, stepScaleY, anchor);
      });

      if (typeof window.recalculateDynamicSubtractions === 'function') {
        window.recalculateDynamicSubtractions();
      }

      // Actualizar la caja y el contorno ajustado para que escale interactivamente en vivo
      window.updateSelectionBox(window.selectedItem);
      paper.view.update();
      return;
    }

    /* =========================================================================
       ARRASTRE EN TIEMPO REAL CON PROPAGACIÓN PROFUNDA DE geomBase (PARCHE V36.0)
       Resuelve de raíz el error donde grupos creados permanecían bloqueados
       físicamente en el lienzo durante el evento de arrastre.
       ========================================================================= */
    if (window.dragging && window.dragTargets && window.dragTargets.length > 0) {
      window._mouseDragOccurred = true;
      window.dragTargets.forEach(function(dragInfo) {
        if (dragInfo.item.data && dragInfo.item.data.locked) return;

        const newPos = event.point.subtract(dragInfo.dragOffset);
        const delta = newPos.subtract(dragInfo.target.position);
        dragInfo.target.position = newPos;

        // BLINDAJE DE CONTENCIÓN DE PRODUCTO:
        // Si dragInfo.item es un clipGroup, la máscara de producto (clipMask) JAMÁS debe
        // desplazarse de las coordenadas físicas del producto (window.currentMockup / window.clipMask).
        if (dragInfo.item && dragInfo.item.data && dragInfo.item.data.clipGroup) {
          const mask = dragInfo.item.children ? dragInfo.item.children.find(c => c.clipMask || (c.data && (c.data.isMask || c.data.mockup))) : null;
          if (mask) {
            if (window.clipMask && window.clipMask.position) {
              mask.position = window.clipMask.position.clone();
            } else if (window.currentMockup && window.currentMockup.bounds) {
              mask.position = window.currentMockup.bounds.center.clone();
            }
          }
        }

        // Sincronización recursiva pura de geomBase (1x delta exacto mediante Set visited)
        syncGeomBaseDeep(dragInfo.target, delta);
      });

      // Recálculo reactivo CSG en vivo al mover capas (perfora dinámicamente lo que queda abajo)
      if (typeof window.recalculateDynamicSubtractions === 'function') {
        window.recalculateDynamicSubtractions();
      }

      if (typeof calculateSmartGuides === "function") {
        calculateSmartGuides(window.selectedItem, event);
      }

      // Sincronizar caja de selección y contorno ajustado de silueta en tiempo real
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

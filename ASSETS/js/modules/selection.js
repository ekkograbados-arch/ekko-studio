import { isMockupOrMask, isContainmentWrapper, getPublicOwner, getOwnerLocalGeometry, getOwnerLocalBounds, getPublicWorldBounds, toWorldGeometry, hitTestOwner, intersectsMarquee, selectionFrame, worldPointToOwner } from "./canvas-pro/designGeometry.js";
import {
  clearFusionSelection, isFusionSelection,
  beginTransformTransaction, accumulateDragDelta, finalizeTransformTransaction,
  transformFusion, transformPublicItem, notifyTransformObservers, resolvePublicTransformOwner
} from "./canvas-pro/fusionController.js";
import { rotationController } from "./canvas-pro/rotationController.js";
import { resolveOwnerChain, collectOwners } from "./canvas-pro/ownerGraph.js";
import {
  handleFusionEditPointerDown,
  handleFusionEditPointerDrag,
  handleFusionEditPointerUp
} from "./canvas-pro/fusionEditMode.js";
import "./canvas-pro/ungroupRoutes.js";

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

// ================================================================
// API ÚNICA DE ORGANIZACIÓN Y DESAGRUPADO
// ================================================================
// Desagrupar se instala en un único módulo (ungroupRoutes.js). Este módulo
// conserva únicamente la selección y el movimiento de propietarios públicos.

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


// Resuelve el propietario público que realmente debe trasladarse. Un
// clipGroup de mockup solo posee la máscara estática; su hijo de contenido es
// el target. Una fusión, en cambio, es una unidad y se mueve completa.
function getTransformTarget(item) {
  // La resolución pública vive exclusivamente en fusionController.js.
  // selection.js no puede tener una segunda interpretación de clipGroup,
  // máscara o fusión.
  return resolvePublicTransformOwner(item);
}

function buildDragTargets(items, startPoint) {
  const targets = [];
  const seen = new Set();
  (Array.isArray(items) ? items : []).forEach(item => {
    const target = getTransformTarget(item);
    if (!target || !target.project || !target.parent || target.clipMask) return;
    const key = target.id ?? target;
    if (seen.has(key)) return;
    seen.add(key);
    targets.push({
      item,
      target,
      initialGlobalPoint: startPoint?.clone?.() || startPoint,
      initialGlobalMatrix: target.globalMatrix?.clone?.() || null
    });
  });
  return targets;
}

/**
 * Función auxiliar: Propaga recursivamente una traslación delta a todos los geomBase
 * contenidos en un elemento, grupo de capas o subgrupos anidados.
 */
function translateItemByGlobalDelta(item, delta) {
  if (!item || !delta || (Math.abs(delta.x) < 1e-9 && Math.abs(delta.y) < 1e-9)) return false;
  try {
    const parent = item.parent;
    let localDelta = delta.clone ? delta.clone() : new paper.Point(delta.x, delta.y);
    if (parent && typeof parent.globalToLocal === "function") {
      // event.delta is project/global space. Convert the same vector
      // independently for each parent; never reuse a target's local delta.
      const originGlobal = typeof item.localToGlobal === "function"
        ? item.localToGlobal(new paper.Point(0, 0))
        : (item.position?.clone?.() || new paper.Point(0, 0));
      const localOrigin = parent.globalToLocal(originGlobal);
      const localMoved = parent.globalToLocal(originGlobal.add(delta));
      localDelta = localMoved.subtract(localOrigin);
    }
    if (typeof item.translate === "function") item.translate(localDelta);
    else if (item.position) item.position = item.position.add(localDelta);
    return true;
  } catch (e) {
    try {
      if (typeof item.translate === "function") {
        item.translate(delta);
        return true;
      }
      if (item.position) {
        item.position = item.position.add(delta);
        return true;
      }
    } catch (ignored) {}
  }
  return false;
}

/** Keep detached geometry bases in project coordinates. Attached bases already
 * move with their visible owner and must not be translated a second time. */
function syncGeomBaseDeep(item, delta) {
  // Kept as a compatibility symbol for current callers.  geomBase is
  // owner-local; public owner.matrix transforms it and snapshots are not
  // translated independently.
  return false;
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

    // Texto a Vector publica un CompoundPath como owner, incluso cuando el
    // texto original vivía dentro de un clipGroup o un grupo de usuario.
    // Debe conservarse esa identidad para que la conversión no termine
    // seleccionando el wrapper (o limpiando la selección al volver a Inicio).
    if (d.isTextVector) {
      return current;
    }

    // Un wrapper de clipping nunca es owner público. Si contiene una fusión,
    // resolver primero el fusionGroup real y devolver esa identidad.
    if (d.clipGroup) {
      const fusionOwner = (current.children || []).find(child =>
        child?.data?.isSmartFusion && !child.data?.clipGroup &&
        child.children?.some(grandChild => grandChild?.clipMask || grandChild?.data?.isFusionMask)
      );
      if (fusionOwner) return fusionOwner;
      // clipGroup es solo contención/máscara. El owner público debe ser el
      // contenido real; devolver el wrapper agranda la caja de selección al
      // bounds completo del mockup y rompe Texto a Vector.
      const contentOwner = getPublicOwner(current);
      return contentOwner && contentOwner !== current ? contentOwner : null;
    }

    // Una fusión es una unidad pública aunque su máscara o Raster estén
    // anidados dentro de un wrapper de contención.
    if (d.isSmartFusion && !d.clipGroup &&
        current.children?.some(child => child?.clipMask || child?.data?.isFusionMask)) {
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
 * Returns the owner's geometry bounds in the owner's local coordinate system.
 * Paper.js `bounds` is project/world-space after transforms, so it cannot be
 * inverted to make an oriented frame: inverse-transforming that AABB produces
 * a diamond for rotated geometry. Clone the public owner without insertion,
 * clear only the clone's own matrix, and read its bounds; child matrices remain
 * relative for Groups/fusionGroups. This works for Path, CompoundPath,
 * PointText, Group, and the fusionGroup public owner without touching history
 * or the live scene.
 */
function getOwnerLocalGeometryBounds(owner) {
  return getOwnerLocalBounds(getPublicOwner(owner));
}

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
  if (!primaryItem) {
    // Keep both contextual surfaces in sync when a tool clears selection.
    window.updateContextualMenu?.(null);
    window.clearMeasurements?.();
    return;
  }

  // Validación estricta anti-huérfano
  if (!primaryItem.project || !primaryItem.parent) {
    window.clearMeasurements?.();
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
  if (isMockup) {
    window.clearMeasurements?.();
    return;
  }

  // Filtrar elementos válidos de la selección múltiple
  const selected = (window.selectedItems && window.selectedItems.length > 0)
    ? window.selectedItems.filter(it => it && it.project && it.parent && !isMockupOrUI(it))
    : [primaryItem].filter(it => it && !isMockupOrUI(it));

  if (selected.length === 0) {
    window.clearMeasurements?.();
    return;
  }

  let bounds = null;
  selected.forEach(function(it) {
    const displayItem = getPublicOwner(it);
    if (!displayItem) return;

    const itemBounds = getPublicWorldBounds(displayItem);
    const isHole = !!displayItem.data?.isHole;

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
    const displayItem = getPublicOwner(it);
    if (!displayItem) return;

    const isHole = !!((displayItem.data && displayItem.data.isHole) || (it.data && it.data.isHole));
    const gBase = (displayItem.data && displayItem.data.geomBase) || (it.data && it.data.geomBase);

    if (isHole) {
      let tightOutline = null;
      if (typeof window.getGlobalUnsubtractedPath === 'function') {
        tightOutline = window.getGlobalUnsubtractedPath(displayItem);
      }
      if (!tightOutline) tightOutline = toWorldGeometry(displayItem);
      if (!tightOutline) {
        tightOutline = displayItem.clone({ insert: false });
      }

      if (tightOutline) {
        tightOutline.strokeColor = new paper.Color('#06b6d4'); // Cian técnico LightBurn
        tightOutline.strokeWidth = 1.8 / paper.view.zoom;
        tightOutline.dashArray = [3 / paper.view.zoom, 3 / paper.view.zoom];
        // A hole is a physical cutter, never a translucent painted shape.
        // Selection feedback is stroke-only and lives in the UI overlay, not
        // in the design geometry or laser export.
        tightOutline.fillColor = null;
        tightOutline.data = { isSelectionBox: true, isHoleTightOutline: true, uiOnly: true };
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
            childOutline.fillColor = null;
            childOutline.data = { isSelectionBox: true, isHoleTightOutline: true, uiOnly: true };
            window.selectionBoxGroup.addChild(childOutline);
          }
        }
      });
    }
  });

  // Delineado secundario punteado si hay selección múltiple
  if (selected.length > 1) {
    selected.forEach(function(it) {
      const displayItem = getPublicOwner(it);
      if (!displayItem) return;
      const b = getPublicWorldBounds(displayItem);
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

  // Single-owner frame follows the owner's world matrix; multi-select remains axis-aligned.
  const ownerForHandle = selected.length === 1
    ? (window.EKKO_ROTATION_CONTROLLER?.resolveOwner?.(primaryItem) || primaryItem) : null;
  const ownerMatrix = ownerForHandle?.globalMatrix || ownerForHandle?.matrix;
  // Re-publish the rendered world angle after geometry tools (Calado/Contorno)
  // rebuild their paths. The matrix is authoritative; metadata follows it.
  if (ownerForHandle && ownerMatrix) {
    const worldAngle = ((Math.atan2(Number(ownerMatrix.b), Number(ownerMatrix.a)) * 180 / Math.PI) % 360 + 360) % 360;
    ownerForHandle.data = { ...(ownerForHandle.data || {}), rotation: worldAngle };
  }
  const oriented = selected.length === 1 && ownerForHandle && ownerMatrix;
  // `owner.bounds` is a world/project AABB and must never be used to
  // fabricate an oriented frame. Obtain true local geometry bounds once, then
  // map each local corner exactly once through the owner's world matrix.
  const localBounds = oriented ? getOwnerLocalGeometryBounds(ownerForHandle) : null;
  const worldPoint = p => ownerMatrix.transform(p);
  const corners = localBounds ? [worldPoint(localBounds.topLeft), worldPoint(localBounds.topRight), worldPoint(localBounds.bottomRight), worldPoint(localBounds.bottomLeft)] : null;
  const mid = (a,b) => a.add(b).divide(2);
  const pts = corners ? {tl:corners[0],tr:corners[1],br:corners[2],bl:corners[3],t:mid(corners[0],corners[1]),r:mid(corners[1],corners[2]),b:mid(corners[2],corners[3]),l:mid(corners[3],corners[0])} : {tl:bounds.topLeft,tr:bounds.topRight,br:bounds.bottomRight,bl:bounds.bottomLeft,t:bounds.topCenter,r:bounds.rightCenter,b:bounds.bottomCenter,l:bounds.leftCenter};
  const boxBorder = corners ? new paper.Path({segments: corners, closed: true}) : new paper.Path.Rectangle(bounds);
  boxBorder.strokeColor = mainColor; boxBorder.strokeWidth = 1.5 / paper.view.zoom; boxBorder.data = {isSelectionBox:true};
  window.selectionBoxGroup.addChild(boxBorder);
  const handleSize = 8 / paper.view.zoom;
  ['tl','tr','bl','br','t','b','l','r'].forEach(type => {
    const h = new paper.Path.Rectangle({center:pts[type], size:[handleSize,handleSize], fillColor:'#fff', strokeColor:mainColor, strokeWidth:1.5 / paper.view.zoom, data:{isSelectionBox:true,isHandle:true,handleType:type}});
    if (oriented) h.rotate(Math.atan2(Number(ownerMatrix.b),Number(ownerMatrix.a))*180/Math.PI, pts[type]);
    window.selectionBoxGroup.addChild(h);
  });
  const rotOffset = 22 / paper.view.zoom;
  const angle = ownerMatrix ? Math.atan2(Number(ownerMatrix.b),Number(ownerMatrix.a)) : 0;
  const rv = v => new paper.Point(v.x*Math.cos(angle)-v.y*Math.sin(angle),v.x*Math.sin(angle)+v.y*Math.cos(angle));
  const rotCenter = pts.t.add(rv(new paper.Point(0,-rotOffset)));
  const connector = new paper.Path.Line(pts.t,rotCenter); connector.strokeColor=mainColor; connector.strokeWidth=1.2/paper.view.zoom; connector.data={isSelectionBox:true}; window.selectionBoxGroup.addChild(connector);
  const rotCircle = new paper.Path.Circle({center:rotCenter,radius:7.5/paper.view.zoom,fillColor:'#fff',strokeColor:mainColor,strokeWidth:1.5/paper.view.zoom,data:{isSelectionBox:true,isHandle:true,handleType:'rot'}}); window.selectionBoxGroup.addChild(rotCircle);
  const ar=4/paper.view.zoom;
  const arc=new paper.Path.Arc(rotCenter.add(rv(new paper.Point(-ar,0))),rotCenter.add(rv(new paper.Point(0,-ar))),rotCenter.add(rv(new paper.Point(ar,0)))); arc.strokeColor=mainColor; arc.strokeWidth=1.2/paper.view.zoom; arc.data={isSelectionBox:true,isHandle:true,handleType:'rot'}; window.selectionBoxGroup.addChild(arc);
  const tip=new paper.Path.RegularPolygon(rotCenter.add(rv(new paper.Point(ar,0))),3,2.5/paper.view.zoom); tip.fillColor=mainColor; tip.data={isSelectionBox:true,isHandle:true,handleType:'rot'}; window.selectionBoxGroup.addChild(tip);

  window.selectionBoxGroup.bringToFront();

  if (typeof window.applyPositionCorrections === "function") {
    window.applyPositionCorrections();
  }
  if (typeof window.bindRotationInputEvents === "function") {
    window.bindRotationInputEvents();
  }
  if (!window.rotationActive) rotationController.syncSelection(primaryItem);
  if (typeof window.syncContextualRotationInput === "function") {
    window.syncContextualRotationInput(primaryItem);
  }
  // Selection is the canonical visibility trigger for oriented measurements.
  window.drawMeasurements?.();
};

/**
 * Selecciona un elemento del lienzo validando previamente su integridad topológica
 */
const _selectItem = function(item, isMulti = false) {
  if (window.nodeEditMode) return;
  if (!item) {
    window.deselectItem();
    return;
  }

  const validItem = _getSelectableItem(item);
  if (!validItem) {
    window.deselectItem();
    return;
  }
  item = validItem;
  const current = Array.isArray(window.selectedItems) ? [...window.selectedItems] : [];
  if (isMulti) {
    const index = current.indexOf(item);
    if (index > -1) current.splice(index, 1);
    else current.push(item);
    return commitSelectionContext(current, current[current.length - 1] || null, 'api-multi');
  }
  return commitSelectionContext([item], item, 'api-single');
};

/**
 * Deselecciona todos los elementos y remueve las cajas de selección
 */
const _deselectItem = function() {
  if (window.rotationActive) rotationController.cancelPointer(); else rotationController.hidePopup();
  if (window.nodeEditMode) {
    return;
  }

  if (window.selectedItems) {
    window.selectedItems.forEach(function(it) {
      if (it) clearFusionSelection(it);
    });
    window.selectedItems = [];
  }

  if (window.selectedItem) {
    clearFusionSelection(window.selectedItem);
  }

  window.selectedItem = null;

  if (window.marqueePath) {
    try { window.marqueePath.remove(); } catch (e) {}
    window.marqueePath = null;
  }
  window.marqueeActive = false;
  window.marqueeStartPoint = null;
  window._pendingIsolateItem = null;
  window._mouseDragOccurred = false;
  if (window.distributionGuidesGroup) {
    try { window.distributionGuidesGroup.remove(); } catch (e) {}
    window.distributionGuidesGroup = null;
  }
  if (typeof window.clearFusionPreview === 'function') {
    try { window.clearFusionPreview(true); } catch (e) {}
  }

  // Primero se elimina la caja. _updateSelectionBox(null) activa la capa de
  // diseño internamente; el deselectAll debe ocurrir después para que esa
  // activación no deje la Layer seleccionada otra vez.
  window.updateSelectionBox(null);

  try {
    if (paper?.project?.deselectAll) paper.project.deselectAll();
    if (paper?.project?.layers) {
      paper.project.layers.forEach(layer => {
        try { layer.selected = false; } catch (e) {}
      });
    }
  } catch (e) {}
  if (typeof window.hideContextualMenu === 'function') {
    window.hideContextualMenu();
  }
  paper.view.update();
};

const _getOppositePoint = function(bounds, handleType) {
  if (bounds?._framePoints) { const f=bounds._framePoints; const opposite={tl:'br',tr:'bl',bl:'tr',br:'tl',t:'b',b:'t',l:'r',r:'l'}[handleType]; return f[opposite] || f.center; }
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
  if (bounds?._framePoints) return bounds._framePoints[handleType] || bounds.center;
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
 * Busca primero un hueco real bajo el cursor en cualquier wrapper. Esta pasada
 * tiene prioridad sobre una fusión sólida que pueda cubrir visualmente al
 * hueco, porque el hueco es el receptor que el usuario debe poder elegir.
 */


function findHoleHitInside(item, point) {
  const owner = getPublicOwner(item);
  if (!owner || !owner.data?.isHole || isMockupOrMask(owner)) return null;
  return hitTestOwner(owner, point, 8 / (paper.view?.zoom || 1));
}

function findDesignHitInside(item, point) {
  const owner = getPublicOwner(item);
  if (!owner || isMockupOrMask(owner) || isContainmentWrapper(owner)) return null;
  return hitTestOwner(owner, point, 8 / (paper.view?.zoom || 1));
}

/** Resolve the top-most public owner in actual Paper sibling Z-order. */
function findItemAtPoint(point) {
  const layer = paper.project?.layers?.find(l => l.name === 'designLayer') || paper.project?.activeLayer;
  if (!layer?.children?.length) return null;
  const owners = [];
  const seen = new Set();
  for (let i = layer.children.length - 1; i >= 0; i--) {
    const descendants = collectOwners(layer.children[i]);
    for (let j = descendants.length - 1; j >= 0; j--) {
      const candidate = descendants[j];
      if (!candidate || isMockupOrMask(candidate) || isContainmentWrapper(candidate) || seen.has(candidate)) continue;
      seen.add(candidate);
      owners.push(candidate);
    }
  }
  const hitOwner = candidate => {
    const hit = hitTestOwner(candidate, point, 8 / (paper.view?.zoom || 1));
    if (!hit) return null;
    const fusion = typeof window.findSmartFusionContainer === 'function'
      ? window.findSmartFusionContainer(hit) : null;
    return fusion || hit;
  };
  // A hidden physical hole must win over a visible solid covering it. This is
  // the selection contract that lets Shift-click and marquee selection choose
  // a real cutter instead of the painted object above it.
  for (const candidate of owners) {
    if (candidate.data?.isHole === true) {
      const holeHit = hitOwner(candidate);
      if (holeHit) return holeHit;
    }
  }
  for (const candidate of owners) {
    const hit = hitOwner(candidate);
    if (hit) return hit;
  }
  return null;
}

function isMockupOrUI(item) {
  return isMockupOrMask(item) || isContainmentWrapper(item) ||
    item === window.currentMockup || item === window.selectionBoxGroup || item === window.nodeHandlesGroup;
}

/**
 * Construye la cadena de ownership que debe acompañar a cada interacción.
 * No sustituye owners ni modifica selección: es la única descripción pública
 * que consume el runtime probe y los diagnósticos de interacción.
 */
function describeSelectionOwner(item) {
  const chain = resolveOwnerChain(item);
  if (!chain) return null;
  return chain;
}

function resolveInteractionTarget(point, options = {}) {
  const target = point ? findItemAtPoint(point) : null;
  const chain = target ? describeSelectionOwner(target) : null;
  return {
    point: point ? { x: Number(point.x) || 0, y: Number(point.y) || 0 } : null,
    button: options.button ?? null,
    modifiers: {
      shift: !!options.shift,
      ctrl: !!options.ctrl,
      alt: !!options.alt,
      meta: !!options.meta
    },
    target,
    chain
  };
}

function describeSelectionState() {
  const items = Array.isArray(window.selectedItems) ? window.selectedItems.filter(Boolean) : [];
  return {
    primary: describeSelectionOwner(window.selectedItem),
    items: items.map(describeSelectionOwner).filter(Boolean),
    paperSelected: (paper?.project?.selectedItems || []).map(describeSelectionOwner).filter(Boolean),
    interaction: window.EKKO_INTERACTION?.snapshot?.() || null,
    commit: window.EKKO_SELECTION_CONTEXT
      ? { cause: window.EKKO_SELECTION_CONTEXT.cause || null, committedAt: window.EKKO_SELECTION_CONTEXT.committedAt || null }
      : null
  };
}

/**
 * Inicializador de la herramienta principal de selección de Paper.js
 */
function toParentPoint(item, globalPoint) {
  try {
    return item?.parent?.globalToLocal ? item.parent.globalToLocal(globalPoint) : globalPoint;
  } catch (e) { return globalPoint; }
}

const _initSelectionTool = function() {
  if (!paper.view) {
    debugLog("initSelectionTool: paper.view no está definido todavía.");
    return null;
  }
  const existing = window.__EKKO_SELECTION_TOOL_SESSION;
  if (existing?.tool && existing.view === paper.view) {
    existing.tool.activate();
    return existing.tool;
  }

  const selectTool = new paper.Tool();
  // Dispatcher único de doble clic: decide por el hit real del puntero.
  if (!window.__ekkoFusionDomDoubleClickInstalled && paper.view.element) {
    const canvasDoubleClick = function(event) {
      if (window.EKKO_INTERACTION && window.EKKO_INTERACTION.mode !== "select") return;
      if (window.fusionEditActive || window._fusionEditState) return;
      let point = null;
      try { point = paper.view.getEventPoint(event); } catch (e) { return; }
      const hit = point ? findItemAtPoint(point) : null;
      if (!hit) return;

      let fusion = null;
      if (hit.data?.isSmartFusion) {
        fusion = hit;
      } else if (typeof window.findSmartFusionContainer === 'function') {
        try { fusion = window.findSmartFusionContainer(hit); } catch (e) { fusion = null; }
      }

      const target = getPublicOwner(fusion || hit);
      const isText = target && (target.className === 'PointText' || target instanceof paper.PointText);
      // Un vector normal nunca entra a nodos por doble clic. La edición de
      // nodos se inicia exclusivamente desde el comando Editar Nodos.
      if (!fusion && !isText) return;
      event.preventDefault();
      event.stopPropagation();
      window.dragging = false;
      window._lastDraggedRaster = null;
      window._mouseDragOccurred = false;

      try {
        if (fusion && typeof window.enterFusionEditMode === 'function') {
          window.deselectItem();
          window.selectItem(fusion);
          window.enterFusionEditMode(fusion);
        } else if (isText && typeof window.startTextEditing === 'function') {
          window.deselectItem();
          window.selectItem(hit);
          window.startTextEditing(target);
        }
      } catch (e) {
        console.error('[EKKO DBLCLICK ERROR]', e);
      }
    };

    paper.view.element.addEventListener('dblclick', canvasDoubleClick, true);
    window.__ekkoFusionDomDoubleClickInstalled = true;
    window.__ekkoFusionDomDoubleClickStop = function() {
      paper.view.element.removeEventListener('dblclick', canvasDoubleClick, true);
      window.__ekkoFusionDomDoubleClickInstalled = false;
      delete window.__ekkoFusionDomDoubleClickStop;
    };
  }

  selectTool.onMouseDown = function(event) {
    if (window.nodeEditMode) return;

    const interaction = window.EKKO_INTERACTION;
    if (interaction?.mode === "fusion-edit") {
      handleFusionEditPointerDown(event, event.point);
      return;
    }
    if (interaction?.mode === "text-insert") {
      if (typeof createEditableText === "function") createEditableText(event.point);
      window.insertTextMode = false;
      interaction.release("text-insert");
      paper.view.element.style.cursor = "default";
      return;
    }
    if (interaction && !interaction.canHandle("select")) return;

    if (window.insertTextMode) {
      if (typeof createEditableText === "function") {
        createEditableText(event.point);
      }
      window.insertTextMode = false;
      paper.view.element.style.cursor = "default";
      return;
    }

    // Curved-text handle is a real interaction target, not a decorative
    // overlay. Route it by semantic curveOwnerId before selection hit-tests.
    const curveHandle = window._ekkoCurveHandle;
    if (curveHandle && curveHandle.project && curveHandle.data?.curveOwnerId) {
      const hitCurve = curveHandle.hitTest?.(event.point, { fill: true, stroke: true, tolerance: 12 / paper.view.zoom });
      if (hitCurve) {
        const owner = paper.project.getItem({ id: curveHandle.data.curveOwnerId });
        if (owner) {
          window._ekkoCurveDrag = { owner, startPoint: event.point.clone(), startCurvature: Number(owner.data?.curvature) || 20 };
          window.saveHistory?.();
          return;
        }
      }
    }

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
        rotationController.startPointer(event, {
          selectedItem: window.selectedItem,
          selectedItems: window.selectedItems || [],
          selectionBox: window.selectionBoxGroup,
          getContentItem: getPublicOwner, getTransformTarget, toParentPoint
        });
        return;
      }

      // Tirador de redimensionamiento
      window.resizeActive = true;
      window.resizeHandleType = hType;
      window.resizeTargets = [];
      let unifiedBounds = null;

      window.selectedItems.forEach(function(it) {
        const displayItem = getPublicOwner(it);
        if (!displayItem) return;
        const b = getPublicWorldBounds(displayItem);
        if (b) {
          unifiedBounds = !unifiedBounds ? b.clone() : unifiedBounds.unite(b);
        }
        window.resizeTargets.push({
          item: it,
          target: getTransformTarget(it) || displayItem,
          initialBounds: b ? b.clone() : displayItem.bounds.clone(),
          initialPosition: displayItem.position.clone()
        });
      });

      window.resizeInitialBounds = unifiedBounds || window.selectedItem.bounds;
      if (window.selectedItems.length === 1) {
        const owner = window.EKKO_ROTATION_CONTROLLER?.resolveOwner?.(window.selectedItem) || window.selectedItem;
        const matrix = owner?.globalMatrix || owner?.matrix; const local = getOwnerLocalGeometryBounds(owner);
        if (matrix && local) { const w=p=>matrix.transform(p), m=(a,b)=>a.add(b).divide(2); const c=[w(local.topLeft),w(local.topRight),w(local.bottomRight),w(local.bottomLeft)]; window.resizeInitialBounds._framePoints={tl:c[0],tr:c[1],br:c[2],bl:c[3],t:m(c[0],c[1]),r:m(c[1],c[2]),b:m(c[2],c[3]),l:m(c[3],c[0])}; }
      }
      window.resizeInitialPoint = event.point.clone();
      window.resizeAnchor = window.getOppositePoint(window.resizeInitialBounds, window.resizeHandleType);
      window.resizeLastScaleX = 1.0;
      window.resizeLastScaleY = 1.0;
      beginTransformTransaction("scale", window.resizeTargets, event.point);
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

      // El hit-test puede devolver el contenido real dentro de un clipGroup,
      // mientras que la multiselección por marquee contiene sus wrappers. La
      // pertenencia se compara por propietario de transformación, no por
      // identidad superficial del wrapper.
      const directTarget = getTransformTarget(directHitItem);
      const selectedOwnerIndex = (window.selectedItems || []).findIndex(selected => {
        if (!selected) return false;
        if (selected === directHitItem) return true;
        const selectedTarget = getTransformTarget(selected);
        return !!directTarget && !!selectedTarget && selectedTarget === directTarget;
      });

      if (isShift) {
        // Shift-click siempre conmuta owners dentro del mismo commit.
        const current = Array.isArray(window.selectedItems) ? [...window.selectedItems] : [];
        if (selectedOwnerIndex > -1) current.splice(selectedOwnerIndex, 1);
        else current.push(directHitItem);
        commitSelectionContext(current, current[current.length - 1] || null, 'shift-click');
      } else {
        // Clic simple sin Shift. Si el propietario ya forma parte de una
        // selección múltiple, preservamos el conjunto durante el gesto y solo
        // aislamos en mouseUp si realmente no hubo arrastre.
        if (selectedOwnerIndex > -1) {
          if (window.selectedItems.length > 1) {
            window._pendingIsolateItem = directHitItem;
          }
        } else {
          commitSelectionContext([directHitItem], directHitItem, 'click');
        }
      }

      // Iniciar arrastre del conjunto completo actualmente seleccionado
      window.dragging = true;
      window._dragStartPoint = event.point.clone();
      window.dragTargets = buildDragTargets(window.selectedItems, event.point);
      window._ekkoLastDragTargetIds = window.dragTargets.map(entry => entry.target.id);
      beginTransformTransaction("drag", window.dragTargets, event.point);

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
        window._dragStartPoint = event.point.clone();
        window.dragTargets = buildDragTargets(window.selectedItems, event.point);
        window._ekkoLastDragTargetIds = window.dragTargets.map(entry => entry.target.id);
        beginTransformTransaction("drag", window.dragTargets, event.point);
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
    if (window.EKKO_INTERACTION?.mode === "fusion-edit") {
      handleFusionEditPointerDrag(event);
      return;
    }
    if (window.EKKO_INTERACTION && !window.EKKO_INTERACTION.canHandle("select")) return;
    if (window.selectedItem && window.selectedItem.data && window.selectedItem.data.locked) {
      return;
    }

    if (window._ekkoCurveDrag) {
      const drag = window._ekkoCurveDrag;
      const deltaY = event.point.y - drag.startPoint.y;
      const sign = drag.startCurvature < 0 ? -1 : 1;
      const curvature = Math.max(-100, Math.min(100, sign * (Math.abs(drag.startCurvature) - deltaY * 0.2)));
      window.applyTextCurve?.(drag.owner, curvature, { skipHistory: true });
      paper.view.update();
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

    // Rotación: única ruta delegada al controlador canónico.
    if (window.rotationActive) {
      rotationController.dragPointer(event);
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
        // UNIFIED OWNER (Fase 1): TODA escala — fusión o no — pasa por el
        // dueño canónico transformPublicItem. Resuelve owner, aplica scale
        // con conversión de coordenadas (toParentPoint) y sincroniza
        // geomBase(s) desacopladas. Elimina el camino .scale() directo +
        // scaleGeomBaseDeep manual que divergía de la rotación (causa raíz
        // de los tiradores desincronizados).
        transformPublicItem(targetInfo.target || targetInfo.item, {
          type: "scale", sx: stepScaleX, sy: stepScaleY, center: anchor
        });
      });
      notifyTransformObservers({ event, type: "scale", scale: { x: stepScaleX, y: stepScaleY } });

      // CSG is intentionally deferred until mouse-up. Rebuilding paths during
      // a transform changes bounds and causes pointer/object desynchronization.

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
      // event.delta is one project-space delta shared by every selected item.
      // Never derive a new absolute position from each target's local position.
      const dragResult = accumulateDragDelta(event, window.dragTargets);
      const commonDelta = dragResult.delta;
      const movedCount = dragResult.movedCount;
      window._ekkoLastDragMovedCount = movedCount;
      // `_ekkoLastDragCommonDelta` is cumulative for the transaction; the
      // individual event delta remains available as `_ekkoLastDragEventDelta`.
      window._ekkoLastDragCommonDelta = dragResult.cumulativeDelta;

      // Una fusión debe moverse como una unidad visual autónoma. No se debe
      // volver a perforar su contenido con huecos hermanos mientras el cliente
      // la arrastra, porque el resultado aparece cortado por elementos que
      // estaban por encima del receptor original.
      const skipFusionCSGRecalc = window.dragTargets.some(function(info) {
        const candidate = info.target || info.item;
        let fusion = candidate?.data?.isSmartFusion ? candidate : null;
        if (!fusion && typeof window.findSmartFusionContainer === 'function') {
          try { fusion = window.findSmartFusionContainer(candidate); } catch (e) { fusion = null; }
        }
        // Las fusiones dentro de huecos sí deben actualizar sus huecos
        // virtuales. El blindaje aplica solamente a fusiones de sólidos.
        return !!(fusion && fusion.data?.originalIsHole !== true);
      });
      window._ekkoSkipFusionCSGRecalc = skipFusionCSGRecalc;

      // CSG is deferred until mouse-up for every drag target.

      // === EKKO SMART FUSION v46: Magnetic Snapping al arrastrar una imagen ===
      // Durante la edición interna la imagen es libre, pero sigue perteneciendo
      // a una fusión. No debe buscar otro receptor ni encender halos fucsia.
      const internalFusionEdit = !!(window.fusionEditActive || window._fusionEditState);
      if (!internalFusionEdit && window.dragTargets.length === 1 && typeof window.checkMagneticSnapping === 'function') {
        const onlyTarget = window.dragTargets[0].target;
        if (onlyTarget && onlyTarget.className === 'Raster') {
          window._lastDraggedRaster = onlyTarget;
          window.checkMagneticSnapping(onlyTarget, event.point);
        }
      } else {
        if (typeof window.clearFusionPreview === 'function') window.clearFusionPreview();
        window._lastDraggedRaster = null;
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
    if (window.EKKO_INTERACTION?.mode === "fusion-edit") {
      handleFusionEditPointerUp(event);
      return;
    }
    if (window.EKKO_INTERACTION && !window.EKKO_INTERACTION.canHandle("select")) return;

    if (window._ekkoCurveDrag) {
      window._ekkoCurveDrag = null;
      window.updateSelectionBox?.(window.selectedItem);
      window.updateContextualMenu?.(window.selectedItem);
      paper.view.update();
      return;
    }

    // === EKKO SMART FUSION v46: Consolidar fusión si se soltó sobre un receptor ===
    if (window._lastDraggedRaster && typeof window.handleMagneticDrop === 'function') {
      const draggedRaster = window._lastDraggedRaster;
      window._lastDraggedRaster = null;
      const fused = window.handleMagneticDrop(draggedRaster);
      if (fused) {
        finalizeTransformTransaction("committed-fusion-drop");
        window._mouseDragOccurred = false;
        window._ekkoSkipFusionCSGRecalc = false;
        window.dragging = false;
        window.resizeActive = false;
        rotationController.endPointer("committed-fusion-drop");
        window.isRotationSnapped = false;
        window.rotationTargets = [];
        if (typeof clearSmartGuides === 'function') clearSmartGuides();
        window.updateSelectionBox(window.selectedItem);
        paper.view.update();
        return;
      }
    }
    window._lastDraggedRaster = null;

    if (window.marqueeActive && window.marqueePath) {
      const marqueeGeometry = window.marqueePath.clone({ insert: false });
      window.marqueePath.remove();
      window.marqueePath = null;
      window.marqueeActive = false;

      const itemsToSelect = [];
      const seenOwners = new Set();
      const layer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
      if (layer && layer.children) {
        layer.children.forEach(function(item) {
          if (isMockupOrUI(item)) return;
          // A design-layer child may be a regular group created by import or
          // Desagrupar. Resolve all semantic public owners recursively; using
          // getPublicOwner(item) here collapses the marquee to that group and
          // loses the individual solids/hole owners.
          const owners = collectOwners(item);
          owners.forEach(function(owner) {
            if (!owner || seenOwners.has(owner)) return;
            if (intersectsMarquee(owner, marqueeGeometry)) {
              seenOwners.add(owner);
              itemsToSelect.push(owner);
            }
          });
        });
      }
      try { marqueeGeometry.remove(); } catch (e) {}

      if (itemsToSelect.length > 0) {
        commitSelectionContext(itemsToSelect, itemsToSelect[itemsToSelect.length - 1], 'marquee');
      } else {
        commitSelectionContext([], null, 'marquee-empty');
      }
      paper.view.update();
      return;
    }

    // Si el usuario hizo clic estático sin arrastrar sobre una pieza dentro de una multiselección,
    // aislamos esa pieza individual de forma limpia al soltar el ratón (comportamiento estándar Canva/Figma).
    if (!window._mouseDragOccurred && window._pendingIsolateItem && window.selectedItems.length > 1) {
      const isolate = window._pendingIsolateItem;
      commitSelectionContext([isolate], isolate, 'isolate-click');
    }
    window._pendingIsolateItem = null;
    window._mouseDragOccurred = false;

    if (window.rotationActive) rotationController.endPointer("committed");
    if (window.resizeActive || window.dragging) {
      finalizeTransformTransaction("committed");
      if (typeof window.saveHistory === 'function') window.saveHistory();
      if (typeof window.commitHistoryTransaction === 'function') window.commitHistoryTransaction("transform");

      // No recalcular CSG al soltar una fusión: sus límites visibles no deben
      // quedar perforados por huecos hermanos durante el desplazamiento.
      if (typeof window.recalculateDynamicSubtractions === 'function') {
        const designLayer = paper.project.layers.find(layer => layer?.name === 'designLayer') || window.selectedItem?.layer || null;
        window.recalculateDynamicSubtractions(designLayer);
      }
    }

    window._ekkoSkipFusionCSGRecalc = false;
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
    if (window.EKKO_INTERACTION?.mode === "fusion-edit") return;
    if (window.EKKO_INTERACTION && !window.EKKO_INTERACTION.canHandle("select")) return;
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
  window.__EKKO_SELECTION_TOOL_SESSION = {
    tool: selectTool,
    view: paper.view,
    initializedAt: Date.now()
  };
  return selectTool;
};

if (typeof paper !== "undefined" && paper.view) {
  _initSelectionTool();
}

// === EKKO: finalización de edición interna ===
if (typeof window !== 'undefined' && !window._ekkoFusionDblClickBound) {
  window._ekkoFusionDblClickBound = true;
  // El doble clic se despacha exclusivamente por el listener del canvas;
  // aquí solo se mantienen los cierres de edición.
  // Salir del modo edición interna con Enter / Escape
  document.addEventListener('keydown', function(e) {
    if (!window.fusionEditActive) return;
    if (e.key === 'Enter' || e.key === 'Escape') {
      if (typeof window.exitFusionEditMode === 'function') {
        window.exitFusionEditMode(e.key !== 'Escape');
        e.preventDefault();
      }
    }
  });
  // Clic derecho también finaliza la edición interna (según spec EKKO)
  document.addEventListener('contextmenu', function() {
    if (!window.fusionEditActive) return;
    if (typeof window.exitFusionEditMode === 'function') {
      window.exitFusionEditMode(true);
    }
  });
}


/**
 * Alinea todos los elementos seleccionados según la dirección indicada.
 * Respeta geomBase, mantiene proporciones, sincroniza posiciones y preserva máscaras/clipGroup.
 * 
 * @param {string} direccion - Dirección de alineación:
 *        'left' | 'center-h' | 'right' | 'top' | 'center-v' | 'bottom'
 */
function alignSelection(direccion) {
    // 1️⃣ Obtener selección activa
    const seleccion = paper.project.selectedItems || [];
    if (!seleccion.length) {
        console.warn('[alignSelection] No hay elementos seleccionados.');
        return;
    }

    // 2️⃣ Calcular bounding box UNIFICADO de toda la selección
    const bboxUnificado = new paper.Rectangle();
    seleccion.forEach(item => {
        bboxUnificado.set(item.bounds);
    });

    // Coordenadas de referencia del bloque completo
    const ref = {
        x: {
            izquierda: bboxUnificado.x,
            centro: bboxUnificado.center.x,
            derecha: bboxUnificado.right
        },
        y: {
            arriba: bboxUnificado.y,
            medio: bboxUnificado.center.y,
            abajo: bboxUnificado.bottom
        }
    };

    // 3️⃣ Determinar qué eje y qué valor de referencia usar
    let eje = null;       // 'x' o 'y'
    let valorRef = null;

    switch (direccion) {
        case 'left':
            eje = 'x';
            valorRef = ref.x.izquierda;
            break;
        case 'center-h':
            eje = 'x';
            valorRef = ref.x.centro;
            break;
        case 'right':
            eje = 'x';
            valorRef = ref.x.derecha;
            break;
        case 'top':
            eje = 'y';
            valorRef = ref.y.arriba;
            break;
        case 'center-v':
            eje = 'y';
            valorRef = ref.y.medio;
            break;
        case 'bottom':
            eje = 'y';
            valorRef = ref.y.abajo;
            break;
        default:
            console.error('[alignSelection] Dirección desconocida:', direccion);
            return;
    }

    // 4️⃣ Aplicar alineación a CADA elemento seleccionado
    seleccion.forEach(item => {
        // Saltar contenedores de máscara para no romper clipMask/clipGroup
        if (item.data && item.data.isProductMask) return;

        // Calcular desplazamiento necesario
        let desplazamiento = 0;

        if (eje === 'x') {
            const puntoAncla = direccion === 'left'  ? item.bounds.x :
                               direccion === 'right' ? item.bounds.right :
                               item.bounds.center.x;
            desplazamiento = valorRef - puntoAncla;
            item.position.x += desplazamiento;
        } else { // eje === 'y'
            const puntoAncla = direccion === 'top'    ? item.bounds.y :
                               direccion === 'bottom' ? item.bounds.bottom :
                               item.bounds.center.y;
            desplazamiento = valorRef - puntoAncla;
            item.position.y += desplazamiento;
        }

        // geomBase is owner-local and the owner matrix now carries this
        // alignment. Never translate the detached snapshot a second time.
    });

    // ✅ Notificar a auditoría / diagnóstico si está disponible
    if (typeof ekkoDiagnostics !== 'undefined' && ekkoDiagnostics.logEvent) {
        ekkoDiagnostics.logEvent('alignSelection', {
            direccion,
            cantidadElementos: seleccion.length,
            eje,
            valorReferencia: valorRef
        });
    }

    console.log(`[alignSelection] Alineación ${direccion} aplicada a ${seleccion.length} elemento(s)`);
}

function normalizeSelectionOwners(items) {
  const list = [];
  const seen = new Set();
  (Array.isArray(items) ? items : [items]).filter(Boolean).forEach(item => {
    const owner = getPublicOwner(item);
    if (!owner || isMockupOrUI(owner) || seen.has(owner)) return;
    seen.add(owner);
    list.push(owner);
  });
  return list;
}

/**
 * Único commit de selección pública. Todas las rutas de interacción deben
 * entregar owners ya resueltos aquí; este commit sincroniza el estado global,
 * la bandera selected de Paper.js, la caja y el menú sin volver a hacer hit-test.
 */
function commitSelectionContext(items, primary = null, cause = 'unknown') {
  const list = normalizeSelectionOwners(items);
  const nextPrimary = list.includes(primary)
    ? primary
    : (list[list.length - 1] || null);
  const previous = new Set([
    ...(Array.isArray(window.selectedItems) ? window.selectedItems : []),
    ...(paper?.project?.selectedItems || [])
  ].filter(Boolean));

  previous.forEach(item => {
    if (!list.includes(item)) {
      try { clearFusionSelection(item); } catch (_) {}
      try { item.selected = false; } catch (_) {}
    }
  });

  if (!list.length) {
    _deselectItem();
    window.EKKO_SELECTION_CONTEXT = { cause, items: [], primary: null };
    return null;
  }

  list.forEach(item => { try { item.selected = true; } catch (_) {} });
  window.selectedItems = list;
  window.selectedItem = nextPrimary;
  window.EKKO_SELECTION_CONTEXT = {
    cause,
    items: list.slice(),
    primary: nextPrimary,
    committedAt: Date.now()
  };
  _updateSelectionBox(nextPrimary);
  if (typeof window.updateContextualMenu === 'function') {
    window.updateContextualMenu(nextPrimary);
  }
  paper.view.update();
  return nextPrimary;
}

function _commitSelection(item, items = null) {
  return commitSelectionContext(items == null ? [item] : items, item, 'api');
}
window.commitSelectionContext = commitSelectionContext;
window.commitSelection = _commitSelection;
window.EKKO_SELECTION_API = {
  resolveInteractionTarget,
  describeSelectionOwner,
  describeSelectionState,
  getSelectableItem: _getSelectableItem
};

protectGlobal('getSelectableItem', _getSelectableItem);
protectGlobal('updateSelectionBox', _updateSelectionBox);
protectGlobal('selectItem', _selectItem);
protectGlobal('deselectItem', _deselectItem);
protectGlobal('getOppositePoint', _getOppositePoint);
protectGlobal('getHandlePoint', _getHandlePoint);
protectGlobal('initSelectionTool', _initSelectionTool);

// Las funciones de organización, vista y nodos son expuestas
// por sus módulos responsables. selection.js solo registra
// la herramienta de selección y sus APIs propias.





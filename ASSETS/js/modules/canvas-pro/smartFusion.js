/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/smartFusion.js
ACCIÓN: REEMPLAZAR COMPLETAMENTE
ESTADO: v46.0 — REESCRITURA MAGNETIC SNAPPING (Canva-Style) + FIX RELEASE/RECALC
  - Snap por SOLAPAMIENTO (no por distancia centro-centro).
  - Halo NEON FUCSIA sobre la SILUETA REAL del receptor (no rectángulo cian).
  - Preview translúcido de la imagen encajada dentro del hueco (sin mover la foto real).
  - Blindaje anti-mockup en los receptores (nunca un hueco de producto).
  - Auto-modo en drop: intersecar (llenar calado) por defecto.
  - Registro de HUECOS VIRTUALES SUSTRACTIVOS para no rellenar el sólido al fusionar un hueco.
  - FIX releaseSmartFusion: no re-asigna .position (clones absolutos) y preserva isHole original.
  - FIX recalculateSmartFusion: soporta ambos modos (calar e intersecar).
  - NUEVO: applyFusionFromSelection(mode) para botón "Fusionar" explícito.
DEPENDENCIAS DIRECTAS: ASSETS/js/modules/canvas-pro/geometricUngroup.js
======================================================================== */
import { recalculateDynamicSubtractions } from "./geometricUngroup.js";
import {
  isProductElement,
  isValidFusionReceptor,
  findFusionVector,
  findFusionRaster,
  cloneAbsolute,
  calculateCoverPlacement,
  canFuse
} from "./fusionCore.js";
import {
  registerFusion,
  resolveFusionRecord,
  removeFusionRecord
} from "./fusionController.js";

// Estado global del snapping magnético
let fusionPreviewGroup = null;   // Contiene halo fucsia + preview recortado translúcido
let activeSnappedVector = null;  // Receptor activo (vector) durante el arrastre
let activeSnappedRaster = null;  // Raster que se está arrastrando

// Colores NEON oficiales de la especificación EKKO
const NEON_FUCHSIA = '#ff2ea6';  // Hover → "se fusionará aquí" (arrastrando imagen sobre hueco)
const NEON_CYAN    = '#00e5ff';  // Edición interna → "puedes transformar la imagen dentro"

/* ------------------------------------------------------------------------
   HELPERS CONSERVADOS (robustos, validados en producción)
------------------------------------------------------------------------ */
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

function cleanEmptyClipGroup(parent) {
  if (parent && parent.data && parent.data.clipGroup) {
    const designChildren = parent.children.filter(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
    if (designChildren.length === 0) parent.remove();
  }
}

function isMockupOrProductElement(item) {
  return isProductElement(item);
}

function bakeMatrixIntoPath(path, matrix) {
  if (!path || !matrix || matrix.isIdentity()) return;
  if (path.segments && path.segments.length > 0) {
    path.segments.forEach(seg => {
      seg.point = matrix.transform(seg.point);
      if (seg.handleIn) seg.handleIn = matrix.transform(seg.handleIn).subtract(matrix.transform(new paper.Point(0, 0)));
      if (seg.handleOut) seg.handleOut = matrix.transform(seg.handleOut).subtract(matrix.transform(new paper.Point(0, 0)));
    });
  }
  if (path.children && path.children.length > 0) {
    Array.from(path.children).forEach(child => bakeMatrixIntoPath(child, matrix));
  }
}

function getAbsoluteClone(item) {
  return cloneAbsolute(item);
}

function findSmartFusionContainer(item) {
  if (!item) return null;
  if (item.data && item.data.isSmartFusion) return item;
  if (item.children && item.children.length > 0) {
    let found = null;
    (function traverse(node) {
      if (found) return;
      if (node.data && node.data.isSmartFusion) { found = node; return; }
      if (node.children) for (let i = 0; i < node.children.length; i++) { traverse(node.children[i]); if (found) return; }
    })(item);
    if (found) return found;
  }
  let curr = item.parent;
  while (curr && curr !== paper.project) {
    if (curr.data && curr.data.isSmartFusion) return curr;
    curr = curr.parent;
  }
  return null;
}

function overrideChildrenSelection(group) {
  if (!group || !group.children) return;
  group.children.forEach(child => {
    try {
      Object.defineProperty(child, 'selected', {
        get: function() { return false; },
        set: function() {},
        configurable: true, enumerable: true
      });
    } catch (e) {}
    if (child.children && child.children.length > 0) overrideChildrenSelection(child);
  });
}

/* ------------------------------------------------------------------------
   El registro de huecos pertenece a fusionController.js. smartFusion.js
   solamente coordina la operación visual y no mantiene una segunda copia.
------------------------------------------------------------------------ */
/* ------------------------------------------------------------------------
   RECEPTORES DE FUSIÓN (candidatos a "absorber" una imagen)
   - Vectores cerrados del cliente (Path/CompoundPath) NO mockup, NO UI,
     NO parte ya de una fusión.
   - Preferencia por los marcados isFusionReceptor=true (huecos de SVG de
     cliente, marcados por geometricUngroup al desagrupar).
------------------------------------------------------------------------ */
function getFusionReceptors() {
  const layer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
  if (!layer || !layer.children) return [];
  const receptors = [];
  layer.children.forEach(item => {
    if (item.data && (item.data.isSelectionBox || item.data.isSmartGuide || item.data.isMeasurement ||
                      item.data.isTracePreview || item.data.isNodeEditOverlay || item.data.isHandle)) return;
    if (item.data && item.data.isSmartFusion) return;
    const display = getContentItem(item);
    if (!display) return;
    if (display.clipMask || (display.data && (display.data.mockup || display.data.isMask || display.data.wasClipMask))) return;
    if (isMockupOrProductElement(display)) return; // BLINDAJE: nunca un hueco de producto
    if (display.className === 'Path' || display.className === 'CompoundPath' || display.className === 'Shape') {
      if (display.closed || display.className === 'CompoundPath' || display.className === 'Shape') {
        receptors.push({ item: display, wrapper: item, isHole: !!(display.data && display.data.isHole), priority: display.data && display.data.isFusionReceptor ? 1 : 0 });
      }
    }
  });
  return receptors;
}

/* ------------------------------------------------------------------------
   DETECCIÓN POR SOLAPAMIENTO (no por distancia centro-centro)
   Devuelve el mejor receptor o null.
------------------------------------------------------------------------ */
function pointHitsFusionReceptor(receptor, point) {
  if (!receptor || !receptor.item || !point) return false;
  const item = receptor.item;
  try {
    if (typeof item.contains === "function" && item.contains(point)) return true;
  } catch (e) {}
  try {
    const tolerance = 6 / (paper.view?.zoom || 1);
    return !!item.hitTest(point, {
      fill: true,
      stroke: true,
      segments: true,
      tolerance
    });
  } catch (e) {
    return false;
  }
}

function findBestSnapReceptor(rasterItem, mousePoint) {
  const receptors = getFusionReceptors();
  if (receptors.length === 0 || !mousePoint) return null;
  const rBounds = rasterItem.bounds;
  if (!rBounds) return null;
  const rCenter = rBounds.center;
  let best = null;
  let bestScore = -1;
  receptors.forEach(rec => {
    const vBounds = rec.item.bounds;
    if (!vBounds || !pointHitsFusionReceptor(rec, mousePoint)) return;

    let score = 300; // Intención explícita: el puntero está sobre la geometría real.
    if (vBounds.contains(rCenter)) score += 100;
    if (vBounds.intersects(rBounds)) {
      const inter = vBounds.intersect(rBounds);
      if (inter) {
        const overlapArea = inter.width * inter.height;
        const rasterArea = Math.max(1, rBounds.width * rBounds.height);
        score += (overlapArea / rasterArea) * 60;
      }
    }
    const dist = rCenter.getDistance(vBounds.center);
    const diag = Math.sqrt(vBounds.width*vBounds.width + vBounds.height*vBounds.height) || 1;
    score += Math.max(0, 20 * (1 - dist / (diag * 1.5)));
    score += rec.priority * 30;
    if (score > bestScore) { bestScore = score; best = rec; }
  });
  return best;
}

/* ------------------------------------------------------------------------
   DIBUJO DEL PREVIEW DE FUSIÓN (halo fucsia + imagen recortada translúcida)
   NO mueve la foto real: solo dibuja una previsualización encima.
------------------------------------------------------------------------ */
function removeFusionPreviewOnly() {
  if (fusionPreviewGroup) { try { fusionPreviewGroup.remove(); } catch(e){} fusionPreviewGroup = null; }
}

function drawFusionPreview(rasterItem, receptor) {
  removeFusionPreviewOnly();
  const zoom = paper.view.zoom || 1.0;
  fusionPreviewGroup = new paper.Group();
  fusionPreviewGroup.data = { isSelectionBox: true, isSmartGuide: true, isFusionPreview: true };

  // 1. Halo NEON FUCSIA sobre la SILUETA REAL del receptor (geometría absoluta)
  try {
    const absHalo = getAbsoluteClone(receptor.item);
    absHalo.data = {};
    absHalo.strokeColor = new paper.Color(NEON_FUCHSIA);
    absHalo.strokeWidth = 2.5 / zoom;
    absHalo.fillColor = new paper.Color(1, 0.18, 0.65, 0.10);
    absHalo.shadowColor = new paper.Color(NEON_FUCHSIA);
    absHalo.shadowBlur = 14 / zoom;
    fusionPreviewGroup.addChild(absHalo);
  } catch (e) {
    const rect = new paper.Path.Rectangle(receptor.item.bounds);
    rect.strokeColor = NEON_FUCHSIA; rect.strokeWidth = 2.5 / zoom; rect.dashArray = [4/zoom, 4/zoom];
    fusionPreviewGroup.addChild(rect);
  }

  // 2. Preview translúcido de la imagen encajada dentro del receptor (clip mask)
  try {
    const maskClone = getAbsoluteClone(receptor.item);
    maskClone.data = {};
    maskClone.clipMask = true;
    maskClone.fillColor = null; maskClone.strokeColor = null;
    const rasterClone = rasterItem.clone({ insert: false });
    rasterClone.opacity = 0.55;
    rasterClone.data = {};
    const clipGroup = new paper.Group({ children: [maskClone, rasterClone], clipped: true });
    fusionPreviewGroup.addChild(clipGroup);
  } catch (e) { /* sin preview de imagen, solo halo */ }

  fusionPreviewGroup.bringToFront();
  if (paper.view && paper.view.element) paper.view.element.style.cursor = 'copy';
}

function clearFusionPreview(resetCursor = true) {
  if (fusionPreviewGroup) { try { fusionPreviewGroup.remove(); } catch(e){} fusionPreviewGroup = null; }
  activeSnappedVector = null;
  activeSnappedRaster = null;
  if (resetCursor && paper.view && paper.view.element) paper.view.element.style.cursor = 'default';
}

/* ------------------------------------------------------------------------
   MOTOR DE FUSIÓN (conservado, con mejoras: registra isHole original y
   hueco virtual sustractivo). Default mode ahora 'intersecar'.
------------------------------------------------------------------------ */
export function applySmartFusion(vector, raster, mode = 'intersecar', options = {}) {
  const preserveRasterTransform = options && options.preserveRasterTransform === true;
  if (!vector || !raster || !paper) return null;
  if (!canFuse(raster, vector)) {
    console.warn("[FUSION CONTRACT]: La combinación no es un par imagen + receptor de diseño válido.");
    return null;
  }
  if (isMockupOrProductElement(vector) || vector.clipMask) {
    console.error("[MOCKUP_LOCK]: Intento de usar plantilla/máscara de producto como vector de corte. Cancelado.");
    return null;
  }
  if (isMockupOrProductElement(raster) || raster.clipMask) {
    console.error("[MOCKUP_LOCK]: Intento de usar plantilla/máscara de producto como imagen. Cancelado.");
    return null;
  }
  if (typeof window.saveHistory === 'function') window.saveHistory();

  const originalIsHole = !!(vector.data && vector.data.isHole);
  const fusionId = 'fus_' + Date.now() + '_' + Math.floor(Math.random()*10000);

  const absoluteVector = getAbsoluteClone(vector);
  const absoluteRaster = getAbsoluteClone(raster);
  const originalVectorGeom = absoluteVector.clone({ insert: false });
  let originalRasterGeom = absoluteRaster.clone({ insert: false });

  let maskItem = null;
  const fusionGroup = new paper.Group();

  if (mode === 'calar') {
    const outerRect = new paper.Path.Rectangle(absoluteRaster.bounds);
    const inverseMask = new paper.CompoundPath({ insert: false });
    inverseMask.fillRule = 'evenodd';
    inverseMask.addChild(outerRect);
    inverseMask.addChild(absoluteVector.clone());
    inverseMask.clipMask = true;
    maskItem = inverseMask;
    fusionGroup.addChild(maskItem);
    fusionGroup.addChild(absoluteRaster.clone());
  } else {
    maskItem = absoluteVector.clone();
    maskItem.clipMask = true;
    fusionGroup.addChild(maskItem);
    // Ajuste automático solo al crear una fusión nueva. Al aceptar una
    // edición interna, se conserva exactamente la transformación del usuario.
    const rasterCloneFit = absoluteRaster.clone();
    if (!preserveRasterTransform) {
      try {
        const placement = calculateCoverPlacement(maskItem, rasterCloneFit);
        if (placement && placement.scale > 0) {
          if (Math.abs(placement.scale - 1) > 0.001) {
            rasterCloneFit.scale(placement.scale, rasterCloneFit.bounds.center);
          }
          rasterCloneFit.position = rasterCloneFit.position.add(
            maskItem.bounds.center.subtract(rasterCloneFit.bounds.center)
          );
        }
      } catch(e){}
    }
    fusionGroup.addChild(rasterCloneFit);
    originalRasterGeom = rasterCloneFit.clone({ insert: false });
  }

  const receiverContainmentKey = vector.data?.containmentKey || null;
  const ownerContainmentKey = vector.data?.isHole
    ? (vector.data.ownerContainmentKey || null)
    : receiverContainmentKey;

  fusionGroup.clipped = true;
  fusionGroup.data = {
    isSmartFusion: true,
    fusionId: fusionId,
    fusionMode: mode,
    originalVectorData: originalVectorGeom,
    originalRasterData: originalRasterGeom,
    originalIsHole: originalIsHole,
    vectorId: vector.id,
    rasterId: raster.id,
    containmentScope: vector.data?.containmentScope || null,
    containmentKey: receiverContainmentKey,
    ownerContainmentKey,
    receiverKind: originalIsHole ? 'hole' : 'solid',
    label: mode === 'calar' ? "Fusión Calada" : "Fusión Inteligente"
  };
  fusionGroup.data.isHole = (mode === 'calar');
  fusionGroup.data.geomBase = originalVectorGeom.clone({ insert: false });
  maskItem.data = {
    ...(maskItem.data || {}),
    isFusionMask: true,
    isHole: originalIsHole,
    geomBase: originalVectorGeom.clone({ insert: false }),
    containmentScope: vector.data?.containmentScope || null,
    containmentKey: receiverContainmentKey,
    ownerContainmentKey
  };

  overrideChildrenSelection(fusionGroup);

  try {
    Object.defineProperty(fusionGroup, 'selected', {
      get: function() { return this._selected; },
      set: function(val) { this._selected = val; },
      configurable: true, enumerable: true
    });
    Object.defineProperty(fusionGroup, 'bounds', {
      get: function() { return this.children[0] ? this.children[0].bounds : new paper.Rectangle(); },
      configurable: true, enumerable: true
    });
  } catch(e) {}

  const vectorParent = vector.parent;
  const rasterParent = raster.parent;
  vector.remove();
  raster.remove();
  cleanEmptyClipGroup(vectorParent);
  cleanEmptyClipGroup(rasterParent);
  absoluteVector.remove();
  absoluteRaster.remove();

  let finalItem = fusionGroup;
  if (typeof window.clipItem === 'function' && !window.infiniteCanvasMode && window.clipMask) {
    finalItem = window.clipItem(fusionGroup);
  }
  if (finalItem !== fusionGroup) {
    // clipItem puede envolver la fusión en otro grupo. La metadata pública
    // debe vivir también en el elemento que queda seleccionado y que leen
    // selection.js / panelCommandBridge.js.
    finalItem.data = {
      ...(finalItem.data || {}),
      ...fusionGroup.data,
      isSmartFusion: true,
      fusionId,
      fusionMode: mode,
      originalIsHole
    };
    try {
      Object.defineProperty(finalItem, 'selected', {
        get: function() { return this._selected; },
        set: function(val) { this._selected = val; if (fusionGroup) fusionGroup.selected = val; },
        configurable: true, enumerable: true
      });
    } catch(e) {}
  }

  const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
  designLayer.addChild(finalItem);
  if (window.currentMockup) finalItem.insertBelow(window.currentMockup);

  // Registrar la fusión y derivar el hueco virtual desde su máscara actual.
  registerFusion(finalItem, {
    fusionId,
    mode,
    originalIsHole
  });

  if (typeof window.syncGeometryToGeomBase === 'function') window.syncGeometryToGeomBase(finalItem);
  if (typeof recalculateDynamicSubtractions === 'function') recalculateDynamicSubtractions();
  if (typeof window.deselectItem === 'function') window.deselectItem();
  if (typeof window.selectItem === 'function') window.selectItem(finalItem);
  paper.view.update();

  // Flash de éxito: contorno NEON FUCSIA breve (600ms) → feedback visual "¡se fusionó!"
  try {
    const maskForFlash = fusionGroup.children && fusionGroup.children[0];
    if (maskForFlash) {
      const flash = getAbsoluteClone(maskForFlash);
      flash.data = { isSelectionBox: true, isSmartGuide: true };
      flash.clipMask = false;
      flash.fillColor = null;
      flash.strokeColor = new paper.Color(NEON_FUCHSIA);
      flash.strokeWidth = 3 / (paper.view.zoom || 1);
      flash.shadowColor = new paper.Color(NEON_FUCHSIA);
      flash.shadowBlur = 16 / (paper.view.zoom || 1);
      flash.bringToFront();
      paper.view.update();
      setTimeout(function(){ try { flash.remove(); paper.view.update(); } catch(e){} }, 650);
    }
  } catch(e){}

  return finalItem;
}

/* ------------------------------------------------------------------------
   SNAPPING MAGNÉTICO REESCRITO (v46.0): preview sin mover la foto real.
   Se llama desde selection.js en onMouseDrag cuando se arrastra un Raster.
------------------------------------------------------------------------ */
export function checkMagneticSnapping(rasterItem, mousePoint) {
  // Durante la edición interna la imagen ya está dentro de una fusión.
  // Nunca debe activar snap, halo fucsia ni buscar otro receptor.
  if (window.fusionEditActive || window._fusionEditState) {
    clearFusionPreview(true);
    window._fusionSnapActive = false;
    window._activeSnappedVector = null;
    return false;
  }
  if (!rasterItem || !paper.project) return false;
  const best = findBestSnapReceptor(rasterItem, mousePoint);
  if (best) {
    drawFusionPreview(rasterItem, best);
    activeSnappedVector = best.item;
    activeSnappedRaster = rasterItem;
    window._fusionSnapActive = true;
    window._activeSnappedVector = best.item;
    paper.view.update();
    return true;
  } else {
    clearFusionPreview(true);
    window._fusionSnapActive = false;
    window._activeSnappedVector = null;
    paper.view.update();
    return false;
  }
}

/* ------------------------------------------------------------------------
   CONSOLIDACIÓN EN EL DROP: si hay receptor activo, fusiona (auto-modo).
   Se llama desde selection.js en onMouseUp.
------------------------------------------------------------------------ */
export function handleMagneticDrop(rasterItem) {
  try {
    if (window.fusionEditActive || window._fusionEditState) {
      clearFusionPreview(true);
      window._fusionSnapActive = false;
      window._activeSnappedVector = null;
      return false;
    }
    const snapped = activeSnappedVector || window._activeSnappedVector;
    const raster = rasterItem || activeSnappedRaster;
    clearFusionPreview(true);
    window._fusionSnapActive = false;
    window._activeSnappedVector = null;
    if (snapped && raster && paper) {
      if (!snapped.project || !raster.project) {
        console.warn("[FUSION DROP] Referencia inválida (el ítem ya no existe en el proyecto).");
        return false;
      }
      const fusion = applySmartFusion(snapped, raster, 'intersecar');
      return !!fusion;
    }
    return false;
  } catch (e) {
    console.error("[FUSION DROP ERROR]", e);
    clearFusionPreview(true);
    window._fusionSnapActive = false;
    window._activeSnappedVector = null;
    return false;
  }
}

// ==============================================
// AL SOLTAR LA IMAGEN: SOLO FUSIONAR SI ESTÁ SOBRE SILUETA
// ==============================================
function shouldFusionOnDrop(event) {
  // ❌ Si estamos en edición interna → NO fusionar
  if (window.fusionEditActive || window._fusionEditState) {
    return false;
  }

  // Obtener punto EXACTO del puntero
  const hitPoint = paper.view.getEventPoint(event);

  // ¿El puntero está SOBRE una silueta válida del SVG cargado?
  const hit = paper.project.hitTest(hitPoint, {
    fill: true,
    stroke: false,
    tolerance: 2 / paper.view.zoom
  });

  // Solo fusionar si hay impacto y es un receptor válido
  if (!hit || !hit.item || !isValidReceptorItem(hit.item)) {
    return false; // Soltó en el vacío → imagen queda libre
  }

  return hit.item; // Devuelve el vector bajo el puntero
}

// Dentro de checkMagneticSnapping: DESACTIVAR SNAP en edición
const originalCheckMagneticSnapping = window.checkMagneticSnapping;
window.checkMagneticSnapping = function(event) {
  if (window.fusionEditActive || window._fusionEditState) {
    clearFusionPreview(true);
    return; // ❌ NO se enciende fucsia mientras se edita
  }
  return originalCheckMagneticSnapping ? originalCheckMagneticSnapping.call(this, event) : null;
};

// Helper: identificar siluetas válidas del cliente
function isValidReceptorItem(item) {
  if (!item) return false;
  if (isValidFusionReceptor(item)) return true;
  const d = item.data || {};
  return d.isCalado || d.isSolidShape || d.userImported;
}


/* ------------------------------------------------------------------------
   RECALCULAR FUSIÓN (ambos modos) ante Edición de Nodos en caliente.
------------------------------------------------------------------------ */
export function recalculateSmartFusion(fusionGroup) {
  if (!fusionGroup || !fusionGroup.data || !fusionGroup.data.isSmartFusion) return;
  const mode = fusionGroup.data.fusionMode;
  const maskItem = fusionGroup.children[0];
  const rasterItem = fusionGroup.children[1];
  if (!maskItem || !rasterItem) return;
  const currentVector = fusionGroup.data.originalVectorData;
  if (!currentVector) return;

  if (mode === 'calar') {
    const outerRect = new paper.Path.Rectangle(rasterItem.bounds);
    const newInverseMask = new paper.CompoundPath({ insert: false });
    newInverseMask.fillRule = 'evenodd';
    newInverseMask.addChild(outerRect);
    newInverseMask.addChild(currentVector.clone());
    newInverseMask.fillColor = null; newInverseMask.strokeColor = null; newInverseMask.strokeWidth = 0;
    newInverseMask.data = {
      ...(newInverseMask.data || {}),
      isFusionMask: true,
      isHole: !!fusionGroup.data.originalIsHole,
      geomBase: currentVector.clone({ insert: false }),
      containmentScope: fusionGroup.data.containmentScope || null,
      containmentKey: fusionGroup.data.containmentKey || null,
      ownerContainmentKey: fusionGroup.data.ownerContainmentKey || null
    };
    try { Object.defineProperty(newInverseMask, 'selected', { get(){return false;}, set(){}, configurable:true, enumerable:true }); } catch(e){}
    newInverseMask.clipMask = true;
    maskItem.replaceWith(newInverseMask);
  } else {
    const newMask = currentVector.clone({ insert: false });
    newMask.clipMask = true;
    newMask.fillColor = null; newMask.strokeColor = null;
    newMask.data = {
      ...(newMask.data || {}),
      isFusionMask: true,
      isHole: !!fusionGroup.data.originalIsHole,
      geomBase: currentVector.clone({ insert: false }),
      containmentScope: fusionGroup.data.containmentScope || null,
      containmentKey: fusionGroup.data.containmentKey || null,
      ownerContainmentKey: fusionGroup.data.ownerContainmentKey || null
    };
    try { Object.defineProperty(newMask, 'selected', { get(){return false;}, set(){}, configurable:true, enumerable:true }); } catch(e){}
    maskItem.replaceWith(newMask);
  }
  paper.view.update();
}

/* ------------------------------------------------------------------------
   DISOLVER FUSIÓN — FIX: no re-asigna .position (clones absolutos) y
   preserva isHole original. Quita el hueco virtual si existía.
------------------------------------------------------------------------ */
export function releaseSmartFusion(item = null) {
  if (!item) {
    const selectedItems = Array.isArray(window.selectedItems) ? window.selectedItems.filter(Boolean) : [];
    item = selectedItems.length > 1
      ? selectedItems
      : (window.selectedItem || selectedItems[0] || null);
  }
  if (!item) return null;
  let targetItem = item;
  if (Array.isArray(item)) {
    // Liberar TODAS las fusiones encontradas en la selección (no solo la primera)
    let any = false;
    for (let i = 0; i < item.length; i++) {
      const found = findSmartFusionContainer(item[i]);
      if (found) { try { releaseSmartFusion(found); any = true; } catch(e){ console.error("[RELEASE MULTI ERROR]", e); } }
    }
    if (any) {
      if (typeof recalculateDynamicSubtractions === 'function') recalculateDynamicSubtractions();
      paper.view.update();
      return true;
    }
    return null;
  }
  let fusionGroup = findSmartFusionContainer(targetItem);
  const fusionRecord = resolveFusionRecord(fusionGroup);
  if (fusionRecord?.group) fusionGroup = fusionRecord.group;
  if (!fusionGroup || !fusionGroup.data || !fusionGroup.data.isSmartFusion) {
    console.warn("[RELEASE_LOCK]: El elemento seleccionado no es parte de una Fusión Inteligente activa.");
    return null;
  }
  if (typeof window.saveHistory === 'function') window.saveHistory();

  try {
  if (fusionGroup.data.fusionId) {
    removeFusionRecord(fusionGroup.data.fusionId);
  }

  const restoredVector = fusionGroup.data.originalVectorData.clone();
  const restoredRaster = fusionGroup.data.originalRasterData.clone();
  const originalIsHole = !!(fusionGroup.data.originalIsHole);
  // Restaurar en la posición ACTUAL (si el usuario arrastró la fusión), no en la original
  try {
    const curMask = fusionGroup.children && fusionGroup.children[0];
    if (curMask && curMask.bounds && restoredVector.bounds) {
      const delta = curMask.bounds.center.subtract(restoredVector.bounds.center);
      if (delta.length > 0.01) {
        restoredVector.translate(delta);
        restoredRaster.translate(delta);
      }
    }
  } catch(e){}
  restoredVector.data = {
    ...(fusionGroup.data.originalVectorData?.data || {}),
    isHole: originalIsHole,
    isFusionReceptor: originalIsHole,
    containmentScope: fusionGroup.data.containmentScope || null,
    containmentKey: fusionGroup.data.containmentKey || null,
    ownerContainmentKey: fusionGroup.data.ownerContainmentKey || null,
    label: originalIsHole ? "Trazado Calado" : "Trazado Vectorial"
  };
  if (originalIsHole) {
    restoredVector.fillColor = new paper.Color(0, 0, 0, 0.0001);
    restoredVector.strokeColor = null;
    restoredVector.strokeWidth = 0;
  }
  restoredRaster.data = { label: "Imagen" };

  let finalVector = restoredVector, finalRaster = restoredRaster;
  if (typeof window.clipItem === 'function' && !window.infiniteCanvasMode && window.clipMask) {
    finalVector = window.clipItem(restoredVector);
    finalRaster = window.clipItem(restoredRaster);
  } else {
    paper.project.activeLayer.addChild(finalVector);
    paper.project.activeLayer.addChild(finalRaster);
  }
  if (window.currentMockup) {
    finalVector.insertBelow(window.currentMockup);
    finalRaster.insertBelow(window.currentMockup);
  }
  if (typeof window.syncGeometryToGeomBase === 'function') {
    window.syncGeometryToGeomBase(finalVector);
    window.syncGeometryToGeomBase(finalRaster);
  }
  const parentGroup = fusionGroup.parent;
  fusionGroup.remove();
  cleanEmptyClipGroup(parentGroup);
  if (typeof window.deselectItem === 'function') window.deselectItem();
  if (typeof window.selectItem === 'function') window.selectItem(finalRaster);
  if (typeof recalculateDynamicSubtractions === 'function') recalculateDynamicSubtractions();
  paper.view.update();
  return [finalVector, finalRaster];
  } catch (e) {
    console.error("[RELEASE FUSION ERROR]", e);
    window.fusionEditActive = false;
    window._fusionSnapActive = false;
    if (typeof window.deselectItem === 'function') { try { window.deselectItem(); } catch(e2){} }
    paper.view.update();
    return null;
  }
}

/* ------------------------------------------------------------------------
   DISPATCHER para botón "Fusionar" explícito.
------------------------------------------------------------------------ */
export function applyFusionFromSelection(mode = 'intersecar') {
  try {
  const selected = Array.isArray(window.selectedItems) && window.selectedItems.length
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);
  if (selected.length < 2) {
    alert("Selecciona una imagen y un vector (hueco o silueta) para fusionar.");
    return null;
  }
  let raster = null, vector = null;
  for (let i = 0; i < selected.length; i++) {
    const raw = selected[i];
    const candidateRaster = findFusionRaster(raw);
    const candidateVector = findFusionVector(raw);
    if (candidateRaster && !raster) raster = candidateRaster;
    if (candidateVector && !vector) vector = candidateVector;
  }
  if (!raster || !vector) {
    alert("Necesitas seleccionar exactamente una IMAGEN y un VECTOR (o hueco).");
    return null;
  }
  return applySmartFusion(vector, raster, mode);
  } catch (e) {
    console.error("[FUSION FROM SELECTION ERROR]", e);
    window._fusionSnapActive = false;
    if (typeof window.clearFusionPreview === 'function') { try { window.clearFusionPreview(); } catch(e2){} }
    paper.view.update();
    return null;
  }
}

/* ------------------------------------------------------------------------
   DISPATCHER COMPATIBLE PARA EL BOTÓN "FUSIONAR"
   El HTML existente llama performSmartFusion().
   La lógica canónica vive en applyFusionFromSelection().
------------------------------------------------------------------------ */
export function performSmartFusion(mode = 'intersecar') {
  return applyFusionFromSelection(mode);
}

/* ------------------------------------------------------------------------
   INICIALIZACIÓN Y EXPOSICIÓN DE API
------------------------------------------------------------------------ */
export function initSmartFusionListeners() {
  if (typeof window !== 'undefined') {
    window.applySmartFusion = applySmartFusion;
    window.checkMagneticSnapping = checkMagneticSnapping;
    window.handleMagneticDrop = handleMagneticDrop;
    window.recalculateSmartFusion = recalculateSmartFusion;
    window.releaseSmartFusion = releaseSmartFusion;
    window.applyFusionFromSelection = applyFusionFromSelection;
    window.findSmartFusionContainer = findSmartFusionContainer;
    window.clearFusionPreview = clearFusionPreview;
    window.initSmartFusionListeners = initSmartFusionListeners;
    window._fusionSnapActive = false;
    window.performSmartFusion = performSmartFusion;
    window.releaseSmartFusion = releaseSmartFusion;
    if (!Array.isArray(window._fusionVirtualHoles)) window._fusionVirtualHoles = [];
  }
  console.log("%c[EKKO SMART FUSION v46.0] Motor de Fusión + Snapping Magnético Canva-Style cargado.", "color: #ff2ea6; font-weight: bold;");
}
// Exponer al navegador DESPUÉS de que todo esté cargado
setTimeout(() => {
  if (typeof performSmartFusion !== 'undefined')
    window.performSmartFusion = performSmartFusion;
  if (typeof releaseSmartFusion !== 'undefined')
    window.releaseSmartFusion = releaseSmartFusion;
}, 0);

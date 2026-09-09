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
  let curr = item;
  while (curr) {
    if (curr.clipMask || (curr.data && (curr.data.mockup || curr.data.isMask || curr.data.wasClipMask))) return true;
    if (curr === window.currentMockup) return true;
    curr = curr.parent;
  }
  return false;
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
  if (!item) return null;
  const clone = item.clone({ insert: false });
  const globalMat = item.globalMatrix.clone();
  paper.project.activeLayer.addChild(clone);
  if (clone.className === 'Path' || clone.className === 'CompoundPath') {
    bakeMatrixIntoPath(clone, globalMat);
    clone.matrix = new paper.Matrix();
  } else {
    clone.matrix = globalMat;
  }
  return clone;
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
   REGISTRO DE HUECOS VIRTUALES SUSTRACTIVOS
   Cuando se fusiona una imagen DENTRO de un hueco real (isHole), el hueco
   deja de existir como ítem pero debe SEGUIR RESTANDO del sólido (si no,
   el sólido se rellena de negro y se grabaría dos veces en LightBurn).
------------------------------------------------------------------------ */
function ensureVirtualHoleRegistry() {
  if (!Array.isArray(window._fusionVirtualHoles)) window._fusionVirtualHoles = [];
}

function registerVirtualHole(absoluteGeom, fusionId) {
  if (!absoluteGeom) return;
  ensureVirtualHoleRegistry();
  const clone = absoluteGeom.clone({ insert: false });
  clone.matrix = new paper.Matrix();
  window._fusionVirtualHoles.push({ geom: clone, fusionId: fusionId });
}

function unregisterVirtualHole(fusionId) {
  if (!Array.isArray(window._fusionVirtualHoles)) return;
  window._fusionVirtualHoles = window._fusionVirtualHoles.filter(h => {
    if (h.fusionId === fusionId) { try { h.geom.remove(); } catch(e){} return false; }
    return true;
  });
}

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
    if (display.className === 'Path' || display.className === 'CompoundPath') {
      if (display.closed || display.className === 'CompoundPath') {
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
function findBestSnapReceptor(rasterItem) {
  const receptors = getFusionReceptors();
  if (receptors.length === 0) return null;
  const rBounds = rasterItem.bounds;
  if (!rBounds) return null;
  const rCenter = rBounds.center;
  let best = null;
  let bestScore = -1;
  receptors.forEach(rec => {
    const vBounds = rec.item.bounds;
    if (!vBounds) return;
    let score = 0;
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
  if (best && bestScore < 30) return null;
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
export function applySmartFusion(vector, raster, mode = 'intersecar') {
  if (!vector || !raster || !paper) return null;
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
    // Auto-ajuste Canva: centrar y escalar la imagen para CUBRIR el hueco (sin recortes internos)
    const rasterCloneFit = absoluteRaster.clone();
    try {
      const mb = maskItem.bounds;
      const rb = rasterCloneFit.bounds;
      if (mb && rb && rb.width > 0.1 && rb.height > 0.1) {
        const scaleFactor = Math.max(mb.width / rb.width, mb.height / rb.height);
        if (scaleFactor > 0 && Math.abs(scaleFactor - 1) > 0.001) {
          rasterCloneFit.scale(scaleFactor, rb.center);
        }
        const newCenter = rasterCloneFit.bounds.center;
        rasterCloneFit.position = rasterCloneFit.position.add(mb.center.subtract(newCenter));
      }
    } catch(e){}
    fusionGroup.addChild(rasterCloneFit);
    originalRasterGeom = rasterCloneFit.clone({ insert: false });
  }

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
    label: mode === 'calar' ? "Fusión Calada" : "Fusión Inteligente"
  };
  fusionGroup.data.isHole = (mode === 'calar');
  fusionGroup.data.geomBase = (mode === 'calar') ? originalVectorGeom.clone({ insert: false }) : null;
  maskItem.data = { ...(maskItem.data || {}), isHole: false, geomBase: null };

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

  // Si fusionamos DENTRO de un hueco real, registrarlo como hueco virtual sustractivo
  if (mode === 'intersecar' && originalIsHole) {
    registerVirtualHole(originalVectorGeom, fusionId);
  }

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
export function checkMagneticSnapping(rasterItem) {
  if (!rasterItem || !paper.project) return false;
  const best = findBestSnapReceptor(rasterItem);
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
      applySmartFusion(snapped, raster, 'intersecar');
      return true;
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
    newInverseMask.data = { ...(newInverseMask.data || {}), isHole: false, geomBase: null };
    try { Object.defineProperty(newInverseMask, 'selected', { get(){return false;}, set(){}, configurable:true, enumerable:true }); } catch(e){}
    newInverseMask.clipMask = true;
    maskItem.replaceWith(newInverseMask);
  } else {
    const newMask = currentVector.clone({ insert: false });
    newMask.clipMask = true;
    newMask.fillColor = null; newMask.strokeColor = null;
    newMask.data = { ...(newMask.data || {}), isHole: false, geomBase: null };
    try { Object.defineProperty(newMask, 'selected', { get(){return false;}, set(){}, configurable:true, enumerable:true }); } catch(e){}
    maskItem.replaceWith(newMask);
  }
  paper.view.update();
}

/* ------------------------------------------------------------------------
   DISOLVER FUSIÓN — FIX: no re-asigna .position (clones absolutos) y
   preserva isHole original. Quita el hueco virtual si existía.
------------------------------------------------------------------------ */
export function releaseSmartFusion(item) {
  if (!item) return null;
  let targetItem = item;
  if (Array.isArray(item)) {
    for (let i = 0; i < item.length; i++) {
      const found = findSmartFusionContainer(item[i]);
      if (found) { targetItem = found; break; }
    }
  }
  let fusionGroup = findSmartFusionContainer(targetItem);
  // Fallback: si no se encontró y hay exactamente 1 fusión en el proyecto, usarla
  if (!fusionGroup && paper && paper.project) {
    try {
      const allF = paper.project.getItems({ match: function(it){ return it.data && it.data.isSmartFusion; } });
      if (allF && allF.length === 1) fusionGroup = allF[0];
    } catch(e){}
  }
  if (!fusionGroup || !fusionGroup.data || !fusionGroup.data.isSmartFusion) {
    console.warn("[RELEASE_LOCK]: El elemento seleccionado no es parte de una Fusión Inteligente activa.");
    return null;
  }
  if (typeof window.saveHistory === 'function') window.saveHistory();

  try {
  if (fusionGroup.data.fusionId) unregisterVirtualHole(fusionGroup.data.fusionId);

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
    isHole: originalIsHole,
    isFusionReceptor: originalIsHole,
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
  const selected = window.selectedItems || (window.selectedItem ? [window.selectedItem] : []);
  if (selected.length < 2) {
    alert("Selecciona una imagen y un vector (hueco o silueta) para fusionar.");
    return null;
  }
  let raster = null, vector = null;
  for (let i = 0; i < selected.length; i++) {
    const it = getContentItem(selected[i]);
    if (!it) continue;
    if (it.className === 'Raster' && !raster) raster = it;
    else if ((it.className === 'Path' || it.className === 'CompoundPath') && !vector) vector = it;
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
    ensureVirtualHoleRegistry();
  }
  console.log("%c[EKKO SMART FUSION v46.0] Motor de Fusión + Snapping Magnético Canva-Style cargado.", "color: #ff2ea6; font-weight: bold;");
}


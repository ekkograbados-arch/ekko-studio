/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/fusionEditMode.js
ACCIÓN: REEMPLAZAR (v1.3 — clipGroup seguro y sin wrappers recursivos)
  - Doble clic sobre una fusión → entra en modo edición.
  - Imagen libre translúcida (transformable), silueta en NEON CIAN.
  - Salida: Enter / clic derecho / clic fuera → acepta. Escape → cancela.
  - Todo envuelto en try/catch con limpieza de estado (no congela el lienzo).
DEPENDENCIAS: smartFusion.js (applySmartFusion)
======================================================================== */
import { applySmartFusion } from "./smartFusion.js";

const NEON_CYAN = '#00e5ff';
let editState = null;

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

function cleanupEditState() {
  editState = null;
  window._fusionEditState = null;
  window.fusionEditActive = false;
  if (paper.view && paper.view.element) paper.view.element.style.cursor = 'default';
}

function resolveFusionGroup(item) {
  let curr = item;
  while (curr) {
    if (curr.data && curr.data.isSmartFusion) {
      if (curr.data.clipGroup && curr.children) {
        const nested = curr.children.find(child =>
          child && child.data && child.data.isSmartFusion &&
          child.children && child.children.length >= 2
        );
        if (nested) return nested;
      }
      return curr;
    }
    curr = curr.parent;
  }
  return null;
}

// Elimina imágenes/contornos huérfanos de sesiones de edición fallidas (evita duplicados)
function cleanupStrayEditItems() {
  try {
    if (!paper || !paper.project) return;
    paper.project.getItems({ match: function(it){ return it.data && (it.data.fusionEditRaster || it.data.fusionEditMask); } }).forEach(function(it){
      try { it.remove(); } catch(e){}
    });
  } catch(e){}
}

/* ------------------------------------------------------------------------
   ENTRAR al modo edición interna.
------------------------------------------------------------------------ */
export function enterFusionEditMode(fusionItem) {
  if (!fusionItem || window.nodeEditMode) return;
  if (window.fusionEditActive) { try { exitFusionEditMode(true); } catch(e){} }

  // La imagen entra en edición interna: limpiar cualquier estado de snap
  // externo antes de extraerla del grupo de fusión.
  if (typeof window.clearFusionPreview === 'function') {
    try { window.clearFusionPreview(true); } catch (e) {}
  }
  window._fusionSnapActive = false;
  window._activeSnappedVector = null;
  window._lastDraggedRaster = null;

  cleanupStrayEditItems();

  const fusionGroup = resolveFusionGroup(fusionItem);
  if (!fusionGroup || !fusionGroup.children || fusionGroup.children.length < 2) return;

  try {
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const maskChild = fusionGroup.children[0];
    const rasterChild = fusionGroup.children[1];
    if (!rasterChild || rasterChild.className !== 'Raster') return;

    const mode = fusionGroup.data.fusionMode || 'intersecar';
    const originalIsHole = !!(fusionGroup.data.originalIsHole);
    const fusionId = fusionGroup.data.fusionId;
    const vectorData = fusionGroup.data.originalVectorData;
    if (!vectorData) return;

    // Quitar temporalmente el hueco virtual (se re-registra al re-fusionar)
    if (Array.isArray(window._fusionVirtualHoles)) {
      window._fusionVirtualHoles = window._fusionVirtualHoles.filter(h => {
        if (h.fusionId === fusionId) { try { h.geom.remove(); } catch(e){} return false; }
        return true;
      });
    }

    const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
    const zoom = paper.view.zoom || 1.0;

    // 1. Extraer la imagen → libre, translúcida, transformable
    rasterChild.remove();
    rasterChild.opacity = 0.6;
    rasterChild.data = { ...(rasterChild.data || {}), fusionEditRaster: true, label: "Imagen (editando fusión)" };
    rasterChild.selected = false;
    designLayer.addChild(rasterChild);
    if (window.currentMockup) rasterChild.insertBelow(window.currentMockup);

    // 2. Extraer la máscara → contorno NEON CIAN independiente (no depende de clipGroup)
    let cyanOutline = null;
    try {
      cyanOutline = vectorData.clone({ insert: false });
      cyanOutline.matrix = new paper.Matrix();
      cyanOutline.data = { fusionEditMask: true, isSelectionBox: true };
      cyanOutline.fillColor = new paper.Color(0, 0.9, 1, 0.06);
      cyanOutline.strokeColor = new paper.Color(NEON_CYAN);
      cyanOutline.strokeWidth = 2.5 / zoom;
      cyanOutline.shadowColor = new paper.Color(NEON_CYAN);
      cyanOutline.shadowBlur = 14 / zoom;
      designLayer.addChild(cyanOutline);
      if (window.currentMockup) cyanOutline.insertBelow(window.currentMockup);
      cyanOutline.bringToFront();
    } catch(e) { cyanOutline = null; }

    // 3. Remover el grupo de fusión viejo (ya extrajimos ambos hijos)
    try { maskChild.remove(); } catch(e){}
    const parentGroup = fusionGroup.parent;
    try { fusionGroup.remove(); } catch(e){}
    if (parentGroup && parentGroup.data && parentGroup.data.clipGroup) {
      const kids = parentGroup.children.filter(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
      if (kids.length === 0) try { parentGroup.remove(); } catch(e){}
    }

    editState = {
      cyanOutline,
      freeRaster: rasterChild,
      originalRasterData: fusionGroup.data.originalRasterData,
      mode,
      vectorData,
      originalIsHole,
      fusionId
    };
    window._fusionEditState = editState;
    window.fusionEditActive = true;

    if (typeof window.deselectItem === 'function') window.deselectItem();
    if (typeof window.selectItem === 'function') window.selectItem(rasterChild);
    if (paper.view && paper.view.element) paper.view.element.style.cursor = 'move';
    paper.view.update();

    // Listener de clic fuera → aceptar y salir (estilo AutoCAD), fuertemente protegido
    if (!window._fusionEditOutsideBound) {
      window._fusionEditOutsideBound = true;
      const canvas = document.getElementById('editorCanvas') || (paper.view && paper.view.element);
      if (canvas) {
        canvas.addEventListener('mousedown', function() {
          try {
            if (!window.fusionEditActive || !editState) return;
            // Si se está arrastrando la imagen o un tirador, no salir
            if (window.dragging || window.resizeActive || window.rotationActive) return;
            setTimeout(() => {
              try {
                if (window.fusionEditActive && !window.dragging) exitFusionEditMode(true);
              } catch(e){ console.error("[FUSION EXIT OUTSIDE ERROR]", e); cleanupEditState(); }
            }, 0);
          } catch(e){}
        });
      }
    }
  } catch (e) {
    console.error("[FUSION ENTER EDIT ERROR]", e);
    cleanupEditState();
    if (typeof window.deselectItem === 'function') { try { window.deselectItem(); } catch(e2){} }
    paper.view.update();
  }
}

/* ------------------------------------------------------------------------
   SALIR del modo edición. accept=true → re-fusiona con la imagen movida.
------------------------------------------------------------------------ */
export function exitFusionEditMode(accept = true) {
  if (!window.fusionEditActive || !editState) { cleanupEditState(); return; }
  const st = editState;
  cleanupEditState();

  try {
    const vectorClone = st.vectorData.clone({ insert: false });
    vectorClone.matrix = new paper.Matrix();
    vectorClone.data = { isHole: st.originalIsHole, isFusionReceptor: st.originalIsHole };

    let rasterToUse = null;
    if (accept) {
      rasterToUse = st.freeRaster;
    } else {
      if (st.freeRaster && st.freeRaster.project) {
        try { st.freeRaster.remove(); } catch (e) {}
      }
      rasterToUse = st.originalRasterData
        ? st.originalRasterData.clone({ insert: false })
        : null;
    }
    if (rasterToUse) {
      rasterToUse.opacity = 1;
      rasterToUse.data = { label: "Imagen" };
      rasterToUse.selected = false;
    }

    // Remover contorno cian
    if (st.cyanOutline) { try { st.cyanOutline.remove(); } catch(e){} }

    if (vectorClone && rasterToUse) {
      applySmartFusion(vectorClone, rasterToUse, st.mode, {
        preserveRasterTransform: true
      });
    } else {
      if (vectorClone) try { vectorClone.remove(); } catch(e){}
      if (typeof window.recalculateDynamicSubtractions === 'function') window.recalculateDynamicSubtractions();
    }
    paper.view.update();
  } catch (e) {
    console.error("[FUSION EXIT EDIT ERROR]", e);
    if (st && st.cyanOutline) { try { st.cyanOutline.remove(); } catch(e2){} }
    if (st && st.freeRaster && st.freeRaster.project) { try { st.freeRaster.remove(); } catch(e2){} }
    if (typeof window.recalculateDynamicSubtractions === 'function') { try { window.recalculateDynamicSubtractions(); } catch(e2){} }
    paper.view.update();
  }
}

export function initFusionEditMode() {
  if (typeof window !== 'undefined') {
    window.enterFusionEditMode = enterFusionEditMode;
    window.exitFusionEditMode = exitFusionEditMode;
    window.fusionEditActive = false;
  }
  cleanupStrayEditItems();
  console.log("%c[EKKO FUSION EDIT MODE v1.3] Edición interna (cian neón) + bloqueo de Snap externo cargado.", "color: #00e5ff; font-weight: bold;");
}

initFusionEditMode();
// ==============================================================
// EXPOSICIÓN DE FUNCIONES AL SISTEMA Y AL HTML
// ==============================================================
window.enterFusionEditMode = enterFusionEditMode;
window.exitFusionEditMode = exitFusionEditMode;

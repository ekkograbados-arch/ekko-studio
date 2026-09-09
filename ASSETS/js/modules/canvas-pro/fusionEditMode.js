/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/fusionEditMode.js
ACCIÓN: CREAR (archivo nuevo)
ESTADO: v1.0 — Modo de Edición Interna de Fusión (Canva-Style)
  - Doble clic sobre una fusión → entra en modo edición.
  - La imagen se muestra completa translúcida, seleccionable y transformable
    (arrastrar / escalar / rotar) dentro de la silueta.
  - La silueta del hueco real se colorea NEON AZUL/CIAN indicando "modo edición".
  - Salida: Enter / clic derecho / clic fuera del área de edición → acepta.
    Escape → cancela y restaura.
  - Al aceptar: se re-aplica la fusión con la imagen en su nueva posición.
DEPENDENCIAS: smartFusion.js (applySmartFusion), geometricUngroup.js
======================================================================== */
import { applySmartFusion } from "./smartFusion.js";

const NEON_CYAN = '#00e5ff';

// Estado del modo edición
let editState = null; // { fusionGroup, maskChild, freeRaster, mode, vectorData, originalIsHole, fusionId }

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

/* ------------------------------------------------------------------------
   ENTRAR al modo edición interna.
   fusionGroup: el contenedor isSmartFusion (o su wrapper clipGroup).
------------------------------------------------------------------------ */
export function enterFusionEditMode(fusionItem) {
  if (!fusionItem || window.nodeEditMode) return;
  if (window.fusionEditActive) exitFusionEditMode(true);

  // Localizar el contenedor real isSmartFusion (puede estar dentro de clipGroup)
  let fusionGroup = null;
  let curr = fusionItem;
  while (curr) {
    if (curr.data && curr.data.isSmartFusion) { fusionGroup = curr; break; }
    curr = curr.parent;
  }
  if (!fusionGroup || !fusionGroup.children || fusionGroup.children.length < 2) return;

  if (typeof window.saveHistory === 'function') window.saveHistory();

  const maskChild = fusionGroup.children[0];   // máscara (clipMask)
  const rasterChild = fusionGroup.children[1]; // imagen (Raster)
  if (!rasterChild || rasterChild.className !== 'Raster') return;

  const mode = fusionGroup.data.fusionMode || 'intersecar';
  const originalIsHole = !!(fusionGroup.data.originalIsHole);
  const fusionId = fusionGroup.data.fusionId;
  const vectorData = fusionGroup.data.originalVectorData;
  if (!vectorData) return;

  // Quitar el hueco virtual asociado temporalmente (se re-registrará al re-fusionar)
  if (Array.isArray(window._fusionVirtualHoles)) {
    window._fusionVirtualHoles = window._fusionVirtualHoles.filter(h => {
      if (h.fusionId === fusionId) { try { h.geom.remove(); } catch(e){} return false; }
      return true;
    });
  }

  // 1. Extraer la imagen del grupo recortado y dejarla libre (translúcida)
  const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
  rasterChild.remove();
  rasterChild.opacity = 0.6;
  rasterChild.data = { ...(rasterChild.data || {}), fusionEditRaster: true, label: "Imagen (editando fusión)" };
  rasterChild.selected = false;
  designLayer.addChild(rasterChild);
  if (window.currentMockup) rasterChild.insertBelow(window.currentMockup);

  // 2. Convertir la máscara en contorno NEON CIAN (desactivar recorte temporalmente)
  fusionGroup.clipped = false;
  maskChild.clipMask = false;
  maskChild.data = { ...(maskChild.data || {}), fusionEditMask: true };
  maskChild.fillColor = new paper.Color(0, 0.9, 1, 0.06);
  maskChild.strokeColor = new paper.Color(NEON_CYAN);
  maskChild.strokeWidth = 2.5 / (paper.view.zoom || 1);
  maskChild.shadowColor = new paper.Color(NEON_CYAN);
  maskChild.shadowBlur = 14 / (paper.view.zoom || 1);
  maskChild.bringToFront();

  editState = { fusionGroup, maskChild, freeRaster: rasterChild, mode, vectorData, originalIsHole, fusionId };
  window.fusionEditActive = true;
  window._fusionEditState = editState;

  if (typeof window.deselectItem === 'function') window.deselectItem();
  if (typeof window.selectItem === 'function') window.selectItem(rasterChild);
  if (paper.view && paper.view.element) paper.view.element.style.cursor = 'move';
  paper.view.update();

  // Listener de clic fuera → aceptar y salir (estilo AutoCAD)
  if (!window._fusionEditOutsideBound) {
    window._fusionEditOutsideBound = true;
    const canvas = document.getElementById('editorCanvas') || (paper.view && paper.view.element);
    if (canvas) {
      canvas.addEventListener('mousedown', function onDown(e) {
        if (!window.fusionEditActive || !editState) return;
        // Si el clic es sobre la imagen en edición, no salir (deja arrastrar)
        let pt = null;
        try { pt = paper.view.getEventPoint(e); } catch(err) { pt = null; }
        if (pt && editState.freeRaster && editState.freeRaster.bounds && editState.freeRaster.bounds.contains(pt)) return;
        setTimeout(() => { if (window.fusionEditActive) exitFusionEditMode(true); }, 0);
      });
    }
  }
}

/* ------------------------------------------------------------------------
   SALIR del modo edición. accept=true → re-fusiona con la imagen movida.
   accept=false → restaura la fusión original.
------------------------------------------------------------------------ */
export function exitFusionEditMode(accept = true) {
  if (!window.fusionEditActive || !editState) {
    window.fusionEditActive = false;
    return;
  }
  const st = editState;
  editState = null;
  window._fusionEditState = null;
  window.fusionEditActive = false;

  const vectorClone = st.vectorData.clone({ insert: false });
  vectorClone.data = { isHole: st.originalIsHole, isFusionReceptor: st.originalIsHole };

  let rasterToUse = null;
  if (accept) {
    // Usar la imagen libre (movida por el usuario)
    rasterToUse = st.freeRaster;
    rasterToUse.opacity = 1;
    rasterToUse.data = { label: "Imagen" };
  } else {
    // Cancelar: usar el raster original almacenado (posición inicial)
    rasterToUse = st.freeRaster; // reutilizamos el ítem libre
    // Restaurar posición original desde los datos del grupo
    const origRaster = st.fusionGroup.data.originalRasterData;
    if (origRaster && rasterToUse) {
      rasterToUse.position = origRaster.position.clone();
      rasterToUse.matrix = origRaster.matrix.clone();
    }
    rasterToUse.opacity = 1;
    rasterToUse.data = { label: "Imagen" };
  }

  // Remover el grupo de fusión viejo y la máscara cian
  try { st.maskChild.remove(); } catch(e){}
  const parentGroup = st.fusionGroup.parent;
  try { st.fusionGroup.remove(); } catch(e){}
  if (parentGroup && parentGroup.data && parentGroup.data.clipGroup) {
    const kids = parentGroup.children.filter(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
    if (kids.length === 0) try { parentGroup.remove(); } catch(e){}
  }

  // Re-aplicar la fusión limpia (re-registra hueco virtual, historial, etc.)
  if (vectorClone && rasterToUse) {
    applySmartFusion(vectorClone, rasterToUse, st.mode);
  } else {
    if (vectorClone) try { vectorClone.remove(); } catch(e){}
    if (typeof recalculateDynamicSubtractions === 'function') recalculateDynamicSubtractions();
  }

  if (paper.view && paper.view.element) paper.view.element.style.cursor = 'default';
  paper.view.update();
}

/* ------------------------------------------------------------------------
   Inicialización: exponer API en window.
------------------------------------------------------------------------ */
export function initFusionEditMode() {
  if (typeof window !== 'undefined') {
    window.enterFusionEditMode = enterFusionEditMode;
    window.exitFusionEditMode = exitFusionEditMode;
    window.fusionEditActive = false;
  }
  console.log("%c[EKKO FUSION EDIT MODE v1.0] Edición interna de fusión (cian neón) cargada.", "color: #00e5ff; font-weight: bold;");
}

initFusionEditMode();

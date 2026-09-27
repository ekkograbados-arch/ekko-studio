import { interactionOwner } from "./interactionOwner.js";
import { updateVirtualHole } from "./fusionCore.js";

export let editState = null;
export let fusionEditActive = false;

function pointHits(item, point) {
  if (!item || !point) return false;
  try {
    if (item.contains?.(point)) return true;
    return !!item.hitTest?.(point, {
      fill: true, stroke: true, segments: true,
      tolerance: 6 / (paper.view?.zoom || 1)
    });
  } catch (e) { return false; }
}

function pointInsideMask(point, mask) {
  return pointHits(mask, point);
}

function toParentDelta(item, delta) {
  if (!item?.parent?.globalToLocal || !item.localToGlobal) return delta;
  try {
    const origin = item.localToGlobal(new paper.Point(0, 0));
    return item.parent.globalToLocal(origin.add(delta))
      .subtract(item.parent.globalToLocal(origin));
  } catch (e) { return delta; }
}

function cleanupEditVisuals(st) {
  try { if (st.editSyncTimer) clearInterval(st.editSyncTimer); } catch (e) {}
  try { st.tempImage?.remove?.(); } catch (e) {}
  try { st.previewOutline?.remove?.(); } catch (e) {}
  try { st.ghost?.remove?.(); } catch (e) {}
  // El wrapper de edicion solo contenia clones de trabajo; al vaciarse se
  // elimina para no dejar grupos huerfanos en la capa.
  try {
    if (st.editWrapper && !st.editWrapper?.children?.length) st.editWrapper.remove?.();
    else st.editWrapper?.remove?.();
  } catch (e) {}
}

/** El fantasma espeja la matriz global de la imagen editable, expresada
 *  en el sistema local de su propio padre. Asi la referencia externa nunca
 *  se desfasa, la muevan flechas, arrastre o tiradores. */
export function syncEditGhost() {
  const st = editState;
  try {
    if (!st?.ghost?.project || !st?.tempImage?.project) return false;
    const parentInv = st.ghost.parent?.globalMatrix?.inverted?.() || new paper.Matrix();
    st.ghost.matrix = parentInv.concatenate(st.tempImage.globalMatrix);
    return true;
  } catch (_) { return false; }
}

export function enterFusionEditMode(fusionGroup) {
  if (!fusionGroup?.data?.fusionId) return false;
  if (fusionEditActive) exitFusionEditMode(false);

  const data = fusionGroup.data;
  const mask = data.maskGroup?.children?.[0] || data.originalVector ||
    fusionGroup.children?.find(child => child?.clipMask || child?.data?.isFusionMask);
  const image = fusionGroup.children?.find(child =>
    child?.name === "fusion-image" || child?.className === "Raster");
  if (!mask || !image) return false;
  const controller = window.EKKO_FUSION_CONTROLLER;
  const controllerTransaction = controller?.beginFusionEdit?.(fusionGroup) || null;

  // El proxy editable vive a NIVEL CAPA dentro de su propio wrapper de
  // recorte (mascara = clon del vector actual). Asi es un Raster publico
  // normal: tiene caja, tiradores y herramientas de imagen, y lo que se ve
  // fuera del vector es el fantasma de referencia, no geometria recortada.
  const designLayer = paper.project?.layers?.find(layer => layer?.name === 'designLayer')
    || paper.project?.activeLayer || null;
  const tempImage = image.clone({ insert: false });
  tempImage.name = "fusion-temp-image";
  tempImage.opacity = 1;
  tempImage.locked = false;
  tempImage.clipMask = false;
  tempImage.applyMatrix = false;
  tempImage.data = { ...(tempImage.data || {}), isFusionEditProxy: true };
  const editMask = mask.clone({ insert: false });
  editMask.clipMask = true;
  editMask.fillColor = null; editMask.strokeColor = null;
  const editWrapper = new paper.Group({ insert: false });
  editWrapper.addChild(editMask);
  editWrapper.addChild(tempImage);
  editWrapper.clipped = true;
  editWrapper.data = { isFusionEditClip: true, fusionId: data.fusionId, locked: false };
  if (designLayer) designLayer.addChild(editWrapper);
  // La matriz global del proxy reproduce la de la imagen interna para que no
  // haya ningun salto visual al entrar.
  try {
    const parentInv = editWrapper.parent?.globalMatrix?.inverted?.() || new paper.Matrix();
    tempImage.matrix = parentInv.concatenate(image.globalMatrix);
  } catch (_) {}

  // Fantasma de referencia: la imagen completa con transparencia, DEBAJO del
  // wrapper de edicion. Lo de afuera del vector se ve atenuado (se cortara
  // al aceptar); lo de adentro lo muestra el proxy a opacidad plena.
  // No es seleccionable ni entra a CSG/exportacion/mediciones.
  let ghost = null;
  try {
    ghost = image.clone({ insert: false });
    ghost.name = "fusion-edit-ghost";
    ghost.opacity = 0.32;
    ghost.locked = true;
    ghost.clipMask = false;
    ghost.data = { ...(ghost.data || {}), isFusionEditGhost: true, locked: true };
    if (designLayer) designLayer.addChild(ghost);
    const gInv = ghost.parent?.globalMatrix?.inverted?.() || new paper.Matrix();
    ghost.matrix = gInv.concatenate(image.globalMatrix);
  } catch (_) { try { ghost?.remove?.(); } catch (__) {} ghost = null; }

  const previewOutline = mask.clone();
  previewOutline.name = "fusion-preview-outline";
  previewOutline.strokeColor = "#00e5ff";
  previewOutline.strokeWidth = 2 / (paper.view?.zoom || 1);
  previewOutline.fillColor = null;
  previewOutline.clipMask = false;
  previewOutline.locked = true;
  previewOutline.data = { ...(previewOutline.data || {}), isFusionEditOverlay: true };

  fusionGroup.addChild(previewOutline);
  image.opacity = 0;

  editState = {
    fusionGroup,
    fusionId: data.fusionId,
    controllerTransaction,
    mask,
    image,
    tempImage,
    editWrapper,
    ghost,
    previewOutline,
    pointer: null,
    snapshot: {
      imagePosition: image.position.clone(),
      imageMatrix: image.matrix.clone()
    }
  };
  window._fusionEditState = editState;
  fusionEditActive = true;
  window.fusionEditActive = true;
  interactionOwner.claim("fusion-edit", { owner: "fusionEditMode" });
  // La imagen editable queda SELECCIONADA con su caja y tiradores: es un
  // Raster publico a nivel capa, asi que el sistema la acepta sin resolver
  // a la fusion. Las herramientas de imagen actuan sobre ella.
  try {
    window.selectedItem = tempImage;
    window.selectedItems = [tempImage];
    window.updateSelectionBox?.(tempImage);
    window.updateContextualMenu?.(tempImage);
    window.refreshAllToolbars?.();
  } catch (_) {}
  // Espejo periodico fantasma<->proxy: cubre tiradores y cualquier ruta que
  // mueva al proxy sin pasar por los handlers de este modulo.
  try {
    editState.editSyncTimer = setInterval(() => {
      try { if (window._fusionEditState) syncEditGhost(); } catch (_) {}
    }, 150);
  } catch (_) {}
  paper.view?.update?.();
  return true;
}

export const initFusionEditMode = enterFusionEditMode;

export function exitFusionEditMode(accept = true) {
  const st = editState;
  if (!st || !fusionEditActive) {
    interactionOwner.release("fusion-edit");
    return false;
  }

  fusionEditActive = false;
  window.fusionEditActive = false;
  editState = null;
  window._fusionEditState = null;
  interactionOwner.endPointer("fusion-edit");

  const finalImage = st.image?.project
    ? st.image
    : st.fusionGroup?.children?.find(child => child?.name === "fusion-image");
  const controller = window.EKKO_FUSION_CONTROLLER;
  try {
    if (finalImage) {
      if (accept && st.tempImage?.project) {
        // El proxy vive en otro padre que la imagen interna: convertir su
        // matriz global al sistema local del grupo de fusion. Copiarla
        // directo desfasa (ese era el "salto" al aceptar).
        if (typeof window.saveHistory === "function") window.saveHistory();
        const gInv = st.fusionGroup?.globalMatrix?.inverted?.() || new paper.Matrix();
        finalImage.matrix = gInv.concatenate(st.tempImage.globalMatrix);
      } else if (st.snapshot) {
        finalImage.position = st.snapshot.imagePosition.clone();
        finalImage.matrix = st.snapshot.imageMatrix.clone();
      }
      finalImage.opacity = 1;
    }
    let acceptedRasterSnapshot = null;
    if (accept && finalImage?.clone) {
      acceptedRasterSnapshot = finalImage.clone({ insert: false });
      acceptedRasterSnapshot.visible = false;
      acceptedRasterSnapshot.data = { ...(acceptedRasterSnapshot.data || {}), fusionEditSnapshot: true };
      st.fusionGroup.data = { ...(st.fusionGroup.data || {}), originalRasterData: acceptedRasterSnapshot };
    }
    if (accept) {
      updateVirtualHole(st.fusionId, st.mask, st.fusionGroup);
      controller?.commitFusionEdit?.(st.fusionGroup, acceptedRasterSnapshot ? { originalRasterData: acceptedRasterSnapshot } : {});
    } else {
      controller?.cancelFusionEdit?.(st.fusionId);
    }
    // A virtual hole must exist after both accept and cancel. The controller
    // owns the canonical metadata/scope, while this module owns the edit UI.
    controller?.syncFusionVirtualHole?.(st.fusionGroup);
    const designLayer = paper.project?.layers?.find(layer => layer?.name === 'designLayer') || st.fusionGroup?.layer || null;
    window.recalculateDynamicSubtractions?.(designLayer);
  } finally {
    cleanupEditVisuals(st);
    interactionOwner.release("fusion-edit");
    // La seleccion vuelve a la fusion completa con su caja.
    try {
      if (st.fusionGroup?.project) {
        window.selectedItem = st.fusionGroup;
        window.selectedItems = [st.fusionGroup];
        window.updateSelectionBox?.(st.fusionGroup);
        window.updateContextualMenu?.(st.fusionGroup);
        window.refreshAllToolbars?.();
      } else {
        window.deselectItem?.();
      }
    } catch (_) {}
    paper.view?.update?.();
  }
  return true;
}

/* Todos los eventos del modo interno entran desde selection.js. Este módulo
 * no registra listeners DOM propios. */
export function handleFusionEditPointerDown(event, point) {
  if (!fusionEditActive || !editState) return false;
  // La imagen editable (incluido su fantasma visual) manda: agarrarla
  // arrastra, aunque el punto caiga fuera de la mascara. Solo un clic en
  // vacio real acepta y sale.
  const draggingImage = pointHits(editState.tempImage, point);
  if (draggingImage) {
    editState.pointer = { dragging: true, token: null };
    editState.pointer.token = interactionOwner.beginPointer("fusion-edit");
    return true;
  }
  if (!pointInsideMask(point, editState.mask)) {
    exitFusionEditMode(true);
    return true;
  }
  editState.pointer = { dragging: false, token: null };
  editState.pointer.token = interactionOwner.beginPointer("fusion-edit");
  return true;
}

export function handleFusionEditPointerDrag(event) {
  if (!fusionEditActive || !editState?.pointer) return true;
  if (!editState.pointer.dragging || !event?.delta) return true;
  const delta = event.delta.clone ? event.delta.clone() :
    new paper.Point(event.delta.x || 0, event.delta.y || 0);
  editState.tempImage.translate(toParentDelta(editState.tempImage, delta));
  syncEditGhost();
  paper.view?.update?.();
  return true;
}

export function handleFusionEditPointerUp() {
  if (!fusionEditActive || !editState) return false;
  const token = editState.pointer?.token || null;
  editState.pointer = null;
  interactionOwner.endPointer("fusion-edit", token);
  return true;
}

export function handleFusionEditKeyDown(event) {
  if (!fusionEditActive) return false;
  if (event.key === "Enter" || event.type === "contextmenu") {
    event.preventDefault?.();
    exitFusionEditMode(true);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault?.();
    exitFusionEditMode(false);
    return true;
  }
  return false;
}

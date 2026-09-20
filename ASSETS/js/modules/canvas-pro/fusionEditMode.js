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
  try { st.tempImage?.remove?.(); } catch (e) {}
  try { st.previewOutline?.remove?.(); } catch (e) {}
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

  const tempImage = image.clone();
  tempImage.name = "fusion-temp-image";
  tempImage.opacity = 0.7;
  tempImage.locked = false;
  tempImage.clipMask = false;
  tempImage.applyMatrix = false;

  const previewOutline = mask.clone();
  previewOutline.name = "fusion-preview-outline";
  previewOutline.strokeColor = "#00e5ff";
  previewOutline.strokeWidth = 2 / (paper.view?.zoom || 1);
  previewOutline.fillColor = null;
  previewOutline.clipMask = false;
  previewOutline.locked = true;
  previewOutline.data = { ...(previewOutline.data || {}), isFusionEditOverlay: true };

  fusionGroup.addChild(tempImage);
  fusionGroup.addChild(previewOutline);
  image.opacity = 0;

  editState = {
    fusionGroup,
    fusionId: data.fusionId,
    controllerTransaction,
    mask,
    image,
    tempImage,
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
      if (accept && st.tempImage) {
        finalImage.position = st.tempImage.position.clone();
        finalImage.matrix = st.tempImage.matrix.clone();
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
    paper.view?.update?.();
  }
  return true;
}

/* Todos los eventos del modo interno entran desde selection.js. Este módulo
 * no registra listeners DOM propios. */
export function handleFusionEditPointerDown(event, point) {
  if (!fusionEditActive || !editState) return false;
  if (!pointInsideMask(point, editState.mask)) {
    exitFusionEditMode(true);
    return true;
  }
  const draggingImage = pointHits(editState.tempImage, point);
  editState.pointer = { dragging: draggingImage, token: null };
  editState.pointer.token = interactionOwner.beginPointer("fusion-edit");
  return true;
}

export function handleFusionEditPointerDrag(event) {
  if (!fusionEditActive || !editState?.pointer) return true;
  if (!editState.pointer.dragging || !event?.delta) return true;
  const delta = event.delta.clone ? event.delta.clone() :
    new paper.Point(event.delta.x || 0, event.delta.y || 0);
  editState.tempImage.translate(toParentDelta(editState.tempImage, delta));
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

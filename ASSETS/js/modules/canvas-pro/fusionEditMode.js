import {
  applySmartFusion,
  getFusionById,
  registerVirtualHole,
  unregisterVirtualHole,
  updateVirtualHole,
  getFusionReceptors
} from "./fusionCore.js";

import { interactionOwner } from "./interactionOwner.js";

export let editState = null;
export let fusionEditActive = false;

function cleanupEditState() {
  if (!editState) return;
  if (editState.tempImage) {
    editState.tempImage.remove();
  }
  if (editState.previewOutline) {
    editState.previewOutline.remove();
  }
  window._fusionEditState = null;
  editState = null;
  fusionEditActive = false;
}

function pointIsInsideReceptor(point, receptor) {
  if (!receptor) return false;
  try {
    if (receptor.contains(point)) return true;
    if (receptor.bounds && receptor.bounds.contains(point)) return true;
  } catch (e) {}
  return false;
}

export function enterFusionEditMode(fusionGroup) {
  if (!fusionGroup || !fusionGroup.data || !fusionGroup.data.fusionId) return false;
  if (fusionEditActive) exitFusionEditMode(false);

  const { fusionId, fusionMode, originalVector, originalImage, maskGroup } = fusionGroup.data;
  const mask = maskGroup?.children?.[0] || originalVector;
  const image = fusionGroup.children?.find(c => c.name === "fusion-image" || c.className === "Raster");

  if (!mask || !image) return false;

  const tempImage = image.clone();
  tempImage.name = "fusion-temp-image";
  tempImage.opacity = 0.7;
  tempImage.position = image.position;
  tempImage.locked = false;
  tempImage.applyMatrix = false;

  const previewOutline = mask.clone();
  previewOutline.name = "fusion-preview-outline";
  previewOutline.strokeColor = "#00ffff";
  previewOutline.strokeWidth = 2;
  previewOutline.fillColor = null;
  previewOutline.locked = true;

  fusionGroup.addChild(tempImage);
  fusionGroup.addChild(previewOutline);
  image.opacity = 0;

  editState = {
    fusionGroup,
    fusionId,
    fusionMode,
    mask,
    originalVector,
    originalImage,
    tempImage,
    previewOutline,
    snapshot: {
      imagePosition: image.position.clone(),
      imageMatrix: image.matrix.clone()
    }
  };

  window._fusionEditState = editState;
  fusionEditActive = true;

  interactionOwner.claim("fusion-edit", {
    owner: "fusionEditMode",
    onExit: (reason) => {
      if (reason === "superseded-by-select") return;
      exitFusionEditMode(reason !== "released");
    }
  });

  console.log("[fusionEditMode] Entró en edición:", fusionId);
  return true;
}

export function exitFusionEditMode(accept = true) {
  if (!fusionEditActive || !editState) {
    cleanupEditState();
    interactionOwner?.release("fusion-edit");
    return;
  }

  const st = editState;
  cleanupEditState();

  if (accept) {
    const { fusionGroup, fusionId, tempImage, mask } = st;
    const finalImage = fusionGroup.children?.find(c => c.name === "fusion-image");
    if (finalImage && tempImage) {
      finalImage.position = tempImage.position.clone();
      finalImage.matrix = tempImage.matrix.clone();
      finalImage.opacity = 1;
    }
    updateVirtualHole(fusionId, mask);
    console.log("[fusionEditMode] Aceptada edición:", fusionId);
  } else {
    const { fusionGroup, snapshot, originalImage } = st;
    const finalImage = fusionGroup.children?.find(c => c.name === "fusion-image");
    if (finalImage && snapshot) {
      finalImage.position = snapshot.imagePosition;
      finalImage.matrix = snapshot.imageMatrix;
      finalImage.opacity = 1;
    }
    console.log("[fusionEditMode] Cancelada edición:", st.fusionId);
  }

  interactionOwner?.release("fusion-edit");
}

// Se conecta desde selection.js — NO agrega listeners propios
export function handleFusionEditPointerDown(event, point) {
  if (!fusionEditActive || !editState) return false;

  const inside = pointIsInsideReceptor(point, editState.mask);
  if (!inside) {
    exitFusionEditMode(true);
    return true;
  }
  return false;
}

// Atajos — se registran desde editor.js
export function handleFusionEditKeyDown(event) {
  if (!fusionEditActive) return false;
  if (event.key === "Enter") {
    event.preventDefault();
    exitFusionEditMode(true);
    return true;
  }
  if (event.key === "Escape") {
    event.preventDefault();
    exitFusionEditMode(false);
    return true;
  }
  if (event.button === 2 || event.type === "contextmenu") {
    event.preventDefault();
    exitFusionEditMode(true);
    return true;
  }
  return false;
}

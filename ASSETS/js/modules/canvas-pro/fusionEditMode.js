import { interactionOwner } from "./interactionOwner.js";

export let editState = null;
export let fusionEditActive = false;
let editSessionSequence = 0;

const matrixKeys = ["a", "b", "c", "d", "tx", "ty"];
function matrixValues(matrix) { return matrix ? matrixKeys.map(key => Number(matrix[key]) || 0) : null; }
function sameMatrix(a, b) {
  const av = matrixValues(a), bv = matrixValues(b);
  return !!av && !!bv && av.every((value, index) => Math.abs(value - bv[index]) < 1e-7);
}
function cloneMatrix(matrix) { return matrix?.clone?.() || null; }
function setWorldMatrix(item, matrix) {
  if (!item || !matrix) return false;
  try {
    item.applyMatrix = false;
    item.matrix = (item.parent?.globalMatrix || new paper.Matrix()).inverted().concatenate(matrix);
    return true;
  } catch (_) { return false; }
}
function pointHits(item, point) {
  if (!item || !point) return false;
  try {
    return item.contains?.(point) || !!item.hitTest?.(point, {
      fill: true, stroke: true, segments: true, tolerance: 6 / (paper.view?.zoom || 1)
    });
  } catch (_) { return false; }
}
function toParentDelta(item, delta) {
  if (!item?.parent?.globalToLocal || !item.localToGlobal) return delta;
  try {
    const origin = item.localToGlobal(new paper.Point(0, 0));
    return item.parent.globalToLocal(origin.add(delta)).subtract(item.parent.globalToLocal(origin));
  } catch (_) { return delta; }
}
function makeEditable(raster) {
  try { delete raster.selected; } catch (_) {}
  raster.locked = false; raster.clipMask = false; raster.applyMatrix = false;
}
function lockFusionChild(raster) {
  try { delete raster.selected; } catch (_) {}
  try {
    Object.defineProperty(raster, "selected", {
      get() { return false; }, set() {}, configurable: true, enumerable: true
    });
  } catch (_) {}
}
function proxyData(data) {
  const clean = { ...(data || {}) };
  delete clean.isFusionEditProxy; delete clean.fusionImageIndex;
  return clean;
}
function comparableData(data) {
  const clean = proxyData(data);
  delete clean.rotation; delete clean.selected;
  return clean;
}
function sameData(a, b) {
  const aa = comparableData(a), bb = comparableData(b), ak = Object.keys(aa), bk = Object.keys(bb);
  return ak.length === bk.length && ak.every(key =>
    Object.prototype.hasOwnProperty.call(bb, key) && aa[key] === bb[key]);
}

// Paper's .source getter serializes canvases with toDataURL(). Snapshots keep
// live image/canvas references instead, never PNG strings or pixel clones.
function captureRaster(raster) {
  if (!raster) return null;
  return {
    raster, id: raster.id ?? null, name: raster.name, matrix: cloneMatrix(raster.matrix),
    size: raster.size?.clone?.() || null, opacity: raster.opacity, visible: raster.visible,
    locked: raster.locked, clipMask: raster.clipMask, applyMatrix: raster.applyMatrix,
    data: { ...(raster.data || {}) }, image: raster._image || raster.image || null,
    canvas: raster._canvas || null
  };
}
function restoreRaster(raster, snapshot) {
  if (!raster || !snapshot) return;
  const currentCanvas = raster._canvas || null, currentImage = raster._image || raster.image || null;
  if (snapshot.canvas && snapshot.canvas !== currentCanvas) raster.canvas = snapshot.canvas;
  else if (!snapshot.canvas && snapshot.image && snapshot.image !== currentImage) raster.image = snapshot.image;
  else if (!snapshot.canvas && !snapshot.image && (currentCanvas || currentImage)) raster.image = null;
  raster.applyMatrix = snapshot.applyMatrix;
  if (snapshot.matrix) raster.matrix = snapshot.matrix.clone();
  if (snapshot.size && (raster.width !== snapshot.size.width || raster.height !== snapshot.size.height)) {
    raster.size = snapshot.size.clone();
    if (snapshot.matrix) raster.matrix = snapshot.matrix.clone();
  }
  raster.name = snapshot.name; raster.opacity = snapshot.opacity; raster.visible = snapshot.visible;
  raster.locked = snapshot.locked; raster.clipMask = snapshot.clipMask;
  raster.data = { ...(snapshot.data || {}) };
}
function directFusionRasters(group) {
  return Array.from(group?.children || []).filter(child => child?.className === "Raster");
}
function directFusionBackgrounds(group) {
  return Array.from(group?.children || []).filter(child => child?.data?.ekkoFondoPara);
}
function captureBackgrounds(group) {
  return Array.from(group?.children || [])
    .map((child, childIndex) => child?.data?.ekkoFondoPara
      ? { group: child, childIndex, matrix: cloneMatrix(child.globalMatrix), data: { ...(child.data || {}) }, visible: child.visible, opacity: child.opacity }
      : null)
    .filter(Boolean);
}
function captureFusionState(group) {
  if (!group) return null;
  const rasters = Array.from(group.children || [])
    .map((child, childIndex) => child?.className === "Raster" ? { ...captureRaster(child), childIndex } : null)
    .filter(Boolean);
  return {
    fusionId: group.data?.fusionId || null, group, groupMatrix: cloneMatrix(group.globalMatrix),
    // Derive these from live children. Legacy single-image fusions do not have
    // rasterIds/imageCount, and Accept normalizing them is not a visual change.
    rasterIds: rasters.map(raster => raster.id), imageCount: rasters.length, rasters,
    backgrounds: captureBackgrounds(group)
  };
}
function sameFusionState(a, b) {
  if (!a || !b || a.fusionId !== b.fusionId || !sameMatrix(a.groupMatrix, b.groupMatrix)) return false;
  if (a.rasters.length !== b.rasters.length) return false;
  if ((a.rasterIds || []).join(",") !== (b.rasterIds || []).join(",")) return false;
  if (a.imageCount !== b.imageCount) return false;
  if ((a.backgrounds || []).length !== (b.backgrounds || []).length) return false;
  if (!(a.backgrounds || []).every((background, index) => {
    const other = b.backgrounds[index];
    return background.group === other.group && sameMatrix(background.matrix, other.matrix) &&
      sameData(background.data, other.data) && background.visible === other.visible && background.opacity === other.opacity;
  })) return false;
  return a.rasters.every((raster, index) => {
    const other = b.rasters[index];
    return raster.id === other.id && raster.name === other.name && sameMatrix(raster.matrix, other.matrix) &&
      sameData(raster.data, other.data) && raster.opacity === other.opacity && raster.visible === other.visible &&
      raster.canvas === other.canvas && raster.image === other.image;
  });
}
function findFusionGroup(fusionId, preferred = null) {
  if (preferred?.project && preferred.data?.fusionId === fusionId) return preferred;
  if (!fusionId || !paper.project) return null;
  let found = null;
  const visit = item => {
    if (found) return;
    if (item?.data?.fusionId === fusionId && item.data?.isSmartFusion) { found = item; return; }
    Array.from(item?.children || []).forEach(visit);
  };
  Array.from(paper.project.layers || []).forEach(visit);
  return found;
}
function selectFusionOwner(group) {
  try {
    if (typeof window.commitSelectionContext === "function") window.commitSelectionContext([group], group, "fusion-edit-exit");
    else { window.selectedItem = group; window.selectedItems = [group]; group.selected = true; }
  } catch (_) { window.selectedItem = group; window.selectedItems = [group]; }
  try { window.updateSelectionBox?.(group); } catch (_) {}
  try { window.updateContextualMenu?.(group); } catch (_) {}
  try { window.refreshAllToolbars?.(); } catch (_) {}
}

// One reference-based Undo/Redo pair. Stable fusionId also finds a group after
// an intervening JSON history operation rehydrated the document.
function restoreFusionSnapshot(snapshot) {
  if (!snapshot || window.fusionEditActive || !paper.project) return false;
  const group = findFusionGroup(snapshot.fusionId, snapshot.group);
  if (!group) return false;
  try {
    if (snapshot.groupMatrix) setWorldMatrix(group, snapshot.groupMatrix);
    directFusionBackgrounds(group).forEach(background => background.remove());
    directFusionRasters(group).forEach(raster => raster.remove());
    (snapshot.backgrounds || []).forEach(saved => {
      saved.group.visible = saved.visible; saved.group.opacity = saved.opacity; saved.group.data = { ...(saved.data || {}) };
      group.insertChild(Math.min(saved.childIndex ?? 0, group.children.length), saved.group);
      if (saved.matrix) setWorldMatrix(saved.group, saved.matrix);
    });
    snapshot.rasters.forEach(saved => {
      restoreRaster(saved.raster, saved);
      group.insertChild(Math.min(saved.childIndex ?? group.children.length, group.children.length), saved.raster);
      if (saved.matrix) saved.raster.matrix = saved.matrix.clone();
      lockFusionChild(saved.raster);
    });
    group.data = {
      ...(group.data || {}), rasterIds: snapshot.rasterIds ? [...snapshot.rasterIds] : snapshot.rasters.map(item => item.id),
      imageCount: snapshot.imageCount == null ? snapshot.rasters.length : snapshot.imageCount
    };
    window.EKKO_FUSION_CONTROLLER?.refreshFusion?.(group, { group, rasterIds: group.data.rasterIds, imageCount: group.data.imageCount });
    selectFusionOwner(group);
    window.recalculateDynamicSubtractions?.(paper.project.layers?.find(layer => layer?.name === "designLayer") || group.layer || null);
    paper.view?.update?.();
    return true;
  } catch (_) { return false; }
}
function resolveFusionFromSelection() {
  const lista = Array.isArray(window.selectedItems) && window.selectedItems.length ? window.selectedItems : (window.selectedItem ? [window.selectedItem] : []);
  for (const raw of lista) {
    try {
      const found = window.findSmartFusionContainer?.(raw) || (raw?.data?.isSmartFusion ? raw : null);
      if (found?.data?.fusionId) return found;
    } catch (_) {}
  }
  return null;
}
function activeEntry() { return editState?.images?.[editState.activeIndex] || null; }
function syncActiveSelection() {
  const entry = activeEntry();
  if (!entry?.raster?.project) return false;
  try {
    if (typeof window.commitSelectionContext === "function") window.commitSelectionContext([entry.raster], entry.raster, "fusion-edit-select");
    entry.raster.selected = true;
  } catch (_) {}
  window.selectedItem = entry.raster; window.selectedItems = [entry.raster];
  try { window.updateSelectionBox?.(entry.raster); } catch (_) {}
  try { window.updateContextualMenu?.(entry.raster); } catch (_) {}
  return true;
}
/** Compatibility: no Raster ghost exists; explicit routes sync only at end. */
export function syncEditGhost() {
  const entry = activeEntry();
  if (!entry) return false;
  try { window.updateSelectionBox?.(entry.raster); } catch (_) {}
  return true;
}
function markDirty() {
  const st = editState;
  if (!st || st.closing) return false;
  st.dirty = true;
  if (typeof window.markFusionEditDirty === "function") window.markFusionEditDirty();
  else if (typeof window.markHistoryDirty === "function") window.markHistoryDirty();
  return true;
}
function installCsgGuard(st) {
  const original = window.recalculateDynamicSubtractions;
  if (typeof original !== "function") return;
  const guarded = function(...args) {
    if (fusionEditActive && editState === st) return { skipped: true, reason: "fusion-edit-active", valid: true };
    return original.apply(this, args);
  };
  window.recalculateDynamicSubtractions = guarded;
  st.restoreRecalculateDynamicSubtractions = () => {
    if (window.recalculateDynamicSubtractions === guarded) window.recalculateDynamicSubtractions = original;
  };
}
function cleanupEditVisuals(st) {
  try { st.previewOutline?.remove?.(); } catch (_) {}
  try { st.editMask?.remove?.(); } catch (_) {}
  try { st.editWrapper?.remove?.(); } catch (_) {}
  try { st.restoreRecalculateDynamicSubtractions?.(); } catch (_) {}
}
function waitForRaster(raster) {
  if (!raster || raster.loaded || raster.width > 0) return Promise.resolve(raster);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true; clearTimeout(timer); raster.onLoad = null;
      value instanceof Error ? reject(value) : resolve(raster);
    };
    const timer = setTimeout(() => finish(new Error("La imagen no terminó de cargar")), 15000);
    raster.onLoad = () => finish(raster);
  });
}
function rawWorldBounds(item) {
  const bounds = item?.bounds?.clone?.();
  if (!bounds) return null;
  const matrix = item.parent?.globalMatrix || new paper.Matrix();
  const points = [bounds.topLeft, bounds.topRight, bounds.bottomRight, bounds.bottomLeft].map(point => matrix.transform(point));
  const left = Math.min(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const right = Math.max(...points.map(point => point.x));
  const bottom = Math.max(...points.map(point => point.y));
  return new paper.Rectangle(left, top, right - left, bottom - top);
}
function cloneRasterReference(source) {
  const copy = new paper.Raster({ insert: false });
  const canvas = source._canvas || null;
  const image = source._image || source.image || null;
  if (canvas) copy.canvas = canvas;
  else if (image) copy.image = image;
  copy.size = source.size?.clone?.() || new paper.Size(source.width, source.height);
  copy.matrix = source.matrix?.clone?.() || new paper.Matrix();
  copy.applyMatrix = source.applyMatrix;
  copy.opacity = source.opacity;
  copy.name = source.name;
  copy.data = { ...(source.data || {}) };
  return copy;
}
async function rasterFromSource(source) {
  if (source?.className === "Raster" || source instanceof paper.Raster) {
    const copy = cloneRasterReference(source); await waitForRaster(copy); return copy;
  }
  const raster = new paper.Raster({ insert: false });
  if (typeof Blob !== "undefined" && source instanceof Blob) {
    const objectUrl = URL.createObjectURL(source);
    try {
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve; image.onerror = () => reject(new Error("No se pudo leer la imagen")); image.src = objectUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth || image.width;
      canvas.height = image.naturalHeight || image.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("No se pudo preparar la imagen");
      context.drawImage(image, 0, 0);
      raster.canvas = canvas;
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  } else if (source && typeof source === "object") {
    raster.image = source; // Paper 0.12.17 accepts canvas and Image directly.
  } else if (typeof source === "string") {
    raster.source = source;
  } else throw new Error("Origen de imagen inválido");
  await waitForRaster(raster);
  return raster;
}
function registerProxy(st, raster, options = {}) {
  makeEditable(raster);
  raster.opacity = options.opacity == null ? (raster.opacity ?? 1) : options.opacity;
  raster.data = { ...(raster.data || {}), ...(options.data || {}), locked: false, isFusionEditProxy: true };
  if (options.label) raster.data.label = options.label;
  const maskBounds = rawWorldBounds(st.mask);
  if (!options.globalMatrix && maskBounds) {
    raster.position = options.point || maskBounds.center;
    if (options.width && raster.width > 0) raster.scale(options.width / raster.width);
    else if (raster.width > 0 && raster.height > 0) {
      const fit = Math.min(maskBounds.width / raster.width, maskBounds.height / raster.height) * 0.92;
      if (fit > 0 && Number.isFinite(fit)) raster.scale(fit);
    }
  }
  const worldMatrix = options.globalMatrix?.clone?.() || cloneMatrix(raster.globalMatrix) || new paper.Matrix();
  st.editWrapper.addChild(raster); setWorldMatrix(raster, worldMatrix);
  const entry = { raster, original: options.original || null, baseline: captureRaster(raster) };
  st.images.push(entry); raster.data = { ...(raster.data || {}), fusionImageIndex: st.images.length - 1 };
  return entry;
}
async function addImage(source, options = {}) {
  const st = editState;
  if (!fusionEditActive || !st || st.closing) return null;
  const token = st.token, raster = await rasterFromSource(source);
  if (!fusionEditActive || editState !== st || st.token !== token || st.closing) return null;
  const entry = registerProxy(st, raster, options);
  st.activeIndex = st.images.indexOf(entry); st.tempImage = entry.raster; st.image = entry.original?.raster || entry.raster;
  markDirty(); syncActiveSelection(); paper.view?.update?.(); return entry.raster;
}
async function replaceActive(source, options = {}) {
  const st = editState, entry = activeEntry();
  if (!fusionEditActive || !st || !entry || st.closing) return null;
  const token = st.token, incoming = await rasterFromSource(source);
  if (!fusionEditActive || editState !== st || st.token !== token || st.closing) return null;
  const target = entry.raster, oldMatrix = target.matrix.clone(), oldSize = target.size.clone();
  const incomingCanvas = incoming._canvas || null, incomingImage = incoming._image || incoming.image || null;
  target.onLoad = null;
  if (incomingCanvas) target.canvas = incomingCanvas;
  else if (incomingImage) target.image = incomingImage;
  else throw new Error("La imagen de reemplazo está vacía");
  // Preserve physical bounds without resampling: adapt the matrix to old size.
  target.applyMatrix = false; target.matrix = oldMatrix;
  if (incoming.width > 0 && incoming.height > 0 && oldSize.width > 0 && oldSize.height > 0) target.scale(oldSize.width / incoming.width, oldSize.height / incoming.height);
  const keep = { ...(target.data || {}) };
  delete keep.originalCanvas; delete keep.quitarFondoIA; delete keep.ekkoFondoClave; delete keep.ekkoFondo;
  target.data = { ...keep, locked: false, isFusionEditProxy: true, fusionImageIndex: st.activeIndex, ...(options.label ? { label: options.label } : {}) };
  markDirty(); syncActiveSelection(); paper.view?.update?.(); return target;
}
function selectImage(indexOrRaster) {
  const st = editState;
  if (!fusionEditActive || !st) return null;
  const index = typeof indexOrRaster === "number" ? indexOrRaster : st.images.findIndex(entry => entry.raster === indexOrRaster);
  if (index < 0 || index >= st.images.length) return null;
  try { paper.project?.deselectAll?.(); } catch (_) {}
  st.images.forEach(entry => { try { entry.raster.selected = false; } catch (_) {} });
  st.activeIndex = index;
  const entry = st.images[index]; st.tempImage = entry.raster; st.image = entry.original?.raster || entry.raster;
  syncActiveSelection(); paper.view?.update?.(); return entry.raster;
}
function removeActive() {
  const st = editState, entry = activeEntry();
  if (!fusionEditActive || !st || !entry || st.images.length <= 1) return false;
  const index = st.activeIndex; entry.raster.remove(); st.images.splice(index, 1);
  st.images.forEach((item, imageIndex) => { item.raster.data = { ...(item.raster.data || {}), fusionImageIndex: imageIndex }; });
  st.activeIndex = Math.min(index, st.images.length - 1); st.tempImage = st.images[st.activeIndex].raster;
  st.image = st.images[st.activeIndex].original?.raster || st.tempImage;
  markDirty(); selectImage(st.activeIndex); return true;
}
async function duplicateActive() {
  const entry = activeEntry(); if (!entry) return null;
  const matrix = entry.raster.globalMatrix.clone(); matrix.translate(new paper.Point(20, 20));
  return addImage(entry.raster, { globalMatrix: matrix, opacity: entry.raster.opacity });
}
function reorderActive(direction) {
  const st = editState, entry = activeEntry();
  if (!fusionEditActive || !st || !entry || st.images.length <= 1) return false;
  const index = st.activeIndex;
  let nextIndex = direction === "forward" ? Math.min(st.images.length - 1, index + 1)
    : direction === "backward" ? Math.max(0, index - 1)
    : direction === "front" ? st.images.length - 1 : direction === "back" ? 0 : index;
  if (nextIndex === index) return false;
  const moved = st.images.splice(index, 1)[0]; st.images.splice(nextIndex, 0, moved);
  st.editWrapper.addChild(st.editMask); st.images.forEach(item => st.editWrapper.addChild(item.raster));
  st.images.forEach((item, imageIndex) => { item.raster.data = { ...(item.raster.data || {}), fusionImageIndex: imageIndex }; });
  st.activeIndex = nextIndex; markDirty(); syncActiveSelection(); paper.view?.update?.(); return true;
}
function copyActive() {
  const entry = activeEntry();
  return entry ? cloneRasterReference(entry.raster) : null;
}
function restoreActiveSource() {
  const st = editState, entry = activeEntry();
  if (!fusionEditActive || !st || !entry?.baseline) return false;
  const baseline = entry.baseline, target = entry.raster;
  if (baseline.canvas) target.canvas = baseline.canvas; else if (baseline.image) target.image = baseline.image;
  const data = { ...(target.data || {}) };
  delete data.originalCanvas; delete data.quitarFondoIA; delete data.ekkoFondoClave; delete data.ekkoFondo;
  target.data = data; markDirty(); syncActiveSelection(); paper.view?.update?.(); return true;
}
function getState() {
  const st = editState; if (!fusionEditActive || !st) return null;
  const entry = activeEntry();
  return {
    token: st.token, fusionId: st.fusionId, fusionGroup: st.fusionGroup, wrapper: st.editWrapper, mask: st.mask,
    active: entry?.raster || null, raster: entry?.raster || null, tempImage: entry?.raster || null,
    image: entry?.original?.raster || entry?.raster || null, activeIndex: st.activeIndex,
    images: st.images.map(item => item.raster), originals: st.originalImages, dirty: st.dirty, count: st.images.length,
    previewOutline: st.previewOutline || null
  };
}

export function enterFusionEditMode(fusionGroup = null) {
  if (!fusionGroup?.data?.fusionId) fusionGroup = resolveFusionFromSelection();
  if (!fusionGroup?.data?.fusionId) return false;
  if (fusionEditActive) exitFusionEditMode(false);
  const data = fusionGroup.data;
  const mask = fusionGroup.children?.find(child => child?.clipMask || child?.data?.isFusionMask) || data.maskGroup?.children?.[0] || data.originalVector || null;
  const originals = directFusionRasters(fusionGroup);
  if (!mask?.project || !originals.length) return false;
  const before = captureFusionState(fusionGroup), controller = window.EKKO_FUSION_CONTROLLER;
  const controllerTransaction = controller?.beginFusionEdit?.(fusionGroup) || null;
  const designLayer = paper.project?.layers?.find(layer => layer?.name === "designLayer") || paper.project?.activeLayer || null;
  const st = {
    token: ++editSessionSequence, fusionGroup, fusionId: data.fusionId, controllerTransaction, mask, before,
    originalImages: originals, images: [], activeIndex: 0, image: originals[0], tempImage: originals[0],
    editWrapper: null, editMask: null, ghost: null, previewOutline: null, pointer: null, dirty: false, closing: false
  };
  try {
    const editMask = mask.clone({ insert: false });
    editMask.clipMask = true; editMask.fillColor = null; editMask.strokeColor = null; editMask.strokeWidth = 0;
    const editWrapper = new paper.Group({ insert: false }); editWrapper.addChild(editMask); editWrapper.clipped = true;
    editWrapper.data = { isFusionEditClip: true, fusionId: data.fusionId, locked: false };
    if (designLayer) designLayer.addChild(editWrapper);
    setWorldMatrix(editMask, mask.globalMatrix); st.editMask = editMask; st.editWrapper = editWrapper;
    originals.forEach(raster => {
      const worldMatrix = raster.globalMatrix.clone();
      registerProxy(st, raster, { globalMatrix: worldMatrix, opacity: raster.opacity, original: before.rasters.find(item => item.raster === raster) });
    });
    const previewOutline = mask.clone({ insert: false });
    const outlineMatrix = mask.globalMatrix?.clone?.() || new paper.Matrix();
    const outlineScale = Math.max(Math.hypot(outlineMatrix.a, outlineMatrix.b), Math.hypot(outlineMatrix.c, outlineMatrix.d), 1e-9);
    previewOutline.name = "fusion-preview-outline"; previewOutline.strokeColor = "#00e5ff";
    previewOutline.strokeWidth = 2 / ((paper.view?.zoom || 1) * outlineScale); previewOutline.fillColor = null;
    previewOutline.clipMask = false; previewOutline.locked = true;
    previewOutline.data = { ...(previewOutline.data || {}), isFusionEditOverlay: true, isSelectionBox: true, isSmartGuide: true, uiOnly: true, locked: true };
    if (designLayer) designLayer.addChild(previewOutline);
    setWorldMatrix(previewOutline, outlineMatrix); st.previewOutline = previewOutline;
  } catch (_) {
    // Some originals may already have moved into the temporary wrapper. Put
    // every live reference back before releasing the transaction.
    try { restoreOriginalsOnCancel(st); } catch (_) {}
    try { controller?.cancelFusionEdit?.(st.fusionId); } catch (_) {}
    cleanupEditVisuals(st); return false;
  }
  editState = st; window._fusionEditState = st; fusionEditActive = true; window.fusionEditActive = true;
  interactionOwner.claim("fusion-edit", { owner: "fusionEditMode" }); installCsgGuard(st); selectImage(0);
  try { window.refreshAllToolbars?.(); } catch (_) {}
  window.beginFusionEditHistory?.({ before, restore: restoreFusionSnapshot, equivalent: sameFusionState }); paper.view?.update?.(); return true;
}
export const initFusionEditMode = enterFusionEditMode;
function restoreOriginalsOnCancel(st) {
  // Remove only session-owned proxies. Other fusion children (including future
  // vector companions) must not be destroyed by cancellation.
  st.images.forEach(entry => { try { entry.raster.remove(); } catch (_) {} });
  directFusionBackgrounds(st.fusionGroup).forEach(background => background.remove());
  (st.before.backgrounds || []).forEach(saved => {
    saved.group.visible = saved.visible; saved.group.opacity = saved.opacity; saved.group.data = { ...(saved.data || {}) };
    st.fusionGroup.insertChild(Math.min(saved.childIndex ?? 0, st.fusionGroup.children.length), saved.group);
    if (saved.matrix) setWorldMatrix(saved.group, saved.matrix);
  });
  st.before.rasters.forEach(saved => {
    restoreRaster(saved.raster, saved);
    st.fusionGroup.insertChild(Math.min(saved.childIndex ?? st.fusionGroup.children.length, st.fusionGroup.children.length), saved.raster);
    if (saved.matrix) saved.raster.matrix = saved.matrix.clone();
    lockFusionChild(saved.raster);
  });
}
function acceptImages(st) {
  const fusionInv = st.fusionGroup.globalMatrix.inverted();
  directFusionBackgrounds(st.editWrapper).forEach(background => {
    const worldMatrix = background.globalMatrix.clone();
    background.applyMatrix = false;
    st.fusionGroup.addChild(background);
    background.matrix = fusionInv.concatenate(worldMatrix);
  });
  st.images.forEach(entry => {
    const raster = entry.raster, worldMatrix = raster.globalMatrix.clone(); raster.applyMatrix = false;
    st.fusionGroup.addChild(raster); raster.matrix = fusionInv.concatenate(worldMatrix); raster.data = proxyData(raster.data);
    raster.locked = false; raster.clipMask = false; lockFusionChild(raster);
  });
  const rasters = directFusionRasters(st.fusionGroup);
  st.fusionGroup.data = { ...(st.fusionGroup.data || {}), rasterIds: rasters.map(raster => raster.id), imageCount: rasters.length };
  return rasters;
}
export function exitFusionEditMode(accept = true) {
  const st = editState;
  if (!st || !fusionEditActive) { interactionOwner.release("fusion-edit"); return false; }
  st.closing = true; interactionOwner.endPointer("fusion-edit");
  const controller = window.EKKO_FUSION_CONTROLLER;
  let after = null;
  try {
    if (accept) {
      acceptImages(st); after = captureFusionState(st.fusionGroup);
      controller?.commitFusionEdit?.(st.fusionGroup, { rasterId: after.rasters[0]?.id ?? null, rasterIds: after.rasterIds, imageCount: after.imageCount });
      window.commitFusionEditHistory?.(after);
    } else {
      restoreOriginalsOnCancel(st); controller?.cancelFusionEdit?.(st.fusionId); window.cancelFusionEditHistory?.("cancelled");
    }
    controller?.syncFusionVirtualHole?.(st.fusionGroup);
  } finally {
    cleanupEditVisuals(st); fusionEditActive = false; window.fusionEditActive = false; editState = null; window._fusionEditState = null;
    interactionOwner.release("fusion-edit");
    try { if (st.fusionGroup?.project) selectFusionOwner(st.fusionGroup); else window.deselectItem?.(); } catch (_) {}
    window.recalculateDynamicSubtractions?.(paper.project?.layers?.find(layer => layer?.name === "designLayer") || st.fusionGroup?.layer || null);
    paper.view?.update?.();
  }
  return true;
}
export function handleFusionEditPointerDown(event, point) {
  if (!fusionEditActive || !editState) return false;
  let hit = null;
  for (let index = editState.images.length - 1; index >= 0; index--) {
    if (pointHits(editState.images[index].raster, point)) { hit = editState.images[index].raster; break; }
  }
  if (hit) {
    if (hit !== editState.tempImage) selectImage(hit);
    editState.pointer = { dragging: true, moved: false, token: interactionOwner.beginPointer("fusion-edit") }; return true;
  }
  if (!pointHits(editState.mask, point)) { exitFusionEditMode(true); return true; }
  editState.pointer = { dragging: false, moved: false, token: interactionOwner.beginPointer("fusion-edit") }; return true;
}
export function handleFusionEditPointerDrag(event) {
  if (!fusionEditActive || !editState?.pointer) return true;
  if (!editState.pointer.dragging || !event?.delta) return true;
  const delta = event.delta.clone ? event.delta.clone() : new paper.Point(event.delta.x || 0, event.delta.y || 0);
  editState.tempImage.translate(toParentDelta(editState.tempImage, delta));
  if (delta.length > 1e-7) editState.pointer.moved = true;
  paper.view?.update?.(); return true;
}
export function handleFusionEditPointerUp() {
  if (!fusionEditActive || !editState) return false;
  const pointer = editState.pointer; editState.pointer = null; interactionOwner.endPointer("fusion-edit", pointer?.token || null);
  if (pointer?.dragging && pointer.moved) markDirty();
  syncEditGhost(); return true;
}
export function handleFusionEditKeyDown(event) {
  if (!fusionEditActive) return false;
  if (event.key === "Enter" || event.type === "contextmenu") { event.preventDefault?.(); exitFusionEditMode(true); return true; }
  if (event.key === "Escape") { event.preventDefault?.(); exitFusionEditMode(false); return true; }
  return false;
}
if (typeof window !== "undefined") {
  window.EKKO_FUSION_EDIT = { addImage, replaceActive, selectImage, removeActive, duplicateActive, copyActive, reorderActive, restoreActiveSource, markDirty, getState };
}

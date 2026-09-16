/** Canonical owner for pointer/manual rotation and text-size commands. */
import {
  beginTransformTransaction, finalizeTransformTransaction, notifyTransformObservers,
  transformPublicItem, resolvePublicTransformOwner
} from "./fusionController.js";
const normalize = value => ((Number(value) || 0) % 360 + 360) % 360;
// Paper's globalMatrix is the transform actually rendered for the public owner.
// data.rotation remains synchronized metadata, never the transform authority.
function worldRotation(item) {
  const m = item?.globalMatrix || item?.matrix;
  return m ? normalize(Math.atan2(Number(m.b), Number(m.a)) * 180 / Math.PI) : normalize(item?.data?.rotation);
}
function syncOwnerRotation(item) {
  if (!item) return 0;
  const rotation = worldRotation(item);
  item.data = { ...(item.data || {}), rotation };
  return rotation;
}
const snap45 = (value, snapped) => {
  const nearest = Math.round(value / 45) * 45;
  const distance = Math.abs(value - nearest);
  return (distance <= 4 || (snapped && distance <= 7)) ? nearest : value;
};
const selected = () => (Array.isArray(window.selectedItems) && window.selectedItems.length ? window.selectedItems : (window.selectedItem ? [window.selectedItem] : []));
function popup() { return document.getElementById("ekkoRotationPopup"); }
function pointerPosition(event) {
  const native = event?.event || event?.originalEvent;
  if (Number.isFinite(native?.clientX) && Number.isFinite(native?.clientY)) return { x: native.clientX, y: native.clientY };
  const view = window.paper?.view || globalThis.paper?.view;
  const canvas = view?.element;
  const rect = canvas?.getBoundingClientRect?.();
  const viewPoint = view?.projectToView?.(event?.point);
  return rect && viewPoint ? { x: rect.left + viewPoint.x, y: rect.top + viewPoint.y } : null;
}
function updatePopup(value, event) {
  const p = popup(); if (!p) return;
  const shown = String(Math.round(normalize(value)));
  p.textContent = `${shown}°`;
  p.classList.add("is-visible");
  const snapped = Math.abs(normalize(value) % 45) < 1e-7;
  p.classList.toggle("is-snap", snapped);
  p.classList.toggle("is-non-snap", !snapped);
  const pos = pointerPosition(event);
  if (pos) { p.style.left = `${Math.round(pos.x + 14)}px`; p.style.top = `${Math.round(pos.y + 14)}px`; }
  ["objRotation", "ctxRotation"].forEach(id => { const input = document.getElementById(id); if (input) input.value = shown; });
}
function hidePopup() { const p = popup(); if (p) { p.classList.remove("is-visible", "is-snap", "is-non-snap"); p.textContent = ""; } }
function owner(entry) { return resolvePublicTransformOwner(entry); }
function syncFontSizeInputs(value) {
  const shown = String(Math.round(Math.max(5, Math.min(250, Number(value) || 42))));
  ["objFontSize", "ctxFontSize"].forEach(id => { const input = document.getElementById(id); if (input) input.value = shown; });
}
export const rotationController = {
  startPointer(event, ctx = {}) {
    const items = ctx.selectedItems?.length ? ctx.selectedItems : (ctx.selectedItem ? [ctx.selectedItem] : []);
    const bounds = items.map(ctx.getContentItem || (x => x)).filter(Boolean).reduce((out, item) => out ? out.unite(item.bounds) : item.bounds.clone(), null);
    const center = bounds?.center || ctx.selectedItem?.bounds?.center || event.point;
    const targets = items.map(item => { const publicOwner = owner(item); return publicOwner ? { item, owner: publicOwner, initialRotation: syncOwnerRotation(publicOwner), lastDelta: 0 } : null; }).filter(Boolean);
    if (!targets.length) return;
    window.rotationActive = true; window.rotationTarget = ctx.selectedItem; window.rotationCenter = center;
    window.rotationStartAngle = event.point.subtract(center).angle; window.rotationInitialAngle = targets[0].initialRotation;
    window.rotationTargets = targets; window.isRotationSnapped = false;
    beginTransformTransaction("rotate", targets, event.point);
    updatePopup(window.rotationInitialAngle, event);
  },
  dragPointer(event) {
    const targets = window.rotationTargets || []; if (!targets.length) return;
    const raw = event.point.subtract(window.rotationCenter).angle - window.rotationStartAngle;
    const total = snap45(normalize(window.rotationInitialAngle + raw), window.isRotationSnapped) - window.rotationInitialAngle;
    window.isRotationSnapped = Math.abs(normalize(window.rotationInitialAngle + total) % 45) < 1e-7;
    targets.forEach(entry => { const step = total - entry.lastDelta; transformPublicItem(entry.owner, { type: "rotate", angle: step, center: window.rotationCenter }); entry.lastDelta = total; syncOwnerRotation(entry.owner); });
    updatePopup(window.rotationInitialAngle + total, event); notifyTransformObservers({ event, type: "rotate", cumulativeAngle: total });
    window.updateSelectionBox?.(window.selectedItem); window.paper?.view?.update?.();
  },
  endPointer(reason = "committed") {
    if (!window.rotationActive) { hidePopup(); return; }
    finalizeTransformTransaction(reason); window.rotationActive = false; window.rotationTarget = null; window.rotationTargets = []; window.isRotationSnapped = false;
    hidePopup(); window.updateSelectionBox?.(window.selectedItem); window.paper?.view?.update?.();
  },
  cancelPointer() { this.endPointer("cancelled"); },
  hidePopup,
  resolveOwner(item) { return owner(item); },
  syncSelection(item) { const publicOwner = owner(item); if (publicOwner && publicOwner.className === "PointText") syncFontSizeInputs(publicOwner.fontSize); } ,
  syncFontSizeInputs,
  applyManual(value) {
    const items = selected(); if (!items.length) return;
    const targets = items.map(item => ({ item, owner: owner(item) })).filter(entry => entry.owner); if (!targets.length) return;
    const next = normalize(value), primary = targets[0].owner, current = syncOwnerRotation(primary), delta = next - current;
    const bounds = targets.reduce((out, entry) => out ? out.unite(entry.owner.bounds) : entry.owner.bounds.clone(), null);
    beginTransformTransaction("rotate", targets, null);
    targets.forEach(entry => { transformPublicItem(entry.owner, { type: "rotate", angle: delta, center: bounds?.center }); syncOwnerRotation(entry.owner); });
    updatePopup(next); finalizeTransformTransaction("committed"); hidePopup(); window.updateSelectionBox?.(window.selectedItem); window.paper?.view?.update?.();
  },
  applyFontSize(value) {
    const size = Math.max(5, Math.min(250, Number(value) || 42));
    const targets = selected().map(owner).filter(item => item?.className === "PointText"); if (!targets.length) return;
    window.beginHistoryTransaction?.("text-size"); targets.forEach(item => { item.fontSize = size; item.data = { ...(item.data || {}), fontSize: size }; });
    window.commitHistoryTransaction?.("text-size"); syncFontSizeInputs(size); window.paper?.view?.update?.(); notifyTransformObservers({ type: "text-size", size });
  }
};
function bind() {
  ["objRotation", "ctxRotation"].forEach(id => { const input = document.getElementById(id); if (input && !input.dataset.rotationOwner) { input.dataset.rotationOwner = "1"; input.addEventListener("change", () => rotationController.applyManual(input.value)); } });
  ["objFontSize", "ctxFontSize"].forEach(id => { const input = document.getElementById(id); if (input && !input.dataset.fontSizeOwner) { input.dataset.fontSizeOwner = "1"; input.addEventListener("change", () => rotationController.applyFontSize(input.value)); } });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true }); else bind();
window.EKKO_ROTATION_CONTROLLER = rotationController;

/** Canonical owner for pointer/manual rotation and text-size commands. */
import {
  beginTransformTransaction, finalizeTransformTransaction, notifyTransformObservers,
  transformPublicItem, resolvePublicTransformOwner
} from "./fusionController.js";
const normalize = value => ((Number(value) || 0) % 360 + 360) % 360;

/* =========================================================================
   TEXTO: DUENO UNICO DEL TAMANO DE FUENTE
   ---------------------------------------------------------------------------
   El tamano de fuente aparece en DOS superficies (la barra superior y la barra
   flotante) y el texto vive en TRES representaciones (PointText, grupo curvado,
   grupo espaciado). Antes esta seccion:

     - escribia solo en ctxFontSize y no en objFontSize, asi que el campo de la
       barra superior era un input MUERTO: no tenia ni un listener en todo el
       repositorio (grep: una sola aparicion, la del HTML);
     - reconocia texto unicamente con `className === "PointText"`, asi que con
       texto curvado o espaciado no encontraba dueno, no escribia el valor, y el
       campo se quedaba en 42.

   Los helpers de abajo son la UNICA lectura de "hay texto aqui y de que
   tamano". No importan textToolbar a proposito: textToolbar no depende de este
   modulo, pero fusionController si, y un import cruzando los dos abriria un
   ciclo. La reconstruccion del owner va por la superficie publica que
   textToolbar publica en window.
   ========================================================================= */
const FONT_SIZE_IDS = ["ctxFontSize", "objFontSize"];

/* El predicado canonico vive en textToolbar, que es el modulo de texto. Se
   consulta por la superficie publica porque importar textToolbar desde aca
   abriria un ciclo: textToolbar baja por fusionCore y fusionController, que es
   justo lo que este modulo importa. La copia local de abajo solo se usa si el
   modulo de texto todavia no se registro. */
function isTextOwner(item) {
  const canonico = window.EKKO_TEXT_IS_OWNER;
  if (typeof canonico === "function") return !!canonico(item);
  if (!item) return false;
  const data = item.data || {};
  if (data.isText || data.isCurvedGroup === true || data.isSpacedGroup === true) return true;
  return item.className === "PointText";
}

/**
 * Cuerpo del texto en unidades de lienzo, venga de la representacion que
 * venga. Devuelve null cuando el owner no es texto, para que el llamador no
 * tenga que distinguir "no hay texto" de "el texto mide cero".
 */
function readFontSize(owner) {
  if (!isTextOwner(owner)) return null;
  if (owner.className === "PointText" && Number(owner.fontSize) > 0) return Number(owner.fontSize);
  const value = Number((owner.data || {}).fontSize);
  return Number.isFinite(value) && value > 0 ? value : null;
}

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
  ["ctxRotation"].forEach(id => { const input = document.getElementById(id); if (input) input.value = shown; });
}
function hidePopup() { const p = popup(); if (p) { p.classList.remove("is-visible", "is-snap", "is-non-snap"); p.textContent = ""; } }
function owner(entry) { return resolvePublicTransformOwner(entry); }
function syncFontSizeInputs(value) {
  const size = Math.max(5, Math.min(250, Number(value) || 42));
  const shown = String(Math.round(size));
  /* Las DOS superficies. Antes solo ctxFontSize, y por eso el campo de la barra
     superior no se actualizaba nunca al seleccionar otro texto. */
  FONT_SIZE_IDS.forEach(id => { const input = document.getElementById(id); if (input) input.value = shown; });
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
    finalizeTransformTransaction(reason);
    // finalizeTransformTransaction closes only the transform controller state;
    // the history owner must explicitly mark and commit the shared snapshot.
    // Otherwise Ctrl+Z cancels this still-open transaction and pops the last
    // import snapshot instead of reverting rotation.
    if (reason === "cancelled") {
      window.cancelHistoryTransaction?.("rotation-cancelled");
    } else {
      window.saveHistory?.();
      window.commitHistoryTransaction?.("transform");
    }
    window.rotationActive = false; window.rotationTarget = null; window.rotationTargets = []; window.isRotationSnapped = false;
    hidePopup(); window.updateSelectionBox?.(window.selectedItem); window.updateSelectionInfo?.(); window.paper?.view?.update?.();
  },
  cancelPointer() { this.endPointer("cancelled"); },
  hidePopup,
  resolveOwner(item) { return owner(item); },
  syncSelection(item) {
    const owners = selected().map(owner).filter(Boolean);
    if (!owners.length) {
      ["ctxRotation"].forEach(id => { const input = document.getElementById(id); if (input) { input.value = ""; input.disabled = true; } });
      FONT_SIZE_IDS.forEach(id => { const input = document.getElementById(id); if (input) input.value = ""; });
      document.getElementById("topBar")?.setAttribute("data-ekko-texto", "no");
      window.updateSelectionInfo?.();
      return;
    }
    const angles = owners.map(syncOwnerRotation);
    const first = angles[0];
    const mixed = angles.some(value => Math.abs(normalize(value - first)) > 0.25);
    const shown = mixed ? "Mixto" : String(Math.round(normalize(first)));
    ["ctxRotation"].forEach(id => {
      const input = document.getElementById(id);
      if (input) { input.value = shown; input.disabled = false; }
    });
    /* Cualquier representacion de texto cuenta, no solo PointText. Con texto
       curvado o espaciado el find anterior no encontraba nada, asi que el campo
       de tamano quedaba con el valor viejo y el atributo de la barra superior
       decia que no habia texto. */
    const textOwner = owners.find(isTextOwner) || null;
    const size = textOwner ? readFontSize(textOwner) : null;
    if (size) syncFontSizeInputs(size);
    else FONT_SIZE_IDS.forEach(id => { const input = document.getElementById(id); if (input) input.value = ""; });
    // La barra superior reserva espacio para tamano de fuente, radio de
    // curvatura y espaciado. Eso solo le sirve al cliente cuando hay TEXTO
    // seleccionado; con otra cosa esas cajas quedan vacias y empujan las
    // herramientas fuera de la pantalla. Se avisa aca, que es donde ya se
    // sabe que hay texto, y la hoja de estilos decide que se ve.
    document.getElementById("topBar")?.setAttribute("data-ekko-texto", textOwner ? "si" : "no");
    window.updateSelectionInfo?.();
  } ,
  syncFontSizeInputs,
  applyManual(value) {
    if (String(value).trim().toLowerCase() === "mixto") return;
    const items = selected(); if (!items.length) return;
    const targets = items.map(item => ({ item, owner: owner(item) })).filter(entry => entry.owner); if (!targets.length) return;
    const next = normalize(value);
    const bounds = targets.reduce((out, entry) => out ? out.unite(entry.owner.bounds) : entry.owner.bounds.clone(), null);
    const center = bounds?.center;
    const deltas = targets.map(entry => next - syncOwnerRotation(entry.owner));
    window.EKKO_TRANSFORM_TRACE?.boundary("before-rotate", {
      phase: "numeric", requested: Number(value), normalized: next, targetCount: targets.length,
      deltas
    });
    beginTransformTransaction("rotate", targets, null);
    targets.forEach((entry, index) => {
      transformPublicItem(entry.owner, { type: "rotate", angle: deltas[index], center });
      syncOwnerRotation(entry.owner);
    });
    updatePopup(next);
    // Numeric rotation is a complete public transform transaction. Mark the
    // shared history owner after the matrix changed, then close it before the
    // next keyboard command can reach undo/redo.
    window.saveHistory?.();
    finalizeTransformTransaction("committed");
    window.commitHistoryTransaction?.("transform");
    window.EKKO_TRANSFORM_TRACE?.boundary("after-transform-commit", {
      phase: "numeric", requested: Number(value), normalized: next,
      targetCount: targets.length, historyLabel: "transform"
    });
    notifyTransformObservers({ type: "rotate", cumulativeAngle: next, numeric: true });
    hidePopup(); window.updateSelectionBox?.(window.selectedItem); window.updateSelectionInfo?.(); window.paper?.view?.update?.();
  },
  applyFontSize(value) {
    const size = Math.max(5, Math.min(250, Number(value) || 42));
    /* Las TRES representaciones, no solo PointText. Antes el filtro
       `item?.className === "PointText"` descartaba los grupos curvos y
       espaciados, con lo cual el campo de tamano no tenia efecto sobre ellos. */
    const targets = selected().map(owner).filter(isTextOwner);
    if (!targets.length) return;
    window.beginHistoryTransaction?.("text-size");
    targets.forEach(item => {
      /* Se escribe en la propiedad Y en data.*. El PointText lee la propiedad;
         los grupos curvan y espaciado reconstruyen desde data.fontSize. */
      if (item.className === "PointText") item.fontSize = size;
      item.data = { ...(item.data || {}), fontSize: size };
    });
    window.commitHistoryTransaction?.("text-size");
    /* Un owner agrupado tiene los glifos HORNEADOS: cambiar data.fontSize sola
       no llega a la pantalla. Hay que reconstruirlo, y el dueno de esa
       reconstruccion es textToolbar (window.rebuildEKKOTextOwner). El PointText
       se redibuja solo, asi que se deja fuera. */
    targets.forEach(item => {
      if (item.className === "PointText") return;
      window.rebuildEKKOTextOwner?.(item);
    });
    syncFontSizeInputs(size);
    window.paper?.view?.update?.();
    notifyTransformObservers({ type: "text-size", size });
  }
};
function bind() {
  ["ctxRotation"].forEach(id => { const input = document.getElementById(id); if (input && !input.dataset.rotationOwner) { input.dataset.rotationOwner = "1"; input.addEventListener("change", () => rotationController.applyManual(input.value)); } });
  /* objFontSize entra en la lista. No tenia listener en NINGUN punto del
     repositorio: el campo "Tamano" de la barra superior era un input muerto. */
  FONT_SIZE_IDS.forEach(id => { const input = document.getElementById(id); if (input && !input.dataset.fontSizeOwner) { input.dataset.fontSizeOwner = "1"; input.addEventListener("change", () => rotationController.applyFontSize(input.value)); } });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true }); else bind();
window.EKKO_ROTATION_CONTROLLER = rotationController;

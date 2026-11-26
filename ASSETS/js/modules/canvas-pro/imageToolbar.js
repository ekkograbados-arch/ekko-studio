import { getPublicOwner } from "./designGeometry.js";
import { getStackingUnit } from "./vectorSemantics.js";
import { transformPublicItem } from "./fusionController.js";

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/imageToolbar.js (v36.0 PRO - Smart Spatial Collision Z-Order & Apilado de grabado)
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/imageToolbar.js
Descripción: Módulo independiente para el procesamiento, escalado, ordenación,
duplicación y filtrado de brillo y contraste píxel a píxel de imágenes en Paper.js.
Incorpora:
- ORDEN Z INTELIGENTE POR COLISIÓN ESPACIAL (estilo grabado):
  Al subir o bajar de capa ('bringImageForward' / 'sendImageBackward'), detecta
  automáticamente el siguiente elemento que colisiona o se solapa geométricamente
  con el objeto en pantalla ('bounds.intersects' y 'intersects()'), permitiendo
  que con UN SOLO CLIC la pieza salte por encima o por debajo del obstáculo visual
  (ej. letra F respecto a laureles) sin requerir múltiples clics en capas no solapadas.
- ACCESO DIRECTO A EXTREMOS Z:
  'bringImageToFront' (Al Frente / Z máximo bajo mockup) y 'sendImageToBack' (Al Fondo / Z:0).
- PRESERVACIÓN DE MÁSCARA DE PRODUCTO (Mockup Lock):
  El mockup del producto ('window.currentMockup') se preserva siempre en el plano superior
  para evitar que los diseños desborden el área de grabado.
- REACTIVIDAD CSG TOTAL:
  Dispara 'recalculateDynamicSubtractions()' para actualizar calados en vivo.
========================================================================= */

function getContentItem(item) {
  return getPublicOwner(item) || item || null;
}

function activeFusionEdit() {
  if (!window.fusionEditActive || !window.EKKO_FUSION_EDIT?.getState) return null;
  const state = window.EKKO_FUSION_EDIT.getState();
  return state?.active?.project ? state : null;
}
function finishFusionImageEdit(state) {
  if (!state) return;
  state.wrapper?.data && (state.wrapper.data = { ...state.wrapper.data });
  window.EKKO_FUSION_EDIT?.markDirty?.();
  // Selection is synchronized once per tool action, never per animation frame.
  window.EKKO_FUSION_EDIT?.selectImage?.(state.activeIndex);
}

/**
 * Baja hasta el Raster real cuando lo que se pasa es el envoltorio.
 *
 * La app envuelve cada pieza importada en un grupo de recorte, asi que lo
 * seleccionado suele ser el Group. Las herramientas que necesitan PIXELES
 * (brillo, contraste, filtros) reciben ese Group y no tienen nada que leer:
 * antes se comprobaba con `instanceof paper.Raster` y salia en silencio, con
 * el control movido y nada cambiando, como un boton muerto.
 *
 * Es la misma trampa que en Trazar y en Quitar Fondo. Se resuelve aqui una
 * sola vez, en vez de repetir el chequeo en cada herramienta.
 */
export function getRasterReal(item) {
  let actual = getContentItem(item);
  if (!actual) return null;
  try { if (actual instanceof paper.Raster) return actual; } catch (_) { return null; }
  const pila = actual.children ? [...actual.children] : [];
  while (pila.length) {
    const c = pila.shift();
    if (!c) continue;
    try { if (c instanceof paper.Raster) return c; } catch (_) { continue; }
    if (c.children) pila.push(...c.children);
  }
  return null;
}

function isMockupOrUI(item) {
  let curr = item;
  while (curr) {
    const d = curr.data || {};
    if (d.mockup || d.isMask || d.wasClipMask || d.isSelectionBox || d.isHandle ||
        d.isNodeHandle || d.isCurveHandle || d.isNodeEditOverlay || d.isSmartGuide ||
        d.isMeasurement || d.isTracePreview) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

// Comprueba colisión espacial real entre dos elementos del lienzo
function itemsOverlap(itemA, itemB) {
  if (!itemA || !itemB || itemA === itemB) return false;
  const contentA = getContentItem(itemA);
  const contentB = getContentItem(itemB);
  if (!contentA || !contentB) return false;
  if (!contentA.bounds || !contentB.bounds) return false;

  // 1. Descarte rápido por AABB (Bounding Box)
  if (!contentA.bounds.intersects(contentB.bounds)) {
    return false;
  }

  // 2. Comprobación geométrica precisa
  try {
    if (typeof contentA.intersects === 'function' && contentA.intersects(contentB)) {
      return true;
    }
    if (typeof contentA.contains === 'function' && contentA.contains(contentB.bounds.center)) {
      return true;
    }
    if (typeof contentB.contains === 'function' && contentB.contains(contentA.bounds.center)) {
      return true;
    }
    return true;
  } catch (e) {
    return contentA.bounds.intersects(contentB.bounds);
  }
}

// Escalar la imagen de forma interactiva (achicar / agrandar)
export function scaleImage(item, factor) {
  const fusion = activeFusionEdit();
  if (fusion) {
    const target = fusion.active;
    const amount = Number(factor);
    if (!Number.isFinite(amount) || amount <= 0) return;
    target.scale(amount, amount, target.bounds.center);
    finishFusionImageEdit(fusion);
    paper.view.update();
    return;
  }
  if (!item || item.data?.locked) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  // Scaling is a public transform, not a direct child mutation. The previous
  // path scaled the content inside a clipGroup and left geomBase, owner
  // matrices and dynamic CSG out of sync. That made a hole look opaque or
  // stopped it from recalculating when the contextual +/- buttons were used.
  const target = getPublicOwner(item) || item;
  if (!target || target.data?.locked || !target.bounds) return;
  const applied = transformPublicItem(target, {
    type: 'scale',
    sx: Number(factor) || 1,
    sy: Number(factor) || 1,
    center: target.bounds.center.clone()
  });

  if (applied?.applied && typeof window.recalculateDynamicSubtractions === 'function') {
    window.recalculateDynamicSubtractions();
  }
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(target);
  }
  paper.view.update();
}

// Helper para clonar un único objeto preservando máscara o clon plano
function cloneSingleItem(targetItem) {
  if (!targetItem || targetItem.data?.locked) return null;
  let duplicatedObject = null;

  if (targetItem.data && targetItem.data.clipGroup) {
    const content = targetItem.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
    if (!content) return null;

    const contentClone = content.clone();
    contentClone.position = contentClone.position.add(new paper.Point(20, 20));
    contentClone.data = { ...(contentClone.data || {}), locked: false };
    duplicatedObject = window.clipItem(contentClone);
  } else {
    const clone = targetItem.clone();
    clone.position = clone.position.add(new paper.Point(20, 20));
    clone.data = { ...(clone.data || {}), locked: false };
    duplicatedObject = clone;
  }

  if (duplicatedObject) {
    paper.project.activeLayer.addChild(duplicatedObject);
    if (window.currentMockup) {
      duplicatedObject.insertBelow(window.currentMockup);
    }
  }
  return duplicatedObject;
}

// Duplicar el objeto seleccionado de forma inteligente (soporta 1 objeto, multiselección y salida segura de nodeEditMode)
export function duplicateImage(item) {
  if (window.fusionEditActive) {
    const duplicated = window.EKKO_FUSION_EDIT?.duplicateActive?.();
    Promise.resolve(duplicated).catch(error => console.warn('[EKKO IMAGEN] duplicar interno:', error));
    return;
  }
  // 1. Si está en modo edición de nodos, confirmar y salir para duplicar el objeto completo
  if (window.nodeEditMode && typeof window.exitNodeEditMode === 'function') {
    const targetObj = window.nodeEditTarget || item || window.selectedItem;
    window.exitNodeEditMode(true);
    item = targetObj;
  }

  // 2. Determinar la lista de objetos a duplicar (multiselección o selección simple)
  const itemsToDuplicate = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (item ? [item] : (window.selectedItem ? [window.selectedItem] : []));

  if (itemsToDuplicate.length === 0) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  const duplicatedList = [];
  itemsToDuplicate.forEach(it => {
    const cloned = cloneSingleItem(it);
    if (cloned) duplicatedList.push(cloned);
  });

  if (duplicatedList.length > 0) {
    duplicatedList.forEach(cl => {
      if (typeof window.EKKO_FUSION_CONTROLLER?.rekeyFusionClone === 'function') {
        window.EKKO_FUSION_CONTROLLER.rekeyFusionClone(cl);
      }
    });
    const primaryClone = duplicatedList[duplicatedList.length - 1];
    if (typeof window.commitSelectionContext === 'function') {
      window.commitSelectionContext(duplicatedList, primaryClone, 'duplicate');
    } else if (typeof window.selectItem === 'function') {
      window.selectItem(primaryClone);
    }
    if (typeof window.recalculateDynamicSubtractions === 'function') {
      window.recalculateDynamicSubtractions();
    }
  }
  paper.view.update();
}

// Eliminar el objeto u objetos seleccionados de forma segura (soporta salida de nodeEditMode y multiselección)
export function deleteImage(item) {
  if (window.fusionEditActive) {
    window.EKKO_FUSION_EDIT?.removeActive?.();
    return;
  }
  // 1. Si está en modo edición de nodos, salir primero limpiando tiradores de pantalla
  if (window.nodeEditMode && typeof window.exitNodeEditMode === 'function') {
    const targetObj = window.nodeEditTarget || item || window.selectedItem;
    window.exitNodeEditMode(true);
    item = targetObj;
  }

  // 2. Determinar la lista de objetos a eliminar
  const itemsToDelete = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (item ? [item] : (window.selectedItem ? [window.selectedItem] : []));

  if (itemsToDelete.length === 0) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  itemsToDelete.forEach(it => {
    if (it && !it.data?.locked) {
      if (typeof window.EKKO_FUSION_CONTROLLER?.removeFusionForItem === 'function') {
        window.EKKO_FUSION_CONTROLLER.removeFusionForItem(it);
      }
      it.remove();
    }
  });

  if (typeof window.deselectItem === 'function') {
    window.deselectItem();
  }
  if (typeof window.recalculateDynamicSubtractions === 'function') {
    window.recalculateDynamicSubtractions();
  }
  paper.view.update();
}

/**
 * Subir el nivel de capa de forma inteligente (apilado de grabado):
 * Salta directamente sobre el siguiente elemento con el que colisiona o se solapa en pantalla.
 */
export function bringImageForward(item) {
  const fusion = activeFusionEdit();
  if (fusion) { window.EKKO_FUSION_EDIT?.reorderActive?.('forward'); return; }
  item = getStackingUnit(item) || item;
  if (!item || item.data?.locked) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  const parent = item.parent || (paper.project && paper.project.activeLayer);
  if (!parent || !parent.children) return;

  const siblings = parent.children;
  const myIndex = siblings.indexOf(item);
  if (myIndex === -1) return;

  // Buscar el primer hermano superior que colisione espacialmente con este elemento
  let targetSibling = null;
  for (let i = myIndex + 1; i < siblings.length; i++) {
    const candidate = siblings[i];
    if (candidate.data && (candidate.data.mockup || candidate.data.isMask)) break;
    if (isMockupOrUI(candidate)) continue;

    if (itemsOverlap(item, candidate)) {
      targetSibling = candidate;
      break;
    }
  }

  if (targetSibling) {
    item.insertAbove(targetSibling);
  } else {
    // Si no colisiona con ninguno por encima, avance contiguo estándar
    const next = item.nextSibling;
    if (next && (!next.data || !next.data.mockup)) {
      item.insertAbove(next);
    } else if (window.currentMockup) {
      item.insertBelow(window.currentMockup);
    } else {
      item.bringToFront();
    }
  }

  // Garantía: el mockup siempre queda por encima del diseño
  if (window.currentMockup) {
    window.currentMockup.bringToFront();
  }

  if (typeof window.recalculateDynamicSubtractions === 'function') {
    window.recalculateDynamicSubtractions();
  }

  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(item);
  }
  paper.view.update();
}

/**
 * Bajar el nivel de capa de forma inteligente (apilado de grabado):
 * Salta directamente por debajo del siguiente elemento con el que colisiona o se solapa en pantalla.
 */
export function sendImageBackward(item) {
  const fusion = activeFusionEdit();
  if (fusion) { window.EKKO_FUSION_EDIT?.reorderActive?.('backward'); return; }
  item = getStackingUnit(item) || item;
  if (!item || item.data?.locked) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  const parent = item.parent || (paper.project && paper.project.activeLayer);
  if (!parent || !parent.children) return;

  const siblings = parent.children;
  const myIndex = siblings.indexOf(item);
  if (myIndex === -1) return;

  // Buscar el primer hermano inferior que colisione espacialmente con este elemento
  let targetSibling = null;
  for (let i = myIndex - 1; i >= 0; i--) {
    const candidate = siblings[i];
    if (isMockupOrUI(candidate)) continue;

    if (itemsOverlap(item, candidate)) {
      targetSibling = candidate;
      break;
    }
  }

  if (targetSibling) {
    item.insertBelow(targetSibling);
  } else {
    // Si no colisiona con ninguno por debajo, retroceso contiguo estándar
    const prev = item.previousSibling;
    if (prev && !isMockupOrUI(prev)) {
      item.insertBelow(prev);
    } else {
      item.sendToBack();
    }
  }

  // Garantía: el mockup siempre queda por encima del diseño
  if (window.currentMockup) {
    window.currentMockup.bringToFront();
  }

  if (typeof window.recalculateDynamicSubtractions === 'function') {
    window.recalculateDynamicSubtractions();
  }

  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(item);
  }
  paper.view.update();
}

/**
 * Traer al Frente absoluto (Push to Front - apilado de grabado):
 * Envía el elemento a la parte superior del orden de dibujo, justo bajo el mockup.
 */
export function bringImageToFront(item) {
  const fusion = activeFusionEdit();
  if (fusion) { window.EKKO_FUSION_EDIT?.reorderActive?.('front'); return; }
  item = getStackingUnit(item) || item;
  if (!item || item.data?.locked) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  if (window.currentMockup) {
    item.insertBelow(window.currentMockup);
  } else {
    item.bringToFront();
  }

  if (window.currentMockup) {
    window.currentMockup.bringToFront();
  }

  if (typeof window.recalculateDynamicSubtractions === 'function') {
    window.recalculateDynamicSubtractions();
  }

  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(item);
  }
  paper.view.update();
}

/**
 * Enviar al Fondo absoluto (Push to Back - apilado de grabado):
 * Envía el elemento al fondo del orden de dibujo (Z:0).
 */
export function sendImageToBack(item) {
  const fusion = activeFusionEdit();
  if (fusion) { window.EKKO_FUSION_EDIT?.reorderActive?.('back'); return; }
  item = getStackingUnit(item) || item;
  if (!item || item.data?.locked) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  const parent = item.parent || (paper.project && paper.project.activeLayer);
  if (parent) {
    parent.insertChild(0, item);
  } else {
    item.sendToBack();
  }

  if (window.currentMockup) {
    window.currentMockup.bringToFront();
  }

  if (typeof window.recalculateDynamicSubtractions === 'function') {
    window.recalculateDynamicSubtractions();
  }

  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(item);
  }
  paper.view.update();
}

const brightnessJobs = new WeakMap();
const BRIGHTNESS_WORKER = `
self.onmessage = async function(event) {
  const bitmap = event.data.bitmap;
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    context.filter = event.data.filter;
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    self.postMessage({ blob });
  } catch (error) {
    self.postMessage({ error: String(error && error.message || error) });
  }
};`;

function normalizeFilterValue(value) {
  let normalized = Number(value) || 0;
  if (Math.abs(normalized) > 100) normalized = (normalized / 255) * 100;
  return Math.max(-100, Math.min(100, normalized));
}
function brightnessSource(raster) {
  raster.data = raster.data || {};
  if (raster.data.originalCanvas) return raster.data.originalCanvas;
  const current = raster._canvas || raster._image || raster.image || null;
  if (current?.getContext) {
    // Canvases are immutable in this route: reuse the reference instead of
    // allocating and drawing another full-resolution bitmap on the UI thread.
    raster.data.originalCanvas = current;
    return current;
  }
  if (!current) return null;
  const width = current.naturalWidth || current.width || 0;
  const height = current.naturalHeight || current.height || 0;
  if (!width || !height) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').drawImage(current, 0, 0, width, height);
  raster.data.originalCanvas = canvas;
  return canvas;
}
function loadBlobImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob), image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen procesada')); };
    image.src = url;
  });
}
async function filterInWorker(source, filter) {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' ||
      typeof createImageBitmap !== 'function' || typeof source?.getContext !== 'function') return null;
  const bitmap = await createImageBitmap(source);
  const url = URL.createObjectURL(new Blob([BRIGHTNESS_WORKER], { type: 'text/javascript' }));
  const worker = new Worker(url);
  URL.revokeObjectURL(url);
  try {
    const blob = await new Promise((resolve, reject) => {
      worker.onmessage = event => event.data?.error ? reject(new Error(event.data.error)) : resolve(event.data?.blob);
      worker.onerror = event => { event.preventDefault?.(); reject(new Error(event.message || 'Fallo al procesar la imagen')); };
      worker.postMessage({ bitmap, filter }, [bitmap]);
    });
    return await loadBlobImage(blob);
  } finally {
    worker.terminate();
  }
}
function filterOnMainThread(source, filter) {
  const canvas = document.createElement('canvas');
  canvas.width = source.width; canvas.height = source.height;
  const context = canvas.getContext('2d');
  context.filter = filter;
  context.drawImage(source, 0, 0);
  return canvas;
}
async function applyRasterBrightnessContrast(raster, brightness, contrast, isValid = () => true) {
  const source = brightnessSource(raster);
  if (!source || source.width <= 1 || source.height <= 1) return false;
  const filter = `brightness(${100 + normalizeFilterValue(brightness)}%) contrast(${100 + normalizeFilterValue(contrast)}%)`;
  const sequence = (brightnessJobs.get(raster) || 0) + 1;
  brightnessJobs.set(raster, sequence);
  let output = null;
  try { output = await filterInWorker(source, filter); } catch (_) { /* portable fallback below */ }
  if (brightnessJobs.get(raster) !== sequence || raster.data.originalCanvas !== source || !isValid()) return false;
  output = output || filterOnMainThread(source, filter);
  if (brightnessJobs.get(raster) !== sequence || raster.data.originalCanvas !== source || !isValid()) return false;
  const matrix = raster.matrix.clone();
  raster.onLoad = null;
  if (output instanceof HTMLCanvasElement) raster.canvas = output;
  else raster.image = output;
  raster.matrix = matrix;
  return true;
}

// Brillo/contraste se procesa fuera del hilo principal cuando hay OffscreenCanvas.
// La alternativa usa el filtro nativo del canvas, sin getImageData ni bucles por píxel.
export async function applyBrightnessContrast(item, brightness, contrast) {
  const fusion = activeFusionEdit();
  const real = fusion?.active || getRasterReal(item);
  if (!real) {
    console.warn("[EKKO IMAGEN] brillo/contraste: la seleccion no contiene una imagen");
    return false;
  }
  const valid = () => !fusion || (window.fusionEditActive &&
    window.EKKO_FUSION_EDIT?.getState()?.token === fusion.token && fusion.active === real);
  const changed = await applyRasterBrightnessContrast(real, brightness, contrast, valid);
  if (!changed || !valid()) return false;
  finishFusionImageEdit(fusion);
  if (!fusion && typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(real.parent?.data?.clipGroup ? real.parent : real);
  }
  paper.view.update();
  return true;
}

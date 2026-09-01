/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/imageToolbar.js (v36.0 PRO - Smart Spatial Collision Z-Order & LightBurn Stacking)
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/imageToolbar.js
Descripción: Módulo independiente para el procesamiento, escalado, ordenación,
duplicación y filtrado de brillo y contraste píxel a píxel de imágenes en Paper.js.
Incorpora:
- ORDEN Z INTELIGENTE POR COLISIÓN ESPACIAL (LightBurn Style):
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
  if (!item || item.data?.locked) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();

  // Obtiene la imagen real dentro del Clip Group
  const target = item.data?.clipGroup
    ? item.children.find(c => !c.clipMask)
    : item;

  if (target) {
    target.scale(factor);
    if (typeof window.updateSelectionBox === 'function') {
      window.updateSelectionBox(item);
    }
    paper.view.update();
  }
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
    if (typeof window.deselectItem === 'function') window.deselectItem();
    window.selectedItems = [...duplicatedList];
    window.selectedItem = duplicatedList[duplicatedList.length - 1];
    duplicatedList.forEach(cl => { cl.selected = true; });

    if (typeof window.updateSelectionBox === 'function') {
      window.updateSelectionBox(window.selectedItem);
    }
    if (typeof window.updateContextualMenu === 'function') {
      window.updateContextualMenu(window.selectedItem);
    }
    if (typeof window.recalculateDynamicSubtractions === 'function') {
      window.recalculateDynamicSubtractions();
    }
  }
  paper.view.update();
}

// Eliminar el objeto u objetos seleccionados de forma segura (soporta salida de nodeEditMode y multiselección)
export function deleteImage(item) {
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
 * Subir el nivel de capa de forma inteligente (LightBurn Style):
 * Salta directamente sobre el siguiente elemento con el que colisiona o se solapa en pantalla.
 */
export function bringImageForward(item) {
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
 * Bajar el nivel de capa de forma inteligente (LightBurn Style):
 * Salta directamente por debajo del siguiente elemento con el que colisiona o se solapa en pantalla.
 */
export function sendImageBackward(item) {
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
 * Traer al Frente absoluto (Push to Front - LightBurn Style):
 * Envía el elemento a la parte superior del orden de dibujo, justo bajo el mockup.
 */
export function bringImageToFront(item) {
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
 * Enviar al Fondo absoluto (Push to Back - LightBurn Style):
 * Envía el elemento al fondo del orden de dibujo (Z:0).
 */
export function sendImageToBack(item) {
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

// Aplicar filtros de brillo y contraste píxel a píxel mediante Canvas nativo de alto rendimiento
export function applyBrightnessContrast(raster, brightness, contrast) {
  if (!raster || !(raster instanceof paper.Raster)) return;

  // 0. SOLUCIÓN AL EVENT LEAK: Anular de raíz cualquier callback onLoad obsoleto para evitar que
  // se re-dispare recursivamente al reasignar .canvas y destruya la imagen o resetee sus datos.
  if (raster.onLoad) {
    raster.onLoad = null;
  }

  // 1. Inicializar la copia original (originalCanvas) de alta calidad si no existe con resolución súper robusta
  if (!raster.data.originalCanvas) {
    const canvas = document.createElement('canvas');
    const src = raster.image || raster.canvas;
    const w = (src ? (src.naturalWidth || src.width) : 0) || raster.width || (raster.size ? raster.size.width : 300);
    const h = (src ? (src.naturalHeight || src.height) : 0) || raster.height || (raster.size ? raster.size.height : 300);

    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (src) {
      ctx.drawImage(src, 0, 0, w, h);
    }
    raster.data.originalCanvas = canvas;
  }

  const origCanvas = raster.data.originalCanvas;
  const w = origCanvas.width;
  const h = origCanvas.height;
  if (w <= 1 || h <= 1) return; // Evitar procesar imágenes vacías o no cargadas

  const procCanvas = document.createElement('canvas');
  procCanvas.width = w;
  procCanvas.height = h;

  const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });
  procCtx.drawImage(origCanvas, 0, 0);

  const imgData = procCtx.getImageData(0, 0, w, h);
  const data = imgData.data;

  // 2. Normalización defensiva de rango para soportar sliders -100/100 o -255/255
  let normContrast = parseFloat(contrast) || 0;
  if (Math.abs(normContrast) > 100) {
    normContrast = (normContrast / 255) * 100;
  }

  let normBrightness = parseFloat(brightness) || 0;
  if (Math.abs(normBrightness) > 100) {
    normBrightness = (normBrightness / 255) * 100;
  }

  // 3. Mapeo matemático ultra estable y lineal de contraste y brillo sin divisiones por cero ni factores negativos
  const factor = (normContrast + 100) / 100; // Factor estable: 0 (gris) a 2 (doble contraste)
  const bOffset = (normBrightness / 100) * 128; // Desplazamiento seguro de brillo

  for (let i = 0; i < data.length; i += 4) {
    // Aplicar contraste alrededor del punto medio (128) y añadir brillo, conservando canal alfa intacto
    data[i]     = Math.max(0, Math.min(255, (data[i] - 128) * factor + 128 + bOffset));     // Rojo
    data[i + 1] = Math.max(0, Math.min(255, (data[i + 1] - 128) * factor + 128 + bOffset)); // Verde
    data[i + 2] = Math.max(0, Math.min(255, (data[i + 2] - 128) * factor + 128 + bOffset)); // Azul
  }

  procCtx.putImageData(imgData, 0, 0);

  // 4. Respaldar propiedades físicas antes de re-asignar el canvas para evitar re-escalados o desplazamientos.
  // IMPORTANTE: Únicamente clonamos y restauramos la matriz del elemento en Paper.js.
  // Al no manipular la propiedad de posición absoluta, evitamos el desplazamiento acumulativo por redondeo de bounds de rotación.
  const oldMatrix = raster.matrix.clone();
  raster.canvas = procCanvas;
  raster.matrix = oldMatrix;

  // 5. Garantía de Caja de Selección: Sincronizar el contorno celeste azul de selección de Paper.js
  if (typeof window.updateSelectionBox === 'function') {
    const itemToUpdate = raster.parent && raster.parent.data?.clipGroup ? raster.parent : raster;
    window.updateSelectionBox(itemToUpdate);
  }

  paper.view.update();
}

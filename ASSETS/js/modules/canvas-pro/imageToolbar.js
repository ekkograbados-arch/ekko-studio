/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/imageToolbar.js
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/imageToolbar.js
Descripción: Módulo independiente para el procesamiento, escalado, ordenación,
duplicación y filtrado de brillo y contraste píxel a píxel de imágenes en Paper.js.
========================================================================= */

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

// Duplicar el elemento seleccionado de forma inteligente manteniendo la máscara estática
export function duplicateImage(item) {
  if (!item || item.data?.locked) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();
  let duplicatedObject;
  // Si es un grupo recortado (clipGroup), duplicamos solo el contenido y re-enmascaramos
  if (item.data && item.data.clipGroup) {
    const content = item.children.find(c => !c.clipMask);
    if (!content) return;
    // 1. Clonar únicamente el contenido interno real (imagen, texto, svg, qr)
    const contentClone = content.clone();
    // 2. Desplazar únicamente el contenido levemente para visibilidad
    contentClone.position = contentClone.position.add(new paper.Point(20, 20));
    contentClone.data = { ...(contentClone.data || {}), locked: false };
    // 3. Crear una nueva máscara perfectamente alineada con el mockup original
    duplicatedObject = window.clipItem(contentClone);
  } else {
    // Objeto normal sin máscara
    const clone = item.clone();
    clone.position = clone.position.add(new paper.Point(20, 20));
    clone.data = { ...(clone.data || {}), locked: false };
    duplicatedObject = clone;
  }
  if (duplicatedObject) {
    paper.project.activeLayer.addChild(duplicatedObject);
    if (window.currentMockup) {
      duplicatedObject.insertBelow(window.currentMockup);
    }
    if (typeof window.selectItem === 'function') {
      window.selectItem(duplicatedObject);
    }
  }
  paper.view.update();
}

// Eliminar el elemento de forma segura
export function deleteImage(item) {
  if (!item || item.data?.locked) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();
  item.remove();
  if (typeof window.deselectItem === 'function') {
    window.deselectItem();
  }
  paper.view.update();
}

// Subir el nivel de capa de la imagen (manteniéndose siempre por debajo del mockup)
export function bringImageForward(item) {
  if (!item || item.data?.locked) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();
  const next = item.nextSibling;
  if (next && (!next.data || !next.data.mockup)) {
    item.insertAbove(next);
  } else if (window.currentMockup) {
    item.insertBelow(window.currentMockup);
  } else {
    item.bringToFront();
  }
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(item);
  }
  paper.view.update();
}

// Bajar el nivel de capa de la imagen
export function sendImageBackward(item) {
  if (!item || item.data?.locked) return;
  if (typeof window.saveHistory === 'function') window.saveHistory();
  const prev = item.previousSibling;
  if (prev) {
    item.insertBelow(prev);
  } else {
    item.sendToBack();
  }
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(item);
  }
  paper.view.update();
}

// Aplicar filtros de brillo y contraste píxel a píxel mediante Canvas nativo de alto rendimiento
export function applyBrightnessContrast(raster, brightness, contrast) {
  if (!raster || !(raster instanceof paper.Raster)) return;

  // 1. Inicializar la copia original (originalCanvas) de alta calidad si no existe
  if (!raster.data.originalCanvas) {
    const canvas = document.createElement('canvas');
    canvas.width = raster.width || 1;
    canvas.height = raster.height || 1;
    const ctx = canvas.getContext('2d');
    
    // Obtener la fuente de píxeles reales (imagen o canvas modificado)
    const src = raster.image || raster.canvas;
    if (src && canvas.width > 1 && canvas.height > 1) {
      // Usar la versión de 5 parámetros para redimensionar y dibujar la imagen de forma exacta sin recortes
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
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

  const procCtx = procCanvas.getContext('2d');
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

  // 4. Respaldar propiedades físicas antes de re-asignar el canvas para evitar re-escalados o desplazamientos
  const oldMatrix = raster.matrix.clone();
  const oldPosition = raster.position.clone();

  raster.canvas = procCanvas;

  raster.matrix = oldMatrix;
  raster.position = oldPosition;

  paper.view.update();
}

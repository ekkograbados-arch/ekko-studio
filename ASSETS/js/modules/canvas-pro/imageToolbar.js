// Función auxiliar para desvincular de raíz las referencias del objeto .data en clones
function sanitizeClonedData(item) {
    if (!item) return;
    if (item.data) {
        item.data = { ...item.data }; // Copia superficial pura de propiedades primitivas
    } else {
        item.data = {};
    }
    if (item.children) {
        item.children.forEach(sanitizeClonedData); // Se ejecuta recursivamente en hijos de Grupos
    }
}
/**
 * ASSETS/js/modules/canvas-pro/imageToolbar.js
 * Módulo independiente para el procesamiento y control de imágenes en el editor.
 */

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
    if (item.data && item.data.clipGroup) {
        const content = item.children.find(c => !c.clipMask);
        if (!content) return;
        const contentClone = content.clone();
        contentClone.position = contentClone.position.add(new paper.Point(20, 20));
        
        sanitizeClonedData(contentClone); // <--- Limpieza recursiva
        contentClone.data.locked = false;
        
        duplicatedObject = window.clipItem(contentClone);
    } else {
        const clone = item.clone();
        clone.position = clone.position.add(new paper.Point(20, 20));
        
        sanitizeClonedData(clone); // <--- Limpieza recursiva
        clone.data.locked = false;
        
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

    // Guarda una copia del canvas original en el primer ajuste para no degradar la imagen
    if (!raster.data.originalCanvas) {
        const canvas = document.createElement('canvas');
        canvas.width = raster.width;
        canvas.height = raster.height;
        const ctx = canvas.getContext('2d');
        if (raster.image) {
            ctx.drawImage(raster.image, 0, 0);
        } else if (raster.canvas) {
            ctx.drawImage(raster.canvas, 0, 0);
        }
        raster.data.originalCanvas = canvas;
    }

    const origCanvas = raster.data.originalCanvas;
    const w = origCanvas.width;
    const h = origCanvas.height;

    const procCanvas = document.createElement('canvas');
    procCanvas.width = w;
    procCanvas.height = h;
    const procCtx = procCanvas.getContext('2d');
    procCtx.drawImage(origCanvas, 0, 0);

    const imgData = procCtx.getImageData(0, 0, w, h);
    const data = imgData.data;

    // Mapeo matemático de brillo (-100 a 100) y contraste (-100 a 100)
    const bOffset = (brightness / 100) * 128;
    const cVal = (contrast / 100) * 128;
    const cFactor = (259 * (cVal + 255)) / (255 * (259 - cVal));

    for (let i = 0; i < data.length; i += 4) {
        data[i]     = Math.max(0, Math.min(255, cFactor * (data[i] - 128) + 128 + bOffset));     // Rojo
        data[i + 1] = Math.max(0, Math.min(255, cFactor * (data[i + 1] - 128) + 128 + bOffset)); // Verde
        data[i + 2] = Math.max(0, Math.min(255, cFactor * (data[i + 2] - 128) + 128 + bOffset)); // Azul
    }

    procCtx.putImageData(imgData, 0, 0);
    raster.canvas = procCanvas;
    paper.view.update();
}

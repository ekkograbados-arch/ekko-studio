/**
 * ASSETS/js/modules/canvas-pro/backgroundRemover.js
 * 
 * Módulo profesional de eliminación de fondo interactivo (PhotoRoom-style) - Versión 6.
 * Ofrece:
 * 1. Pincel borrador (Erase) y restaurador (Restore) con tamaño y dureza (suavizado radial) regulables.
 * 2. Varita mágica (Magic Wand) con algoritmo de inundación (flood-fill) optimizado y tolerancia ajustable.
 * 3. Conservación de calidad extrema (ejecuta los cambios sobre el lienzo de alta resolución de origen).
 * 4. Historial interno de cambios (Deshacer/Rehacer) durante la sesión de recorte.
 * 5. Interfaz de usuario (modal interactiva draggable) con fondo de tablero de ajedrez para previsualizar transparencia.
 * 6. [Híbrido A + B] autoRemoveBackground: Eliminación de fondo automática instantánea utilizando Inteligencia Artificial Local (imgly)
 *    con fallback dinámico a Sobel Edge Contrast en caso de estar offline o bloqueado por el CDN.
 * 7. getRasterFromItem: Resolución segura de imágenes enmascaradas (clipGroup) para evitar TypeErrors.
 * 8. Garantía Antiacortamiento (Anti-Shrink Guarantee): Bloqueo matricial físico tanto en IA como en fallback.
 */

// Estilos CSS dinámicos para la modal del eliminador de fondo
const removeBgStylesId = 'background-remover-pro-styles';
if (typeof document !== 'undefined' && !document.getElementById(removeBgStylesId)) {
    const styleEl = document.createElement('style');
    styleEl.id = removeBgStylesId;
    styleEl.textContent = `
        .bg-remover-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.6);
            z-index: 10005;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
        }
        .bg-remover-modal {
            background-color: #1a1a1a;
            color: #f3f3f3;
            border: 2px solid #007bff;
            border-radius: 12px;
            padding: 20px;
            width: 900px;
            max-width: 95%;
            height: 680px;
            box-shadow: 0 12px 50px rgba(0, 0, 0, 0.8);
            display: flex;
            flex-direction: column;
            user-select: none;
        }
        .bg-remover-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid rgba(0, 123, 255, 0.3);
            padding-bottom: 10px;
            margin-bottom: 15px;
            cursor: move;
        }
        .bg-remover-header h3 {
            margin: 0;
            color: #007bff;
            font-size: 20px;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .bg-remover-container {
            display: grid;
            grid-template-columns: 1fr 280px;
            gap: 15px;
            flex-grow: 1;
            min-height: 0;
        }
        .bg-remover-canvas-area {
            background: repeating-conic-gradient(#252525 0% 25%, #303030 0% 50%) 50% / 20px 20px;
            border: 1px solid #444;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            position: relative;
            cursor: crosshair;
        }
        #bgRemoverCanvas {
            max-width: 100%;
            max-height: 100%;
            object-fit: contain;
            box-shadow: 0 4px 20px rgba(0,0,0,0.5);
        }
        .bg-remover-sidebar {
            background-color: #222;
            border-radius: 8px;
            padding: 15px;
            display: flex;
            flex-direction: column;
            gap: 15px;
            overflow-y: auto;
            border: 1px solid rgba(255,255,255,0.05);
        }
        .bg-remover-section-title {
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #888;
            margin-bottom: 5px;
            font-weight: bold;
        }
        .bg-remover-tool-btn {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 12px;
            background-color: #2d2d2d;
            border: 1px solid #444;
            border-radius: 6px;
            color: #fff;
            cursor: pointer;
            font-size: 14px;
            font-weight: bold;
            text-align: left;
            transition: all 0.2s;
            width: 100%;
        }
        .bg-remover-tool-btn:hover {
            background-color: #3d3d3d;
            border-color: #555;
        }
        .bg-remover-tool-btn.active {
            background-color: #007bff;
            border-color: #007bff;
            box-shadow: 0 0 10px rgba(0, 123, 255, 0.4);
        }
        .bg-remover-slider-group {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .bg-remover-slider-label {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: #ccc;
            font-weight: 500;
        }
        .bg-remover-slider {
            width: 100%;
            accent-color: #007bff;
            cursor: pointer;
            height: 5px;
            border-radius: 2px;
        }
        .bg-remover-info {
            font-size: 11px;
            color: #aaa;
            background-color: #2b2a2b;
            padding: 8px 10px;
            border-radius: 4px;
            border-left: 3px solid #007bff;
            line-height: 1.4;
        }
        .bg-remover-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
            margin-top: 15px;
            border-top: 1px solid #333;
            padding-top: 15px;
        }
        .bg-remover-btn {
            padding: 8px 18px;
            border-radius: 6px;
            font-weight: bold;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            outline: none;
        }
        .bg-remover-btn-cancel {
            background-color: #3b3a3b;
            color: #e6e6e6;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .bg-remover-btn-cancel:hover {
            background-color: #4a4a4b;
        }
        .bg-remover-btn-accept {
            background-color: #007bff;
            color: #ffffff;
            box-shadow: 0 2px 8px rgba(0, 123, 255, 0.4);
        }
        .bg-remover-btn-accept:hover {
            background-color: #0056b3;
            transform: scale(1.02);
        }
        .bg-remover-history-row {
            display: flex;
            gap: 10px;
        }
        .bg-remover-history-btn {
            flex: 1;
            padding: 6px;
            background-color: #2d2d2d;
            border: 1px solid #444;
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            text-align: center;
        }
        .bg-remover-history-btn:hover:not(:disabled) {
            background-color: #3d3d3d;
        }
        .bg-remover-history-btn:disabled {
            opacity: 0.3;
            cursor: not-allowed;
        }
    `;
    document.head.appendChild(styleEl);
}

// Funciones para manejar la interfaz de carga de la IA
function showIaLoadingOverlay() {
    let overlay = document.getElementById('ia-loading-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'ia-loading-overlay';
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
        overlay.style.zIndex = '100000';
        overlay.style.display = 'flex';
        overlay.style.flexDirection = 'column';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.style.fontFamily = 'system-ui, -apple-system, sans-serif';
        overlay.style.color = '#fff';

        overlay.innerHTML = `
            <div style="background-color: #222; padding: 30px; border-radius: 12px; border: 2px solid #007bff; text-align: center; max-width: 450px; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
                <div style="font-size: 40px; margin-bottom: 15px; animation: spin 2s linear infinite;">🧠</div>
                <h4 style="margin: 0 0 10px 0; color: #007bff; font-size: 18px; font-weight: bold;">Cargando Red Neuronal Local</h4>
                <p id="ia-loading-msg" style="margin: 0 0 15px 0; font-size: 13px; color: #ccc; line-height: 1.4;">Inicializando inteligencia artificial para segmentación semántica...</p>
                <div style="width: 100%; background-color: #333; height: 6px; border-radius: 3px; overflow: hidden;">
                    <div id="ia-loading-bar" style="width: 10%; height: 100%; background-color: #007bff; transition: width 0.3s;"></div>
                </div>
                <p style="margin: 10px 0 0 0; font-size: 11px; color: #888;">(La primera vez puede tardar unos segundos, luego se guardará en caché)</p>
            </div>
            <style>
                @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
            </style>
        `;
        document.body.appendChild(overlay);
    } else {
        overlay.style.display = 'flex';
    }
}

function updateIaLoadingProgress(progress, message) {
    const bar = document.getElementById('ia-loading-bar');
    const msg = document.getElementById('ia-loading-msg');
    if (bar) bar.style.width = (progress * 100) + '%';
    if (msg && message) msg.textContent = message;
}

function hideIaLoadingOverlay() {
    const overlay = document.getElementById('ia-loading-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }
}

// Carga asíncrona de imgly con CDN fallback (jsDelivr -> unpkg)
let imglyPromise = null;
function loadImglyLibrary() {
    if (imglyPromise) return imglyPromise;
    imglyPromise = new Promise((resolve, reject) => {
        if (window.imglyBackgroundRemoval) {
            resolve(window.imglyBackgroundRemoval);
            return;
        }
        showIaLoadingOverlay();
        updateIaLoadingProgress(0.2, "Descargando modelo de inteligencia artificial de imgly (jsDelivr)...");
        
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@2.0.1/dist/bundle.js";
        script.async = true;
        
        script.onload = () => {
            if (window.imglyBackgroundRemoval) {
                resolve(window.imglyBackgroundRemoval);
            } else {
                reject(new Error("No se pudo mapear la variable global imglyBackgroundRemoval."));
            }
        };
        
        script.onerror = () => {
            updateIaLoadingProgress(0.4, "jsDelivr falló. Reintentando descarga del modelo desde CDN unpkg...");
            const fallbackScript = document.createElement('script');
            fallbackScript.src = "https://unpkg.com/@imgly/background-removal@2.0.1/dist/bundle.js";
            fallbackScript.async = true;
            
            fallbackScript.onload = () => {
                if (window.imglyBackgroundRemoval) {
                    resolve(window.imglyBackgroundRemoval);
                } else {
                    reject(new Error("Librería de respaldo cargada pero sin objeto global."));
                }
            };
            
            fallbackScript.onerror = () => {
                reject(new Error("Fallo de conexión a los servidores CDN de IA."));
            };
            
            document.head.appendChild(fallbackScript);
        };
        
        document.head.appendChild(script);
    });
    return imglyPromise;
}

/**
 * Resuelve recursivamente el objeto raster real desde cualquier item seleccionado.
 * Soporta de manera nativa objetos directos paper.Raster y envoltorios clipGroup.
 */
export function getRasterFromItem(item) {
    if (!item) return null;
    if (item instanceof paper.Raster) return item;
    if (item.children) {
        const rasterChild = item.children.find(c => {
            try {
                if (c instanceof paper.Raster) return true;
                if (c.className === 'Raster') return true;
                if (c.image || c.canvas) {
                    paper.Raster.prototype.scale.call(c, 1); // Validación estructural
                    return true;
                }
            } catch (e) {}
            return false;
        });
        if (rasterChild) return rasterChild;
        
        const fallbackChild = item.children.find(c => !c.clipMask && c.className !== 'Path' && !c.data?.mockup);
        if (fallbackChild) return fallbackChild;
    }
    return null;
}

/**
 * Calcula el mapa de bordes utilizando el algoritmo de Sobel (contraste horizontal/vertical).
 */
export function computeSobelEdges(data, width, height) {
    const edges = new Uint8Array(width * height);
    const gray = new Uint8Array(width * height);
    
    for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            
            const gx = 
                -1 * gray[(y - 1) * width + (x - 1)] + 1 * gray[(y - 1) * width + (x + 1)] +
                -2 * gray[y * width + (x - 1)]       + 2 * gray[y * width + (x + 1)] +
                -1 * gray[(y + 1) * width + (x - 1)] + 1 * gray[(y + 1) * width + (x + 1)];
                
            const gy = 
                -1 * gray[(y - 1) * width + (x - 1)] - 2 * gray[(y - 1) * width + x] - 1 * gray[(y - 1) * width + (x + 1)] +
                1 * gray[(y + 1) * width + (x - 1)] + 2 * gray[(y + 1) * width + x] + 1 * gray[(y + 1) * width + (x + 1)];
                
            edges[idx] = Math.min(255, Math.abs(gx) + Math.abs(gy));
        }
    }
    return edges;
}

/**
 * Flood fill optimizado con barrera Sobel y delta de vecindad local.
 */
export function magicWandFloodFillDirect(ctx, startX, startY, tolerance, edgesMap = null) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const startIndex = (startY * width + startX) * 4;
    const r0 = data[startIndex];
    const g0 = data[startIndex + 1];
    const b0 = data[startIndex + 2];
    const a0 = data[startIndex + 3];

    if (a0 < 5) return;

    const visited = new Uint8Array(width * height);
    const queueX = new Int32Array(width * height);
    const queueY = new Int32Array(width * height);
    let head = 0;
    let tail = 0;

    queueX[tail] = startX;
    queueY[tail] = startY;
    tail++;
    visited[startY * width + startX] = 1;

    const tolSquare = (tolerance / 100) * 255 * 255 * 3;
    const edgeThreshold = 25; // Sensibilidad de borde Sobel

    while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head++;

        const idx = (y * width + x) * 4;
        const curR = data[idx];
        const curG = data[idx + 1];
        const curB = data[idx + 2];
        
        data[idx + 3] = 0; // Transparente

        const neighbors = [
            { nx: x + 1, ny: y },
            { nx: x - 1, ny: y },
            { nx: x, ny: y + 1 },
            { nx: x, ny: y - 1 }
        ];

        for (let i = 0; i < 4; i++) {
            const { nx, ny } = neighbors[i];
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = ny * width + nx;
                if (!visited[nIdx]) {
                    visited[nIdx] = 1;
                    
                    if (edgesMap && edgesMap[nIdx] > edgeThreshold) {
                        continue;
                    }

                    const pIdx = nIdx * 4;
                    const r = data[pIdx];
                    const g = data[pIdx + 1];
                    const b = data[pIdx + 2];
                    const a = data[pIdx + 3];

                    if (a > 10) {
                        // Delta global con respecto al punto de inicio
                        const dr = r - r0;
                        const dg = g - g0;
                        const db = b - b0;
                        const distSq = dr * dr + dg * dg + db * db;
                        
                        // Delta vecindad local para evitar saltar bordes difusos
                        const dRLoc = r - curR;
                        const dGLoc = g - curG;
                        const dBLoc = b - curB;
                        const locDistSq = dRLoc * dRLoc + dGLoc * dGLoc + dBLoc * dBLoc;

                        if (distSq <= tolSquare && locDistSq < 1500) {
                            queueX[tail] = nx;
                            queueY[tail] = ny;
                            tail++;
                        }
                    }
                }
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * [Fase A - Híbrido]
 * Realiza una eliminación de fondo automática utilizando Inteligencia Artificial Local (imgly).
 * Si falla la red o está offline, hace fallback automático a Sobel Edge Contrast sin achicar la imagen.
 * @param {paper.Raster} raster Objeto de imagen en Paper.js o clipGroup
 */
export async function autoRemoveBackground(raster) {
    const actualRaster = getRasterFromItem(raster);
    if (!actualRaster) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    // 1. Respaldar matriz de transformación física en pantalla (Garantía Antiacortamiento / Anti-Shrink)
    const oldMatrix = actualRaster.matrix.clone();

    // 2. Respaldar originalCanvas si no existe
    if (!actualRaster.data) actualRaster.data = {};
    let srcImage = actualRaster.canvas || actualRaster.image;
    if (!srcImage) return;

    if (!actualRaster.data.originalCanvas) {
        const origCanvas = document.createElement('canvas');
        origCanvas.width = srcImage.width || actualRaster.width;
        origCanvas.height = srcImage.height || actualRaster.height;
        const origCtx = origCanvas.getContext('2d', { willReadFrequently: true });
        origCtx.drawImage(srcImage, 0, 0);
        actualRaster.data.originalCanvas = origCanvas;
    }

    try {
        // Cargar Inteligencia Artificial de segmentación semántica
        const imgly = await loadImglyLibrary();
        showIaLoadingOverlay();
        updateIaLoadingProgress(0.9, "IA analizando la escena y separando sujeto del fondo...");

        // Preparar imagen fuente como blob
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = actualRaster.data.originalCanvas.width;
        tempCanvas.height = actualRaster.data.originalCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(actualRaster.data.originalCanvas, 0, 0);
        
        const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
        
        // Procesar recorte por IA
        const resultBlob = await imgly.removeBackground(blob);
        const resultUrl = URL.createObjectURL(resultBlob);
        const resultImg = new Image();
        
        await new Promise((resolve, reject) => {
            resultImg.onload = resolve;
            resultImg.onerror = reject;
            resultImg.src = resultUrl;
        });

        const editCanvas = document.createElement('canvas');
        editCanvas.width = resultImg.width;
        editCanvas.height = resultImg.height;
        const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
        editCtx.drawImage(resultImg, 0, 0);

        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Asignar píxeles recortados por IA y restaurar matriz física de inmediato para evitar que se achique
        actualRaster.canvas = editCanvas;
        actualRaster.matrix = oldMatrix; // Restablecer tamaño exacto en el lienzo
        actualRaster.data.backgroundAutoRemoved = true;

        URL.revokeObjectURL(resultUrl);
        hideIaLoadingOverlay();

        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(window.selectedItem);
        }
        paper.view.update();

    } catch (err) {
        console.warn("La IA local no pudo ejecutarse. Usando algoritmo de contraste de respaldo (Sobel Contrast Match).", err);
        hideIaLoadingOverlay();
        
        // FALLBACK AUTOMÁTICO AL ALGORITMO DE CONTRASTE DE LAS 4 ESQUINAS CON SOBEL
        const editCanvas = document.createElement('canvas');
        editCanvas.width = actualRaster.data.originalCanvas.width;
        editCanvas.height = actualRaster.data.originalCanvas.height;
        const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
        editCtx.drawImage(actualRaster.data.originalCanvas, 0, 0);

        const width = editCanvas.width;
        const height = editCanvas.height;

        const imgDataForEdges = editCtx.getImageData(0, 0, width, height);
        const edgesMap = computeSobelEdges(imgDataForEdges.data, width, height);

        const corners = [
            { x: 5, y: 5 },
            { x: width - 6, y: 5 },
            { x: 5, y: height - 6 },
            { x: width - 6, y: height - 6 }
        ];

        corners.forEach(p => {
            if (p.x >= 0 && p.x < width && p.y >= 0 && p.y < height) {
                magicWandFloodFillDirect(editCtx, p.x, p.y, 8, edgesMap);
            }
        });

        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Asignar píxeles recortados por Sobel y restaurar matriz física de inmediato para evitar que se achique
        actualRaster.canvas = editCanvas;
        actualRaster.matrix = oldMatrix; // Restablecer tamaño exacto en el lienzo
        actualRaster.data.backgroundAutoRemoved = true;

        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(window.selectedItem);
        }
        paper.view.update();
    }
}

/**
 * Abre la modal de eliminación de fondo interactiva para un paper.Raster
 * @param {paper.Raster} raster Objeto de imagen en Paper.js
 */
export function openBackgroundRemovalModal(raster) {
    const actualRaster = getRasterFromItem(raster);
    if (!actualRaster) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    // 1. Obtener la fuente de píxeles original (alta resolución)
    if (!actualRaster.data) actualRaster.data = {};
    let srcImage = actualRaster.data.originalCanvas || actualRaster.canvas || actualRaster.image;
    if (!srcImage) return;

    // Crear un canvas de edición con las dimensiones originales de la imagen (alta calidad)
    const editCanvas = document.createElement('canvas');
    editCanvas.width = srcImage.width || actualRaster.width;
    editCanvas.height = srcImage.height || actualRaster.height;
    const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
    
    // Si ya tiene un canvas editado (por ej: el auto-removido), usar ese como base
    const baseImage = actualRaster.canvas || srcImage;
    editCtx.drawImage(baseImage, 0, 0);

    // Crear canvas de respaldo para la herramienta de restauración
    const backupCanvas = document.createElement('canvas');
    backupCanvas.width = editCanvas.width;
    backupCanvas.height = editCanvas.height;
    const backupCtx = backupCanvas.getContext('2d');
    
    // El respaldo SIEMPRE debe ser la imagen 100% original con fondo
    const rawOriginal = actualRaster.data.originalCanvas || srcImage;
    backupCtx.drawImage(rawOriginal, 0, 0);

    // 2. Historial de sesión de recorte (Deshacer / Rehacer local)
    const historyStack = [];
    let historyIndex = -1;

    // 3. Crear Estructura de la Modal Interactiva
    const overlay = document.createElement('div');
    overlay.className = 'bg-remover-overlay';

    const modal = document.createElement('div');
    modal.className = 'bg-remover-modal';

    const mmW = actualRaster.bounds.width.toFixed(1);
    const mmH = actualRaster.bounds.height.toFixed(1);

    modal.innerHTML = `
        <div class="bg-remover-header">
            <h3>✂️ Editar Recorte Manual</h3>
            <span style="font-size: 12px; color: #888;">Medidas físicas: <b>${mmW} mm x ${mmH} mm</b></span>
        </div>
        <div class="bg-remover-container">
            <div class="bg-remover-canvas-area" id="bgRemoverArea">
                <canvas id="bgRemoverCanvas"></canvas>
            </div>
            <div class="bg-remover-sidebar">
                <div class="bg-remover-slider-group">
                    <span class="bg-remover-section-title">Historial</span>
                    <div class="bg-remover-history-row">
                        <button class="bg-remover-history-btn" id="btnRemoverUndo" disabled>↩ Deshacer</button>
                        <button class="bg-remover-history-btn" id="btnRemoverRedo" disabled>↪ Rehacer</button>
                    </div>
                </div>
                <div class="bg-remover-slider-group">
                    <span class="bg-remover-section-title">Herramientas</span>
                    <button class="bg-remover-tool-btn active" id="btnToolErase" data-tool="erase">
                        🧽 Pincel Borrador
                    </button>
                    <button class="bg-remover-tool-btn" id="btnToolRestore" data-tool="restore">
                        🖌️ Pincel Restaurador
                    </button>
                    <button class="bg-remover-tool-btn" id="btnToolMagic" data-tool="magic">
                        🪄 Varita Mágica
                    </button>
                </div>
                <div class="bg-remover-slider-group" id="groupBrushControls">
                    <span class="bg-remover-section-title">Ajustes de Pincel</span>
                    <div class="bg-remover-slider-group">
                        <div class="bg-remover-slider-label">
                            <span>Tamaño:</span>
                            <span id="lblBrushSize">20 px</span>
                        </div>
                        <input type="range" class="bg-remover-slider" id="slideBrushSize" min="1" max="150" value="20">
                    </div>
                    <div class="bg-remover-slider-group" style="margin-top: 10px;">
                        <div class="bg-remover-slider-label">
                            <span>Dureza:</span>
                            <span id="lblBrushHardness">50%</span>
                        </div>
                        <input type="range" class="bg-remover-slider" id="slideBrushHardness" min="0" max="100" value="50">
                    </div>
                </div>
                <div class="bg-remover-slider-group hidden" id="groupMagicControls">
                    <span class="bg-remover-section-title">Ajustes de Varita Mágica</span>
                    <div class="bg-remover-slider-group">
                        <div class="bg-remover-slider-label">
                            <span>Tolerancia de Color:</span>
                            <span id="lblMagicTolerance">15</span>
                        </div>
                        <input type="range" class="bg-remover-slider" id="slideMagicTolerance" min="0" max="100" value="15">
                    </div>
                </div>
                <div class="bg-remover-slider-group">
                    <span class="bg-remover-section-title">Filtros Especiales</span>
                    <button class="bg-remover-tool-btn" id="btnRemoverSharpen" style="background-color: #2b2a2b; border-color: #007bff; color: #007bff;">
                        ✨ Mejorar Nitidez (Sharpen)
                    </button>
                </div>
                <div class="bg-remover-info">
                    💡 <b>Tip de Recorte:</b><br>
                    Usa <b>Varita Mágica</b> en fondos planos. Haz <b>Zoom con la Rueda</b> y muévete manteniendo <b>Shift + Arrastrar Mouse</b> para cortes quirúrgicos de precisión.
                </div>
            </div>
        </div>
        <div class="bg-remover-actions">
            <button class="bg-remover-btn bg-remover-btn-cancel" id="btnRemoverCancel">Cancelar</button>
            <button class="bg-remover-btn bg-remover-btn-accept" id="btnRemoverAccept">Aplicar Recorte</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    const screenCanvas = modal.querySelector('#bgRemoverCanvas');
    const screenCtx = screenCanvas.getContext('2d');
    const bgRemoverArea = modal.querySelector('#bgRemoverArea');

    // 4. Enlace y captura de los elementos DOM (Instanciación previa a saveSessionHistory para evitar TDZ errors)
    const btnRemoverUndo = modal.querySelector('#btnRemoverUndo');
    const btnRemoverRedo = modal.querySelector('#btnRemoverRedo');
    const slideSize = modal.querySelector('#slideBrushSize');
    const lblSize = modal.querySelector('#lblBrushSize');
    const slideHardness = modal.querySelector('#slideBrushHardness');
    const lblHardness = modal.querySelector('#lblBrushHardness');
    const slideTolerance = modal.querySelector('#slideMagicTolerance');
    const lblTolerance = modal.querySelector('#lblMagicTolerance');
    const btnToolErase = modal.querySelector('#btnToolErase');
    const btnToolRestore = modal.querySelector('#btnToolRestore');
    const btnToolMagic = modal.querySelector('#btnToolMagic');
    const groupBrushControls = modal.querySelector('#groupBrushControls');
    const groupMagicControls = modal.querySelector('#groupMagicControls');
    const btnRemoverSharpen = modal.querySelector('#btnRemoverSharpen');
    const btnCancel = modal.querySelector('#btnRemoverCancel');
    const btnAccept = modal.querySelector('#btnRemoverAccept');
    const dragHeader = modal.querySelector('.bg-remover-header');

    // 5. Historial interno de cambios interactivos
    function updateHistoryButtons() {
        btnRemoverUndo.disabled = historyIndex <= 0;
        btnRemoverRedo.disabled = historyIndex >= historyStack.length - 1;
    }

    function saveSessionHistory() {
        if (historyIndex < historyStack.length - 1) {
            historyStack.splice(historyIndex + 1);
        }
        const snapshot = editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);
        historyStack.push(snapshot);
        historyIndex++;
        updateHistoryButtons();
    }

    saveSessionHistory(); // Inicializar el primer estado con todos los botones cargados

    // 6. Configuración de Variables de Estado de Edición
    let activeTool = 'erase';
    let brushSize = 20;
    let brushHardness = 0.5;
    let magicTolerance = 15;

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    // Parámetros de Zoom y Paneo
    let zoomScale = 1.0;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let startPanX = 0;
    let startPanY = 0;

    function applyZoomPanTransforms() {
        screenCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    }

    // Renderizar la pantalla de edición principal aplicando paneo/zoom
    function renderEditCanvasToScreen() {
        screenCanvas.width = editCanvas.width;
        screenCanvas.height = editCanvas.height;
        screenCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
        screenCtx.drawImage(editCanvas, 0, 0);
    }
    
    renderEditCanvasToScreen();
    applyZoomPanTransforms();

    // 7. Enlace de Eventos de la Interfaz del Panel Lateral
    slideSize.oninput = () => {
        brushSize = parseInt(slideSize.value);
        lblSize.textContent = brushSize + ' px';
    };

    slideHardness.oninput = () => {
        const val = parseInt(slideHardness.value);
        brushHardness = val / 100;
        lblHardness.textContent = val + '%';
    };

    slideTolerance.oninput = () => {
        magicTolerance = parseInt(slideTolerance.value);
        lblTolerance.textContent = magicTolerance;
    };

    function setActiveTool(tool) {
        activeTool = tool;
        [btnToolErase, btnToolRestore, btnToolMagic].forEach(btn => btn.classList.remove('active'));
        if (tool === 'erase') {
            btnToolErase.classList.add('active');
            groupBrushControls.classList.remove('hidden');
            groupMagicControls.classList.add('hidden');
        } else if (tool === 'restore') {
            btnToolRestore.classList.add('active');
            groupBrushControls.classList.remove('hidden');
            groupMagicControls.classList.add('hidden');
        } else if (tool === 'magic') {
            btnToolMagic.classList.add('active');
            groupBrushControls.classList.add('hidden');
            groupMagicControls.classList.remove('hidden');
        }
    }

    btnToolErase.onclick = () => setActiveTool('erase');
    btnToolRestore.onclick = () => setActiveTool('restore');
    btnToolMagic.onclick = () => setActiveTool('magic');

    // Deshacer / Rehacer interactivos
    btnRemoverUndo.onclick = () => {
        if (historyIndex > 0) {
            historyIndex--;
            editCtx.putImageData(historyStack[historyIndex], 0, 0);
            renderEditCanvasToScreen();
            updateHistoryButtons();
        }
    };

    btnRemoverRedo.onclick = () => {
        if (historyIndex < historyStack.length - 1) {
            historyIndex++;
            editCtx.putImageData(historyStack[historyIndex], 0, 0);
            renderEditCanvasToScreen();
            updateHistoryButtons();
        }
    };

    // Aplicar Filtro de Nitidez (Sharpen 3x3)
    btnRemoverSharpen.onclick = () => {
        const w = editCanvas.width;
        const h = editCanvas.height;
        const imgData = editCtx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const output = editCtx.createImageData(w, h);
        const outData = output.data;

        // Filtro de máscara de enfoque estándar (Sharpen kernel)
        const weights = [
             0, -1,  0,
            -1,  5, -1,
             0, -1,  0
        ];
        
        for (let y = 1; y < h - 1; y++) {
            for (let x = 1; x < w - 1; x++) {
                for (let c = 0; Roland = 0; c < 3; c++) {
                    let sum = 0;
                    for (let ky = -1; ky <= 1; ky++) {
                        for (let kx = -1; kx <= 1; kx++) {
                            const pixelIdx = ((y + ky) * w + (x + kx)) * 4 + c;
                            const weightIdx = (ky + 1) * 3 + (kx + 1);
                            sum += data[pixelIdx] * weights[weightIdx];
                        }
                    }
                    const outputIdx = (y * w + x) * 4 + c;
                    outData[outputIdx] = Math.max(0, Math.min(255, sum));
                }
                const alphaIdx = (y * w + x) * 4 + 3;
                outData[alphaIdx] = data[alphaIdx]; // Mantener la transparencia
            }
        }
        
        editCtx.putImageData(output, 0, 0);
        renderEditCanvasToScreen();
        saveSessionHistory();
    };

    // 8. Eventos de Entrada sobre el Canvas de Dibujo
    function getCanvasCoords(e) {
        const rect = screenCanvas.getBoundingClientRect();
        // Mapeo exacto considerando paneo y zoom
        const scaleX = editCanvas.width / rect.width;
        const scaleY = editCanvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    // Zoom interactivo con la rueda del ratón
    bgRemoverArea.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomIntensity = 0.1;
        const mouseX = e.clientX - bgRemoverArea.getBoundingClientRect().left;
        const mouseY = e.clientY - bgRemoverArea.getBoundingClientRect().top;
        
        const prevZoom = zoomScale;
        if (e.deltaY < 0) {
            zoomScale = Math.min(8.0, zoomScale + zoomIntensity);
        } else {
            zoomScale = Math.max(0.4, zoomScale - zoomIntensity);
        }

        // Paneo compensatorio para hacer zoom hacia el puntero del mouse
        panX = mouseX - (mouseX - panX) * (zoomScale / prevZoom);
        panY = mouseY - (mouseY - panY) * (zoomScale / prevZoom);
        
        applyZoomPanTransforms();
    });

    // Paneo interactivo manteniendo shift o usando botón central/derecho
    screenCanvas.addEventListener('contextmenu', (e) => e.preventDefault());
    
    screenCanvas.addEventListener('mousedown', (e) => {
        const isPanClick = e.shiftKey || e.button === 1 || e.button === 2;
        
        if (isPanClick) {
            isPanning = true;
            startPanX = e.clientX - panX;
            startPanY = e.clientY - panY;
            bgRemoverArea.style.cursor = 'grab';
            e.preventDefault();
            return;
        }

        const coords = getCanvasCoords(e);
        if (activeTool === 'magic') {
            const width = editCanvas.width;
            const height = editCanvas.height;
            const imgDataForEdges = editCtx.getImageData(0, 0, width, height);
            const edgesMap = computeSobelEdges(imgDataForEdges.data, width, height);

            magicWandFloodFillDirect(editCtx, Math.round(coords.x), Math.round(coords.y), magicTolerance, edgesMap);
            renderEditCanvasToScreen();
            saveSessionHistory();
        } else {
            isDrawing = true;
            lastX = coords.x;
            lastY = coords.y;
            drawBrushStroke(coords.x, coords.y, coords.x, coords.y);
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (isPanning) {
            panX = e.clientX - startPanX;
            panY = e.clientY - startPanY;
            applyZoomPanTransforms();
            return;
        }
        if (!isDrawing) return;
        const coords = getCanvasCoords(e);
        drawBrushStroke(lastX, lastY, coords.x, coords.y);
        lastX = coords.x;
        lastY = coords.y;
    });

    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
            bgRemoverArea.style.cursor = 'crosshair';
        }
        if (isDrawing) {
            isDrawing = false;
            saveSessionHistory();
        }
    });

    // Algoritmo de Trazado de Pincel por Interpolación para evitar espacios vacíos
    function drawBrushStroke(x0, y0, x1, y1) {
        const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
        const steps = Math.max(1, Math.floor(dist / (brushSize / 8)));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const cx = x0 + (x1 - x0) * t;
            const cy = y0 + (y1 - y0) * t;
            applySingleBrushSpot(cx, cy);
        }
        renderEditCanvasToScreen();
    }

    // Aplicar pincel redondo con degradado radial de dureza
    function applySingleBrushSpot(cx, cy) {
        const radius = brushSize;
        const brushCanvas = document.createElement('canvas');
        brushCanvas.width = radius * 2;
        brushCanvas.height = radius * 2;
        const brushCtx = brushCanvas.getContext('2d');
        const grad = brushCtx.createRadialGradient(radius, radius, radius * brushHardness, radius, radius, radius);
        grad.addColorStop(0, 'rgba(0,0,0,1)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        brushCtx.fillStyle = grad;
        brushCtx.beginPath();
        brushCtx.arc(radius, radius, radius, 0, Math.PI * 2);
        brushCtx.fill();

        if (activeTool === 'erase') {
            editCtx.save();
            editCtx.globalCompositeOperation = 'destination-out';
            editCtx.drawImage(brushCanvas, cx - radius, cy - radius);
            editCtx.restore();
        } else if (activeTool === 'restore') {
            brushCtx.save();
            brushCtx.globalCompositeOperation = 'source-in';
            brushCtx.drawImage(backupCanvas, cx - radius, cy - radius, radius * 2, radius * 2, 0, 0, radius * 2, radius * 2);
            brushCtx.restore();
            editCtx.save();
            editCtx.globalCompositeOperation = 'source-over';
            editCtx.drawImage(brushCanvas, cx - radius, cy - radius);
            editCtx.restore();
        }
    }

    // 9. Comportamiento Draggable (Arrastrable) de la Modal
    let isDraggingModal = false;
    let startModalX = 0;
    let startModalY = 0;
    let initialModalLeft = 0;
    let initialModalTop = 0;

    dragHeader.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        isDraggingModal = true;
        const rect = modal.getBoundingClientRect();
        startModalX = e.clientX;
        startModalY = e.clientY;
        initialModalLeft = rect.left;
        initialModalTop = rect.top;
        modal.style.position = 'fixed';
        modal.style.margin = '0';
        modal.style.left = initialModalLeft + 'px';
        modal.style.top = initialModalTop + 'px';
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingModal) return;
        const deltaX = e.clientX - startModalX;
        const deltaY = e.clientY - startModalY;
        modal.style.left = (initialModalLeft + deltaX) + 'px';
        modal.style.top = (initialModalTop + deltaY) + 'px';
    });

    document.addEventListener('mouseup', () => {
        isDraggingModal = false;
    });

    // 10. Acciones de Cierre de Modal (Aceptar y Cancelar)
    const closeModal = () => {
        overlay.remove();
    };

    btnCancel.onclick = closeModal;

    btnAccept.onclick = () => {
        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }
        
        // Copiar límites físicos antes de asignar para evitar el achicamiento de Paper.js
        const oldMatrix = actualRaster.matrix.clone();

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = editCanvas.width;
        finalCanvas.height = editCanvas.height;
        const finalCtx = finalCanvas.getContext('2d');
        finalCtx.drawImage(editCanvas, 0, 0);

        // Guardar el nuevo canvas editado en el raster y congelar tamaño/escala físicamente
        actualRaster.canvas = finalCanvas;
        actualRaster.matrix = oldMatrix; // <--- RESTORE THE EXACT SCALE MATRIX
        actualRaster.data = actualRaster.data || {};
        actualRaster.data.originalCanvas = finalCanvas;

        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(window.selectedItem);
        }
        paper.view.update();
        closeModal();
    };
}

/**
 * ASSETS/js/modules/canvas-pro/backgroundRemover.js
 * 
 * Módulo profesional de eliminación de fondo interactivo (PhotoRoom-style) - Versión 8.
 * Ofrece:
 * 1. Pincel borrador (Erase) y restaurador (Restore) con tamaño y dureza (suavizado radial) regulables.
 * 2. Varita mágica (Magic Wand) con algoritmo de inundación (flood-fill) optimizado, tolerancia ajustable y delta local.
 * 3. Conservación de calidad extrema (ejecuta los cambios sobre el lienzo de alta resolución de origen).
 * 4. Historial interno de cambios (Deshacer/Rehacer) durante la sesión de recorte.
 * 5. Interfaz de usuario (modal interactiva draggable) con fondo de tablero de ajedrez para previsualizar transparencia.
 * 6. autoRemoveBackground: Eliminación de fondo automática instantánea con soporte nativo ESM y fallback interactivo.
 * 7. getRasterFromItem: Resolución segura de imágenes enmascaradas (clipGroup) para evitar TypeErrors.
 * 8. GARANTÍA ABSOLUTA ANTI-ACORTAMIENTO (In-Place Canvas Rendering): Redibuja píxeles directamente sobre el lienzo de Paper.js para anular resets de escala.
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
            background-color: rgba(0, 0, 0, 0.65);
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
            width: 920px;
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
            grid-template-columns: 1fr 300px;
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
            image-rendering: pixelated;
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
        .bg-remover-sidebar::-webkit-scrollbar {
            width: 6px;
        }
        .bg-remover-sidebar::-webkit-scrollbar-thumb {
            background-color: #444;
            border-radius: 3px;
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

// Elemento de Overlay de Carga para la descarga de IA de img.ly
function showIaLoadingOverlay() {
    const old = document.getElementById('bgIaLoadingOverlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bgIaLoadingOverlay';
    overlay.style = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(0, 0, 0, 0.8);
        z-index: 10006;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: system-ui, -apple-system, sans-serif;
        color: #fff;
    `;

    overlay.innerHTML = `
        <div style="background-color: #1e1e1e; border: 2px solid #007bff; border-radius: 12px; padding: 30px; width: 400px; text-align: center; box-shadow: 0 10px 30px rgba(0,0,0,0.5);">
            <div style="font-size: 24px; margin-bottom: 15px;">🧠 Inteligencia Artificial</div>
            <div id="bgIaLoadingText" style="font-size: 14px; margin-bottom: 20px; color: #ccc;">Inicializando motor neuronal...</div>
            <div style="width: 100%; background-color: #333; height: 8px; border-radius: 4px; overflow: hidden; margin-bottom: 10px;">
                <div id="bgIaProgressBar" style="width: 0%; background-color: #007bff; height: 100%; transition: width 0.1s;"></div>
            </div>
            <div id="bgIaLoadingSubtext" style="font-size: 11px; color: #888; line-height: 1.4;">Este proceso ocurre 100% local en tu navegador. La primera vez puede tardar unos segundos mientras se descargan los pesos de la red neuronal.</div>
        </div>
    `;
    document.body.appendChild(overlay);
}

function updateIaLoadingProgress(percent, statusText, subtext = null) {
    const bar = document.getElementById('bgIaProgressBar');
    const txt = document.getElementById('bgIaLoadingText');
    const sub = document.getElementById('bgIaLoadingSubtext');
    if (bar) bar.style.width = (percent * 100) + '%';
    if (txt) txt.textContent = statusText;
    if (sub && subtext) sub.textContent = subtext;
}

function hideIaLoadingOverlay() {
    const el = document.getElementById('bgIaLoadingOverlay');
    if (el) el.remove();
}

/**
 * Resuelve de forma recursiva y segura el objeto paper.Raster real desde la selección,
 * contemplando el enmascaramiento dinámico (clipGroup) de EKKO Studio.
 */
export function getRasterFromItem(item) {
    if (!item) return null;
    if (item instanceof paper.Raster) return item;
    if (item.children) {
        // Buscar el hijo Raster
        const rasterChild = item.children.find(c => c instanceof paper.Raster);
        if (rasterChild) return rasterChild;
        
        // Búsqueda recursiva
        for (const child of item.children) {
            const found = getRasterFromItem(child);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Calcula el operador convolucional de Sobel (Gx, Gy) sobre el canvas de origen.
 * Devuelve un mapa de magnitudes de borde para evitar que el recorte de contraste
 * "muerda" el cuerpo de sujetos en escala de grises o bajo contraste.
 */
export function computeSobelEdges(data, width, height) {
    const edges = new Uint8Array(width * height);
    const gray = new Uint8Array(width * height);

    // 1. Convertir a escala de grises de alta precisión
    for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }

    // 2. Convolución de Sobel 3x3
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;

            const val00 = gray[(y - 1) * width + (x - 1)];
            const val01 = gray[(y - 1) * width + x];
            const val02 = gray[(y - 1) * width + (x + 1)];
            const val10 = gray[y * width + (x - 1)];
            const val12 = gray[y * width + (x + 1)];
            const val20 = gray[(y + 1) * width + (x - 1)];
            const val21 = gray[(y + 1) * width + x];
            const val22 = gray[(y + 1) * width + (x + 1)];

            const gx = (val02 + 2 * val12 + val22) - (val00 + 2 * val10 + val20);
            const gy = (val20 + 2 * val21 + val22) - (val00 + 2 * val01 + val02);

            const mag = Math.sqrt(gx * gx + gy * gy);
            edges[idx] = mag > 255 ? 255 : mag;
        }
    }
    return edges;
}

/**
 * Algoritmo base de flood fill optimizado para Canvas 2D con soporte para barreras Sobel.
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

    if (a0 < 5) return; // Transparente

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
    const edgeThreshold = 25; // Sensibilidad de barrera aumentada

    while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head++;

        const idx = (y * width + x) * 4;
        
        // Marcar como transparente (borrado)
        data[idx + 3] = 0;

        const neighbors = [
            { x: x + 1, y: y }, { x: x - 1, y: y },
            { x: x, y: y + 1 }, { x: x, y: y - 1 }
        ];

        for (let i = 0; i < 4; i++) {
            const nx = neighbors[i].x;
            const ny = neighbors[i].y;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = ny * width + nx;
                if (!visited[nIdx]) {
                    visited[nIdx] = 1;

                    // Si hay una barrera fuerte de Sobel, detener la inundación en esta dirección
                    if (edgesMap && edgesMap[nIdx] > edgeThreshold) {
                        continue;
                    }

                    const pxIdx = nIdx * 4;
                    const r = data[pxIdx];
                    const g = data[pxIdx + 1];
                    const b = data[pxIdx + 2];
                    const a = data[pxIdx + 3];

                    if (a >= 5) {
                        const dr = r - r0;
                        const dg = g - g0;
                        const db = b - b0;
                        const diff = dr * dr + dg * dg + db * db;

                        if (diff <= tolSquare) {
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
 * Carga dinámicamente la biblioteca asíncrona de img.ly para remoción por Inteligencia Artificial.
 * Usa importación ESM nativa en cascada con la versión estable real (1.7.0).
 */
export async function loadImglyLibrary() {
    if (window.imglyBackgroundRemoval) {
        return window.imglyBackgroundRemoval;
    }

    showIaLoadingOverlay();
    updateIaLoadingProgress(0.05, "Inicializando motor de Inteligencia Artificial...");

    // Lista de orígenes de módulos ESM nativos (versión estable real 1.7.0)
    const sources = [
        "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs",
        "https://unpkg.com/@imgly/background-removal@1.7.0/dist/index.mjs",
        "/ASSETS/js/vendor/background-removal/index.mjs" // Ruta local alternativa
    ];

    let lastError = null;
    for (const src of sources) {
        try {
            console.log(`Intentando cargar IA desde: ${src}`);
            updateIaLoadingProgress(0.1, `Estableciendo conexión con ${src.includes('jsdelivr') ? 'jsDelivr' : src.includes('unpkg') ? 'unpkg' : 'servidor local'}...`);
            
            const module = await import(src);
            if (module) {
                console.log(`Librería @imgly/background-removal cargada con éxito desde: ${src}`);
                
                // Resolver el export de la función según el tipo de bundle (default o named)
                window.imglyBackgroundRemoval = module.default || module.removeBackground || module;
                
                // Configurar publicPath dinámicamente según la versión cargada
                const baseCdn = src.substring(0, src.lastIndexOf("/dist/") + 6); // ej: https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/
                window.imglyConfig = {
                    publicPath: baseCdn,
                    progress: (key, current, total) => {
                        const progressPct = total ? (current / total) : 0;
                        const pctStr = (progressPct * 100).toFixed(0);
                        const fileName = key.split('/').pop() || key;
                        updateIaLoadingProgress(0.1 + (progressPct * 0.8), `Descargando ${fileName}: ${pctStr}%`);
                    }
                };
                
                return window.imglyBackgroundRemoval;
            }
        } catch (err) {
            console.warn(`Fallo al cargar desde ${src}:`, err);
            lastError = err;
        }
    }

    throw new Error(`No se pudo cargar la librería de eliminación de fondo desde ninguna fuente. Último error: ${lastError?.message || lastError}`);
}

/**
 * Aplica el algoritmo de Feather (suavizado radial de bordes) y Defringe (quitar halos de fondo)
 * de nivel profesional sobre el canvas de salida para garantizar un grabado limpio en LightBurn.
 */
export function applyEdgeRefinements(canvas, featherRadius = 1) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    // 1. Defringe: Eliminar el color del fondo mezclado en los bordes semitransparentes
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            const alpha = data[idx + 3];

            if (alpha > 0 && alpha < 255) {
                // Buscar el pixel completamente opaco más cercano en un radio de 2px
                let nearestR = data[idx], nearestG = data[idx+1], nearestB = data[idx+2];
                let found = false;
                
                for (let r = 1; r <= 2 && !found; r++) {
                    const sampleOffsets = [
                        { dx: r, dy: 0 }, { dx: -r, dy: 0 }, { dx: 0, dy: r }, { dx: 0, dy: -r }
                    ];
                    for (let s = 0; s < 4; s++) {
                        const sx = x + sampleOffsets[s].dx;
                        const sy = y + sampleOffsets[s].dy;
                        if (sx >= 0 && sx < width && sy >= 0 && sy < height) {
                            const sIdx = (sy * width + sx) * 4;
                            if (data[sIdx + 3] === 255) {
                                nearestR = data[sIdx];
                                nearestG = data[sIdx + 1];
                                nearestB = data[sIdx + 2];
                                found = true;
                                break;
                            }
                        }
                    }
                }
                
                // Mezclar color
                data[idx] = nearestR;
                data[idx + 1] = nearestG;
                data[idx + 2] = nearestB;
            }
        }
    }

    // 2. Feathering: Suavizado radial de contorno (promedio de alphas)
    if (featherRadius > 0) {
        const alphaGrid = new Uint8Array(width * height);
        for (let i = 0; i < data.length; i += 4) {
            alphaGrid[i / 4] = data[i + 3];
        }

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                if (data[idx + 3] > 0) {
                    let sum = 0;
                    let count = 0;
                    for (let dy = -featherRadius; dy <= featherRadius; dy++) {
                        for (let dx = -featherRadius; dx <= featherRadius; dx++) {
                            const ny = y + dy;
                            const nx = x + dx;
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                sum += alphaGrid[ny * width + nx];
                                count++;
                            }
                        }
                    }
                    data[idx + 3] = Math.round(sum / count);
                }
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * Realiza una eliminación de fondo automática utilizando Inteligencia Artificial Local (imgly) o
 * Fallback Inteligente (Sobel Contrast Match) con garantía absoluta Antiacortamiento (In-Place Canvas Rendering).
 * @param {paper.Raster} raster Objeto de imagen en Paper.js o clipGroup
 */
export async function autoRemoveBackground(raster) {
    const actualRaster = getRasterFromItem(raster);
    if (!actualRaster) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    // 1. Inicializar el canvas de Paper.js si no existe (Conversión de Imagen HTML a Canvas de alta calidad)
    if (!actualRaster.canvas) {
        const canvas = document.createElement('canvas');
        const img = actualRaster.image;
        canvas.width = img.naturalWidth || img.width || actualRaster.width;
        canvas.height = img.naturalHeight || img.height || actualRaster.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        
        // Conservar las propiedades físicas de Paper.js durante la asignación inicial del canvas
        const oldMatrix = actualRaster.matrix.clone();
        const oldPosition = actualRaster.position.clone();
        
        actualRaster.canvas = canvas;
        
        actualRaster.matrix = oldMatrix;
        actualRaster.position = oldPosition;
    }

    // 2. Inicializar la copia original (originalCanvas) de alta calidad si no existe
    if (!actualRaster.data) actualRaster.data = {};
    if (!actualRaster.data.originalCanvas) {
        const origCanvas = document.createElement('canvas');
        origCanvas.width = actualRaster.canvas.width;
        origCanvas.height = actualRaster.canvas.height;
        const origCtx = origCanvas.getContext('2d', { willReadFrequently: true });
        origCtx.drawImage(actualRaster.canvas, 0, 0);
        actualRaster.data.originalCanvas = origCanvas;
    }

    // 3. RESPALDAR FISICIDAD (Garantía absoluta Antiacortamiento / Anti-Shrink)
    const oldMatrix = actualRaster.matrix.clone();
    const oldPosition = actualRaster.position.clone();

    try {
        // Intentar cargar la Inteligencia Artificial (Fase A)
        const imgly = await loadImglyLibrary();
        
        showIaLoadingOverlay();
        updateIaLoadingProgress(0.9, "IA analizando la escena y separando sujeto del fondo...");

        // Preparar blob para imgly
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = actualRaster.data.originalCanvas.width;
        tempCanvas.height = actualRaster.data.originalCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(actualRaster.data.originalCanvas, 0, 0);
        
        const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
        
        // LLAMAR CORRECTAMENTE AL MÓDULO (Llamada directa de función de módulo o método)
        const removeBgFn = typeof imgly === 'function' ? imgly : (imgly.removeBackground || imgly.default);
        if (typeof removeBgFn !== 'function') {
            throw new Error("No se pudo resolver la función de eliminación de fondo desde el módulo.");
        }
        
        const resultBlob = await removeBgFn(blob, window.imglyConfig);
        
        const resultUrl = URL.createObjectURL(resultBlob);
        const resultImg = new Image();
        
        await new Promise((resolve, reject) => {
            resultImg.onload = resolve;
            resultImg.onerror = reject;
            resultImg.src = resultUrl;
        });

        // Escribir los píxeles editados de forma directa en el lienzo original (In-Place)
        const ctx = actualRaster.canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, actualRaster.canvas.width, actualRaster.canvas.height);
        ctx.drawImage(resultImg, 0, 0);

        // Suavizado Gaussiano y remoción de halos
        applyEdgeRefinements(actualRaster.canvas, 1);

        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        actualRaster.data.backgroundAutoRemoved = true;

        // Forzar Paper.js a redibujar el mismo canvas con los nuevos píxeles
        actualRaster.canvas = actualRaster.canvas;

        // RESTAURAR PROPIEDADES FÍSICAS (Garantía Antiacortamiento)
        actualRaster.matrix = oldMatrix;
        actualRaster.position = oldPosition;

        URL.revokeObjectURL(resultUrl);
        hideIaLoadingOverlay();

    } catch (err) {
        console.warn("La IA local no pudo ejecutarse. Ofreciendo alternativas interactivas:", err);
        hideIaLoadingOverlay();
        
        // INTERFAZ AMIGABLE DE GARANTÍA: Evitar arruinar la imagen con el contraste Sobel silencioso
        const msgManual = "⚠️ El motor de Inteligencia Artificial (IA) no pudo iniciarse.

" +
                          "Esto suele ocurrir si no hay conexión a internet o los CDNs están bloqueados en su navegador.

" +
                          "¿Desea abrir el EDITOR MANUAL interactivo? (Recomendado: tiene Pincel Borrador, Restaurador y Varita Mágica 100% locales y offline, ideales para un grabado láser impecable).";
        
        if (confirm(msgManual)) {
            openBackgroundRemovalModal(raster);
            return;
        }

        const msgContrast = "¿Desea ejecutar el algoritmo automático por contraste de respaldo (Sobel Contrast Match)?

" +
                            "(Atención: Solo se recomienda para imágenes con fondos liso y alto contraste. En fotos complejas como medallas de personas o perros puede morder partes del diseño).";
        
        if (!confirm(msgContrast)) {
            return; // Detener sin alterar la imagen y preservar el diseño intacto
        }

        // FALLBACK AUTÓNOMO (Garantía de Cobertura en Metales y Maderas)
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = actualRaster.data.originalCanvas.width;
        tempCanvas.height = actualRaster.data.originalCanvas.height;
        const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
        tempCtx.drawImage(actualRaster.data.originalCanvas, 0, 0);

        const width = tempCanvas.width;
        const height = tempCanvas.height;

        // Sobel Edge Map
        const imgDataForEdges = tempCtx.getImageData(0, 0, width, height);
        const edgesMap = computeSobelEdges(imgDataForEdges.data, width, height);

        // Muestreo Perimetral Uniforme de Fondo
        const samples = [];
        // Muestrear bordes superior e inferior
        for (let x = 0; x < width; x += Math.max(1, Math.floor(width / 20))) {
            samples.push({ x: x, y: 5 });
            samples.push({ x: x, y: height - 6 });
        }
        // Muestrear bordes izquierdo y derecho
        for (let y = 0; y < height; y += Math.max(1, Math.floor(height / 20))) {
            samples.push({ x: 5, y: y });
            samples.push({ x: width - 6, y: y });
        }

        samples.forEach(p => {
            if (p.x >= 0 && p.x < width && p.y >= 0 && p.y < height) {
                magicWandFloodFillDirect(tempCtx, p.x, p.y, 8, edgesMap);
            }
        });

        // Escribir los píxeles editados de forma directa en el lienzo original (In-Place)
        const ctx = actualRaster.canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, actualRaster.canvas.width, actualRaster.canvas.height);
        ctx.drawImage(tempCanvas, 0, 0);

        // Suavizado Gaussiano y remoción de halos
        applyEdgeRefinements(actualRaster.canvas, 1);

        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        actualRaster.data.backgroundAutoRemoved = true;

        // Forzar Paper.js a redibujar el mismo canvas con los nuevos píxeles
        actualRaster.canvas = actualRaster.canvas;

        // RESTAURAR PROPIEDADES FÍSICAS EN FALLBACK (Garantía Antiacortamiento)
        actualRaster.matrix = oldMatrix;
        actualRaster.position = oldPosition;
    }

    // Forzar actualización de la caja de selección azul celeste de Paper.js
    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(window.selectedItem);
    }
    
    paper.view.update();
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

    // 1. Inicializar el canvas de Paper.js si no existe (por si abren la modal directamente)
    if (!actualRaster.canvas) {
        const canvas = document.createElement('canvas');
        const img = actualRaster.image;
        canvas.width = img.naturalWidth || img.width || actualRaster.width;
        canvas.height = img.naturalHeight || img.height || actualRaster.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        
        const oldMatrix = actualRaster.matrix.clone();
        const oldPosition = actualRaster.position.clone();
        actualRaster.canvas = canvas;
        actualRaster.matrix = oldMatrix;
        actualRaster.position = oldPosition;
    }

    // 2. RESPALDAR FISICIDAD (Garantía absoluta Antiacortamiento / Anti-Shrink)
    const oldMatrix = actualRaster.matrix.clone();
    const oldPosition = actualRaster.position.clone();

    // 3. Obtener la fuente de píxeles original (alta resolución)
    if (!actualRaster.data) actualRaster.data = {};
    let srcImage = actualRaster.data.originalCanvas || actualRaster.canvas || actualRaster.image;
    if (!srcImage) return;

    // Crear un canvas de edición con las dimensiones originales de la imagen (alta calidad)
    const editCanvas = document.createElement('canvas');
    editCanvas.width = srcImage.width || actualRaster.width;
    editCanvas.height = srcImage.height || actualRaster.height;
    const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
    const baseImage = actualRaster.canvas || srcImage;
    editCtx.drawImage(baseImage, 0, 0);

    // Crear canvas de respaldo para la herramienta de restauración
    const backupCanvas = document.createElement('canvas');
    backupCanvas.width = editCanvas.width;
    backupCanvas.height = editCanvas.height;
    const backupCtx = backupCanvas.getContext('2d', { willReadFrequently: true });
    const rawOriginal = actualRaster.data.originalCanvas || srcImage;
    backupCtx.drawImage(rawOriginal, 0, 0);

    // 4. Historial de sesión de recorte (Deshacer / Rehacer local)
    const historyStack = [];
    let historyIndex = -1;

    function saveSessionHistory() {
        if (historyIndex < historyStack.length - 1) {
            historyStack.splice(historyIndex + 1);
        }
        const snapshot = editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);
        historyStack.push(snapshot);
        historyIndex++;
        updateHistoryButtons();
    }

    // 5. Crear Estructura de la Modal Interactiva
    const overlay = document.createElement('div');
    overlay.className = 'bg-remover-overlay';

    const modal = document.createElement('div');
    modal.className = 'bg-remover-modal';

    const mmW = actualRaster.bounds.width.toFixed(1);
    const mmH = actualRaster.bounds.height.toFixed(1);

    modal.innerHTML = `
        <div class="bg-remover-header">
            <h3>✂️ Quitar Fondo y Recortar Imagen</h3>
            <span style="font-size: 12px; color: #888;">Medidas físicas: <b>\${mmW} mm x \${mmH} mm</b></span>
        </div>
        <div class="bg-remover-container">
            <div class="bg-remover-canvas-area">
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
                        🪄 Varita Mágica (Auto)
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
                    <span class="bg-remover-section-title">Filtros de Grabado</span>
                    <button class="bg-remover-tool-btn" id="btnSharpenFilter" style="background-color: #242424; border-color: #333;">
                        ✨ Mejorar Nitidez (Sharpen)
                    </button>
                </div>
                <div class="bg-remover-info">
                    💡 <b>Tip de Recorte:</b><br>
                    Usa la <b>Varita Mágica</b> para remover fondos sólidos con un solo clic. Ajusta la <b>Dureza</b> del pincel a valores bajos para lograr bordes suaves y nítidos.
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
    const screenCtx = screenCanvas.getContext('2d', { willReadFrequently: true });

    // Botones del DOM buscados al inicio para evitar errores de TDZ
    const btnRemoverUndo = modal.querySelector('#btnRemoverUndo');
    const btnRemoverRedo = modal.querySelector('#btnRemoverRedo');

    function updateHistoryButtons() {
        if (btnRemoverUndo) btnRemoverUndo.disabled = historyIndex <= 0;
        if (btnRemoverRedo) btnRemoverRedo.disabled = historyIndex >= historyStack.length - 1;
    }

    // Inicializar el primer estado del historial con los botones ya listos
    saveSessionHistory();

    // Zoom and Pan State Variables
    let zoomLevel = 1.0;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let startPanX = 0;
    let startPanY = 0;

    function renderEditCanvasToScreen() {
        screenCanvas.width = editCanvas.width;
        screenCanvas.height = editCanvas.height;
        screenCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
        
        screenCtx.save();
        screenCtx.translate(panX, panY);
        screenCtx.scale(zoomLevel, zoomLevel);
        screenCtx.drawImage(editCanvas, 0, 0);
        screenCtx.restore();
    }
    renderEditCanvasToScreen();

    let activeTool = 'erase';
    let brushSize = 20;
    let brushHardness = 0.5;
    let magicTolerance = 15;
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    const btnToolErase = modal.querySelector('#btnToolErase');
    const btnToolRestore = modal.querySelector('#btnToolRestore');
    const btnToolMagic = modal.querySelector('#btnToolMagic');
    const groupBrushControls = modal.querySelector('#groupBrushControls');
    const groupMagicControls = modal.querySelector('#groupMagicControls');

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

    // Botón para aplicar Nitidez (Sharpen Filter)
    const btnSharpen = modal.querySelector('#btnSharpenFilter');
    btnSharpen.onclick = () => {
        const w = editCanvas.width;
        const h = editCanvas.height;
        const imgData = editCtx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const weights = [
             0, -1,  0,
            -1,  5, -1,
             0, -1,  0
        ];
        const side = 3;
        const halfSide = 1;
        const output = editCtx.createImageData(w, h);
        const dst = output.data;

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const sy = y;
                const sx = x;
                const dstOff = (y * w + x) * 4;
                
                let r = 0, g = 0, b = 0, a = 0;
                for (let cy = 0; cy < side; cy++) {
                    for (let cx = 0; cx < side; cx++) {
                        const scy = Math.min(h - 1, Math.max(0, sy + cy - halfSide));
                        const scx = Math.min(w - 1, Math.max(0, sx + cx - halfSide));
                        const srcOff = (scy * w + scx) * 4;
                        const wt = weights[cy * side + cx];
                        r += data[srcOff] * wt;
                        g += data[srcOff + 1] * wt;
                        b += data[srcOff + 2] * wt;
                    }
                }
                
                dst[dstOff] = Math.max(0, Math.min(255, r));
                dst[dstOff + 1] = Math.max(0, Math.min(255, g));
                dst[dstOff + 2] = Math.max(0, Math.min(255, b));
                dst[dstOff + 3] = data[dstOff + 3]; // Conservar canal alfa intacto
            }
        }
        editCtx.putImageData(output, 0, 0);
        renderEditCanvasToScreen();
        saveSessionHistory();
    };

    btnRemoverUndo.onclick = () => {
        if (historyIndex > 0) {
            historyIndex--;
            editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
            editCtx.putImageData(historyStack[historyIndex], 0, 0);
            renderEditCanvasToScreen();
            updateHistoryButtons();
        }
    };

    btnRemoverRedo.onclick = () => {
        if (historyIndex < historyStack.length - 1) {
            historyIndex++;
            editCtx.clearRect(0, 0, editCanvas.width, editCanvas.height);
            editCtx.putImageData(historyStack[historyIndex], 0, 0);
            renderEditCanvasToScreen();
            updateHistoryButtons();
        }
    };

    function getCanvasCoords(e) {
        const rect = screenCanvas.getBoundingClientRect();
        // Coordenadas relativas de pantalla
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Mapeo inverso según traslación y escala
        const targetX = Math.round((clickX - panX) / zoomLevel);
        const targetY = Math.round((clickY - panY) / zoomLevel);

        return { x: targetX, y: targetY };
    }

    function drawBrushStroke(x, y, isFirst) {
        editCtx.save();
        editCtx.lineCap = 'round';
        editCtx.lineJoin = 'round';
        
        if (activeTool === 'erase') {
            editCtx.globalCompositeOperation = 'destination-out';
            
            if (brushHardness < 0.95) {
                // Pincel suave mediante gradiente radial para evitar bordes duros
                const grad = editCtx.createRadialGradient(x, y, brushSize * brushHardness, x, y, brushSize);
                grad.addColorStop(0, 'rgba(0,0,0,1)');
                grad.addColorStop(1, 'rgba(0,0,0,0)');
                editCtx.fillStyle = grad;
                
                editCtx.beginPath();
                editCtx.arc(x, y, brushSize, 0, Math.PI * 2);
                editCtx.fill();
            } else {
                // Pincel duro y directo
                editCtx.lineWidth = brushSize * 2;
                editCtx.strokeStyle = 'rgba(0,0,0,1)';
                editCtx.beginPath();
                if (isFirst) {
                    editCtx.moveTo(x, y);
                } else {
                    editCtx.moveTo(lastX, lastY);
                }
                editCtx.lineTo(x, y);
                editCtx.stroke();
            }
        } else if (activeTool === 'restore') {
            // Restaurar píxeles originales in-place utilizando el canvas original como patrón
            editCtx.globalCompositeOperation = 'source-over';
            const pattern = editCtx.createPattern(backupCanvas, 'no-repeat');
            editCtx.strokeStyle = pattern;
            editCtx.lineWidth = brushSize * 2;
            
            editCtx.beginPath();
            if (isFirst) {
                editCtx.moveTo(x, y);
            } else {
                editCtx.moveTo(lastX, lastY);
            }
            editCtx.lineTo(x, y);
            editCtx.stroke();
        }
        editCtx.restore();
        renderEditCanvasToScreen();
    }

    function applyMagicWand(startX, startY) {
        const w = editCanvas.width;
        const h = editCanvas.height;
        if (startX < 0 || startX >= w || startY < 0 || startY >= h) return;

        // Calcular mapa de bordes Sobel de alta fidelidad para prevenir morder el sujeto principal
        const imgData = editCtx.getImageData(0, 0, w, h);
        const edgesMap = computeSobelEdges(imgData.data, w, h);

        magicWandFloodFillDirect(editCtx, startX, startY, magicTolerance, edgesMap);
        renderEditCanvasToScreen();
        saveSessionHistory();
    }

    screenCanvas.addEventListener('mousedown', (e) => {
        // Paneo: Botón derecho, central o Shift + clic izquierdo
        if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) {
            isPanning = true;
            startPanX = e.clientX - panX;
            startPanY = e.clientY - panY;
            e.preventDefault();
            return;
        }

        if (e.button === 0) {
            if (activeTool === 'magic') {
                const coords = getCanvasCoords(e);
                applyMagicWand(coords.x, coords.y);
            } else {
                isDrawing = true;
                const coords = getCanvasCoords(e);
                lastX = coords.x;
                lastY = coords.y;
                drawBrushStroke(coords.x, coords.y, true);
            }
        }
    });

    screenCanvas.addEventListener('mousemove', (e) => {
        if (isPanning) {
            panX = e.clientX - startPanX;
            panY = e.clientY - startPanY;
            renderEditCanvasToScreen();
            return;
        }

        if (isDrawing) {
            const coords = getCanvasCoords(e);
            drawBrushStroke(coords.x, coords.y, false);
            lastX = coords.x;
            lastY = coords.y;
        }
    });

    window.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            saveSessionHistory();
        }
        isPanning = false;
    });

    // Desactivar menú contextual en pantalla para un paneo derecho fluido
    screenCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Control de zoom interactivo
    screenCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoomLevel = Math.max(0.5, Math.min(10.0, zoomLevel * zoomFactor));
        renderEditCanvasToScreen();
    });

    // Doble clic para restablecer vista
    screenCanvas.addEventListener('dblclick', () => {
        zoomLevel = 1.0;
        panX = 0;
        panY = 0;
        renderEditCanvasToScreen();
    });

    // Enlazar controles deslizantes (Sliders) de ajustes
    const slideSize = modal.querySelector('#slideBrushSize');
    const lblSize = modal.querySelector('#lblBrushSize');
    if (slideSize && lblSize) {
        slideSize.oninput = () => {
            brushSize = parseInt(slideSize.value);
            lblSize.textContent = brushSize + ' px';
        };
    }

    const slideHardness = modal.querySelector('#slideBrushHardness');
    const lblHardness = modal.querySelector('#lblBrushHardness');
    if (slideHardness && lblHardness) {
        slideHardness.oninput = () => {
            brushHardness = parseFloat(slideHardness.value) / 100;
            lblHardness.textContent = slideHardness.value + '%';
        };
    }

    const slideTolerance = modal.querySelector('#slideMagicTolerance');
    const lblTolerance = modal.querySelector('#lblMagicTolerance');
    if (slideTolerance && lblTolerance) {
        slideTolerance.oninput = () => {
            magicTolerance = parseInt(slideTolerance.value);
            lblTolerance.textContent = magicTolerance;
        };
    }

    // Modal Draggable
    const dragHeader = modal.querySelector('.bg-remover-header');
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

    const btnCancel = modal.querySelector('#btnRemoverCancel');
    const btnAccept = modal.querySelector('#btnRemoverAccept');

    const closeModal = () => {
        overlay.remove();
    };

    btnCancel.onclick = closeModal;

    btnAccept.onclick = () => {
        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Transferir píxeles finales directamente al canvas de Paper.js
        const ctx = actualRaster.canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, actualRaster.canvas.width, actualRaster.canvas.height);
        ctx.drawImage(editCanvas, 0, 0);

        // Suavizado Gaussiano y remoción de halos
        applyEdgeRefinements(actualRaster.canvas, 1);

        actualRaster.data.backgroundAutoRemoved = true;

        // Forzar Paper.js a redibujar el canvas
        actualRaster.canvas = actualRaster.canvas;

        // RESTAURAR PROPIEDADES FÍSICAS (Garantía absoluta Antiacortamiento / Anti-Shrink)
        actualRaster.matrix = oldMatrix;
        actualRaster.position = oldPosition;

        // Forzar actualización de la caja de selección azul celeste de Paper.js
        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(window.selectedItem);
        }

        paper.view.update();
        closeModal();
    };
}

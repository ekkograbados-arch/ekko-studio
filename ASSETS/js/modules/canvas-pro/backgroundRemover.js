/**
 * ASSETS/js/modules/canvas-pro/backgroundRemover.js
 * 
 * Módulo profesional de eliminación de fondo interactivo (Híbrido A + B).
 * Ofrece:
 * 1. Fase A (Automática): Remoción por Inteligencia Artificial Local (imgly) con descarga asíncrona.
 * 2. Fallback de Red / Offline (Garantía de Cobertura): Algoritmo de contraste Sobel Edge Barrier +
 *    Perimeter Color Keying + Defringe de nivel profesional. ¡Sin depender de internet!
 * 3. Fase B (Lienzo de Retoque Manual Canva-Style): Pincel borrador y restaurador con dureza radial, 
 *    zoom interactivo con la rueda del ratón y paneo (Shift + arrastrar o botón derecho).
 * 4. Garantía absoluta Antiacortamiento (Anti-Shrink Guarantee): Bloqueo y restauración de la matriz 
 *    matemática y coordenadas físicas de Paper.js en todos los flujos de confirmación.
 */

// Estilos CSS dinámicos de la modal e indicador de carga de la IA
const removeBgStylesId = 'background-remover-pro-styles';
if (typeof document !== 'undefined' && !document.getElementById(removeBgStylesId)) {
    const styleEl = document.createElement('style');
    styleEl.id = removeBgStylesId;
    styleEl.textContent = `
        .bg-remover-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.7);
            z-index: 10005;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
        }
        .bg-remover-modal {
            background-color: #121212;
            color: #f3f3f3;
            border: 2px solid #007bff;
            border-radius: 14px;
            padding: 24px;
            width: 1050px;
            max-width: 95%;
            height: 720px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9);
            display: flex;
            flex-direction: column;
            user-select: none;
        }
        .bg-remover-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid rgba(0, 123, 255, 0.25);
            padding-bottom: 12px;
            margin-bottom: 18px;
            cursor: move;
        }
        .bg-remover-header h3 {
            margin: 0;
            color: #007bff;
            font-size: 20px;
            font-weight: bold;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .bg-remover-container {
            display: grid;
            grid-template-columns: 1fr 300px;
            gap: 20px;
            flex-grow: 1;
            min-height: 0;
        }
        .bg-remover-canvas-area {
            background: repeating-conic-gradient(#202020 0% 25%, #2a2a2a 0% 50%) 50% / 20px 20px;
            border: 1px solid #333;
            border-radius: 10px;
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
            box-shadow: 0 4px 30px rgba(0,0,0,0.7);
            transform-origin: center;
        }
        .bg-remover-sidebar {
            background-color: #1a1a1a;
            border-radius: 10px;
            padding: 18px;
            display: flex;
            flex-direction: column;
            gap: 18px;
            overflow-y: auto;
            border: 1px solid rgba(255,255,255,0.03);
        }
        .bg-remover-section-title {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            color: #777;
            margin-bottom: 4px;
            font-weight: bold;
        }
        .bg-remover-tool-btn {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 11px 14px;
            background-color: #242424;
            border: 1px solid #333;
            border-radius: 8px;
            color: #fff;
            cursor: pointer;
            font-size: 13.5px;
            font-weight: bold;
            text-align: left;
            transition: all 0.2s;
            width: 100%;
        }
        .bg-remover-tool-btn:hover {
            background-color: #2e2e2e;
            border-color: #444;
        }
        .bg-remover-tool-btn.active {
            background-color: #007bff;
            border-color: #007bff;
            box-shadow: 0 0 12px rgba(0, 123, 255, 0.4);
        }
        .bg-remover-slider-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .bg-remover-slider-label {
            display: flex;
            justify-content: space-between;
            font-size: 12px;
            color: #bbb;
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
            background-color: #1e1d1e;
            padding: 10px 12px;
            border-radius: 6px;
            border-left: 3px solid #007bff;
            line-height: 1.5;
        }
        .bg-remover-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 18px;
            border-top: 1px solid #222;
            padding-top: 18px;
        }
        .bg-remover-btn {
            padding: 10px 22px;
            border-radius: 8px;
            font-weight: bold;
            font-size: 14px;
            cursor: pointer;
            transition: all 0.2s;
            border: none;
            outline: none;
        }
        .bg-remover-btn-cancel {
            background-color: #2a2a2a;
            color: #e0e0e0;
            border: 1px solid rgba(255, 255, 255, 0.05);
        }
        .bg-remover-btn-cancel:hover {
            background-color: #353535;
        }
        .bg-remover-btn-accept {
            background-color: #007bff;
            color: #ffffff;
            box-shadow: 0 3px 12px rgba(0, 123, 255, 0.35);
        }
        .bg-remover-btn-accept:hover {
            background-color: #0056b3;
            transform: translateY(-1px);
        }
        .bg-remover-history-row {
            display: flex;
            gap: 10px;
        }
        .bg-remover-history-btn {
            flex: 1;
            padding: 8px;
            background-color: #242424;
            border: 1px solid #333;
            color: #fff;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            text-align: center;
            transition: background 0.2s;
        }
        .bg-remover-history-btn:hover:not(:disabled) {
            background-color: #2e2e2e;
        }
        .bg-remover-history-btn:disabled {
            opacity: 0.25;
            cursor: not-allowed;
        }
        
        /* Overlay de progreso de carga de IA */
        .bg-ia-loading-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(10, 10, 10, 0.85);
            z-index: 10010;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            font-family: system-ui, -apple-system, sans-serif;
            color: #fff;
        }
        .bg-ia-loading-card {
            background-color: #161616;
            border: 1.5px solid #007bff;
            border-radius: 16px;
            padding: 30px;
            width: 450px;
            text-align: center;
            box-shadow: 0 15px 50px rgba(0, 123, 255, 0.2);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 20px;
        }
        .bg-ia-spinner {
            width: 50px;
            height: 50px;
            border: 4px solid rgba(0, 123, 255, 0.1);
            border-top: 4px solid #007bff;
            border-radius: 50%;
            animation: bg-spin 1s linear infinite;
        }
        @keyframes bg-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .bg-ia-progress-bar-wrap {
            width: 100%;
            height: 6px;
            background-color: #222;
            border-radius: 3px;
            overflow: hidden;
            margin-top: 10px;
        }
        .bg-ia-progress-bar {
            width: 0%;
            height: 100%;
            background-color: #007bff;
            border-radius: 3px;
            transition: width 0.3s ease;
        }
        .bg-ia-loading-text {
            font-size: 14px;
            font-weight: bold;
            color: #fff;
        }
        .bg-ia-loading-subtext {
            font-size: 11px;
            color: #888;
            line-height: 1.4;
        }
    `;
    document.head.appendChild(styleEl);
}

// Inyección del Overlay de progreso de la IA en el DOM
function showIaLoadingOverlay() {
    if (document.getElementById('bgIaLoadingOverlay')) return;
    const loader = document.createElement('div');
    loader.id = 'bgIaLoadingOverlay';
    loader.className = 'bg-ia-loading-overlay';
    loader.innerHTML = `
        <div class="bg-ia-loading-card">
            <div class="bg-ia-spinner"></div>
            <div class="bg-ia-loading-text" id="bgIaLoadingText">Iniciando motor de Inteligencia Artificial...</div>
            <div class="bg-ia-progress-bar-wrap">
                <div class="bg-ia-progress-bar" id="bgIaProgressBar"></div>
            </div>
            <div class="bg-ia-loading-subtext" id="bgIaLoadingSubtext">
                Descargando modelo de segmentación semántica neuronal local (aprox. 10MB). 
                Esto ocurre una sola vez y se procesa gratis y privado en tu GPU.
            </div>
        </div>
    `;
    document.body.appendChild(loader);
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
        
        // Salvaguarda secundaria para grupos recortados
        const fallbackChild = item.children.find(c => !c.clipMask && c.className !== 'Path' && !c.data?.mockup);
        if (fallbackChild instanceof paper.Raster) return fallbackChild;
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
    const edgeThreshold = 25; // Sensibilidad de barrera aumentada para Don Ramón

    while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head++;

        const idx = (y * width + x) * 4;
        data[idx + 3] = 0; // Hacer transparente

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
                    
                    // Si choca con un borde Sobel fuerte, detener inundación en esa dirección
                    if (edgesMap && edgesMap[nIdx] > edgeThreshold) {
                        continue;
                    }

                    const pIdx = nIdx * 4;
                    const r = data[pIdx];
                    const g = data[pIdx + 1];
                    const b = data[pIdx + 2];
                    const a = data[pIdx + 3];

                    if (a > 10) {
                        // Delta de color global
                        const dr = r - r0;
                        const dg = g - g0;
                        const db = b - b0;
                        const distSq = dr * dr + dg * dg + db * db;
                        
                        // Delta de color local para evitar fugas en degradados de grises
                        const parentIdx = (y * width + x) * 4;
                        const dLocal = (r - data[parentIdx])**2 + (g - data[parentIdx+1])**2 + (b - data[parentIdx+2])**2;

                        if (distSq <= tolSquare && dLocal < 400) {
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
 * Realiza un reintento silencioso en caso de caída del CDN, protegiendo contra SyntaxErrors y alertas.
 */
function loadImglyLibrary() {
    return new Promise((resolve, reject) => {
        if (window.imglyBackgroundRemoval) {
            resolve(window.imglyBackgroundRemoval);
            return;
        }

        showIaLoadingOverlay();
        updateIaLoadingProgress(0.15, "Conectando con la red neuronal local...");

        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@2.x/dist/bundle.js";
        script.async = true;

        const tryFallback = () => {
            console.warn("CDN Primario fallido. Cargando IA desde unpkg de respaldo...");
            const fallbackScript = document.createElement('script');
            fallbackScript.src = "https://unpkg.com/@imgly/background-removal@2.x/dist/bundle.js";
            fallbackScript.async = true;
            
            fallbackScript.onload = () => {
                if (window.imglyBackgroundRemoval) {
                    window.imglyConfig = {
                        progress: (status, progress) => {
                            const pct = progress ? (progress * 100).toFixed(0) : '0';
                            updateIaLoadingProgress(progress, `Cargando modelo neuronal: ${pct}%`, status);
                        }
                    };
                    resolve(window.imglyBackgroundRemoval);
                } else {
                    reject(new Error("La variable de imgly no se registró correctamente."));
                }
            };

            fallbackScript.onerror = () => {
                reject(new Error("Error de carga en ambos CDNs"));
            };

            document.head.appendChild(fallbackScript);
        };

        script.onload = () => {
            if (window.imglyBackgroundRemoval) {
                window.imglyConfig = {
                    progress: (status, progress) => {
                        const pct = progress ? (progress * 100).toFixed(0) : '0';
                        updateIaLoadingProgress(progress, `Procesando imagen con IA: ${pct}%`, status);
                    }
                };
                resolve(window.imglyBackgroundRemoval);
            } else {
                tryFallback();
            }
        };

        script.onerror = tryFallback;
        document.head.appendChild(script);
    });
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
                data[idx] = nearestR;
                data[idx+1] = nearestG;
                data[idx+2] = nearestB;
            }
        }
    }

    // 2. Feathering: Suavizado radial Gaussiano de contorno (promedio de alphas)
    if (featherRadius > 0) {
        const alphaGrid = new Uint8Array(width * height);
        for (let i = 0; i < data.length; i += 4) {
            alphaGrid[i / 4] = data[i + 3];
        }

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                const idx = (y * width + x) * 4;
                if (alphaGrid[y * width + x] > 0) {
                    let sum = 0;
                    let count = 0;
                    for (let dy = -featherRadius; dy <= featherRadius; dy++) {
                        for (let dx = -featherRadius; dx <= featherRadius; dx++) {
                            const val = alphaGrid[(y + dy) * width + (x + dx)];
                            sum += val;
                            count++;
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
 * Fallback Inteligente (Sobel Contrast Match) con garantía absoluta Antiacortamiento (Anti-Shrink).
 * @param {paper.Raster} raster Objeto de imagen en Paper.js o clipGroup
 */
export async function autoRemoveBackground(raster) {
    const actualRaster = getRasterFromItem(raster);
    if (!actualRaster) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    // 1. RESPALDAR FISICIDAD (Garantía absoluta Antiacortamiento / Anti-Shrink)
    const oldMatrix = actualRaster.matrix.clone();
    const oldPosition = actualRaster.position.clone();

    // 2. Respaldar lienzo de alta calidad original si no existe
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
        const resultBlob = await imgly.removeBackground(blob, window.imglyConfig);
        
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

        // Suavizado Gaussiano y remoción de halos
        applyEdgeRefinements(editCanvas, 1);

        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Asignar los nuevos píxeles al Raster
        actualRaster.canvas = editCanvas;
        actualRaster.data.backgroundAutoRemoved = true;

        // RESTAURAR PROPIEDADES FÍSICAS (Garantía Antiacortamiento)
        actualRaster.matrix = oldMatrix;
        actualRaster.position = oldPosition;

        URL.revokeObjectURL(resultUrl);
        hideIaLoadingOverlay();

    } catch (err) {
        console.warn("La IA local no pudo ejecutarse. Usando algoritmo de contraste de respaldo (Sobel Contrast Match).", err);
        hideIaLoadingOverlay();
        
        // FALLBACK AUTÓNOMO (Garantía de Cobertura en Metales y Maderas)
        const editCanvas = document.createElement('canvas');
        editCanvas.width = actualRaster.data.originalCanvas.width;
        editCanvas.height = actualRaster.data.originalCanvas.height;
        const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
        editCtx.drawImage(actualRaster.data.originalCanvas, 0, 0);

        const width = editCanvas.width;
        const height = editCanvas.height;

        // Sobel Edge Map
        const imgDataForEdges = editCtx.getImageData(0, 0, width, height);
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
                magicWandFloodFillDirect(editCtx, p.x, p.y, 8, edgesMap);
            }
        });

        // Suavizado Gaussiano y remoción de halos
        applyEdgeRefinements(editCanvas, 1);

        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        actualRaster.canvas = editCanvas;
        actualRaster.data.backgroundAutoRemoved = true;

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

    // 1. RESPALDAR FISICIDAD (Garantía absoluta Antiacortamiento / Anti-Shrink)
    const oldMatrix = actualRaster.matrix.clone();
    const oldPosition = actualRaster.position.clone();

    // 2. Obtener la fuente de píxeles original (alta resolución)
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

    // 3. Historial de sesión de recorte (Deshacer / Rehacer local)
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

    // 4. Crear Estructura de la Modal Interactiva
    const overlay = document.createElement('div');
    overlay.className = 'bg-remover-overlay';

    const modal = document.createElement('div');
    modal.className = 'bg-remover-modal';

    const mmW = actualRaster.bounds.width.toFixed(1);
    const mmH = actualRaster.bounds.height.toFixed(1);

    modal.innerHTML = `
        <div class="bg-remover-header">
            <h3>✂️ Quitar Fondo y Recortar Imagen</h3>
            <span style="font-size: 12px; color: #888;">Medidas físicas: <b>${mmW} mm x ${mmH} mm</b></span>
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
        // Aplicar transformación matemática de zoom y paneo interactivo
        screenCtx.translate(screenCanvas.width / 2 + panX, screenCanvas.height / 2 + panY);
        screenCtx.scale(zoomLevel, zoomLevel);
        screenCtx.translate(-screenCanvas.width / 2, -screenCanvas.height / 2);
        
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

    const slideSize = modal.querySelector('#slideBrushSize');
    const lblSize = modal.querySelector('#lblBrushSize');
    slideSize.oninput = () => {
        brushSize = parseInt(slideSize.value);
        lblSize.textContent = brushSize + ' px';
    };

    const slideHardness = modal.querySelector('#slideBrushHardness');
    const lblHardness = modal.querySelector('#lblBrushHardness');
    slideHardness.oninput = () => {
        const val = parseInt(slideHardness.value);
        brushHardness = val / 100;
        lblHardness.textContent = val + '%';
    };

    const slideTolerance = modal.querySelector('#slideMagicTolerance');
    const lblTolerance = modal.querySelector('#lblMagicTolerance');
    slideTolerance.oninput = () => {
        magicTolerance = parseInt(slideTolerance.value);
        lblTolerance.textContent = magicTolerance;
    };

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
        const side = Math.round(Math.sqrt(weights.length));
        const halfSide = Math.floor(side / 2);
        const output = editCtx.createImageData(w, h);
        const dst = output.data;

        // Convolución Gaussiana de Nitidez lineal
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const sy = y;
                const sx = x;
                const dstOff = (y * w + x) * 4;
                
                let r = 0, g = 0, b = 0, a = data[dstOff + 3];
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
                dst[dstOff] = Math.min(255, Math.max(0, r));
                dst[dstOff + 1] = Math.min(255, Math.max(0, g));
                dst[dstOff + 2] = Math.min(255, Math.max(0, b));
                dst[dstOff + 3] = a; // Preservar canal alfa
            }
        }
        editCtx.putImageData(output, 0, 0);
        renderEditCanvasToScreen();
        saveSessionHistory();
    };

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

    function getCanvasCoords(e) {
        const rect = screenCanvas.getBoundingClientRect();
        // Coordenadas relativas de pantalla
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Mapeo matemático inverso considerando Zoom y Paneo
        const normX = (clickX - screenCanvas.width / 2 - panX) / zoomLevel + screenCanvas.width / 2;
        const normY = (clickY - screenCanvas.height / 2 - panY) / zoomLevel + screenCanvas.height / 2;

        const scaleX = editCanvas.width / rect.width;
        const scaleY = editCanvas.height / rect.height;
        return {
            x: normX * scaleX,
            y: normY * scaleY
        };
    }

    screenCanvas.addEventListener('mousedown', (e) => {
        // Paneo: Botón derecho o Shift + clic izquierdo
        if (e.button === 2 || e.button === 1 || (e.button === 0 && e.shiftKey)) {
            isPanning = true;
            startPanX = e.clientX - panX;
            startPanY = e.clientY - panY;
            e.preventDefault();
            return;
        }

        if (e.button !== 0) return;

        const coords = getCanvasCoords(e);
        if (activeTool === 'magic') {
            // Varita mágica directa
            magicWandFloodFillDirect(editCtx, Math.round(coords.x), Math.round(coords.y), magicTolerance);
            renderEditCanvasToScreen();
            saveSessionHistory();
        } else {
            isDrawing = true;
            lastX = coords.x;
            lastY = coords.y;
            drawBrushStroke(coords.x, coords.y, coords.x, coords.y);
        }
    });

    screenCanvas.addEventListener('mousemove', (e) => {
        if (isPanning) {
            panX = e.clientX - startPanX;
            panY = e.clientY - startPanY;
            renderEditCanvasToScreen();
            return;
        }

        if (!isDrawing) return;
        const coords = getCanvasCoords(e);
        drawBrushStroke(lastX, lastY, coords.x, coords.y);
        lastX = coords.x;
        lastY = coords.y;
    });

    window.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            saveSessionHistory();
        }
        isPanning = false;
    });

    // Desactivar menú contextual para poder usar botón derecho de arrastre cómodamente
    screenCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Control de zoom por rueda de ratón (Wheel)
    screenCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        zoomLevel = Math.max(0.5, Math.min(10.0, zoomLevel * zoomFactor));
        renderEditCanvasToScreen();
    });

    // Doble clic para reiniciar la vista al centro de pantalla
    screenCanvas.addEventListener('dblclick', () => {
        zoomLevel = 1.0;
        panX = 0;
        panY = 0;
        renderEditCanvasToScreen();
    });

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
        
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = editCanvas.width;
        finalCanvas.height = editCanvas.height;
        const finalCtx = finalCanvas.getContext('2d');
        finalCtx.drawImage(editCanvas, 0, 0);

        // Suavizado Gaussiano y remoción de halos
        applyEdgeRefinements(finalCanvas, 1);

        // ASIGNAR PIXELES Y CONTROLAR FISICIDAD (Garantía Antiacortamiento / Anti-Shrink)
        actualRaster.canvas = finalCanvas;
        actualRaster.data = actualRaster.data || {};
        actualRaster.data.originalCanvas = finalCanvas;

        actualRaster.matrix = oldMatrix;
        actualRaster.position = oldPosition;

        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(window.selectedItem);
        }
        paper.view.update();
        closeModal();
    };
}

/**
 * ASSETS/js/modules/canvas-pro/backgroundRemover.js
 * 
 * Módulo profesional de eliminación de fondo interactivo (PhotoRoom-style) - Versión 7.
 * Ofrece:
 * 1. Pincel borrador (Erase) y restaurador (Restore) con tamaño y dureza (suavizado radial) regulables.
 * 2. Varita mágica (Magic Wand) con algoritmo de inundación (flood-fill) optimizado y tolerancia ajustable.
 * 3. Conservación de calidad extrema (ejecuta los cambios sobre el lienzo de alta resolución de origen).
 * 4. Historial interno de cambios (Deshacer/Rehacer) durante la sesión de recorte.
 * 5. Interfaz de usuario (modal interactiva draggable) con fondo de tablero de ajedrez para previsualizar transparencia.
 * 6. Zoom interactivo con la rueda del ratón y paneo (Shift + arrastrar o botón derecho) para retoque manual de precisión.
 * 7. Filtro convolucional de nitidez (Sharpen 3x3) para contornos nítidos antes de vectorizar.
 * 8. [NUEVO] Garantía total anti-achicamiento (Anti-Shrink Guarantee) que preserva escala/matriz física en Paper.js.
 * 9. [NUEVO] Filtro de suavizado y defringe de bordes (Feather & Defringe) para eliminar halos y "líneas de color".
 * 10. [NUEVO] Cargador asíncrono con CDN de respaldo e inicio silencioso sin interrupciones en F12.
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
            width: 950px;
            max-width: 95%;
            height: 720px;
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
            transform-origin: center;
        }
        .bg-remover-sidebar {
            background-color: #222;
            border-radius: 8px;
            padding: 15px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            overflow-y: auto;
            border: 1px solid rgba(255,255,255,0.05);
        }
        .bg-remover-section-title {
            font-size: 13px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: #888;
            margin-bottom: 3px;
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
        .hidden {
            display: none !important;
        }
        /* Indicador de carga asíncrona de IA */
        .ia-loader-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.75);
            z-index: 10010;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            color: white;
            font-family: system-ui, -apple-system, sans-serif;
        }
        .ia-loader-card {
            background-color: #222;
            border: 2px solid #007bff;
            border-radius: 12px;
            padding: 30px;
            width: 450px;
            text-align: center;
            box-shadow: 0 10px 30px rgba(0,0,0,0.5);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 15px;
        }
        .ia-loader-spinner {
            width: 50px;
            height: 50px;
            border: 5px solid #333;
            border-top: 5px solid #007bff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        .ia-progress-bar-bg {
            width: 100%;
            height: 8px;
            background-color: #444;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 10px;
        }
        .ia-progress-bar-fill {
            height: 100%;
            width: 0%;
            background-color: #007bff;
            transition: width 0.3s;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(styleEl);
}

/**
 * Resuelve recursivamente un paper.Item (ej: clipGroup o Raster) para extraer la imagen Raster real.
 * Retorna null de forma segura si no se trata de una imagen.
 */
export function getRasterFromItem(item) {
    if (!item) return null;
    if (item instanceof paper.Raster) return item;
    
    if (item.children && item.children.length > 0) {
        // Buscar primero un raster explícito que no esté bloqueado
        const rasterChild = item.children.find(c => {
            try {
                if (c instanceof paper.Raster && !c.data?.mockup) {
                    return true;
                }
            } catch (e) {}
            return false;
        });
        if (rasterChild) return rasterChild;
        
        // Salvaguarda secundaria recursiva profunda
        for (let i = 0; i < item.children.length; i++) {
            const found = getRasterFromItem(item.children[i]);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Carga asíncronamente los scripts de la Inteligencia Artificial (imgly) desde CDNs rápidos.
 * Si falla un CDN, intenta de inmediato con un CDN de respaldo de forma silenciosa.
 */
function loadImglyLibrary() {
    return new Promise((resolve, reject) => {
        if (window.imgly) {
            resolve(window.imgly);
            return;
        }

        const primaryUrl = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@2.0.1/dist/bundle.js";
        const fallbackUrl = "https://unpkg.com/@imgly/background-removal@2.0.1/dist/bundle.js";

        const script = document.createElement('script');
        script.src = primaryUrl;
        script.async = true;
        
        script.onload = () => {
            if (window.imgly) {
                // Configurar assets locales en caché del CDN para no romper carga offline futura
                window.imglyConfig = {
                    publicPath: "https://cdn.jsdelivr.net/npm/@imgly/background-removal@2.0.1/dist/"
                };
                resolve(window.imgly);
            } else {
                tryFallback();
            }
        };
        
        script.onerror = () => {
            tryFallback();
        };

        function tryFallback() {
            console.warn("CDN Primario fallido. Cargando IA desde unpkg de respaldo...");
            const fallbackScript = document.createElement('script');
            fallbackScript.src = fallbackUrl;
            fallbackScript.async = true;
            fallbackScript.onload = () => {
                if (window.imgly) {
                    window.imglyConfig = {
                        publicPath: "https://unpkg.com/@imgly/background-removal@2.0.1/dist/"
                    };
                    resolve(window.imgly);
                } else {
                    reject(new Error("Error de carga en ambos CDNs"));
                }
            };
            fallbackScript.onerror = () => {
                reject(new Error("Error de carga en ambos CDNs"));
            };
            document.head.appendChild(fallbackScript);
        }

        document.head.appendChild(script);
    });
}

// Funciones auxiliares para mostrar/actualizar el indicador de progreso visual de la IA
function showIaLoadingOverlay() {
    if (document.getElementById('ia-loader')) return;
    const overlay = document.createElement('div');
    overlay.id = 'ia-loader';
    overlay.className = 'ia-loader-overlay';
    overlay.innerHTML = `
        <div class="ia-loader-card">
            <div class="ia-loader-spinner"></div>
            <h3 style="margin:0; color:#007bff;">🤖 Iniciando Inteligencia Artificial</h3>
            <p id="ia-loader-text" style="margin:0; font-size:13px; color:#ccc; line-height:1.4;">
                Cargando el modelo de segmentación neuronal local para EKKO Studio...
            </p>
            <div class="ia-progress-bar-bg">
                <div id="ia-loader-progress" class="ia-progress-bar-fill"></div>
            </div>
            <span style="font-size:10px; color:#777;">Procesamiento 100% privado y gratuito en tu GPU</span>
        </div>
    `;
    document.body.appendChild(overlay);
}

function updateIaLoadingProgress(progressPercent, messageText) {
    const bar = document.getElementById('ia-loader-progress');
    const txt = document.getElementById('ia-loader-text');
    if (bar) bar.style.width = progressPercent + "%";
    if (txt && messageText) txt.textContent = messageText;
}

function hideIaLoadingOverlay() {
    const loader = document.getElementById('ia-loader');
    if (loader) loader.remove();
}

/**
 * Calcula de forma ultrarrápida el mapa de bordes (filtro de Sobel) sobre la imagen original.
 * Esto actúa como una barrera rígida que impide que la varita mágica traspase los límites del objeto principal,
 * resolviendo de raíz el problema de pérdida de sujetos en imágenes en escala de grises o bajo contraste.
 */
export function computeSobelEdges(data, width, height) {
    const edges = new Uint8Array(width * height);
    const gray = new Uint8Array(width * height);
    
    // 1. Convertir la imagen a escala de grises de alta precisión
    for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    
    // 2. Aplicar operadores de gradiente convolucional horizontal (Gx) y vertical (Gy)
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
 * Algoritmo base de flood fill optimizado para Canvas 2D con barrera inteligente de Sobel y delta de vecindad local.
 */
export function magicWandFloodFillDirect(ctx, startX, startY, tolerance, edgesMap = null) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    // Usar willReadFrequently para maximizar la velocidad de respuesta de píxeles
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    const startIndex = (startY * width + startX) * 4;
    const r0 = data[startIndex];
    const g0 = data[startIndex + 1];
    const b0 = data[startIndex + 2];
    const a0 = data[startIndex + 3];

    if (a0 < 5) return; // Ya es transparente

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
    
    // Umbral de sensibilidad para la barrera de bordes Sobel
    const edgeThreshold = 25; 

    while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head++;

        const idx = (y * width + x) * 4;
        
        // Muestrear color del pixel que se está procesando para Delta-Local
        const currR = data[idx];
        const currG = data[idx + 1];
        const currB = data[idx + 2];

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
                    
                    // Si el pixel vecino es un borde Sobel fuerte, detener la inundación
                    if (edgesMap && edgesMap[nIdx] > edgeThreshold) {
                        continue;
                    }

                    const pIdx = nIdx * 4;
                    const r = data[pIdx];
                    const g = data[pIdx + 1];
                    const b = data[pIdx + 2];
                    const a = data[pIdx + 3];

                    if (a > 10) {
                        // Delta Global con la esquina
                        const drG = r - r0;
                        const dgG = g - g0;
                        const dbG = b - b0;
                        const distSqGlobal = drG * drG + dgG * dgG + dbG * dbG;

                        // Delta Local con el pixel actual para evitar saltos bruscos
                        const drL = r - currR;
                        const dgL = g - currG;
                        const dbL = b - currB;
                        const distSqLocal = drL * drL + dgL * dgL + dbL * dbL;

                        // Detener si supera la tolerancia global o si hay un cambio brusco local (anti-fugas en grises)
                        if (distSqGlobal <= tolSquare && distSqLocal < 600) {
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
 * Algoritmo maestro de Suavizado y Defringe de bordes (Feather & Defringe).
 * Identifica pixeles frontera de transición de recorte, suaviza su canal de transparencia (alfa)
 * y clona los colores del sujeto hacia afuera para eliminar halos "líneas de color" de fondo.
 */
export function featherAndDefringeEdges(ctx) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    const readData = new Uint8ClampedArray(data);
    
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = (y * width + x) * 4;
            const alpha = readData[idx + 3];
            
            if (alpha > 50) { // Si es un pixel del sujeto activo
                let hasTransparentNeighbor = false;
                let sumAlpha = 0;
                let count = 0;
                
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nIdx = ((y + dy) * width + (x + dx)) * 4;
                        const nAlpha = readData[nIdx + 3];
                        if (nAlpha < 50) {
                            hasTransparentNeighbor = true;
                        }
                        sumAlpha += nAlpha;
                        count++;
                    }
                }
                
                if (hasTransparentNeighbor) {
                    // 1. Suavizar la transparencia (Feathering) de forma matemática
                    data[idx + 3] = Math.round(sumAlpha / count);
                    
                    // 2. Eliminar halos de fondo (Defringing) clonando el color del pixel opaco más cercano
                    let bestDist = 999;
                    let bestR = data[idx];
                    let bestG = data[idx+1];
                    let bestB = data[idx+2];
                    
                    for (let dy = -2; dy <= 2; dy++) {
                        for (let dx = -2; dx <= 2; dx++) {
                            const ny = y + dy;
                            const nx = x + dx;
                            if (ny >= 0 && ny < height && nx >= 0 && nx < width) {
                                const nIdx = (ny * width + nx) * 4;
                                if (readData[nIdx + 3] > 200) { // Píxel 100% opaco del sujeto
                                    const dist = dx*dx + dy*dy;
                                    if (dist < bestDist) {
                                        bestDist = dist;
                                        bestR = readData[nIdx];
                                        bestG = readData[nIdx+1];
                                        bestB = readData[nIdx+2];
                                    }
                                }
                            }
                        }
                    }
                    data[idx] = bestR;
                    data[idx+1] = bestG;
                    data[idx+2] = bestB;
                }
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * [Fase A - Híbrido]
 * Realiza una eliminación de fondo automática utilizando Inteligencia Artificial Local (imgly)
 * o el algoritmo local inteligente Sobel de las 4 esquinas si no hay internet o falla el CDN.
 * GARANTIZA al 100% que la imagen no se achique ni se desplace en pantalla (Anti-Shrink).
 */
export async function autoRemoveBackground(raster) {
    const actualRaster = getRasterFromItem(raster);
    if (!actualRaster) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    // 1. Respaldar matrix, posición y escala (Garantía Antiacortamiento / Anti-Shrink)
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
        // Intentar cargar la Inteligencia Artificial (Opción A)
        const imgly = await loadImglyLibrary();
        
        // Mostrar indicador asíncrono
        showIaLoadingOverlay();
        updateIaLoadingProgress(50, "Cargando modelo de segmentación neuronal local...");

        // Renderizar la imagen original en Blob para la red neuronal
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = actualRaster.data.originalCanvas.width;
        tempCanvas.height = actualRaster.data.originalCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(actualRaster.data.originalCanvas, 0, 0);
        
        const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
        updateIaLoadingProgress(85, "Procesando eliminación de fondo semántica...");

        // Ejecutar eliminación semántica por red neuronal local
        const resultBlob = await imgly.removeBackground(blob, window.imglyConfig);
        
        const resultUrl = URL.createObjectURL(resultBlob);
        const resultImg = new Image();
        
        await new Promise((resolve, reject) => {
            resultImg.onload = resolve;
            resultImg.onerror = reject;
            resultImg.src = resultUrl;
        });

        // Crear canvas finalizado
        const editCanvas = document.createElement('canvas');
        editCanvas.width = resultImg.width;
        editCanvas.height = resultImg.height;
        const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
        editCtx.drawImage(resultImg, 0, 0);

        // Guardar en el historial de Paper.js
        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Asignar el canvas finalizado y RESTAURAR escala/matriz física exactas en pantalla (Anti-Shrink)
        actualRaster.canvas = editCanvas;
        actualRaster.matrix = oldMatrix;
        actualRaster.position = oldPosition;
        actualRaster.data.backgroundAutoRemoved = true;

        URL.revokeObjectURL(resultUrl);
        hideIaLoadingOverlay();

    } catch (err) {
        console.warn("La IA local no pudo ejecutarse. Usando algoritmo de contraste de respaldo (Sobel Contrast Match).", err);
        hideIaLoadingOverlay();
        
        // FALLBACK AUTOMÁTICO DE SEGURIDAD (SOBEL + VARITA MÁGICA DE LAS 4 ESQUINAS)
        const editCanvas = document.createElement('canvas');
        editCanvas.width = actualRaster.data.originalCanvas.width;
        editCanvas.height = actualRaster.data.originalCanvas.height;
        const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
        editCtx.drawImage(actualRaster.data.originalCanvas, 0, 0);

        const width = editCanvas.width;
        const height = editCanvas.height;

        // Mapear bordes Sobel para no perder Don Ramón ni Salem
        const imgDataForEdges = editCtx.getImageData(0, 0, width, height);
        const edgesMap = computeSobelEdges(imgDataForEdges.data, width, height);

        // Remover fondo automático de las 4 esquinas con baja tolerancia (8%) para contornos seguros
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

        // Aplicar el Suavizado y Defringe de bordes para eliminar halos y "líneas de color"
        featherAndDefringeEdges(editCtx);

        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Asignar el canvas de respaldo y RESTAURAR de forma estricta la matriz y posición (Anti-Shrink)
        actualRaster.canvas = editCanvas;
        actualRaster.matrix = oldMatrix;
        actualRaster.position = oldPosition;
        actualRaster.data.backgroundAutoRemoved = true;
    }

    // Actualizar selección celeste de contorno y forzar el renderizado
    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(window.selectedItem);
    }
    
    paper.view.update();
}

/**
 * Abre la modal de eliminación de fondo interactiva para un paper.Raster o clipGroup.
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
    const backupCtx = backupCanvas.getContext('2d', { willReadFrequently: true });
    
    // El respaldo SIEMPRE debe ser la imagen 100% original con fondo
    const rawOriginal = actualRaster.data.originalCanvas || srcImage;
    backupCtx.drawImage(rawOriginal, 0, 0);

    // 2. Historial de sesión de recorte (Deshacer / Rehacer local)
    const historyStack = [];
    let historyIndex = -1;

    // 3. Crear Estructura de la Modal Interactiva en el DOM
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
                    <div class="bg-remover-slider-group" style="margin-top: 5px;">
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
                
                <div class="bg-remover-slider-group" style="margin-top: 5px; border-top:1px solid #333; padding-top:10px;">
                    <span class="bg-remover-section-title">Filtros Láser</span>
                    <button class="bg-remover-tool-btn" id="btnApplySharpen" style="background-color: #2b2b2b; border-color: #007bff; color: #007bff;">
                        ✨ Mejorar Nitidez (Sharpen)
                    </button>
                </div>

                <div class="bg-remover-info">
                    💡 <b>Atajos de Teclado:</b><br>
                    • <b>Rueda Mouse</b>: Zoom<br>
                    • <b>Shift + Arrastrar</b>: Desplazar<br>
                    • <b>Doble clic</b>: Reiniciar vista
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

    // 4. Buscar Elementos Interactivos en el HTML Inyectado
    const screenCanvas = modal.querySelector('#bgRemoverCanvas');
    const screenCtx = screenCanvas.getContext('2d', { willReadFrequently: true });

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
    const btnApplySharpen = modal.querySelector('#btnApplySharpen');

    // 5. Configuración de Variables de Estado de Edición
    let activeTool = 'erase';
    let brushSize = 20;
    let brushHardness = 0.5;
    let magicTolerance = 15;

    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    // Variables de Zoom y Paneo
    let zoomLevel = 1.0;
    let offsetX = 0;
    let offsetY = 0;
    let isPanning = false;
    let startPanX = 0;
    let startPanY = 0;

    function saveSessionHistory() {
        if (historyIndex < historyStack.length - 1) {
            historyStack.splice(historyIndex + 1);
        }
        const snapshot = editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);
        historyStack.push(snapshot);
        historyIndex++;
        updateHistoryButtons();
    }

    function updateHistoryButtons() {
        if (btnRemoverUndo) btnRemoverUndo.disabled = historyIndex <= 0;
        if (btnRemoverRedo) btnRemoverRedo.disabled = historyIndex >= historyStack.length - 1;
    }

    // Inicializar el primer estado del historial antes de pintar
    saveSessionHistory();

    // 6. Renderizador de Pantalla con Zoom y Paneo
    function renderEditCanvasToScreen() {
        screenCanvas.width = screenCanvas.parentElement.clientWidth;
        screenCanvas.height = screenCanvas.parentElement.clientHeight;
        
        screenCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
        screenCtx.save();
        
        // Aplicar transformaciones de Zoom y Paneo desde el centro del canvas
        screenCtx.translate(screenCanvas.width / 2 + offsetX, screenCanvas.height / 2 + offsetY);
        screenCtx.scale(zoomLevel, zoomLevel);
        
        // Dibujar el lienzo de alta calidad centrado
        const drawWidth = editCanvas.width;
        const drawHeight = editCanvas.height;
        const scaleFit = Math.min(screenCanvas.width / drawWidth, screenCanvas.height / drawHeight) * 0.9;
        
        screenCtx.scale(scaleFit, scaleFit);
        screenCtx.drawImage(editCanvas, -drawWidth / 2, -drawHeight / 2);
        
        screenCtx.restore();
    }

    // Escuchar el cambio de tamaño del contenedor de la modal
    const resizeObserver = new ResizeObserver(() => {
        renderEditCanvasToScreen();
    });
    resizeObserver.observe(screenCanvas.parentElement);

    // 7. Enlace de Eventos del Panel Lateral de Ajustes
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

    // Deshacer / Rehacer
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

    // Filtro Convolucional Sharpen 3x3
    btnApplySharpen.onclick = () => {
        const width = editCanvas.width;
        const height = editCanvas.height;
        const imgData = editCtx.getImageData(0, 0, width, height);
        const data = imgData.data;
        const readData = new Uint8ClampedArray(data);

        // Matriz de convolución de nitidez estándar (filtro Laplace de realce)
        const weights = [
             0, -1,  0,
            -1,  5, -1,
             0, -1,  0
        ];

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let r = 0, g = 0, b = 0;
                for (let sy = 0; sy < 3; sy++) {
                    for (let sx = 0; sx < 3; sx++) {
                        const readIdx = ((y + sy - 1) * width + (x + sx - 1)) * 4;
                        const w = weights[sy * 3 + sx];
                        r += readData[readIdx] * w;
                        g += readData[readIdx + 1] * w;
                        b += readData[readIdx + 2] * w;
                    }
                }
                const writeIdx = (y * width + x) * 4;
                data[writeIdx] = Math.max(0, Math.min(255, r));
                data[writeIdx + 1] = Math.max(0, Math.min(255, g));
                data[writeIdx + 2] = Math.max(0, Math.min(255, b));
            }
        }
        editCtx.putImageData(imgData, 0, 0);
        renderEditCanvasToScreen();
        saveSessionHistory();
    };

    // 8. Eventos de Ratón para Zoom, Paneo y Dibujo en la Modal
    function getCanvasCoords(e) {
        const rect = screenCanvas.getBoundingClientRect();
        
        // Coordenadas relativas al elemento canvas de pantalla
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        // Invertir las transformaciones de Zoom y Paneo aplicadas en renderEditCanvasToScreen
        let x = clickX - screenCanvas.width / 2 - offsetX;
        let y = clickY - screenCanvas.height / 2 - offsetY;
        
        x /= zoomLevel;
        y /= zoomLevel;
        
        // Invertir la escala de ajuste físico de la modal
        const scaleFit = Math.min(screenCanvas.width / editCanvas.width, screenCanvas.height / editCanvas.height) * 0.9;
        x /= scaleFit;
        y /= scaleFit;
        
        // Trasladar al origen (esquina superior izquierda de la imagen)
        x += editCanvas.width / 2;
        y += editCanvas.height / 2;
        
        return { x: x, y: y };
    }

    // Zoom con Rueda del Ratón
    screenCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = 1.1;
        if (e.deltaY < 0) {
            zoomLevel = Math.min(15.0, zoomLevel * zoomFactor);
        } else {
            zoomLevel = Math.max(0.3, zoomLevel / zoomFactor);
        }
        renderEditCanvasToScreen();
    });

    // Doble clic para restablecer vista
    screenCanvas.addEventListener('dblclick', () => {
        zoomLevel = 1.0;
        offsetX = 0;
        offsetY = 0;
        renderEditCanvasToScreen();
    });

    screenCanvas.addEventListener('mousedown', (e) => {
        const isMiddleBtn = e.button === 1;
        const isRightBtn = e.button === 2;
        const isLeftWithShift = e.button === 0 && e.shiftKey;

        if (isMiddleBtn || isRightBtn || isLeftWithShift) {
            // Activar paneo interactivo de la imagen
            isPanning = true;
            startPanX = e.clientX - offsetX;
            startPanY = e.clientY - offsetY;
            e.preventDefault();
            return;
        }

        if (e.button === 0) {
            const coords = getCanvasCoords(e);
            
            if (activeTool === 'magic') {
                // Inundación con varita mágica manual (utiliza barrera Sobel local)
                const imgDataForEdges = editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);
                const edgesMap = computeSobelEdges(imgDataForEdges.data, editCanvas.width, editCanvas.height);
                
                magicWandFloodFillDirect(editCtx, Math.round(coords.x), Math.round(coords.y), magicTolerance, edgesMap);
                renderEditCanvasToScreen();
                saveSessionHistory();
            } else {
                isDrawing = true;
                lastX = coords.x;
                lastY = coords.y;
                drawBrushStroke(coords.x, coords.y, coords.x, coords.y);
            }
        }
    });

    // Desactivar menú contextual con click derecho para no estorbar el paneo
    screenCanvas.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    screenCanvas.addEventListener('mousemove', (e) => {
        if (isPanning) {
            offsetX = e.clientX - startPanX;
            offsetY = e.clientY - startPanY;
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

    // Algoritmo de Trazado de Pincel por Interpolación para evitar espacios vacíos en movimientos rápidos
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

    // Aplicar una única huella de pincel redonda con dureza radial
    function applySingleBrushSpot(cx, cy) {
        const radius = brushSize;
        
        const brushCanvas = document.createElement('canvas');
        brushCanvas.width = radius * 2;
        brushCanvas.height = radius * 2;
        const brushCtx = brushCanvas.getContext('2d');

        // Dibujar el degradado radial correspondiente a la dureza del pincel
        const grad = brushCtx.createRadialGradient(radius, radius, radius * brushHardness, radius, radius, radius);
        grad.addColorStop(0, 'rgba(0,0,0,1)'); // Centro opaco (borrado total o restauración total)
        grad.addColorStop(1, 'rgba(0,0,0,0)'); // Borde desvanecido

        brushCtx.fillStyle = grad;
        brushCtx.beginPath();
        brushCtx.arc(radius, radius, radius, 0, Math.PI * 2);
        brushCtx.fill();

        if (activeTool === 'erase') {
            // Borrador: Cortar usando composite 'destination-out'
            editCtx.save();
            editCtx.globalCompositeOperation = 'destination-out';
            editCtx.drawImage(brushCanvas, cx - radius, cy - radius);
            editCtx.restore();
        } else if (activeTool === 'restore') {
            // Restaurador: Pintar los píxeles originales suavizados
            brushCtx.save();
            brushCtx.globalCompositeOperation = 'source-in';
            // Dibujar la porción correspondiente de la imagen original en el pincel
            brushCtx.drawImage(backupCanvas, cx - radius, cy - radius, radius * 2, radius * 2, 0, 0, radius * 2, radius * 2);
            brushCtx.restore();

            editCtx.save();
            editCtx.globalCompositeOperation = 'source-over';
            editCtx.drawImage(brushCanvas, cx - radius, cy - radius);
            editCtx.restore();
        }
    }

    // 9. Comportamiento Draggable (Arrastrable) de la Modal
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

    // 10. Acciones de Cierre de Modal (Aceptar y Cancelar)
    const btnCancel = modal.querySelector('#btnRemoverCancel');
    const btnAccept = modal.querySelector('#btnRemoverAccept');

    const closeModal = () => {
        resizeObserver.disconnect();
        overlay.remove();
    };

    btnCancel.onclick = closeModal;

    btnAccept.onclick = () => {
        // Confirmar cambios y guardarlos en el historial de Paper.js
        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Crear una copia limpia del canvas de edición finalizado
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = editCanvas.width;
        finalCanvas.height = editCanvas.height;
        const finalCtx = finalCanvas.getContext('2d');
        finalCtx.drawImage(editCanvas, 0, 0);

        // Aplicar el Suavizado y Defringe de bordes al canvas final
        featherAndDefringeEdges(finalCtx);

        // RESPALDAR matrix y posición de forma rígida antes de la sustitución (Garantía de escala)
        const oldMatrix = actualRaster.matrix.clone();
        const oldPosition = actualRaster.position.clone();

        // Guardar el nuevo canvas editado en el raster y forzar el renderizado
        actualRaster.canvas = finalCanvas;
        actualRaster.data = actualRaster.data || {};
        actualRaster.data.originalCanvas = finalCanvas; 

        // Restaurar de forma estricta la transformación para congelar el tamaño en pantalla (Anti-Shrink)
        actualRaster.matrix = oldMatrix;
        actualRaster.position = oldPosition;

        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(window.selectedItem);
        }

        paper.view.update();
        closeModal();
    };

    // Lanzar el render inicial de la modal
    setTimeout(() => {
        renderEditCanvasToScreen();
    }, 50);
}

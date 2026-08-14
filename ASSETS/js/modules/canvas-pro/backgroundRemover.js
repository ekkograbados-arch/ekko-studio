
/**
 * ASSETS/js/modules/canvas-pro/backgroundRemover.js
 * 
 * Módulo profesional híbrido de eliminación de fondo (Híbrido A + B).
 * Combina:
 * [A] Inteligencia Artificial de segmentación local en navegador (@imgly/background-removal).
 *     - Gratuito, privado, ilimitado.
 *     - Entiende de forma semántica el sujeto (personas, animales, objetos).
 *     - Indicador visual de progreso durante la primera descarga del modelo (7-15MB).
 *     - Fallback automático y elegante al sistema de contraste en caso de falla de red o estar sin internet.
 * [B] Lienzo de Edición Manual de Precisión (PhotoRoom-style) para retoques perfectos.
 *     - Pincel borrador (Erase) y restaurador (Restore) con tamaño y dureza (radial feathering) regulables.
 *     - Varita mágica local con filtro de barrera Sobel (para escala de grises y contornos de grabado nítidos).
 *     - Herramientas de Zoom y Paneo interactivos (rueda del mouse y Shift + arrastrar).
 *     - Filtro convolucional de nitidez (Sharpen 3x3) integrado en tiempo real.
 *     - Historial completo (Deshacer/Rehacer) y protección absoluta de escala/posición (anti-shrink).
 */

// Estilos CSS consolidados de la modal de retoque manual y el spinner de carga de IA
const removeBgStylesId = 'background-remover-pro-styles';
if (typeof document !== 'undefined' && !document.getElementById(removeBgStylesId)) {
    const styleEl = document.createElement('style');
    styleEl.id = removeBgStylesId;
    styleEl.textContent = `
        /* Overlay de Retoque Manual */
        .bg-remover-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.75);
            z-index: 10005;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
        }
        .bg-remover-modal {
            background-color: #151515;
            color: #f3f3f3;
            border: 2px solid #007bff;
            border-radius: 12px;
            padding: 20px;
            width: 1000px;
            max-width: 95%;
            height: 720px;
            box-shadow: 0 12px 50px rgba(0, 0, 0, 0.9);
            display: flex;
            flex-direction: column;
            user-select: none;
            position: relative;
        }
        .bg-remover-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid rgba(0, 123, 255, 0.2);
            padding-bottom: 12px;
            margin-bottom: 15px;
            cursor: move;
        }
        .bg-remover-header h3 {
            margin: 0;
            color: #007bff;
            font-size: 18px;
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
            background: repeating-conic-gradient(#1e1e1e 0% 25%, #2a2a2a 0% 50%) 50% / 20px 20px;
            border: 1px solid #333;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            position: relative;
            cursor: crosshair;
        }
        #bgRemoverCanvas {
            box-shadow: 0 4px 20px rgba(0,0,0,0.6);
            transform-origin: center;
            cursor: grab;
        }
        #bgRemoverCanvas:active {
            cursor: grabbing;
        }
        .bg-remover-sidebar {
            background-color: #1e1e1e;
            border-radius: 8px;
            padding: 15px;
            display: flex;
            flex-direction: column;
            gap: 15px;
            overflow-y: auto;
            border: 1px solid rgba(255,255,255,0.05);
        }
        .bg-remover-section-title {
            font-size: 11px;
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
            background-color: #2b2b2b;
            border: 1px solid #444;
            border-radius: 6px;
            color: #fff;
            cursor: pointer;
            font-size: 13px;
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
            background-color: #262626;
            padding: 8px 10px;
            border-radius: 4px;
            border-left: 3px solid #007bff;
            line-height: 1.4;
        }
        .bg-remover-actions {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-top: 15px;
            border-top: 1px solid #222;
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
            background-color: #2b2b2b;
            color: #e6e6e6;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .bg-remover-btn-cancel:hover {
            background-color: #3d3d3d;
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
            background-color: #2b2b2b;
            border: 1px solid #444;
            color: #fff;
            border-radius: 4px;
            cursor: pointer;
            font-size: 11px;
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
        
        /* Spinner e Indicador de Carga de IA */
        .ia-loading-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.85);
            z-index: 10010;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
            color: white;
            text-align: center;
        }
        .ia-loading-card {
            background: #151515;
            border: 2px solid #007bff;
            border-radius: 12px;
            padding: 30px;
            width: 420px;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 15px;
        }
        .ia-loading-spinner {
            width: 50px;
            height: 50px;
            border: 5px solid #222;
            border-top: 5px solid #007bff;
            border-radius: 50%;
            animation: spin-ia-remover 1s linear infinite;
        }
        .ia-loading-title {
            font-size: 16px;
            font-weight: bold;
            color: #007bff;
            margin: 0;
        }
        .ia-loading-progress-bar {
            width: 100%;
            height: 8px;
            background-color: #222;
            border-radius: 4px;
            overflow: hidden;
            margin-top: 5px;
        }
        .ia-loading-progress-fill {
            height: 100%;
            width: 0%;
            background-color: #007bff;
            transition: width 0.1s ease;
            box-shadow: 0 0 8px #007bff;
        }
        .ia-loading-status {
            font-size: 12px;
            color: #aaa;
            margin: 0;
        }
        .ia-loading-subtext {
            font-size: 10px;
            color: #666;
            margin: 0;
            line-height: 1.4;
        }
        @keyframes spin-ia-remover {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(styleEl);
}

/**
 * Resuelve y extrae recursivamente el paper.Raster real dentro de un grupo o clipGroup.
 */
export function getRasterFromItem(item) {
    if (!item) return null;
    if (item instanceof paper.Raster) return item;
    
    // Si es un grupo, buscamos en sus hijos de forma recursiva
    if (item instanceof paper.Group && item.children) {
        // Buscar primero un raster directo
        const rasterChild = item.children.find(c => {
            try {
                if (c instanceof paper.Raster) return true;
                if (c.className === 'Raster') return true;
                if (c.children) {
                    const sub = getRasterFromItem(c);
                    if (sub) return true;
                }
            } catch (e) {}
            return false;
        });
        if (rasterChild) {
            if (rasterChild instanceof paper.Raster) return rasterChild;
            return getRasterFromItem(rasterChild);
        }
        
        // Salvaguarda secundaria: cualquier hijo que no sea máscara de recorte ni mockup
        const fallbackChild = item.children.find(c => !c.clipMask && c.className !== 'Path' && !c.data?.mockup);
        if (fallbackChild) return getRasterFromItem(fallbackChild);
    }
    return null;
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
 * Algoritmo base de flood fill optimizado para Canvas 2D con barrera de Sobel y delta-local.
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

    // Tolerancia cuadrática global
    const tolSquare = (tolerance / 100) * 255 * 255 * 3;
    // Tolerancia delta local entre píxeles vecinos (evita cruzar fronteras sutiles de grises)
    const localDeltaMax = Math.max(3, (tolerance / 100) * 45); 
    
    // Umbral de sensibilidad para la barrera de bordes de Sobel
    const edgeThreshold = 25; 

    while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head++;

        const idx = (y * width + x) * 4;
        const currentR = data[idx];
        const currentG = data[idx + 1];
        const currentB = data[idx + 2];
        
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
                    
                    // Barrera 1: Sobel Edge Detection
                    if (edgesMap && edgesMap[nIdx] > edgeThreshold) {
                        continue;
                    }

                    const pIdx = nIdx * 4;
                    const r = data[pIdx];
                    const g = data[pIdx + 1];
                    const b = data[pIdx + 2];
                    const a = data[pIdx + 3];

                    if (a > 10) {
                        // Barrera 2: Tolerancia global respecto al píxel semilla
                        const dr = r - r0;
                        const dg = g - g0;
                        const db = b - b0;
                        const distSq = dr * dr + dg * dg + db * db;
                        
                        // Barrera 3: Tolerancia local respecto al píxel actual (frena bleeding)
                        const dLocal = Math.max(Math.abs(r - currentR), Math.abs(g - currentG), Math.abs(b - currentB));

                        if (distSq <= tolSquare && dLocal <= localDeltaMax) {
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
 * Muestra el overlay / card de progreso de descarga del modelo de Inteligencia Artificial.
 */
function showIaLoadingOverlay() {
    const loader = document.createElement('div');
    loader.className = 'ia-loading-overlay';
    loader.id = 'iaRemoverLoader';
    loader.innerHTML = `
        <div class="ia-loading-card">
            <div class="ia-loading-spinner"></div>
            <p class="ia-loading-title">✂️ Preparando Inteligencia Artificial</p>
            <p class="ia-loading-status" id="iaLoaderStatus">Cargando motor de segmentación semántica...</p>
            <div class="ia-loading-progress-bar">
                <div class="ia-loading-progress-fill" id="iaLoaderProgress"></div>
            </div>
            <p class="ia-loading-subtext">
                Descargando el modelo de reconocimiento visual (aprox. 10MB).<br>
                <b>Esto solo ocurre la primera vez</b>, luego se guardará en tu caché y funcionará al instante.
            </p>
        </div>
    `;
    document.body.appendChild(loader);
}

function updateIaLoadingProgress(progressRatio, statusText) {
    const fill = document.getElementById('iaLoaderProgress');
    const status = document.getElementById('iaLoaderStatus');
    if (fill) fill.style.width = (progressRatio * 100) + '%';
    if (status && statusText) status.textContent = statusText;
}

function hideIaLoadingOverlay() {
    const loader = document.getElementById('iaRemoverLoader');
    if (loader) loader.remove();
}

/**
 * CARGADOR DINÁMICO DE LA LIBRERÍA DE IA (imgly background-removal)
 */
async function loadImglyLibrary() {
    if (typeof window.imglyBackgroundRemoval !== 'undefined') {
        return window.imglyBackgroundRemoval;
    }
    
    showIaLoadingOverlay();
    updateIaLoadingProgress(0.1, "Conectando con el servidor CDN...");

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        // Usamos una versión estable, optimizada y compacta de un CDN ultrarrápido
        script.src = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@2.1.6/dist/bundle.js";
        script.async = true;
        
        script.onload = () => {
            updateIaLoadingProgress(0.4, "Librería descargada. Inicializando WebAssembly...");
            
            // Adjuntar hooks para monitorear la descarga del modelo de red neuronal de 10MB
            window.imglyConfig = {
                progress: (handle, current, total) => {
                    const pct = current / total;
                    const loadedMb = (current / 1024 / 1024).toFixed(1);
                    const totalMb = (total / 1024 / 1024).toFixed(1);
                    updateIaLoadingProgress(
                        0.4 + (pct * 0.6), 
                        `Descargando red neuronal: ${loadedMb}MB / ${totalMb}MB (${Math.round(pct * 100)}%)`
                    );
                },
                model: "medium", // Modelo balanceado para excelente precisión y descarga ligera de 10MB
                device: "gpu" // Fuerza el uso de WebGL/GPU del cliente para velocidad instantánea
            };
            
            setTimeout(() => {
                hideIaLoadingOverlay();
                resolve(window.imglyBackgroundRemoval);
            }, 500);
        };
        
        script.onerror = (err) => {
            hideIaLoadingOverlay();
            reject(new Error("No se pudo cargar el script de IA desde el CDN (¿Estás sin internet?)"));
        };
        
        document.head.appendChild(script);
    });
}

/**
 * [Fase A - Híbrido]
 * Realiza una eliminación de fondo automática utilizando Inteligencia Artificial Local (imgly).
 * Si falla la red o está offline, hace fallback automático a Sobel Edge Contrast de fondo plano.
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
        // Intentar cargar la Inteligencia Artificial de segmentación semántica (Opción A)
        const imgly = await loadImglyLibrary();
        
        // Mostrar indicador de procesamiento gráfico local
        showIaLoadingOverlay();
        updateIaLoadingProgress(0.9, "IA analizando la escena y separando sujeto del fondo...");

        // Obtener la imagen fuente en formato Blob para la IA
        const tempCanvas = document.createElement('canvas');
        tempCanvas.width = actualRaster.data.originalCanvas.width;
        tempCanvas.height = actualRaster.data.originalCanvas.height;
        const tempCtx = tempCanvas.getContext('2d');
        tempCtx.drawImage(actualRaster.data.originalCanvas, 0, 0);
        
        const blob = await new Promise(resolve => tempCanvas.toBlob(resolve, 'image/png'));
        
        // Ejecutar eliminación semántica por red neuronal
        const resultBlob = await imgly.removeBackground(blob, window.imglyConfig);
        
        // Convertir el blob procesado a un elemento de imagen HTML
        const resultUrl = URL.createObjectURL(resultBlob);
        const resultImg = new Image();
        
        await new Promise((resolve, reject) => {
            resultImg.onload = resolve;
            resultImg.onerror = reject;
            resultImg.src = resultUrl;
        });

        // Dibujar el resultado de la IA en un canvas de edición limpio
        const editCanvas = document.createElement('canvas');
        editCanvas.width = resultImg.width;
        editCanvas.height = resultImg.height;
        const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
        editCtx.drawImage(resultImg, 0, 0);

        // Guardar historial en Paper.js
        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Asignar los píxeles recortados por IA al raster
        actualRaster.canvas = editCanvas;
        actualRaster.data.backgroundAutoRemoved = true;

        // Liberar URL en memoria
        URL.revokeObjectURL(resultUrl);
        hideIaLoadingOverlay();

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

        // Mapear bordes Sobel para no perder Don Ramón ni Salem
        const imgDataForEdges = editCtx.getImageData(0, 0, width, height);
        const edgesMap = computeSobelEdges(imgDataForEdges.data, width, height);

        // Remover fondo automático de respaldo en las 4 esquinas con baja tolerancia (8%)
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

        actualRaster.canvas = editCanvas;
        actualRaster.data.backgroundAutoRemoved = true;
    }

    // RESTAURACIÓN ABSOLUTA DE LA MATRIZ DE TRANSFORMACIÓN (Anti-Shrink / Bloqueo de Escala)
    actualRaster.matrix = oldMatrix;

    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(window.selectedItem);
    }
    
    paper.view.update();
}

/**
 * [Fase B - Híbrido]
 * Abre la modal de edición manual PhotoRoom-style con pinceles y varita de tolerancia.
 * @param {paper.Raster} raster Objeto de imagen en Paper.js o clipGroup
 */
export function openBackgroundRemovalModal(raster) {
    const actualRaster = getRasterFromItem(raster);
    if (!actualRaster) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    // 1. Obtener la fuente original en alta resolución
    if (!actualRaster.data) actualRaster.data = {};
    let srcImage = actualRaster.data.originalCanvas || actualRaster.canvas || actualRaster.image;
    if (!srcImage) return;

    // Canvas de edición actual (preserva lo ya recortado por IA)
    const editCanvas = document.createElement('canvas');
    editCanvas.width = srcImage.width || actualRaster.width;
    editCanvas.height = srcImage.height || actualRaster.height;
    const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
    const baseImage = actualRaster.canvas || srcImage;
    editCtx.drawImage(baseImage, 0, 0);

    // Canvas de restauración (SIEMPRE contiene la imagen original íntegra con fondo)
    const backupCanvas = document.createElement('canvas');
    backupCanvas.width = editCanvas.width;
    backupCanvas.height = editCanvas.height;
    const backupCtx = backupCanvas.getContext('2d', { willReadFrequently: true });
    const rawOriginal = actualRaster.data.originalCanvas || srcImage;
    backupCtx.drawImage(rawOriginal, 0, 0);

    // 2. Historial interno de sesión de retoque (Deshacer/Rehacer)
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

    // 3. Crear Estructura de la Modal Draggable en el DOM
    const overlay = document.createElement('div');
    overlay.className = 'bg-remover-overlay';

    const modal = document.createElement('div');
    modal.className = 'bg-remover-modal';

    const mmW = actualRaster.bounds.width.toFixed(1);
    const mmH = actualRaster.bounds.height.toFixed(1);

    modal.innerHTML = `
        <div class="bg-remover-header">
            <h3>✂️ Retocar Recorte y Borrador de Fondo</h3>
            <span style="font-size: 11px; color: #888;">Grabado real: <b>${mmW} mm x ${mmH} mm</b></span>
        </div>
        <div class="bg-remover-container">
            <!-- Lienzo Interactivo con soporte para Zoom y Paneo -->
            <div class="bg-remover-canvas-area" id="bgRemoverViewport">
                <canvas id="bgRemoverCanvas"></canvas>
            </div>

            <!-- Panel Lateral de Retoque -->
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
                    <div class="bg-remover-slider-group" style="margin-top: 8px;">
                        <div class="bg-remover-slider-label">
                            <span>Dureza (Difuminado):</span>
                            <span id="lblBrushHardness">50%</span>
                        </div>
                        <input type="range" class="bg-remover-slider" id="slideBrushHardness" min="0" max="100" value="50">
                    </div>
                </div>

                <div class="bg-remover-slider-group hidden" id="groupMagicControls">
                    <span class="bg-remover-section-title">Tolerancia Varita</span>
                    <div class="bg-remover-slider-group">
                        <div class="bg-remover-slider-label">
                            <span>Sensibilidad:</span>
                            <span id="lblMagicTolerance">15</span>
                        </div>
                        <input type="range" class="bg-remover-slider" id="slideMagicTolerance" min="1" max="100" value="15">
                    </div>
                </div>

                <div class="bg-remover-slider-group">
                    <span class="bg-remover-section-title">Filtros Láser</span>
                    <button class="bg-remover-tool-btn" id="btnApplySharpen" style="background-color: #2a352a; border-color: #3b503b;">
                        ✨ Mejorar Nitidez (PPP)
                    </button>
                </div>

                <div class="bg-remover-info">
                    💡 <b>Tip de Edición:</b><br>
                    - Usa la <b>rueda del mouse</b> para hacer Zoom.<br>
                    - Mantén presionado <b>Shift + arrastrar</b> para moverte (panear).<br>
                    - Pinceles con dureza baja logran un difuminado radial excelente.
                </div>
            </div>
        </div>
        <div class="bg-remover-actions">
            <span style="font-size: 11px; color: #666;" id="zoomIndicator">Zoom: 100%</span>
            <div style="display: flex; gap: 10px;">
                <button class="bg-remover-btn bg-remover-btn-cancel" id="btnRemoverCancel">Cancelar</button>
                <button class="bg-remover-btn bg-remover-btn-accept" id="btnRemoverAccept">Aplicar Retoques</button>
            </div>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // 4. Inicializar Elementos y Eventos DOM
    const screenCanvas = modal.querySelector('#bgRemoverCanvas');
    const screenCtx = screenCanvas.getContext('2d', { willReadFrequently: true });
    const viewport = modal.querySelector('#bgRemoverViewport');
    const zoomText = modal.querySelector('#zoomIndicator');

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
    const btnApplySharpen = modal.querySelector('#btnApplySharpen');

    const groupBrushControls = modal.querySelector('#groupBrushControls');
    const groupMagicControls = modal.querySelector('#groupMagicControls');

    // Inicializar el primer estado del historial tras mapear los botones
    saveSessionHistory();

    // 5. Renderizado en pantalla con soporte de transformación (Zoom y Paneo)
    let zoomScale = 1.0;
    let panX = 0;
    let panY = 0;

    function renderEditCanvasToScreen() {
        screenCanvas.width = editCanvas.width;
        screenCanvas.height = editCanvas.height;
        screenCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
        screenCtx.drawImage(editCanvas, 0, 0);
        
        applyViewportTransform();
    }

    function applyViewportTransform() {
        screenCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
        if (zoomText) zoomText.textContent = `Zoom: ${Math.round(zoomScale * 100)}%`;
    }

    renderEditCanvasToScreen();

    // 6. Variables de Estado de Edición
    let activeTool = 'erase'; // 'erase' | 'restore' | 'magic'
    let brushSize = 20;
    let brushHardness = 0.5; // 0.0 a 1.0
    let magicTolerance = 15;

    let isDrawing = false;
    let isPanning = false;
    let lastX = 0;
    let lastY = 0;

    // 7. Enlace de Controles de Barra Lateral
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

    // Filtro convolucional de máscara de enfoque (Sharpen 3x3)
    btnApplySharpen.onclick = () => {
        const w = editCanvas.width;
        const h = editCanvas.height;
        const imgData = editCtx.getImageData(0, 0, w, h);
        const data = imgData.data;
        const output = editCtx.createImageData(w, h);
        const outData = output.data;

        // Matriz convolucional de enfoque nítido (PPP)
        const weights = [
             0, -1,  0,
            -1,  5, -1,
             0, -1,  0
        ];
        const side = 3;
        const halfSide = 1;

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

                outData[dstOff] = Math.min(255, Math.max(0, r));
                outData[dstOff + 1] = Math.min(255, Math.max(0, g));
                outData[dstOff + 2] = Math.min(255, Math.max(0, b));
                outData[dstOff + 3] = a; // Preservar canal alfa del recorte
            }
        }
        editCtx.putImageData(output, 0, 0);
        renderEditCanvasToScreen();
        saveSessionHistory();
    };

    function updateHistoryButtons() {
        if (btnRemoverUndo && btnRemoverRedo) {
            btnRemoverUndo.disabled = historyIndex <= 0;
            btnRemoverRedo.disabled = historyIndex >= historyStack.length - 1;
        }
    }

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

    // 8. Eventos de Zoom y Paneo
    viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = 1.1;
        if (e.deltaY < 0) {
            zoomScale = Math.min(15, zoomScale * zoomFactor);
        } else {
            zoomScale = Math.max(0.15, zoomScale / zoomFactor);
        }
        applyViewportTransform();
    }, { passive: false });

    // 9. Lógica del Ratón en el Canvas (Coordenadas Transformadas)
    function getCanvasCoords(e) {
        const rect = screenCanvas.getBoundingClientRect();
        // Mapea la posición del ratón considerando el zoom y paneo aplicados al contenedor
        const clientX = e.clientX - rect.left;
        const clientY = e.clientY - rect.top;

        const scaleX = editCanvas.width / rect.width;
        const scaleY = editCanvas.height / rect.height;

        return {
            x: clientX * scaleX,
            y: clientY * scaleY
        };
    }

    screenCanvas.addEventListener('mousedown', (e) => {
        // Paneo: Con la tecla Shift presionada, click derecho, o click central
        if (e.shiftKey || e.button === 1 || e.button === 2) {
            isPanning = true;
            lastX = e.clientX;
            lastY = e.clientY;
            e.preventDefault();
            return;
        }

        if (e.button !== 0) return; // Solo click izquierdo para dibujar

        const coords = getCanvasCoords(e);
        
        if (activeTool === 'magic') {
            const tempImgData = editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);
            const edgesMap = computeSobelEdges(tempImgData.data, editCanvas.width, editCanvas.height);
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

    screenCanvas.addEventListener('mousemove', (e) => {
        if (isPanning) {
            const deltaX = e.clientX - lastX;
            const deltaY = e.clientY - lastY;
            panX += deltaX;
            panY += deltaY;
            lastX = e.clientX;
            lastY = e.clientY;
            applyViewportTransform();
            return;
        }

        if (!isDrawing) return;
        const coords = getCanvasCoords(e);
        drawBrushStroke(lastX, lastY, coords.x, coords.y);
        lastX = coords.x;
        lastY = coords.y;
    });

    window.addEventListener('mouseup', () => {
        isPanning = false;
        if (isDrawing) {
            isDrawing = false;
            saveSessionHistory();
        }
    });

    // Desactivar menú contextual del click derecho sobre el canvas para no obstruir el paneo
    screenCanvas.addEventListener('contextmenu', e => e.preventDefault());

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

    // Aplicar pincel redondo con dureza radial desvanecida
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

    // 10. Comportamiento Draggable de la modal flotante
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

    // 11. Acciones de Guardar e Historial Paper.js
    const btnCancel = modal.querySelector('#btnRemoverCancel');
    const btnAccept = modal.querySelector('#btnRemoverAccept');

    const closeModal = () => {
        overlay.remove();
    };

    btnCancel.onclick = closeModal;

    btnAccept.onclick = () => {
        // Confirmar cambios y respaldarlos en el historial de Paper.js
        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Crear una copia limpia del canvas de edición finalizado
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = editCanvas.width;
        finalCanvas.height = editCanvas.height;
        const finalCtx = finalCanvas.getContext('2d');
        finalCtx.drawImage(editCanvas, 0, 0);

        // Guardar la escala y transformaciones en pantalla (Garantía Antiacortamiento / Anti-Shrink)
        const oldMatrix = actualRaster.matrix.clone();

        // Guardar el nuevo canvas editado en el raster y forzar el renderizado
        actualRaster.canvas = finalCanvas;
        actualRaster.data = actualRaster.data || {};
        actualRaster.data.originalCanvas = finalCanvas; 

        // Restaurar matriz física de escala para bloquear achicamientos
        actualRaster.matrix = oldMatrix;

        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(window.selectedItem);
        }

        paper.view.update();
        closeModal();
    };
}

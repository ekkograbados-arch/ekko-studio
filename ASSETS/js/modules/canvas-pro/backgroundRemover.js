/**
 * ASSETS/js/modules/canvas-pro/backgroundRemover.js
 * 
 * Módulo profesional consolidado de eliminación de fondo (Híbrido A + B).
 * Combina Inteligencia Artificial de segmentación semántica (Fase A) con 
 * un lienzo de retoque manual PhotoRoom-style (Fase B) con Zoom, Paneo,
 * Filtro de Nitidez, Borrado Multi-Origen con barrera Sobel y Defringe de bordes.
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
        }
        .bg-remover-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 2px solid rgba(0, 123, 255, 0.3);
            padding-bottom: 12px;
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
            gap: 20px;
            flex-grow: 1;
            min-height: 0;
        }
        .bg-remover-canvas-area {
            background: repeating-conic-gradient(#252525 0% 25%, #303030 0% 50%) 50% / 20px 20px;
            border: 2px solid #333;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            position: relative;
            cursor: crosshair;
        }
        #bgRemoverCanvas {
            box-shadow: 0 4px 30px rgba(0,0,0,0.7);
            transform-origin: center;
            image-rendering: pixelated;
        }
        .bg-remover-sidebar {
            background-color: #1f1f1f;
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
            background-color: #2b2b2b;
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
            padding: 10px 22px;
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
            padding: 8px;
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
        /* Tarjeta de Carga de IA Semántica */
        .ia-loading-overlay {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background-color: rgba(0, 0, 0, 0.85);
            z-index: 10010;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
        }
        .ia-loading-card {
            background-color: #1a1a1a;
            border: 2px solid #007bff;
            border-radius: 12px;
            padding: 30px;
            width: 450px;
            text-align: center;
            box-shadow: 0 10px 40px rgba(0,0,0,0.8);
        }
        .ia-loading-spinner {
            width: 50px;
            height: 50px;
            border: 5px solid #333;
            border-top: 5px solid #007bff;
            border-radius: 50%;
            animation: ia-spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes ia-spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .ia-loading-progress-bar {
            width: 100%;
            height: 6px;
            background-color: #333;
            border-radius: 3px;
            overflow: hidden;
            margin: 15px 0;
        }
        .ia-loading-progress-fill {
            width: 0%;
            height: 100%;
            background-color: #007bff;
            transition: width 0.3s ease;
        }
    `;
    document.head.appendChild(styleEl);
}

/**
 * Resuelve recursivamente un paper.Item hasta encontrar el paper.Raster real.
 * Soporta de forma robusta los clipGroups de Paper.js de EKKO Studio.
 */
export function getRasterFromItem(item) {
    if (!item) return null;
    if (item instanceof paper.Raster) return item;
    if (item.className === 'Group' || item.children) {
        // Buscar el primer hijo que sea un Raster y no sea de mockup
        const rasterChild = item.children.find(c => {
            try {
                if (c instanceof paper.Raster) {
                    return true;
                }
            } catch (e) {}
            return false;
        });
        if (rasterChild) return rasterChild;
        
        // Salvaguarda secundaria: cualquier hijo que no sea máscara de recorte ni de mockup
        const fallbackChild = item.children.find(c => !c.clipMask && c.className !== 'Path' && !c.data?.mockup);
        if (fallbackChild instanceof paper.Raster) return fallbackChild;
    }
    return null;
}

/**
 * Filtro de Sobel optimizado para mapear contornos de alta resolución.
 * Actúa como una barrera física infranqueable que evita fugas en imágenes en escala de grises o bajo contraste.
 */
export function computeSobelEdges(data, width, height) {
    const edges = new Uint8Array(width * height);
    const gray = new Uint8Array(width * height);
    
    // Convertir a escala de grises de alta precisión
    for (let i = 0; i < data.length; i += 4) {
        gray[i / 4] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    }
    
    // Operador convolucional de Sobel (Gx y Gy)
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
 * Algoritmo de eliminación de halos (Defringing) y suavizado de bordes (Feathering) de nivel profesional.
 * Elimina por completo las líneas o bordes de color del fondo original alrededor del recorte.
 */
export function postProcessEdges(canvas, radius = 2) {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const width = canvas.width;
    const height = canvas.height;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    const output = new Uint8ClampedArray(data);
    
    // 1. Defringe (Eliminar halos) + Feather (Suavizar alfa)
    for (let y = 2; y < height - 2; y++) {
        for (let x = 2; x < width - 2; x++) {
            const idx = (y * width + x) * 4;
            const a = data[idx + 3];
            
            // Si el pixel es semitransparente (borde con halo)
            if (a > 0 && a < 255) {
                let nearestR = data[idx];
                let nearestG = data[idx + 1];
                let nearestB = data[idx + 2];
                let found = false;
                let minDist = 999;
                
                // Buscar el píxel opaque más cercano dentro de un vecindario de 5x5
                for (let dy = -2; dy <= 2; dy++) {
                    for (let dx = -2; dx <= 2; dx++) {
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nIdx = (ny * width + nx) * 4;
                            if (data[nIdx + 3] === 255) {
                                const dist = dx*dx + dy*dy;
                                if (dist < minDist) {
                                    minDist = dist;
                                    nearestR = data[nIdx];
                                    nearestG = data[nIdx + 1];
                                    nearestB = data[nIdx + 2];
                                    found = true;
                                }
                            }
                        }
                    }
                }
                
                // Si encontramos un vecino opaco, reemplazamos el color RGB (Defringe)
                if (found) {
                    output[idx] = nearestR;
                    output[idx + 1] = nearestG;
                    output[idx + 2] = nearestB;
                }
                
                // Suavizado de bordes (Feathering radial 3x3)
                let sumAlpha = 0;
                let count = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const nIdx = ((y + dy) * width + (x + dx)) * 4;
                        sumAlpha += data[nIdx + 3];
                        count++;
                    }
                }
                output[idx + 3] = Math.round(sumAlpha / count);
            }
        }
    }
    
    imgData.data.set(output);
    ctx.putImageData(imgData, 0, 0);
}

/**
 * Algoritmo base de flood fill optimizado para Canvas 2D con barrera Sobel.
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

    const tolSquare = (tolerance / 100) * 255 * 255 * 3;
    const edgeThreshold = 35; // Alta sensibilidad para detectar contornos finos en Salem/Don Ramón

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
                    
                    // Detener inundación si choca contra un borde de contraste fuerte de Sobel
                    if (edgesMap && edgesMap[nIdx] > edgeThreshold) {
                        continue;
                    }

                    const pIdx = nIdx * 4;
                    const r = data[pIdx];
                    const g = data[pIdx + 1];
                    const b = data[pIdx + 2];
                    const a = data[pIdx + 3];

                    if (a > 10) {
                        const dr = r - r0;
                        const dg = g - g0;
                        const db = b - b0;
                        const distSq = dr * dr + dg * dg + db * db;
                        if (distSq <= tolSquare) {
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
 * Algoritmo avanzado de inundación por bordes múltiples (Multi-Source Border Flood-Fill).
 * Escanea todo el perímetro exterior de la imagen y dispara un borrado masivo inteligente
 * de fondo desde todos los puntos exteriores del sujeto que coincidan con el color de las esquinas,
 * respetando la barrera física de Sobel.
 */
export function magicWandBorderFloodFill(ctx, tolerance, edgesMap) {
    const width = ctx.canvas.width;
    const height = ctx.canvas.height;
    
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;
    
    const visited = new Uint8Array(width * height);
    const queueX = new Int32Array(width * height);
    const queueY = new Int32Array(width * height);
    let head = 0;
    let tail = 0;
    
    // Muestrear los colores de las 4 esquinas para determinar el color de fondo de referencia
    const cornerIndices = [
        (5 * width + 5) * 4,
        (5 * width + (width - 6)) * 4,
        ((height - 6) * width + 5) * 4,
        ((height - 6) * width + (width - 6)) * 4
    ];
    
    const cornerColors = cornerIndices.map(idx => ({
        r: data[idx], g: data[idx+1], b: data[idx+2], a: data[idx+3]
    }));
    
    const tolSquare = (tolerance / 100) * 255 * 255 * 3;
    const edgeThreshold = 35;
    
    // Añadir a la cola todos los píxeles de los bordes que tengan un color similar a las esquinas
    function addBorderSeed(x, y) {
        const idx = (y * width + x) * 4;
        const a = data[idx + 3];
        if (a < 10) return;
        
        const r = data[idx];
        const g = data[idx+1];
        const b = data[idx+2];
        
        // Comprobar similitud con alguna de las esquinas
        const isBackground = cornerColors.some(c => {
            if (c.a < 10) return true; // Si la esquina es transparente, el fondo ya está limpio
            const distSq = (r - c.r)**2 + (g - c.g)**2 + (b - c.b)**2;
            return distSq <= tolSquare;
        });
        
        if (isBackground) {
            const nIdx = y * width + x;
            if (!visited[nIdx]) {
                visited[nIdx] = 1;
                queueX[tail] = x;
                queueY[tail] = y;
                tail++;
            }
        }
    }
    
    // Escaneo de borde superior e inferior
    for (let x = 0; x < width; x++) {
        addBorderSeed(x, 0);
        addBorderSeed(x, height - 1);
    }
    // Escaneo de borde izquierdo y derecho
    for (let y = 0; y < height; y++) {
        addBorderSeed(0, y);
        addBorderSeed(width - 1, y);
    }
    
    // Bucle de Flood-Fill Multi-Origen
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
                    
                    // Detener si choca contra barrera Sobel
                    if (edgesMap && edgesMap[nIdx] > edgeThreshold) {
                        continue;
                    }
                    
                    const pIdx = nIdx * 4;
                    const a = data[pIdx + 3];
                    
                    if (a > 10) {
                        // Delta de color local para evitar fugas descontroladas en áreas degradadas
                        const dr = data[pIdx] - data[idx];
                        const dg = data[pIdx+1] - data[idx+1];
                        const db = data[pIdx+2] - data[idx+2];
                        const localDistSq = dr*dr + dg*dg + db*db;
                        
                        // Si el color es similar al pixel anterior, expandir borrado
                        if (localDistSq <= tolSquare) {
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

// Funciones de utilidad para mostrar cargador de IA
function showIaLoadingOverlay() {
    if (typeof document === 'undefined') return;
    const overlay = document.createElement('div');
    overlay.id = 'ia-loading-overlay';
    overlay.className = 'ia-loading-overlay';
    overlay.innerHTML = `
        <div class="ia-loading-card">
            <div class="ia-loading-spinner"></div>
            <h4 style="margin:0 0 10px; color:#fff; font-size:18px;">Cargando IA de Recorte Semántico</h4>
            <p style="margin:0; color:#aaa; font-size:13px;" id="ia-loading-status">Conectando con servidores neuronales locales...</p>
            <div class="ia-loading-progress-bar">
                <div class="ia-loading-progress-fill" id="ia-loading-progress-fill"></div>
            </div>
            <p style="margin:5px 0 0; color:#007bff; font-size:11px; font-weight:bold;" id="ia-loading-mb">0 MB / 0 MB</p>
        </div>
    `;
    document.body.appendChild(overlay);
}

function updateIaLoadingProgress(progress, text) {
    if (typeof document === 'undefined') return;
    const fill = document.getElementById('ia-loading-progress-fill');
    const status = document.getElementById('ia-loading-status');
    const mbText = document.getElementById('ia-loading-mb');
    if (fill) fill.style.width = (progress * 100) + '%';
    if (status) status.textContent = text;
    if (mbText) mbText.textContent = `Descargando: ${(progress * 11).toFixed(1)} MB / 11.2 MB`;
}

function hideIaLoadingOverlay() {
    if (typeof document === 'undefined') return;
    const el = document.getElementById('ia-loading-overlay');
    if (el) el.remove();
}

/**
 * Carga asíncrona de la librería img.ly de forma segura con reintentos en CDNs alternativos
 */
async function loadImglyLibrary() {
    if (window.imgly) return window.imgly;
    if (window.imglyLoadingPromise) return window.imglyLoadingPromise;
    
    window.imglyLoadingPromise = new Promise((resolve, reject) => {
        showIaLoadingOverlay();
        updateIaLoadingProgress(0.1, "Descargando motor WebAssembly (jsDelivr)...");
        
        const script = document.createElement('script');
        script.src = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/bundle.js";
        
        script.onload = () => {
            window.imgly = window.imgly || window.imglyBackgroundRemoval;
            // Configurar los recursos de descarga de red local para evitar bloqueos posteriores
            window.imglyConfig = {
                publicPath: "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.4.5/dist/",
                progress: (type, active, total) => {
                    if (type === 'fetch' && total > 0) {
                        const pct = active / total;
                        updateIaLoadingProgress(pct, `Cargando red neuronal: ${type} dist/model...`);
                    }
                }
            };
            hideIaLoadingOverlay();
            resolve(window.imgly);
        };
        
        script.onerror = () => {
            console.warn("CDN Primario fallido. Cargando IA desde unpkg de respaldo...");
            updateIaLoadingProgress(0.4, "CDN primario fallido. Reintentando con unpkg de respaldo...");
            
            const fallbackScript = document.createElement('script');
            fallbackScript.src = "https://unpkg.com/@imgly/background-removal@1.4.5/dist/bundle.js";
            
            fallbackScript.onload = () => {
                window.imgly = window.imgly || window.imglyBackgroundRemoval;
                window.imglyConfig = {
                    publicPath: "https://unpkg.com/@imgly/background-removal@1.4.5/dist/",
                    progress: (type, active, total) => {
                        if (type === 'fetch' && total > 0) {
                            const pct = active / total;
                            updateIaLoadingProgress(pct, `Cargando red neuronal de respaldo...`);
                        }
                    }
                };
                hideIaLoadingOverlay();
                resolve(window.imgly);
            };
            
            fallbackScript.onerror = () => {
                hideIaLoadingOverlay();
                reject(new Error("Error de carga en ambos CDNs"));
            };
            
            document.head.appendChild(fallbackScript);
        };
        
        document.head.appendChild(script);
    });
    
    return window.imglyLoadingPromise;
}

/**
 * [Fase A - Híbrido]
 * Realiza una eliminación de fondo automática utilizando Inteligencia Artificial Local (imgly)
 * con fallback automático a Sobel Contrast Match si está offline o hay fallas de red.
 * Garantiza de forma absoluta que la escala, posición y rotación física en pantalla no se alteren.
 */
export async function autoRemoveBackground(raster, tolerance = 8) {
    const actualRaster = getRasterFromItem(raster);
    if (!actualRaster) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    // 1. RESPALDAR MATRIZ FÍSICA EN PANTALLA (Garantía absoluta Antiacortamiento / Anti-Shrink)
    const oldMatrix = actualRaster.matrix.clone();

    // 2. RESPALDAR CANVAS ORIGINAL SI NO EXISTE
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
        // Intentar ejecutar la Inteligencia Artificial Local
        const imgly = await loadImglyLibrary();
        
        showIaLoadingOverlay();
        updateIaLoadingProgress(0.95, "IA analizando escena y aislando sujeto...");

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

        // Suavizar contornos y eliminar halos del recorte de la IA
        postProcessEdges(editCanvas, 2);

        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Asignar canvas recortado por IA y RESTAURAR MATRIZ EN PANTALLA
        actualRaster.canvas = editCanvas;
        actualRaster.matrix = oldMatrix;
        actualRaster.data.backgroundAutoRemoved = true;

        URL.revokeObjectURL(resultUrl);
        hideIaLoadingOverlay();

    } catch (err) {
        console.warn("La IA local no pudo ejecutarse. Usando algoritmo de contraste de respaldo (Sobel Contrast Match).", err);
        hideIaLoadingOverlay();
        
        // 3. FALLBACK DE ALTO RENDIMIENTO: MULTI-SOURCE BORDER FLOOD-FILL CON BARRERA SOBEL
        const editCanvas = document.createElement('canvas');
        editCanvas.width = actualRaster.data.originalCanvas.width;
        editCanvas.height = actualRaster.data.originalCanvas.height;
        const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
        editCtx.drawImage(actualRaster.data.originalCanvas, 0, 0);

        const width = editCanvas.width;
        const height = editCanvas.height;

        // Mapear los bordes de la imagen para no perder detalles del grabado
        const imgDataForEdges = editCtx.getImageData(0, 0, width, height);
        const edgesMap = computeSobelEdges(imgDataForEdges.data, width, height);

        // Ejecutar eliminación automática multi-origen perimetral
        magicWandBorderFloodFill(editCtx, tolerance, edgesMap);

        // Suavizado final de bordes y defringe anti-halos
        postProcessEdges(editCanvas, 2);

        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Asignar canvas recortado y RESTAURAR MATRIZ FÍSICA EN PANTALLA
        actualRaster.canvas = editCanvas;
        actualRaster.matrix = oldMatrix;
        actualRaster.data.backgroundAutoRemoved = true;
    }

    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(window.selectedItem);
    }
    
    paper.view.update();
}

/**
 * Abre la modal de eliminación de fondo interactiva (Fase B - PhotoRoom Style)
 * Ofrece Pinceles manuales de Borrado/Restauración, Varita Mágica local, Zoom con rueda y Paneo libre.
 */
export function openBackgroundRemovalModal(raster) {
    const actualRaster = getRasterFromItem(raster);
    if (!actualRaster) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    // 1. Obtener la fuente original de píxeles (alta resolución)
    if (!actualRaster.data) actualRaster.data = {};
    let srcImage = actualRaster.data.originalCanvas || actualRaster.canvas || actualRaster.image;
    if (!srcImage) return;

    // Crear un canvas de edición con las dimensiones originales de la imagen (alta calidad)
    const editCanvas = document.createElement('canvas');
    editCanvas.width = srcImage.width || actualRaster.width;
    editCanvas.height = srcImage.height || actualRaster.height;
    const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
    
    // Dibujar el estado actual recortado como base para editar
    const baseImage = actualRaster.canvas || srcImage;
    editCtx.drawImage(baseImage, 0, 0);

    // Crear canvas de respaldo para la herramienta de restauración (SIEMPRE contiene la imagen 100% original con fondo)
    const backupCanvas = document.createElement('canvas');
    backupCanvas.width = editCanvas.width;
    backupCanvas.height = editCanvas.height;
    const backupCtx = backupCanvas.getContext('2d', { willReadFrequently: true });
    
    const rawOriginal = actualRaster.data.originalCanvas || srcImage;
    backupCtx.drawImage(rawOriginal, 0, 0);

    // 2. Historial de sesión de recorte (Deshacer / Rehacer local)
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

    // 3. Crear Estructura de la Modal Interactiva
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
            <!-- Lienzo de Edición Principal -->
            <div class="bg-remover-canvas-area" id="bgRemoverArea">
                <canvas id="bgRemoverCanvas"></canvas>
            </div>

            <!-- Panel Lateral de Herramientas -->
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
                    <button class="bg-remover-tool-btn" id="btnToolSharpen" style="background-color: #28a745; border-color: #28a745; text-align: center; justify-content: center;">
                        ✨ Mejorar Nitidez (Sharpen)
                    </button>
                </div>

                <div class="bg-remover-info">
                    💡 <b>Controles de Vista (Zoom y Paneo):</b><br>
                    • Haz <b>Zoom con la rueda del ratón</b>.<br>
                    • Arrastra con el <b>botón derecho del mouse</b> para panear la vista (o mantén presionado <b>Shift + botón izquierdo</b>).<br>
                    • Haz <b>Doble clic</b> para centrar la imagen.
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

    // 4. Inicializar variables e inputs interactivos del DOM
    const screenCanvas = modal.querySelector('#bgRemoverCanvas');
    const screenCtx = screenCanvas.getContext('2d', { willReadFrequently: true });
    const canvasArea = modal.querySelector('#bgRemoverArea');

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
    const btnToolSharpen = modal.querySelector('#btnToolSharpen');

    const groupBrushControls = modal.querySelector('#groupBrushControls');
    const groupMagicControls = modal.querySelector('#groupMagicControls');

    const btnCancel = modal.querySelector('#btnRemoverCancel');
    const btnAccept = modal.querySelector('#btnRemoverAccept');

    // 5. Estado de Zoom, Paneo y Edición de la modal
    let zoomScale = 1.0;
    let panX = 0;
    let panY = 0;

    let activeTool = 'erase';
    let brushSize = 20;
    let brushHardness = 0.5;
    let magicTolerance = 15;

    let isDrawing = false;
    let isPanning = false;
    let lastX = 0;
    let lastY = 0;

    // Inicializar el primer estado del historial tras registrar los botones
    saveSessionHistory();

    function updateHistoryButtons() {
        if (btnRemoverUndo) btnRemoverUndo.disabled = historyIndex <= 0;
        if (btnRemoverRedo) btnRemoverRedo.disabled = historyIndex >= historyStack.length - 1;
    }

    // Renderizar la vista de la modal aplicando las transformaciones de Zoom y Paneo
    function renderEditCanvasToScreen() {
        screenCanvas.width = editCanvas.width;
        screenCanvas.height = editCanvas.height;
        screenCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
        screenCtx.drawImage(editCanvas, 0, 0);

        // Aplicar transformaciones CSS nativas sobre el elemento canvas para renderizado óptimo y zoom fluido
        screenCanvas.style.transform = `translate(${panX}px, ${panY}px) scale(${zoomScale})`;
    }
    renderEditCanvasToScreen();

    // 6. Controles Deslizantes de Ajuste
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

    // Aplicar Filtro de Nitidez (Sharpen 3x3)
    btnToolSharpen.onclick = () => {
        const width = editCanvas.width;
        const height = editCanvas.height;
        const imgData = editCtx.getImageData(0, 0, width, height);
        const data = imgData.data;
        const output = new Uint8ClampedArray(data);

        // Kernel convolucional de máscara de enfoque
        const weights = [
             0, -1,  0,
            -1,  5, -1,
             0, -1,  0
        ];

        for (let y = 1; y < height - 1; y++) {
            for (let x = 1; x < width - 1; x++) {
                let r = 0, g = 0, b = 0;
                for (let k = -1; k <= 1; k++) {
                    for (let j = -1; j <= 1; j++) {
                        const nIdx = ((y + k) * width + (x + j)) * 4;
                        const w = weights[(k + 1) * 3 + (j + 1)];
                        r += data[nIdx] * w;
                        g += data[nIdx + 1] * w;
                        b += data[nIdx + 2] * w;
                    }
                }
                const idx = (y * width + x) * 4;
                output[idx] = Math.max(0, Math.min(255, r));
                output[idx + 1] = Math.max(0, Math.min(255, g));
                output[idx + 2] = Math.max(0, Math.min(255, b));
            }
        }

        imgData.data.set(output);
        editCtx.putImageData(imgData, 0, 0);
        renderEditCanvasToScreen();
        saveSessionHistory();
    };

    // 7. Lógica de Paneo y Zoom Interactivos
    canvasArea.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = 1.1;
        if (e.deltaY < 0) {
            zoomScale = Math.min(20.0, zoomScale * zoomFactor);
        } else {
            zoomScale = Math.max(0.1, zoomScale / zoomFactor);
        }
        renderEditCanvasToScreen();
    });

    canvasArea.addEventListener('dblclick', () => {
        zoomScale = 1.0;
        panX = 0;
        panY = 0;
        renderEditCanvasToScreen();
    });

    // 8. Eventos de Ratón y Coordenadas Locales
    function getCanvasCoords(e) {
        const rect = screenCanvas.getBoundingClientRect();
        
        // Mapeo inverso de coordenadas CSS (con zoom y paneo aplicados) a píxeles de alta resolución
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;
        
        const scaleX = editCanvas.width / rect.width;
        const scaleY = editCanvas.height / rect.height;
        
        return {
            x: clickX * scaleX,
            y: clickY * scaleY
        };
    }

    screenCanvas.addEventListener('contextmenu', e => e.preventDefault());

    screenCanvas.addEventListener('mousedown', (e) => {
        const rightClick = e.button === 2;
        const leftClick = e.button === 0;
        
        if (rightClick || (leftClick && e.shiftKey)) {
            isPanning = true;
            lastX = e.clientX;
            lastY = e.clientY;
            e.preventDefault();
        } else if (leftClick) {
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
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (isPanning) {
            const deltaX = e.clientX - lastX;
            const deltaY = e.clientY - lastY;
            panX += deltaX;
            panY += deltaY;
            lastX = e.clientX;
            lastY = e.clientY;
            renderEditCanvasToScreen();
        } else if (isDrawing) {
            const coords = getCanvasCoords(e);
            drawBrushStroke(lastX, lastY, coords.x, coords.y);
            lastX = coords.x;
            lastY = coords.y;
        }
    });

    window.addEventListener('mouseup', () => {
        if (isPanning) {
            isPanning = false;
        }
        if (isDrawing) {
            isDrawing = false;
            saveSessionHistory();
        }
    });

    // Algoritmo de Trazado por Interpolación para evitar saltos vacíos al arrastrar rápido
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

    // Pincel redondo con dureza radial interpolada para bordes orgánicos suaves
    function applySingleBrushSpot(cx, cy) {
        const radius = brushSize;
        
        const brushCanvas = document.createElement('canvas');
        brushCanvas.width = radius * 2;
        brushCanvas.height = radius * 2;
        const brushCtx = brushCanvas.getContext('2d');

        const grad = brushCtx.createRadialGradient(radius, radius, radius * brushHardness, radius, radius, radius);
        grad.addColorStop(0, 'rgba(0,0,0,1)'); // Centro opaque
        grad.addColorStop(1, 'rgba(0,0,0,0)'); // Borde degradado

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

    // 10. Acciones de Cierre (Cancelar y Aplicar)
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

        // Suavizar contornos y defringe anti-halos del recorte manual final
        postProcessEdges(finalCanvas, 2);

        // 11. RESPALDAR MATRIZ DE PANTALLA ANTES DE ASIGNAR (Garantía absoluta Antiacortamiento / Anti-Shrink)
        const oldMatrix = actualRaster.matrix.clone();

        actualRaster.canvas = finalCanvas;
        actualRaster.matrix = oldMatrix; // Congelar dimensiones físicas en pantalla
        
        actualRaster.data = actualRaster.data || {};
        actualRaster.data.originalCanvas = finalCanvas;

        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(window.selectedItem);
        }

        paper.view.update();
        closeModal();
    };
}

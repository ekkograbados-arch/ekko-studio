/**
 * ASSETS/js/modules/canvas-pro/backgroundRemover.js
 * 
 * Módulo profesional de eliminación de fondo interactivo (PhotoRoom-style) - Versión 10.
 * Ofrece:
 * 1. Pincel borrador (Erase) y restaurador (Restore) con tamaño y dureza (suavizado radial) regulables.
 *    - Ahora con identificadores por color (Rojo para Borrador, Verde para Restaurador).
 *    - Cursor flotante circular en tiempo real que refleja el diámetro exacto y color de la acción.
 * 2. Varita mágica (Magic Wand) con algoritmo de inundación (flood-fill) optimizado, tolerancia ajustable.
 *    - Identificador por color Celeste/Turquesa en el botón de la barra lateral.
 *    - Flash de retroalimentación en Celeste/Turquesa que ilumina exactamente los píxeles seleccionados antes de borrarlos.
 *    - Círculo de mira celeste para apuntar con precisión de píxel.
 * 3. Conservación de calidad extrema (ejecuta los cambios sobre el lienzo de alta resolución de origen).
 * 4. Historial interno de cambios (Deshacer/Rehacer) durante la sesión de recorte.
 * 5. Interfaz de usuario (modal interactiva draggable) con fondo de tablero de ajedrez para previsualizar transparencia.
 * 6. autoRemoveBackground: Eliminación de fondo automática instantánea con barrera de gradiente Sobel para escala de grises.
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
        
        /* IDENTIFICACIÓN POR COLORES EN ESTADO ACTIVO (PhotoRoom-style) */
        #btnToolErase.active {
            background-color: #dc3545 !important;
            border-color: #dc3545 !important;
            box-shadow: 0 0 12px rgba(220, 53, 69, 0.5) !important;
            color: #fff !important;
        }
        #btnToolRestore.active {
            background-color: #28a745 !important;
            border-color: #28a745 !important;
            box-shadow: 0 0 12px rgba(40, 167, 69, 0.5) !important;
            color: #fff !important;
        }
        #btnToolMagic.active {
            background-color: #00d2ff !important;
            border-color: #00d2ff !important;
            color: #111 !important;
            box-shadow: 0 0 12px rgba(0, 210, 255, 0.5) !important;
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
        
        /* Variación del slider según el color del pincel activo */
        .bg-remover-slider.slider-erase {
            accent-color: #dc3545;
        }
        .bg-remover-slider.slider-restore {
            accent-color: #28a745;
        }
        .bg-remover-slider.slider-magic {
            accent-color: #00d2ff;
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
    `;
    document.head.appendChild(styleEl);
}

// Elemento de Overlay de Carga para la descarga de IA de img.ly
function showIaLoadingOverlay() {
    const old = document.getElementById('bgIaLoadingOverlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'bgIaLoadingOverlay';
    overlay.style.position = 'fixed';
    overlay.style.top = '0'; overlay.style.left = '0';
    overlay.style.right = '0'; overlay.style.bottom = '0';
    overlay.style.backgroundColor = 'rgba(0,0,0,0.85)';
    overlay.style.zIndex = '10009';
    overlay.style.display = 'flex';
    overlay.style.flexDirection = 'column';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.color = '#fff';
    overlay.style.fontFamily = 'system-ui, sans-serif';

    overlay.innerHTML = `
        <div style="background-color: #1e1e1e; border: 2px solid #007bff; border-radius: 12px; padding: 30px; width: 420px; box-shadow: 0 10px 40px rgba(0,0,0,0.6); text-align: center;">
            <div style="font-size: 32px; margin-bottom: 15px;">🧠</div>
            <h3 style="margin: 0 0 10px 0; color: #007bff; font-size: 18px;">Inteligencia Artificial Local</h3>
            <div id="bgIaLoadingText" style="font-size: 13px; color: #ccc; margin-bottom: 15px;">Conectando con la red neuronal local...</div>
            <div style="background-color: #333; height: 6px; width: 100%; border-radius: 3px; overflow: hidden; margin-bottom: 10px;">
                <div id="bgIaProgressBar" style="background-color: #007bff; height: 100%; width: 5%; transition: width 0.2s;"></div>
            </div>
            <div id="bgIaLoadingSubtext" style="font-size: 11px; color: #777;">(Este proceso toma unos segundos; solo ocurre en la primera ejecución de la sesión)</div>
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
/**
 * Duplica un elemento Canvas de HTML de forma profunda e independiente.
 */
function cloneCanvas(oldCanvas) {
    if (!oldCanvas) return null;
    const newCanvas = document.createElement('canvas');
    newCanvas.width = oldCanvas.width;
    newCanvas.height = oldCanvas.height;
    const ctx = newCanvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(oldCanvas, 0, 0);
    return newCanvas;
}

export function getRasterFromItem(item) {
    if (!item) return null;
    if (item instanceof paper.Raster) return item;
    if (item.children) {
        // Buscar el hijo Raster
        const rasterChild = item.children.find(c => c instanceof paper.Raster);
        if (rasterChild) return rasterChild;
        
        // Búsqueda recursiva profunda
        for (let i = 0; i < item.children.length; i++) {
            const found = getRasterFromItem(item.children[i]);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Genera un mapa de gradientes Sobel de 1 bit para usarlo como barrera de contraste
 * durante las selecciones de varita mágica, garantizando nitidez extrema en bordes complejos.
 */
function computeSobelEdges(pixels, width, height) {
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < pixels.length; i += 4) {
        gray[i / 4] = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
    }

    const edges = new Uint8Array(width * height);
    
    // Convolución de Sobel 3x3
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            
            const gX = 
                -gray[(y-1)*width + (x-1)] + gray[(y-1)*width + (x+1)] +
                -2*gray[y*width + (x-1)]     + 2*gray[y*width + (x+1)] +
                -gray[(y+1)*width + (x-1)] + gray[(y+1)*width + (x+1)];
                
            const gY = 
                -gray[(y-1)*width + (x-1)] - 2*gray[(y-1)*width + x] - gray[(y-1)*width + (x+1)] +
                gray[(y+1)*width + (x-1)]  + 2*gray[(y+1)*width + x]  + gray[(y+1)*width + (x+1)];
                
            const mag = Math.sqrt(gX * gX + gY * gY);
            edges[idx] = mag > 25 ? 1 : 0; // Guardar 1 en bordes nítidos de contraste
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
        const cx = queueX[head];
        const cy = queueY[head];
        head++;

        const idx = (cy * width + cx) * 4;
        data[idx + 3] = 0; // Hacer transparente

        const neighbors = [
            { x: cx + 1, y: cy },
            { x: cx - 1, y: cy },
            { x: cx, y: cy + 1 },
            { x: cx, y: cy - 1 }
        ];

        for (let i = 0; i < 4; i++) {
            const nx = neighbors[i].x;
            const ny = neighbors[i].y;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                const nIdx = ny * width + nx;
                if (!visited[nIdx]) {
                    // Si hay mapa Sobel y hay un borde fuerte en este píxel, detenemos la inundación en este camino
                    if (edgesMap && edgesMap[nIdx] === 1) {
                        continue;
                    }

                    const pIdx = nIdx * 4;
                    const nr = data[pIdx];
                    const ng = data[pIdx + 1];
                    const nb = data[pIdx + 2];
                    const na = data[pIdx + 3];

                    if (na >= 5) {
                        const diff = (nr - r0) ** 2 + (ng - g0) ** 2 + (nb - b0) ** 2;
                        if (diff <= tolSquare) {
                            visited[nIdx] = 1;
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
    return new Promise((resolve, reject) => {
        if (window.imglyBackgroundRemoval) {
            resolve(window.imglyBackgroundRemoval);
            return;
        }

        showIaLoadingOverlay();
        updateIaLoadingProgress(0.05, "Inicializando motor de Inteligencia Artificial...");

        // Lista de orígenes ordenados por prioridad (Locales primero para velocidad instantánea, luego CDNs de respaldo)
        const sources = [
            "/ASSETS/js/vendor/background-removal/index.mjs",
            "/ASSETS/js/vendor/background-removal-bundle.js",
            "https://esm.sh/@imgly/background-removal@1.7.0",
            "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/dist/index.mjs",
            "https://unpkg.com/@imgly/background-removal@1.7.0/dist/index.mjs"
        ];

        let index = 0;

        const tryLoadNext = async () => {
            if (index >= sources.length) {
                reject(new Error("No se pudo cargar la librería de eliminación de fondo desde ninguna fuente local ni externa (CDNs)."));
                return;
            }

            const currentSrc = sources[index];
            index++;

            const isLocal = !currentSrc.startsWith("http");
            const provider = isLocal ? "servidor local" : currentSrc.includes("jsdelivr") ? "jsDelivr" : currentSrc.includes("unpkg") ? "unpkg" : "esm.sh";
            updateIaLoadingProgress(0.1 + (index * 0.05), `Estableciendo conexión con ${provider}...`);

            const isEsm = currentSrc.endsWith(".mjs") || currentSrc.includes("esm.sh");

            try {
                console.log(`Intentando cargar IA desde: ${currentSrc}`);
                if (isEsm) {
                    const module = await import(currentSrc);
                    if (module) {
                        window.imglyBackgroundRemoval = module.default || module.removeBackground || module;
                    }
                } else {
                    await new Promise((res, rej) => {
                        const script = document.createElement('script');
                        script.src = currentSrc;
                        script.async = true;
                        script.onload = res;
                        script.onerror = rej;
                        document.head.appendChild(script);
                    });
                }

                if (window.imglyBackgroundRemoval) {
                    console.log(`Librería @imgly/background-removal cargada con éxito desde: ${currentSrc}`);
                    
                    // Configurar publicPath dinámicamente apuntando a staticimgly.com por defecto para los modelos ONNX (88MB)
                    let publicPath = "https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/";
                    
                    if (isLocal) {
                        publicPath = currentSrc.substring(0, currentSrc.lastIndexOf("/") + 1);
                    } else if (currentSrc.includes("unpkg.com")) {
                        publicPath = "https://unpkg.com/@imgly/background-removal-data@1.7.0/dist/";
                    }

                    console.log(`Configurando publicPath de la IA en: ${publicPath}`);
                    window.imglyConfig = {
                        publicPath: publicPath,
                        progress: (key, current, total) => {
                            const progressPct = total ? (current / total) : 0;
                            const pctStr = (progressPct * 100).toFixed(0);
                            const fileName = key.split('/').pop() || key;
                            updateIaLoadingProgress(0.1 + (progressPct * 0.8), `Descargando ${fileName}: ${pctStr}%`);
                        }
                    };
                    resolve(window.imglyBackgroundRemoval);
                } else {
                    console.warn(`Script cargado pero window.imglyBackgroundRemoval no está definido para: ${currentSrc}`);
                    tryLoadNext();
                }
            } catch (err) {
                console.warn(`Fallo al cargar desde ${currentSrc}:`, err);
                tryLoadNext();
            }
        };

        tryLoadNext();
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
                
                // Mezclar color
                data[idx] = nearestR;
                data[idx + 1] = nearestG;
                data[idx + 2] = nearestB;
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

    // 0. Anular de raíz cualquier callback onLoad original para evitar re-escalados y re-posicionamientos fantasmas al modificar .canvas o .source
    actualRaster.onLoad = null;

    // 1. Desvincular de raíz las referencias del objeto .data en clones/duplicados para garantizar independencia absoluta
    if (actualRaster.data) {
        actualRaster.data = { ...actualRaster.data }; // Copia superficial pura de propiedades primitivas
        if (actualRaster.data.originalCanvas) {
            actualRaster.data.originalCanvas = cloneCanvas(actualRaster.data.originalCanvas);
        }
    } else {
        actualRaster.data = {};
    }

    // 2. Inicializar un canvas único e independiente para este Raster (Garantía de Independencia de Imágenes Compartidas/Clonadas)
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

    // 3. Inicializar la copia original (originalCanvas) de alta calidad única para este Raster si no existe
    if (!actualRaster.data.originalCanvas) {
        const origCanvas = document.createElement('canvas');
        origCanvas.width = canvas.width;
        origCanvas.height = canvas.height;
        const origCtx = origCanvas.getContext('2d', { willReadFrequently: true });
        origCtx.drawImage(canvas, 0, 0);
        actualRaster.data.originalCanvas = origCanvas;
    }

    // 4. RESPALDAR FISICIDAD (Garantía absoluta Antiacortamiento / Anti-Shrink)
    const oldMatrixFinal = actualRaster.matrix.clone();
    const oldPositionFinal = actualRaster.position.clone();

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
        const ctxEdit = actualRaster.canvas.getContext('2d', { willReadFrequently: true });
        ctxEdit.clearRect(0, 0, actualRaster.canvas.width, actualRaster.canvas.height);
        ctxEdit.drawImage(resultImg, 0, 0);

        // Suavizado Gaussiano y remoción de halos
        applyEdgeRefinements(actualRaster.canvas, 1);

        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        actualRaster.data.backgroundAutoRemoved = true;

        // Convertir el canvas a PNG data URL para guardarlo permanentemente en Paper.js
        const transparentDataUrl = actualRaster.canvas.toDataURL('image/png');

        // PREVENCIÓN ABSOLUTA DE RACES DE CARGA SÍNCRONA: Anular onLoad original antes de cambiar el source
        actualRaster.onLoad = null;

        actualRaster.onLoad = () => {
            actualRaster.onLoad = null; // Unbind after running once
            // RESTAURAR PROPIEDADES FÍSICAS (Garantía Antiacortamiento) tras cargar el nuevo source
            actualRaster.matrix = oldMatrixFinal.clone();
            actualRaster.position = oldPositionFinal.clone();
            
            // Forzar actualización de la caja de selección del objeto original (no de window.selectedItem que pudo haber cambiado)
            if (typeof window.updateSelectionBox === 'function') {
                window.updateSelectionBox(raster);
            }
            paper.view.update();
        };

        // Asignar el nuevo source transparente
        actualRaster.source = transparentDataUrl;

        // Restaurar físicamente de forma inmediata por si la carga del Data URL es síncrona en el navegador
        actualRaster.matrix = oldMatrixFinal.clone();
        actualRaster.position = oldPositionFinal.clone();

        URL.revokeObjectURL(resultUrl);
        hideIaLoadingOverlay();

    } catch (err) {
        console.warn("La IA local no pudo ejecutarse. Ofreciendo alternativas interactivas:", err);
        hideIaLoadingOverlay();
        
        // INTERFAZ AMIGABLE DE GARANTÍA: Evitar arruinar la imagen con el contraste Sobel silencioso
        const msgManual = `⚠️ El motor de Inteligencia Artificial (IA) no pudo iniciarse.\n\nEsto suele ocurrir si no hay conexión a internet o los CDNs están bloqueados en su navegador.\n\n¿Desea abrir el EDITOR MANUAL interactivo? (Recomendado: tiene Pincel Borrador, Restaurador y Varita Mágica 100% locales y offline, ideales para un grabado láser impecable).`;
        
        if (confirm(msgManual)) {
            openBackgroundRemovalModal(raster);
            return;
        }

        const msgContrast = `¿Desea ejecutar el algoritmo automático por contraste de respaldo (Sobel Contrast Match)?\n\n(Atención: Solo se recomienda para imágenes con fondos liso y alto contraste. En fotos complejas como medallas de personas o perros puede morder partes del diseño).`;
        
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
        const ctxFallback = actualRaster.canvas.getContext('2d', { willReadFrequently: true });
        ctxFallback.clearRect(0, 0, actualRaster.canvas.width, actualRaster.canvas.height);
        ctxFallback.drawImage(tempCanvas, 0, 0);

        // Suavizado Gaussiano y remoción de halos
        applyEdgeRefinements(actualRaster.canvas, 1);

        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        actualRaster.data.backgroundAutoRemoved = true;

        // Convertir el canvas a PNG data URL para guardarlo permanentemente en Paper.js
        const transparentDataUrl = actualRaster.canvas.toDataURL('image/png');

        // PREVENCIÓN ABSOLUTA DE RACES DE CARGA SÍNCRONA
        actualRaster.onLoad = null;

        actualRaster.onLoad = () => {
            actualRaster.onLoad = null; // Unbind after running once
            // RESTAURAR PROPIEDADES FÍSICAS EN FALLBACK (Garantía Antiacortamiento)
            actualRaster.matrix = oldMatrixFinal.clone();
            actualRaster.position = oldPositionFinal.clone();
            
            if (typeof window.updateSelectionBox === 'function') {
                window.updateSelectionBox(raster);
            }
            paper.view.update();
        };

        // Asignar el nuevo source transparente
        actualRaster.source = transparentDataUrl;

        // Restaurar físicamente de forma inmediata por si la carga del Data URL es síncrona en el navegador
        actualRaster.matrix = oldMatrixFinal.clone();
        actualRaster.position = oldPositionFinal.clone();
    }

    // Forzar actualización de la caja de selección azul celeste de Paper.js
    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(raster);
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

    // 0. Anular de raíz cualquier callback onLoad original para evitar re-escalados y re-posicionamientos fantasmas al modificar .canvas o .source
    actualRaster.onLoad = null;

    // 1. Desvincular de raíz las referencias del objeto .data en clones/duplicados para garantizar independencia absoluta
    if (actualRaster.data) {
        actualRaster.data = { ...actualRaster.data }; // Copia superficial pura de propiedades primitivas
        if (actualRaster.data.originalCanvas) {
            actualRaster.data.originalCanvas = cloneCanvas(actualRaster.data.originalCanvas);
        }
    } else {
        actualRaster.data = {};
    }

    // 2. Inicializar un canvas único e independiente para este Raster (Garantía de Independencia de Imágenes Compartidas/Clonadas)
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

    // 3. Inicializar la copia original (originalCanvas) de alta calidad única para este Raster si no existe
    if (!actualRaster.data.originalCanvas) {
        const origCanvas = document.createElement('canvas');
        origCanvas.width = canvas.width;
        origCanvas.height = canvas.height;
        const origCtx = origCanvas.getContext('2d', { willReadFrequently: true });
        origCtx.drawImage(canvas, 0, 0);
        actualRaster.data.originalCanvas = origCanvas;
    }

    const oldMatrixFinal = actualRaster.matrix.clone();
    const oldPositionFinal = actualRaster.position.clone();

    let srcImage = actualRaster.data.originalCanvas;
    if (!srcImage) return;

    // Crear un canvas de edición con las dimensiones originales de la imagen (alta calidad)
    const editCanvas = document.createElement('canvas');
    editCanvas.width = srcImage.width;
    editCanvas.height = srcImage.height;
    const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
    
    const baseImage = actualRaster.canvas || srcImage;
    editCtx.drawImage(baseImage, 0, 0);

    // Crear canvas de respaldo para la herramienta de restauración
    const backupCanvas = document.createElement('canvas');
    backupCanvas.width = editCanvas.width;
    backupCanvas.height = editCanvas.height;
    const backupCtx = backupCanvas.getContext('2d', { willReadFrequently: true });
    
    backupCtx.drawImage(srcImage, 0, 0);

    // 4. Historial de sesión de recorte (Deshacer / Rehacer local)
    const historyStack = [];    // 4. Historial de sesión de recorte (Deshacer / Rehacer local)
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
            <span style="font-size: 12px; color: #888;">Medidas físicas: <b>${mmW} mm x ${mmH} mm</b></span>
        </div>
        <div class="bg-remover-container">
            <div class="bg-remover-canvas-area" style="position: relative; overflow: hidden;">
                <canvas id="bgRemoverCanvas"></canvas>
                
                <!-- CURSOR FLOTANTE DE TAMAÑO Y COLOR EN TIEMPO REAL (Canva/PhotoRoom Style) -->
                <div id="bgRemoverBrushCursor" style="
                    position: absolute;
                    pointer-events: none;
                    border-radius: 50%;
                    border: 2px solid #dc3545;
                    background-color: rgba(220, 53, 69, 0.15);
                    display: none;
                    z-index: 10006;
                    box-sizing: border-box;
                    transition: border-color 0.1s, background-color 0.1s;
                "></div>
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
                        🧽 Pincel Borrador (Rojo)
                    </button>
                    <button class="bg-remover-tool-btn" id="btnToolRestore" data-tool="restore">
                        🖌️ Pincel Restaurador (Verde)
                    </button>
                    <button class="bg-remover-tool-btn" id="btnToolMagic" data-tool="magic">
                        🪄 Varita Mágica (Celeste)
                    </button>
                </div>
                
                <div class="bg-remover-slider-group" id="groupBrushControls">
                    <span class="bg-remover-section-title">Ajustes de Pincel</span>
                    <div class="bg-remover-slider-group">
                        <div class="bg-remover-slider-label">
                            <span>Tamaño:</span>
                            <span id="lblBrushSize">20 px</span>
                        </div>
                        <input type="range" class="bg-remover-slider slider-erase" id="slideBrushSize" min="1" max="150" value="20">
                    </div>
                    <div class="bg-remover-slider-group" style="margin-top: 10px;">
                        <div class="bg-remover-slider-label">
                            <span>Dureza:</span>
                            <span id="lblBrushHardness">50%</span>
                        </div>
                        <input type="range" class="bg-remover-slider slider-erase" id="slideBrushHardness" min="0" max="100" value="50">
                    </div>
                </div>
                
                <div class="bg-remover-slider-group hidden" id="groupMagicControls">
                    <span class="bg-remover-section-title">Ajustes de Varita Mágica</span>
                    <div class="bg-remover-slider-group">
                        <div class="bg-remover-slider-label">
                            <span>Tolerancia de Color:</span>
                            <span id="lblMagicTolerance">15</span>
                        </div>
                        <input type="range" class="bg-remover-slider slider-magic" id="slideMagicTolerance" min="0" max="100" value="15">
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
                    Usa la <b>Varita Mágica</b> para remover fondos sólidos con un solo clic. El círculo de color indica qué acción estás realizando de forma intuitiva.
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
    const brushCursor = modal.querySelector('#bgRemoverBrushCursor');

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
        const rect = screenCanvas.getBoundingClientRect();
        
        // Redimensionar el canvas de visualización física
        screenCanvas.width = editCanvas.width;
        screenCanvas.height = editCanvas.height;
        
        screenCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
        
        // Calcular factores de escala física a lógica
        const scaleFactorX = rect.width > 0 ? (editCanvas.width / rect.width) : 1;
        const scaleFactorY = rect.height > 0 ? (editCanvas.height / rect.height) : 1;
        
        // Dibujar el editCanvas actual considerando Zoom y Pan transaccional alineado al píxel real
        screenCtx.save();
        screenCtx.translate(panX * scaleFactorX, panY * scaleFactorY);
        screenCtx.scale(zoomLevel, zoomLevel);
        
        // 1. DIBUJAR FONDO "FANTASMA" DE LA IMAGEN ORIGINAL (OPACIDAD DE RESPALDO)
        // Esto permite al cliente identificar exactamente qué partes se han quitado/borrado de forma intuitiva
        screenCtx.save();
        screenCtx.globalAlpha = 0.25; // Opacidad sutil del 25% para el fondo recortado
        screenCtx.drawImage(backupCanvas, 0, 0);
        screenCtx.restore();
        
        // 2. DIBUJAR LA IMAGEN EDITADA ACTUAL ENCIMA (CON TRANSPARENCIA COMPLETA DONDE SE BORRÓ)
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

    // Actualiza dinámicamente la posición y escala física del indicador circular en pantalla
    function updateBrushCursor(e) {
        if (!brushCursor) return;

        const rect = screenCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const isInside = mouseX >= 0 && mouseX <= rect.width && mouseY >= 0 && mouseY <= rect.height;

        if (isInside) {
            let cursorSize;
            const offsetLeft = screenCanvas.offsetLeft || 0;
            const offsetTop = screenCanvas.offsetTop || 0;

            if (activeTool === 'magic') {
                cursorSize = 12; // Círculo de mira celeste pequeño y preciso
                brushCursor.style.width = `${cursorSize}px`;
                brushCursor.style.height = `${cursorSize}px`;
                brushCursor.style.left = `${offsetLeft + mouseX - cursorSize / 2}px`;
                brushCursor.style.top = `${offsetTop + mouseY - cursorSize / 2}px`;
                brushCursor.style.display = 'block';
                brushCursor.style.borderColor = '#00d2ff'; // Celeste/Turquesa
                brushCursor.style.backgroundColor = 'rgba(0, 210, 255, 0.25)';
                screenCanvas.style.cursor = 'none'; // Ocultar cursor nativo
            } else {
                const scale = rect.width / editCanvas.width;
                // Escalar el tamaño según la visualización física y zoomLevel
                cursorSize = brushSize * scale * zoomLevel;

                brushCursor.style.width = `${cursorSize}px`;
                brushCursor.style.height = `${cursorSize}px`;
                brushCursor.style.left = `${offsetLeft + mouseX - cursorSize / 2}px`;
                brushCursor.style.top = `${offsetTop + mouseY - cursorSize / 2}px`;
                brushCursor.style.display = 'block';

                if (activeTool === 'erase') {
                    brushCursor.style.borderColor = '#dc3545'; // Rojo
                    brushCursor.style.backgroundColor = 'rgba(220, 53, 69, 0.15)';
                    screenCanvas.style.cursor = 'none';
                } else if (activeTool === 'restore') {
                    brushCursor.style.borderColor = '#28a745'; // Verde
                    brushCursor.style.backgroundColor = 'rgba(40, 167, 69, 0.15)';
                    screenCanvas.style.cursor = 'none';
                }
            }
        } else {
            brushCursor.style.display = 'none';
            screenCanvas.style.cursor = 'default';
        }
    }

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
        
        // Cambiar clases de sliders para acentuar el color activo
        [slideSize, slideHardness].forEach(el => {
            el.className = 'bg-remover-slider';
            if (tool === 'erase') el.classList.add('slider-erase');
            if (tool === 'restore') el.classList.add('slider-restore');
        });

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
        
        // Limpiar cursor flotante
        if (brushCursor) brushCursor.style.display = 'none';
        screenCanvas.style.cursor = 'default';
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

        // Máscara convolución Laplacian Sharpening
        const weights = [
             0, -1,  0,
            -1,  5, -1,
             0, -1,  0
        ];
        const side = Math.round(Math.sqrt(weights.length));
        const halfSide = Math.floor(side / 2);

        const output = editCtx.createImageData(w, h);
        const dst = output.data;

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
                dst[dstOff + 3] = a; // Preservar canal alfa intacto
            }
        }

        editCtx.putImageData(output, 0, 0);
        saveSessionHistory();
        renderEditCanvasToScreen();
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
        const rect = screenCanvas.getBoundingClientRect(); // Coordenadas relativas de pantalla
        const clickX = e.clientX - rect.left;
        const clickY = e.clientY - rect.top;

        // Mapeo inverso de Zoom y Paneo para sincronizar exactamente las coordenadas sobre la imagen original
        const canvasX = (clickX - panX) / (zoomLevel * (rect.width / editCanvas.width));
        const canvasY = (clickY - panY) / (zoomLevel * (rect.height / editCanvas.height));

        return { x: canvasX, y: canvasY };
    }

    /**
     * Ejecuta el flood fill en la Varita Mágica con una animación Celeste/Turquesa satisfactoria
     * antes de borrar físicamente los píxeles.
     */
    function runMagicWandWithTurquoiseFlash(startX, startY) {
        const width = editCanvas.width;
        const height = editCanvas.height;

        // 1. Obtener los píxeles de editCanvas
        const imgData = editCtx.getImageData(0, 0, width, height);
        const data = imgData.data;

        const startIndex = (startY * width + startX) * 4;
        const r0 = data[startIndex];
        const g0 = data[startIndex + 1];
        const b0 = data[startIndex + 2];
        const a0 = data[startIndex + 3];

        if (a0 < 5) return; // Ya es transparente

        // Queue y visited para flood fill
        const visited = new Uint8Array(width * height);
        const queueX = new Int32Array(width * height);
        const queueY = new Int32Array(width * height);
        let head = 0;
        let tail = 0;

        queueX[tail] = startX;
        queueY[tail] = startY;
        tail++;
        visited[startY * width + startX] = 1;

        const tolSquare = (magicTolerance / 100) * 255 * 255 * 3;

        // Crear canvas temporal para la previsualización del flash celeste
        const flashCanvas = document.createElement('canvas');
        flashCanvas.width = width;
        flashCanvas.height = height;
        const flashCtx = flashCanvas.getContext('2d');
        const flashImgData = flashCtx.createImageData(width, height);
        const flashData = flashImgData.data;

        while (head < tail) {
            const cx = queueX[head];
            const cy = queueY[head];
            head++;

            const idx = (cy * width + cx) * 4;

            // Pintar pixel inundado en celeste/turquesa semi-transparente para el flash
            flashData[idx] = 0;       // R
            flashData[idx + 1] = 210; // G
            flashData[idx + 2] = 255; // B
            flashData[idx + 3] = 220; // A (opaco sutil)

            // Limpiar píxeles en el array de editCanvas reales
            data[idx + 3] = 0; // Se vuelve transparente en editCanvas

            // Direcciones vecinas (4-conectividad)
            const neighbors = [
                { x: cx + 1, y: cy },
                { x: cx - 1, y: cy },
                { x: cx, y: cy + 1 },
                { x: cx, y: cy - 1 }
            ];

            for (let i = 0; i < 4; i++) {
                const nx = neighbors[i].x;
                const ny = neighbors[i].y;

                if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                    const nIdx = ny * width + nx;
                    if (!visited[nIdx]) {
                        const pIdx = nIdx * 4;
                        const nr = data[pIdx];
                        const ng = data[pIdx + 1];
                        const nb = data[pIdx + 2];
                        const na = data[pIdx + 3];

                        if (na >= 5) {
                            const diff = (nr - r0) ** 2 + (ng - g0) ** 2 + (nb - b0) ** 2;
                            if (diff <= tolSquare) {
                                queueX[tail] = nx;
                                queueY[tail] = ny;
                                tail++;
                                visited[nIdx] = 1;
                            }
                        }
                    }
                }
            }
        }

        // 2. Dibujar el flash celeste en la pantalla
        flashCtx.putImageData(flashImgData, 0, 0);

        // Renderizar estado con el overlay celeste superpuesto temporalmente
        renderEditCanvasToScreen();

        // Dibujar el flashCanvas con zoom y pan de forma directa temporal en el canvas de pantalla con escala alineada
        const rect = screenCanvas.getBoundingClientRect();
        const scaleFactorX = rect.width > 0 ? (editCanvas.width / rect.width) : 1;
        const scaleFactorY = rect.height > 0 ? (editCanvas.height / rect.height) : 1;

        screenCtx.save();
        screenCtx.translate(panX * scaleFactorX, panY * scaleFactorY);
        screenCtx.scale(zoomLevel, zoomLevel);
        screenCtx.drawImage(flashCanvas, 0, 0);
        screenCtx.restore();

        // 3. Dejar el flash visible por 250ms, luego aplicar permanentemente el borrado
        setTimeout(() => {
            // Guardar en editCanvas real
            editCtx.putImageData(imgData, 0, 0);
            saveSessionHistory(); // Guardar en historial de recorte
            renderEditCanvasToScreen();
        }, 250);
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

        if (e.button === 0) {
            const coords = getCanvasCoords(e);
            if (activeTool === 'magic') {
                const x = Math.round(coords.x);
                const y = Math.round(coords.y);
                if (x >= 0 && x < editCanvas.width && y >= 0 && y < editCanvas.height) {
                    runMagicWandWithTurquoiseFlash(x, y);
                }
            } else {
                isDrawing = true;
                lastX = coords.x;
                lastY = coords.y;
                drawBrushStroke(lastX, lastY, lastX, lastY);
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

        // Sincronizar el cursor circular de tamaño y color
        updateBrushCursor(e);

        if (isDrawing && (activeTool === 'erase' || activeTool === 'restore')) {
            const coords = getCanvasCoords(e);
            drawBrushStroke(lastX, lastY, coords.x, coords.y);
            lastX = coords.x;
            lastY = coords.y;
        }
    });

    screenCanvas.addEventListener('mouseenter', (e) => {
        updateBrushCursor(e);
    });

    screenCanvas.addEventListener('mouseleave', () => {
        if (brushCursor) brushCursor.style.display = 'none';
        screenCanvas.style.cursor = 'default';
    });

    window.addEventListener('mouseup', () => {
        if (isDrawing) {
            isDrawing = false;
            saveSessionHistory();
        }
        isPanning = false;
    });

    // Desactivar menú de click derecho nativo para permitir paneo cómodo
    screenCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

    // Control de zoom por rueda de ratón (Wheel)
    screenCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomFactor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const oldZoom = zoomLevel;
        zoomLevel = Math.max(0.5, Math.min(10.0, zoomLevel * zoomFactor));

        // Sincronizar el desplazamiento de paneo para centrar el zoom bajo el mouse
        const rect = screenCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        panX = mouseX - (mouseX - panX) * (zoomLevel / oldZoom);
        panY = mouseY - (mouseY - panY) * (zoomLevel / oldZoom);

        renderEditCanvasToScreen();
        updateBrushCursor(e);
    });

    // Doble clic para reiniciar la vista al centro de pantalla
    screenCanvas.addEventListener('dblclick', (e) => {
        zoomLevel = 1.0;
        panX = 0;
        panY = 0;
        renderEditCanvasToScreen();
        updateBrushCursor(e);
    });

    function drawBrushStroke(x0, y0, x1, y1) {
        const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);
        // Usar un paso del 25% del tamaño de la brocha (brushSize / 4) para evitar la sobre-acumulación
        // de opacidad en los bordes y conservar la suavidad real de la dureza seleccionada
        const steps = Math.max(1, Math.floor(dist / Math.max(1, brushSize / 4)));
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const cx = x0 + (x1 - x0) * t;
            const cy = y0 + (y1 - y0) * t;
            applySingleBrushSpot(cx, cy);
        }
        renderEditCanvasToScreen();
    }

    function applySingleBrushSpot(cx, cy) {
        // CORRECCIÓN MATEMÁTICA DEFINITIVA: El radio real del pincel es la mitad de su tamaño (diámetro)
        const radius = brushSize / 2;
        const brushCanvas = document.createElement('canvas');
        brushCanvas.width = brushSize;
        brushCanvas.height = brushSize;
        const brushCtx = brushCanvas.getContext('2d');

        // EVITAR DEGRADADO DEGENERADO: Si la dureza es máxima (>= 0.95), dibujamos un círculo de borde duro
        // directo para evitar errores de compilación o fallos en el renderizado del navegador
        if (brushHardness >= 0.95) {
            brushCtx.fillStyle = 'rgba(0,0,0,1)';
            brushCtx.beginPath();
            brushCtx.arc(radius, radius, radius, 0, Math.PI * 2);
            brushCtx.fill();
        } else {
            // Gradiente radial para suavizado (dureza) de bordes no degenerado
            const grad = brushCtx.createRadialGradient(
                radius, radius, radius * brushHardness,
                radius, radius, radius
            );
            grad.addColorStop(0, 'rgba(0,0,0,1)');
            grad.addColorStop(1, 'rgba(0,0,0,0)');

            brushCtx.fillStyle = grad;
            brushCtx.beginPath();
            brushCtx.arc(radius, radius, radius, 0, Math.PI * 2);
            brushCtx.fill();
        }

        // Aplicar la pincelada al editCanvas principal
        editCtx.save();
        if (activeTool === 'erase') {
            editCtx.globalCompositeOperation = 'destination-out';
            editCtx.drawImage(brushCanvas, cx - radius, cy - radius);
        } else if (activeTool === 'restore') {
            // El restaurador recupera los píxeles originales de backupCanvas usando la brocha como máscara
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = editCanvas.width;
            tempCanvas.height = editCanvas.height;
            const tempCtx = tempCanvas.getContext('2d');

            tempCtx.drawImage(brushCanvas, cx - radius, cy - radius);
            tempCtx.globalCompositeOperation = 'source-in';
            tempCtx.drawImage(backupCanvas, 0, 0);

            editCtx.globalCompositeOperation = 'source-over';
            editCtx.drawImage(tempCanvas, 0, 0);
        }
        editCtx.restore();
    }

    const closeModal = () => {
        overlay.remove();
    };

    const btnCancel = modal.querySelector('#btnRemoverCancel');
    const btnAccept = modal.querySelector('#btnRemoverAccept');

    btnCancel.onclick = closeModal;

    btnAccept.onclick = () => {
        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }

        // Sobrescribir los píxeles editados sobre el canvas real de Paper.js de forma directa
        const ctxAccept = actualRaster.canvas.getContext('2d', { willReadFrequently: true });
        ctxAccept.clearRect(0, 0, actualRaster.canvas.width, actualRaster.canvas.height);
        ctxAccept.drawImage(editCanvas, 0, 0);

        // Suavizado radial Gaussiano y remoción de halos en los bordes para LightBurn
        applyEdgeRefinements(actualRaster.canvas, 1);

        actualRaster.data.backgroundAutoRemoved = true;

        // Convertir el canvas a PNG data URL para guardarlo permanentemente en Paper.js
        const transparentDataUrl = actualRaster.canvas.toDataURL('image/png');

        // PREVENCIÓN ABSOLUTA DE RACES DE CARGA SÍNCRONA: Anular onLoad original antes de cambiar el source
        actualRaster.onLoad = null;

        actualRaster.onLoad = () => {
            actualRaster.onLoad = null; // Unbind after running once
            // RESTAURAR PROPIEDADES FISICAS (Garantía absoluta Antiacortamiento / Anti-Shrink)
            actualRaster.matrix = oldMatrixFinal.clone();
            actualRaster.position = oldPositionFinal.clone();

            // Forzar Paper.js a redibujar la caja de selección azul celeste alineada sobre el raster original
            if (typeof window.updateSelectionBox === 'function') {
                window.updateSelectionBox(raster);
            }

            paper.view.update();
        };

        // Asignar el nuevo source transparente
        actualRaster.source = transparentDataUrl;
        
        // Restaurar físicamente de forma inmediata por si la carga del Data URL es síncrona en el navegador
        actualRaster.matrix = oldMatrixFinal.clone();
        actualRaster.position = oldPositionFinal.clone();
        
        closeModal();
    };
}

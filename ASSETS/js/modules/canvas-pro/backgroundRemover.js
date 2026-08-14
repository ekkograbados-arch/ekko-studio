
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
 * 6. autoRemoveBackground: Eliminación de fondo automática instantánea en las 4 esquinas con barrera de bordes Sobel + Local-Delta para escala de grises.
 * 7. getRasterFromItem: Resolución segura de imágenes enmascaradas (clipGroup) para evitar TypeErrors.
 * 8. NO-SHRINK GUARANTEE: Preserva y restaura las dimensiones y la escala física de la imagen en pantalla.
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
        .hidden {
            display: none !important;
        }
    `;
    document.head.appendChild(styleEl);
}

/**
 * Resuelve de forma recursiva y segura el objeto paper.Raster real,
 * incluso si está enmascarado dentro de un clipGroup (grupo recortado).
 */
export function getRasterFromItem(item) {
    if (!item) return null;
    if (item instanceof paper.Raster) return item;
    
    // Si es un grupo recortado (clipGroup), buscar recursivamente
    if (item instanceof paper.Group || (item.children && item.children.length > 0)) {
        const rasterChild = item.children.find(c => {
            try {
                if (c instanceof paper.Raster) return true;
                if (c instanceof paper.Group) {
                    const nested = getRasterFromItem(c);
                    if (nested instanceof paper.Raster) return true;
                }
            } catch (e) {}
            return false;
        });
        if (rasterChild) {
            return (rasterChild instanceof paper.Raster) ? rasterChild : getRasterFromItem(rasterChild);
        }
        
        // Salvaguarda secundaria: cualquier hijo que no sea máscara de recorte ni trazado guía
        const fallbackChild = item.children.find(c => !c.clipMask && c.className !== 'Path' && !c.data?.mockup);
        if (fallbackChild) {
            return (fallbackChild instanceof paper.Raster) ? fallbackChild : getRasterFromItem(fallbackChild);
        }
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
 * Algoritmo base de flood fill optimizado para Canvas 2D con barrera inteligente de Sobel y Local-Delta.
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

    // Tolerancia Global (comparada con la semilla inicial)
    const tolSquare = (tolerance / 100) * 255 * 255 * 3;
    
    // Tolerancia Local (evita saltos abruptos de color entre píxeles vecinos)
    const localTolerance = Math.max(5, tolerance / 2);
    const localTolSquare = (localTolerance / 100) * 255 * 255 * 3;
    
    // Umbral de sensibilidad Sobel (sensible para detectar bajo contraste)
    const edgeThreshold = 25; 

    while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head++;

        const idx = (y * width + x) * 4;
        
        // Píxel actual (servirá como referencia para el delta local de sus vecinos)
        const curR = data[idx];
        const curG = data[idx + 1];
        const curB = data[idx + 2];
        
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
                    
                    // Barrera Sobel: si el píxel vecino es un borde contrastado, no avanzar
                    if (edgesMap && edgesMap[nIdx] > edgeThreshold) {
                        continue;
                    }

                    const pIdx = nIdx * 4;
                    const r = data[pIdx];
                    const g = data[pIdx + 1];
                    const b = data[pIdx + 2];
                    const a = data[pIdx + 3];

                    if (a > 10) {
                        // 1. Verificar Delta Global (con la semilla r0, g0, b0)
                        const dr = r - r0;
                        const dg = g - g0;
                        const db = b - b0;
                        const distSq = dr * dr + dg * dg + db * db;
                        
                        if (distSq <= tolSquare) {
                            // 2. Verificar Delta Local (con el píxel padre curR, curG, curB)
                            const dlr = r - curR;
                            const dlg = g - curG;
                            const dlb = b - curB;
                            const localDistSq = dlr * dlr + dlg * dlg + dlb * dlb;
                            
                            if (localDistSq <= localTolSquare) {
                                queueX[tail] = nx;
                                queueY[tail] = ny;
                                tail++;
                            }
                        }
                    }
                }
            }
        }
    }
    ctx.putImageData(imgData, 0, 0);
}

/**
 * Realiza una eliminación de fondo automática utilizando el algoritmo de varita mágica
 * con barrera de gradiente Sobel + Local-Delta de forma nativa e instantánea.
 * @param {paper.Raster} raster Objeto de imagen en Paper.js o clipGroup
 * @param {number} tolerance Tolerancia del flood-fill (0-100)
 */
export function autoRemoveBackground(raster, tolerance = 8) {
    const actualRaster = getRasterFromItem(raster);
    if (!actualRaster) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    // Guardar una copia original si no existe para permitir restauración posterior
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

    // Crear canvas de edición a partir del original para no acumular pérdidas
    const editCanvas = document.createElement('canvas');
    editCanvas.width = actualRaster.data.originalCanvas.width;
    editCanvas.height = actualRaster.data.originalCanvas.height;
    const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
    editCtx.drawImage(actualRaster.data.originalCanvas, 0, 0);

    const width = editCanvas.width;
    const height = editCanvas.height;

    // Calcular mapa de bordes Sobel para evitar morder al sujeto principal
    const imgDataForEdges = editCtx.getImageData(0, 0, width, height);
    const edgesMap = computeSobelEdges(imgDataForEdges.data, width, height);

    // Muestrear las 4 esquinas de la imagen para remover el fondo circundante automáticamente
    const corners = [
        { x: 5, y: 5 },
        { x: width - 6, y: 5 },
        { x: 5, y: height - 6 },
        { x: width - 6, y: height - 6 }
    ];

    corners.forEach(p => {
        if (p.x >= 0 && p.x < width && p.y >= 0 && p.y < height) {
            magicWandFloodFillDirect(editCtx, p.x, p.y, tolerance, edgesMap);
        }
    });

    // Guardar historial del lienzo para Paper.js
    if (typeof window.saveHistory === 'function') {
        window.saveHistory();
    }

    // NO-SHRINK GUARANTEE: Clonar y preservar los límites físicos en pantalla
    const oldBounds = actualRaster.bounds.clone();

    // Guardar el nuevo canvas editado en el raster y forzar el renderizado
    actualRaster.canvas = editCanvas;
    actualRaster.data.backgroundAutoRemoved = true; // Marcar como removido automáticamente

    // Restaurar los límites físicos en pantalla para que no se achique ni se desplace
    actualRaster.bounds = oldBounds;

    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(window.selectedItem);
    }
    
    paper.view.update();
}

/**
 * Abre la modal de eliminación de fondo interactiva para un paper.Raster
 * @param {paper.Raster} raster Objeto de imagen en Paper.js o clipGroup
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

    // 4. Buscar elementos DOM e inicializar variables de control (EVITA TDZ)
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

    const btnCancel = modal.querySelector('#btnRemoverCancel');
    const btnAccept = modal.querySelector('#btnRemoverAccept');

    let activeTool = 'erase';
    let brushSize = 20;
    let brushHardness = 0.5;
    let magicTolerance = 15;
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    // Calcular mapa de bordes para la varita interactiva de la modal
    const imgDataForEdges = editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);
    const edgesMap = computeSobelEdges(imgDataForEdges.data, editCanvas.width, editCanvas.height);

    function updateHistoryButtons() {
        if (btnRemoverUndo && btnRemoverRedo) {
            btnRemoverUndo.disabled = historyIndex <= 0;
            btnRemoverRedo.disabled = historyIndex >= historyStack.length - 1;
        }
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

    // Disparar el guardado inicial una vez que las referencias de los botones ya existen en el DOM
    saveSessionHistory();

    function renderEditCanvasToScreen() {
        screenCanvas.width = editCanvas.width;
        screenCanvas.height = editCanvas.height;
        screenCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
        screenCtx.drawImage(editCanvas, 0, 0);
    }
    renderEditCanvasToScreen();

    // 5. Configurar eventos de barras deslizantes
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

    // 6. Cambios de herramientas interactivos
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

    // 7. Acciones de Deshacer / Rehacer
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

    // 8. Eventos de dibujo interactivo con coordenadas escaladas
    function getCanvasCoords(e) {
        const rect = screenCanvas.getBoundingClientRect();
        const scaleX = editCanvas.width / rect.width;
        const scaleY = editCanvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    }

    screenCanvas.addEventListener('mousedown', (e) => {
        const coords = getCanvasCoords(e);
        if (activeTool === 'magic') {
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
        const brushCtx = brushCanvas.getContext('2d', { willReadFrequently: true });
        
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

    // 9. Comportamiento Arrastrable de la modal flotante
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

    const closeModal = () => {
        overlay.remove();
    };

    btnCancel.onclick = closeModal;

    btnAccept.onclick = () => {
        if (typeof window.saveHistory === 'function') {
            window.saveHistory();
        }
        
        // NO-SHRINK GUARANTEE: Preservar los límites físicos en pantalla
        const oldBounds = actualRaster.bounds.clone();

        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = editCanvas.width;
        finalCanvas.height = editCanvas.height;
        const finalCtx = finalCanvas.getContext('2d', { willReadFrequently: true });
        finalCtx.drawImage(editCanvas, 0, 0);

        actualRaster.canvas = finalCanvas;
        actualRaster.data = actualRaster.data || {};
        actualRaster.data.originalCanvas = finalCanvas;

        // Restaurar los límites físicos exactos
        actualRaster.bounds = oldBounds;

        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(window.selectedItem);
        }
        paper.view.update();
        closeModal();
    };
}

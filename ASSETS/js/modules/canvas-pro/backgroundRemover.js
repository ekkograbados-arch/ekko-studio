/**
 * ASSETS/js/modules/canvas-pro/backgroundRemover.js
 * 
 * Módulo profesional de eliminación de fondo interactivo (PhotoRoom-style) - Versión Final.
 * Ofrece:
 * 1. Pincel borrador (Erase) y restaurador (Restore) con tamaño y dureza (suavizado radial) regulables.
 * 2. Varita mágica (Magic Wand) con algoritmo de inundación (flood-fill) optimizado y tolerancia ajustable.
 * 3. Conservación de calidad extrema (ejecuta los cambios sobre el lienzo de alta resolución de origen).
 * 4. Historial interno de cambios (Deshacer/Rehacer) durante la sesión de recorte.
 * 5. Interfaz de usuario (modal interactiva draggable) con fondo de tablero de ajedrez para previsualizar transparencia.
 * 6. autoRemoveBackground: Eliminación de fondo automática instantánea en las 4 esquinas con barrera de bordes Sobel para escala de grises.
 * 7. getRasterFromItem: Resolución segura de imágenes enmascaradas (clipGroup) de forma recursiva para evitar TypeErrors.
 * 8. Zoom & Pan: Sistema de zoom y paneo interactivo dentro de la modal para edición de precisión.
 * 9. Mejorar Nitidez: Filtro convolucional de máscara de enfoque para aumentar el contraste de los bordes.
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
            background-color: #1a1a1a;
            color: #f3f3f3;
            border: 2px solid #007bff;
            border-radius: 12px;
            padding: 20px;
            width: 1000px;
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
            display: block;
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
        .bg-remover-zoom-indicator {
            position: absolute;
            bottom: 10px;
            left: 10px;
            background-color: rgba(0, 0, 0, 0.7);
            color: #ccc;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 500;
            z-index: 5;
        }
    `;
    document.head.appendChild(styleEl);
}

/**
 * Busca de forma recursiva y segura el primer paper.Raster dentro de un item de Paper.js.
 * Esto evita errores con elementos agrupados o enmascarados como clipGroups.
 */
export function getRasterFromItem(item) {
    if (!item) return null;
    if (item.className === 'Raster') return item;
    if (item instanceof paper.Raster) return item;
    
    // Si es un grupo, buscar recursivamente en sus hijos
    if (item.children && item.children.length > 0) {
        for (let i = 0; i < item.children.length; i++) {
            const found = getRasterFromItem(item.children[i]);
            if (found) return found;
        }
    }
    return null;
}

/**
 * Filtro de Sobel ultrarrápido para escala de grises.
 * Crea un mapa de barrera que la varita mágica no puede cruzar.
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
 * Algoritmo base de flood fill con doble tolerancia local-global y Sobel.
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
    const edgeThreshold = 25; // Sensibilidad de Sobel optimizada

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
                    
                    if (edgesMap && edgesMap[nIdx] > edgeThreshold) {
                        continue; // Parar en el borde
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
                        
                        // Doble protección: tolerancia global con el pixel de origen
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
 * Filtro de enfoque por convolución para aumentar la nitidez de la imagen.
 */
export function sharpenImageData(imageData) {
    const width = imageData.width;
    const height = imageData.height;
    const input = imageData.data;
    const output = new Uint8ClampedArray(input.length);
    
    for (let i = 0; i < input.length; i++) {
        output[i] = input[i];
    }
    
    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            for (let c = 0; c < 3; c++) {
                let sum = 0;
                sum += input[((y - 1) * width + x) * 4 + c] * -1; // Top
                sum += input[(y * width + (x - 1)) * 4 + c] * -1; // Left
                sum += input[(y * width + x) * 4 + c] * 5;        // Center
                sum += input[(y * width + (x + 1)) * 4 + c] * -1; // Right
                sum += input[((y + 1) * width + x) * 4 + c] * -1; // Bottom
                
                const destIdx = (y * width + x) * 4 + c;
                output[destIdx] = Math.max(0, Math.min(255, sum));
            }
        }
    }
    return new ImageData(output, width, height);
}

/**
 * Eliminación de fondo automática a partir de las 4 esquinas.
 * Conserva la escala y dimensiones usando Paper.js Matrix.
 */
export function autoRemoveBackground(raster, tolerance = 8) {
    const actualRaster = getRasterFromItem(raster);
    if (!actualRaster) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

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
            magicWandFloodFillDirect(editCtx, p.x, p.y, tolerance, edgesMap);
        }
    });

    if (typeof window.saveHistory === 'function') {
        window.saveHistory();
    }

    // GARANTÍA ANTISHRIKNK: Clonar la matriz antes de cambiar el canvas para evitar que Paper.js re-ajuste la escala
    const matrixBackup = actualRaster.matrix.clone();
    actualRaster.canvas = editCanvas;
    actualRaster.matrix = matrixBackup; // Restaurar escala y coordenadas intactas
    
    actualRaster.data.backgroundAutoRemoved = true;

    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(window.selectedItem);
    }
    
    paper.view.update();
}

/**
 * Abre la modal de PhotoRoom con soporte para Zoom, Pan, Borrador de precisión e Historial.
 */
export function openBackgroundRemovalModal(raster) {
    const actualRaster = getRasterFromItem(raster);
    if (!actualRaster) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    if (!actualRaster.data) actualRaster.data = {};
    let srcImage = actualRaster.data.originalCanvas || actualRaster.canvas || actualRaster.image;
    if (!srcImage) return;

    const editCanvas = document.createElement('canvas');
    editCanvas.width = srcImage.width || actualRaster.width;
    editCanvas.height = srcImage.height || actualRaster.height;
    const editCtx = editCanvas.getContext('2d', { willReadFrequently: true });
    
    const baseImage = actualRaster.canvas || srcImage;
    editCtx.drawImage(baseImage, 0, 0);

    const backupCanvas = document.createElement('canvas');
    backupCanvas.width = editCanvas.width;
    backupCanvas.height = editCanvas.height;
    const backupCtx = backupCanvas.getContext('2d', { willReadFrequently: true });
    
    const rawOriginal = actualRaster.data.originalCanvas || srcImage;
    backupCtx.drawImage(rawOriginal, 0, 0);

    // Calcular Sobel una sola vez para las varitas del modal
    const imgDataForEdges = backupCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);
    const edgesMap = computeSobelEdges(imgDataForEdges.data, editCanvas.width, editCanvas.height);

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

    const overlay = document.createElement('div');
    overlay.className = 'bg-remover-overlay';

    const modal = document.createElement('div');
    modal.className = 'bg-remover-modal';

    const mmW = actualRaster.bounds.width.toFixed(1);
    const mmH = actualRaster.bounds.height.toFixed(1);

    modal.innerHTML = `
        <div class="bg-remover-header">
            <h3>✂️ Quitar Fondo y Recortar Imagen</h3>
            <span style="font-size: 12px; color: #888;">Medidas físicas: <b>${mmW} mm x ${mmH} mm</b> | Mantén Shift y arrastra para mover vista, rueda mouse para Zoom</span>
        </div>
        <div class="bg-remover-container">
            <div class="bg-remover-canvas-area">
                <canvas id="bgRemoverCanvas"></canvas>
                <div class="bg-remover-zoom-indicator" id="zoomIndicator">Zoom: 100%</div>
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
                    <button class="bg-remover-tool-btn" id="btnToolSharpen" style="background-color: #5a2e5c; margin-top: 10px;">
                        ✨ Mejorar Nitidez
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
                        <input type="range" class="bg-remover-slider" id="slideMagicTolerance" min="1" max="100" value="15">
                    </div>
                </div>
                <div class="bg-remover-info">
                    💡 <b>Tip de Recorte:</b><br>
                    Usa <b>Varita Mágica</b> en fondos planos. Usa <b>Pinceles</b> para pulir detalles de cabellos u objetos. Haz <b>Zoom con la rueda</b> para trabajar píxel a píxel.
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
    const zoomIndicator = modal.querySelector('#zoomIndicator');

    // Zoom & Pan State variables
    let zoom = 1.0;
    let panX = 0;
    let panY = 0;
    let isPanning = false;
    let startPanX = 0;
    let startPanY = 0;

    // Calcular zoom por defecto para encajar la imagen en la pantalla de la modal
    function resetView() {
        const container = screenCanvas.parentElement;
        const cw = container.clientWidth || 600;
        const ch = container.clientHeight || 450;
        zoom = Math.min(cw / editCanvas.width, ch / editCanvas.height) * 0.9;
        panX = 0;
        panY = 0;
    }
    resetView();

    function renderEditCanvasToScreen() {
        const container = screenCanvas.parentElement;
        screenCanvas.width = container.clientWidth || 680;
        screenCanvas.height = container.clientHeight || 480;
        
        screenCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
        screenCtx.save();
        
        // Aplicar paneo y escala
        screenCtx.translate(screenCanvas.width / 2 + panX, screenCanvas.height / 2 + panY);
        screenCtx.scale(zoom, zoom);
        
        // Dibujar editCanvas centrado
        screenCtx.drawImage(editCanvas, -editCanvas.width / 2, -editCanvas.height / 2);
        
        screenCtx.restore();
        zoomIndicator.textContent = `Zoom: ${Math.round(zoom * 100)}%`;
    }
    
    // Disparar render inicial
    setTimeout(renderEditCanvasToScreen, 50);

    let activeTool = 'erase';
    let brushSize = 20;
    let brushHardness = 0.5;
    let magicTolerance = 15;
    let isDrawing = false;
    let lastX = 0;
    let lastY = 0;

    const btnRemoverUndo = modal.querySelector('#btnRemoverUndo');
    const btnRemoverRedo = modal.querySelector('#btnRemoverRedo');

    function updateHistoryButtons() {
        if (btnRemoverUndo) btnRemoverUndo.disabled = historyIndex <= 0;
        if (btnRemoverRedo) btnRemoverRedo.disabled = historyIndex >= historyStack.length - 1;
    }

    // Inicializar el primer estado en el historial una vez definidos los botones
    saveSessionHistory();

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
    const btnToolSharpen = modal.querySelector('#btnToolSharpen');
    
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
    
    btnToolSharpen.onclick = () => {
        const currentData = editCtx.getImageData(0, 0, editCanvas.width, editCanvas.height);
        const sharpened = sharpenImageData(currentData);
        editCtx.putImageData(sharpened, 0, 0);
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

    // Mapeo inverso de coordenadas considerando paneo, escala y centrado
    function getCanvasCoords(e) {
        const rect = screenCanvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const localX = (mouseX - screenCanvas.width / 2 - panX) / zoom;
        const localY = (mouseY - screenCanvas.height / 2 - panY) / zoom;
        
        return {
            x: localX + editCanvas.width / 2,
            y: localY + editCanvas.height / 2
        };
    }

    // Zoom interactivo centrado en la posición del mouse
    screenCanvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const coordsBefore = getCanvasCoords(e);
        
        if (e.deltaY < 0) {
            zoom = Math.min(20, zoom * 1.15);
        } else {
            zoom = Math.max(0.05, zoom / 1.15);
        }
        
        const coordsAfter = getCanvasCoords(e);
        panX += (coordsAfter.x - coordsBefore.x) * zoom;
        panY += (coordsAfter.y - coordsBefore.y) * zoom;
        
        renderEditCanvasToScreen();
    });

    screenCanvas.addEventListener('mousedown', (e) => {
        // Activar paneo con click derecho (2), click central (1), o manteniendo Shift presionado
        if (e.button === 1 || e.button === 2 || e.shiftKey) {
            isPanning = true;
            startPanX = e.clientX - panX;
            startPanY = e.clientY - panY;
            e.preventDefault();
            return;
        }

        if (e.button !== 0) return; // Solo click izquierdo para dibujar

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
        if (isPanning) {
            isPanning = false;
        }
        if (isDrawing) {
            isDrawing = false;
            saveSessionHistory();
        }
    });

    // Desactivar menú contextual en el lienzo para permitir click derecho de paneo libre
    screenCanvas.addEventListener('contextmenu', e => e.preventDefault());

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

        // GARANTÍA ANTISHRIKNK: Clonar la matriz antes de cambiar el canvas para evitar que Paper.js re-ajuste la escala
        const matrixBackup = actualRaster.matrix.clone();
        actualRaster.canvas = finalCanvas;
        actualRaster.matrix = matrixBackup; // Restaurar dimensiones exactas sin acortamiento

        actualRaster.data = actualRaster.data || {};
        actualRaster.data.originalCanvas = finalCanvas;

        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(window.selectedItem);
        }
        paper.view.update();
        closeModal();
    };
}

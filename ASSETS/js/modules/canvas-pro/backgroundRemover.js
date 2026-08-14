
/**
 * ASSETS/js/modules/canvas-pro/backgroundRemover.js
 * 
 * Módulo profesional de eliminación de fondo interactivo (PhotoRoom-style) - Versión 2.
 * Ofrece:
 * 1. Pincel borrador (Erase) y restaurador (Restore) con tamaño y dureza (suavizado radial) regulables.
 * 2. Varita mágica (Magic Wand) con algoritmo de inundación (flood-fill) optimizado y tolerancia ajustable.
 * 3. Conservación de calidad extrema (ejecuta los cambios sobre el lienzo de alta resolución de origen).
 * 4. Historial interno de cambios (Deshacer/Rehacer) durante la sesión de recorte.
 * 5. Interfaz de usuario (modal interactiva draggable) con fondo de tablero de ajedrez para previsualizar transparencia.
 * 6. [NUEVO] autoRemoveBackground: Eliminación de fondo automática instantánea en las 4 esquinas.
 */

// Estilos CSS dinámicos para la modal del eliminador de fondo
const removeBgStylesId = 'background-remover-pro-styles';
if (!document.getElementById(removeBgStylesId)) {
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

/**
 * Algoritmo base de flood fill optimizado para Canvas 2D.
 */
export function magicWandFloodFillDirect(ctx, startX, startY, tolerance) {
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

    while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head++;

        const idx = (y * width + x) * 4;
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
 * Realiza una eliminación de fondo automática utilizando el algoritmo de varita mágica
 * sobre las 4 esquinas de la imagen de forma nativa e instantánea.
 * @param {paper.Raster} raster Objeto de imagen en Paper.js
 * @param {number} tolerance Tolerancia del flood-fill (0-100)
 */
export function autoRemoveBackground(raster, tolerance = 15) {
    if (!raster || !(raster instanceof paper.Raster)) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    // Guardar una copia original si no existe para permitir restauración posterior
    if (!raster.data) raster.data = {};
    let srcImage = raster.canvas || raster.image;
    if (!srcImage) return;

    if (!raster.data.originalCanvas) {
        const origCanvas = document.createElement('canvas');
        origCanvas.width = srcImage.width || raster.width;
        origCanvas.height = srcImage.height || raster.height;
        const origCtx = origCanvas.getContext('2d');
        origCtx.drawImage(srcImage, 0, 0);
        raster.data.originalCanvas = origCanvas;
    }

    // Crear canvas de edición a partir del original para no acumular pérdidas
    const editCanvas = document.createElement('canvas');
    editCanvas.width = raster.data.originalCanvas.width;
    editCanvas.height = raster.data.originalCanvas.height;
    const editCtx = editCanvas.getContext('2d');
    editCtx.drawImage(raster.data.originalCanvas, 0, 0);

    const width = editCanvas.width;
    const height = editCanvas.height;

    // Muestrear las 4 esquinas de la imagen para remover el fondo circundante automáticamente
    const corners = [
        { x: 5, y: 5 },
        { x: width - 6, y: 5 },
        { x: 5, y: height - 6 },
        { x: width - 6, y: height - 6 }
    ];

    corners.forEach(p => {
        if (p.x >= 0 && p.x < width && p.y >= 0 && p.y < height) {
            magicWandFloodFillDirect(editCtx, p.x, p.y, tolerance);
        }
    });

    // Guardar historial del lienzo para Paper.js
    if (typeof window.saveHistory === 'function') {
        window.saveHistory();
    }

    // Guardar el nuevo canvas editado en el raster y forzar el renderizado
    raster.canvas = editCanvas;
    raster.data.backgroundAutoRemoved = true; // Marcar como removido automáticamente

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
    if (!raster || !(raster instanceof paper.Raster)) {
        alert("Por favor, seleccione una imagen válida.");
        return;
    }

    // 1. Obtener la fuente de píxeles original (alta resolución)
    if (!raster.data) raster.data = {};
    let srcImage = raster.data.originalCanvas || raster.canvas || raster.image;
    if (!srcImage) return;

    // Crear un canvas de edición con las dimensiones originales de la imagen (alta calidad)
    const editCanvas = document.createElement('canvas');
    editCanvas.width = srcImage.width || raster.width;
    editCanvas.height = srcImage.height || raster.height;
    const editCtx = editCanvas.getContext('2d');
    // Si ya tiene un canvas editado (por ej: el auto-removido), usar ese como base
    const baseImage = raster.canvas || srcImage;
    editCtx.drawImage(baseImage, 0, 0);

    // Crear canvas de respaldo para la herramienta de restauración
    const backupCanvas = document.createElement('canvas');
    backupCanvas.width = editCanvas.width;
    backupCanvas.height = editCanvas.height;
    const backupCtx = backupCanvas.getContext('2d');
    
    // El respaldo SIEMPRE debe ser la imagen 100% original con fondo (de la propiedad originalCanvas o de la imagen original)
    const rawOriginal = raster.data.originalCanvas || srcImage;
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

    saveSessionHistory();

    // 3. Crear Estructura de la Modal Interactiva
    const overlay = document.createElement('div');
    overlay.className = 'bg-remover-overlay';

    const modal = document.createElement('div');
    modal.className = 'bg-remover-modal';

    const mmW = raster.bounds.width.toFixed(1);
    const mmH = raster.bounds.height.toFixed(1);

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

    const screenCanvas = modal.querySelector('#bgRemoverCanvas');
    const screenCtx = screenCanvas.getContext('2d');

    function renderEditCanvasToScreen() {
        screenCanvas.width = editCanvas.width;
        screenCanvas.height = editCanvas.height;
        screenCtx.clearRect(0, 0, screenCanvas.width, screenCanvas.height);
        screenCtx.drawImage(editCanvas, 0, 0);
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

    const btnRemoverUndo = modal.querySelector('#btnRemoverUndo');
    const btnRemoverRedo = modal.querySelector('#btnRemoverRedo');

    function updateHistoryButtons() {
        btnRemoverUndo.disabled = historyIndex <= 0;
        btnRemoverRedo.disabled = historyIndex >= historyStack.length - 1;
    }

    btnRemoverUndo.onclick = () => {
        if (historyIndex > 0) {
            historyIndex--;
            editCtx.putImageData(historyStack[historyIndex], 0, 0);
            renderEditCanvasToScreen();
            updateHistoryButtons();
        }\n    };\n\n    btnRemoverRedo.onclick = () => {\n        if (historyIndex < historyStack.length - 1) {\n            historyIndex++;\n            editCtx.putImageData(historyStack[historyIndex], 0, 0);\n            renderEditCanvasToScreen();\n            updateHistoryButtons();\n        }\n    };\n\n    function getCanvasCoords(e) {\n        const rect = screenCanvas.getBoundingClientRect();\n        const scaleX = editCanvas.width / rect.width;\n        const scaleY = editCanvas.height / rect.height;\n        return {\n            x: (e.clientX - rect.left) * scaleX,\n            y: (e.clientY - rect.top) * scaleY\n        };\n    }\n\n    screenCanvas.addEventListener('mousedown', (e) => {\n        const coords = getCanvasCoords(e);\n        if (activeTool === 'magic') {\n            magicWandFloodFillDirect(editCtx, Math.round(coords.x), Math.round(coords.y), magicTolerance);\n            renderEditCanvasToScreen();\n            saveSessionHistory();\n        } else {\n            isDrawing = true;\n            lastX = coords.x;\n            lastY = coords.y;\n            drawBrushStroke(coords.x, coords.y, coords.x, coords.y);\n        }\n    });\n\n    screenCanvas.addEventListener('mousemove', (e) => {\n        if (!isDrawing) return;\n        const coords = getCanvasCoords(e);\n        drawBrushStroke(lastX, lastY, coords.x, coords.y);\n        lastX = coords.x;\n        lastY = coords.y;\n    });\n\n    window.addEventListener('mouseup', () => {\n        if (isDrawing) {\n            isDrawing = false;\n            saveSessionHistory();\n        }\n    });\n\n    function drawBrushStroke(x0, y0, x1, y1) {\n        const dist = Math.sqrt((x1 - x0) ** 2 + (y1 - y0) ** 2);\n        const steps = Math.max(1, Math.floor(dist / (brushSize / 8)));\n        for (let i = 0; i <= steps; i++) {\n            const t = i / steps;\n            const cx = x0 + (x1 - x0) * t;\n            const cy = y0 + (y1 - y0) * t;\n            applySingleBrushSpot(cx, cy);\n        }\n        renderEditCanvasToScreen();\n    }\n\n    function applySingleBrushSpot(cx, cy) {\n        const radius = brushSize;\n        const brushCanvas = document.createElement('canvas');\n        brushCanvas.width = radius * 2;\n        brushCanvas.height = radius * 2;\n        const brushCtx = brushCanvas.getContext('2d');\n        const grad = brushCtx.createRadialGradient(radius, radius, radius * brushHardness, radius, radius, radius);\n        grad.addColorStop(0, 'rgba(0,0,0,1)');\n        grad.addColorStop(1, 'rgba(0,0,0,0)');\n        brushCtx.fillStyle = grad;\n        brushCtx.beginPath();\n        brushCtx.arc(radius, radius, radius, 0, Math.PI * 2);\n        brushCtx.fill();\n\n        if (activeTool === 'erase') {\n            editCtx.save();\n            editCtx.globalCompositeOperation = 'destination-out';\n            editCtx.drawImage(brushCanvas, cx - radius, cy - radius);\n            editCtx.restore();\n        } else if (activeTool === 'restore') {\n            brushCtx.save();\n            brushCtx.globalCompositeOperation = 'source-in';\n            brushCtx.drawImage(backupCanvas, cx - radius, cy - radius, radius * 2, radius * 2, 0, 0, radius * 2, radius * 2);\n            brushCtx.restore();\n            editCtx.save();\n            editCtx.globalCompositeOperation = 'source-over';\n            editCtx.drawImage(brushCanvas, cx - radius, cy - radius);\n            editCtx.restore();\n        }\n    }\n\n    const dragHeader = modal.querySelector('.bg-remover-header');\n    let isDraggingModal = false;\n    let startModalX = 0;\n    let startModalY = 0;\n    let initialModalLeft = 0;\n    let initialModalTop = 0;\n\n    dragHeader.addEventListener('mousedown', (e) => {\n        if (e.button !== 0) return;\n        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;\n        isDraggingModal = true;\n        const rect = modal.getBoundingClientRect();\n        startModalX = e.clientX;\n        startModalY = e.clientY;\n        initialModalLeft = rect.left;\n        initialModalTop = rect.top;\n        modal.style.position = 'fixed';\n        modal.style.margin = '0';\n        modal.style.left = initialModalLeft + 'px';\n        modal.style.top = initialModalTop + 'px';\n        e.preventDefault();\n    });\n\n    document.addEventListener('mousemove', (e) => {\n        if (!isDraggingModal) return;\n        const deltaX = e.clientX - startModalX;\n        const deltaY = e.clientY - startModalY;\n        modal.style.left = (initialModalLeft + deltaX) + 'px';\n        modal.style.top = (initialModalTop + deltaY) + 'px';\n    });\n\n    document.addEventListener('mouseup', () => {\n        isDraggingModal = false;\n    });\n\n    const btnCancel = modal.querySelector('#btnRemoverCancel');\n    const btnAccept = modal.querySelector('#btnRemoverAccept');\n\n    const closeModal = () => {\n        overlay.remove();\n    };\n\n    btnCancel.onclick = closeModal;\n\n    btnAccept.onclick = () => {\n        if (typeof window.saveHistory === 'function') {\n            window.saveHistory();\n        }\n        const finalCanvas = document.createElement('canvas');\n        finalCanvas.width = editCanvas.width;\n        finalCanvas.height = editCanvas.height;\n        const finalCtx = finalCanvas.getContext('2d');\n        finalCtx.drawImage(editCanvas, 0, 0);\n\n        raster.canvas = finalCanvas;\n        raster.data = raster.data || {};\n        raster.data.originalCanvas = finalCanvas;\n\n        if (typeof window.updateSelectionBox === 'function') {\n            window.updateSelectionBox(window.selectedItem);\n        }\n        paper.view.update();\n        closeModal();\n    };\n}\n

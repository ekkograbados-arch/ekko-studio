/**
 * ASSETS/js/modules/canvas-pro/imageTracer.js
 * 
 * Modulo de Vectorizacion (Trazado de Imagen / Trazado de Croquis) y Editor de Nodos Vectoriales
 * al estilo LightBurn para EKKO Studio PRO.
 * 
 * ABSOLUTAMENTE LIBRE DE CONFIGURACIONES DE LÁSER O PARÁMETROS DE CORTE/GRABADO.
 * Centrado exclusivamente en el diseno grafico, trazado y manipulacion de vectores.
 */

// =========================================================================
// 1. ALGORITMO DE VECTORIZACIÓN (Trazado de Imagen y Croquis)
// =========================================================================

/**
 * Trasa los contornos de un mapa de bits y los convierte en coordenadas vectoriales.
 * Utiliza Moore-Neighbor Tracing para seguir bordes binarios con binarizacion adaptativa.
 */
export function traceRasterContours(imageData, threshold, cutoff = 0, sketchTrace = false) {
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;

    const grayValues = new Uint8Array(width * height);
    const binaryGrid = new Uint8Array(width * height);

    // 1. Extraer escala de grises
    for (let i = 0; i < data.length; i += 4) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        grayValues[i / 4] = Math.round(gray);
    }

    // 2. Aplicar Binarizacion (Estandar o Adaptativa por Croquis)
    if (sketchTrace) {
        // Algoritmo de Umbral Adaptativo por Imagen Integral (Sketch Trace)
        // Permite compensar iluminacion desigual en firmas o recetas manuscritas
        const windowSize = 15;
        const halfWin = Math.floor(windowSize / 2);
        const integral = new Uint32Array(width * height);

        // Calcular Imagen Integral para consulta O(1) de promedio local
        for (let y = 0; y < height; y++) {
            let rowSum = 0;
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                rowSum += grayValues[idx];
                integral[idx] = rowSum + (y > 0 ? integral[(y - 1) * width + x] : 0);
            }
        }

        // Binarizar usando promedio local
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                
                // Limites de ventana
                const x1 = Math.max(0, x - halfWin);
                const x2 = Math.min(width - 1, x + halfWin);
                const y1 = Math.max(0, y - halfWin);
                const y2 = Math.min(height - 1, y + halfWin);

                const count = (x2 - x1 + 1) * (y2 - y1 + 1);

                // Suma usando la imagen integral
                const sum = integral[y2 * width + x2] 
                          - (x1 > 0 ? integral[y2 * width + (x1 - 1)] : 0)
                          - (y1 > 0 ? integral[(y1 - 1) * width + x2] : 0)
                          + (x1 > 0 && y1 > 0 ? integral[(y1 - 1) * width + (x1 - 1)] : 0);

                const localAvg = sum / count;
                // Sensibilidad ajustada por el threshold y cutoff
                const localThreshold = localAvg * (1.0 - (threshold / 255) * 0.15) - cutoff;
                binaryGrid[idx] = (grayValues[idx] < localThreshold) ? 1 : 0;
            }
        }
    } else {
        // Binarizacion Estandar de LightBurn por Umbral global
        for (let i = 0; i < grayValues.length; i++) {
            binaryGrid[i] = (grayValues[i] < threshold) ? 1 : 0;
        }
    }

    // 3. Moore-Neighbor Boundary Tracing
    const visited = new Uint8Array(width * height);
    const contours = [];

    // Direcciones de busqueda en vecindario Moore (8-conectividad en sentido horario)
    const dirs = [
        { x: -1, y: -1 }, { x: 0, y: -1 }, { x: 1, y: -1 },
        { x: 1, y: 0 },   { x: 1, y: 1 },  { x: 0, y: 1 },
        { x: -1, y: 1 },  { x: -1, y: 0 }
    ];

    for (let y = 1; y < height - 1; y++) {
        for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;

            // Encontrar punto de partida de contorno no visitado
            if (binaryGrid[idx] === 1 && visited[idx] === 0) {
                // Es un pixel de contorno si tiene al menos un vecino de fondo (0)
                let isEdge = false;
                for (let d = 0; dir = dirs[d], d < 8; d++) {
                    const nx = x + dirs[d].x;
                    const ny = y + dirs[d].y;
                    if (binaryGrid[ny * width + nx] === 0) {
                        isEdge = true;
                        break;
                    }
                }

                if (isEdge) {
                    const contour = traceContour(x, y, binaryGrid, visited, width, height, dirs);
                    if (contour && contour.length > 5) { // Ignorar ruido minusculo
                        contours.push(contour);
                    }
                }
            }
        }
    }

    // Filtrar cuadro delimitador exterior de la imagen para trazados limpios
    const filteredContours = contours.filter(points => {
        let minX = width, maxX = 0, minY = height, maxY = 0;
        points.forEach(p => {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
        });
        const isOuterFrame = (minX <= 3 && maxX >= width - 4 && minY <= 3 && maxY >= height - 4);
        return !isOuterFrame;
    });

    return filteredContours;
}

function traceContour(startX, startY, grid, visited, width, height, dirs) {
    const points = [];
    let cx = startX;
    let cy = startY;

    // Registrar primer pixel
    points.push({ x: cx, y: cy });
    visited[cy * width + cx] = 1;

    let dirIndex = 0; // Iniciar mirando al norte/oeste
    let limit = 4000; // Proteccion contra bucles infinitos
    
    let px = cx;
    let py = cy;

    while (limit-- > 0) {
        let foundNext = false;
        // Escanear los 8 vecinos buscando la transicion
        for (let i = 0; i < 8; i++) {
            const scanIndex = (dirIndex + i) % 8;
            const nx = cx + dirs[scanIndex].x;
            const ny = cy + dirs[scanIndex].y;

            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                if (grid[ny * width + nx] === 1) {
                    cx = nx;
                    cy = ny;
                    points.push({ x: cx, y: cy });
                    visited[cy * width + cx] = 1;
                    
                    // Modificar la direccion de retroceso de busqueda
                    dirIndex = (scanIndex + 5) % 8; 
                    foundNext = true;
                    break;
                }
            }
        }

        // Si regresamos al punto de partida, terminamos el contorno
        if (!foundNext || (cx === startX && cy === startY)) {
            break;
        }
    }

    return points;
}

// =========================================================================
// 2. PREVISUALIZACIÓN DE VECTORES EN TIEMPO REAL
// =========================================================================

let tracePreviewGroup = null;

export function runTracePreview(raster, threshold, cutoff = 0, smoothness = 1.0, optimize = 0.2, sketchTrace = false, onlyOuter = false, fillMode = false) {
    if (tracePreviewGroup) {
        tracePreviewGroup.remove();
        tracePreviewGroup = null;
    }

    tracePreviewGroup = new paper.Group();
    tracePreviewGroup.data = { isSelectionBox: true, isTracePreview: true };

    try {
        const imgSource = raster.canvas || raster.image;
        if (!imgSource) return;

        const width = raster.width || imgSource.width;
        const height = raster.height || imgSource.height;
        if (width <= 0 || height <= 0) return;

        // Limite de tamano optimizado para evitar retraso visual durante el arrastre
        const previewCanvas = document.createElement('canvas');
        previewCanvas.width = Math.min(width, 400);
        previewCanvas.height = Math.round(height * (previewCanvas.width / width));

        const pCtx = previewCanvas.getContext('2d');
        pCtx.drawImage(imgSource, 0, 0, previewCanvas.width, previewCanvas.height);

        const imageData = pCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);
        const contours = traceRasterContours(imageData, threshold, cutoff, sketchTrace);

        const bounds = raster.bounds;
        const temporaryPaths = [];

        contours.forEach(points => {
            const pathPoints = points.map(p => {
                const pctX = (p.x + 0.5) / previewCanvas.width;
                const pctY = (p.y + 0.5) / previewCanvas.height;

                // Mapeo matematico directo de pixel a coordenadas Paper.js del raster
                const localPoint = new paper.Point(
                    (pctX - 0.5) * raster.width,
                    (pctY - 0.5) * raster.height
                );

                if (typeof raster.localToGlobal === 'function') {
                    return raster.localToGlobal(localPoint);
                } else {
                    return new paper.Point(
                        bounds.left + pctX * bounds.width,
                        bounds.top + pctY * bounds.height
                    );
                }
            });

            // Dibujar contorno de vista previa en el caracteristico magenta de LightBurn
            const path = new paper.Path({
                segments: pathPoints,
                closed: true,
                strokeColor: '#ff00ff',
                strokeWidth: 1.5 / paper.view.zoom,
                fillColor: fillMode ? new paper.Color(255, 0, 255, 0.2) : null,
                insert: false
            });

            // Simplificacion y optimizacion matematica de nodos
            if (smoothness > 0) {
                const tolerance = (smoothness * 0.12) + (optimize * 0.25);
                path.simplify(Math.max(0.01, tolerance));
            }

            temporaryPaths.push(path);
        });

        // Filtrado de contorno exterior (solo silueta)
        if (onlyOuter && temporaryPaths.length > 1) {
            temporaryPaths.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
            const filteredPaths = [];
            temporaryPaths.forEach(path => {
                const isNested = filteredPaths.some(parentPath => parentPath.bounds.contains(path.bounds));
                if (!isNested) {
                    filteredPaths.push(path);
                }
            });
            filteredPaths.forEach(p => tracePreviewGroup.addChild(p));
        } else {
            temporaryPaths.forEach(p => tracePreviewGroup.addChild(p));
        }

        paper.project.activeLayer.addChild(tracePreviewGroup);
        paper.view.update();

    } catch (err) {
        console.error("Error drawing live raster trace preview:", err);
    }
}

// =========================================================================
// 3. DIÁLOGO MODAL INTEGRAL DE TRAZADO (Estilo LightBurn)
// =========================================================================

export function openImageTraceModal(raster) {
    const styleId = 'image-trace-magenta-styles';
    if (!document.getElementById(styleId)) {
        const styleEl = document.createElement('style');
        styleEl.id = styleId;
        styleEl.textContent = `
            .trace-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background-color: rgba(0, 0, 0, 0.4); z-index: 10000; display: flex; align-items: center; justify-content: center; font-family: system-ui, -apple-system, sans-serif; }
            .trace-modal { background-color: #1e1e1e; color: #f3f3f3; border: 2px solid #ff00ff; border-radius: 8px; padding: 24px; width: 440px; box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7); z-index: 10001; pointer-events: auto; user-select: none; }
            .trace-modal h3 { color: #ff00ff; margin-top: 0; margin-bottom: 4px; font-size: 18px; font-weight: bold; display: flex; align-items: center; gap: 8px; cursor: move; }
            .trace-modal .drag-subtitle { font-size: 11px; color: #888888; margin-bottom: 18px; border-bottom: 2px solid rgba(255, 0, 255, 0.35); padding-bottom: 6px; }
            .trace-modal .slider-row { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
            .trace-modal .slider-row label { width: 140px; font-size: 13px; font-weight: bold; color: #e2e8f0; }
            .trace-modal .slider-row input[type="range"] { flex-grow: 1; accent-color: #ff00ff; cursor: pointer; height: 5px; border-radius: 2px; }
            .trace-modal .slider-row input[type="number"] { width: 70px; background-color: #2b2a2b; border: 1px solid #ff00ff; border-radius: 4px; color: #ffffff; padding: 4px; font-size: 13px; text-align: center; font-weight: bold; }
            .trace-modal .options-box { background-color: #252525; border-radius: 6px; padding: 14px; margin-bottom: 20px; display: flex; flex-direction: column; gap: 12px; border: 1px solid rgba(255, 255, 255, 0.05); }
            .trace-modal .checkbox-label { display: flex; align-items: center; gap: 10px; font-size: 13px; cursor: pointer; color: #f1f5f9; }
            .trace-modal .checkbox-label input[type="checkbox"] { accent-color: #ff00ff; cursor: pointer; width: 16px; height: 16px; }
            .trace-modal .info-text { font-size: 11px; color: #a0aec0; background-color: #2b2a2b; padding: 8px 12px; border-radius: 4px; border-left: 3px solid #ff00ff; margin-bottom: 15px; line-height: 1.4; }
            .trace-modal .btn-row { display: flex; justify-content: flex-end; gap: 12px; margin-top: 15px; }
            .trace-modal button { padding: 8px 20px; border-radius: 4px; font-weight: bold; font-size: 14px; cursor: pointer; transition: all 0.2s; border: none; outline: none; }
            .trace-modal .btn-cancel { background-color: #3b3a3b; color: #e6e6e6; border: 1px solid rgba(255, 255, 255, 0.1); }
            .trace-modal .btn-cancel:hover { background-color: #4a4a4b; }
            .trace-modal .btn-accept { background-color: #ff00ff; color: #ffffff; box-shadow: 0 2px 8px rgba(255, 0, 255, 0.4); }
            .trace-modal .btn-accept:hover { background-color: #d900d9; transform: scale(1.02); }
        `;
        document.head.appendChild(styleEl);
    }

    const originalOpacity = raster.opacity;
    const overlay = document.createElement('div');
    overlay.className = 'trace-overlay';

    const modal = document.createElement('div');
    modal.className = 'trace-modal';
    modal.innerHTML = `
        <h3>✨ Trazar Imagen</h3>
        <div class="drag-subtitle">↔️ Haz clic sostenido aquí para arrastrar este panel</div>
        
        <div class="slider-row" id="rowThreshold">
            <label for="traceThreshold" id="lblThreshold">Umbral (Threshold):</label>
            <input type="range" id="traceThreshold" min="0" max="255" value="128">
            <input type="number" id="traceThresholdNum" min="0" max="255" value="128">
        </div>
        
        <div class="slider-row" id="rowCutoff">
            <label for="traceCutoff">Corte (Cutoff):</label>
            <input type="range" id="traceCutoff" min="0" max="240" value="0">
            <input type="number" id="traceCutoffNum" min="0" max="240" value="0">
        </div>
        
        <div class="slider-row">
            <label for="traceSmooth">Suavizado (Smooth):</label>
            <input type="range" id="traceSmooth" min="0.0" max="1.333" step="0.01" value="1.0">
            <input type="number" id="traceSmoothNum" min="0.0" max="1.333" step="0.01" value="1.0">
        </div>
        
        <div class="slider-row">
            <label for="traceOptimize">Optimizar (Optimize):</label>
            <input type="range" id="traceOptimize" min="0.0" max="1.0" step="0.01" value="0.2">
            <input type="number" id="traceOptimizeNum" min="0.0" max="1.0" step="0.01" value="0.2">
        </div>
        
        <div class="options-box">
            <label class="checkbox-label" title="Ignorar trazados interiores para siluetas limpias de personas u objetos">
                <input type="checkbox" id="traceOnlyOuter">
                <b>Trazar Solo Contorno Exterior (Silueta)</b>
            </label>
            <label class="checkbox-label" title="Especial para firmas o manuscritos en papel">
                <input type="checkbox" id="traceSketch">
                Activar Trazado de Croquis (Sketch Trace)
            </label>
            <label class="checkbox-label">
                <input type="checkbox" id="traceFadeImage" checked>
                Desvanecer Imagen Original (25%)
            </label>
            <label class="checkbox-label">
                <input type="checkbox" id="traceDeleteImage">
                Eliminar Imagen Original al Terminar
            </label>
            <label class="checkbox-label" title="Asigna un color de relleno solido visible para verificar vectores">
                <input type="checkbox" id="traceWithFill">
                Previsualizar con Relleno (Fill Mode)
            </label>
        </div>
        
        <div class="info-text" id="traceGuideText">
            💡 <b>Guía de Trazado:</b> Para fotos con personas y fondo, activa <b>"Solo Contorno Exterior"</b> para extraer una silueta limpia y ajusta el <b>Umbral</b>.
        </div>
        
        <div class="btn-row">
            <button class="btn-cancel" id="btnTraceCancel">Cancelar</button>
            <button class="btn-accept" id="btnTraceAccept">Aceptar</button>
        </div>
    `;

    overlay.appendChild(modal);
    document.body.appendChild(overlay);

    // --- COMPORTAMIENTO DRAGGABLE (ARRISTRABLE) DE LA MODAL ---
    const dragHeader = modal.querySelector('.drag-subtitle');
    const mainHeader = modal.querySelector('h3');
    let isDragging = false;
    let startX = 0, startY = 0;
    let initialLeft = 0, initialTop = 0;

    const initiateDrag = (e) => {
        if (e.button !== 0) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON') return;
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;
        const rect = modal.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;
        modal.style.position = 'fixed';
        modal.style.margin = '0';
        modal.style.left = initialLeft + 'px';
        modal.style.top = initialTop + 'px';
    };

    const handleMouseMove = function (e) {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        modal.style.left = (initialLeft + dx) + 'px';
        modal.style.top = (initialTop + dy) + 'px';
    };

    const handleMouseUp = function () {
        isDragging = false;
    };

    dragHeader.addEventListener('mousedown', initiateDrag);
    mainHeader.addEventListener('mousedown', initiateDrag);
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    // --- ENLACE INTERACTIVO DE CONTROLES ---
    const outerCheck = modal.querySelector('#traceOnlyOuter');
    const sketchCheck = modal.querySelector('#traceSketch');
    const fadeCheck = modal.querySelector('#traceFadeImage');
    const deleteCheck = modal.querySelector('#traceDeleteImage');
    const fillCheck = modal.querySelector('#traceWithFill');
    const btnCancel = modal.querySelector('#btnTraceCancel');
    const btnAccept = modal.querySelector('#btnTraceAccept');
    const lblThreshold = modal.querySelector('#lblThreshold');
    const rowCutoff = modal.querySelector('#rowCutoff');
    const guideText = modal.querySelector('#traceGuideText');

    const currentParams = {
        threshold: 128,
        cutoff: 0,
        smoothness: 1.0,
        optimize: 0.2,
        sketchTrace: false,
        onlyOuter: false,
        fillMode: false
    };

    let traceTimeout = null;
    function triggerTraceUpdate() {
        if (traceTimeout) clearTimeout(traceTimeout);
        traceTimeout = setTimeout(() => {
            runTracePreview(
                raster,
                currentParams.threshold,
                currentParams.cutoff,
                currentParams.smoothness,
                currentParams.optimize,
                currentParams.sketchTrace,
                currentParams.onlyOuter,
                currentParams.fillMode
            );
        }, 50);
    }

    function registerControl(sliderId, numId, min, max, step, key, initialVal) {
        const slider = modal.querySelector('#' + sliderId);
        const numInput = modal.querySelector('#' + numId);

        function setValue(val, skipUpdate = false) {
            let parsed = parseFloat(val);
            if (isNaN(parsed)) return;
            parsed = Math.max(min, Math.min(max, parsed));
            if (step >= 1) parsed = Math.round(parsed);
            
            slider.value = parsed;
            numInput.value = parsed;
            currentParams[key] = parsed;

            if (!skipUpdate) triggerTraceUpdate();
        }

        slider.oninput = (e) => setValue(e.target.value);
        numInput.oninput = (e) => {
            if (e.target.value !== '') setValue(e.target.value);
        };

        // Soporte de rueda de raton para ajuste milimetrico rapido estilo CAD
        const handleWheel = (e) => {
            e.preventDefault();
            const currentVal = parseFloat(slider.value);
            const dir = e.deltaY < 0 ? 1 : -1;
            setValue(currentVal + dir * step);
        };

        slider.onwheel = handleWheel;
        numInput.onwheel = handleWheel;
        setValue(initialVal, true);
    }

    // Inicializar controles interactivos
    registerControl('traceThreshold', 'traceThresholdNum', 0, 255, 1, 'threshold', 128);
    registerControl('traceCutoff', 'traceCutoffNum', 0, 240, 1, 'cutoff', 0);
    registerControl('traceSmooth', 'traceSmoothNum', 0.0, 1.33, 0.01, 'smoothness', 1.0);
    registerControl('traceOptimize', 'traceOptimizeNum', 0.0, 1.0, 0.01, 'optimize', 0.2);

    sketchCheck.onchange = () => {
        currentParams.sketchTrace = sketchCheck.checked;
        if (sketchCheck.checked) {
            lblThreshold.textContent = "Sensibilidad:";
            rowCutoff.style.opacity = '0.3';
            rowCutoff.style.pointerEvents = 'none';
            guideText.innerHTML = "📝 <b>Modo Croquis Activo:</b> Disenado para firmas, manuscritos o recetas en papel. La 'Sensibilidad' compensa iluminaciones difusas.";
        } else {
            lblThreshold.textContent = "Umbral (Threshold):";
            rowCutoff.style.opacity = '1';
            rowCutoff.style.pointerEvents = 'auto';
            guideText.innerHTML = "💡 <b>Guia de Trazado:</b> Para fotos o logos contrastados, activa <b>'Solo Contorno Exterior'</b> para obtener siluetas limpias.";
        }
        triggerTraceUpdate();
    };

    outerCheck.onchange = () => {
        currentParams.onlyOuter = outerCheck.checked;
        triggerTraceUpdate();
    };

    fillCheck.onchange = () => {
        currentParams.fillMode = fillCheck.checked;
        triggerTraceUpdate();
    };

    const handleFadeToggle = () => {
        raster.opacity = fadeCheck.checked ? 0.25 : originalOpacity;
        paper.view.update();
    };
    fadeCheck.onchange = handleFadeToggle;
    handleFadeToggle();

    // Primera traza
    triggerTraceUpdate();

    const closeModal = () => {
        raster.opacity = originalOpacity;
        if (traceTimeout) clearTimeout(traceTimeout);
        if (tracePreviewGroup) {
            tracePreviewGroup.remove();
            tracePreviewGroup = null;
        }
        dragHeader.removeEventListener('mousedown', initiateDrag);
        mainHeader.removeEventListener('mousedown', initiateDrag);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        overlay.remove();
        paper.view.update();
    };

    btnCancel.onclick = closeModal;

    btnAccept.onclick = () => {
        if (tracePreviewGroup && tracePreviewGroup.children.length > 0) {
            if (typeof window.saveHistory === 'function') {
                window.saveHistory();
            }

            const committedPaths = [];
            tracePreviewGroup.children.forEach(p => {
                const finalPath = p.clone();
                finalPath.strokeColor = new paper.Color('#000000');
                finalPath.strokeWidth = 1.0;
                
                // Si el usuario prefirio rellenar el trazado (opcional) para previsualizacion
                if (currentParams.fillMode) {
                    finalPath.fillColor = new paper.Color('#111111');
                } else {
                    finalPath.fillColor = null;
                }

                finalPath.data = { locked: false, label: "Trazado" };
                paper.project.activeLayer.addChild(finalPath);
                committedPaths.push(finalPath);
            });

            // Agrupar en un unico vector escalable limpio
            const finalVectorGroup = new paper.Group(committedPaths);
            finalVectorGroup.data = {
                locked: false,
                label: "Imagen Vectorizada (" + (raster.data?.label || "Trazado") + ")"
            };

            if (window.currentMockup) {
                finalVectorGroup.insertBelow(window.currentMockup);
            }

            if (deleteCheck.checked) {
                raster.remove();
                if (typeof window.deselectItem === 'function') window.deselectItem();
            }

            if (typeof window.selectItem === 'function') {
                window.selectItem(finalVectorGroup);
            }

            paper.view.update();
        }
        closeModal();
    };
}

// =========================================================================
// 4. SISTEMA DE EDICIÓN DE NODOS VECTORIALES (Estilo LightBurn)
// =========================================================================

// Variables de control de estado de nodos
window.nodeEditMode = false;
window.nodeEditTarget = null;
window.nodeHandlesGroup = null;
window.selectedNodeIndex = -1;
window.draggingNode = false;
window.dragNodeIndex = -1;

/**
 * Dibuja los tiradores (manejadores rojos) de cada nodo del trazado vectorial en pantalla.
 * El nodo seleccionado actualmente se resalta en rojo solido.
 */
export function drawNodeEditHandles(path) {
    if (window.nodeHandlesGroup) {
        window.nodeHandlesGroup.remove();
        window.nodeHandlesGroup = null;
    }

    if (!path || !path.segments) return;

    window.nodeHandlesGroup = new paper.Group();
    window.nodeHandlesGroup.data = { isNodeEditOverlay: true };

    const handleRadius = 5 / paper.view.zoom;

    path.segments.forEach(function (segment, index) {
        const isSelected = (index === window.selectedNodeIndex);
        
        // Circulo rojo/blanco interactivo de control de nodos manuales
        const handleCircle = new paper.Path.Circle({
            center: segment.point,
            radius: handleRadius,
            strokeColor: '#dc3545',
            fillColor: isSelected ? '#dc3545' : '#ffffff',
            strokeWidth: 1.5 / paper.view.zoom
        });

        // Almacenar metadatos para hitTesting directo
        handleCircle.data = { 
            isNodeHandle: true, 
            segmentIndex: index,
            parentPathId: path.id
        };

        window.nodeHandlesGroup.addChild(handleCircle);

        // Si el nodo esta seleccionado y tiene manecillas de curvatura (Bezier handles), dibujarlas
        if (isSelected) {
            drawBezierHandles(segment, handleRadius);
        }
    });

    window.nodeHandlesGroup.bringToFront();
}

/**
 * Dibuja las manecillas de control de tangentes Bezier (entrante y saliente)
 */
function drawBezierHandles(segment, radius) {
    const strokeColor = '#dc3545';
    const zoom = paper.view.zoom;

    // 1. Manecilla Entrante (handleIn)
    if (segment.handleIn && !segment.handleIn.isZero()) {
        const inPt = segment.point.add(segment.handleIn);
        
        const lineIn = new paper.Path.Line({
            from: segment.point,
            to: inPt,
            strokeColor: strokeColor,
            strokeWidth: 1.0 / zoom
        });
        
        const circleIn = new paper.Path.Circle({
            center: inPt,
            radius: radius * 0.8,
            strokeColor: strokeColor,
            fillColor: '#ffc107', // Amarillo para diferenciar tangentes
            strokeWidth: 1.0 / zoom
        });

        circleIn.data = { isBezierHandle: true, handleType: 'in', segmentIndex: window.selectedNodeIndex };
        window.nodeHandlesGroup.addChild(lineIn);
        window.nodeHandlesGroup.addChild(circleIn);
    }

    // 2. Manecilla Saliente (handleOut)
    if (segment.handleOut && !segment.handleOut.isZero()) {
        const outPt = segment.point.add(segment.handleOut);
        
        const lineOut = new paper.Path.Line({
            from: segment.point,
            to: outPt,
            strokeColor: strokeColor,
            strokeWidth: 1.0 / zoom
        });
        
        const circleOut = new paper.Path.Circle({
            center: outPt,
            radius: radius * 0.8,
            strokeColor: strokeColor,
            fillColor: '#17a2b8', // Celeste para tangente de salida
            strokeWidth: 1.0 / zoom
        });

        circleOut.data = { isBezierHandle: true, handleType: 'out', segmentIndex: window.selectedNodeIndex };
        window.nodeHandlesGroup.addChild(lineOut);
        window.nodeHandlesGroup.addChild(circleOut);
    }
}

/**
 * Activa el modo de edicion de nodos vectoriales sobre la ruta seleccionada.
 */
export function enterNodeEditMode(path) {
    if (!path || !path.segments) return;

    // Desactivar cualquier modo previo
    exitNodeEditMode();

    if (window.selectedItem) {
        window.selectedItem.selected = false;
    }

    window.nodeEditMode = true;
    window.nodeEditTarget = path;
    window.selectedNodeIndex = -1;

    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(null); // Ocultar marco azul de Canva tradicional
    }

    drawNodeEditHandles(path);

    // Revelar panel de controles flotantes de nodos si existe
    const controls = document.getElementById('ctxNodeEditControls');
    if (controls) controls.classList.remove('hidden');

    paper.view.update();
}

/**
 * Sale de forma segura del modo de edicion de nodos y restaura los tiradores de Canva.
 */
export function exitNodeEditMode() {
    if (window.nodeHandlesGroup) {
        window.nodeHandlesGroup.remove();
        window.nodeHandlesGroup = null;
    }

    window.nodeEditMode = false;
    const path = window.nodeEditTarget;
    window.nodeEditTarget = null;
    window.selectedNodeIndex = -1;

    const controls = document.getElementById('ctxNodeEditControls');
    if (controls) controls.classList.add('hidden');

    if (path && typeof window.selectItem === 'function') {
        window.selectItem(path); // Re-seleccionar de forma tradicional con caja celeste
    }

    paper.view.update();
}

/**
 * Escucha eventos de teclado especificos para edicion de curvas y nodos (S, L, C, D, I, M, B)
 * Basado en las combinaciones del manual y videos de LightBurn.
 */
export function handleNodeKeyDown(event) {
    if (!window.nodeEditMode || !window.nodeEditTarget) return;

    const path = window.nodeEditTarget;
    const idx = window.selectedNodeIndex;

    // Ignorar si el usuario escribe en campos de texto de medidas
    const active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA")) return;

    let changed = false;

    // --- ACCIÓN D: Borrar Nodo o Borrar Segmento (Delete) ---
    if (event.key === 'd' || event.key === 'Delete') {
        if (idx !== -1 && path.segments[idx]) {
            if (typeof window.saveHistory === 'function') window.saveHistory();
            path.removeSegment(idx);
            window.selectedNodeIndex = -1;
            changed = true;
        }
    }

    // --- ACCIÓN C: Convertir nodo suave a esquina afilada (Corner) ---
    if (event.key === 'c') {
        if (idx !== -1 && path.segments[idx]) {
            if (typeof window.saveHistory === 'function') window.saveHistory();
            const segment = path.segments[idx];
            segment.handleIn = null; // Quita tangentes haciendo la junta afilada
            segment.handleOut = null;
            changed = true;
        }
    }

    // --- ACCIÓN S: Suavizar Nodo o Convertir Linea Recta en Curva Bezier (Smooth) ---
    if (event.key === 's') {
        if (idx !== -1 && path.segments[idx]) {
            // S sobre nodo: Hacer simetrico/suave
            if (typeof window.saveHistory === 'function') window.saveHistory();
            const segment = path.segments[idx];
            segment.smooth({ type: 'symmetric' });
            changed = true;
        } else {
            // S flotando sobre un segmento: Curvar linea
            const hitResult = paper.project.hitTest(paper.tool.coordinate, { stroke: true, tolerance: 8 });
            if (hitResult && hitResult.item === path && hitResult.type === 'stroke') {
                if (typeof window.saveHistory === 'function') window.saveHistory();
                const location = hitResult.location;
                if (location) {
                    const segment = path.insert(location.index + 1, location.point);
                    segment.smooth({ type: 'continuous' });
                    window.selectedNodeIndex = segment.index;
                    changed = true;
                }
            }
        }
    }

    // --- ACCIÓN L: Convertir curva compleja en recta (Line) ---
    if (event.key === 'l') {
        // L flotando sobre curva: Enderezar
        const hitResult = paper.project.hitTest(paper.tool.coordinate, { stroke: true, tolerance: 8 });
        if (hitResult && hitResult.item === path && hitResult.type === 'stroke') {
            if (typeof window.saveHistory === 'function') window.saveHistory();
            const curve = hitResult.location.curve;
            if (curve) {
                curve.segment1.handleOut = null;
                curve.segment2.handleIn = null;
                changed = true;
            }
        }
    }

    // --- ACCIÓN I: Insertar Nodo en posicion de mouse ---
    if (event.key === 'i') {
        const hitResult = paper.project.hitTest(paper.tool.coordinate, { stroke: true, tolerance: 8 });
        if (hitResult && hitResult.item === path && hitResult.type === 'stroke') {
            if (typeof window.saveHistory === 'function') window.saveHistory();
            const location = hitResult.location;
            if (location) {
                const inserted = path.insert(location.index + 1, location.point);
                window.selectedNodeIndex = inserted.index;
                changed = true;
            }
        }
    }

    // --- ACCIÓN M: Insertar Nodo exactamente en el punto medio ---
    if (event.key === 'm') {
        const hitResult = paper.project.hitTest(paper.tool.coordinate, { stroke: true, tolerance: 8 });
        if (hitResult && hitResult.item === path && hitResult.type === 'stroke') {
            if (typeof window.saveHistory === 'function') window.saveHistory();
            const curve = hitResult.location.curve;
            if (curve) {
                const midPoint = curve.getPointAt(curve.length / 2);
                const inserted = path.insert(curve.segment1.index + 1, midPoint);
                window.selectedNodeIndex = inserted.index;
                changed = true;
            }
        }
    }

    // --- ACCIÓN B: Romper trazado en el nodo seleccionado (Break) ---
    if (event.key === 'b') {
        if (idx !== -1 && path.segments[idx]) {
            if (typeof window.saveHistory === 'function') window.saveHistory();
            path.splitAt(idx);
            exitNodeEditMode();
            return;
        }
    }

    if (changed) {
        drawNodeEditHandles(path);
        paper.view.update();
        event.preventDefault();
    }
}

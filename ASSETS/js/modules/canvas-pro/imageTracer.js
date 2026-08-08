
// --- ALGORITMO DE SEGUIMIENTO DE CONTORNOS (Moore-Neighbor Tracing con Curvas) ---
export function traceRasterContours(imageData, threshold, cutoff = 0, sketchTrace = false) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  
  const binaryGrid = new Uint8Array(width * height);
  const grayValues = new Uint8Array(width * height);
  const alphaValues = new Uint8Array(width * height);

  // 1. Extraer valores de gris y transparencia
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    const idx = i / 4;
    grayValues[idx] = Math.round(gray);
    alphaValues[idx] = a;
  }

  // 2. Aplicar binarización (Estándar o Adaptativa por Croquis)
  if (sketchTrace) {
    // Algoritmo de Umbral Adaptativo por Imagen Integral (Sketch Trace de LightBurn)
    const windowSize = 15;
    const halfWin = Math.floor(windowSize / 2);
    const integral = new Uint32Array(width * height);

    // Calcular imagen integral para consulta O(1) de promedio local
    for (let y = 0; y < height; y++) {
      let rowSum = 0;
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        rowSum += grayValues[idx];
        integral[idx] = rowSum + (y > 0 ? integral[(y - 1) * width + x] : 0);
      }
    }

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (alphaValues[idx] <= 50) {
          binaryGrid[idx] = 0;
          continue;
        }

        const x0 = Math.max(0, x - halfWin);
        const x1 = Math.min(width - 1, x + halfWin);
        const y0 = Math.max(0, y - halfWin);
        const y1 = Math.min(height - 1, y + halfWin);
        const area = (x1 - x0 + 1) * (y1 - y0 + 1);

        const sum = integral[y1 * width + x1] - 
                    (x0 > 0 ? integral[y1 * width + (x0 - 1)] : 0) - 
                    (y0 > 0 ? integral[(y0 - 1) * width + x1] : 0) + 
                    (x0 > 0 && y0 > 0 ? integral[(y0 - 1) * width + (x0 - 1)] : 0);

        const localAverage = sum / area;
        const gray = grayValues[idx];

        // Ajustar sensibilidad adaptativa con el valor del umbral
        const offset = (128 - threshold) * 0.4;
        binaryGrid[idx] = (gray < localAverage - offset && gray >= cutoff) ? 1 : 0;
      }
    }
  } else {
    // Binarización estándar por rango entre Corte (Cutoff) y Umbral (Threshold)
    for (let i = 0; i < grayValues.length; i++) {
      const gray = grayValues[i];
      const a = alphaValues[i];
      binaryGrid[i] = (a > 50 && gray >= cutoff && gray < threshold) ? 1 : 0;
    }
  }

  // 3. Seguimiento de contornos mediante Moore-Neighbor
  const visited = new Uint8Array(width * height);
  const contours = [];

  const dirs = [
    { x: 0, y: -1 }, // Arriba
    { x: 1, y: -1 }, // Arriba-Derecha
    { x: 1, y: 0 },  // Derecha
    { x: 1, y: 1 },  // Abajo-Derecha
    { x: 0, y: 1 },  // Abajo
    { x: -1, y: 1 }, // Abajo-Izquierda
    { x: -1, y: 0 }, // Izquierda
    { x: -1, y: -1 } // Arriba-Izquierda
  ];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (binaryGrid[idx] === 1 && !visited[idx]) {
        let isBoundary = false;
        for (let d = 0; d < 8; d++) {
          const nx = x + dirs[d].x;
          const ny = y + dirs[d].y;
          if (binaryGrid[ny * width + nx] === 0) {
            isBoundary = true;
            break;
          }
        }

        if (isBoundary) {
          const points = [];
          let currX = x;
          let currY = y;
          let startX = x;
          let startY = y;
          
          let backDir = 6;
          let finished = false;
          let iterations = 0;
          const maxIterations = 8000;

          while (!finished && iterations < maxIterations) {
            points.push({ x: currX, y: currY });
            visited[currY * width + currX] = 1;

            let foundNext = false;
            let scanDir = (backDir + 1) % 8;

            for (let i = 0; i < 8; i++) {
              const checkDir = (scanDir + i) % 8;
              const nx = currX + dirs[checkDir].x;
              const ny = currY + dirs[checkDir].y;

              if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                if (binaryGrid[ny * width + nx] === 1) {
                  currX = nx;
                  currY = ny;
                  backDir = (checkDir + 4) % 8;
                  foundNext = true;
                  break;
                }
              }
            }

            if (!foundNext || (currX === startX && currY === startY)) {
              finished = true;
            }
            iterations++;
          }

          if (points.length > 3) {
            contours.push(points);
          }
        }
      }
    }
  }

  return contours;
}

// --- PREVISUALIZACIÓN DE VECTORES EN TIEMPO REAL ---
let tracePreviewGroup = null;

export function runTracePreview(raster, threshold, cutoff = 0, smoothness = 1.0, optimize = 0.2, sketchTrace = false) {
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

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = Math.min(width, 800);
    previewCanvas.height = Math.round(height * (previewCanvas.width / width));

    const pCtx = previewCanvas.getContext('2d');
    pCtx.drawImage(imgSource, 0, 0, previewCanvas.width, previewCanvas.height);
    const imageData = pCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);

    const contours = traceRasterContours(imageData, threshold, cutoff, sketchTrace);
    const bounds = raster.bounds;

    contours.forEach(points => {
      const pathPoints = points.map(p => {
        const pctX = p.x / previewCanvas.width;
        const pctY = p.y / previewCanvas.height;
        return new paper.Point(
          bounds.left + pctX * bounds.width,
          bounds.top + pctY * bounds.height
        );
      });

      const path = new paper.Path({
        segments: pathPoints,
        closed: true,
        strokeColor: '#ff00ff', // Magenta de LightBurn
        strokeWidth: 1.5 / paper.view.zoom,
        insert: false
      });

      if (smoothness > 0) {
        const tolerance = (smoothness * 0.12) + (optimize * 0.25);
        path.simplify(Math.max(0.01, tolerance));
      }
      tracePreviewGroup.addChild(path);
    });

    paper.project.activeLayer.addChild(tracePreviewGroup);
    paper.view.update();

  } catch (err) {
    console.error("Error drawing live raster trace preview:", err);
  }
}

// --- DIÁLOGO MODAL INTEGRAL DE TRAZADO (ESTILO LIGHTBURN) ---
export function openImageTraceModal(raster) {
  const styleId = 'image-trace-magenta-styles';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
      .trace-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(0, 0, 0, 0.2); /* Fondo sutil, permite ver el canvas debajo */
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui, -apple-system, sans-serif;
        pointer-events: none; /* Clics atraviesan el fondo para zoom o paneo si se desea */
      }
      .trace-modal {
        position: fixed;
        background-color: #1e1e1e;
        color: #f3f3f3;
        border: 2px solid #ff00ff;
        border-radius: 8px;
        padding: 24px;
        width: 440px;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.7);
        z-index: 10001;
        pointer-events: auto; /* Modal responde a clics */
        user-select: none;
      }
      .trace-modal h3 {
        color: #ff00ff;
        margin-top: 0;
        margin-bottom: 22px;
        font-size: 20px;
        font-weight: bold;
        border-bottom: 2px solid rgba(255, 0, 255, 0.35);
        padding-bottom: 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: move; /* Indicar que es arrastrable */
        user-select: none;
      }
      .trace-modal .slider-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }
      .trace-modal .slider-row label {
        width: 130px;
        font-size: 13px;
        font-weight: bold;
        color: #e2e8f0;
      }
      .trace-modal .slider-row input[type="range"] {
        flex-grow: 1;
        accent-color: #ff00ff;
        cursor: pointer;
        height: 5px;
        border-radius: 2px;
      }
      .trace-modal .slider-row input[type="number"] {
        width: 70px;
        background-color: #2b2a2b;
        border: 1px solid #ff00ff;
        border-radius: 4px;
        color: #ffffff;
        padding: 4px;
        font-size: 13px;
        text-align: center;
        font-weight: bold;
      }
      .trace-modal .slider-row input[type="number"]:focus {
        outline: none;
        box-shadow: 0 0 5px #ff00ff;
      }
      .trace-modal .options-box {
        background-color: #252525;
        border-radius: 6px;
        padding: 14px;
        margin-bottom: 20px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        border: 1px solid rgba(255, 255, 255, 0.05);
      }
      .trace-modal .checkbox-label {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13px;
        cursor: pointer;
        user-select: none;
        color: #f1f5f9;
      }
      .trace-modal .checkbox-label input[type="checkbox"] {
        accent-color: #ff00ff;
        cursor: pointer;
        width: 16px;
        height: 16px;
      }
      .trace-modal .btn-row {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 15px;
      }
      .trace-modal button {
        padding: 8px 20px;
        border-radius: 4px;
        font-weight: bold;
        font-size: 14px;
        cursor: pointer;
        transition: all 0.2s;
        border: none;
        outline: none;
      }
      .trace-modal .btn-cancel {
        background-color: #3b3a3b;
        color: #e6e6e6;
        border: 1px solid rgba(255, 255, 255, 0.1);
      }
      .trace-modal .btn-cancel:hover {
        background-color: #4a4a4b;
      }
      .trace-modal .btn-accept {
        background-color: #ff00ff;
        color: #ffffff;
        box-shadow: 0 2px 8px rgba(255, 0, 255, 0.4);
      }
      .trace-modal .btn-accept:hover {
        background-color: #d900d9;
        transform: scale(1.02);
      }
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
    
    <div class="slider-row">
      <label for="traceThreshold">Umbral (Threshold):</label>
      <input type="range" id="traceThreshold" min="0" max="255" value="128">
      <input type="number" id="traceThresholdNum" min="0" max="255" value="128">
    </div>

    <div class="slider-row">
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
      <label class="checkbox-label">
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
    </div>

    <div class="btn-row">
      <button class="btn-cancel" id="btnTraceCancel">Cancelar</button>
      <button class="btn-accept" id="btnTraceAccept">Aceptar</button>
    </div>
  `;

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  // --- COMPORTAMIENTO DRAGGABLE (ARRISTRABLE) DE LA VENTANA MODAL ---
  const modalHeader = modal.querySelector('h3');
  let isDragging = false;
  let startX = 0;
  let startY = 0;
  let initialLeft = 0;
  let initialTop = 0;

  modalHeader.onmousedown = function(e) {
    if (e.button !== 0) return; // Solo clic izquierdo
    
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'BUTTON' || e.target.tagName === 'A') return;

    isDragging = true;
    const rect = modal.getBoundingClientRect();
    
    startX = e.clientX;
    startY = e.clientY;
    initialLeft = rect.left;
    initialTop = rect.top;

    modal.style.transform = 'none';
    modal.style.margin = '0';
    modal.style.left = initialLeft + 'px';
    modal.style.top = initialTop + 'px';

    e.preventDefault();
  };

  const handleMouseMove = function(e) {
    if (!isDragging) return;
    
    const deltaX = e.clientX - startX;
    const deltaY = e.clientY - startY;

    let newX = initialLeft + deltaX;
    let newY = initialTop + deltaY;

    const maxX = window.innerWidth - modal.offsetWidth;
    const maxY = window.innerHeight - modal.offsetHeight;

    newX = Math.max(0, Math.min(newX, maxX));
    newY = Math.max(0, Math.min(newY, maxY));

    modal.style.left = newX + 'px';
    modal.style.top = newY + 'px';
  };

  const handleMouseUp = function() {
    isDragging = false;
  };

  document.addEventListener('mousemove', handleMouseMove);
  document.addEventListener('mouseup', handleMouseUp);

  const sketchCheck = modal.querySelector('#traceSketch');
  const fadeCheck = modal.querySelector('#traceFadeImage');
  const deleteCheck = modal.querySelector('#traceDeleteImage');
  const btnCancel = modal.querySelector('#btnTraceCancel');
  const btnAccept = modal.querySelector('#btnTraceAccept');

  // Guardar estado de parámetros
  const currentParams = {
    threshold: 128,
    cutoff: 0,
    smoothness: 1.0,
    optimize: 0.2,
    sketchTrace: false
  };

  // Debounce para previsualización ultra fluida
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
        currentParams.sketchTrace
      );
    }, 45);
  }

  // Registrador interactivo de controles en 4-Vías (Rango, Rueda, Teclas, Directo)
  function registerInteractiveControl(sliderId, numId, min, max, step, key, initialVal) {
    const slider = modal.querySelector('#' + sliderId);
    const numInput = modal.querySelector('#' + numId);

    function setValue(val, skipUpdate = false) {
      let parsed = parseFloat(val);
      if (isNaN(parsed)) return;
      parsed = Math.max(min, Math.min(max, parsed));
      if (step >= 1) {
        parsed = Math.round(parsed);
      } else {
        parsed = parseFloat(parsed.toFixed(3));
      }
      slider.value = parsed;
      numInput.value = parsed;
      currentParams[key] = parsed;
      if (!skipUpdate) {
        triggerTraceUpdate();
      }
    }

    slider.oninput = (e) => setValue(e.target.value);
    
    numInput.oninput = (e) => {
      if (e.target.value !== '') {
        setValue(e.target.value);
      }
    };

    const handleWheel = (e) => {
      e.preventDefault();
      const currentVal = parseFloat(slider.value);
      const direction = e.deltaY < 0 ? 1 : -1;
      setValue(currentVal + direction * step);
    };
    slider.onwheel = handleWheel;
    numInput.onwheel = handleWheel;

    const handleKeys = (e) => {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
        e.preventDefault();
        setValue(parseFloat(slider.value) + step);
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
        e.preventDefault();
        setValue(parseFloat(slider.value) - step);
      }
    };
    slider.addEventListener('keydown', handleKeys);
    numInput.addEventListener('keydown', handleKeys);

    setValue(initialVal, true);
  }

  // Inicializar cada uno de los parámetros de control interactivo de LightBurn
  registerInteractiveControl('traceThreshold', 'traceThresholdNum', 0, 255, 1, 'threshold', 128);
  registerInteractiveControl('traceCutoff', 'traceCutoffNum', 0, 240, 1, 'cutoff', 0);
  registerInteractiveControl('traceSmooth', 'traceSmoothNum', 0.0, 1.333, 0.01, 'smoothness', 1.0);
  registerInteractiveControl('traceOptimize', 'traceOptimizeNum', 0.0, 1.0, 0.01, 'optimize', 0.2);

  sketchCheck.onchange = () => {
    currentParams.sketchTrace = sketchCheck.checked;
    triggerTraceUpdate();
  };

  const handleFadeToggle = () => {
    if (fadeCheck.checked) {
      raster.opacity = 0.25;
    } else {
      raster.opacity = originalOpacity;
    }
    paper.view.update();
  };
  fadeCheck.onchange = handleFadeToggle;

  handleFadeToggle();
  triggerTraceUpdate();

  const closeModal = () => {
    raster.opacity = originalOpacity;
    if (traceTimeout) clearTimeout(traceTimeout);
    if (tracePreviewGroup) {
      tracePreviewGroup.remove();
      tracePreviewGroup = null;
    }
    
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

      const committedVectorPaths = [];
      tracePreviewGroup.children.forEach(p => {
        const clonedPath = p.clone();
        clonedPath.strokeColor = new paper.Color('#000000');
        clonedPath.strokeWidth = 1.0;
        clonedPath.fillColor = null;
        clonedPath.data = { locked: false, label: "Trazado" };
        paper.project.activeLayer.addChild(clonedPath);
        committedVectorPaths.push(clonedPath);
      });

      const finalVectorGroup = new paper.Group(committedVectorPaths);
      finalVectorGroup.data = { 
        locked: false, 
        label: "Imagen Vectorizada (" + (raster.data?.label || "Trazado") + ")" 
      };

      if (window.currentMockup) {
        finalVectorGroup.insertBelow(window.currentMockup);
      }

      if (deleteCheck.checked) {
        raster.remove();
        window.deselectItem();
      }

      window.selectItem(finalVectorGroup);
      paper.view.update();
    }
    closeModal();
  };
}

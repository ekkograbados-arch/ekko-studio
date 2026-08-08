
// --- ALGORITMO DE SEGUIMIENTO DE CONTORNOS (Moore-Neighbor Tracing con Curvas) ---
export function traceRasterContours(imageData, threshold) {
  const width = imageData.width;
  const height = imageData.height;
  const data = imageData.data;
  
  // Tabla binaria de 1D
  const binaryGrid = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    // Píxeles transparentes se tratan como fondo blanco
    binaryGrid[i / 4] = (a > 50 && gray < threshold) ? 1 : 0;
  }

  const visited = new Uint8Array(width * height);
  const contours = [];

  // Direcciones vecinas de Moore (sentido horario CW)
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
        // Validar si limita con el fondo
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
          
          let backDir = 6; // Empezar buscando desde la izquierda
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

// --- REAL-TIME VECTOR PREVIEW ---
let tracePreviewGroup = null;

export function runTracePreview(raster, threshold) {
  // Limpiar cualquier previsualización previa
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

    // Limitar tamaño de preview temporal para un slider ultra-fluido en tiempo real
    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = Math.min(width, 800);
    previewCanvas.height = Math.round(height * (previewCanvas.width / width));

    const pCtx = previewCanvas.getContext('2d');
    pCtx.drawImage(imgSource, 0, 0, previewCanvas.width, previewCanvas.height);
    const imageData = pCtx.getImageData(0, 0, previewCanvas.width, previewCanvas.height);

    const contours = traceRasterContours(imageData, threshold);
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
        strokeColor: '#ff00ff', // Magenta vibrante de LightBurn
        strokeWidth: 1.5 / paper.view.zoom,
        insert: false
      });

      path.simplify(0.12); // Suavizado de curvas Bézier para evitar píxeles dentados
      tracePreviewGroup.addChild(path);
    });

    paper.project.activeLayer.addChild(tracePreviewGroup);
    paper.view.update();

  } catch (err) {
    console.error("Error drawing live raster trace preview:", err);
  }
}

// --- VECTORIZATION MODAL DIALOG ---
export function openImageTraceModal(raster) {
  // Inyectar estilos CSS del modal una sola vez en el Header
  const styleId = 'image-trace-magenta-styles';
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement('style');
    styleEl.id = styleId;
    styleEl.textContent = `
      .trace-overlay {
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui, -apple-system, sans-serif;
      }
      .trace-modal {
        background-color: #1a1a1a;
        color: #f2f2f2;
        border: 2px solid #ff00ff;
        border-radius: 8px;
        padding: 24px;
        width: 400px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
        z-index: 10001;
      }
      .trace-modal h3 {
        color: #ff00ff;
        margin-top: 0;
        margin-bottom: 20px;
        font-size: 20px;
        font-weight: bold;
        border-bottom: 2px solid rgba(255, 0, 255, 0.4);
        padding-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .trace-modal .slider-row {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 20px;
      }
      .trace-modal .slider-row label {
        width: 100px;
        font-size: 14px;
        font-weight: bold;
      }
      .trace-modal .slider-row input[type="range"] {
        flex-grow: 1;
        accent-color: #ff00ff;
        cursor: pointer;
      }
      .trace-modal .slider-row input[type="number"] {
        width: 65px;
        background-color: #2b2a2b;
        border: 1px solid #ff00ff;
        border-radius: 4px;
        color: #ffffff;
        padding: 4px;
        font-size: 14px;
        text-align: center;
        font-weight: bold;
      }
      .trace-modal .slider-row input[type="number"]:focus {
        outline: none;
        box-shadow: 0 0 5px #ff00ff;
      }
      .trace-modal .options-box {
        background-color: #242424;
        border-radius: 6px;
        padding: 12px;
        margin-bottom: 20px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        border: 1px solid rgba(255, 255, 255, 0.05);
      }
      .trace-modal .checkbox-label {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 13.5px;
        cursor: pointer;
        user-select: none;
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
        padding: 8px 18px;
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

  // Preservar opacidad original de la imagen
  const originalOpacity = raster.opacity;

  // Crear la estructura del modal
  const overlay = document.createElement('div');
  overlay.className = 'trace-overlay';

  const modal = document.createElement('div');
  modal.className = 'trace-modal';
  modal.innerHTML = `
    <h3>✨ Trazar Imagen</h3>
    
    <div class="slider-row">
      <label for="traceThreshold">Umbral:</label>
      <input type="range" id="traceThreshold" min="0" max="255" value="128">
      <input type="number" id="traceThresholdNum" min="0" max="255" value="128">
    </div>

    <div class="options-box">
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

  const slider = modal.querySelector('#traceThreshold');
  const numInput = modal.querySelector('#traceThresholdNum');
  const fadeCheck = modal.querySelector('#traceFadeImage');
  const deleteCheck = modal.querySelector('#traceDeleteImage');
  const btnCancel = modal.querySelector('#btnTraceCancel');
  const btnAccept = modal.querySelector('#btnTraceAccept');

  function updateThresholdValue(value) {
    const val = Math.max(0, Math.min(255, Math.round(value)));
    slider.value = val;
    numInput.value = val;
    runTracePreview(raster, val);
  }

  // Método de ajuste 1: Arrastrar el slider horizontal
  slider.oninput = (e) => updateThresholdValue(e.target.value);

  // Método de ajuste 2: Rueda del mouse (Scroll) sobre slider o input numérico
  const handleScrollWheel = (e) => {
    e.preventDefault();
    const currentVal = parseInt(slider.value, 10);
    const delta = e.deltaY < 0 ? 1 : -1;
    updateThresholdValue(currentVal + delta);
  };
  slider.onwheel = handleScrollWheel;
  numInput.onwheel = handleScrollWheel;

  // Método de ajuste 3: Flechas del teclado
  const handleArrowKeys = (e) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      updateThresholdValue(parseInt(slider.value, 10) + 1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      updateThresholdValue(parseInt(slider.value, 10) - 1);
    }
  };
  slider.addEventListener('keydown', handleArrowKeys);
  numInput.addEventListener('keydown', handleArrowKeys);

  // Método de ajuste 4: Entrada de número por teclado al hacer clic
  numInput.oninput = (e) => {
    if (e.target.value !== '') {
      updateThresholdValue(e.target.value);
    }
  };

  // Desvanecer imagen original (Atenuación)
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
  updateThresholdValue(128);

  const closeModal = () => {
    raster.opacity = originalOpacity;
    if (tracePreviewGroup) {
      tracePreviewGroup.remove();
      tracePreviewGroup = null;
    }
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
        clonedPath.strokeColor = new paper.Color('#000000'); // Color negro final para grabado
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

/*
 * ASSETS/js/modules/canvas-pro/backgroundRemover.js
 * Módulo profesional de eliminación de fondos para EKKO Studio PRO (PhotoRoom Style).
 *
 * Ofrece:
 * 1. autoRemoveBackground(item): Eliminación automática por IA via @imgly/background-removal (CDN directo sin 404s).
 * 2. openBackgroundRemovalModal(item): Modal interactivo con Pincel de Borrado/Restauración con Dureza (Feathering)
 *    y Varita Mágica de Selección de Color por Inundación (Flood Fill) con tolerancia.
 * 3. Conservación de calidad extrema a resoluciones originales para grabado láser de alta definición (300/600 DPI).
 */

let imglyLib = null;
let isLoadingLib = false;

// --- 1. CARGADOR SEGURO DE LA IA (Evita completamente los 404 de consola) ---
async function loadImglyLibrary() {
  if (imglyLib) return imglyLib;
  if (isLoadingLib) {
    while (isLoadingLib) {
      await new Promise(r => setTimeout(r, 100));
    }
    return imglyLib;
  }

  isLoadingLib = true;
  console.log("🚀 Cargando IA de eliminación de fondos desde CDN directo...");

  try {
    // Importamos directamente desde el CDN de confianza para evitar intentos fallidos locales (Cero 404s)
    const module = await import("https://esm.sh/@imgly/background-removal@1.7.0");
    imglyLib = module;
    
    // Configuración global del publicPath de los modelos WASM/ONNX remotos
    window.imglyConfig = {
      publicPath: "https://staticimgly.com/@imgly/background-removal-data/1.7.0/dist/"
    };

    console.log("✅ IA de eliminación de fondos cargada con éxito!");
    isLoadingLib = false;
    return imglyLib;
  } catch (err) {
    console.error("❌ Error fatal al cargar la IA de eliminación de fondos:", err);
    isLoadingLib = false;
    throw err;
  }
}

// --- 2. ELIMINACIÓN DE FONDO AUTOMÁTICA POR IA ---
export async function autoRemoveBackground(item) {
  if (!item) return;

  // Extraer el Raster real (si viene dentro de un Clip Group)
  const raster = item.data?.clipGroup 
    ? item.children.find(c => c instanceof paper.Raster) 
    : item;

  if (!(raster instanceof paper.Raster)) {
    alert("Por favor, seleccione una imagen válida para eliminar el fondo.");
    return;
  }

  // Mostrar indicador de carga visual sobre el botón o pantalla
  const btn = document.getElementById("btnRemoveBg");
  const originalText = btn ? btn.innerHTML : "Quitar Fondo";
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span>⏳ Procesando IA...</span>';
  }

  try {
    const lib = await loadImglyLibrary();
    const imageSrc = raster.source;

    // Llamar a la función de eliminación de fondo de imgly
    const blob = await lib.removeBackground(imageSrc, {
      publicPath: window.imglyConfig.publicPath,
      progress: (key, current, total) => {
        const percent = Math.round((current / total) * 100);
        if (btn) btn.innerHTML = `<span>⏳ IA: ${percent}%</span>`;
      }
    });

    // Convertir el Blob resultante a una URL de objeto para Paper.js
    const resultUrl = URL.createObjectURL(blob);
    
    if (typeof window.saveHistory === "function") window.saveHistory();

    // Guardar parámetros de escala y posición actuales
    const oldPosition = raster.position.clone();
    const oldBounds = raster.bounds.clone();

    // Actualizar la fuente del Raster
    raster.source = resultUrl;

    raster.onLoad = () => {
      // Reajustar al mismo tamaño y posición original para que el diseño no se desplace
      const scaleX = oldBounds.width / raster.bounds.width;
      const scaleY = oldBounds.height / raster.bounds.height;
      raster.scale(scaleX, scaleY);
      raster.position = oldPosition;

      if (typeof window.updateSelectionBox === "function") {
        window.updateSelectionBox(item);
      }
      paper.view.update();
      console.log("✨ Eliminación automática por IA completada con éxito.");
    };

  } catch (err) {
    alert("No se pudo procesar la imagen con la IA. Se abrirá el modal de edición manual para recortar.");
    openBackgroundRemovalModal(item);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalText;
    }
  }
}

// --- 3. DIÁLOGO MODAL INTERACTIVO DE RECORTE MANUAL (PhotoRoom Style) ---
export function openBackgroundRemovalModal(item) {
  if (!item) return;

  const raster = item.data?.clipGroup 
    ? item.children.find(c => c instanceof paper.Raster) 
    : item;

  if (!(raster instanceof paper.Raster)) {
    alert("Por favor, seleccione una imagen válida.");
    return;
  }

  // Inyectar estilos CSS para el modal si no existen
  const styleId = "bg-remover-modal-styles";
  if (!document.getElementById(styleId)) {
    const styleEl = document.createElement("style");
    styleEl.id = styleId;
    styleEl.textContent = `
      .bg-remover-overlay {
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background-color: rgba(15, 15, 15, 0.95);
        z-index: 100002; display: flex; align-items: center; justify-content: center;
        font-family: system-ui, -apple-system, sans-serif;
      }
      .bg-remover-modal {
        background-color: #1a1a1a; color: #f3f3f3;
        border: 2px solid #00d2ff; border-radius: 12px;
        width: 90vw; height: 90vh; display: grid;
        grid-template-rows: 60px 1fr 60px;
        box-shadow: 0 10px 50px rgba(0,0,0,0.8);
        overflow: hidden;
      }
      .bg-remover-header {
        display: flex; justify-content: space-between; align-items: center;
        padding: 0 24px; border-bottom: 1px solid #333;
      }
      .bg-remover-header h2 {
        color: #00d2ff; margin: 0; font-size: 20px; font-weight: bold;
      }
      .bg-remover-content {
        display: grid; grid-template-columns: 280px 1fr; height: 100%; overflow: hidden;
      }
      .bg-remover-sidebar {
        background-color: #151515; padding: 20px; border-right: 1px solid #333;
        display: flex; flex-direction: column; gap: 20px; overflow-y: auto;
      }
      .bg-remover-tool-btn {
        display: flex; align-items: center; gap: 12px;
        background: #252525; border: 1px solid #444; border-radius: 8px;
        color: #fff; padding: 12px; cursor: pointer; text-align: left;
        font-weight: bold; transition: all 0.2s;
      }
      .bg-remover-tool-btn:hover { background: #333; border-color: #00d2ff; }
      .bg-remover-tool-btn.active { background: #00d2ff; color: #000; border-color: #00d2ff; }
      .bg-remover-slider-group {
        display: flex; flex-direction: column; gap: 6px;
      }
      .bg-remover-slider-group label { font-size: 13px; color: #aaa; font-weight: bold; }
      .bg-remover-slider-group input[type="range"] { accent-color: #00d2ff; cursor: pointer; }
      .bg-remover-workarea {
        position: relative; background: #0d0d0d;
        background-image: linear-gradient(45deg, #181818 25%, transparent 25%),
                          linear-gradient(-45deg, #181818 25%, transparent 25%),
                          linear-gradient(45deg, transparent 75%, #181818 75%),
                          linear-gradient(-45deg, transparent 75%, #181818 75%);
        background-size: 20px 20px; background-position: 0 0, 0 10px, 10px -10px, -10px 0px;
        display: flex; align-items: center; justify-content: center; overflow: hidden;
      }
      .bg-remover-canvas-wrap {
        position: relative; box-shadow: 0 0 30px rgba(0,0,0,0.5); border: 1px solid #444;
      }
      .bg-remover-canvas-wrap canvas { display: block; max-width: 100%; max-height: 70vh; }
      .bg-remover-footer {
        display: flex; justify-content: flex-end; align-items: center;
        padding: 0 24px; gap: 16px; border-top: 1px solid #333; background: #151515;
      }
      .bg-remover-btn {
        padding: 10px 24px; border-radius: 8px; font-weight: bold; font-size: 14px;
        cursor: pointer; border: none; transition: transform 0.1s;
      }
      .bg-remover-btn:active { transform: scale(0.98); }
      .bg-remover-btn-cancel { background: #3b3b3b; color: #fff; }
      .bg-remover-btn-cancel:hover { background: #4a4a4a; }
      .bg-remover-btn-apply { background: #00d2ff; color: #000; box-shadow: 0 4px 15px rgba(0, 210, 255, 0.4); }
      .bg-remover-btn-apply:hover { background: #00bada; }
      .bg-remover-info {
        font-size: 11px; color: #888; border-top: 1px solid #333; padding-top: 12px; line-height: 1.4;
      }
    `;
    document.head.appendChild(styleEl);
  }

  // Crear la estructura HTML del Modal
  const overlay = document.createElement("div");
  overlay.className = "bg-remover-overlay";

  overlay.innerHTML = `
    <div class="bg-remover-modal">
      <div class="bg-remover-header">
        <h2>✂️ Recorte Manual y Varita Mágica (PhotoRoom Style)</h2>
        <span style="font-size: 13px; color: #888;">EKKO Studio PRO — Alta Definición</span>
      </div>
      <div class="bg-remover-content">
        <div class="bg-remover-sidebar">
          <button class="bg-remover-tool-btn active" id="btnToolBrushErase">
            🧽 Pincel Borrador
          </button>
          <button class="bg-remover-tool-btn" id="btnToolBrushRestore">
            🖌️ Pincel Restaurador
          </button>
          <button class="bg-remover-tool-btn" id="btnToolMagicWand">
            🪄 Varita Mágica
          </button>

          <div class="bg-remover-slider-group" id="groupBrushSize">
            <label id="lblBrushSize">Tamaño del Pincel: 30px</label>
            <input type="range" id="sliderBrushSize" min="2" max="150" value="30">
          </div>

          <div class="bg-remover-slider-group" id="groupBrushFeather">
            <label id="lblBrushFeather">Difuminado (Dureza): 10px</label>
            <input type="range" id="sliderBrushFeather" min="0" max="50" value="10">
          </div>

          <div class="bg-remover-slider-group" id="groupMagicTolerance" style="display: none;">
            <label id="lblMagicTolerance">Tolerancia Varita: 20%</label>
            <input type="range" id="sliderMagicTolerance" min="1" max="100" value="20">
          </div>

          <button class="bg-remover-tool-btn" id="btnResetModal" style="margin-top: auto; background: #441111; color: #ff9999; border-color: #662222;">
            🔄 Reiniciar Imagen
          </button>

          <div class="bg-remover-info">
            💡 <b>Trucos Pro:</b><br>
            • Usa el <b>Borrador</b> para delinear bordes difíciles.<br>
            • La <b>Varita Mágica</b> borra áreas continuas de color similar de un solo clic.<br>
            • Conservación extrema de 300 DPI garantizada para corte láser.
          </div>
        </div>
        <div class="bg-remover-workarea">
          <div class="bg-remover-canvas-wrap">
            <canvas id="bgRemoverCanvas"></canvas>
          </div>
        </div>
      </div>
      <div class="bg-remover-footer">
        <button class="bg-remover-btn bg-remover-btn-cancel" id="btnBgRemoverCancel">Cancelar</button>
        <button class="bg-remover-btn bg-remover-btn-apply" id="btnBgRemoverApply">Aplicar Cambios</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Inicialización del Canvas de Trabajo
  const canvas = document.getElementById("bgRemoverCanvas");
  const ctx = canvas.getContext("2d");

  // Crear canvases internos para conservar calidad extrema e interactuar
  const originalImage = raster.image || raster.canvas;
  const originalWidth = originalImage.width;
  const originalHeight = originalImage.height;

  // Canvas de máscara de transparencia a resolución original extrema (300 DPI)
  const maskCanvas = document.createElement("canvas");
  maskCanvas.width = originalWidth;
  maskCanvas.height = originalHeight;
  const maskCtx = maskCanvas.getContext("2d");

  // Inicializar la máscara (todo visible = blanco opaco)
  maskCtx.fillStyle = "#ffffff";
  maskCtx.fillRect(0, 0, originalWidth, originalHeight);

  // Si la imagen ya tiene transparencias previas, inicializar la máscara en base a ellas
  const initMaskFromAlpha = () => {
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = originalWidth;
    tempCanvas.height = originalHeight;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(originalImage, 0, 0);

    const imgData = tempCtx.getImageData(0, 0, originalWidth, originalHeight);
    const maskData = maskCtx.getImageData(0, 0, originalWidth, originalHeight);

    for (let i = 0; i < imgData.data.length; i += 4) {
      const alpha = imgData.data[i + 3];
      // Si el píxel es transparente en la imagen original, lo marcamos transparente (negro) en la máscara
      if (alpha < 255) {
        maskData.data[i] = 0;     // R
        maskData.data[i + 1] = 0; // G
        maskData.data[i + 2] = 0; // B
        maskData.data[i + 3] = alpha; // Conservar grado exacto de canal Alpha
      }
    }
    maskCtx.putImageData(maskData, 0, 0);
  };
  initMaskFromAlpha();

  // Escalar el tamaño del lienzo en pantalla para edición fluida
  const maxDisplaySize = 800;
  let displayWidth = originalWidth;
  let displayHeight = originalHeight;
  if (originalWidth > maxDisplaySize || originalHeight > maxDisplaySize) {
    const scale = Math.min(maxDisplaySize / originalWidth, maxDisplaySize / originalHeight);
    displayWidth = Math.round(originalWidth * scale);
    displayHeight = Math.round(originalHeight * scale);
  }

  canvas.width = displayWidth;
  canvas.height = displayHeight;

  // Variables de Estado de Edición
  let currentTool = "erase"; // "erase", "restore", "magic"
  let isDrawing = false;
  let brushSize = 30;
  let brushFeather = 10;
  let magicTolerance = 20;

  // UI Control Mappings
  const btnErase = document.getElementById("btnToolBrushErase");
  const btnRestore = document.getElementById("btnToolBrushRestore");
  const btnMagic = document.getElementById("btnToolMagicWand");
  const sliderSize = document.getElementById("sliderBrushSize");
  const sliderFeather = document.getElementById("sliderBrushFeather");
  const sliderTolerance = document.getElementById("sliderMagicTolerance");

  const lblSize = document.getElementById("lblBrushSize");
  const lblFeather = document.getElementById("lblBrushFeather");
  const lblTolerance = document.getElementById("lblMagicTolerance");

  const groupBrushSize = document.getElementById("groupBrushSize");
  const groupBrushFeather = document.getElementById("groupBrushFeather");
  const groupMagicTolerance = document.getElementById("groupMagicTolerance");

  function setTool(tool) {
    currentTool = tool;
    btnErase.classList.remove("active");
    btnRestore.classList.remove("active");
    btnMagic.classList.remove("active");

    groupBrushSize.style.display = "none";
    groupBrushFeather.style.display = "none";
    groupMagicTolerance.style.display = "none";

    if (tool === "erase") {
      btnErase.classList.add("active");
      groupBrushSize.style.display = "flex";
      groupBrushFeather.style.display = "flex";
    } else if (tool === "restore") {
      btnRestore.classList.add("active");
      groupBrushSize.style.display = "flex";
      groupBrushFeather.style.display = "flex";
    } else if (tool === "magic") {
      btnMagic.classList.add("active");
      groupMagicTolerance.style.display = "flex";
    }
  }

  btnErase.onclick = () => setTool("erase");
  btnRestore.onclick = () => setTool("restore");
  btnMagic.onclick = () => setTool("magic");

  sliderSize.oninput = (e) => {
    brushSize = parseInt(e.target.value);
    lblSize.textContent = `Tamaño del Pincel: ${brushSize}px`;
  };

  sliderFeather.oninput = (e) => {
    brushFeather = parseInt(e.target.value);
    lblFeather.textContent = `Difuminado (Dureza): ${brushFeather}px`;
  };

  sliderTolerance.oninput = (e) => {
    magicTolerance = parseInt(e.target.value);
    lblTolerance.textContent = `Tolerancia Varita: ${magicTolerance}%`;
  };

  // --- RENDERIZADO DEL CANVAS EN TIEMPO REAL ---
  function render() {
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    // 1. Crear canvas temporal de composición
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = originalWidth;
    tempCanvas.height = originalHeight;
    const tempCtx = tempCanvas.getContext("2d");

    // 2. Dibujar la imagen original
    tempCtx.drawImage(originalImage, 0, 0);

    // 3. Aplicar máscara en modo "destination-in" (conserva lo que coincide con blanco de la máscara)
    tempCtx.globalCompositeOperation = "destination-in";
    tempCtx.drawImage(maskCanvas, 0, 0);

    // 4. Dibujar la composición resultante en el canvas visual de la UI
    ctx.drawImage(tempCanvas, 0, 0, displayWidth, displayHeight);
  }
  render();

  // --- LÓGICA DE DIBUJO MANUAL (PINCEL EN MÁSCARA) ---
  function drawBrush(e) {
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / displayWidth) * originalWidth;
    const y = ((e.clientY - rect.top) / displayHeight) * originalHeight;

    maskCtx.save();
    
    // Crear degradado radial para dureza/feathering del pincel
    const grad = maskCtx.createRadialGradient(x, y, (brushSize - brushFeather) / 2, x, y, brushSize / 2);
    
    if (currentTool === "erase") {
      // Borrar: degradado hacia transparente (negro con alpha 1 en máscara invertida o borrado de destino)
      grad.addColorStop(0, "rgba(0,0,0,1)");
      grad.addColorStop(1, "rgba(0,0,0,0)");
      maskCtx.globalCompositeOperation = "destination-out";
    } else {
      // Restaurar: degradado hacia opaco (blanco en máscara)
      grad.addColorStop(0, "rgba(255,255,255,1)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      maskCtx.globalCompositeOperation = "source-over";
    }

    maskCtx.fillStyle = grad;
    maskCtx.beginPath();
    maskCtx.arc(x, y, brushSize / 2, 0, Math.PI * 2);
    maskCtx.fill();
    maskCtx.restore();

    render();
  }

  // --- LÓGICA DE VARITA MÁGICA (FLOOD FILL EN CANVAS DE ORIGEN) ---
  function executeMagicWand(e) {
    const rect = canvas.getBoundingClientRect();
    // Posiciones en coordenada original extrema de la imagen
    const clickX = Math.round(((e.clientX - rect.left) / displayWidth) * originalWidth);
    const clickY = Math.round(((e.clientY - rect.top) / displayHeight) * originalHeight);

    // Crear canvas temporal para leer los píxeles originales
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = originalWidth;
    tempCanvas.height = originalHeight;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.drawImage(originalImage, 0, 0);

    const imgData = tempCtx.getImageData(0, 0, originalWidth, originalHeight);
    const data = imgData.data;

    // Obtener color del píxel seleccionado de origen
    const targetIdx = (clickY * originalWidth + clickX) * 4;
    const targetR = data[targetIdx];
    const targetG = data[targetIdx + 1];
    const targetB = data[targetIdx + 2];

    // Array de visitados para flood fill
    const visited = new Uint8Array(originalWidth * originalHeight);
    const queue = [[clickX, clickY]];
    
    // Obtener los datos de píxel de la máscara para modificarlos directamente
    const maskData = maskCtx.getImageData(0, 0, originalWidth, originalHeight);
    const mData = maskData.data;

    // Distancia cromática permitida en base a la tolerancia slider
    const maxDistance = (magicTolerance / 100) * 255;

    while (queue.length > 0) {
      const [currX, currY] = queue.shift();
      const idx = currY * originalWidth + currX;

      if (visited[idx]) continue;
      visited[idx] = 1;

      const pixelIdx = idx * 4;
      const r = data[pixelIdx];
      const g = data[pixelIdx + 1];
      const b = data[pixelIdx + 2];

      // Cálculo de distancia de color (Euclidiana)
      const distance = Math.sqrt(
        Math.pow(r - targetR, 2) +
        Math.pow(g - targetG, 2) +
        Math.pow(b - targetB, 2)
      );

      if (distance <= maxDistance) {
        // Marcamos la máscara como totalmente transparente (canal alpha = 0)
        mData[pixelIdx] = 0;
        mData[pixelIdx + 1] = 0;
        mData[pixelIdx + 2] = 0;
        mData[pixelIdx + 3] = 0;

        // Añadir vecinos 4-conectados
        if (currX > 0 && !visited[idx - 1]) queue.push([currX - 1, currY]);
        if (currX < originalWidth - 1 && !visited[idx + 1]) queue.push([currX + 1, currY]);
        if (currY > 0 && !visited[idx - originalWidth]) queue.push([currX, currY - 1]);
        if (currY < originalHeight - 1 && !visited[idx + originalWidth]) queue.push([currX, currY + 1]);
      }
    }

    maskCtx.putImageData(maskData, 0, 0);
    render();
  }

  // --- GESTIÓN DE EVENTOS DE MOUSE EN CANVAS ---
  canvas.onmousedown = (e) => {
    if (currentTool === "magic") {
      executeMagicWand(e);
    } else {
      isDrawing = true;
      drawBrush(e);
    }
  };

  canvas.onmousemove = (e) => {
    if (isDrawing && (currentTool === "erase" || currentTool === "restore")) {
      drawBrush(e);
    }
  };

  window.onmouseup = () => {
    isDrawing = false;
  };

  // --- BOTÓN REINICIAR IMAGEN ---
  document.getElementById("btnResetModal").onclick = () => {
    if (confirm("¿Estás seguro de que deseas restaurar la imagen original por completo?")) {
      maskCtx.fillStyle = "#ffffff";
      maskCtx.fillRect(0, 0, originalWidth, originalHeight);
      initMaskFromAlpha();
      render();
    }
  };

  // --- BOTÓN CANCELAR ---
  document.getElementById("btnBgRemoverCancel").onclick = () => {
    overlay.remove();
  };

  // --- BOTÓN APLICAR CAMBIOS (Compila y guarda a resolución original extrema) ---
  document.getElementById("btnBgRemoverApply").onclick = () => {
    // 1. Crear canvas final de exportación a resolución original exacta (Alta calidad)
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = originalWidth;
    exportCanvas.height = originalHeight;
    const exportCtx = exportCanvas.getContext("2d");

    // Dibujar original
    exportCtx.drawImage(originalImage, 0, 0);

    // Aplicar máscara
    exportCtx.globalCompositeOperation = "destination-in";
    exportCtx.drawImage(maskCanvas, 0, 0);

    // 2. Exportar como DataURL PNG de alta fidelidad
    const resultDataUrl = exportCanvas.toDataURL("image/png");

    if (typeof window.saveHistory === "function") window.saveHistory();

    const oldPosition = raster.position.clone();
    const oldBounds = raster.bounds.clone();

    // Reemplazar la fuente
    raster.source = resultDataUrl;

    raster.onLoad = () => {
      // Re-escalar y posicionar exactamente en su lugar
      const scaleX = oldBounds.width / raster.bounds.width;
      const scaleY = oldBounds.height / raster.bounds.height;
      raster.scale(scaleX, scaleY);
      raster.position = oldPosition;

      if (typeof window.updateSelectionBox === "function") {
        window.updateSelectionBox(item);
      }
      paper.view.update();
      console.log("✅ Recorte manual completado a resolución extrema.");
    };

    overlay.remove();
  };
}

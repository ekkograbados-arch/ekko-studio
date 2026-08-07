
/* =========================================================================
   Moore-Neighbor Tracing (Algoritmo de seguimiento de bordes para imágenes)
   ========================================================================= */
function traceImageOutline(raster, threshold, cutoff, smoothness, sketchMode) {
  const imgElement = raster.image || raster.canvas;
  if (!imgElement) return new paper.Path.Rectangle(raster.bounds);

  // Reducimos la cuadrícula a 120x120 para optimizar el rendimiento y lograr un refresco instantáneo sin lag
  const tw = 120;
  const th = 120;
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = tw;
  tempCanvas.height = th;
  const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
  
  if (!tempCtx) return new paper.Path.Rectangle(raster.bounds);
  
  try {
    tempCtx.drawImage(imgElement, 0, 0, tw, th);
  } catch (e) {
    console.warn("Error CORS o de carga en canvas temporal:", e);
    return new paper.Path.Rectangle(raster.bounds);
  }

  let imgData;
  try {
    imgData = tempCtx.getImageData(0, 0, tw, th);
  } catch (e) {
    console.warn("No se pudo leer píxeles de la imagen:", e);
    return new paper.Path.Rectangle(raster.bounds);
  }

  const data = imgData.data;

  // Crear una cuadrícula binaria de píxeles sólidos
  const grid = [];
  for (let y = 0; y < th; y++) {
    grid[y] = new Uint8Array(tw);
    for (let x = 0; x < tw; x++) {
      const idx = (y * tw + x) * 4;
      const r = data[idx];
      const g = data[idx+1];
      const b = data[idx+2];
      const a = data[idx+3];
      
      const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
      
      if (a < 30) {
        grid[y][x] = 0;
        continue;
      }
      
      let isSolid = false;
      if (sketchMode) {
        // Trazado de Croquis (Sketch Trace): Umbral adaptativo local usando vecinos 5x5
        let sum = 0;
        let count = 0;
        const radius = 2;
        for (let ny = Math.max(0, y - radius); ny <= Math.min(th - 1, y + radius); ny++) {
          for (let nx = Math.max(0, x - radius); nx <= Math.min(tw - 1, x + radius); nx++) {
            const nIdx = (ny * tw + nx) * 4;
            sum += 0.299 * data[nIdx] + 0.587 * data[nIdx+1] + 0.114 * data[nIdx+2];
            count++;
          }
        }
        const avg = count > 0 ? sum / count : 128;
        // Si el brillo es más oscuro que su entorno local, es una línea trazable (croquis)
        isSolid = (luminance <= avg - 10) && (luminance >= cutoff);
      } else {
        // Rango de Trazado estándar (Cutoff + Threshold al estilo LightBurn)
        isSolid = (luminance >= cutoff) && (luminance <= threshold);
      }
      grid[y][x] = isSolid ? 1 : 0;
    }
  }

  // Dilatación matemática ligera (1 píxel) para unir dither dots y trazos finos sin perder precisión
  const dilated = [];
  for (let y = 0; y < th; y++) {
    dilated[y] = new Uint8Array(tw);
  }

  const padding = 1; // 1px de radio mantiene la fidelidad de siluetas de personas y autos
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      if (grid[y][x] === 1) {
        const yMin = Math.max(0, y - padding);
        const yMax = Math.min(th - 1, y + padding);
        const xMin = Math.max(0, x - padding);
        const xMax = Math.min(tw - 1, x + padding);
        for (let ny = yMin; ny <= yMax; ny++) {
          for (let nx = xMin; nx <= xMax; nx++) {
            dilated[ny][nx] = 1;
          }
        }
      }
    }
  }

  // Buscar el primer píxel sólido en la cuadrícula
  let startX = -1, startY = -1;
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      if (dilated[y][x] === 1) {
        startX = x;
        startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }

  if (startX === -1) {
    return new paper.Path.Rectangle(raster.bounds);
  }

  // Algoritmo Moore-Neighbor Tracing
  const points = [];
  let cx = startX;
  let cy = startY;

  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];
  let dir = 7;
  let loopCount = 0;
  const maxLoops = tw * th * 2;
  const visited = new Set();

  do {
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (dir + i) % 8;
      const nx = cx + dx[checkDir];
      const ny = cy + dy[checkDir];
      if (nx >= 0 && nx < tw && ny >= 0 && ny < th && dilated[ny][nx] === 1) {
        cx = nx;
        cy = ny;
        points.push(new paper.Point(cx, cy));
        dir = (checkDir + 5) % 8;
        found = true;
        break;
      }
    }
    if (!found) break;

    const key = cx + "," + cy;
    if (visited.has(key) && cx === startX && cy === startY) {
      break;
    }
    visited.add(key);
    loopCount++;
  } while (loopCount < maxLoops);

  if (points.length < 3) {
    return new paper.Path.Rectangle(raster.bounds);
  }

  // Mapear coordenadas de la matriz temporal 120x120 al tamaño real del objeto en el Canvas
  const bounds = raster.bounds;
  const rx = bounds.left;
  const ry = bounds.top;
  const rw = bounds.width;
  const rh = bounds.height;

  const paperPoints = points.map(function(p) {
    const px = rx + (p.x / tw) * rw;
    const py = ry + (p.y / th) * rh;
    return new paper.Point(px, py);
  });

  const path = new paper.Path(paperPoints);
  path.closed = true;
  path.simplify(smoothness); // Suavizado regulable al estilo LightBurn
  return path;
}

/* =========================================================================
   Manejo de Aplicación y Eliminación de Recorte / Máscaras de Imagen
   ========================================================================= */
window.enterInteractiveCropMode = function() {
  if (!window.selectedItem) return;
  const raster = (window.selectedItem.data?.clipGroup)
    ? window.selectedItem.children.find(function(c) { return !c.clipMask; })
    : window.selectedItem;
    
  if (raster && raster instanceof paper.Raster) {
    // Buscar un vector cerrado en el layer que intersecte la imagen para usar como molde de corte
    const activeItems = paper.project.activeLayer.children;
    const maskPath = activeItems.find(function(item) {
      return item !== window.selectedItem && 
             (item instanceof paper.Path || item instanceof paper.CompoundPath) && 
             item.bounds.intersects(raster.bounds);
    });
    
    if (maskPath) {
      window.cropModeActive = true;
      window.cropRaster = raster;
      window.cropMaskPath = maskPath;
      
      const canvasEl = document.getElementById("editorCanvas");
      if (canvasEl) canvasEl.style.cursor = "crosshair";
      
      const selInfo = document.getElementById("selectionInfo");
      if (selInfo) {
        selInfo.innerHTML = "<strong style='color:#dc3545;'>MODO RECORTE INTERACTIVO:</strong> Haz clic <strong>DENTRO</strong> para siluetear (quitar fondo), o <strong>FUERA</strong> para troquelar (hacer hueco).";
      }
      
      alert("¡MODO RECORTE ACTIVO!\n\n1. Haz clic DENTRO de la silueta para conservar el objeto y eliminar el fondo (siluetear).\n2. Haz clic FUERA de la silueta para conservar el fondo y calar el interior (troquelar).");
    } else {
      alert("Por favor, genera primero el contorno azul sobre la imagen usando la herramienta de Trazar Imagen.");
    }
  }
};

window.removeMaskFromSelectedImage = function() {
  if (window.selectedItem && window.selectedItem.data?.clipGroup) {
    if (window.saveHistory) window.saveHistory();
    const mask = window.selectedItem.children.find(function(c) { return c.clipMask; });
    const content = window.selectedItem.children.find(function(c) { return !c.clipMask; });
    
    if (mask && content) {
      const restoredMask = mask.clone();
      restoredMask.clipMask = false;
      restoredMask.visible = true;
      restoredMask.strokeColor = new paper.Color('#007bff');
      restoredMask.strokeWidth = 2;
      restoredMask.fillColor = null;
      restoredMask.data = { locked: false, label: "Trazado" };
      
      const restoredRaster = content.clone();
      restoredRaster.data = { locked: false, label: "Imagen" };
      
      paper.project.activeLayer.addChild(restoredRaster);
      paper.project.activeLayer.addChild(restoredMask);
      
      if (window.currentMockup) {
        restoredRaster.insertBelow(window.currentMockup);
        restoredMask.insertBelow(window.currentMockup);
      }
      
      window.selectedItem.remove();
      window.selectItem(restoredRaster);
      paper.view.update();
    }
  }
};

/* =========================================================================
   Creación de Menú de Clic Derecho Contextual (Replica LightBurn & Canva)
   ========================================================================= */
function createContextMenuHTML() {
  if (document.getElementById('custom-context-menu')) return;
  const menu = document.createElement('div');
  menu.id = 'custom-context-menu';
  menu.style.position = 'absolute';
  menu.style.display = 'none';
  menu.style.backgroundColor = '#ffffff';
  menu.style.border = '1px solid #cbd5e1';
  menu.style.borderRadius = '8px';
  menu.style.boxShadow = '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1)';
  menu.style.zIndex = '1000';
  menu.style.padding = '6px 0';
  menu.style.minWidth = '180px';
  menu.style.userSelect = 'none';
  
  const styles = document.createElement('style');
  styles.textContent = `
    .context-menu-item {
      padding: 8px 14px;
      font-size: 13px;
      color: #334155;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: background 0.15s;
    }
    .context-menu-item:hover {
      background-color: #f1f5f9;
      color: #0f172a;
    }
    .context-menu-separator {
      height: 1px;
      background-color: #cbd5e1;
      margin: 4px 0;
    }
    .context-menu-header {
      padding: 4px 14px;
      font-size: 10px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
  `;
  document.head.appendChild(styles);
  document.body.appendChild(menu);
}

window.showRightClickMenu = function(x, y, item) {
  const menu = document.getElementById('custom-context-menu');
  if (!menu) return;
  
  menu.innerHTML = "";
  
  if (!item) {
    // Menú genérico de pantalla (Clic en zona vacía)
    menu.innerHTML = `
      <div class="context-menu-header">Canvas</div>
      <div class="context-menu-item" id="ctxMenuAddText"><i class="fas fa-font"></i> Agregar Texto</div>
      <div class="context-menu-item" id="ctxMenuFit"><i class="fas fa-compress"></i> Ajustar Vista</div>
    `;
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    menu.style.display = 'block';
    
    document.getElementById('ctxMenuAddText').onclick = () => {
      document.getElementById('btnAddText').click();
      menu.style.display = 'none';
    };
    document.getElementById('ctxMenuFit').onclick = () => {
      document.getElementById('btnFit').click();
      menu.style.display = 'none';
    };
    return;
  }
  
  // Menú con objeto seleccionado
  window.selectItem(item);
  const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
  
  let itemMenuHTML = `
    <div class="context-menu-header">Edición General</div>
    <div class="context-menu-item" id="ctxMenuDup"><i class="fas fa-copy"></i> Duplicar</div>
    <div class="context-menu-item" id="ctxMenuDel" style="color:#dc3545;"><i class="fas fa-trash"></i> Eliminar</div>
    <div class="context-menu-separator"></div>
    <div class="context-menu-header">Capas (Láser)</div>
    <div class="context-menu-item" id="ctxMenuFront"><i class="fas fa-layer-group"></i> Traer al Frente</div>
    <div class="context-menu-item" id="ctxMenuBack"><i class="fas fa-layer-group"></i> Enviar al Fondo</div>
  `;
  
  if (target instanceof paper.Raster) {
    itemMenuHTML += `
      <div class="context-menu-separator"></div>
      <div class="context-menu-header">Trazado e Imagen</div>
      <div class="context-menu-item" id="ctxMenuTrace"><i class="fas fa-magic"></i> 🪄 Trazar Contorno</div>
      <div class="context-menu-item" id="ctxMenuCrop"><i class="fas fa-crop-alt"></i> ✂️ Recortar Imagen</div>
    `;
    if (item.data?.clipGroup) {
      itemMenuHTML += `
        <div class="context-menu-item" id="ctxMenuUncrop"><i class="fas fa-unlock"></i> 🔓 Quitar Recorte</div>
      `;
    }
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath) {
    itemMenuHTML += `
      <div class="context-menu-separator"></div>
      <div class="context-menu-header">Herramientas Vectoriales</div>
      <div class="context-menu-item" id="ctxMenuNodes"><i class="fas fa-bezier-curve"></i> ☋ Editar Nodos</div>
      <div class="context-menu-item" id="ctxMenuSubtract"><i class="fas fa-eraser"></i> Evitar Superposición</div>
    `;
  }
  
  menu.innerHTML = itemMenuHTML;
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  menu.style.display = 'block';
  
  // Vincular eventos del menú contextual
  document.getElementById('ctxMenuDup').onclick = () => {
    document.getElementById('btnCtxDuplicate').click();
    menu.style.display = 'none';
  };
  document.getElementById('ctxMenuDel').onclick = () => {
    document.getElementById('btnCtxDelete').click();
    menu.style.display = 'none';
  };
  document.getElementById('ctxMenuFront').onclick = () => {
    document.getElementById('btnCtxForward').click();
    menu.style.display = 'none';
  };
  document.getElementById('ctxMenuBack').onclick = () => {
    document.getElementById('btnCtxBackward').click();
    menu.style.display = 'none';
  };
  
  const mTrace = document.getElementById('ctxMenuTrace');
  if (mTrace) {
    mTrace.onclick = () => {
      document.getElementById('btnCtxTrace').click();
      menu.style.display = 'none';
    };
  }
  const mCrop = document.getElementById('ctxMenuCrop');
  if (mCrop) {
    mCrop.onclick = () => {
      document.getElementById('btnCtxApplyMask').click();
      menu.style.display = 'none';
    };
  }
  const mUncrop = document.getElementById('ctxMenuUncrop');
  if (mUncrop) {
    mUncrop.onclick = () => {
      document.getElementById('btnCtxRemoveMask').click();
      menu.style.display = 'none';
    };
  }
  const mNodes = document.getElementById('ctxMenuNodes');
  if (mNodes) {
    mNodes.onclick = () => {
      document.getElementById('btnCtxNodeEdit').click();
      menu.style.display = 'none';
    };
  }
  const mSub = document.getElementById('ctxMenuSubtract');
  if (mSub) {
    mSub.onclick = () => {
      document.getElementById('btnCtxSubtract').click();
      menu.style.display = 'none';
    };
  }
};

// Cerrar el menú contextual al hacer clic fuera
document.addEventListener('click', function(e) {
  const menu = document.getElementById('custom-context-menu');
  if (menu && !menu.contains(e.target)) {
    menu.style.display = 'none';
  }
});

/* =========================================================================
   Inicialización y Eventos del Menú Contextual
   ========================================================================= */
export function initContextualMenu() {
  createContextMenuHTML();
  
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  // --- 1. ACCIONES GENERALES ---
  document.getElementById('btnCtxDelete').onclick = () => {
    if (window.selectedItem) {
      if (window.selectedItem.data?.mockup) return;
      window.selectedItem.remove();
      window.deselectItem();
      hideContextualMenu();
    }
  };

  document.getElementById('btnCtxDuplicate').onclick = () => {
    if (window.selectedItem && !window.selectedItem.data?.locked) {
      if (window.selectedItem.data?.mockup) return;
      
      let finalClone;
      if (window.selectedItem.data?.clipGroup) {
        const rawContent = window.selectedItem.children.find(function(c) { return !c.clipMask; });
        if (rawContent) {
          const clonedRaw = rawContent.clone();
          clonedRaw.position = clonedRaw.position.add(new paper.Point(20, 20));
          clonedRaw.data = { ...(clonedRaw.data || {}), locked: false, label: `${window.selectedItem.data.label || "Objeto"} copia` };
          
          if (typeof window.clipItem === "function") {
            finalClone = window.clipItem(clonedRaw);
          } else {
            finalClone = clonedRaw;
          }
        }
      } else {
        finalClone = window.selectedItem.clone();
        finalClone.position = finalClone.position.add(new paper.Point(20, 20));
        finalClone.data = { ...(finalClone.data || {}), locked: false };
      }
      
      if (finalClone) {
        paper.project.activeLayer.addChild(finalClone);
        window.selectItem(finalClone);
        if (typeof window.updateSelectionBox === "function") {
          window.updateSelectionBox(finalClone);
        }
        updateContextualMenu(finalClone);
        paper.view.update();
      }
    }
  };

  // --- BOTONES DE ESCALADO SIMÉTRICO (Canva Style) ---
  const btnCtxScaleUp = document.getElementById('btnCtxScaleUp');
  if (btnCtxScaleUp) {
    btnCtxScaleUp.onclick = function() {
      if (window.selectedItem && !window.selectedItem.data?.mockup) {
        const target = (window.selectedItem.data?.clipGroup)
          ? window.selectedItem.children.find(function(c) { return !c.clipMask; })
          : window.selectedItem;
        
        if (target) {
          target.scale(1.1, 1.1, target.position);
          window.updateSelectionBox(window.selectedItem);
          updateContextualMenu(window.selectedItem);
          paper.view.update();
        }
      }
    };
  }

  const btnCtxScaleDown = document.getElementById('btnCtxScaleDown');
  if (btnCtxScaleDown) {
    btnCtxScaleDown.onclick = function() {
      if (window.selectedItem && !window.selectedItem.data?.mockup) {
        const target = (window.selectedItem.data?.clipGroup)
          ? window.selectedItem.children.find(function(c) { return !c.clipMask; })
          : window.selectedItem;
        
        if (target) {
          target.scale(0.9, 0.9, target.position);
          window.updateSelectionBox(window.selectedItem);
          updateContextualMenu(window.selectedItem);
          paper.view.update();
        }
      }
    };
  }

  // --- ACCIONES DE RECORTE DE IMAGEN ---
  const btnCtxApplyMask = document.getElementById('btnCtxApplyMask');
  if (btnCtxApplyMask) {
    btnCtxApplyMask.onclick = function() {
      window.enterInteractiveCropMode();
    };
  }

  const btnCtxRemoveMask = document.getElementById('btnCtxRemoveMask');
  if (btnCtxRemoveMask) {
    btnCtxRemoveMask.onclick = function() {
      window.removeMaskFromSelectedImage();
    };
  }

  // --- EDICIÓN DE NODOS VECTORIALES (Canva Style) ---
  const btnCtxNodeEdit = document.getElementById('btnCtxNodeEdit');
  if (btnCtxNodeEdit) {
    btnCtxNodeEdit.onclick = function() {
      if (window.selectedItem && (window.selectedItem instanceof paper.Path || window.selectedItem instanceof paper.CompoundPath)) {
        window.enterNodeEditMode(window.selectedItem);
      }
    };
  }

  const btnCtxDeleteNode = document.getElementById('btnCtxDeleteNode');
  if (btnCtxDeleteNode) {
    btnCtxDeleteNode.onclick = function() {
      if (window.nodeEditMode && window.nodeEditTarget && window.selectedNodeIndex !== -1) {
        if (window.nodeEditTarget.segments.length > 3) {
          if (window.saveHistory) window.saveHistory();
          window.nodeEditTarget.removeSegment(window.selectedNodeIndex);
          window.selectedNodeIndex = -1;
          window.drawNodeEditHandles(window.nodeEditTarget);
          paper.view.update();
        } else {
          alert("Un vector cerrado debe tener al menos 3 nodos.");
        }
      }
    };
  }

  const btnCtxExitNodeEdit = document.getElementById('btnCtxExitNodeEdit');
  if (btnCtxExitNodeEdit) {
    btnCtxExitNodeEdit.onclick = function() {
      window.exitNodeEditMode();
    };
  }

  // --- CONTROL DE TRAZADO LIVE (LightBurn Style Throttled) ---
  const btnCtxTrace = document.getElementById('btnCtxTrace');
  const sliderThreshold = document.getElementById('ctxTraceThreshold');
  const sliderCutoff = document.getElementById('ctxTraceCutoff');
  const sliderSmooth = document.getElementById('ctxTraceSmooth');
  const chkSketch = document.getElementById('ctxTraceSketch');
  const lblThreshold = document.getElementById('lblTraceThreshold');
  const lblCutoff = document.getElementById('lblTraceCutoff');
  const lblSmooth = document.getElementById('lblTraceSmooth');
  let activeRasterForTrace = null;

  function runLiveTrace() {
    if (!activeRasterForTrace) return;
    
    if (window.tracePreviewPath) {
      window.tracePreviewPath.remove();
      window.tracePreviewPath = null;
    }

    const tVal = sliderThreshold ? parseInt(sliderThreshold.value) : 128;
    const cVal = sliderCutoff ? parseInt(sliderCutoff.value) : 0;
    const sVal = sliderSmooth ? parseFloat(sliderSmooth.value) : 1.5;
    const isSketch = chkSketch ? chkSketch.checked : false;

    if (lblThreshold) lblThreshold.textContent = tVal;
    if (lblCutoff) lblCutoff.textContent = cVal;
    if (lblSmooth) lblSmooth.textContent = sVal.toFixed(1);

    const path = traceImageOutline(activeRasterForTrace, tVal, cVal, sVal, isSketch);
    if (path) {
      path.strokeColor = new paper.Color('#007bff');
      path.strokeWidth = 2 / paper.view.zoom;
      path.dashArray = [6 / paper.view.zoom, 4 / paper.view.zoom]; // Línea dashed azul
      path.fillColor = null;
      path.data = { isSelectionBox: true }; // Evita selecciones accidentales durante preview
      
      paper.project.activeLayer.addChild(path);
      if (window.currentMockup) {
        path.insertBelow(window.currentMockup);
      }
      window.tracePreviewPath = path;
      paper.view.update();
    }
  }

  // Throttling usando requestAnimationFrame para garantizar un refresco suave y ultra rápido (sin delays)
  let tracePending = false;
  function scheduleLiveTrace() {
    if (tracePending) return;
    tracePending = true;
    requestAnimationFrame(() => {
      runLiveTrace();
      tracePending = false;
    });
  }

  if (btnCtxTrace) {
    btnCtxTrace.onclick = function() {
      if (window.selectedItem) {
        const raster = (window.selectedItem.data?.clipGroup) 
          ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) 
          : window.selectedItem;
          
        if (raster && raster instanceof paper.Raster) {
          activeRasterForTrace = raster;
          // Mostrar panel del trazador interactivo de LightBurn
          document.getElementById('ctxImageControls').classList.add('hidden');
          document.getElementById('ctxTraceControls').classList.remove('hidden');
          if (btnCtxTrace) btnCtxTrace.style.display = 'none';
          
          runLiveTrace(); // Trazado dinámico inicial
        }
      }
    };
  }

  // Vincular eventos dinámicos a deslizadores
  [sliderThreshold, sliderCutoff, sliderSmooth, chkSketch].forEach(function(el) {
    if (el) {
      el.oninput = function() {
        scheduleLiveTrace();
      };
      el.onchange = function() {
        scheduleLiveTrace();
      };
    }
  });

  const btnCtxTraceApply = document.getElementById('btnCtxTraceApply');
  if (btnCtxTraceApply) {
    btnCtxTraceApply.onclick = function() {
      if (window.tracePreviewPath) {
        if (window.saveHistory) window.saveHistory();
        
        const finalPath = window.tracePreviewPath;
        finalPath.strokeColor = new paper.Color('#007bff');
        finalPath.strokeWidth = 2;
        finalPath.dashArray = null; // Línea continua sólida definitiva
        finalPath.data = { locked: false, label: "Trazado " + (activeRasterForTrace.data?.label || "Imagen") };
        
        window.tracePreviewPath = null;
        activeRasterForTrace = null;
        
        document.getElementById('ctxTraceControls').classList.add('hidden');
        window.selectItem(finalPath);
        paper.view.update();
      }
    };
  }

  const btnCtxTraceCancel = document.getElementById('btnCtxTraceCancel');
  if (btnCtxTraceCancel) {
    btnCtxTraceCancel.onclick = function() {
      if (window.tracePreviewPath) {
        window.tracePreviewPath.remove();
        window.tracePreviewPath = null;
      }
      activeRasterForTrace = null;
      document.getElementById('ctxTraceControls').classList.add('hidden');
      if (window.selectedItem) {
        window.selectItem(window.selectedItem);
      } else {
        hideContextualMenu();
      }
      paper.view.update();
    };
  }

  // --- BOTÓN RECORTAR FONDO / EVITAR SUPERPOSICIÓN ---
  const btnCtxSubtract = document.getElementById('btnCtxSubtract');
  if (btnCtxSubtract) {
    btnCtxSubtract.onclick = function() {
      if (window.selectedItem) {
        let outlinePath = null;
        if (window.selectedItem.data?.clipGroup) {
          const raster = window.selectedItem.children.find(function(c) { return !c.clipMask; });
          if (raster && raster instanceof paper.Raster) {
            outlinePath = traceImageOutline(raster, 128, 0, 1.5, false);
          }
        } else if (window.selectedItem instanceof paper.Raster) {
          outlinePath = traceImageOutline(window.selectedItem, 128, 0, 1.5, false);
        } else if (window.selectedItem instanceof paper.PointText) {
          outlinePath = new paper.Path.Rectangle(window.selectedItem.bounds);
        } else if (window.selectedItem instanceof paper.Path || window.selectedItem instanceof paper.CompoundPath) {
          outlinePath = window.selectedItem.clone();
        }

        if (!outlinePath) {
          alert("No se pudo calcular la geometría de contorno para este objeto.");
          return;
        }
        
        outlinePath.visible = false;
        
        const children = paper.project.activeLayer.children.slice();
        const targetIndex = children.indexOf(window.selectedItem);
        if (targetIndex === -1) return;
        
        let subbedCount = 0;
        for (let i = 0; i < targetIndex; i++) {
          const otherItem = children[i];
          if (otherItem.data?.mockup || otherItem.data?.isSelectionBox || otherItem === window.selectedItem) {
            continue;
          }
          
          if (otherItem instanceof paper.Path || otherItem instanceof paper.CompoundPath) {
            if (otherItem.bounds.intersects(outlinePath.bounds)) {
              const result = otherItem.subtract(outlinePath);
              if (result) {
                result.data = { ...(otherItem.data || {}) };
                otherItem.replaceWith(result);
                subbedCount++;
              }
            }
          } else if (otherItem.data?.clipGroup) {
            const mask = otherItem.children.find(function(c) { return c.clipMask; });
            if (mask && mask.bounds.intersects(outlinePath.bounds)) {
              const resultMask = mask.subtract(outlinePath);
              if (resultMask) {
                resultMask.clipMask = true;
                mask.replaceWith(resultMask);
                subbedCount++;
              }
            }
          }
        }
        
        outlinePath.remove();
        
        if (subbedCount > 0) {
          const temp = window.selectedItem;
          window.deselectItem();
          window.selectItem(temp);
          paper.view.update();
          alert("¡Recorte completado con éxito! Se eliminaron las superposiciones debajo de este objeto.");
        } else {
          alert("No se encontraron trazados vectoriales superpuestos debajo de este objeto.");
        }
      }
    };
  }

  document.getElementById('btnCtxForward').onclick = function() {
    if (window.selectedItem) {
      if (window.selectedItem.data?.mockup) return;
      window.selectedItem.bringToFront();
      paper.view.update();
    }
  };

  document.getElementById('btnCtxBackward').onclick = function() {
    if (window.selectedItem) {
      if (window.selectedItem.data?.mockup) return;
      window.selectedItem.sendToBack();
      if (window.currentMockup) {
        window.selectedItem.insertBelow(window.currentMockup);
      }
      paper.view.update();
    }
  };

  // --- 2. ACCIONES DE TEXTO ---
  const fontSelector = document.getElementById('ctxFontSelector');
  if (fontSelector) {
    fontSelector.onchange = function() {
      if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
        window.selectedItem.fontFamily = fontSelector.value;
        paper.view.update();
      }
    };
  }

  const fontSizeInput = document.getElementById('ctxFontSize');
  if (fontSizeInput) {
    fontSizeInput.oninput = function() {
      if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
        const val = parseFloat(fontSizeInput.value);
        if (val && val > 0) {
          window.selectedItem.fontSize = val;
          paper.view.update();
          window.updateSelectionBox(window.selectedItem);
          updateContextualMenu(window.selectedItem);
        }
      }
    };
  }

  const btnBold = document.getElementById('btnCtxBold');
  if (btnBold) {
    btnBold.onclick = function() {
      if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
        const isBold = window.selectedItem.fontWeight === 'bold';
        window.selectedItem.fontWeight = isBold ? 'normal' : 'bold';
        paper.view.update();
      }
    };
  }

  const btnItalic = document.getElementById('btnCtxItalic');
  if (btnItalic) {
    btnItalic.onclick = function() {
      if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
        const isItalic = window.selectedItem.fontStyle === 'italic';
        window.selectedItem.fontStyle = isItalic ? 'normal' : 'italic';
        paper.view.update();
      }
    };
  }

  // --- 3. ACCIONES DE IMAGEN ---
  const btnFlipH = document.getElementById('btnCtxFlipH');
  if (btnFlipH) {
    btnFlipH.onclick = function() {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.scale(-1, 1);
          paper.view.update();
        }
      }
    };
  }

  const btnFlipV = document.getElementById('btnCtxFlipV');
  if (btnFlipV) {
    btnFlipV.onclick = function() {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.scale(1, -1);
          paper.view.update();
        }
      }
    };
  }

  const briSlider = document.getElementById('ctxBrightness');
  if (briSlider) {
    briSlider.oninput = function() {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.data = target.data || {};
          target.data.brightness = parseFloat(briSlider.value);
        }
      }
    };
  }

  const conSlider = document.getElementById('ctxContrast');
  if (conSlider) {
    conSlider.oninput = function() {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.data = target.data || {};
          target.data.contrast = parseFloat(conSlider.value);
        }
      }
    };
  }
}

export function updateContextualMenu(item) {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  if (window.nodeEditMode) {
    toolbar.classList.add('active');
    document.getElementById('ctxTextControls').classList.add('hidden');
    document.getElementById('ctxImageControls').classList.add('hidden');
    document.getElementById('ctxVectorControls').classList.add('hidden');
    document.getElementById('ctxTraceControls').classList.add('hidden');
    const nodeControls = document.getElementById('ctxNodeEditControls');
    if (nodeControls) nodeControls.classList.remove('hidden');
    return;
  }

  if (!item || (item.data && item.data.mockup)) {
    toolbar.classList.remove('active');
    return;
  }

  toolbar.classList.add('active');

  document.getElementById('ctxTextControls').classList.add('hidden');
  document.getElementById('ctxImageControls').classList.add('hidden');
  document.getElementById('ctxVectorControls').classList.add('hidden');
  document.getElementById('ctxTraceControls').classList.add('hidden');
  
  const nodeControls = document.getElementById('ctxNodeEditControls');
  if (nodeControls) nodeControls.classList.add('hidden');

  const target = item.data?.clipGroup ? item.children.find(function(c) { return !c.clipMask; }) : item;
  if (!target) return;

  const btnTrace = document.getElementById('btnCtxTrace');
  const btnApplyMask = document.getElementById('btnCtxApplyMask');
  const btnRemoveMask = document.getElementById('btnCtxRemoveMask');
  const btnNodeEdit = document.getElementById('btnCtxNodeEdit');

  if (target instanceof paper.PointText) {
    document.getElementById('ctxTextControls').classList.remove('hidden');
    if (btnTrace) btnTrace.style.display = 'none';
    if (btnApplyMask) btnApplyMask.style.display = 'none';
    if (btnRemoveMask) btnRemoveMask.style.display = 'none';
    if (btnNodeEdit) btnNodeEdit.style.display = 'none';
    
    const fontSelector = document.getElementById('ctxFontSelector');
    const fontSizeInput = document.getElementById('ctxFontSize');
    if (fontSelector) fontSelector.value = target.fontFamily || 'Arial';
    if (fontSizeInput) fontSizeInput.value = Math.round(target.fontSize || 12);
    
  } else if (target instanceof paper.Raster) {
    document.getElementById('ctxImageControls').classList.remove('hidden');
    if (btnTrace) btnTrace.style.display = 'inline-flex';
    if (btnNodeEdit) btnNodeEdit.style.display = 'none';
    
    if (item.data?.clipGroup) {
      if (btnApplyMask) btnApplyMask.style.display = 'none';
      if (btnRemoveMask) btnRemoveMask.style.display = 'inline-flex';
    } else {
      if (btnApplyMask) btnApplyMask.style.display = 'inline-flex';
      if (btnRemoveMask) btnRemoveMask.style.display = 'none';
    }
    
    const briSlider = document.getElementById('ctxBrightness');
    const conSlider = document.getElementById('ctxContrast');
    if (briSlider) briSlider.value = target.data?.brightness || 0;
    if (conSlider) conSlider.value = target.data?.contrast || 0;
    
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    document.getElementById('ctxVectorControls').classList.remove('hidden');
    if (btnTrace) btnTrace.style.display = 'none';
    if (btnApplyMask) btnApplyMask.style.display = 'none';
    if (btnRemoveMask) btnRemoveMask.style.display = 'none';
    if (btnNodeEdit) {
      btnNodeEdit.style.display = (target instanceof paper.Path || target instanceof paper.CompoundPath) ? 'inline-flex' : 'none';
    }
  }

  // --- POSICIONAMIENTO GEOMÉTRICO ---
  const bounds = item.bounds;
  if (!bounds) return;

  const viewPoint = paper.view.projectToView(bounds.topCenter);
  const toolbarWidth = toolbar.offsetWidth || 350;
  const toolbarHeight = toolbar.offsetHeight || 45;

  const posX = viewPoint.x - (toolbarWidth / 2);
  const posY = viewPoint.y - toolbarHeight - 20;

  const maxLeft = paper.view.element.clientWidth - toolbarWidth - 10;
  const maxTop = paper.view.element.clientHeight - toolbarHeight - 10;

  toolbar.style.left = Math.max(10, Math.min(posX, maxLeft)) + 'px';
  toolbar.style.top = Math.max(10, Math.min(posY, maxTop)) + 'px';
}

export function hideContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (toolbar) toolbar.classList.remove('active');
}

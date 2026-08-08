
// ==========================================
// LIGHTBURN-STYLE IMAGE TRACING ALGORITHM & UI
// ==========================================

function traceImageContours(raster, thresholdVal) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  
  const w = Math.round(raster.width);
  const h = Math.round(raster.height);
  canvas.width = w;
  canvas.height = h;
  
  // Dibujar la imagen del raster en un canvas fuera de pantalla para leer píxeles
  ctx.drawImage(raster.canvas || raster.image, 0, 0, w, h);
  const imgData = ctx.getImageData(0, 0, w, h);
  const pixels = imgData.data;
  
  // Matriz binaria con borde de seguridad de 1 píxel vacío a cada lado
  const width2 = w + 2;
  const height2 = h + 2;
  const binary = new Uint8Array(width2 * height2);
  
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx+1];
      const b = pixels[idx+2];
      const a = pixels[idx+3];
      
      // Si el píxel es transparente, se considera blanco (fondo)
      if (a < 50) {
        binary[(y + 1) * width2 + (x + 1)] = 0;
        continue;
      }
      
      // Fórmula estándar de luminancia para escala de grises
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      binary[(y + 1) * width2 + (x + 1)] = (gray < thresholdVal) ? 1 : 0;
    }
  }
  
  const visited = new Uint8Array(width2 * height2);
  const contours = [];
  
  // Direcciones vecinas para Moore-Neighbor (8 direcciones en sentido horario)
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];
  
  for (let y = 1; y < height2 - 1; y++) {
    for (let x = 1; x < width2 - 1; x++) {
      const idx = y * width2 + x;
      
      if (binary[idx] === 1 && !visited[idx]) {
        // Verificar si es un borde exterior o interior (limita con al menos un píxel blanco)
        let isBorder = false;
        for (let d = 0; d < 8; d++) {
          const nx = x + dx[d];
          const ny = y + dy[d];
          if (binary[ny * width2 + nx] === 0) {
            isBorder = true;
            break;
          }
        }
        
        if (isBorder) {
          const points = [];
          let cx = x;
          let cy = y;
          let entryDir = 6; // Entramos desde abajo por defecto
          
          const startX = cx;
          const startY = cy;
          let loopCount = 0;
          const maxLoops = 25000; // Evitar bloqueos por seguridad
          
          while (loopCount < maxLoops) {
            visited[cy * width2 + cx] = 1;
            points.push({ x: cx - 1, y: cy - 1 });
            
            let foundNext = false;
            let searchDir = (entryDir + 1) % 8;
            
            for (let i = 0; i < 8; i++) {
              const dir = (searchDir + i) % 8;
              const nx = cx + dx[dir];
              const ny = cy + dy[dir];
              
              if (binary[ny * width2 + nx] === 1) {
                cx = nx;
                cy = ny;
                entryDir = (dir + 4) % 8; // Inverso para el siguiente paso
                foundNext = true;
                break;
              }
            }
            
            if (!foundNext || (cx === startX && cy === startY)) {
              break;
            }
            loopCount++;
          }
          
          if (points.length > 2) {
            contours.push(points);
          }
        }
      }
    }
  }
  return contours;
}

function openImageTraceModal(target) {
  // Inyectar estilos CSS profesionales si no están presentes
  if (!document.getElementById('trace-modal-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'trace-modal-styles';
    styleEl.textContent = `
      .trace-modal {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: #1e1e1e;
        color: #f1f1f1;
        border: 2px solid #ff00ff;
        border-radius: 8px;
        box-shadow: 0 8px 30px rgba(0,0,0,0.6);
        padding: 20px;
        width: 320px;
        z-index: 10000;
        font-family: system-ui, -apple-system, sans-serif;
        user-select: none;
      }
      .trace-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        border-bottom: 1.5px solid #ff00ff;
        padding-bottom: 8px;
        margin-bottom: 15px;
      }
      .trace-modal-title {
        font-size: 13px;
        font-weight: 800;
        color: #ff00ff;
        text-transform: uppercase;
        letter-spacing: 0.8px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .trace-modal-close {
        cursor: pointer;
        color: #ff00ff;
        font-size: 20px;
        background: transparent;
        border: none;
        line-height: 1;
        padding: 0;
      }
      .trace-modal-row {
        margin-bottom: 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .trace-modal-row-inline {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 14px;
      }
      .trace-label {
        font-size: 12px;
        color: #bbb;
        font-weight: 500;
      }
      .trace-value-container {
        display: flex;
        align-items: center;
        gap: 12px;
        width: 100%;
      }
      .trace-slider {
        flex-grow: 1;
        accent-color: #ff00ff;
        cursor: pointer;
        height: 6px;
        border-radius: 3px;
        outline: none;
      }
      .trace-number-input {
        width: 60px;
        background: #2a2a2a;
        border: 1px solid #ff00ff;
        color: #fff;
        border-radius: 4px;
        padding: 5px;
        font-size: 12px;
        text-align: center;
        outline: none;
        font-weight: bold;
      }
      .trace-number-input:focus {
        box-shadow: 0 0 6px rgba(255, 0, 255, 0.6);
      }
      .trace-checkbox-container {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        font-size: 12px;
        color: #ddd;
      }
      .trace-checkbox {
        accent-color: #ff00ff;
        cursor: pointer;
        width: 14px;
        height: 14px;
      }
      .trace-buttons {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 18px;
        border-top: 1px solid #333;
        padding-top: 14px;
      }
      .trace-btn-cancel {
        background: #3a3a3a;
        color: #ddd;
        border: none;
        padding: 8px 14px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
        transition: background 0.2s;
      }
      .trace-btn-cancel:hover {
        background: #4a4a4a;
        color: #fff;
      }
      .trace-btn-ok {
        background: #ff00ff;
        color: #fff;
        border: none;
        padding: 8px 14px;
        border-radius: 4px;
        cursor: pointer;
        font-size: 12px;
        font-weight: bold;
        transition: background 0.2s;
        box-shadow: 0 2px 8px rgba(255,0,255,0.3);
      }
      .trace-btn-ok:hover {
        background: #d300d3;
      }
      .trace-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0,0,0,0.55);
        z-index: 9999;
      }
    `;
    document.head.appendChild(styleEl);
  }

  // Crear elementos del modal en el DOM
  const overlay = document.createElement('div');
  overlay.className = 'trace-overlay';
  
  const modal = document.createElement('div');
  modal.className = 'trace-modal';
  modal.innerHTML = `
    <div class="trace-modal-header">
      <div class="trace-modal-title">
        <svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5" fill="none">
          <path d="M12 2c5.522 0 10 4.477 10 10s-4.478 10-10 10S2 17.523 2 12s4.478-10 10-10z"/>
          <path d="M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z"/>
        </svg>
        Trazar Imagen (LightBurn)
      </div>
      <button class="trace-modal-close" id="btnTraceClose">&times;</button>
    </div>
    
    <div class="trace-modal-row">
      <span class="trace-label">Umbral de Grabado (0 - 255)</span>
      <div class="trace-value-container">
        <input type="range" class="trace-slider" id="traceSlider" min="0" max="255" value="128">
        <input type="number" class="trace-number-input" id="traceNumber" min="0" max="255" value="128">
      </div>
    </div>
    
    <div class="trace-modal-row-inline">
      <label class="trace-checkbox-container">
        <input type="checkbox" class="trace-checkbox" id="traceFadeImg" checked>
        Desvanecer Imagen original
      </label>
    </div>
    
    <div class="trace-modal-row-inline">
      <label class="trace-checkbox-container">
        <input type="checkbox" class="trace-checkbox" id="traceDeleteImg">
        Eliminar imagen al finalizar
      </label>
    </div>
    
    <div class="trace-buttons">
      <button class="trace-btn-cancel" id="btnTraceCancel">Cancelar</button>
      <button class="trace-btn-ok" id="btnTraceOk">Aceptar</button>
    </div>
  `;

  document.body.appendChild(overlay);
  document.body.appendChild(modal);

  const slider = modal.querySelector('#traceSlider');
  const numberInput = modal.querySelector('#traceNumber');
  const checkboxFade = modal.querySelector('#traceFadeImg');
  const checkboxDelete = modal.querySelector('#traceDeleteImg');
  
  const originalOpacity = target.opacity !== undefined ? target.opacity : 1.0;
  let currentThreshold = 128;
  let previewGroup = null;

  // Aplicar desvanecimiento inicial del background de la imagen por defecto
  target.opacity = 0.25;
  paper.view.update();

  // Función para regenerar la vista previa magenta fina (LightBurn style)
  function renderPreview() {
    if (previewGroup) {
      previewGroup.remove();
      previewGroup = null;
    }
    
    if (!target || !target.valid) return;
    
    const contours = traceImageContours(target, currentThreshold);
    previewGroup = new paper.Group();
    previewGroup.data = { isPreview: true };
    
    contours.forEach(points => {
      const path = new paper.Path();
      path.strokeColor = '#ff00ff'; // Color magenta fino de LightBurn
      path.strokeWidth = 1.5 / paper.view.zoom; // Línea fina nítida ajustada al zoom actual
      path.fillColor = null;
      
      points.forEach(p => {
        // Mapeo perfecto desde el espacio de píxeles del Raster al proyecto del lienzo de Paper.js
        const localPoint = new paper.Point(p.x - target.width/2, p.y - target.height/2);
        const projectPoint = target.matrix.transform(localPoint);
        path.add(projectPoint);
      });
      
      path.closed = true;
      path.simplify(0.5); // Suavizar curvas con tolerancia de 0.5px para curvas limpias
      previewGroup.addChild(path);
    });
    
    previewGroup.insertAbove(target);
    paper.view.update();
  }

  // Actualizar el valor y refrescar
  const updateThreshold = (newVal) => {
    const val = Math.max(0, Math.min(255, Math.round(newVal)));
    slider.value = val;
    numberInput.value = val;
    currentThreshold = val;
    renderPreview();
  };

  // --- CONTROL MILIMÉTRICO (Ruedita del ratón, Teclado, Clic directo) ---
  slider.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = e.deltaY < 0 ? 1 : -1;
    updateThreshold(currentThreshold + step);
  }, { passive: false });

  numberInput.addEventListener('wheel', (e) => {
    e.preventDefault();
    const step = e.deltaY < 0 ? 1 : -1;
    updateThreshold(currentThreshold + step);
  }, { passive: false });

  numberInput.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      updateThreshold(currentThreshold + 1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      updateThreshold(currentThreshold - 1);
    }
  });

  // Escuchar eventos de teclas en el slider cuando tiene foco
  slider.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      updateThreshold(currentThreshold - 1);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      updateThreshold(currentThreshold + 1);
    }
  });

  numberInput.addEventListener('input', () => {
    const val = parseInt(numberInput.value);
    if (!isNaN(val)) updateThreshold(val);
  });

  slider.addEventListener('input', () => {
    updateThreshold(parseInt(slider.value));
  });

  checkboxFade.onchange = () => {
    target.opacity = checkboxFade.checked ? 0.25 : originalOpacity;
    paper.view.update();
  };

  // Acciones de cierre del modal
  const cleanup = () => {
    if (previewGroup) {
      previewGroup.remove();
      previewGroup = null;
    }
    if (target && target.valid) {
      target.opacity = originalOpacity;
    }
    modal.remove();
    overlay.remove();
    paper.view.update();
  };

  modal.querySelector('#btnTraceClose').onclick = cleanup;
  modal.querySelector('#btnTraceCancel').onclick = cleanup;
  overlay.onclick = cleanup;

  modal.querySelector('#btnTraceOk').onclick = () => {
    if (!previewGroup || previewGroup.children.length === 0) {
      cleanup();
      return;
    }
    
    // Crear el trazado vectorial final y permanente
    const finalGroup = new paper.Group();
    finalGroup.data = { label: "Trazado Vectorial" };
    
    const children = previewGroup.children.slice();
    children.forEach(path => {
      const finalPath = path.clone();
      finalPath.strokeColor = new paper.Color(0, 0, 0); // Vector negro para corte/grabado láser
      finalPath.strokeWidth = 1.5;
      finalPath.fillColor = null;
      finalGroup.addChild(finalPath);
    });
    
    paper.project.activeLayer.addChild(finalGroup);
    
    if (checkboxDelete.checked) {
      target.remove();
      window.deselectItem();
    } else {
      target.opacity = originalOpacity;
      finalGroup.insertAbove(target);
      window.selectItem(finalGroup);
    }
    
    cleanup();
    paper.view.update();
  };

  // Renderizar la vista previa inicial al abrir
  renderPreview();
}

export function initContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  // --- 1. ACCIONES GENERALES ---
  document.getElementById('btnCtxDelete').onclick = () => {
    if (window.selectedItem) {
      window.selectedItem.remove();
      window.deselectItem();
      hideContextualMenu();
    }
  };

  document.getElementById('btnCtxDuplicate').onclick = () => {
    if (window.selectedItem && !window.selectedItem.data?.locked) {
      const clone = window.selectedItem.clone();
      clone.position = clone.position.add(new paper.Point(20, 20));
      clone.data = { ...(clone.data || {}), locked: false };
      
      if (window.selectedItem.data?.clipGroup) {
        clone.data.label = `${window.selectedItem.data.label || "Objeto"} copia`;
      }
      
      paper.project.activeLayer.addChild(clone);
      window.selectItem(clone);
      updateContextualMenu(clone);
    }
  };

  document.getElementById('btnCtxForward').onclick = () => {
    if (window.selectedItem) {
      window.selectedItem.bringToFront();
      paper.view.update();
    }
  };

  document.getElementById('btnCtxBackward').onclick = () => {
    if (window.selectedItem) {
      window.selectedItem.sendToBack();
      // Si el mockup está presente, el objeto debe ir justo por debajo del mockup
      if (window.currentMockup) {
        window.selectedItem.insertBelow(window.currentMockup);
      }
      paper.view.update();
    }
  };

  // --- 2. ACCIONES DE TEXTO ---
  const fontSelector = document.getElementById('ctxFontSelector');
  if (fontSelector) {
    fontSelector.onchange = () => {
      if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
        window.selectedItem.fontFamily = fontSelector.value;
        paper.view.update();
      }
    };
  }

  const fontSizeInput = document.getElementById('ctxFontSize');
  if (fontSizeInput) {
    fontSizeInput.oninput = () => {
      if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
        const val = parseFloat(fontSizeInput.value);
        if (val && val > 0) {
          window.selectedItem.fontSize = val;
          paper.view.update();
          updateContextualMenu(window.selectedItem); // Reposicionar barra
        }
      }
    };
  }

  // Estilos de texto (Negrita y Cursiva)
  const btnBold = document.getElementById('btnCtxBold');
  if (btnBold) {
    btnBold.onclick = () => {
      if (window.selectedItem && window.selectedItem instanceof paper.PointText) {
        const isBold = window.selectedItem.fontWeight === 'bold';
        window.selectedItem.fontWeight = isBold ? 'normal' : 'bold';
        paper.view.update();
      }
    };
  }

  const btnItalic = document.getElementById('btnCtxItalic');
  if (btnItalic) {
    btnItalic.onclick = () => {
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
    btnFlipH.onclick = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(c => !c.clipMask) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.scale(-1, 1);
          paper.view.update();
        }
      }
    };
  }

  const btnFlipV = document.getElementById('btnCtxFlipV');
  if (btnFlipV) {
    btnFlipV.onclick = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(c => !c.clipMask) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.scale(1, -1);
          paper.view.update();
        }
      }
    };
  }

  // Sliders de Brillo y Contraste
  const briSlider = document.getElementById('ctxBrightness');
  if (briSlider) {
    briSlider.oninput = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(c => !c.clipMask) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          // Guardamos el nivel de brillo para procesamiento de píxeles posterior
          target.data = target.data || {};
          target.data.brightness = parseFloat(briSlider.value);
        }
      }
    };
  }

  const conSlider = document.getElementById('ctxContrast');
  if (conSlider) {
    conSlider.oninput = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(c => !c.clipMask) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.data = target.data || {};
          target.data.contrast = parseFloat(conSlider.value);
        }
      }
    };
  }

  // --- BINDING BOTÓN TRAZAR IMAGEN (LightBurn Style Magenta) ---
  const imageControls = document.getElementById('ctxImageControls');
  if (imageControls) {
    let btnTrace = document.getElementById('btnCtxTrace');
    if (!btnTrace) {
      btnTrace = document.createElement('button');
      btnTrace.id = 'btnCtxTrace';
      btnTrace.className = 'ctx-btn';
      btnTrace.title = 'Trazar Imagen';
      btnTrace.innerHTML = `
        <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" stroke-width="2.5" fill="none" style="margin-right:4px;">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
          <path d="M12 6v12M6 12h12"/>
        </svg>
        <span>Trazar</span>
      `;
      
      // Estilo de botón magenta LightBurn
      btnTrace.style.backgroundColor = 'transparent';
      btnTrace.style.border = '1.5px solid #ff00ff';
      btnTrace.style.color = '#ff00ff';
      btnTrace.style.padding = '3px 10px';
      btnTrace.style.borderRadius = '4px';
      btnTrace.style.cursor = 'pointer';
      btnTrace.style.display = 'flex';
      btnTrace.style.alignItems = 'center';
      btnTrace.style.fontSize = '12px';
      btnTrace.style.fontWeight = 'bold';
      btnTrace.style.transition = 'all 0.2s';
      
      btnTrace.onmouseover = () => {
        btnTrace.style.backgroundColor = '#ff00ff';
        btnTrace.style.color = '#fff';
      };
      btnTrace.onmouseout = () => {
        btnTrace.style.backgroundColor = 'transparent';
        btnTrace.style.color = '#ff00ff';
      };
      
      imageControls.appendChild(btnTrace);
    }
    
    btnTrace.onclick = () => {
      if (window.selectedItem) {
        const imgTarget = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(c => !c.clipMask) 
          : window.selectedItem;
        if (imgTarget && imgTarget instanceof paper.Raster) {
          openImageTraceModal(imgTarget);
        }
      }
    };
  }
}

export function updateContextualMenu(item) {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  // Si no hay item o es un mockup bloqueado, escondemos el menú flotante
  if (!item || (item.data && item.data.mockup)) {
    toolbar.classList.remove('active');
    return;
  }

  toolbar.classList.add('active');

  // Escondemos los subgrupos específicos
  document.getElementById('ctxTextControls').classList.add('hidden');
  document.getElementById('ctxImageControls').classList.add('hidden');
  document.getElementById('ctxVectorControls').classList.add('hidden');

  // Identificamos el elemento real (incluso si está dentro de un ClipGroup enmascarado)
  const target = item.data?.clipGroup 
    ? item.children.find(c => !c.clipMask) 
    : item;

  if (!target) return;

  // Mostramos controles según el tipo de objeto
  if (target instanceof paper.PointText) {
    document.getElementById('ctxTextControls').classList.remove('hidden');
    
    const fontSelector = document.getElementById('ctxFontSelector');
    const fontSizeInput = document.getElementById('ctxFontSize');
    
    if (fontSelector) fontSelector.value = target.fontFamily || 'Arial';
    if (fontSizeInput) fontSizeInput.value = Math.round(target.fontSize || 12);
    
  } else if (target instanceof paper.Raster) {
    document.getElementById('ctxImageControls').classList.remove('hidden');
    
    // Restaurar valores de sliders guardados en metadatos
    const briSlider = document.getElementById('ctxBrightness');
    const conSlider = document.getElementById('ctxContrast');
    
    if (briSlider) briSlider.value = target.data?.brightness || 0;
    if (conSlider) conSlider.value = target.data?.contrast || 0;
    
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    // Si es un SVG o trazado vectorial, activamos controles vectoriales de LightBurn
    document.getElementById('ctxVectorControls').classList.remove('hidden');
  }

  // --- POSICIONAMIENTO GEOMÉTRICO (Canva Style) ---
  const bounds = item.bounds;
  if (!bounds) return;

  // Calculamos la coordenada del borde superior-centro en píxeles locales del lienzo
  const viewPoint = paper.view.projectToView(bounds.topCenter);

  const toolbarWidth = toolbar.offsetWidth || 350;
  const toolbarHeight = toolbar.offsetHeight || 45;

  // Centramos horizontalmente arriba de la figura
  const posX = viewPoint.x - (toolbarWidth / 2);
  const posY = viewPoint.y - toolbarHeight - 20; // 20px de espacio vertical

  // Limites del canvas para que el menú nunca se salga de la pantalla por arriba o por los costados
  const maxLeft = paper.view.element.clientWidth - toolbarWidth - 10;
  const maxTop = paper.view.element.clientHeight - toolbarHeight - 10;

  toolbar.style.left = `${Math.max(10, Math.min(posX, maxLeft))}px`;
  toolbar.style.top = `${Math.max(10, Math.min(posY, maxTop))}px`;
}

export function hideContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (toolbar) toolbar.classList.remove('active');
}

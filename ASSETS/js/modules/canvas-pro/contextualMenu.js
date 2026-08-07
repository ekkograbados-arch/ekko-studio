/* =========================================================================
   Moore-Neighbor Tracing (Algoritmo de seguimiento de bordes para imágenes)
   ========================================================================= */
function traceImageOutline(raster) {
  const canvas = raster.canvas;
  if (!canvas) return null;
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  if (w <= 0 || h <= 0) return null;

  let imgData;
  try {
    imgData = ctx.getImageData(0, 0, w, h);
  } catch (e) {
    console.warn("No se pudo obtener datos de píxeles (posible error de CORS). Usando contorno rectangular.", e);
    return new paper.Path.Rectangle(raster.bounds);
  }

  const data = imgData.data;

  // Determinar si un píxel es "sólido" (con contenido para el láser)
  function isSolid(x, y) {
    if (x < 0 || x >= w || y < 0 || y >= h) return false;
    const idx = (y * w + x) * 4;
    const r = data[idx];
    const g = data[idx+1];
    const b = data[idx+2];
    const a = data[idx+3];
    
    // Si es transparente (alpha bajo), se considera vacío
    if (a < 50) return false;
    
    // Si es casi blanco puro (brillo > 240), se considera fondo vacío
    if (r > 240 && g > 240 && b > 240) return false;
    
    return true;
  }

  // Buscar el primer píxel sólido (desde arriba a la izquierda)
  let startX = -1, startY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isSolid(x, y)) {
        startX = x;
        startY = y;
        break;
      }
    }
    if (startX !== -1) break;
  }

  if (startX === -1) {
    // Si no hay píxeles sólidos o todo es blanco, usamos el rectángulo delimitador como salvaguarda
    return new paper.Path.Rectangle(raster.bounds);
  }

  const points = [];
  let cx = startX;
  let cy = startY;

  // Direcciones de búsqueda de vecinos (recorrido de reloj)
  const dx = [0, 1, 1, 1, 0, -1, -1, -1];
  const dy = [-1, -1, 0, 1, 1, 1, 0, -1];
  let dir = 7;
  let loopCount = 0;
  const maxLoops = w * h * 2;
  const visited = new Set();

  do {
    let found = false;
    for (let i = 0; i < 8; i++) {
      const checkDir = (dir + i) % 8;
      const nx = cx + dx[checkDir];
      const ny = cy + dy[checkDir];
      if (isSolid(nx, ny)) {
        cx = nx;
        cy = ny;
        points.push(new paper.Point(cx, cy));
        dir = (checkDir + 5) % 8; // Reajustar la dirección de búsqueda para el backtrack
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

  // Mapear los puntos del plano del canvas al plano de coordenadas del editor de Paper.js
  const bounds = raster.bounds;
  const rx = bounds.left;
  const ry = bounds.top;
  const rw = bounds.width;
  const rh = bounds.height;

  const paperPoints = points.map(function(p) {
    const px = rx + (p.x / w) * rw;
    const py = ry + (p.y / h) * rh;
    return new paper.Point(px, py);
  });

  const path = new paper.Path(paperPoints);
  path.closed = true;
  path.simplify(1.5); // Suavizar las curvas exactamente igual que la tolerancia de LightBurn
  return path;
}

export function initContextualMenu() {
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
      
      // Si el objeto seleccionado es un grupo recortado (clipGroup)
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

  // --- BOTÓN TRAZAR CONTORNO DE IMAGEN (LightBurn Style) ---
  const btnCtxTrace = document.getElementById('btnCtxTrace');
  if (btnCtxTrace) {
    btnCtxTrace.onclick = () => {
      if (window.selectedItem) {
        const raster = (window.selectedItem.data?.clipGroup)
          ? window.selectedItem.children.find(function(c) { return !c.clipMask; })
          : window.selectedItem;
          
        if (raster && raster instanceof paper.Raster) {
          const path = traceImageOutline(raster);
          if (path) {
            path.strokeColor = new paper.Color('#007bff');
            path.strokeWidth = 2;
            path.fillColor = null;
            path.data = { locked: false, label: "Contorno " + (raster.data?.label || "Imagen") };
            
            paper.project.activeLayer.addChild(path);
            if (window.currentMockup) {
              path.insertBelow(window.currentMockup);
            }
            
            window.selectItem(path);
            paper.view.update();
          }
        }
      }
    };
  }

  // --- BOTÓN RECORTAR FONDO / EVITAR SUPERPOSICIÓN (LightBurn Style) ---
  const btnCtxSubtract = document.getElementById('btnCtxSubtract');
  if (btnCtxSubtract) {
    btnCtxSubtract.onclick = () => {
      if (window.selectedItem) {
        let outlinePath = null;
        
        // 1. Obtener la geometría de contorno del elemento seleccionado
        if (window.selectedItem.data?.clipGroup) {
          const raster = window.selectedItem.children.find(function(c) { return !c.clipMask; });
          if (raster && raster instanceof paper.Raster) {
            outlinePath = traceImageOutline(raster);
          }
        } else if (window.selectedItem instanceof paper.Raster) {
          outlinePath = traceImageOutline(window.selectedItem);
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
        
        // 2. Encontrar todos los elementos detrás de él en el orden de capas
        const children = paper.project.activeLayer.children.slice();
        const targetIndex = children.indexOf(window.selectedItem);
        if (targetIndex === -1) return;
        
        let subbedCount = 0;
        
        // Ejecutar la resta únicamente en los objetos que estén DEBAJO
        for (let i = 0; i < targetIndex; i++) {
          const otherItem = children[i];
          if (otherItem.data?.mockup || otherItem.data?.isSelectionBox || otherItem === window.selectedItem) {
            continue;
          }
          
          // Caso A: Si el objeto de abajo es vectorial (Path o CompoundPath)
          if (otherItem instanceof paper.Path || otherItem instanceof paper.CompoundPath) {
            if (otherItem.bounds.intersects(outlinePath.bounds)) {
              const result = otherItem.subtract(outlinePath);
              if (result) {
                result.data = { ...(otherItem.data || {}) };
                otherItem.replaceWith(result);
                subbedCount++;
              }
            }
          }
          // Caso B: Si el objeto de abajo es una imagen enmascarada (clipGroup)
          else if (otherItem.data?.clipGroup) {
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

  document.getElementById('btnCtxForward').onclick = () => {
    if (window.selectedItem) {
      if (window.selectedItem.data?.mockup) return;
      window.selectedItem.bringToFront();
      paper.view.update();
    }
  };

  document.getElementById('btnCtxBackward').onclick = () => {
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
          window.updateSelectionBox(window.selectedItem);
          updateContextualMenu(window.selectedItem);
        }
      }
    };
  }

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
          ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) 
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
          ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
          target.scale(1, -1);
          paper.view.update();
        }
      }
    };
  }

  const briSlider = document.getElementById('ctxBrightness');
  if (briSlider) {
    briSlider.oninput = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup 
          ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) 
          : window.selectedItem;
        if (target && target instanceof paper.Raster) {
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
          ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) 
          : window.selectedItem;
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

  if (!item || (item.data && item.data.mockup)) {
    toolbar.classList.remove('active');
    return;
  }

  toolbar.classList.add('active');

  document.getElementById('ctxTextControls').classList.add('hidden');
  document.getElementById('ctxImageControls').classList.add('hidden');
  document.getElementById('ctxVectorControls').classList.add('hidden');

  const target = item.data?.clipGroup 
    ? item.children.find(function(c) { return !c.clipMask; }) 
    : item;

  if (!target) return;

  const btnTrace = document.getElementById('btnCtxTrace');

  if (target instanceof paper.PointText) {
    document.getElementById('ctxTextControls').classList.remove('hidden');
    if (btnTrace) btnTrace.style.display = 'none'; // Ocultar trazar si no es imagen
    
    const fontSelector = document.getElementById('ctxFontSelector');
    const fontSizeInput = document.getElementById('ctxFontSize');
    
    if (fontSelector) fontSelector.value = target.fontFamily || 'Arial';
    if (fontSizeInput) fontSizeInput.value = Math.round(target.fontSize || 12);
    
  } else if (target instanceof paper.Raster) {
    document.getElementById('ctxImageControls').classList.remove('hidden');
    if (btnTrace) btnTrace.style.display = 'inline-flex'; // Mostrar trazar si es imagen
    
    const briSlider = document.getElementById('ctxBrightness');
    const conSlider = document.getElementById('ctxContrast');
    
    if (briSlider) briSlider.value = target.data?.brightness || 0;
    if (conSlider) conSlider.value = target.data?.contrast || 0;
    
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    document.getElementById('ctxVectorControls').classList.remove('hidden');
    if (btnTrace) btnTrace.style.display = 'none'; // Ocultar trazar si no es imagen
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

  toolbar.style.left = `${Math.max(10, Math.min(posX, maxLeft))}px`;
  toolbar.style.top = `${Math.max(10, Math.min(posY, maxTop))}px`;
}

export function hideContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (toolbar) toolbar.classList.remove('active');
}

/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js
   Ruta de reemplazo: ASSETS/js/modules/canvas-pro/contextualMenu.js
   Descripción: Barra de herramientas flotante de contexto. Soporta barra arrastrable,
   desplegable de fuentes personalizado basado en div con previsualización del
   texto dinámico en tiempo real, e inyección dinámica de familias de fuentes.
   ========================================================================= */

import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward } from "./imageToolbar.js";

// Variable global de previsualización en window
window.originalFontBackup = null;

let fontsCache = [];
let toolbarDragged = false;
let lastSelectedItem = null;

// --- INYECCIÓN DE ESTILOS CSS PARA EL MENÚ PERSONALIZADO ---
const dropdownStylesId = 'ekko-custom-dropdown-styles';
if (typeof document !== 'undefined' && !document.getElementById(dropdownStylesId)) {
  const styleEl = document.createElement('style');
  styleEl.id = dropdownStylesId;
  styleEl.textContent = `
    .custom-font-dropdown {
      position: relative;
      min-width: 180px;
      height: 34px;
      background: white;
      border: 1px solid #ccc;
      border-radius: 6px;
      user-select: none;
      display: inline-block;
      vertical-align: middle;
    }
    .selected-font-trigger {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 6px 12px;
      font-size: 13px;
      font-weight: bold;
      cursor: pointer;
      color: #333;
      height: 100%;
      box-sizing: border-box;
    }
    .font-dropdown-list {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      width: 320px;
      max-height: 380px;
      overflow-y: auto;
      background: white;
      border: 1px solid #bbb;
      border-radius: 8px;
      box-shadow: 0 10px 25px rgba(0,0,0,0.18);
      z-index: 10010;
      padding: 6px;
      box-sizing: border-box;
    }
    .font-dropdown-list.hidden {
      display: none;
    }
    .custom-font-item {
      padding: 10px 12px;
      border-bottom: 1px solid #f0f0f0;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: background 0.15s;
    }
    .custom-font-item:last-child {
      border-bottom: none;
    }
    .custom-font-item:hover {
      background: #f0f8ff;
    }
    .custom-font-item.active {
      background: #e6f2ff;
      border-left: 3px solid #007bff;
    }
    .custom-font-preview {
      font-size: 22px;
      color: #000;
      line-height: 1.2;
      word-break: break-all;
    }
    .custom-font-name {
      font-size: 11px;
      color: #777;
    }
  `;
  document.head.appendChild(styleEl);
}

// --- REMOVE OVERLAP TAB (EVITAR SUPERPOSICION) ---
function removeOverlapTab() {
  const btnSubtract = document.getElementById('btnCtxSubtract');
  if (btnSubtract) {
    btnSubtract.style.display = 'none';
    btnSubtract.remove();
  }
  const allElements = document.querySelectorAll('button, div, span, a, p, li');
  allElements.forEach(el => {
    if (el.textContent) {
      const normalizedText = el.textContent.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
      if (normalizedText.includes('EVITAR SUPERPOSICION')) {
        el.remove();
      }
    }
  });
}

/**
 * Inyecta dinámicamente las reglas de @font-face en el encabezado (head) para cada fuente devuelta,
 * asegurando la creación de familias para los alias.
 */
function injectFontFaces(fonts) {
  let styleEl = document.getElementById('ekko-dynamic-font-faces');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'ekko-dynamic-font-faces';
    document.head.appendChild(styleEl);
  }
  let cssRules = "";
  fonts.forEach(font => {
    cssRules += `
      @font-face {
        font-family: "${font.family}";
        src: url("/ASSETS/fonts/${encodeURIComponent(font.file)}") format("woff2"),
             url("/ASSETS/fonts/${encodeURIComponent(font.file)}") format("truetype"),
             url("/ASSETS/fonts/${encodeURIComponent(font.file)}") format("opentype");
        font-display: swap;
      }
    `;
  });
  styleEl.textContent += cssRules;
}

/**
 * Obtiene el texto actualmente seleccionado para la previsualización interactiva del dropdown
 */
function getSelectedTextString() {
  if (!window.selectedItem) return "EKKO Studio";
  const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
  if (!target) return "EKKO Studio";
  if (target instanceof paper.PointText) {
    return target.content || "EKKO Studio";
  }
  if (target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
    return target.data.textString || "EKKO Studio";
  }
  return "EKKO Studio";
}

/**
 * Obtiene la familia de fuente del elemento seleccionado
 */
function getSelectedFontFamily() {
  if (!window.selectedItem) return "Arial";
  const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
  if (!target) return "Arial";
  if (target instanceof paper.PointText) {
    return target.fontFamily || "Arial";
  }
  if (target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
    return target.data.fontFamily || "Arial";
  }
  return "Arial";
}

/**
 * Aplica de forma directa o curva la tipografía seleccionada conservando la estructura y el Canvas de Paper.js
 */
export function applyFontFamily(item, fontFamily) {
  if (!item || item.data?.locked) return;
  let target = item;
  if (item.data?.clipGroup) {
    target = item.children.find(c => !c.clipMask);
  }
  if (!target) return;

  if (target instanceof paper.PointText) {
    target.fontFamily = fontFamily;
    target.data = target.data || {};
    target.data.fontFamily = fontFamily;
  } else if (target.data?.isCurvedGroup) {
    target.data.fontFamily = fontFamily;
    applyTextCurve(target, target.data.curvature);
  } else if (target.data?.isSpacedGroup) {
    target.data.fontFamily = fontFamily;
    applyTextSpacing(target, target.data.hspace);
  }
  paper.view.update();
}

/**
 * Genera los ítems de fuentes con previsualización dinámica dentro del dropdown personalizado
 */
function renderCustomFontItems(listContainer, fonts) {
  listContainer.innerHTML = "";
  const previewText = getSelectedTextString();
  const currentFamily = getSelectedFontFamily();

  fonts.forEach(font => {
    const item = document.createElement('div');
    item.className = 'custom-font-item' + (currentFamily === font.family ? ' active' : '');
    
    const previewSpan = document.createElement('span');
    previewSpan.className = 'custom-font-preview';
    previewSpan.style.fontFamily = `"${font.family}", Arial`;
    previewSpan.textContent = previewText;
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'custom-font-name';
    nameSpan.textContent = font.name;
    
    item.appendChild(previewSpan);
    item.appendChild(nameSpan);
    
    // Al hacer click, aplicar la fuente permanentemente
    item.onclick = (e) => {
      e.stopPropagation();
      if (typeof window.saveHistory === 'function') window.saveHistory();
      applyFontFamily(window.selectedItem, font.family);
      
      const triggerLabel = document.getElementById('selected-font-name');
      if (triggerLabel) triggerLabel.textContent = font.name;
      
      listContainer.classList.add('hidden');
      window.originalFontBackup = null; // Confirmar la selección
    };
    
    // Al pasar el cursor, previsualizar de forma temporal
    item.onmouseenter = () => {
      if (window.selectedItem) {
        if (!window.originalFontBackup) {
          window.originalFontBackup = currentFamily;
        }
        applyFontFamily(window.selectedItem, font.family);
      }
    };
    
    listContainer.appendChild(item);
  });
}

/**
 * Carga las fuentes dinámicas de la API, inyecta sus @font-face y puebla el dropdown personalizado
 */
async function populateFontDropdowns() {
  let fonts = [];
  try {
    if (typeof loadDynamicFonts === 'function') {
      fonts = await loadDynamicFonts();
    } else {
      const response = await fetch('/api/fonts');
      if (response.ok) {
        fonts = await response.json();
      }
    }
  } catch (err) {
    console.error("Error al cargar las tipografías dinámicas en el menú contextual:", err);
  }

  // Resguardo defensivo estático
  if (!fonts || fonts.length === 0) {
    fonts = [
      { name: "Billie James", family: "ekko_billie", file: "BillieJames-Regular.woff2" },
      { name: "Romantic Sunrise", family: "ekko_romantic", file: "Romantic Sunrise.woff2" },
      { name: "Farmhouse", family: "ekko_farmhouse", file: "Farmhouse.woff2" },
      { name: "Chocolate", family: "ekko_chocolate", file: "Chocolate.woff2" },
      { name: "Disney", family: "ekko_disney", file: "waltograph42.woff2" }
    ];
  }

  fonts.sort((a, b) => a.name.localeCompare(b.name));
  fontsCache = fonts; // Guardar en caché del módulo

  injectFontFaces(fonts);

  const nativeSelect = document.getElementById('ctxFontSelector');
  if (nativeSelect) {
    // Esconder el select original
    nativeSelect.style.display = 'none';
    nativeSelect.classList.add('hidden');
    
    // Verificar si ya creamos el dropdown personalizado antes
    let customDropdown = document.getElementById('ekko-custom-font-dropdown');
    if (!customDropdown) {
      customDropdown = document.createElement('div');
      customDropdown.id = 'ekko-custom-font-dropdown';
      customDropdown.className = 'custom-font-dropdown';
      
      const trigger = document.createElement('div');
      trigger.className = 'selected-font-trigger';
      trigger.innerHTML = `<span id="selected-font-name">Seleccionar Fuente</span><span style="font-size: 10px;">▼</span>`;
      
      const list = document.createElement('div');
      list.className = 'font-dropdown-list hidden';
      
      customDropdown.appendChild(trigger);
      customDropdown.appendChild(list);
      
      nativeSelect.parentNode.insertBefore(customDropdown, nativeSelect.nextSibling);
      
      trigger.onclick = (e) => {
        e.stopPropagation();
        const isHidden = list.classList.contains('hidden');
        
        // Cerrar otros dropdowns si los hubiera
        document.querySelectorAll('.font-dropdown-list').forEach(el => el.classList.add('hidden'));
        
        if (isHidden) {
          list.classList.remove('hidden');
          renderCustomFontItems(list, fontsCache);
        } else {
          list.classList.add('hidden');
        }
      };
      
      // Cerrar al hacer clic fuera del dropdown
      document.addEventListener('click', () => {
        list.classList.add('hidden');
        if (window.originalFontBackup && window.selectedItem) {
          applyFontFamily(window.selectedItem, window.originalFontBackup);
          window.originalFontBackup = null;
        }
      });
      
      customDropdown.onmouseleave = () => {
        if (window.originalFontBackup && window.selectedItem) {
          applyFontFamily(window.selectedItem, window.originalFontBackup);
          window.originalFontBackup = null;
          renderCustomFontItems(list, fontsCache);
        }
      };
    }
  }

  const sidebarGallery = document.getElementById("fontGallery");
  if (sidebarGallery) {
    sidebarGallery.classList.add("hidden");
  }
}

/**
 * Hace que el menú contextual flotante sea arrastrable por el lienzo de edición
 */
function makeToolbarDraggable() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  // Agregar cursor de movimiento sólo cuando no esté sobre controles interactivos
  toolbar.addEventListener('mouseover', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('.custom-font-dropdown')) {
      toolbar.style.cursor = 'default';
    } else {
      toolbar.style.cursor = 'move';
    }
  });

  let isDraggingToolbar = false;
  let startX = 0, startY = 0;

  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('.custom-font-dropdown')) {
      return;
    }
    isDraggingToolbar = true;
    startX = e.clientX - toolbar.offsetLeft;
    startY = e.clientY - toolbar.offsetTop;
    e.preventDefault();
  });

  document.addEventListener('mousemove', (e) => {
    if (!isDraggingToolbar) return;
    const newLeft = e.clientX - startX;
    const newTop = e.clientY - startY;
    toolbar.style.left = newLeft + 'px';
    toolbar.style.top = newTop + 'px';
    toolbarDragged = true;
  });

  document.addEventListener('mouseup', () => {
    isDraggingToolbar = false;
  });
}

export function initContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  removeOverlapTab();
  populateFontDropdowns();
  makeToolbarDraggable();

  const setClick = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.onclick = fn;
  };

  // --- 1. ACCIONES GENERALES ---
  setClick('btnCtxDelete', () => {
    if (window.selectedItem) {
      deleteImage(window.selectedItem);
      hideContextualMenu();
    }
  });

  setClick('btnCtxDuplicate', () => {
    if (window.selectedItem) {
      duplicateImage(window.selectedItem);
    }
  });

  setClick('btnCtxForward', () => {
    if (window.selectedItem) {
      bringImageForward(window.selectedItem);
    }
  });

  setClick('btnCtxBackward', () => {
    if (window.selectedItem) {
      sendImageBackward(window.selectedItem);
    }
  });

  // --- 2. ACCIONES DE TEXTO AVANZADAS ---
  setClick('btnCtxBold', () => {
    if (window.selectedItem) toggleBold(window.selectedItem);
  });

  setClick('btnCtxItalic', () => {
    if (window.selectedItem) toggleItalic(window.selectedItem);
  });

  setClick('btnCtxUnderline', () => {
    if (window.selectedItem) toggleUnderline(window.selectedItem);
  });

  setClick('btnCtxWeld', () => {
    if (window.selectedItem) weldText(window.selectedItem);
  });

  // Control Deslizante de Curvatura de Texto
  const curveSlider = document.getElementById('ctxTextCurve');
  if (curveSlider) {
    curveSlider.oninput = () => {
      if (window.selectedItem) {
        const val = parseFloat(curveSlider.value);
        applyTextCurve(window.selectedItem, val);
      }
    };
  }

  // Control Deslizante de Espaciado de Caracteres
  const hspaceSlider = document.getElementById('ctxTextHSpace');
  if (hspaceSlider) {
    hspaceSlider.oninput = () => {
      if (window.selectedItem) {
        const val = parseFloat(hspaceSlider.value);
        applyTextSpacing(window.selectedItem, val);
      }
    };
  }

  // --- 3. ACCIONES DE IMAGEN ---
  setClick('btnCtxFlipH', () => {
    if (window.selectedItem) {
      const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
      if (target) {
        if (typeof window.saveHistory === 'function') window.saveHistory();
        target.scale(-1, 1);
        paper.view.update();
      }
    }
  });

  setClick('btnCtxFlipV', () => {
    if (window.selectedItem) {
      const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
      if (target) {
        if (typeof window.saveHistory === 'function') window.saveHistory();
        target.scale(1, -1);
        paper.view.update();
      }
    }
  });

  // --- ACCIONES DE ESCALADO INTERACTIVO ---
  const bindScaleDown = () => {
    if (window.selectedItem) scaleImage(window.selectedItem, 0.9);
  };
  const bindScaleUp = () => {
    if (window.selectedItem) scaleImage(window.selectedItem, 1.1);
  };

  setClick('btnCtxAchicar', bindScaleDown);
  setClick('btnCtxScaleDown', bindScaleDown);
  setClick('btnCtxShrink', bindScaleDown);
  setClick('btnCtxAgrandar', bindScaleUp);
  setClick('btnCtxScaleUp', bindScaleUp);
  setClick('btnCtxGrow', bindScaleUp);

  // Sliders de brillo y contraste
  const briSlider = document.getElementById('ctxBrightness');
  const conSlider = document.getElementById('ctxContrast');
  const handleFilterInput = () => {
    if (window.selectedItem) {
      const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
      if (target && target instanceof paper.Raster) {
        target.data = target.data || {};
        target.data.brightness = briSlider ? parseFloat(briSlider.value) : 0;
        target.data.contrast = conSlider ? parseFloat(conSlider.value) : 0;
        paper.view.update();
      }
    }
  };
  if (briSlider) briSlider.oninput = handleFilterInput;
  if (conSlider) conSlider.oninput = handleFilterInput;
}

export function updateContextualMenu(item) {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  removeOverlapTab();

  if (!item || (item.data && item.data.mockup)) {
    toolbar.classList.remove('active');
    toolbarDragged = false; // Resetear bandera de arrastre al ocultarse
    lastSelectedItem = null;
    return;
  }

  toolbar.classList.add('active');

  const hideSubgroup = (id) => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  };

  hideSubgroup('ctxTextControls');
  hideSubgroup('ctxImageControls');
  hideSubgroup('ctxVectorControls');

  const btnTrace = document.getElementById('btnCtxTrace');
  if (btnTrace) btnTrace.style.display = 'none';

  const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
  if (!target) return;

  if (target instanceof paper.PointText || target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
    const textControls = document.getElementById('ctxTextControls');
    if (textControls) textControls.classList.remove('hidden');

    // Actualizar el valor actual de los sliders de texto si corresponde
    const curveSlider = document.getElementById('ctxTextCurve');
    if (curveSlider) {
      curveSlider.value = target.data?.curvature || 0;
    }
    const hspaceSlider = document.getElementById('ctxTextHSpace');
    if (hspaceSlider) {
      hspaceSlider.value = target.data?.hspace || 0;
    }

    // Actualizar previsualización live del trigger con la fuente actual
    const currentFamily = getSelectedFontFamily();
    const matchedFont = fontsCache.find(f => f.family === currentFamily);
    const triggerLabel = document.getElementById('selected-font-name');
    if (triggerLabel) {
      triggerLabel.textContent = matchedFont ? matchedFont.name : currentFamily;
    }

  } else if (target instanceof paper.Raster) {
    const imageControls = document.getElementById('ctxImageControls');
    if (imageControls) {
      imageControls.classList.remove('hidden');
    }
    const briSlider = document.getElementById('ctxBrightness');
    if (briSlider) briSlider.value = target.data?.brightness || 0;
    const conSlider = document.getElementById('ctxContrast');
    if (conSlider) conSlider.value = target.data?.contrast || 0;

  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    const vectorControls = document.getElementById('ctxVectorControls');
    if (vectorControls) vectorControls.classList.remove('hidden');
  }

  // Reposicionar el menú si el usuario no lo ha arrastrado, o si cambió el objeto de selección
  if (!toolbarDragged || lastSelectedItem !== item) {
    const bounds = item.bounds;
    if (!bounds) return;

    const rect = paper.view.element.getBoundingClientRect();
    const menuWidth = toolbar.offsetWidth || 340;
    const menuHeight = toolbar.offsetHeight || 60;

    const viewPos = paper.view.projectToView(bounds.topCenter);
    let top = rect.top + viewPos.y - menuHeight - 15;
    let left = rect.left + viewPos.x - (menuWidth / 2);

    // Margen de seguridad superior e izquierdo
    if (top < rect.top) top = rect.top + viewPos.y + (bounds.height * paper.view.zoom) + 15;
    if (left < rect.left) left = rect.left + 10;
    if (left + menuWidth > rect.right) left = rect.right - menuWidth - 10;

    toolbar.style.top = top + "px";
    toolbar.style.left = left + "px";
  }

  lastSelectedItem = item;
}

export function hideContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (toolbar) {
    toolbar.classList.remove('active');
    toolbarDragged = false;
    lastSelectedItem = null;
  }
}

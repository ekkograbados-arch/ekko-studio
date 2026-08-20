/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/contextualMenu.js
Descripción: Barra de herramientas flotante de contexto. Soporta barra arrastrable,
desplegable de fuentes personalizado basado en div con previsualización del texto dinámico
en tiempo real, e inyección dinámica de familias de fuentes.
========================================================================= */

import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, applyBrightnessContrast } from "./imageToolbar.js";

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
    .custom-font-dropdown { position: relative; min-width: 180px; height: 34px; background: white; border: 1px solid #ccc; border-radius: 6px; user-select: none; display: inline-block; vertical-align: middle; }
    .selected-font-trigger { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; font-size: 13px; font-weight: bold; cursor: pointer; color: #333; height: 100%; box-sizing: border-box; }
    .font-dropdown-list { position: absolute; top: calc(100% + 4px); left: 0; width: 320px; max-height: 380px; overflow-y: auto; background: white; border: 1px solid #bbb; border-radius: 8px; box-shadow: 0 10px 25px rgba(0,0,0,0.18); z-index: 10010; padding: 6px; box-sizing: border-box; }
    .font-dropdown-list.hidden { display: none; }
    .custom-font-item { padding: 10px 12px; border-bottom: 1px solid #f0f0f0; cursor: pointer; display: flex; flex-direction: column; gap: 2px; transition: background 0.15s; }
    .custom-font-item:last-child { border-bottom: none; }
    .custom-font-item:hover { background: #f0f8ff; }
    .custom-font-item.active { background: #e6f2ff; border-left: 3px solid #007bff; }
    .custom-font-preview { font-size: 22px; color: #000; line-height: 1.2; word-break: break-all; }
    .custom-font-name { font-size: 11px; color: #777; }
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
    // Elemento visual con la tipografía real aplicada
    const preview = document.createElement('div');
    preview.className = 'custom-font-preview';
    preview.style.fontFamily = font.family;
    preview.textContent = previewText;
    // Nombre de la tipografía como subtítulo descriptivo
    const name = document.createElement('div');
    name.className = 'custom-font-name';
    name.textContent = font.name;
    item.appendChild(preview);
    item.appendChild(name);
    // Eventos para interactividad nativa de diseño
    item.onmouseenter = () => {
      if (window.selectedItem) {
        applyFontFamily(window.selectedItem, font.family);
      }
    };
    item.onmouseleave = () => {
      if (window.selectedItem && window.originalFontBackup) {
        applyFontFamily(window.selectedItem, window.originalFontBackup);
      }
    };
    item.onclick = (e) => {
      e.stopPropagation();
      window.originalFontBackup = font.family;
      if (window.selectedItem) {
        applyFontFamily(window.selectedItem, font.family);
        if (typeof window.saveHistory === 'function') window.saveHistory();
      }
      // Cerrar menú interactivo de tipografías
      listContainer.classList.add('hidden');
      const triggerText = document.querySelector('.selected-font-trigger span');
      if (triggerText) triggerText.textContent = font.name;
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
  }
  // Inicializar el dropdown personalizado
  const customDropdown = document.querySelector('.custom-font-dropdown');
  if (customDropdown) {
    const trigger = customDropdown.querySelector('.selected-font-trigger');
    const list = customDropdown.querySelector('.font-dropdown-list');
    const triggerText = trigger ? trigger.querySelector('span') : null;
    if (trigger && list) {
      trigger.onclick = (e) => {
        e.stopPropagation();
        // Cerrar otros dropdowns si los hubiera
        document.querySelectorAll('.font-dropdown-list').forEach(el => {
          if (el !== list) el.classList.add('hidden');
        });
        const isOpen = !list.classList.contains('hidden');
        if (!isOpen) {
          // Copia de seguridad de la fuente original por si cancelan (hover)
          window.originalFontBackup = getSelectedFontFamily();
          renderCustomFontItems(list, fontsCache);
          list.classList.remove('hidden');
        } else {
          list.classList.add('hidden');
        }
      };
      // Cerrar el listado al hacer clic fuera
      document.addEventListener('click', () => {
        list.classList.add('hidden');
      });
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

/**
 * Desagrupa de forma segura un grupo vectorial del cliente (no el mockup del producto),
 * manteniendo cada uno de sus elementos resultantes enmascarados/recortados bajo el clipGroup del lienzo.
 */
export function ungroupSelectedItem() {
  const item = window.selectedItem;
  if (!item || item.data?.locked || item.data?.mockup) {
    console.warn("No se puede desagrupar un objeto protegido o bloqueado.");
    return;
  }
  // Resolver el elemento real en caso de que esté recortado en un clipGroup
  const isClipped = !!item.data?.clipGroup;
  const target = isClipped ? item.children.find(c => !c.clipMask) : item;
  if (!target || !(target instanceof paper.Group)) {
    console.warn("El objeto seleccionado no es un grupo desagrupable.");
    return;
  }
  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }
  // Extraer los hijos del grupo
  const children = [...target.children];
  if (children.length === 0) return;
  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const newItems = [];
  children.forEach((child) => {
    child.remove(); // Desvincular de su contenedor de grupo viejo
    let newItem;
    if (isClipped) {
      // El usuario final requiere que el diseño permanezca recortado dentro del mate/medalla.
      // Para ello, inyectamos cada hijo en un nuevo sub-clipGroup duplicando la máscara nativa.
      newItem = window.clipItem(child);
      parent.addChild(newItem); // Asegurar inserción en el árbol lógico de Paper.js
    } else {
      newItem = child;
      parent.addChild(newItem);
    }
    newItem.data = {
      locked: false,
      label: child.name || child.data?.label || "Elemento Vectorial"
    };
    newItems.push(newItem);
  });
  // Remover el contenedor del grupo original obsoleto
  item.remove();
  // Insertar los elementos desagrupados en el mismo nivel de orden visual
  newItems.reverse().forEach(newItem => {
    if (newItem.parent) {
      newItem.parent.insertChild(index, newItem);
    }
  });
  // Deseleccionar el grupo viejo y re-seleccionar el primer hijo para retroalimentación WYSIWYG
  window.deselectItem();
  if (newItems.length > 0) {
    window.selectItem(newItems);
  }
  paper.view.update();
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
  const bindScaleDown = () => { if (window.selectedItem) scaleImage(window.selectedItem, 0.9); };
  const bindScaleUp = () => { if (window.selectedItem) scaleImage(window.selectedItem, 1.1); };
  setClick('btnCtxAchicar', bindScaleDown);
  setClick('btnCtxScaleDown', bindScaleDown);
  setClick('btnCtxShrink', bindScaleDown);
  setClick('btnCtxAgrandar', bindScaleUp);
  setClick('btnCtxScaleUp', bindScaleUp);
  setClick('btnCtxGrow', bindScaleUp);

  // --- 4. ACCIONES DE VECTORES / SVGS DE USUARIO ---
  setClick('btnCtxUngroup', () => {
    ungroupSelectedItem();
  });
  setClick('btnCtxDesagrupar', () => {
    ungroupSelectedItem();
  });

  // Sliders de brillo y contraste con entradas numéricas de precisión y soporte para rueda de mouse
  const briSlider = document.getElementById('ctxBrightness');
  const conSlider = document.getElementById('ctxContrast');

  const setupSliderWithPrecision = (slider, numId, onChangeFn) => {
    if (!slider) return null;
    
    // Crear el elemento number dinámicamente si no existe
    let numInput = document.getElementById(numId);
    if (!numInput) {
      numInput = document.createElement('input');
      numInput.type = 'number';
      numInput.id = numId;
      numInput.min = slider.min || -100;
      numInput.max = slider.max || 100;
      numInput.value = slider.value || 0;
      numInput.className = 'toolbar-input-number';
      numInput.style.width = '55px';
      numInput.style.marginLeft = '8px';
      numInput.style.padding = '2px 4px';
      numInput.style.border = '1px solid #ccc';
      numInput.style.borderRadius = '4px';
      numInput.style.fontSize = '12px';
      numInput.style.textAlign = 'center';
      
      // Insertar justo después del slider
      slider.parentNode.appendChild(numInput);
    }

    const syncAndTrigger = (val) => {
      const min = parseFloat(slider.min);
      const max = parseFloat(slider.max);
      let cleanVal = parseFloat(val);
      if (isNaN(cleanVal)) cleanVal = 0;
      cleanVal = Math.max(min, Math.min(max, cleanVal));
      
      slider.value = cleanVal;
      numInput.value = cleanVal;
      onChangeFn();
    };

    // Sincronizar desde Slider
    slider.oninput = () => {
      numInput.value = slider.value;
      onChangeFn();
    };

    // Al soltar el click del slider, registrar en el historial de forma transaccional
    slider.onchange = () => {
      if (typeof window.saveHistory === 'function') window.saveHistory();
    };

    // Sincronizar desde Input Numérico
    numInput.oninput = () => {
      syncAndTrigger(numInput.value);
    };

    // Al desenfocar o dar enter en el input de número, guardar en el historial
    numInput.onchange = () => {
      if (typeof window.saveHistory === 'function') window.saveHistory();
    };

    // Soporte anti-duplicados y rueda de mouse (wheel) en el Slider
    if (!slider.dataset.wheelBound) {
      slider.dataset.wheelBound = "true";
      slider.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = 2; // Desplazamiento fluido de a 2 unidades
        const direction = e.deltaY < 0 ? 1 : -1;
        const newVal = parseFloat(slider.value) + (direction * step);
        syncAndTrigger(newVal);
      }, { passive: false });
    }

    // Soporte anti-duplicados y rueda de mouse (wheel) en el Number Input
    if (!numInput.dataset.wheelBound) {
      numInput.dataset.wheelBound = "true";
      numInput.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = 1; // Precisión de 1 unidad
        const direction = e.deltaY < 0 ? 1 : -1;
        const newVal = parseFloat(numInput.value) + (direction * step);
        syncAndTrigger(newVal);
      }, { passive: false });
    }

    return numInput;
  };

  const handleFilterInput = () => {
    if (window.selectedItem) {
      const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
      if (target && target instanceof paper.Raster) {
        target.data = target.data || {};
        const brightness = briSlider ? parseFloat(briSlider.value) : 0;
        const contrast = conSlider ? parseFloat(conSlider.value) : 0;
        target.data.brightness = brightness;
        target.data.contrast = contrast;
        // Aplicar la corrección de brillo y contraste píxel a píxel en tiempo real
        applyBrightnessContrast(target, brightness, contrast);
      }
    }
  };
  setupSliderWithPrecision(briSlider, 'ctxBrightnessNum', handleFilterInput);
  setupSliderWithPrecision(conSlider, 'ctxContrastNum', handleFilterInput);
}

export function updateContextualMenu(item) {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;
  removeOverlapTab();
  // BLOQUEO ARQUITECTÓNICO PREVENTIVO: Proteger mockups de productos en todo caso
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
  } else if (target instanceof paper.Raster) {
    const imageControls = document.getElementById('ctxImageControls');
    if (imageControls) {
      imageControls.classList.remove('hidden');
    }
    const briSlider = document.getElementById('ctxBrightness');
    const briNum = document.getElementById('ctxBrightnessNum');
    const bVal = target.data?.brightness || 0;
    if (briSlider) briSlider.value = bVal;
    if (briNum) briNum.value = bVal;

    const conSlider = document.getElementById('ctxContrast');
    const conNum = document.getElementById('ctxContrastNum');
    const cVal = target.data?.contrast || 0;
    if (conSlider) conSlider.value = cVal;
    if (conNum) conNum.value = cVal;
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    const vectorControls = document.getElementById('ctxVectorControls');
    if (vectorControls) {
      vectorControls.classList.remove('hidden');
      // Mostrar u ocultar el botón de Desagrupar basándose estrictamente en si es un paper.Group
      const btnUngroup = document.getElementById('btnCtxUngroup') || document.getElementById('btnCtxDesagrupar');
      if (btnUngroup) {
        if (target instanceof paper.Group) {
          btnUngroup.classList.remove('hidden');
          btnUngroup.style.display = '';
        } else {
          btnUngroup.classList.add('hidden');
          btnUngroup.style.display = 'none';
        }
      }
    }
  }

  // Reposicionar el menú si el usuario no lo ha arrastrado, o si cambió el objeto de selección
  if (!toolbarDragged || lastSelectedItem !== item) {
    const bounds = item.bounds;
    if (!bounds) return;
    // Colocar el menú centrado flotando ligeramente arriba del objeto seleccionado
    const canvasWrap = document.querySelector('.canvas-wrap');
    const canvasEl = document.getElementById('editorCanvas');
    if (canvasWrap && canvasEl) {
      const canvasRect = canvasEl.getBoundingClientRect();
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const x = canvasRect.left + scrollLeft + bounds.center.x - (toolbar.offsetWidth / 2);
      const y = canvasRect.top + scrollTop + bounds.top - toolbar.offsetHeight - 25;
      toolbar.style.left = Math.max(10, Math.min(x, window.innerWidth - toolbar.offsetWidth - 10)) + 'px';
      toolbar.style.top = Math.max(10, y) + 'px';
    }
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

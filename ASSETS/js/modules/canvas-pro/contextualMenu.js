/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js (DOM-Safe WYSIWYG Edition)
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/contextualMenu.js
Descripción: Barra de herramientas flotante de contexto. Soporta barra arrastrable,
desplegable de fuentes personalizado basado en div con previsualización del texto dinámico
en tiempo real, e inyección dinámica de familias de fuentes.
SOPORTE COMPLETO DE AGRUPACIÓN Y DESAGRUPACIÓN EN LÍNEA PARA CLIENTES Y SVGS CARGADOS.
GARANTÍA ANTI-CORRUPCIÓN: Se inyecta la reubicación en body dinámica para evitar recortes
de overflow y se acopla el sistema projectToView de Paper.js para posicionamiento WYSIWYG.
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
    const preview = document.createElement('div');
    preview.className = 'custom-font-preview';
    preview.style.fontFamily = font.family;
    preview.textContent = previewText;
    const name = document.createElement('div');
    name.className = 'custom-font-name';
    name.textContent = font.name;
    item.appendChild(preview);
    item.appendChild(name);
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
  fontsCache = fonts;
  injectFontFaces(fonts);
  const nativeSelect = document.getElementById('ctxFontSelector');
  if (nativeSelect) {
    nativeSelect.style.display = 'none';
    nativeSelect.classList.add('hidden');
  }
  let customDropdown = document.querySelector('.custom-font-dropdown');
  if (!customDropdown && nativeSelect) {
    customDropdown = document.createElement('div');
    customDropdown.className = 'custom-font-dropdown';
    customDropdown.innerHTML = `
      <div class="selected-font-trigger">
        <span>Seleccionar Fuente</span>
        <i class="fas fa-chevron-down" style="font-size:11px; margin-left:8px; color:#64748b;"></i>
      </div>
      <div class="font-dropdown-list hidden"></div>
    `;
    nativeSelect.parentNode.insertBefore(customDropdown, nativeSelect.nextSibling);
  }
  if (customDropdown) {
    const trigger = customDropdown.querySelector('.selected-font-trigger');
    const list = customDropdown.querySelector('.font-dropdown-list');
    if (trigger && list) {
      trigger.onclick = (e) => {
        e.stopPropagation();
        document.querySelectorAll('.font-dropdown-list').forEach(el => {
          if (el !== list) el.classList.add('hidden');
        });
        const isOpen = !list.classList.contains('hidden');
        if (!isOpen) {
          window.originalFontBackup = getSelectedFontFamily();
          renderCustomFontItems(list, fontsCache);
          list.classList.remove('hidden');
        } else {
          list.classList.add('hidden');
        }
      };
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
    window.customToolbarLeft = newLeft;
    window.customToolbarTop = newTop;
  });
  document.addEventListener('mouseup', () => {
    isDraggingToolbar = false;
  });
  toolbar.addEventListener('dblclick', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('.custom-font-dropdown')) {
      return;
    }
    delete window.customToolbarLeft;
    delete window.customToolbarTop;
    toolbarDragged = false;
    if (window.selectedItem) {
      updateContextualMenu(window.selectedItem);
    }
  });
}

/**
 * Agrupa de forma segura múltiples elementos seleccionados bajo un único Paper.Group,
 * preservando el enmascaramiento dinámico (clipGroup) y el z-index de la escena.
 */
export function groupSelectedItems() {
  const selected = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);

  if (selected.length < 2) {
    alert("Selecciona al menos 2 elementos para poder agruparlos.");
    return;
  }

  // Verificar inmunidad de mockups o bloqueados
  for (let item of selected) {
    if (item.data?.locked || item.data?.mockup) {
      alert("No se pueden agrupar objetos protegidos o bloqueados.");
      return;
    }
  }

  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }

  const contents = [];
  const parent = selected[0].parent || paper.project.activeLayer;
  const index = parent.children.indexOf(selected[0]);
  const isClipped = selected.some(item => !!item.data?.clipGroup);

  selected.forEach(item => {
    let content;
    if (item.data?.clipGroup) {
      content = item.children.find(c => !c.clipMask);
      if (content) {
        content.remove(); // Sacar de su clipGroup individual
      }
    } else {
      content = item;
      content.remove();
    }
    if (content) {
      contents.push(content);
    }
    item.remove(); // Eliminar contenedor anterior
  });

  // Crear el nuevo grupo con los contenidos extraídos
  const newGroup = new paper.Group(contents);
  newGroup.data = { locked: false, label: "Grupo" };

  let finalItem;
  if (isClipped && typeof window.clipItem === 'function') {
    finalItem = window.clipItem(newGroup);
  } else {
    finalItem = newGroup;
    parent.addChild(finalItem);
  }

  if (finalItem.parent) {
    finalItem.parent.insertChild(index, finalItem);
  }

  window.deselectItem();
  window.selectItem(finalItem);
  paper.view.update();
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
  const isClipped = !!item.data?.clipGroup;
  const target = isClipped ? item.children.find(c => !c.clipMask) : item;
  if (!target || !(target instanceof paper.Group)) {
    console.warn("El objeto seleccionado no es un grupo desagrupable.");
    return;
  }
  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }
  const children = [...target.children];
  if (children.length === 0) return;
  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const newItems = [];
  children.forEach((child) => {
    child.remove();
    let newItem;
    if (isClipped) {
      newItem = window.clipItem(child);
    } else {
      newItem = child;
      parent.addChild(newItem);
    }
    newItems.push(newItem);
  });
  item.remove();
  newItems.reverse().forEach(newItem => {
    if (newItem.parent) {
      newItem.parent.insertChild(index, newItem);
    } else {
      parent.insertChild(index, newItem);
    }
  });
  window.deselectItem();
  if (newItems.length > 0) {
    window.selectedItems = [...newItems];
    window.selectedItem = newItems[newItems.length - 1];
    newItems.forEach(it => {
      if (it) it.selected = true;
    });
    if (typeof window.updateSelectionBox === 'function') {
      window.updateSelectionBox(window.selectedItem);
    }
    if (typeof window.updateContextualMenu === 'function') {
      window.updateContextualMenu(window.selectedItem);
    }
  }
  paper.view.update();
}

export function initContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;
  if (toolbar.parentNode !== document.body) {
    document.body.appendChild(toolbar);
  }
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

  const curveSlider = document.getElementById('ctxTextCurve');
  if (curveSlider) {
    curveSlider.oninput = () => {
      if (window.selectedItem) {
        const val = parseFloat(curveSlider.value);
        applyTextCurve(window.selectedItem, val);
      }
    };
  }
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

  const bindScaleDown = () => { if (window.selectedItem) scaleImage(window.selectedItem, 0.9); };
  const bindScaleUp = () => { if (window.selectedItem) scaleImage(window.selectedItem, 1.1); };
  setClick('btnCtxAchicar', bindScaleDown);
  setClick('btnCtxScaleDown', bindScaleDown);
  setClick('btnCtxShrink', bindScaleDown);
  setClick('btnCtxAgrandar', bindScaleUp);
  setClick('btnCtxScaleUp', bindScaleUp);
  setClick('btnCtxGrow', bindScaleUp);

  // --- 4. ACCIONES DE VECTORES / SVGS DE USUARIO ---
  setClick('btnCtxGroup', () => {
    groupSelectedItems();
  });
  setClick('btnCtxAgrupar', () => {
    groupSelectedItems();
  });
  setClick('btnCtxUngroup', () => {
    ungroupSelectedItem();
  });
  setClick('btnCtxDesagrupar', () => {
    ungroupSelectedItem();
  });

  const briSlider = document.getElementById('ctxBrightness');
  const conSlider = document.getElementById('ctxContrast');
  const setupSliderWithPrecision = (slider, numId, onChangeFn) => {
    if (!slider) return null;
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
    slider.oninput = () => {
      numInput.value = slider.value;
      onChangeFn();
    };
    slider.onchange = () => {
      if (typeof window.saveHistory === 'function') window.saveHistory();
    };
    numInput.oninput = () => {
      syncAndTrigger(numInput.value);
    };
    numInput.onchange = () => {
      if (typeof window.saveHistory === 'function') window.saveHistory();
    };
    if (!slider.dataset.wheelBound) {
      slider.dataset.wheelBound = "true";
      slider.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = 2;
        const direction = e.deltaY < 0 ? 1 : -1;
        const newVal = parseFloat(slider.value) + (direction * step);
        syncAndTrigger(newVal);
      }, { passive: false });
    }
    if (!numInput.dataset.wheelBound) {
      numInput.dataset.wheelBound = "true";
      numInput.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = 1;
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
        applyBrightnessContrast(target, brightness, contrast);
      }
    }
  };

  setupSliderWithPrecision(briSlider, 'ctxBrightnessNum', handleFilterInput);
  setupSliderWithPrecision(conSlider, 'ctxContrastNum', handleFilterInput);

  // --- 5. CONTROL TAMAÑO DE FUENTE ---
  const fontSizeInput = document.getElementById('ctxFontSize');
  if (fontSizeInput) {
    const updateSize = (val) => {
      if (!window.selectedItem || window.selectedItem.data?.locked) return;
      let newSize = parseFloat(val);
      if (isNaN(newSize) || newSize < 5) return;
      if (typeof window.saveHistory === 'function') window.saveHistory();
      let target = window.selectedItem;
      if (target.data?.clipGroup) {
        target = target.children.find(c => !c.clipMask);
      }
      if (!target) return;
      if (target instanceof paper.PointText) {
        target.fontSize = newSize;
        target.data = target.data || {};
        target.data.fontSize = newSize;
      } else if (target.data?.isCurvedGroup) {
        target.data.fontSize = newSize;
        applyTextCurve(target, target.data.curvature);
      } else if (target.data?.isSpacedGroup) {
        target.data.fontSize = newSize;
        applyTextSpacing(target, target.data.hspace);
      }
      if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(window.selectedItem);
      }
      paper.view.update();
    };
    fontSizeInput.oninput = () => {
      updateSize(fontSizeInput.value);
    };
    if (!fontSizeInput.dataset.wheelBound) {
      fontSizeInput.dataset.wheelBound = "true";
      fontSizeInput.addEventListener('wheel', (e) => {
        e.preventDefault();
        const step = e.shiftKey ? 5 : 1;
        const direction = e.deltaY < 0 ? 1 : -1;
        let val = parseInt(fontSizeInput.value) || 12;
        let newVal = val + direction * step;
        newVal = Math.max(5, Math.min(250, newVal));
        fontSizeInput.value = newVal;
        updateSize(newVal);
      }, { passive: false });
    }
  }

  // --- 6. SHORTCUTS GLOBALES DE TECLADO ---
  if (!window.groupKeyboardEventsBound) {
    window.groupKeyboardEventsBound = true;
    document.addEventListener('keydown', (e) => {
      const activeEl = document.activeElement;
      if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA' || activeEl.id === 'ekko-text-editor')) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        groupSelectedItems();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
        e.preventDefault();
        ungroupSelectedItem();
      }
    });
  }

  // Exposición global para compatibilidad de la barra superior
  window.groupSelectedItems = groupSelectedItems;
  window.ungroupSelectedItem = ungroupSelectedItem;
}

export function updateContextualMenu(item) {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;
  removeOverlapTab();

  if (!item || (item.data && item.data.mockup)) {
    toolbar.classList.remove('active');
    toolbarDragged = false;
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

  const selectedCount = window.selectedItems ? window.selectedItems.length : 0;

  if (selectedCount > 1) {
    // Si hay multi-selección, mostramos el panel de vectores con el botón "Agrupar" visible
    const vectorControls = document.getElementById('ctxVectorControls');
    if (vectorControls) {
      vectorControls.classList.remove('hidden');
      const btnGroup = document.getElementById('btnCtxGroup') || document.getElementById('btnCtxAgrupar');
      const btnUngroup = document.getElementById('btnCtxUngroup') || document.getElementById('btnCtxDesagrupar');
      if (btnGroup) {
        btnGroup.classList.remove('hidden');
        btnGroup.style.display = '';
      }
      if (btnUngroup) {
        btnUngroup.classList.add('hidden');
        btnUngroup.style.display = 'none';
      }
    }
  } else {
    // Si solo hay un elemento seleccionado
    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (!target) return;

    if (target instanceof paper.PointText || target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
      const textControls = document.getElementById('ctxTextControls');
      if (textControls) textControls.classList.remove('hidden');

      const currentFamily = getSelectedFontFamily();
      const matchingFont = fontsCache.find(f => f.family === currentFamily);
      const fontDisplayName = matchingFont ? matchingFont.name : currentFamily;
      const triggerText = document.querySelector('.selected-font-trigger span');
      if (triggerText) {
        triggerText.textContent = fontDisplayName;
      }

      let currentSize = 42;
      if (target instanceof paper.PointText) {
        currentSize = Math.round(target.fontSize);
      } else if (target.data && target.data.fontSize) {
        currentSize = Math.round(target.data.fontSize);
      }
      const fontSizeInput = document.getElementById('ctxFontSize');
      if (fontSizeInput) {
        fontSizeInput.value = currentSize;
      }
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
        const btnGroup = document.getElementById('btnCtxGroup') || document.getElementById('btnCtxAgrupar');
        const btnUngroup = document.getElementById('btnCtxUngroup') || document.getElementById('btnCtxDesagrupar');
        if (btnGroup) {
          btnGroup.classList.add('hidden');
          btnGroup.style.display = 'none';
        }
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
  }

  // Reposicionar el menú si el usuario no lo ha arrastrado, o si cambió el objeto de selección
  if (window.customToolbarLeft !== undefined && window.customToolbarTop !== undefined) {
    toolbar.style.left = window.customToolbarLeft + 'px';
    toolbar.style.top = window.customToolbarTop + 'px';
    toolbar.style.zIndex = "2147483647";
  } else if (!toolbarDragged || lastSelectedItem !== item) {
    const bounds = item.bounds;
    if (!bounds) return;
    const canvasEl = document.getElementById('editorCanvas');
    if (canvasEl && window.paper && paper.view) {
      const canvasRect = canvasEl.getBoundingClientRect();
      const scrollLeft = window.pageXOffset || document.documentElement.scrollLeft;
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

      const displayItem = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
      const targetBounds = displayItem ? displayItem.bounds : bounds;
      const viewPos = paper.view.projectToView(targetBounds.topCenter);
      const x = canvasRect.left + scrollLeft + viewPos.x - (toolbar.offsetWidth / 2);
      const y = canvasRect.top + scrollTop + viewPos.y - toolbar.offsetHeight - 25;
      toolbar.style.left = Math.max(10, Math.min(x, window.innerWidth - toolbar.offsetWidth - 10)) + 'px';
      toolbar.style.top = Math.max(10, y) + 'px';
      toolbar.style.zIndex = "2147483647";
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

// 🚀 REPOSICIONADOR GLOBAL HTML: Sincronizar elementos flotantes en body al arrastrar o hacer zoom
window.applyPositionCorrections = function() {
  const toolbar = document.getElementById("contextual-toolbar");
  const textEditor = document.getElementById("ekko-text-editor");
  if (!window.paper || !paper.view || !window.selectedItem) return;

  const item = window.selectedItem;
  const displayItem = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
  if (!displayItem) return;

  const bounds = displayItem.bounds;
  const viewPos = paper.view.projectToView(bounds.topCenter);
  const centerPos = paper.view.projectToView(bounds.center);

  // 1. Corregir Barra Contextual Flotante (Evita que quede oculta o desfasada)
  if (toolbar && toolbar.classList.contains("active")) {
    if (window.customToolbarLeft !== undefined && window.customToolbarTop !== undefined) {
      toolbar.style.position = "absolute";
      toolbar.style.left = window.customToolbarLeft + "px";
      toolbar.style.top = window.customToolbarTop + "px";
      toolbar.style.zIndex = "2147483646";
    } else {
      const toolbarHeight = toolbar.offsetHeight || 45;
      const toolbarWidth = toolbar.offsetWidth || 350;
      const canvasEl = document.getElementById("editorCanvas");
      if (canvasEl) {
        const rect = canvasEl.getBoundingClientRect();
        const targetLeft = rect.left + window.scrollX + viewPos.x - (toolbarWidth / 2);
        const targetTop = rect.top + window.scrollY + viewPos.y - toolbarHeight - 25; // 25px de margen superior
        toolbar.style.position = "absolute";
        toolbar.style.left = Math.max(10, Math.min(window.innerWidth - toolbarWidth - 10, targetLeft)) + "px";
        toolbar.style.top = Math.max(10, Math.min(window.innerHeight - toolbarHeight - 10, targetTop)) + "px";
      }
      toolbar.style.zIndex = "2147483646"; // Maximum 32-bit integer priority to float over everything including rulers
    }
  }

  // 2. Corregir Editor de Texto (Evita que el recuadro de escritura aparezca en la esquina superior izquierda)
  if (textEditor) {
    const editorWidth = textEditor.offsetWidth || 150;
    const editorHeight = textEditor.offsetHeight || 40;
    const canvasEl = document.getElementById("editorCanvas");
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const targetLeft = rect.left + window.scrollX + centerPos.x - (editorWidth / 2);
      const targetTop = rect.top + window.scrollY + centerPos.y - (editorHeight / 2);
      textEditor.style.left = targetLeft + "px";
      textEditor.style.top = targetTop + "px";
      textEditor.style.position = "absolute";
      textEditor.style.zIndex = "2147483647"; // Keep editor above toolbar in all contexts
    }
  }
};

/* =========================================================================
   Módulo: js/modules/canvas-pro/contextualMenu.js
   Ruta de reemplazo: js/modules/canvas-pro/contextualMenu.js
   Descripción: Barra de herramientas flotante de contexto. Soporta alineación de
                fuentes redundantes dinámicas y mapeos retrocompatibles.
   ========================================================================= */

import { 
  toggleBold, 
  toggleItalic, 
  toggleUnderline, 
  weldText, 
  applyTextCurve, 
  applyTextSpacing,
  loadDynamicFonts 
} from "/ASSETS/js/modules/canvas-pro/textToolbar.js";

import {
  scaleImage,
  duplicateImage,
  deleteImage,
  bringImageForward,
  sendImageBackward
} from "/ASSETS/js/modules/canvas-pro/selection.js";

// Variable global de previsualización en window
window.originalFontBackup = null;

// Diccionario duplicado local para inyección de estilos css dinámica
const LEGACY_FONT_ALIASES = {
  "billiejames": ["ekko_billie", "ekko_billiejames_regular"],
  "romantic": ["ekko_romantic", "ekko_romantic_sunrise"],
  "farmhouse": ["ekko_farmhouse"],
  "chocolate": ["ekko_chocolate"],
  "waltograph": ["ekko_disney", "ekko_waltograph", "ekko_waltograph42"],
  "simpson": ["ekko_simpson", "ekko_simpsonfont_demo"],
  "milk": ["ekko_milk", "ekko_milk_water"],
  "simplehandmade": ["ekko_simple"],
  "studynight": ["ekko_studynight"],
  "studyperson": ["ekko_studyperson"],
  "nostalgic": ["ekko_nostalgic"],
  "please writ": ["ekko_song"]
};

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
      const normalizedText = el.textContent.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
      if (normalizedText.includes('EVITAR SUPERPOSICION')) {
        el.remove();
      }
    }
  });
}

/**
 * Inyecta dinámicamente las reglas de @font-face en el encabezado (head) para cada fuente devuelta,
 * asegurando la creación de familias duplicadas para los alias históricos.
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
    const familiesToInject = [font.family];
    
    // Identificar alias para inyección CSS
    const lowerFile = font.file.toLowerCase();
    for (const [pattern, aliases] of Object.entries(LEGACY_FONT_ALIASES)) {
      if (lowerFile.includes(pattern)) {
        aliases.forEach(alias => {
          if (!familiesToInject.includes(alias)) {
            familiesToInject.push(alias);
          }
        });
      }
    }
    
    familiesToInject.forEach(family => {
      if (!cssRules.includes(`font-family: "${family}"`) && !cssRules.includes(`font-family: '${family}'`)) {
        cssRules += `
@font-face {
  font-family: "${family}";
  src: url("/ASSETS/fonts/${font.file}") format("woff2"),
       url("/ASSETS/fonts/${font.file}") format("truetype"),
       url("/ASSETS/fonts/${font.file}") format("opentype");
  font-display: swap;
}`;
      }
    });
  });
  
  styleEl.textContent += cssRules;
}

/**
 * Carga las fuentes dinámicas de la API, inyecta sus @font-face y puebla los dropdowns
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
  injectFontFaces(fonts);
  
  const dropdowns = [
    document.getElementById('ctxFontSelector'),
    document.getElementById('fontSelector')
  ];
  
  dropdowns.forEach(dropdown => {
    if (!dropdown) return;
    dropdown.innerHTML = "";
    
    fonts.forEach(font => {
      const opt = document.createElement("option");
      opt.value = font.family;
      opt.textContent = font.name;
      opt.style.fontFamily = font.family;
      dropdown.appendChild(opt);
    });
  });
  
  const sidebarGallery = document.getElementById("fontGallery");
  if (sidebarGallery) {
    sidebarGallery.classList.add("hidden");
  }
}

export function initContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;
  
  removeOverlapTab();
  populateFontDropdowns();
  
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
  const fontSelector = document.getElementById('ctxFontSelector');
  if (fontSelector) {
    fontSelector.onchange = () => {
      if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        if (target) {
          if (typeof window.saveHistory === 'function') window.saveHistory();
          target.fontFamily = fontSelector.value;
          window.updateSelectionBox(window.selectedItem);
          paper.view.update();
        }
      }
    };
  }
  
  setClick('btnCtxBold', () => { if (window.selectedItem) toggleBold(window.selectedItem); });
  setClick('btnCtxItalic', () => { if (window.selectedItem) toggleItalic(window.selectedItem); });
  setClick('btnCtxUnderline', () => { if (window.selectedItem) toggleUnderline(window.selectedItem); });
  setClick('btnCtxWeld', () => { if (window.selectedItem) weldText(window.selectedItem); });
  
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
  
  // Sliders de brillo y contraste
  const briSlider = document.getElementById('ctxBrightness');
  const conSlider = document.getElementById('ctxContrast');
  const handleFilterInput = () => {
    if (window.selectedItem) {
      const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
      if (target && target instanceof paper.Raster) {
        // Lógica de manipulación de filtros del raster
        target.data = target.data || {};
        target.data.brightness = briSlider ? parseFloat(briSlider.value) : 0;
        target.data.contrast = conSlider ? parseFloat(conSlider.value) : 0;
        // Aplicar filtros en tiempo real
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
    // Actualizar sliders contextuales para reflejar el estado actual del texto seleccionado
    const curveSlider = document.getElementById('ctxTextCurve');
    if (curveSlider) curveSlider.value = target.data?.curvature || 0;
    const hspaceSlider = document.getElementById('ctxTextHSpace');
    if (hspaceSlider) hspaceSlider.value = target.data?.hspace || 0;
  } else if (target instanceof paper.Raster) {
    const imageControls = document.getElementById('ctxImageControls');
    if (imageControls) {
      imageControls.classList.remove('hidden');
    }
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group) {
    const vectorControls = document.getElementById('ctxVectorControls');
    if (vectorControls) vectorControls.classList.remove('hidden');
  }
  
  // Posicionamiento de la barra flotante encima del elemento seleccionado
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

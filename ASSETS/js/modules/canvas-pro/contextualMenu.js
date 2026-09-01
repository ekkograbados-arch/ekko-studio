/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js
Versión: v36.0 PRO - Universal Hierarchy, CSG Reactive & LightBurn Stacking
Ruta en repositorio: ASSETS/js/modules/canvas-pro/contextualMenu.js

Descripción:
Gestor unificado del menú contextual flotante, tipografías dinámicas, transformaciones,
agrupación simétrica y barra de acciones para EKKO Studio basado en Paper.js.

Cumple rigurosamente con:
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO:
  1. CONCEPTO FUNDAMENTAL: Descomposición por Jerarquía de Contención y Capas.
  2. DESAGRUPAR EN UN SOLO CLIC: Disolución completa del contenedor padre e independización
     total de masas positivas y calados activos.
  3. MASAS POSITIVAS + HUECOS ACTIVOS REALES: Los huecos sustraen material físicamente
     de las masas inferiores en el orden Z.
  4. ORDEN Z DINÁMICO (LIGHTBURN STYLE): Subir/Bajar capa, Al Frente y Al Fondo con recálculo
     reactivo dinámico CSG en caliente (recalculateDynamicSubtractions).
  5. PRESERVACIÓN DE geomBase Y COMPATIBILIDAD clipGroup: Respeto absoluto del contenedor
     de producto sin desfasar máscaras ni corromper geometría neutra.
  6. TRAZABILIDAD COMPLETA EN EKKO_DIAG (5 NIVELES): Enrutamiento formal y registro de llamadas
     en el Call Graph de Nivel 3.
========================================================================= */

import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, bringImageToFront, sendImageToBack, applyBrightnessContrast } from "./imageToolbar.js";
import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";
import { decomposeByContainmentHierarchy, recalculateDynamicSubtractions } from "./geometricUngroup.js";

/**
 * Resuelve de forma segura el elemento geométrico de contenido útil,
 * contemplando el encapsulamiento de producto (clipGroup).
 * @param {paper.Item} item
 * @returns {paper.Item|null}
 */
function getContentItem(item) {
  if (!item) return null;
  if (item.data && item.data.clipGroup) {
    if (!item.children) return item;
    const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
    if (content) return content;
    const fallback = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup)));
    if (fallback) return fallback;
    return item.children[1] || item.children[0] || item;
  }
  return item;
}

function isPath(item) {
  if (!item) return false;
  return item.className === 'Path' || (typeof paper !== 'undefined' && paper.Path && item instanceof paper.Path);
}

function isCompoundPath(item) {
  if (!item) return false;
  return item.className === 'CompoundPath' || (typeof paper !== 'undefined' && paper.CompoundPath && item instanceof paper.CompoundPath);
}

function isGroup(item) {
  if (!item) return false;
  return item.className === 'Group' || (typeof paper !== 'undefined' && paper.Group && item instanceof paper.Group);
}

function isRaster(item) {
  if (!item) return false;
  return item.className === 'Raster' || (typeof paper !== 'undefined' && paper.Raster && item instanceof paper.Raster);
}

function isPointText(item) {
  if (!item) return false;
  return item.className === 'PointText' || (typeof paper !== 'undefined' && paper.PointText && item instanceof paper.PointText);
}

function isSymbolItem(item) {
  if (!item) return false;
  return item.className === 'SymbolItem' || item.className === 'PlacedSymbol' ||
    (typeof paper !== 'undefined' && paper.PlacedSymbol && item instanceof paper.PlacedSymbol);
}

function isShape(item) {
  if (!item) return false;
  return item.className === 'Shape' || (typeof paper !== 'undefined' && paper.Shape && item instanceof paper.Shape);
}

function isLayer(item) {
  if (!item) return false;
  return item.className === 'Layer' || (typeof paper !== 'undefined' && paper.Layer && item instanceof paper.Layer);
}

function isMockupOrProductElement(item) {
  if (!item) return false;
  let curr = item;
  while (curr) {
    if (curr.data && (
      curr.data.mockup || curr.data.isMask || curr.data.wasClipMask ||
      curr.data.isSelectionBox || curr.data.isHandle || curr.data.isNodeHandle ||
      curr.data.isCurveHandle || curr.data.isNodeEditOverlay || curr.data.isSmartGuide ||
      curr.data.isMeasurement || curr.data.isTracePreview || curr.data.isUnderlineLine
    )) {
      return true;
    }
    if (typeof window !== 'undefined' && (
      curr === window.currentMockup ||
      curr === window.selectionBoxGroup ||
      curr === window.nodeHandlesGroup
    )) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

window.originalFontBackup = null;
let fontsCache = [];
let toolbarDragged = false;
let lastSelectedItem = null;

// Estilos del menú contextual y dropdown tipográfico
const contextualStylesId = 'ekko-contextual-menu-styles';
if (typeof document !== 'undefined' && !document.getElementById(contextualStylesId)) {
  const styleEl = document.createElement('style');
  styleEl.id = contextualStylesId;
  styleEl.textContent = `
    #contextual-toolbar {
      position: absolute;
      display: none;
      background: #ffffff;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
      padding: 8px 14px;
      z-index: 2147483647;
      align-items: center;
      gap: 12px;
      pointer-events: auto;
      user-select: none;
      transition: opacity 0.15s ease-out;
      flex-wrap: wrap;
      max-width: 760px;
    }
    #contextual-toolbar.active {
      display: flex;
    }
    .custom-font-dropdown { position: relative; display: inline-block; min-width: 140px; }
    .selected-font-trigger {
      display: flex; align-items: center; justify-content: space-between;
      padding: 5px 10px; border: 1px solid #cbd5e1; border-radius: 4px;
      cursor: pointer; background: #fff; font-size: 13px; font-weight: 500;
    }
    .font-dropdown-list {
      position: absolute; top: 100%; left: 0; right: 0; max-height: 250px;
      overflow-y: auto; background: #fff; border: 1px solid #cbd5e1;
      border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 2147483647;
    }
    .font-dropdown-item {
      padding: 6px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px;
      border-bottom: 1px solid #f1f5f9;
    }
    .font-dropdown-item:hover { background: #e6f7ff; }
    .font-name-label { font-size: 11px; color: #888; text-transform: uppercase; }
    .hidden { display: none !important; }
  `;
  document.head.appendChild(styleEl);
}

function removeOverlapTab() {
  const btnSubtract = document.getElementById('btnCtxSubtract');
  if (btnSubtract) {
    btnSubtract.style.display = 'none';
    btnSubtract.remove();
  }
}

function injectFontFaces(fonts) {
  let styleEl = document.getElementById('ekko-dynamic-font-faces');
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'ekko-dynamic-font-faces';
    document.head.appendChild(styleEl);
  }
  let css = "";
  fonts.forEach(font => {
    css += `@font-face { font-family: "${font.family}"; src: url("${font.file}") format("woff2"); font-display: swap; }\n`;
  });
  styleEl.textContent = css;
}

function getSelectedTextString() {
  if (!window.selectedItem) return "EKKO Studio";
  const target = window.selectedItem.data?.clipGroup ? getContentItem(window.selectedItem) : window.selectedItem;
  if (!target) return "EKKO Studio";
  if (isPointText(target)) {
    return target.content || "EKKO Studio";
  }
  if (target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
    return target.data.textString || "EKKO Studio";
  }
  return "EKKO Studio";
}

function getSelectedFontFamily() {
  if (!window.selectedItem) return "Arial";
  const target = window.selectedItem.data?.clipGroup ? getContentItem(window.selectedItem) : window.selectedItem;
  if (!target) return "Arial";
  if (isPointText(target)) {
    return target.fontFamily || "Arial";
  }
  if (target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
    return target.data.fontFamily || "Arial";
  }
  return "Arial";
}

function applyFontFamily(item, fontFamily) {
  if (!item) return;
  const target = item.data?.clipGroup ? getContentItem(item) : item;
  if (!target) return;
  if (isPointText(target)) {
    target.fontFamily = fontFamily;
  } else if (target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
    target.data.fontFamily = fontFamily;
    if (target.children) {
      target.children.forEach(c => {
        if (isPointText(c)) c.fontFamily = fontFamily;
      });
    }
  }
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(item);
  }
  paper.view.update();
}

function renderFontList(fonts, listContainer) {
  if (!listContainer) return;
  listContainer.innerHTML = '';
  const sampleText = getSelectedTextString();

  fonts.forEach(font => {
    const item = document.createElement('div');
    item.className = 'font-dropdown-item';
    item.innerHTML = `
      <span class="font-name-label">${font.name}</span>
      <span style="font-family: '${font.family}', sans-serif; font-size: 16px; color: #111;">${sampleText}</span>
    `;

    item.onmouseenter = () => {
      if (window.selectedItem) applyFontFamily(window.selectedItem, font.family);
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

async function populateFontDropdowns() {
  let fonts = [];
  try {
    if (typeof loadDynamicFonts === 'function') {
      fonts = await loadDynamicFonts();
    }
  } catch (err) {
    console.warn("No se pudieron cargar fuentes dinámicas:", err);
  }

  if (fonts.length > 0) {
    fontsCache = fonts;
    injectFontFaces(fonts);
  }

  const nativeSelect = document.getElementById('ctxFontSelector');
  if (nativeSelect && fontsCache.length > 0) {
    nativeSelect.innerHTML = '';
    fontsCache.forEach(font => {
      const opt = document.createElement('option');
      opt.value = font.family;
      opt.textContent = font.name;
      nativeSelect.appendChild(opt);
    });
    nativeSelect.onchange = (e) => {
      if (window.selectedItem) {
        applyFontFamily(window.selectedItem, e.target.value);
        if (typeof window.saveHistory === 'function') window.saveHistory();
      }
    };
  }

  let customDropdown = document.querySelector('.custom-font-dropdown');
  if (customDropdown) {
    const trigger = customDropdown.querySelector('.selected-font-trigger');
    const list = customDropdown.querySelector('.font-dropdown-list');
    if (trigger && list) {
      trigger.onclick = (e) => {
        e.stopPropagation();
        const isOpen = !list.classList.contains('hidden');
        if (isOpen) {
          list.classList.add('hidden');
        } else {
          window.originalFontBackup = getSelectedFontFamily();
          renderFontList(fontsCache, list);
          list.classList.remove('hidden');
        }
      };
      document.addEventListener('click', () => {
        list.classList.add('hidden');
      });
    }
  }
}

function makeToolbarDraggable() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  let isDraggingToolbar = false;
  let startX = 0;
  let startY = 0;

  toolbar.addEventListener('mouseover', (e) => {
    if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('.custom-font-dropdown')) {
      toolbar.style.cursor = 'default';
    } else {
      toolbar.style.cursor = 'move';
    }
  });

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
    toolbar.style.left = (e.clientX - startX) + 'px';
    toolbar.style.top = (e.clientY - startY) + 'px';
    toolbarDragged = true;
  });

  document.addEventListener('mouseup', () => {
    isDraggingToolbar = false;
  });
}

/**
 * AGRUPAR: Preserva la semántica de capas, calados activos y orden Z.
 */
export function groupSelectedItems() {
  const selected = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);

  if (selected.length < 2) {
    alert("Selecciona al menos 2 elementos para poder agruparlos.");
    return;
  }

  if (typeof window.saveHistory === 'function') window.saveHistory();

  const parent = selected[0].parent || (paper.project && paper.project.activeLayer);
  const lowestIndex = Math.min(...selected.map(it => parent.children.indexOf(it)));
  const anyClipped = selected.some(it => !!(it.data && it.data.clipGroup));

  const rawItems = selected.map(it => {
    if (it.data && it.data.clipGroup) {
      return getContentItem(it);
    }
    return it;
  }).filter(Boolean);

  const group = new paper.Group(rawItems);
  group.data = {
    locked: false,
    label: "Grupo (" + rawItems.length + " capas)",
    geometricHierarchy: "compoundGroup"
  };

  let finalGroup = group;
  if (anyClipped && typeof window.clipItem === 'function') {
    finalGroup = window.clipItem(group);
  } else if (parent) {
    parent.insertChild(lowestIndex, finalGroup);
    if (window.currentMockup) {
      finalGroup.insertBelow(window.currentMockup);
    }
  }

  if (typeof window.deselectItem === 'function') window.deselectItem();
  if (typeof window.selectItem === 'function') window.selectItem(finalGroup);

  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  }

  paper.view.update();
}

/**
 * DESAGRUPAR: Descomposición completa en 1 clic con selección unificada limpia.
 * Erradica contenedores persistentes y garantiza la entrega de masas y calados independientes.
 */
export function ungroupSelectedItem() {
  const wasInNodeEdit = !!window.nodeEditMode;
  if (wasInNodeEdit && typeof exitNodeEditMode === 'function') {
    exitNodeEditMode(true);
  }

  const selectedList = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);

  if (selectedList.length === 0) return;

  if (typeof window.saveHistory === 'function') window.saveHistory();

  const allCreatedItems = [];

  selectedList.forEach(item => {
    if (!item || isMockupOrProductElement(item)) return;

    const isClipped = !!(item.data && item.data.clipGroup);
    const actualItem = isClipped ? getContentItem(item) : item;
    if (!actualItem) return;

    const isLayerGroup = isGroup(actualItem) && (
      actualItem.data?.geometricHierarchy === "compoundGroup" ||
      actualItem.data?.label?.toLowerCase().includes("grupo")
    );

    if (isLayerGroup) {
      const parent = actualItem.parent || (paper.project && paper.project.activeLayer);
      const idx = parent ? parent.children.indexOf(actualItem) : 0;
      const children = [...actualItem.children];
      children.forEach((c, i) => {
        let delivered = c;
        if (isClipped && typeof window.clipItem === 'function') {
          delivered = window.clipItem(c);
        } else if (parent) {
          parent.insertChild(idx + i, c);
        }
        allCreatedItems.push(delivered);
      });
      actualItem.remove();
      if (item !== actualItem) item.remove();
    } else {
      // Pasar el contenedor superior completo 'item' para garantizar que decomposeByContainmentHierarchy
      // pueda destruir el grupo padre 'clipGroup' de forma física y completa
      const res = decomposeByContainmentHierarchy(item, isClipped);
      if (res && res.items && res.items.length > 0) {
        allCreatedItems.push(...res.items);
      } else {
        allCreatedItems.push(item);
      }
    }
  });

  if (allCreatedItems.length > 0) {
    if (typeof window.deselectItem === 'function') {
      window.deselectItem();
    }

    // Filtrar solo masas positivas para la selección primaria visible, evitando que la selección
    // apunte a calados invisibles
    const primaryCandidate = allCreatedItems.find(it => {
      const content = getContentItem(it);
      return content && !(content.data && content.data.isHole);
    }) || allCreatedItems[allCreatedItems.length - 1];

    window.selectedItems = [...allCreatedItems];
    window.selectedItem = primaryCandidate;
    allCreatedItems.forEach(it => { if (it) it.selected = true; });

    if (typeof window.updateSelectionBox === 'function') {
      window.updateSelectionBox(window.selectedItem);
    }
    if (typeof updateContextualMenu === 'function') {
      updateContextualMenu(window.selectedItem);
    }
  }

  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  }

  paper.view.update();
}

/**
 * Inicializador principal del menú contextual
 */
export function initContextualMenu() {
  const canvasEl = document.getElementById("editorCanvas");
  if (canvasEl) {
    canvasEl.addEventListener("contextmenu", (e) => {
      if (window.nodeEditMode) {
        e.preventDefault();
        if (typeof window.exitNodeEditMode === 'function') {
          window.exitNodeEditMode();
        }
        return;
      }
      if (window.insertTextMode) {
        e.preventDefault();
        window.insertTextMode = false;
        canvasEl.style.cursor = "default";
        paper.view.update();
        return;
      }
      const textEditor = document.getElementById("ekko-text-editor");
      if (textEditor && document.activeElement === textEditor) {
        e.preventDefault();
        textEditor.blur();
        return;
      }
    }, { capture: true });
  }

  const toolbar = document.getElementById("contextual-toolbar");
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

  // --- BOTÓN ELIMINAR OBJETO COMPLETO (#btnCtxDelete) ---
  setClick('btnCtxDelete', () => {
    if (window.nodeEditMode && typeof window.exitNodeEditMode === 'function') {
      window.exitNodeEditMode(true);
    }
    const target = window.nodeEditTarget || window.selectedItem;
    if (target) {
      deleteImage(target);
      hideContextualMenu();
      if (typeof window.recalculateDynamicSubtractions === 'function') {
        window.recalculateDynamicSubtractions();
      }
    }
  });

  // --- BOTÓN DUPLICAR OBJETO COMPLETO (#btnCtxDuplicate) ---
  setClick('btnCtxDuplicate', () => {
    let target = window.nodeEditTarget || window.selectedItem;
    if (window.nodeEditMode) {
      if (typeof window.exitNodeEditMode === 'function') {
        window.exitNodeEditMode(false);
      }
      target = window.selectedItem || target;
    }
    if (target) {
      duplicateImage(target);
    }
  });

  // --- BOTONES DE APILAMIENTO Z (LIGHTBURN STYLE) CON RECÁLCULO CSG ---
  setClick('btnCtxToFront', () => {
    if (window.nodeEditMode && typeof window.exitNodeEditMode === 'function') {
      window.exitNodeEditMode(false);
    }
    const target = window.nodeEditTarget || window.selectedItem;
    if (target) {
      if (typeof bringImageToFront === 'function') {
        bringImageToFront(target);
      } else if (typeof window.bringFront === 'function') {
        window.bringFront();
      }
    }
    if (typeof window.recalculateDynamicSubtractions === 'function') {
      window.recalculateDynamicSubtractions();
    }
  });

  setClick('btnCtxForward', () => {
    if (window.nodeEditMode && typeof window.exitNodeEditMode === 'function') {
      window.exitNodeEditMode(false);
    }
    const target = window.nodeEditTarget || window.selectedItem;
    if (target) {
      if (typeof bringImageForward === 'function') {
        bringImageForward(target);
      } else if (typeof window.bringForward === 'function') {
        window.bringForward();
      }
    }
    if (typeof window.recalculateDynamicSubtractions === 'function') {
      window.recalculateDynamicSubtractions();
    }
  });

  setClick('btnCtxBackward', () => {
    if (window.nodeEditMode && typeof window.exitNodeEditMode === 'function') {
      window.exitNodeEditMode(false);
    }
    const target = window.nodeEditTarget || window.selectedItem;
    if (target) {
      if (typeof sendImageBackward === 'function') {
        sendImageBackward(target);
      } else if (typeof window.sendBackward === 'function') {
        window.sendBackward();
      }
    }
    if (typeof window.recalculateDynamicSubtractions === 'function') {
      window.recalculateDynamicSubtractions();
    }
  });

  setClick('btnCtxToBack', () => {
    if (window.nodeEditMode && typeof window.exitNodeEditMode === 'function') {
      window.exitNodeEditMode(false);
    }
    const target = window.nodeEditTarget || window.selectedItem;
    if (target) {
      if (typeof sendImageToBack === 'function') {
        sendImageToBack(target);
      } else if (typeof window.sendBack === 'function') {
        window.sendBack();
      }
    }
    if (typeof window.recalculateDynamicSubtractions === 'function') {
      window.recalculateDynamicSubtractions();
    }
  });

  // Tipografías
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

  // Agrupar / Desagrupar
  setClick('btnCtxGroup', () => groupSelectedItems());
  setClick('btnCtxAgrupar', () => groupSelectedItems());
  setClick('btnCtxUngroup', () => ungroupSelectedItem());
  setClick('btnCtxDesagrupar', () => ungroupSelectedItem());

  // Edición de Nodos
  setClick('btnCtxEditNodes', () => {
    if (window.selectedItem) enterNodeEditMode(window.selectedItem);
  });
  setClick('btnCtxNodeEdit', () => {
    if (window.selectedItem) enterNodeEditMode(window.selectedItem);
  });
}

function getUnifiedScreenBounds(item) {
  const canvasEl = document.getElementById("editorCanvas");
  if (!canvasEl || typeof paper === 'undefined' || !paper.view) return null;
  const canvasRect = canvasEl.getBoundingClientRect();

  let combinedBounds = null;
  if (window.selectedItems && window.selectedItems.length > 0) {
    window.selectedItems.forEach(it => {
      const tgt = it.data?.clipGroup ? getContentItem(it) : it;
      if (tgt && tgt.bounds && tgt.visible !== false) {
        if (!combinedBounds) {
          combinedBounds = tgt.bounds.clone();
        } else {
          combinedBounds = combinedBounds.unite(tgt.bounds);
        }
      }
    });
  }

  if (!combinedBounds && item) {
    const tgt = item.data?.clipGroup ? getContentItem(item) : item;
    if (tgt && tgt.bounds && tgt.visible !== false) {
      combinedBounds = tgt.bounds.clone();
    }
  }

  if (!combinedBounds) return null;
  const screenTopCenter = paper.view.projectToView(combinedBounds.topCenter);
  return {
    x: canvasRect.left + screenTopCenter.x,
    y: canvasRect.top + screenTopCenter.y,
    combinedBounds: combinedBounds
  };
}

export function updateContextualMenu(item) {
  const toolbar = document.getElementById("contextual-toolbar");
  if (!toolbar) return;

  removeOverlapTab();

  if (!item || (item.data && (item.data.mockup || item.data.isMask))) {
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
    const allVectors = window.selectedItems.every(it => {
      const tgt = it.data?.clipGroup ? getContentItem(it) : it;
      return tgt && (isPath(tgt) || isCompoundPath(tgt) || isGroup(tgt) || isPointText(tgt) || isSymbolItem(tgt) || isShape(tgt));
    });

    if (allVectors) {
      const vecCtrl = document.getElementById('ctxVectorControls');
      if (vecCtrl) {
        vecCtrl.classList.remove('hidden');

        const btnEditNodes = document.getElementById('btnCtxEditNodes') || document.getElementById('btnCtxNodeEdit');
        if (btnEditNodes) btnEditNodes.style.display = 'none';

        const btnGroup = document.getElementById('btnCtxGroup') || document.getElementById('btnCtxAgrupar');
        if (btnGroup) {
          btnGroup.classList.remove('hidden');
          btnGroup.style.display = '';
        }

        const btnUngroup = document.getElementById('btnCtxUngroup') || document.getElementById('btnCtxDesagrupar');
        if (btnUngroup) {
          btnUngroup.style.display = 'none';
        }
      }
    }
  } else {
    const target = item.data?.clipGroup ? getContentItem(item) : item;
    if (!target) return;

    if (isPointText(target) || target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
      const txtCtrl = document.getElementById('ctxTextControls');
      if (txtCtrl) txtCtrl.classList.remove('hidden');

      const fontTrigger = document.querySelector('.selected-font-trigger span');
      if (fontTrigger) fontTrigger.textContent = getSelectedFontFamily();

      const fontSizeInput = document.getElementById('ctxFontSize');
      if (fontSizeInput) fontSizeInput.value = Math.round(target.fontSize || 42);
    } else if (isRaster(target)) {
      const imgCtrl = document.getElementById('ctxImageControls');
      if (imgCtrl) imgCtrl.classList.remove('hidden');
      if (btnTrace) {
        btnTrace.classList.remove('hidden');
        btnTrace.style.display = 'inline-flex';
      }
    } else if (isPath(target) || isCompoundPath(target) || isGroup(target) || isSymbolItem(target) || isShape(target)) {
      const vecCtrl = document.getElementById('ctxVectorControls');
      if (vecCtrl) {
        vecCtrl.classList.remove('hidden');

        const btnEditNodes = document.getElementById('btnCtxEditNodes') || document.getElementById('btnCtxNodeEdit');
        if (btnEditNodes) {
          const canEdit = !isGroup(target) && !isSymbolItem(target);
          btnEditNodes.style.display = canEdit ? 'inline-block' : 'none';
        }

        const btnGroup = document.getElementById('btnCtxGroup') || document.getElementById('btnCtxAgrupar');
        if (btnGroup) {
          btnGroup.classList.add('hidden');
          btnGroup.style.display = 'none';
        }

        const btnUngroup = document.getElementById('btnCtxUngroup') || document.getElementById('btnCtxDesagrupar');
        if (btnUngroup) {
          const canUngroup = isGroup(target) || isSymbolItem(target) || (isCompoundPath(target) && !target.data?.decomposedLayer);
          btnUngroup.style.display = canUngroup ? 'inline-block' : 'none';
        }
      }
    }
  }

  // Posicionamiento inteligente del menú contextual
  if (window.customToolbarLeft !== undefined && window.customToolbarTop !== undefined) {
    toolbar.style.left = window.customToolbarLeft + 'px';
    toolbar.style.top = window.customToolbarTop + 'px';
    toolbar.style.zIndex = "2147483647";
    return;
  }

  const screenData = getUnifiedScreenBounds(item);
  if (screenData && !toolbarDragged) {
    const x = screenData.x - (toolbar.offsetWidth / 2);
    const y = screenData.y - toolbar.offsetHeight - 18;

    const minX = 10;
    const maxX = window.innerWidth - toolbar.offsetWidth - 10;
    toolbar.style.left = Math.max(minX, Math.min(maxX, x)) + 'px';
    toolbar.style.top = Math.max(10, y) + 'px';
    toolbar.style.zIndex = "2147483647";
  }

  lastSelectedItem = item;
}

export function hideContextualMenu() {
  const toolbar = document.getElementById("contextual-toolbar");
  if (toolbar) {
    toolbar.classList.remove('active');
    toolbarDragged = false;
  }
}

// Exposición pública y protección global
if (typeof window !== 'undefined') {
  window.updateContextualMenu = updateContextualMenu;
  window.hideContextualMenu = hideContextualMenu;
  window.initContextualMenu = initContextualMenu;
  window.groupSelectedItems = groupSelectedItems;
  window.ungroupSelectedItem = ungroupSelectedItem;
}

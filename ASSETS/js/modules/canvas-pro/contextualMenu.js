/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js (PRO Edition v36.0 - Robust Visual Duplication & Node Safe)
   Ruta en repositorio: ASSETS/js/modules/canvas-pro/contextualMenu.js
   Descripción:
   Gestor unificado del menú contextual, tipografías dinámicas, transformaciones
   y barra de acciones para EKKO Studio.
   
   Cumple rigurosamente con:
   - CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
   - REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
   - LIGHTBURN ARRANGE & STACKING (Move Up, Move Down, Move to Top, Move to Bottom)
   - DUPLICACIÓN VISUAL CON DESFASE ESTÁNDAR (+20px, +20px / LightBurn Style)
   - SINCRONIZACIÓN PROFUNDA DE GEOMBASE Y CSG REACTIVO
   - SEPARACIÓN CONCEPTUAL RIGUROSA:
     1. '#btnCtxDuplicate' y '#btnCtxDelete' operan SIEMPRE sobre el OBJETO COMPLETO.
     2. Si está en modo edición de nodos (nodeEditMode), sincroniza y sale limpiamente.
     3. Migra la selección al nuevo clon y sincroniza la caja de transformación.
   ========================================================================= */

import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, deleteImage, bringImageForward, sendImageBackward, bringImageToFront, sendImageToBack, applyBrightnessContrast } from "./imageToolbar.js";
import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";
import { decomposeByContainmentHierarchy, recalculateDynamicSubtractions } from "./geometricUngroup.js";

// Helper universal de resolución de contenido dentro o fuera de clipGroup
function getContentItem(item) {
  if (!item) return null;
  if (item.data && item.data.clipGroup) {
    if (!item.children) return item;
    var content = item.children.find(function(c) {
      return !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask));
    });
    if (content) return content;
    var fallback = item.children.find(function(c) {
      return !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup));
    });
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
    (typeof paper !== 'undefined' && (
      (paper.SymbolItem && item instanceof paper.SymbolItem) ||
      (paper.PlacedSymbol && item instanceof paper.PlacedSymbol)
    ));
}

function isMockupOrProductElement(item) {
  let curr = item;
  while (curr) {
    if (curr.data && (
      curr.data.mockup ||
      curr.data.isMask ||
      curr.data.locked ||
      curr.data.isSelectionBox ||
      curr.data.isHandle ||
      curr.data.isSmartGuide ||
      curr.data.isMeasurement ||
      curr.data.isTracePreview
    )) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

function isLayer(item) {
  if (!item) return false;
  return item.className === 'Layer' || (typeof paper !== 'undefined' && paper.Layer && item instanceof paper.Layer);
}

function isShape(item) {
  if (!item) return false;
  return item.className === 'Shape' || (typeof paper !== 'undefined' && paper.Shape && item instanceof paper.Shape);
}

// Sincronización recursiva profunda de geomBase ante desplazamientos
function syncGeomBaseDeep(item, delta) {
  if (!item || !delta || (delta.x === 0 && delta.y === 0)) return;
  if (typeof window.syncGeomBaseDeep === 'function') {
    window.syncGeomBaseDeep(item, delta);
    return;
  }
  const visited = new Set();
  function recurse(target) {
    if (!target || visited.has(target.id)) return;
    visited.add(target.id);
    if (target.data && target.data.geomBase) {
      try {
        target.data.geomBase.position = target.data.geomBase.position.add(delta);
      } catch (e) {}
    }
    if (target.data && target.data.clipGroup && target.children) {
      target.children.forEach(c => {
        if (!c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask))) recurse(c);
      });
    }
    if (target instanceof paper.Group && target.children) {
      target.children.forEach(recurse);
    }
  }
  recurse(item);
}

// =========================================================================
// MOTOR INDUSTRIAL DE DUPLICACIÓN CON DESFASE VISUAL (LIGHTBURN STYLE)
// =========================================================================
export function duplicateSingleItem(targetItem, offset = new paper.Point(20, 20)) {
  if (!targetItem || isMockupOrProductElement(targetItem)) return null;
  if (targetItem.data && targetItem.data.locked) return null;

  const isClipped = !!(targetItem.data && targetItem.data.clipGroup);
  const content = isClipped ? getContentItem(targetItem) : targetItem;
  if (!content) return null;

  // 1. Clonar el contenido útil de diseño
  const contentClone = content.clone({ insert: false });

  // 2. Aplicar traslación física con desfase visible in-situ (+20px, +20px)
  contentClone.position = contentClone.position.add(offset);

  // 3. Sincronizar y clonar geomBase independientemente para evitar enlaces cruzados
  const recurseCloneGeomBase = (src, dest) => {
    if (!src || !dest) return;
    if (src.data && src.data.geomBase) {
      dest.data = dest.data || {};
      dest.data.geomBase = src.data.geomBase.clone({ insert: false });
      dest.data.geomBase.position = dest.data.geomBase.position.add(offset);
      dest.data.isHole = !!src.data.isHole;
      dest.data.layerDepth = src.data.layerDepth;
    }
    if (src.children && dest.children && src.children.length === dest.children.length) {
      for (let i = 0; i < src.children.length; i++) {
        recurseCloneGeomBase(src.children[i], dest.children[i]);
      }
    }
  };
  recurseCloneGeomBase(content, contentClone);

  contentClone.data = {
    ...(contentClone.data || {}),
    locked: false,
    label: (content.data?.label || "Objeto") + " (Copia)"
  };

  // 4. Integrar en la capa de diseño respetando enmascaramiento si correspondía
  let duplicatedObject = null;
  const designLayer = (paper.project.layers && paper.project.layers.find(l => l.name === 'designLayer')) || paper.project.activeLayer;

  if (isClipped && typeof window.clipItem === 'function') {
    duplicatedObject = window.clipItem(contentClone);
    if (duplicatedObject) {
      // Garantía de desplazamiento visual estricto para objetos enmascarados:
      // Si window.clipItem re-centró el clipGroup sobre la máscara del producto,
      // forzamos el desfase físico sobre el contenedor completo y sus componentes.
      if (targetItem.position && duplicatedObject.position) {
        const dx = Math.abs(duplicatedObject.position.x - targetItem.position.x);
        const dy = Math.abs(duplicatedObject.position.y - targetItem.position.y);
        if (dx < 10 && dy < 10) {
          duplicatedObject.position = duplicatedObject.position.add(offset);
        }
      }
    }
    if (designLayer) designLayer.addChild(duplicatedObject);
  } else {
    if (designLayer) {
      designLayer.addChild(contentClone);
    } else {
      paper.project.activeLayer.addChild(contentClone);
    }
    duplicatedObject = contentClone;
  }

  // 5. Orden Z: Insertar ordenadamente justo encima del original pero debajo del mockup
  if (duplicatedObject) {
    duplicatedObject.insertAbove(targetItem);
    if (window.currentMockup) {
      window.currentMockup.bringToFront();
    }
  }

  return duplicatedObject;
}

export function duplicateSelectedItem() {
  // A) Si el usuario está en modo de edición de nodos, confirmar y salir primero
  if (window.nodeEditMode && typeof exitNodeEditMode === 'function') {
    exitNodeEditMode(false);
  }

  // B) Recolectar lista de elementos a duplicar (soporta 1 elemento o multiselección)
  const itemsToDuplicate = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);

  if (itemsToDuplicate.length === 0) return;

  if (typeof window.saveHistory === 'function') window.saveHistory();

  const duplicatedList = [];
  const offset = new paper.Point(20, 20);

  itemsToDuplicate.forEach(item => {
    const clone = duplicateSingleItem(item, offset);
    if (clone) duplicatedList.push(clone);
  });

  if (duplicatedList.length > 0) {
    // C) Migración limpia de selección: Deseleccionar los originales y enfocar los nuevos clones
    if (typeof window.deselectItem === 'function') window.deselectItem();

    window.selectedItems = [...duplicatedList];
    window.selectedItem = duplicatedList[duplicatedList.length - 1];
    duplicatedList.forEach(cl => { cl.selected = true; });

    // D) Sincronizar recálculo CSG dinámico sobre las nuevas capas
    if (typeof recalculateDynamicSubtractions === 'function') {
      recalculateDynamicSubtractions();
    } else if (typeof window.recalculateDynamicSubtractions === 'function') {
      window.recalculateDynamicSubtractions();
    }

    // E) Actualizar UI contextual y caja celeste de selección
    if (typeof window.updateSelectionBox === 'function') {
      window.updateSelectionBox(window.selectedItem);
    }
    if (typeof updateContextualMenu === 'function') {
      updateContextualMenu(window.selectedItem);
    }
  }

  paper.view.update();
  return duplicatedList;
}
window.duplicateSelectedItem = duplicateSelectedItem;

// Variables de estado del menú contextual
window.originalFontBackup = null;
let fontsCache = [];
let toolbarDragged = false;
let lastSelectedItem = null;

// Estilos CSS para el menú de fuentes
const dropdownStylesId = 'ekko-custom-dropdown-styles';
if (typeof document !== 'undefined' && !document.getElementById(dropdownStylesId)) {
  const styleEl = document.createElement('style');
  styleEl.id = dropdownStylesId;
  styleEl.textContent = `
    .custom-font-dropdown { position: relative; min-width: 180px; height: 34px; background: white; border: 1px solid #ccc; border-radius: 6px; user-select: none; display: inline-block; vertical-align: middle; }
    .selected-font-trigger { display: flex; align-items: center; justify-content: space-between; padding: 0 10px; height: 100%; cursor: pointer; font-size: 13px; color: #333; }
    .selected-font-trigger:hover { background: #f9f9f9; }
    .font-dropdown-list { position: absolute; top: 100%; left: 0; right: 0; max-height: 250px; overflow-y: auto; background: white; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); z-index: 10000; margin-top: 4px; }
    .font-dropdown-item { padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; border-bottom: 1px solid #f0f0f0; }
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

function applyFontFamily(item, family) {
  if (!item || item.data?.locked) return;
  const target = item.data?.clipGroup ? getContentItem(item) : item;
  if (!target) return;
  if (isPointText(target)) {
    target.fontFamily = family;
  } else if (target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
    target.data.fontFamily = family;
    if (target.children) {
      target.children.forEach(child => {
        if (isPointText(child)) child.fontFamily = family;
      });
    }
  }
  paper.view.update();
}

function renderFontList(fonts, listContainer) {
  listContainer.innerHTML = "";
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
    } else {
      const response = await fetch('/api/fonts');
      if (response.ok) {
        fonts = await response.json();
      }
    }
  } catch (err) {
    console.error("Error al cargar tipografías en menú contextual:", err);
  }
  fontsCache = fonts;
  injectFontFaces(fonts);

  const nativeSelect = document.getElementById('ctxFontSelector');
  if (nativeSelect) {
    nativeSelect.style.display = 'none';
    nativeSelect.classList.add('hidden');
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

  const parent = selected[0].parent || paper.project.activeLayer;
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
  } else {
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
      const parent = actualItem.parent || paper.project.activeLayer;
      const idx = parent.children.indexOf(actualItem);
      const children = [...actualItem.children];
      children.forEach((c, i) => {
        parent.insertChild(idx + i, c);
        allCreatedItems.push(c);
      });
      actualItem.remove();
      if (item !== actualItem) item.remove();
    } else {
      const res = decomposeByContainmentHierarchy(actualItem, isClipped);
      if (res && res.items) {
        allCreatedItems.push(...res.items);
      } else {
        allCreatedItems.push(actualItem);
      }
    }
  });

  if (allCreatedItems.length > 0) {
    if (typeof window.deselectItem === 'function') {
      window.deselectItem();
    }
    window.selectedItems = [...allCreatedItems];
    window.selectedItem = allCreatedItems[allCreatedItems.length - 1];
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
        return;
      }
    }, { capture: true });
  }

  document.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === "escape") {
      if (window.nodeEditMode) {
        if (typeof window.exitNodeEditMode === 'function') {
          window.exitNodeEditMode();
        }
        return;
      }
      if (window.insertTextMode) {
        e.preventDefault();
        window.insertTextMode = false;
        if (canvasEl) canvasEl.style.cursor = "default";
        paper.view.update();
        return;
      }
      const textEditor = document.getElementById("ekko-text-editor");
      if (textEditor && document.activeElement === textEditor) {
        e.preventDefault();
        textEditor.blur();
        return;
      }
    }
  }, { capture: true });

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

  // --- BOTÓN DUPLICAR OBJETO COMPLETO CON DESFASE VISUAL (#btnCtxDuplicate) ---
  setClick('btnCtxDuplicate', () => {
    duplicateSelectedItem();
  });

  // --- BOTONES DE APILAMIENTO Z (LIGHTBURN STYLE) ---
  setClick('btnCtxToFront', () => {
    if (window.nodeEditMode && typeof window.exitNodeEditMode === 'function') {
      window.exitNodeEditMode(false);
    }
    const target = window.nodeEditTarget || window.selectedItem;
    if (target) {
      if (typeof window.bringFront === 'function') {
        window.bringFront();
      } else if (typeof bringImageToFront === 'function') {
        bringImageToFront(target);
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
      if (typeof window.bringForward === 'function') {
        window.bringForward();
      } else if (typeof bringImageForward === 'function') {
        bringImageForward(target);
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
      if (typeof window.sendBackward === 'function') {
        window.sendBackward();
      } else if (typeof sendImageBackward === 'function') {
        sendImageBackward(target);
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
      if (typeof window.sendBack === 'function') {
        window.sendBack();
      } else if (typeof sendImageToBack === 'function') {
        sendImageToBack(target);
      }
    }
    if (typeof window.recalculateDynamicSubtractions === 'function') {
      window.recalculateDynamicSubtractions();
    }
  });

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

  setClick('btnCtxScaleDown', () => {
    if (window.selectedItem) scaleImage(window.selectedItem, 0.9);
  });

  setClick('btnCtxScaleUp', () => {
    if (window.selectedItem) scaleImage(window.selectedItem, 1.1);
  });

  setClick('btnCtxGroup', () => groupSelectedItems());
  setClick('btnCtxAgrupar', () => groupSelectedItems());
  setClick('btnCtxUngroup', () => ungroupSelectedItem());
  setClick('btnCtxDesagrupar', () => ungroupSelectedItem());

  setClick('btnCtxEditNodes', () => {
    if (window.selectedItem) {
      if (typeof window.enterNodeEditMode === 'function') {
        window.enterNodeEditMode(window.selectedItem);
      } else {
        enterNodeEditMode(window.selectedItem);
      }
    }
  });

  setClick('btnCtxNodeEdit', () => {
    if (window.selectedItem) {
      if (typeof window.enterNodeEditMode === 'function') {
        window.enterNodeEditMode(window.selectedItem);
      } else {
        enterNodeEditMode(window.selectedItem);
      }
    }
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

  // Posicionamiento de la barra flotante
  if (window.customToolbarLeft !== undefined && window.customToolbarTop !== undefined) {
    toolbar.style.left = window.customToolbarLeft + 'px';
    toolbar.style.top = window.customToolbarTop + 'px';
  } else if (!toolbarDragged || lastSelectedItem !== item) {
    const screenPos = getUnifiedScreenBounds(item);
    if (screenPos) {
      const toolbarW = toolbar.offsetWidth || 320;
      const toolbarH = toolbar.offsetHeight || 44;
      const x = screenPos.x - (toolbarW / 2);
      const y = screenPos.y - toolbarH - 14;
      toolbar.style.left = Math.max(10, Math.min(window.innerWidth - toolbarW - 10, x)) + 'px';
      toolbar.style.top = Math.max(10, y) + 'px';
    }
  }
  lastSelectedItem = item;
}

export function hideContextualMenu() {
  const toolbar = document.getElementById("contextual-toolbar");
  if (toolbar) {
    toolbar.classList.remove('active');
    toolbarDragged = false;
    lastSelectedItem = null;
  }
}

window.updateContextualMenu = updateContextualMenu;
window.hideContextualMenu = hideContextualMenu;
window.initContextualMenu = initContextualMenu;

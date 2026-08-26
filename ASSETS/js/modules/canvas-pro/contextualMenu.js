import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, applyBrightnessContrast } from "./imageToolbar.js";
import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";
// =========================================================================
// EKKO TELEMETRY & DIAGNOSTIC SYSTEM (F12 TRACING - v21)
// =========================================================================
if (typeof window !== 'undefined') {
  console.log("%c[EKKO TELEMETRY] Sistema de diagnóstico F12 iniciado. Registrando eventos de carga de SVG e interacción.", "color: #0284c7; font-weight: bold; background: #e0f2fe; padding: 4px 8px; border-radius: 6px;");

  // Hook de monitorización para elementos añadidos al lienzo activo (SVG drop/load)
  setTimeout(() => {
    if (window.paper && paper.project) {
      paper.project.activeLayer.on('child-add', function(event) {
        const item = event.item;
        if (!item || (item.data && item.data.isSelectionBox)) return;
        console.log("%c[EKKO TELEMETRY] Nuevo elemento detectado en activeLayer:", "color: #059669; font-weight: bold;");
        console.log(" - ID del elemento:", item.id);
        console.log(" - Clase del objeto:", item.constructor.name);
        console.log(" - Nombre/Etiqueta:", item.name || item.data?.label || "Sin etiqueta");
        if (item.children) {
          console.log(" - Cantidad de hijos directos:", item.children.length);
          const types = item.children.map(c => c.constructor.name);
          console.log(" - Tipos de hijos:", types);
        }
        console.log(" - Límites (Bounds):", item.bounds ? { x: Math.round(item.bounds.x), y: Math.round(item.bounds.y), width: Math.round(item.bounds.width), height: Math.round(item.bounds.height) } : "N/A");
      });
    }
  }, 1000);
}

function getContentItem(item) {
  if (!item) return null;
  if (item.data && item.data.clipGroup) {
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

// Helpers para evitar fallos de 'instanceof' en iframe o contextos múltiples de Paper.js
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

function isLayer(item) {
  if (!item) return false;
  return item.className === 'Layer' || (typeof paper !== 'undefined' && paper.Layer && item instanceof paper.Layer);
}

function isShape(item) {
  if (!item) return false;
  return item.className === 'Shape' || (typeof paper !== 'undefined' && paper.Shape && item instanceof paper.Shape);
}

window.originalFontBackup = null;
let fontsCache = [];
let toolbarDragged = false;
let lastSelectedItem = null;
window.ekkoOuters = window.ekkoOuters || new Map();
window.ekkoHolesMap = window.ekkoHolesMap || new Map();

// --- INYECCION DE ESTILOS CSS PARA EL MENU PERSONALIZADO ---
const dropdownStylesId = 'ekko-custom-dropdown-styles';
if (typeof document !== 'undefined' && !document.getElementById(dropdownStylesId)) {
  const styleEl = document.createElement('style');
  styleEl.id = dropdownStylesId;
  styleEl.textContent = `
    .custom-font-dropdown { position: relative; min-width: 180px; height: 34px; background: white; border: 1px solid #ccc; border-radius: 6px; user-select: none; display: inline-block; vertical-align: middle; }
    .selected-font-trigger { display: flex; align-items: center; justify-content: space-between; padding: 0 12px; height: 100%; cursor: pointer; font-size: 13px; color: #334155; font-weight: 500; }
    .font-dropdown-list { position: absolute; top: calc(100% + 4px); left: 0; right: 0; max-height: 250px; overflow-y: auto; background: white; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); z-index: 100000; display: flex; flex-direction: column; }
    .font-dropdown-list.hidden { display: none !important; }
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
  if (!item) return;
  const target = item.data?.clipGroup ? getContentItem(item) : item;
  if (!target) return;
  if (isPointText(target)) {
    target.fontFamily = family;
  } else if (target.data?.isCurvedGroup) {
    target.data.fontFamily = family;
    const curvature = target.data.curvature || 0;
    applyTextCurve(item, curvature);
  } else if (target.data?.isSpacedGroup) {
    target.data.fontFamily = family;
    const hspace = target.data.hspace || 0;
    applyTextSpacing(item, hspace);
  }
  paper.view.update();
}

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
    console.error("Error al cargar las tipografias dinamicas en el menu contextual:", err);
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
}

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
}

function getLeafItemsRecursive(item) {
  const leaves = [];
  const recurse = (node, parentMatrix) => {
    const currentMatrix = parentMatrix ? parentMatrix.chain(node.matrix) : node.matrix.clone();
    if (isGroup(node) && !node.data?.clipGroup) {
      node.children.forEach(child => recurse(child, currentMatrix));
    } else {
      node.data = node.data || {};
      node.data.globalMatrix = currentMatrix;
      leaves.push(node);
    }
  };
  recurse(item, null);
  return leaves;
}

export function groupSelectedItems() {
  const selected = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);
  if (selected.length < 2) {
    alert("Selecciona al menos 2 elementos para poder agruparlos.");
    return;
  }
  for (let item of selected) {
    if (item.data?.locked || item.data?.mockup) {
      alert("No se pueden agrupar objetos protegidos.");
      return;
    }
  }
  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }
  const parent = selected[0].parent || paper.project.activeLayer;
  const index = parent.children.indexOf(selected[0]);
  const isClipped = selected.some(item => !!item.data?.clipGroup);
  const contents = [];

  // Procesamiento de refundido interactivo de huecos antes de agrupar
  const outersInSelection = selected.filter(item => item.data?.isOuterWithHoles);
  outersInSelection.forEach(outerItem => {
    const holeIds = outerItem.data.holeIds || [];
    const associatedHoles = holeIds
      .map(id => paper.project.getItem({ id }))
      .filter(h => h && selected.includes(h) && h.parent);
    associatedHoles.forEach(h => {
      const idx = selected.indexOf(h);
      if (idx > -1) selected.splice(idx, 1);
      h.remove();
    });
    const idxOuter = selected.indexOf(outerItem);
    if (idxOuter > -1) selected.splice(idxOuter, 1);
    const targetOuter = outerItem.data.clipGroup ? getContentItem(outerItem) : outerItem;
    const rebuiltPath = targetOuter.clone({ insert: false });
    outerItem.remove();
    window.ekkoOuters.delete(outerItem.id);
    contents.push(rebuiltPath);
  });

  selected.forEach(item => {
    let content;
    if (item.data?.clipGroup) {
      content = getContentItem(item);
      if (content) content.remove();
    } else {
      content = item;
      content.remove();
    }
    if (content) contents.push(content);
    item.remove();
  });

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

function getMatrixRelativeTo(item, targetAncestor) {
  let matrix = new paper.Matrix();
  let current = item;
  while (current && current !== targetAncestor && !(isLayer(current))) {
    if (current.matrix) {
      matrix = current.matrix.chain(matrix);
    }
    current = current.parent;
  }
  return matrix;
}

function getGlobalMatrix(item) {
  if (!item) return new paper.Matrix();
  if (item.data && item.data.globalMatrix) {
    return item.data.globalMatrix.clone();
  }
  return getMatrixRelativeTo(item, null);
}

function getActiveGroupTarget(group) {
  let current = group;
  while (isGroup(current) && current.children.length === 1 && !current.data?.clipGroup) {
    const child = current.children[0];
    if (isGroup(child)) {
      current = child;
    } else {
      break;
    }
  }
  return current;
}

function flattenGroupRecursive(group, parent, index, isClipped, oldClipGroup) {
  const leafItems = [];
  const findLeaves = (node) => {
    if (isGroup(node) && !node.data?.clipGroup) {
      const children = [...node.children];
      children.forEach(child => findLeaves(child));
    } else {
      leafItems.push(node);
    }
  };
  findLeaves(group);
  const addedItems = [];
  leafItems.forEach(child => {
    const targetAncestor = isClipped ? oldClipGroup : group;
    const relMatrix = getMatrixRelativeTo(child, targetAncestor);
    child.remove();
    let newItem;
    if (isClipped && oldClipGroup) {
      newItem = window.clipItem(child);
      newItem.matrix = oldClipGroup.matrix.clone();
      child.matrix = relMatrix;
    } else {
      newItem = child;
      newItem.matrix = relMatrix;
      parent.addChild(newItem);
    }
    if (newItem.data) {
      delete newItem.data.globalMatrix;
    }
    addedItems.push(newItem);
  });
  group.remove(); // Remoción segura al final
  return addedItems;
}

function isIgnorable(item) {
  if (!item) return true;
  if (isGroup(item)) {
    return item.children.length === 0 || item.children.every(isIgnorable);
  }
  if (isPath(item) || isCompoundPath(item)) {
    const area = Math.abs(item.area || (item.bounds ? item.bounds.area : 0) || 0);
    if (area < 0.1) return true;
    const hasStroke = item.strokeColor && item.strokeColor.alpha > 0 && item.strokeWidth > 0;
    const hasFill = item.fillColor && item.fillColor.alpha > 0;
    if (!hasStroke && !hasFill) return true;
  }
  return false;
}

function isArtboardBackground(path, parentItem) {
  if (!path || !parentItem) return false;
  
  // REGLA DE ORO DE SEGURIDAD: Solo puede ser un artboard background si el elemento contenedor está directamente en el nivel superior (Capa de diseño)
  const parent = parentItem.parent;
  const isTopLevel = parent && (isLayer(parent) || parent.className === 'Layer' || !parent.parent);
  if (!isTopLevel) return false;

  const parentBounds = parentItem.bounds;
  const pathBounds = path.bounds;
  // 1. Verificar si tiene dimensiones casi idénticas al contenedor principal (como el lienzo de exportación)
  const widthRatio = pathBounds.width / parentBounds.width;
  const heightRatio = pathBounds.height / parentBounds.height;
  if (widthRatio > 0.95 && heightRatio > 0.95) {
    // 2. Verificar si es un rectángulo simple (habitualmente de fondo de artboard)
    const isRect = path.segments && path.segments.length === 4;
    // 3. Verificar si es transparente o blanco sin trazo visible
    const hasStroke = path.strokeColor && path.strokeColor.alpha > 0 && path.strokeWidth > 0;
    const hasFill = path.fillColor && path.fillColor.alpha > 0;
    if (!hasStroke) {
      // Si no tiene relleno o si es blanco / transparente
      if (!hasFill) return true;
      if (path.fillColor) {
        const fill = path.fillColor;
        // Blanco puro o transparente
        if (fill.alpha === 0) return true;
        const isWhite = (fill.red > 0.95 && fill.green > 0.95 && fill.blue > 0.95) || fill.gray > 0.95;
        if (isWhite) return true;
      }
    }
  }
  return false;
}

function resolveRedundantWrappers(item) {
  let isClipped = !!item.data?.clipGroup;
  let current = isClipped ? getContentItem(item) : item;
  if (!current) return item;

  let changed = false;
  while (true) {
    if (isGroup(current) && !current.data?.clipGroup) {
      // Limpieza en caliente de hijos inútiles (artboards, vacíos, transparentes) para colapsar envolturas
      const kids = [...current.children];
      kids.forEach(child => {
        if (isArtboardBackground(child, current) || isIgnorable(child)) {
          console.log("%c[EKKO REDUNDANT CLEAN] Eliminando elemento de envoltura inútil:", "color: #94a3b8;", child.id);
          child.remove();
        }
      });
    }
    // A. Si es un SymbolItem (Clon de símbolo <use>), lo expandimos inmediatamente
    if (isSymbolItem(current)) {
      if (current.symbol && current.symbol.item) {
        console.log("%c[EKKO SYMBOL RESOLVE] Expandiendo símbolo SVG clonado:", "color: #ea580c; font-weight: bold;", current.id);
        const clone = current.symbol.item.clone({ insert: false });
        clone.matrix = current.matrix.clone();
        clone.data = { ...(current.data || {}), label: "Objeto Expandido" };
        const parent = current.parent;
        const idx = parent.children.indexOf(current);
        parent.insertChild(idx, clone);
        current.remove();
        current = clone;
        changed = true;
        continue; // Seguir evaluando el clon generado
      }
    }
    // B. Si es un Grupo con un solo hijo que también es un Grupo o Trazado (Nesting redundante de exportación de Corel/Illustrator)
    if (isGroup(current) && current.children.length === 1 && !current.data?.clipGroup) {
      const child = current.children[0];
      console.log("%c[EKKO GROUP FLATTEN] Disolviendo capa de grupo redundante de un solo hijo:", "color: #3b82f6; font-weight: bold;", current.id);
      const relMatrix = getMatrixRelativeTo(child, current);
      child.remove();
      const parent = current.parent;
      const idx = parent.children.indexOf(current);
      parent.insertChild(idx, child);
      child.matrix = current.matrix.clone().chain(relMatrix);
      child.data = { ...(current.data || {}), ...(child.data || {}) };
      current.remove();
      current = child;
      changed = true;
      continue; // Seguir evaluando el elemento promovido
    }
    break;
  }
  return isClipped ? item : current;
}

function ungroupGroupOneLevel(group, parent, index, isClipped, oldClipGroup) {
  const children = [...group.children];
  const addedItems = [];
  children.forEach(child => {
    const targetAncestor = isClipped ? oldClipGroup : group;
    const relMatrix = getMatrixRelativeTo(child, targetAncestor);
    const globalMatrix = getGlobalMatrix(child);
    child.remove();
    let newItem;
    if (isClipped && oldClipGroup) {
      newItem = window.clipItem(child);
      if (newItem === child) {
        newItem.matrix = globalMatrix;
      } else {
        newItem.matrix = oldClipGroup.matrix.clone();
        child.matrix = relMatrix;
      }
    } else {
      newItem = child;
      newItem.matrix = globalMatrix;
      parent.addChild(newItem);
    }
    if (newItem.data) {
      delete newItem.data.globalMatrix;
    }
    addedItems.push(newItem);
  });
  group.remove();
  return addedItems;
}

function splitPointTextIntoLetters(pointText) {
  const letters = [];
  const text = pointText.content;
  const startPoint = pointText.point;
  let accumX = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const singleLetterText = new paper.PointText({
      point: startPoint.add(new paper.Point(accumX, 0)),
      content: char,
      fillColor: pointText.fillColor,
      fontFamily: pointText.fontFamily,
      fontSize: pointText.fontSize,
      fontWeight: pointText.fontWeight
    });
    accumX += singleLetterText.bounds.width + 2;
    letters.push(singleLetterText);
  }
  return letters;
}

export function dissolveOuterWithHoles(outerItem) {
  if (!outerItem) return [];
  const parent = outerItem.parent || paper.project.activeLayer;
  const newItems = [];
  const isClipped = !!outerItem.data?.clipGroup;
  const target = isClipped ? getContentItem(outerItem) : outerItem;

  // 1. Obtener la lista de calados asociados antes de limpiar el outer
  const holeIds = outerItem.data?.holeIds || [];
  const associatedHoles = [];
  holeIds.forEach(id => {
    let h = paper.project.getItem({ id: id });
    if (h) {
      // REGLA DE ORO DE SEGURIDAD:
      // Si el calado está anidado dentro de un Grupo de Calado Compuesto, el objeto real
      // que debemos liberar e independizar es el Grupo completo (el compound parent), no el trazado interno aislado!
      if (h.parent && h.parent.data?.geometricHierarchy === 'compound' && isGroup(h.parent)) {
        h = h.parent;
      }
      if (!associatedHoles.includes(h)) {
        associatedHoles.push(h);
      }
    }
  });

  // Conservar una referencia al originalPath de forma segura ANTES de borrar los datos
  const originalPath = outerItem.data?.originalPath;

  // 2. Desvincular completamente el outer de la lógica reactiva de calado
  delete outerItem.data.isOuterWithHoles;
  delete outerItem.data.originalPath;
  delete outerItem.data.holeIds;
  if (typeof window.ekkoOuters !== 'undefined') {
    window.ekkoOuters.delete(outerItem.id);
  }

  // Restaurar de forma real e inmediata la geometría del outer a su estado original sólido (sin calar)
  if (originalPath) {
    const original = originalPath.clone({ insert: false });
    original.fillColor = outerItem.fillColor || new paper.Color('#000000');
    original.strokeColor = outerItem.strokeColor || '#000000';
    original.strokeWidth = outerItem.strokeWidth || 1;
    original.matrix = target.matrix.clone();
    original.data = { ...(outerItem.data || {}) };

    // Quitar metadatos del clon restaurado
    delete original.data.isOuterWithHoles;
    delete original.data.originalPath;
    delete original.data.holeIds;

    let newOuterItem;
    if (isClipped) {
      newOuterItem = window.clipItem(original);
      newOuterItem.matrix = outerItem.matrix.clone();
    } else {
      newOuterItem = original;
      const idx = parent.children.indexOf(outerItem);
      if (idx !== -1) {
        parent.insertChild(idx, newOuterItem);
      } else {
        parent.addChild(newOuterItem);
      }
    }

    outerItem.remove();
    outerItem = newOuterItem;
  }
  newItems.push(outerItem);

  // 3. Desvincular y limpiar cada calado asociado para que sea un objeto independiente normal
  associatedHoles.forEach(hole => {
    const cleanHoleNode = (node) => {
      if (node.data?.isHoleController) {
        delete node.data.isHoleController;
        delete node.data.outerItemId;
        delete node.data.lastHash;
        node.data.label = "Objeto";

        // Quitar estética visual celeste punteada de calado y restaurar aspecto estándar
        const actualPath = node.data?.clipGroup ? getContentItem(node) : node;
        if (actualPath) {
          actualPath.strokeColor = '#000000';
          actualPath.strokeWidth = 1;
          actualPath.dashArray = [];
          
          // REGLA DE ORO: No visible fill (transparent) so it doesn't leave a white background or block anything behind!
          actualPath.fillColor = new paper.Color(255, 255, 255, 0.01);
        }
      }
      if (node.children) {
        node.children.forEach(cleanHoleNode);
      }
    };

    cleanHoleNode(hole);
    newItems.push(hole);
  });

  // 4. Actualizar selección de forma limpia
  window.deselectItem();
  setTimeout(() => {
    // CORRECCIÓN DE ORO: Seleccionar solo el primer elemento generado (el contorno exterior)
    // para evitar la caja de selección global y permitir el arrastre individual inmediato de cualquier pieza.
    const primaryItem = newItems[0];
    window.selectedItems = [primaryItem];
    window.selectedItem = primaryItem;
    primaryItem.selected = true;
    if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
    if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
    paper.view.update();
  }, 50);

  return newItems;
}

export function hierarchicalDecompose(item, isHoleSource) {
  const isClipped = !!item.data?.clipGroup;
  let target = isClipped ? getContentItem(item) : item;
  if (isGroup(target)) {
    target = getActiveGroupTarget(target);
  }
  if (!target || !(isCompoundPath(target))) return [];

  const parent = item.parent || paper.project.activeLayer;
  const newItems = [];
  const createdOuters = [];

  // Filtrar fondos de mesa de trabajo (Artboards) de forma súper segura
  const subPaths = [...target.children].filter(p => {
    if (isArtboardBackground(p, target)) {
      p.remove();
      return false;
    }
    return true;
  });

  if (subPaths.length === 0) return [];

  const pathRelMatrix = getMatrixRelativeTo(target, isClipped ? item : null);
  const pathAbsMatrix = getGlobalMatrix(target);
  const originalFillColor = target.fillColor;
  const originalStrokeColor = target.strokeColor;
  const originalStrokeWidth = target.strokeWidth;

  // 1. Calcular el árbol de contención de todos los subpaths (menor contenedor inmediato)
  const parentMap = new Map(); // subpath -> parent subpath
  subPaths.forEach(p => {
    let immediateParent = null;
    let minArea = Infinity;
    subPaths.forEach(other => {
      if (other !== p) {
        const otherArea = Math.abs(other.area) || other.bounds.area;
        const pArea = Math.abs(p.area) || p.bounds.area;
        if (otherArea > pArea) {
          const containsCenter = typeof other.contains === 'function'
            ? other.contains(p.bounds.center)
            : other.bounds.contains(p.bounds.center);
          if (containsCenter) {
            if (otherArea < minArea) {
              minArea = otherArea;
              immediateParent = other;
            }
          }
        }
      }
    });
    parentMap.set(p, immediateParent);
  });

  // 2. Calcular la profundidad de cada subpath en el árbol
  const depthMap = new Map(); // subpath -> depth
  const getDepth = (p) => {
    if (depthMap.has(p)) return depthMap.get(p);
    const parentNode = parentMap.get(p);
    if (!parentNode) {
      depthMap.set(p, 0);
      return 0;
    } else {
      const d = getDepth(parentNode) + 1;
      depthMap.set(p, d);
      return d;
    }
  };
  subPaths.forEach(p => getDepth(p));

  // 3. Obtener raíces locales (depth = 0)
  const roots = subPaths.filter(p => depthMap.get(p) === 0);

  // Configuración base de un elemento individual
  const configureItem = (pathItem, isHoleType, isOuterWithHoles) => {
    let finalFillColor = originalFillColor;
    if (isHoleType) {
      finalFillColor = new paper.Color(255, 255, 255, 0.01);
    } else {
      // PRESERVAR EL RELLENO ORIGINAL DEL COMPOUND PATH
      finalFillColor = originalFillColor || new paper.Color('#000000');
    }

    pathItem.fillColor = finalFillColor;
    pathItem.strokeColor = originalStrokeColor || '#000000';
    pathItem.strokeWidth = originalStrokeWidth || 1;

    let newItem;
    if (isClipped) {
      newItem = window.clipItem(pathItem);
      if (newItem === pathItem) {
        newItem.matrix = pathAbsMatrix.clone().chain(pathItem.matrix);
      } else {
        newItem.matrix = item.matrix.clone();
        pathItem.matrix = pathRelMatrix.clone().chain(pathItem.matrix);
      }
    } else {
      newItem = pathItem;
      newItem.matrix = pathAbsMatrix.clone().chain(pathItem.matrix);
      parent.addChild(newItem);
    }

    newItem.data = {
      ...(item.data || {}),
      locked: false,
      label: isHoleType ? "Hueco" : (item.data?.label || "Objeto")
    };

    if (isHoleType) {
      newItem.data.isHoleController = true;
      newItem.data.outerItemId = "";
      newItem.data.lastHash = "";
      newItem.data.label = "Hueco";

      const visualHole = newItem.data.clipGroup ? getContentItem(newItem) : newItem;
      if (visualHole) {
        visualHole.strokeColor = '#009dec';
        visualHole.strokeWidth = 1.5 / paper.view.zoom;
        visualHole.dashArray = [4, 4];
        visualHole.fillColor = new paper.Color(0, 157, 236, 0.15);
      }
    } else if (isOuterWithHoles) {
      newItem.data.isOuterWithHoles = true;
      newItem.data.originalPath = pathItem.clone({ insert: false });
      newItem.data.holeIds = [];
      createdOuters.push(newItem);
    } else {
      delete newItem.data.isOuterWithHoles;
      delete newItem.data.originalPath;
      delete newItem.data.holeIds;
      createdOuters.push(newItem);
    }

    return newItem;
  };

  // Función recursiva para crear un árbol geométrico (alternando solids y HoleControllers)
  const createShapeFromSubtree = (rootPath, isHoleType) => {
    const descendants = subPaths.filter(p => {
      let curr = parentMap.get(p);
      while (curr) {
        if (curr === rootPath) return true;
        curr = parentMap.get(curr);
      }
      return false;
    });

    const directChildren = descendants.filter(p => parentMap.get(p) === rootPath);

    if (descendants.length === 0) {
      const pathClone = rootPath.clone({ insert: false });
      const simpleItem = configureItem(pathClone, isHoleType, false);
      newItems.push(simpleItem);
      return simpleItem;
    }

    if (!isHoleType) {
      const outerClone = rootPath.clone({ insert: false });
      const newOuterItem = configureItem(outerClone, false, true);
      newItems.push(newOuterItem);

      directChildren.forEach(child => {
        const childHoleItem = createShapeFromSubtree(child, true);
        childHoleItem.data.outerItemId = newOuterItem.id;
        newOuterItem.data.holeIds.push(childHoleItem.id);
      });

      return newOuterItem;
    } else {
      const group = new paper.Group();
      group.data = {
        ...(item.data || {}),
        locked: false,
        label: "Grupo Calado Compuesto"
      };

      const holeClone = rootPath.clone({ insert: false });
      const mainHoleController = configureItem(holeClone, true, false);
      group.addChild(mainHoleController);
      newItems.push(mainHoleController);

      directChildren.forEach(child => {
        const innerSolidItem = createShapeFromSubtree(child, false);
        group.addChild(innerSolidItem);
      });

      let finalGroupItem;
      if (isClipped) {
        finalGroupItem = window.clipItem(group);
        if (finalGroupItem === group) {
          finalGroupItem.matrix = pathAbsMatrix.clone().chain(group.matrix);
        } else {
          finalGroupItem.matrix = item.matrix.clone();
          group.matrix = pathRelMatrix.clone().chain(group.matrix);
        }
      } else {
        finalGroupItem = group;
        finalGroupItem.matrix = pathAbsMatrix.clone().chain(group.matrix);
        parent.addChild(finalGroupItem);
      }

      newItems.push(finalGroupItem);
      return finalGroupItem;
    }
  };

  if (roots.length === 1 && subPaths.length > 1) {
    const singleRoot = roots[0];
    const newOuterItem = configureItem(singleRoot.clone({ insert: false }), isHoleSource, true);
    newItems.push(newOuterItem);

    const level1Items = subPaths.filter(p => depthMap.get(p) === 1);
    level1Items.forEach(lvl1 => {
      const childHoleItem = createShapeFromSubtree(lvl1, !isHoleSource);
      childHoleItem.data.outerItemId = newOuterItem.id;
      newOuterItem.data.holeIds.push(childHoleItem.id);
    });
  } else {
    roots.forEach(root => {
      createShapeFromSubtree(root, isHoleSource);
    });
  }

  newItems.forEach(it => {
    const isHole = it.data?.isHoleController;
    if (isHole) {
      const holeCenter = it.bounds.center;
      let bestOuter = null;
      let minArea = Infinity;

      const allCandidates = [...createdOuters];
      if (paper.project.activeLayer) {
        paper.project.activeLayer.children.forEach(c => {
          if (c && c.parent && c !== it && c !== item && !c.data?.isHoleController) {
            // EVITAR ABSOLUTAMENTE MOCKUPS, MÁSCARAS, COMPONENTES DEL PRODUCTO Y ELEMENTOS PROTEGIDOS
            if (c.data && (
              c.data.mockup || 
              c.data.isMask || 
              c.data.isSelectionBox || 
              c.data.isHandle || 
              c.data.isSmartGuide || 
              c.data.isMeasurement || 
              c.data.isTracePreview || 
              c.data.locked
            )) {
              return;
            }
            if (isPath(c) || isCompoundPath(c) || c.data?.clipGroup) {
              allCandidates.push(c);
            }
          }
        });
      }

      allCandidates.forEach(outItem => {
        const visualOuter = outItem.data?.clipGroup ? getContentItem(outItem) : outItem;
        if (visualOuter && visualOuter.bounds.contains(holeCenter)) {
          const area = visualOuter.bounds.area;
          if (area < minArea) {
            minArea = area;
            bestOuter = outItem;
          }
        }
      });

      if (bestOuter) {
        it.data.outerItemId = bestOuter.id;
        bestOuter.data = bestOuter.data || {};
        bestOuter.data.isOuterWithHoles = true;
        bestOuter.data.originalPath = (bestOuter.data.clipGroup ? getContentItem(bestOuter) : bestOuter).clone({ insert: false });
        bestOuter.data.holeIds = bestOuter.data.holeIds || [];
        if (!bestOuter.data.holeIds.includes(it.id)) {
          bestOuter.data.holeIds.push(it.id);
        }

        if (typeof window.ekkoOuters !== 'undefined') {
          window.ekkoOuters.set(bestOuter.id, bestOuter);
        }
        if (typeof window.updateOuterPathGeometry === 'function') {
          window.updateOuterPathGeometry(bestOuter);
        }
      }
    }
  });

  if (isClipped && item) {
    item.clipped = false;
  }
  item.remove();

  return newItems.filter(it => it.parent === parent);
}

export function separateContoursIntoIndependentShapes(itemToProcess) {
  const item = itemToProcess || window.selectedItem;
  if (typeof window !== 'undefined') {
    console.log("%c[EKKO HIERARCHICAL DECOMPOSE] Iniciando descomposición jerárquica para contorno sólido:", "color: #0f766e; font-weight: bold;", item ? { id: item.id, type: item.constructor.name } : "Ninguno");
  }
  return hierarchicalDecompose(item, false);
}

export function ungroupHoleController(item) {
  if (!item || !item.data?.isHoleController) return [];
  if (typeof window !== 'undefined') {
    console.log("%c[EKKO HIERARCHICAL DECOMPOSE] Iniciando descomposición jerárquica para calado:", "color: #0f766e; font-weight: bold;", { id: item.id, label: item.data?.label });
  }

  const ownerId = item.data.outerItemId;
  const owner = ownerId ? paper.project.getItem({ id: ownerId }) : null;

  if (owner) {
    owner.data.holeIds = (owner.data.holeIds || []).filter(id => id !== item.id);
  }

  const decomposedHoles = hierarchicalDecompose(item, true);

  if (owner) {
    if (owner.data.holeIds.length === 0 && (!owner.data.holeIds || owner.data.holeIds.length === 0)) {
      delete owner.data.isOuterWithHoles;
      window.ekkoOuters.delete(owner.id);
    } else {
      updateOuterPathGeometry(owner);
    }
  }

  return decomposedHoles;
}

export function ungroupSelectedItem() {
  if (typeof window !== 'undefined') {
    console.log("%c[EKKO UNGROUP ACTION] 1. Clic detectado en Desagrupar 🔓", "color: #ffffff; font-weight: bold; background: #ea580c; padding: 4px 10px; border-radius: 6px; font-size: 13px;");
  }

  // COMPATIBILIDAD CON EDICIÓN DE NODOS:
  const wasInNodeEdit = !!window.nodeEditMode;
  let targetNodeItem = null;
  if (wasInNodeEdit) {
    targetNodeItem = window.nodeEditTarget;
    if (typeof window.exitNodeEditMode === 'function') {
      window.exitNodeEditMode(true);
    }
  }

  let rawSelected = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);
  if (wasInNodeEdit && targetNodeItem) {
    rawSelected = [targetNodeItem];
  }
  if (rawSelected.length === 0) return;
  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }

  const selected = rawSelected.map(item => resolveRedundantWrappers(item));
  const finalNewItems = [];

  selected.forEach((item, sIdx) => {
    console.log(`%c[EKKO UNGROUP PROCESS] Procesando elemento [${sIdx}] ID: ${item.id} (${item.constructor.name})`, "color: #0f766e; font-weight: bold;");
    if (item.data?.locked || item.data?.mockup || item.data?.isMask) {
      console.warn(` - Elemento bloqueado, mockup o máscara. Saltando.`);
      return;
    }
    const isClipped = !!item.data?.clipGroup;
    const target = isClipped ? getContentItem(item) : item;
    if (!target) return;
    const activeTarget = isGroup(target) ? getActiveGroupTarget(target) : target;
    const parent = item.parent || paper.project.activeLayer;
    const index = parent.children.indexOf(item);
    const newItems = [];

    // A. SI ES GRUPO TRADICIONAL
    if (isGroup(activeTarget) && !activeTarget.data?.clipGroup) {
      if (activeTarget.data?.geometricHierarchy === 'compound') {
        console.log("%c[EKKO UNGROUP PROCESS] -> Tipo: GRUPO GEOMÉTRICO COMPUESTO.", "color: #0369a1; font-weight: bold;");
        const result = geometricUngroupOneLevel(activeTarget, isClipped, item);
        if (result && result.items) {
          newItems.push(...result.items);
        }
      } else {
      console.log("%c[EKKO UNGROUP PROCESS] -> Tipo: GRUPO TRADICIONAL.", "color: #0369a1; font-weight: bold;");
      const flattened = ungroupGroupOneLevel(activeTarget, parent, index, isClipped, item);
      newItems.push(...flattened);
      if (isClipped && item) {
        item.clipped = false;
      }
      item.remove();
    }
      }
    // B. SI ES TEXTO PARA SEPARAR POR LETRAS
    else if (isPointText(activeTarget) && activeTarget.content.length > 1) {
      console.log("%c[EKKO UNGROUP PROCESS] -> Tipo: TEXTO VECTORIAL.", "color: #0369a1; font-weight: bold;");
      const letters = splitPointTextIntoLetters(activeTarget);
      const textAbsMatrix = getGlobalMatrix(activeTarget);
      activeTarget.remove();
      letters.forEach(letter => {
        let newItem;
        const letterGlobalMatrix = textAbsMatrix.clone().chain(letter.matrix);
        if (isClipped) {
          newItem = window.clipItem(letter);
          if (newItem === letter) {
            newItem.matrix = letterGlobalMatrix;
          } else {
            newItem.matrix = item.matrix.clone();
            letter.matrix = getMatrixRelativeTo(letter, activeTarget).clone();
          }
        } else {
          newItem = letter;
          newItem.matrix = letterGlobalMatrix;
          parent.addChild(newItem);
        }
        newItems.push(newItem);
      });
      if (isClipped && item) {
        item.clipped = false;
      }
      item.remove();
    }
    // C. SI ES COMPOUNDPATH
    else if (isCompoundPath(activeTarget)) {
      console.log("%c[EKKO UNGROUP PROCESS] -> Tipo: COMPOUNDPATH (Trazado Compuesto).", "color: #0369a1; font-weight: bold;");
      if (item.data?.isOuterWithHoles || activeTarget.data?.isOuterWithHoles) {
        const dissolved = dissolveOuterWithHoles(item);
        if (dissolved && dissolved.length > 0) {
          newItems.push(...dissolved);
        }
      } else if (item.data?.isHoleController || activeTarget.data?.isHoleController) {
        const ungroupedHoles = ungroupHoleController(item);
        if (ungroupedHoles && ungroupedHoles.length > 0) {
          newItems.push(...ungroupedHoles);
        }
      } else {
        // CORRECCIÓN DE ORO:
        console.log("%c[EKKO UNGROUP PROCESS] El elemento es un CompoundPath estándar. Invocando geometricUngroupCompound()...", "color: #10b981; font-weight: bold;");
        const result = geometricUngroupCompound(item);
        if (result && result.items) {
          console.log(` - Se generaron ${result.items.length} formas/huecos separados geométricamente.`);
          newItems.push(...result.items);
        }
      }
    }
    finalNewItems.push(...newItems);
  });

  // Re-seleccionar los nuevos elementos generados
  if (finalNewItems.length > 0) {
    setTimeout(() => {
      window.deselectItem();
      const selectList = [];
      finalNewItems.forEach(it => {
        if (it && it.parent) {
          selectList.push(it);
        }
      });
      if (selectList.length > 0) {
        // CORRECCIÓN DE ORO: Seleccionar solo el primer elemento generado (el contorno exterior)
        // para evitar la caja de selección global y permitir el arrastre individual inmediato de cualquier pieza.
        const primaryItem = selectList[0];
        window.selectedItems = [primaryItem];
        window.selectedItem = primaryItem;
        primaryItem.selected = true;
        if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
        if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
        console.log("%c[EKKO UNGROUP ACTION] Desagrupación finalizada con éxito. Seleccionando elemento primario para arrastre individual.", "color: #10b981; font-weight: bold; background: #ecfdf5; padding: 2px 6px; border-radius: 4px;");
      }
      paper.view.update();
    }, 50);
  }
}

export function separateContours(itemToProcess, skipSelection = false) {
  const item = itemToProcess || window.selectedItem;
  console.log("%c[EKKO DIAGNOSTIC] Iniciando separateContours() para:", "color: #6d28d9; font-weight: bold;", item ? { id: item.id, type: item.constructor.name } : "Ninguno");
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return [];
  const isClipped = !!item.data?.clipGroup;
  let target = isClipped ? getContentItem(item) : item;
  if (isGroup(target)) {
    target = getActiveGroupTarget(target);
  }
  if (!target || !(isCompoundPath(target))) return [];
  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }
  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const newItems = [];
  const subPaths = [...target.children];
  const pathRelMatrix = getMatrixRelativeTo(target, isClipped ? item : null);
  const pathAbsMatrix = getGlobalMatrix(target);
  const originalFillColor = target.fillColor;
  const originalStrokeColor = target.strokeColor;
  const originalStrokeWidth = target.strokeWidth;
  const pathNesting = [];

  subPaths.forEach(p => {
    const containers = [];
    subPaths.forEach(other => {
      if (other !== p) {
        const otherArea = Math.abs(other.area) || other.bounds.area;
        const pArea = Math.abs(p.area) || p.bounds.area;
        if (otherArea > pArea && (typeof other.contains === 'function' ? other.contains(p.bounds.center) : other.bounds.contains(p.bounds.center))) {
          containers.push(other);
        }
      }
    });
    pathNesting.push({ path: p, containers: containers });
  });

  const outers = [];
  const level1Holes = [];
  const level2OuterLoops = [];
  console.log("[EKKO DIAGNOSTIC] Clasificando contornos basados en anidamiento .contains():");
  pathNesting.forEach(entry => {
    console.log(` - Contorno ${entry.path.id} (Área: ${Math.round(entry.path.area)}). Contenedores que lo encierran:`, entry.containers.map(c => c.id));
  });

  pathNesting.forEach(entry => {
    const p = entry.path;
    const containers = entry.containers;
    if (containers.length === 0) {
      outers.push(p);
    } else if (containers.length === 1) {
      level1Holes.push(p);
    } else {
      level2OuterLoops.push(entry);
    }
  });

  if (outers.length === 0 && subPaths.length > 0) {
    subPaths.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
    outers.push(subPaths[0]);
    for (let i = 1; i < subPaths.length; i++) {
      level1Holes.push(subPaths[i]);
    }
  }

  const holeChildrenMap = new Map();
  level1Holes.forEach(h => holeChildrenMap.set(h, []));
  level2OuterLoops.forEach(entry => {
    const p = entry.path;
    const containers = entry.containers;
    let immediateHole = null;
    let minArea = Infinity;
    containers.forEach(c => {
      if (level1Holes.includes(c)) {
        const cArea = Math.abs(c.area) || c.bounds.area;
        if (cArea < minArea) {
          minArea = cArea;
          immediateHole = c;
        }
      }
    });
    if (immediateHole) {
      holeChildrenMap.get(immediateHole).push(p);
    } else {
      outers.push(p);
    }
  });

  const outersToSelect = [];
  outers.forEach(outerPath => {
    const outerClone = outerPath.clone({ insert: false });
    outerClone.fillColor = originalFillColor || new paper.Color(255, 255, 255, 0.01);
    outerClone.strokeColor = originalStrokeColor || '#000000';
    outerClone.strokeWidth = originalStrokeWidth || 1;
    let newOuterItem;
    if (isClipped) {
      newOuterItem = window.clipItem(outerClone);
      if (newOuterItem === outerClone) {
        newOuterItem.matrix = pathAbsMatrix.clone().chain(outerClone.matrix);
      } else {
        newOuterItem.matrix = item.matrix.clone();
        outerClone.matrix = pathRelMatrix.clone().chain(outerClone.matrix);
      }
    } else {
      newOuterItem = outerClone;
      newOuterItem.matrix = pathAbsMatrix.clone().chain(outerClone.matrix);
      parent.addChild(newOuterItem);
    }

    newOuterItem.data = {
      ...(newOuterItem.data || {}),
      isOuterWithHoles: true,
      originalPath: outerPath.clone({ insert: false }),
      holeIds: [],
      label: item.data?.label || "Objeto"
    };

    level1Holes.forEach(hPath => {
      if (!(typeof outerPath.contains === 'function' ? outerPath.contains(hPath.bounds.center) : outerPath.bounds.contains(hPath.bounds.center))) return;
      const subHoles = holeChildrenMap.get(hPath) || [];
      let holeShape;
      if (subHoles.length > 0) {
        const holeClones = [];
        const hClone = hPath.clone({ insert: false });
        hClone.fillColor = null;
        hClone.strokeColor = null;
        holeClones.push(hClone);
        subHoles.forEach(sh => {
          const shClone = sh.clone({ insert: false });
          shClone.fillColor = null;
          shClone.strokeColor = null;
          holeClones.push(shClone);
        });
        const compoundHole = new paper.CompoundPath({
          children: holeClones,
          insert: false
        });
        compoundHole.fillRule = 'evenodd';
        holeShape = compoundHole;
      } else {
        holeShape = hPath.clone({ insert: false });
      }

      holeShape.fillColor = new paper.Color(255, 255, 255, 0.01);
      holeShape.strokeColor = originalStrokeColor || '#000000';
      holeShape.strokeWidth = originalStrokeWidth || 1;
      let newHoleItem;
      if (isClipped) {
        newHoleItem = window.clipItem(holeShape);
        if (newHoleItem === holeShape) {
          newHoleItem.matrix = pathAbsMatrix.clone().chain(holeShape.matrix);
        } else {
          newHoleItem.matrix = item.matrix.clone();
          holeShape.matrix = pathRelMatrix.clone().chain(holeShape.matrix);
        }
      } else {
        newHoleItem = holeShape;
        newHoleItem.matrix = pathAbsMatrix.clone().chain(holeShape.matrix);
        parent.addChild(newHoleItem);
      }

      newHoleItem.data = {
        ...(newHoleItem.data || {}),
        isHoleController: true,
        outerItemId: newOuterItem.id,
        lastHash: "",
        label: "Hueco"
      };

      const visualHole = newHoleItem.data.clipGroup ? getContentItem(newHoleItem) : newHoleItem;
      if (visualHole) {
        visualHole.strokeColor = '#009dec';
        visualHole.strokeWidth = 1.5 / paper.view.zoom;
        visualHole.dashArray = [4, 4];
        visualHole.fillColor = new paper.Color(0, 157, 236, 0.15);
      }
      newOuterItem.data.holeIds.push(newHoleItem.id);
      newItems.push(newHoleItem);
    });

    window.ekkoOuters.set(newOuterItem.id, newOuterItem);
    const updatedOuter = updateOuterPathGeometry(newOuterItem);
    if (updatedOuter && updatedOuter !== newOuterItem) {
      const outIdx = newItems.indexOf(newOuterItem);
      if (outIdx !== -1) {
        newItems[outIdx] = updatedOuter;
      }
      const selectIdx = outersToSelect.indexOf(newOuterItem);
      if (selectIdx !== -1) {
        outersToSelect[selectIdx] = updatedOuter;
      }
    }
  });

  if (isClipped && item) {
    item.clipped = false;
  }
  item.remove();

  if (skipSelection) {
    return newItems;
  }

  window.deselectItem();
  setTimeout(() => {
    if (outersToSelect.length > 0) {
      window.selectedItems = [...outersToSelect];
      window.selectedItem = outersToSelect[outersToSelect.length - 1];
      outersToSelect.forEach(it => { if (it) it.selected = true; });
      if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
      if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
    }
    paper.view.update();
  }, 50);

  return newItems;
}

function ensurePathItem(item) {
  if (!item) return null;
  if (isPath(item) || isCompoundPath(item)) {
    return item;
  }
  if (isGroup(item)) {
    const children = [];
    const collectPaths = (node) => {
      if (isPath(node) || isCompoundPath(node)) {
        children.push(node.clone({ insert: false }));
      } else if (isGroup(node)) {
        node.children.forEach(collectPaths);
      }
    };
    collectPaths(item);
    item.remove();
    if (children.length === 0) return null;
    return new paper.CompoundPath({
      children: children,
      insert: false,
      fillRule: 'evenodd'
    });
  }
  return null;
}

export function updateOuterPathGeometry(outerItem) {
  if (!outerItem || !outerItem.data?.originalPath) return outerItem;
  const targetOuter = outerItem.data.clipGroup ? getContentItem(outerItem) : outerItem;
  if (!targetOuter) return outerItem;
  let resultOuter = outerItem;

  // Asegurar que el path original sea un PathItem válido
  let solidGlobal = outerItem.data.originalPath.clone({ insert: false });
  solidGlobal = ensurePathItem(solidGlobal);
  if (!solidGlobal) return outerItem;

  const outerGlobalMatrix = getGlobalMatrix(targetOuter);
  solidGlobal.matrix = outerGlobalMatrix;
  solidGlobal.applyMatrix = true;

  const holeIds = outerItem.data.holeIds || [];
  let combined = solidGlobal;

  // Función para recolectar todos los trazados reales de calado (isHoleController) de forma recursiva
  const collectHolePaths = (node) => {
    const paths = [];
    const recurse = (n) => {
      if (!n) return;
      if (n.data?.isHoleController) {
        const actualPath = n.data.clipGroup ? getContentItem(n) : n;
        if (isPath(actualPath) || isCompoundPath(actualPath)) {
          paths.push({ item: n, path: actualPath });
        }
      } else if (isGroup(n)) {
        n.children.forEach(recurse);
      } else if (n.data?.clipGroup) {
        const content = getContentItem(n);
        if (content) recurse(content);
      }
    };
    recurse(node);
    return paths;
  };

  holeIds.forEach(id => {
    const hole = paper.project.getItem({ id });
    if (hole && hole.parent) {
      // Recolectar todos los trazados de calado reales dentro de este hole (puede ser un simple HoleController o un Grupo)
      const holePaths = collectHolePaths(hole);
      
      holePaths.forEach(hpEntry => {
        const hpItem = hpEntry.item;
        const hpPath = hpEntry.path;
        
        const holeGlobalMatrix = getGlobalMatrix(hpItem);
        const holeGlobal = hpPath.clone({ insert: false });
        holeGlobal.matrix = holeGlobalMatrix;
        holeGlobal.applyMatrix = true;
        
        let temp = null;
        try {
          if (combined && typeof combined.subtract === 'function') {
            temp = combined.subtract(holeGlobal);
          } else {
            console.warn("[EKKO WARNING] combined no tiene la función subtract. Intentando forzar conversión.");
            combined = ensurePathItem(combined);
            if (combined && typeof combined.subtract === 'function') {
              temp = combined.subtract(holeGlobal);
            }
          }
        } catch (e) {
          console.error("Fallo substraction en updateOuterPathGeometry:", e);
        }
        
        if (temp) {
          combined.remove();
          combined = ensurePathItem(temp); // Asegurar que el resultado siempre sea un PathItem para la siguiente iteración
        }
        holeGlobal.remove();
      });
    }
  });

  if (combined) {
    let localCombined = combined.clone({ insert: false });
    if (outerItem.data.clipGroup) {
      try {
        const inv = outerItem.matrix.inverted();
        localCombined.matrix = inv;
        localCombined.applyMatrix = true;
      } catch (err) {
        console.warn("Fallo no critico al invertir la matriz en updateOuterPathGeometry:", err);
      }
    } else {
      try {
        const inv = outerGlobalMatrix.inverted();
        localCombined.matrix = inv;
        localCombined.applyMatrix = true;
      } catch (err) {
        console.warn("Fallo no critico al invertir la matriz en updateOuterPathGeometry:", err);
      }
    }

    const parent = targetOuter.parent;
    if (parent && localCombined) {
      const idx = parent.children.indexOf(targetOuter);
      if (idx !== -1) {
        const newPath = localCombined.clone({ insert: false });
        newPath.fillColor = targetOuter.fillColor;
        newPath.strokeColor = targetOuter.strokeColor;
        newPath.strokeWidth = targetOuter.strokeWidth;
        newPath.matrix = targetOuter.matrix.clone();
        newPath.data = { ...(targetOuter.data || {}) };
        parent.insertChild(idx, newPath);
        resultOuter = newPath;
        if (targetOuter === outerItem) {
          if (window.selectedItem === outerItem) {
            window.selectedItem = newPath;
          }
          if (window.selectedItems) {
            const sIdx = window.selectedItems.indexOf(outerItem);
            if (sIdx !== -1) window.selectedItems[sIdx] = newPath;
          }
          window.ekkoOuters.delete(outerItem.id);
          window.ekkoOuters.set(newPath.id, newPath);
        }
        holeIds.forEach(id => {
          const hole = paper.project.getItem({ id });
          if (hole && hole.data) hole.data.outerItemId = newPath.id;
        });
      }
      targetOuter.remove();
    }
    if (localCombined) localCombined.remove();
  }

  if (solidGlobal) solidGlobal.remove();
  if (combined) combined.remove();
  paper.view.update();
  return resultOuter;
}

if (typeof window.paper !== 'undefined' && paper.view) {
  paper.view.on('frame', () => {
    if (!paper.project || !paper.project.activeLayer) return;
    window.ekkoOuters.forEach(outerItem => {
      let needsUpdate = false;
      const validHoleIds = [];
      const holeIds = outerItem.data?.holeIds || [];
      holeIds.forEach(id => {
        const hole = paper.project.getItem({ id });
        if (hole && hole.parent) {
          validHoleIds.push(id);
          const targetHole = hole.data?.clipGroup ? getContentItem(hole) : hole;
          const currentHash = `${targetHole.position.x.toFixed(1)},${targetHole.position.y.toFixed(1)},${targetHole.rotation}`;
          if (hole.data.lastHash !== currentHash) {
            hole.data.lastHash = currentHash;
            needsUpdate = true;
          }
        } else {
          needsUpdate = true;
        }
      });
      if (needsUpdate) {
        outerItem.data.holeIds = validHoleIds;
        updateOuterPathGeometry(outerItem);
      }
    });
  });
}

if (typeof window !== 'undefined') {
  const customUpdateSelectionBox = function(item) {
    if (window.selectionBoxGroup) {
      window.selectionBoxGroup.remove();
      window.selectionBoxGroup = null;
    }
    if (window.nodeEditMode) return;
    const primaryItem = item || window.selectedItem;
    if (!primaryItem) return;
    let isMockup = false;
    let curr = primaryItem;
    while (curr) {
      if (curr.data && (curr.data.mockup || curr.data.isMask)) {
        isMockup = true;
        break;
      }
      if (curr === window.currentMockup) {
        isMockup = true;
        break;
      }
      curr = curr.parent;
    }
    if (isMockup) return;

    const selected = (window.selectedItems && window.selectedItems.length > 0)
      ? window.selectedItems
      : [primaryItem];
    let bounds = null;
    selected.forEach(function(it) {
      const displayItem = (it.data && it.data.clipGroup) ? getContentItem(it) : it;
      if (!displayItem) return;
      if (!bounds) {
        bounds = displayItem.bounds.clone();
      } else {
        bounds = bounds.unite(displayItem.bounds);
      }
    });
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

    window.selectionBoxGroup = new paper.Group();
    window.selectionBoxGroup.data = { isSelectionBox: true };
    if (selected.length > 1) {
      selected.forEach(function(it) {
        const displayItem = (it.data && it.data.clipGroup) ? getContentItem(it) : it;
        if (displayItem && displayItem.bounds) {
          const singleBorder = new paper.Path.Rectangle(displayItem.bounds);
          singleBorder.strokeColor = '#007bff';
          singleBorder.strokeWidth = 1 / paper.view.zoom;
          singleBorder.dashArray = [3 / paper.view.zoom, 3 / paper.view.zoom];
          window.selectionBoxGroup.addChild(singleBorder);
        }
      });
    }

    const isRotSnapped = window.isRotationSnapped && window.rotationActive;
    const mainColor = isRotSnapped ? '#28a745' : '#007bff';
    const border = new paper.Path.Rectangle(bounds);
    border.strokeColor = mainColor;
    border.strokeWidth = 1.5 / paper.view.zoom;
    border.dashArray = [4 / paper.view.zoom, 4 / paper.view.zoom];
    window.selectionBoxGroup.addChild(border);

    const handleSize = 8 / paper.view.zoom;
    const handlesInfo = [
      { point: bounds.topLeft, type: 'tl' },
      { point: bounds.topCenter, type: 't' },
      { point: bounds.topRight, type: 'tr' },
      { point: bounds.rightCenter, type: 'r' },
      { point: bounds.bottomRight, type: 'br' },
      { point: bounds.bottomCenter, type: 'b' },
      { point: bounds.bottomLeft, type: 'bl' },
      { point: bounds.leftCenter, type: 'l' }
    ];

    handlesInfo.forEach(function(info) {
      const rect = new paper.Path.Rectangle({
        center: info.point,
        size: [handleSize, handleSize],
        strokeColor: mainColor,
        fillColor: '#ffffff',
        strokeWidth: 1.5 / paper.view.zoom
      });
      rect.data = { isHandle: true, handleType: info.type };
      window.selectionBoxGroup.addChild(rect);
    });

    const rotHandleDistance = 25 / paper.view.zoom;
    const rotHandleCenter = bounds.topCenter.add(new paper.Point(0, -rotHandleDistance));
    const connector = new paper.Path.Line(bounds.topCenter, rotHandleCenter);
    connector.strokeColor = mainColor;
    connector.strokeWidth = 1.2 / paper.view.zoom;
    window.selectionBoxGroup.addChild(connector);

    const rotHandleCircle = new paper.Path.Circle({
      center: rotHandleCenter,
      radius: 7.5 / paper.view.zoom,
      strokeColor: mainColor,
      fillColor: '#ffffff',
      strokeWidth: 1.5 / paper.view.zoom
    });
    rotHandleCircle.data = { isHandle: true, handleType: 'rot' };
    window.selectionBoxGroup.addChild(rotHandleCircle);

    const iconRadius = 3.5 / paper.view.zoom;
    const arrowIcon = new paper.Path.Arc(
      rotHandleCenter.add(new paper.Point(-iconRadius, 0)),
      rotHandleCenter.add(new paper.Point(0, -iconRadius)),
      rotHandleCenter.add(new paper.Point(iconRadius, 0))
    );
    arrowIcon.strokeColor = mainColor;
    arrowIcon.strokeWidth = 1.2 / paper.view.zoom;
    window.selectionBoxGroup.addChild(arrowIcon);

    const arrowTip = new paper.Path();
    arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius - 1.5 / paper.view.zoom, 1.5 / paper.view.zoom)));
    arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius, 0)));
    arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius + 1.5 / paper.view.zoom, 1.5 / paper.view.zoom)));
    arrowTip.strokeColor = mainColor;
    arrowTip.strokeWidth = 1.2 / paper.view.zoom;
    window.selectionBoxGroup.addChild(arrowTip);
    window.selectionBoxGroup.bringToFront();

    if (typeof window.applyPositionCorrections === "function") {
      window.applyPositionCorrections();
    }
  };

  try {
    Object.defineProperty(window, 'updateSelectionBox', {
      get: function() { return customUpdateSelectionBox; },
      set: function() {},
      configurable: true,
      enumerable: true
    });
  } catch(e) {
    window.updateSelectionBox = customUpdateSelectionBox;
  }
}

function installGlobalFinalizationHooks() {
  const canvasEl = document.getElementById("editorCanvas");
  if (!canvasEl) return;
  canvasEl.addEventListener("contextmenu", (e) => {
    if (window.nodeEditMode) {
      e.preventDefault();
      if (typeof window.exitNodeEditMode === "function") {
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
    if (textEditor) {
      e.preventDefault();
      textEditor.blur();
      return;
    }
  });

  document.addEventListener("keydown", (e) => {
    const key = e.key.toLowerCase();
    if (key === "enter" || key === "escape") {
      if (window.nodeEditMode) {
        e.preventDefault();
        if (typeof window.exitNodeEditMode === "function") {
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
        if (key === "escape" || (key === "enter" && !e.shiftKey)) {
          e.preventDefault();
          textEditor.blur();
          return;
        }
      }
    }
  }, { capture: true });
}

function getRasterFromItemLocal(item) {
  if (!item) return null;
  if (isRaster(item)) return item;
  if (item.children) {
    const rasterChild = item.children.find(c => isRaster(c));
    if (rasterChild) return rasterChild;
    for (let i = 0; i < item.children.length; i++) {
      const found = getRasterFromItemLocal(item.children[i]);
      if (found) return found;
    }
  }
  return null;
}

export function clipImageWithVector(vectorItem, rasterItem) {
  if (typeof window.saveHistory === 'function') window.saveHistory();
  const actualVector = vectorItem.data?.clipGroup ? getContentItem(vectorItem) : vectorItem;
  const actualRaster = getRasterFromItemLocal(rasterItem);
  if (!actualVector || !actualRaster) return;

  const maskPath = actualVector.clone({ insert: false });
  maskPath.clipMask = true;
  maskPath.visible = true;
  maskPath.data = { isVectorMask: true };

  const rawRaster = actualRaster.clone({ insert: false });
  rawRaster.data = { locked: false, label: "Imagen Recortada" };

  const group = new paper.Group([maskPath, rawRaster]);
  group.clipped = true;
  group.data = {
    locked: false,
    clipGroup: true,
    label: "Recorte Personalizado (" + (actualVector.data?.label || "Vector") + ")"
  };

  const parent = rasterItem.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(rasterItem);
  parent.insertChild(index, group);
  rasterItem.remove();
  vectorItem.remove();

  window.deselectItem();
  window.selectItem(group);
  paper.view.update();
}

function handleInteractiveDrop(event) {
  let draggedItem = window.selectedItem;
  if (!draggedItem) return;
  let holeController = null;
  if (draggedItem.data?.isHoleController) {
    holeController = draggedItem;
  } else if (isGroup(draggedItem) && !draggedItem.data?.clipGroup) {
    // Buscar si hay un calado controller celeste adentro
    holeController = draggedItem.children.find(c => c.data?.isHoleController);
  }

  if (holeController) {
    let newOwner = null;
    const holeCenter = holeController.bounds.center;
    const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
    const candidates = designLayer.children.filter(c => {
      if (c === draggedItem || c === holeController) return false;
      if (c.data && (c.data.mockup || c.data.isMask || c.data.isSelectionBox || c.data.isHandle || c.data.isSmartGuide || c.data.isMeasurement || c.data.isTracePreview)) return false;
      return isPath(c) || isCompoundPath(c) || c.data?.clipGroup;
    });

    for (let outer of candidates) {
      if (outer.id === holeController.data.outerItemId) continue;
      const targetOuter = outer.data.clipGroup ? getContentItem(outer) : outer;
      if (targetOuter && (typeof targetOuter.contains === 'function' ? targetOuter.contains(holeCenter) : targetOuter.bounds.contains(holeCenter))) {
        newOwner = outer;
        break;
      }
    }

    if (newOwner) {
      if (typeof window.saveHistory === 'function') window.saveHistory();
      const oldOwnerId = holeController.data.outerItemId;
      const oldOwner = oldOwnerId ? paper.project.getItem({ id: oldOwnerId }) : null;
      if (oldOwner) {
        oldOwner.data.holeIds = (oldOwner.data.holeIds || []).filter(hid => hid !== holeController.id);
        if (oldOwner.data.holeIds.length === 0) {
          delete oldOwner.data.isOuterWithHoles;
          window.ekkoOuters.delete(oldOwner.id);
        } else {
          updateOuterPathGeometry(oldOwner);
        }
      }

      const targetNewOwner = newOwner.data.clipGroup ? getContentItem(newOwner) : newOwner;
      if (!newOwner.data?.isOuterWithHoles || !newOwner.data?.originalPath) {
        newOwner.data = newOwner.data || {};
        newOwner.data.isOuterWithHoles = true;
        newOwner.data.originalPath = targetNewOwner.clone({ insert: false });
        newOwner.data.holeIds = [];
        window.ekkoOuters.set(newOwner.id, newOwner);
      }
      newOwner.data.holeIds = newOwner.data.holeIds || [];
      if (!newOwner.data.holeIds.includes(holeController.id)) {
        newOwner.data.holeIds.push(holeController.id);
      }
      holeController.data.outerItemId = newOwner.id;
      updateOuterPathGeometry(newOwner);
      paper.view.update();
    } else {
      const hitRaster = paper.project.hitTest(event.point, {
        fill: true,
        stroke: true,
        tolerance: 5 / paper.view.zoom,
        match: (hit) => {
          const item = hit.item;
          const actual = item.data?.clipGroup ? getContentItem(item) : item;
          return isRaster(actual);
        }
      });
      if (hitRaster) {
        const rasterItem = window.getSelectableItem ? window.getSelectableItem(hitRaster.item) : hitRaster.item;
        if (rasterItem) {
          if (typeof window.saveHistory === 'function') window.saveHistory();
          const oldOwnerId = holeController.data.outerItemId;
          const oldOwner = oldOwnerId ? paper.project.getItem({ id: oldOwnerId }) : null;
          if (oldOwner) {
            oldOwner.data.holeIds = (oldOwner.data.holeIds || []).filter(hid => hid !== holeController.id);
            if (oldOwner.data.holeIds.length === 0) {
              delete oldOwner.data.isOuterWithHoles;
              window.ekkoOuters.delete(oldOwner.id);
            } else {
              updateOuterPathGeometry(oldOwner);
            }
          }
          clipImageWithVector(holeController, rasterItem);
          paper.view.update();
        }
      }
    }
  } else if (isPath(draggedItem) || isCompoundPath(draggedItem)) {
    const hitRaster = paper.project.hitTest(event.point, {
      fill: true,
      stroke: true,
      tolerance: 5 / paper.view.zoom,
      match: (hit) => {
        const item = hit.item;
        const actual = item.data?.clipGroup ? getContentItem(item) : item;
        return isRaster(actual);
      }
    });
    if (hitRaster) {
      const rasterItem = window.getSelectableItem ? window.getSelectableItem(hitRaster.item) : hitRaster.item;
      if (rasterItem) {
        clipImageWithVector(draggedItem, rasterItem);
      }
    }
  }
}

export function installHoleDragAndImageClipHook() {
  if (!window.paper || !paper.tools || paper.tools.length === 0) {
    setTimeout(installHoleDragAndImageClipHook, 100);
    return;
  }
  const selectTool = paper.tools.find(t => t.onMouseDrag);
  if (!selectTool) {
    setTimeout(installHoleDragAndImageClipHook, 100);
    return;
  }
  if (selectTool.data?.holeAndClipHooked) return;
  selectTool.data = selectTool.data || {};
  selectTool.data.holeAndClipHooked = true;
  const originalOnMouseUp = selectTool.onMouseUp;
  selectTool.onMouseUp = function(event) {
    originalOnMouseUp.call(this, event);
    handleInteractiveDrop(event);
  };
}

export function initContextualMenu() {
  installGlobalFinalizationHooks();
  installHoleDragAndImageClipHook();
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

  setClick('btnCtxGroup', () => groupSelectedItems());
  setClick('btnCtxAgrupar', () => groupSelectedItems());
  setClick('btnCtxUngroup', () => ungroupSelectedItem());
  setClick('btnCtxDesagrupar', () => ungroupSelectedItem());
  setClick('btnCtxEditNodes', () => {
    if (window.selectedItem) enterNodeEditMode(window.selectedItem);
  });
  setClick('btnCtxNodeEdit', () => {
    if (window.selectedItem) enterNodeEditMode(window.selectedItem);
  });

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

  window.groupSelectedItems = groupSelectedItems;
  window.ungroupSelectedItem = ungroupSelectedItem;
  window.separateContours = separateContours;
  window.separateContoursIntoIndependentShapes = separateContoursIntoIndependentShapes;
  window.dissolveOuterWithHoles = dissolveOuterWithHoles;
  window.ungroupHoleController = ungroupHoleController;
  window.handleInteractiveDrop = handleInteractiveDrop;
  window.updateOuterPathGeometry = updateOuterPathGeometry;
}

export function updateContextualMenu(item) {
  if (typeof window !== 'undefined' && item) {
    console.log("%c[EKKO CLICK / SELECTION] Objeto seleccionado en pantalla:", "color: #3b82f6; font-weight: bold; background: #eff6ff; padding: 2px 6px; border-radius: 4px;");
    console.log(" - ID del elemento:", item.id);
    console.log(" - Tipo del objeto:", item.constructor.name);
    console.log(" - Datos asociados (item.data):", JSON.stringify(item.data || {}));
    const actualTarget = item.data?.clipGroup ? getContentItem(item) : item;
    if (actualTarget) {
      console.log(" - Tipo de contenido real:", actualTarget.constructor.name);
      if (isCompoundPath(actualTarget)) {
        console.log(" - Sub-trazados (children):", actualTarget.children.length);
        actualTarget.children.forEach((child, index) => {
          console.log(`   └─ Subpath [${index}]: ID ${child.id}, Tipo: ${child.constructor.name}, Área: ${Math.round(child.area)}, Cerrado: ${child.closed}`);
        });
      } else if (isGroup(actualTarget)) {
        console.log(" - Elementos agrupados (children):", actualTarget.children.length);
      }
    }
  } else if (typeof window !== 'undefined') {
    console.log("%c[EKKO SELECTION] Selección vacía o limpia.", "color: #64748b; font-weight: bold; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;");
  }

  const toolbar = document.getElementById('contextual-toolbar');
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
          const canUngroup = window.selectedItems.some(it => {
            const t = it.data?.clipGroup ? getContentItem(it) : it;
            return t && (isGroup(t) || isCompoundPath(t) || isSymbolItem(t));
          });
          if (canUngroup) {
            btnUngroup.classList.remove('hidden');
            btnUngroup.style.display = '';
          } else {
            btnUngroup.classList.add('hidden');
            btnUngroup.style.display = 'none';
          }
        }
      }
    }
    return;
  }

  const target = item.data?.clipGroup ? getContentItem(item) : item;
  if (!target) return;

  if (isPointText(target) || target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
    const txtCtrl = document.getElementById('ctxTextControls');
    if (txtCtrl) txtCtrl.classList.remove('hidden');
    const fontTrigger = document.querySelector('.selected-font-trigger span');
    if (fontTrigger) {
      const currentFamily = getSelectedFontFamily();
      const found = fontsCache.find(f => f.family === currentFamily);
      fontTrigger.textContent = found ? found.name : currentFamily;
    }
  } else if (isRaster(target)) {
    const imgCtrl = document.getElementById('ctxImageControls');
    if (imgCtrl) imgCtrl.classList.remove('hidden');
  } else if (isPath(target) || isCompoundPath(target) || isGroup(target) || isSymbolItem(target)) {
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
        const canUngroup = isGroup(target) || isCompoundPath(target) || isSymbolItem(target);
        btnUngroup.style.display = canUngroup ? 'inline-block' : 'none';
      }
    }
  }

  if (window.customToolbarLeft !== undefined && window.customToolbarTop !== undefined) {
    toolbar.style.left = window.customToolbarLeft + 'px';
    toolbar.style.top = window.customToolbarTop + 'px';
    toolbar.style.zIndex = "2147483647";
  } else if (!toolbarDragged || lastSelectedItem !== item) {
    const bounds = item.bounds;
    if (!bounds) return;
    const displayItem = item.data?.clipGroup ? getContentItem(item) : item;
    const targetBounds = displayItem ? displayItem.bounds : bounds;
    if (targetBounds && window.paper && paper.view) {
      const viewPos = paper.view.projectToView(targetBounds.topCenter);
      const canvasEl = document.getElementById('editorCanvas');
      if (canvasEl) {
        const rect = canvasEl.getBoundingClientRect();
        const x = rect.left + window.scrollX + viewPos.x - (toolbar.offsetWidth / 2);
        const y = rect.top + window.scrollY + viewPos.y - toolbar.offsetHeight - 15;
        toolbar.style.position = "absolute";
        toolbar.style.left = Math.max(10, x) + 'px';
        toolbar.style.top = Math.max(10, y) + 'px';
        toolbar.style.zIndex = "2147483647";
      }
    }
  }
  lastSelectedItem = item;
}

export function hideContextualMenu() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (toolbar) {
    toolbar.classList.remove('active');
  }
  const list = document.querySelector('.font-dropdown-list');
  if (list) {
    list.classList.add('hidden');
  }
  toolbarDragged = false;
  lastSelectedItem = null;
}

window.applyPositionCorrections = function() {
  const toolbar = document.getElementById("contextual-toolbar");
  const textEditor = document.getElementById("ekko-text-editor");
  if (!window.paper || !paper.view || !window.selectedItem) return;
  const item = window.selectedItem;
  const displayItem = item.data?.clipGroup ? getContentItem(item) : item;
  if (!displayItem) return;
  const bounds = displayItem.bounds;
  const viewPos = paper.view.projectToView(bounds.topCenter);
  const centerPos = paper.view.projectToView(bounds.center);

  if (toolbar && toolbar.classList.contains("active")) {
    const toolbarHeight = toolbar.offsetHeight || 45;
    const toolbarWidth = toolbar.offsetWidth || 350;
    const canvasEl = document.getElementById("editorCanvas");
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      const x = rect.left + window.scrollX + viewPos.x - (toolbarWidth / 2);
      const y = rect.top + window.scrollY + viewPos.y - toolbarHeight - 15;
      toolbar.style.position = "absolute";
      toolbar.style.left = Math.max(10, x) + "px";
      toolbar.style.top = Math.max(10, y) + "px";
      toolbar.style.zIndex = "2147483646";
    }
  }

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
      textEditor.style.zIndex = "2147483647";
    }
  }
};


// =========================================================================
// EMULATION ENGINE: GEOMETRIC UNGROUP (OUTSIDE-IN RECURSIVE DECOMPOSITION)
// =========================================================================

function areaOf(path) {
  if (!path) return 0;
  return Math.abs(path.area || (path.bounds ? path.bounds.area : 0) || 0);
}

function contains(parent, child) {
  if (!parent || !child) return false;
  const p = child.bounds?.center;
  if (!p) return false;
  if (typeof parent.contains === 'function') {
    try { return parent.contains(p); } catch (_) {}
  }
  return parent.bounds ? parent.bounds.contains(p) : false;
}

function buildTree(paths) {
  const nodes = paths.map(path => ({ path, parent: null, children: [], depth: 0 }));
  for (const node of nodes) {
    let best = null;
    let bestArea = Infinity;
    for (const candidate of nodes) {
      if (candidate === node) continue;
      const ca = areaOf(candidate.path);
      const na = areaOf(node.path);
      if (ca > na && contains(candidate.path, node.path)) {
        if (ca < bestArea) {
          bestArea = ca;
          best = candidate;
        }
      }
    }
    if (best) {
      node.parent = best;
      best.children.push(node);
    }
  }

  const roots = nodes.filter(n => !n.parent);
  const assign = (n, d) => {
    n.depth = d;
    n.children.forEach(c => assign(c, d + 1));
  };
  roots.forEach(root => assign(root, 0));
  return roots;
}

function clonePath(path) {
  return path.clone({ insert: false });
}

function makeShell(node) {
  const shell = new paper.CompoundPath({ insert: false });
  const outer = clonePath(node.path);
  shell.addChild(outer);

  // Even depth = filled contour; odd depth = transparent cutout.
  if (node.depth % 2 === 1) {
    shell.remove();
    return null;
  }
  
  node.children.filter(child => child.depth % 2 === 1).forEach(hole => {
    shell.addChild(clonePath(hole.path));
  });
  
  shell.fillColor = node.path.fillColor ? node.path.fillColor.clone() : null;
  shell.strokeColor = node.path.strokeColor ? node.path.strokeColor.clone() : null;
  shell.strokeWidth = node.path.strokeWidth || 0;
  return shell;
}

function makeNode(node, global, isClipped, item, parent, target) {
  const hasChildren = node.children.length > 0;
  const isHoleType = node.depth % 2 === 1;

  if (!hasChildren) {
    // ELEMENTO SIMPLE (Hijo final sin anidación)
    const leaf = clonePath(node.path);
    leaf.fillColor = isHoleType ? new paper.Color(255, 255, 255, 0.01) : (node.path.fillColor ? node.path.fillColor.clone() : new paper.Color('#000000'));
    leaf.strokeColor = node.path.strokeColor ? node.path.strokeColor.clone() : new paper.Color('#000000');
    leaf.strokeWidth = node.path.strokeWidth || 1;

    let newItem;
    if (isClipped) {
      newItem = window.clipItem(leaf);
      if (newItem === leaf) {
        newItem.matrix = global.clone().chain(leaf.matrix);
      } else {
        newItem.matrix = item.matrix.clone();
        leaf.matrix = getMatrixRelativeTo(leaf, target).clone().chain(leaf.matrix);
      }
    } else {
      newItem = leaf;
      newItem.matrix = global.clone().chain(leaf.matrix);
      parent.addChild(newItem);
    }

    newItem.data = {
      ...(item.data || {}),
      locked: false,
      geometricRole: isHoleType ? 'hole' : 'solid',
      geometricHierarchy: 'simple',
      label: isHoleType ? "Hueco" : (item.data?.label || "Objeto")
    };
    return newItem;
  }

  // ELEMENTO COMPUESTO (Tiene más descendientes en capas profundas)
  const group = new paper.Group({ insert: false });
  group.data = {
    ...(item.data || {}),
    locked: false,
    geometricHierarchy: 'compound',
    geometricDepth: node.depth,
    geometricRole: isHoleType ? 'hole' : 'solid',
    label: isHoleType ? "Grupo Calado Compuesto" : "Grupo Sólido Compuesto"
  };

  // Añadir la corteza de este nivel
  const shell = makeShell(node);
  let configuredShell;
  if (shell) {
    configuredShell = shell;
    configuredShell.fillColor = isHoleType ? new paper.Color(255, 255, 255, 0.01) : (shell.fillColor || new paper.Color('#000000'));
    group.addChild(configuredShell);
  } else {
    const selfPath = clonePath(node.path);
    selfPath.fillColor = isHoleType ? new paper.Color(255, 255, 255, 0.01) : (selfPath.fillColor || new paper.Color('#000000'));
    configuredShell = selfPath;
    group.addChild(configuredShell);
  }

  // Añadir hijos recursivos dentro del grupo compuesto
  node.children.forEach(child => {
    const childItem = makeNode(child, global, isClipped, item, parent, target);
    if (childItem) {
      childItem.remove(); // Desprender de la capa activa para agruparlo
      group.addChild(childItem);
    }
  });

  let finalGroupItem;
  if (isClipped) {
    finalGroupItem = window.clipItem(group);
    if (finalGroupItem === group) {
      finalGroupItem.matrix = global.clone().chain(group.matrix);
    } else {
      finalGroupItem.matrix = item.matrix.clone();
      group.matrix = getMatrixRelativeTo(group, target).clone().chain(group.matrix);
    }
  } else {
    finalGroupItem = group;
    finalGroupItem.matrix = global.clone().chain(group.matrix);
    parent.addChild(finalGroupItem);
  }

  return finalGroupItem;
}

export function geometricUngroupCompound(item) {
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return null;
  const isClipped = !!item.data?.clipGroup;
  const target = isClipped ? getContentItem(item) : item;
  
  if (!isCompoundPath(target)) return null;

  const paths = [...target.children].filter(p => p && p.bounds && !p.data?.mockup && !p.data?.isMask);
  if (paths.length <= 1) return { handled: true, simple: true, items: [item] };

  const roots = buildTree(paths);
  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const global = getGlobalMatrix(target);
  const result = [];

  // SI HAY UN SOLO CONTORNO EXTERIOR PRINCIPAL (RAÍZ), SEPARAMOS LA GEOMETRÍA DIRECTAMENTE EN EL 1ER CLIC
  if (roots.length === 1) {
    const root = roots[0];

    // 1. Crear el contorno exterior como un contorno simple, cerrado y sólido, completamente libre de calados
    const shellPath = clonePath(root.path);
    shellPath.fillColor = target.fillColor || new paper.Color('#000000');
    shellPath.strokeColor = target.strokeColor || new paper.Color('#000000');
    shellPath.strokeWidth = target.strokeWidth || 1;

    let configuredShell;
    if (isClipped) {
      configuredShell = window.clipItem(shellPath);
      if (configuredShell === shellPath) {
        configuredShell.matrix = global.clone().chain(shellPath.matrix);
      } else {
        configuredShell.matrix = item.matrix.clone();
        shellPath.matrix = getMatrixRelativeTo(shellPath, target).clone().chain(shellPath.matrix);
      }
    } else {
      configuredShell = shellPath;
      configuredShell.matrix = global.clone().chain(shellPath.matrix);
      parent.addChild(configuredShell);
    }

    configuredShell.data = {
      ...(item.data || {}),
      locked: false,
      geometricRole: 'solid',
      geometricHierarchy: 'simple',
      label: item.data?.label || "Objeto"
    };
    result.push(configuredShell);

    // 2. Procesar los hijos de nivel 1 de forma recursiva (los calados y elementos internos)
    root.children.forEach(child => {
      const childItem = makeNode(child, global, isClipped, item, parent, target);
      if (childItem) {
        result.push(childItem);
      }
    });
  } else {
    // Si hay múltiples raíces independientes, procesamos cada una
    roots.forEach(root => {
      const built = makeNode(root, global, isClipped, item, parent, target);
      if (built) {
        result.push(built);
      }
    });
  }

  item.remove();

  const finalFiltered = [];
  result.forEach(it => {
    if (it && (it.parent === parent || (isClipped && it.parent))) {
      finalFiltered.push(it);
    }
  });
  
  // Insertar los elementos resultantes en la misma posición de capa (index) para preservar el z-index original y evitar fugas sobre el mockup
  finalFiltered.forEach((child, i) => {
    if (child && child.parent) {
      child.parent.insertChild(index + i, child);
    }
  });

  if (finalFiltered.length > 0) {
    window.deselectItem();
    setTimeout(() => {
      // CORRECCIÓN DE ORO: Seleccionar solo el primer elemento generado (el contorno exterior)
      // para evitar la caja de selección global y permitir el arrastre individual inmediato de cualquier pieza.
      const primaryItem = finalFiltered[0];
      window.selectedItems = [primaryItem];
      window.selectedItem = primaryItem;
      primaryItem.selected = true;
      if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
      if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
      paper.view.update();
    }, 50);
  }

  return { handled: true, simple: false, items: finalFiltered };
}

export function geometricUngroupOneLevel(item, isClipped = false, oldClipGroup = null) {
  if (!item || item.data?.geometricHierarchy !== 'compound' || !isGroup(item)) return null;
  const parent = oldClipGroup ? oldClipGroup.parent : (item.parent || paper.project.activeLayer);
  const index = oldClipGroup ? parent.children.indexOf(oldClipGroup) : parent.children.indexOf(item);
  const children = [...item.children];
  const matrix = getGlobalMatrix(item);
  const addedItems = [];

  children.forEach(child => {
    const targetAncestor = isClipped ? oldClipGroup : item;
    const relMatrix = getMatrixRelativeTo(child, targetAncestor);
    const globalMatrix = getGlobalMatrix(child);
    child.remove();
    let newItem;
    if (isClipped && oldClipGroup) {
      newItem = window.clipItem(child);
      if (newItem === child) {
        newItem.matrix = globalMatrix;
      } else {
        newItem.matrix = oldClipGroup.matrix.clone();
        child.matrix = relMatrix;
      }
    } else {
      newItem = child;
      newItem.matrix = globalMatrix;
      parent.addChild(newItem);
    }
    addedItems.push(newItem);
  });

  item.remove();
  if (isClipped && oldClipGroup) {
    oldClipGroup.clipped = false;
    oldClipGroup.remove();
  }

  addedItems.forEach((child, i) => {
    if (child && child.parent) {
      parent.insertChild(index + i, child);
    }
  });

  if (addedItems.length > 0) {
    window.deselectItem();
    setTimeout(() => {
      // CORRECCIÓN DE ORO: Seleccionar solo el primer elemento generado (el contorno exterior)
      // para evitar la caja de selección global y permitir el arrastre individual inmediato de cualquier pieza.
      const primaryItem = addedItems[0];
      window.selectedItems = [primaryItem];
      window.selectedItem = primaryItem;
      primaryItem.selected = true;
      if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
      if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
      paper.view.update();
    }, 50);
  }

  return { handled: true, items: addedItems };
}

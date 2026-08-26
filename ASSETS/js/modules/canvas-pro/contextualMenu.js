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
    if (window.paper && paper.project && paper.project.activeLayer) {
      paper.project.activeLayer.on('child-add', (event) => {
        const item = event.item;
        if (!item || (item.data && (item.data.mockup || item.data.isMask))) return;
        
        setTimeout(() => {
          console.log("%c[EKKO SVG LOAD] Se detectó un nuevo elemento en el lienzo:", "color: #ea580c; font-weight: bold; background: #fff7ed; padding: 2px 6px; border-radius: 4px;");
          console.log(" - ID del elemento:", item.id);
          console.log(" - Clase del objeto:", item.constructor.name);
          console.log(" - Nombre/Etiqueta:", item.name || item.data?.label || "Sin etiqueta");
          if (item.children) {
            console.log(" - Cantidad de hijos directos:", item.children.length);
            const types = item.children.map(c => c.constructor.name);
            console.log(" - Tipos de hijos:", types);
          }
          console.log(" - Límites (Bounds):", item.bounds ? { x: Math.round(item.bounds.x), y: Math.round(item.bounds.y), width: Math.round(item.bounds.width), height: Math.round(item.bounds.height) } : "N/A");
        }, 50);
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
  if (target instanceof paper.PointText) {
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
  if (target instanceof paper.PointText) {
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
  if (target instanceof paper.PointText) {
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
    if (node instanceof paper.Group && !node.data?.clipGroup) {
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
  while (current && current !== targetAncestor && !(current instanceof paper.Layer)) {
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
  while (current instanceof paper.Group && current.children.length === 1 && !current.data?.clipGroup) {
    const child = current.children[0];
    if (child instanceof paper.Group) {
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
    if (node instanceof paper.Group && !node.data?.clipGroup) {
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

function isArtboardBackground(path, parentItem) {
  if (!path || !parentItem) return false;
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

// NUEVA FUNCIÓN AUXILIAR: Resuelve y disuelve recursivamente grupos vacíos,
// grupos de un solo hijo (redundantes) y símbolos SVG en un solo clic.
function resolveRedundantWrappers(item) {
  let current = item;
  while (true) {
    // A. Si es un SymbolItem (Clon de símbolo <use>), lo expandimos inmediatamente
    if (current instanceof paper.SymbolItem || (paper.PlacedSymbol && current instanceof paper.PlacedSymbol)) {
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
        continue; // Seguir evaluando el clon generado
      }
    }
    // B. Si es un Grupo con un solo hijo que también es un Grupo o Trazado (Nesting redundante de exportación de Corel/Illustrator)
    if (current instanceof paper.Group && current.children.length === 1 && !current.data?.clipGroup) {
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
      continue; // Seguir evaluando el elemento promovido
    }
    break;
  }
  return current;
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


export function ungroupSelectedItem() {
  if (typeof window !== 'undefined') {
    console.log("%c[EKKO UNGROUP ACTION] 1. Clic detectado en Desagrupar 🔓", "color: #ffffff; font-weight: bold; background: #ea580c; padding: 4px 10px; border-radius: 6px; font-size: 13px;");
  }
  
  // COMPATIBILIDAD CON EDICIÓN DE NODOS:
  // Si estamos en modo de edición de nodos, el objeto que queremos desagrupar es
  // el que se está editando activamente (window.nodeEditTarget o activeNodeItem).
  // Salimos limpiamente de la edición de nodos para evitar referencias nulas o tiradores huérfanos.
  const wasInNodeEdit = !!window.nodeEditMode;
  let targetNodeItem = null;
  if (wasInNodeEdit) {
    targetNodeItem = window.nodeEditTarget;
    if (typeof window.exitNodeEditMode === 'function') {
      window.exitNodeEditMode(true); // Evitar re-seleccionar para que no haya conflictos en el primer clic
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

  // PRE-PROCESAMIENTO INTELIGENTE: Expandimos símbolos y removemos wrappers redundantes en un solo paso
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
    const activeTarget = target instanceof paper.Group ? getActiveGroupTarget(target) : target;
    const parent = item.parent || paper.project.activeLayer;
    const index = parent.children.indexOf(item);
    const newItems = [];

    // A. SI ES GRUPO TRADICIONAL
    if (activeTarget instanceof paper.Group && !activeTarget.data?.clipGroup) {
      console.log("%c[EKKO UNGROUP PROCESS] -> Tipo: GRUPO TRADICIONAL.", "color: #0369a1; font-weight: bold;");
      const flattened = ungroupGroupOneLevel(activeTarget, parent, index, isClipped, item);
      newItems.push(...flattened);
      if (isClipped && item) {
        item.clipped = false;
      }
      item.remove();
    }
    // B. SI ES TEXTO PARA SEPARAR POR LETRAS
    else if (activeTarget instanceof paper.PointText && activeTarget.content.length > 1) {
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
    else if (activeTarget instanceof paper.CompoundPath) {
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
        // Ejecutar separación jerárquica de contornos de afuera hacia adentro
        console.log("%c[EKKO UNGROUP PROCESS] El elemento es un CompoundPath estándar. Invocando separateContoursIntoIndependentShapes()...", "color: #0284c7; font-weight: bold;");
        const separated = separateContoursIntoIndependentShapes(item);
        if (separated && separated.length > 0) {
          console.log(` - Se generaron ${separated.length} formas/huecos separados.`);
          newItems.push(...separated);
        } else {
          console.warn(" - No se pudieron separar contornos para este CompoundPath.");
        }
      }
    }

    newItems.reverse().forEach(newItem => {
      parent.insertChild(index, newItem);
    });
    finalNewItems.push(...newItems);
  });

  window.deselectItem();
  setTimeout(() => {
    if (finalNewItems.length > 0) {
      const outersToSelect = finalNewItems.filter(it => !it.data?.isHoleController);
      const selectList = outersToSelect.length > 0 ? outersToSelect : finalNewItems;
      window.selectedItems = [...selectList];
      window.selectedItem = selectList[selectList.length - 1];
      selectList.forEach(it => { if (it) it.selected = true; });
      if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
      if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
      
      console.log("%c[EKKO UNGROUP ACTION] Desagrupación finalizada con éxito.", "color: #10b981; font-weight: bold; background: #ecfdf5; padding: 2px 6px; border-radius: 4px;");
      console.log(" - Nuevos elementos seleccionados en pantalla:", selectList.map(it => ({ id: it.id, type: it.constructor.name, data: it.data })));
    }
    paper.view.update();
  }, 50);
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

export function dissolveOuterWithHoles(item) {
  if (!item || !item.data?.isOuterWithHoles) return [];
  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const newItems = [];
  const isClipped = !!item.data?.clipGroup;
  const target = isClipped ? getContentItem(item) : item;

  if (typeof window.ekkoOuters !== 'undefined') {
    window.ekkoOuters.delete(item.id);
  }

  // Reconstruccion dinamica de originalPath y holeIds si proviene de la desagrupacion de primer nivel o si se perdieron
  const hasNoHoleControllers = !item.data.holeIds || item.data.holeIds.length === 0;
  if ((!item.data.originalPath || hasNoHoleControllers) && target instanceof paper.CompoundPath && target.children.length > 1) {
    const subPaths = [...target.children];
    subPaths.sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
    const outerPath = subPaths[0];
    const associatedHoles = subPaths.slice(1);

    if (!item.data.originalPath) {
      item.data.originalPath = outerPath.clone({ insert: false });
    }
    item.data.holeIds = [];

    const pathRelMatrix = getMatrixRelativeTo(target, isClipped ? item : null);
    const pathAbsMatrix = getGlobalMatrix(target);

    associatedHoles.forEach(hPath => {
      const holeClone = hPath.clone({ insert: false });
      let newHoleItem;
      if (isClipped) {
        newHoleItem = window.clipItem(holeClone);
        newHoleItem.matrix = item.matrix.clone();
        holeClone.matrix = pathRelMatrix.clone().chain(holeClone.matrix);
      } else {
        newHoleItem = holeClone;
        newHoleItem.matrix = pathAbsMatrix.clone().chain(holeClone.matrix);
        parent.addChild(newHoleItem);
      }
      newHoleItem.data = {
        isHoleController: true,
        outerItemId: "", // Se asignara abajo
        lastHash: "",
        label: "Hueco"
      };
      item.data.holeIds.push(newHoleItem.id);
    });
  }

  let newOuterItem = null;
  if (item.data.originalPath) {
    const targetOuter = isClipped ? getContentItem(item) : item;
    const restoredOuter = item.data.originalPath.clone({ insert: false });
    restoredOuter.fillColor = targetOuter.fillColor;
    restoredOuter.strokeColor = targetOuter.strokeColor;
    restoredOuter.strokeWidth = targetOuter.strokeWidth;

    if (isClipped) {
      newOuterItem = window.clipItem(restoredOuter);
      newOuterItem.matrix = item.matrix.clone();
      restoredOuter.matrix = targetOuter.matrix.clone();
    } else {
      newOuterItem = restoredOuter;
      newOuterItem.matrix = item.matrix.clone();
      parent.addChild(newOuterItem);
    }
    newOuterItem.data = { ...(item.data || {}) };
    delete newOuterItem.data.isOuterWithHoles;
    delete newOuterItem.data.originalPath;
    delete newOuterItem.data.holeIds;
    newItems.push(newOuterItem);
  }

  const holeIds = item.data.holeIds || [];
  for (let j = 0; j < holeIds.length; j++) {
    const id = holeIds[j];
    const hole = paper.project.getItem({ id: id });
    if (hole) {
      hole.remove();
      const targetHole = hole.data.clipGroup ? getContentItem(hole) : hole;
      let newHoleItem;
      if (isClipped) {
        newHoleItem = window.clipItem(targetHole.clone({ insert: false }));
        newHoleItem.matrix = hole.matrix.clone();
      } else {
        newHoleItem = hole;
        parent.addChild(newHoleItem);
      }
      if (newHoleItem.data) {
        newHoleItem.data.isHoleController = true;
        newHoleItem.data.outerItemId = newOuterItem.id;
        newHoleItem.data.lastHash = "";
        newHoleItem.data.label = "Hueco/Calado";
      }
      
      // Aplicar estetica visible de seguridad
      const visualHole = newHoleItem.data.clipGroup ? getContentItem(newHoleItem) : newHoleItem;
      if (visualHole) {
        visualHole.strokeColor = '#009dec';
        visualHole.strokeWidth = 1.5 / paper.view.zoom;
        visualHole.dashArray = [4, 4];
        visualHole.fillColor = new paper.Color(0, 157, 236, 0.15);
      }
      newItems.push(newHoleItem);
    }
  }

  if (isClipped && item) {
    item.clipped = false;
  }
  item.remove();
  return newItems;
}


export function ungroupHoleController(item) {
  if (!item || !item.data?.isHoleController) return [];
  const isClipped = !!item.data?.clipGroup;
  const target = isClipped ? getContentItem(item) : item;
  if (!(target instanceof paper.CompoundPath)) return [];

  const ownerId = item.data.outerItemId;
  const owner = ownerId ? paper.project.getItem({ id: ownerId }) : null;

  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }

  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const newItems = [];

  const subPaths = [...target.children];
  const pathRelMatrix = getMatrixRelativeTo(target, isClipped ? item : null);
  const pathAbsMatrix = getGlobalMatrix(target);

  if (owner) {
    owner.data.holeIds = (owner.data.holeIds || []).filter(id => id !== item.id);
  }

  subPaths.forEach(subPath => {
    const subClone = subPath.clone({ insert: false });
    subClone.fillColor = new paper.Color(255, 255, 255, 0.01);
    subClone.strokeColor = target.strokeColor || '#000000';
    subClone.strokeWidth = target.strokeWidth || 1;

    let newHoleItem;
    if (isClipped) {
      newHoleItem = window.clipItem(subClone);
      if (newHoleItem === subClone) {
        newHoleItem.matrix = pathAbsMatrix.clone().chain(subClone.matrix);
      } else {
        newHoleItem.matrix = item.matrix.clone();
        subClone.matrix = pathRelMatrix.clone().chain(subClone.matrix);
      }
    } else {
      newHoleItem = subClone;
      newHoleItem.matrix = pathAbsMatrix.clone().chain(subClone.matrix);
      parent.addChild(newHoleItem);
    }

    newHoleItem.data = {
      ...(newHoleItem.data || {}),
      isHoleController: true,
      outerItemId: ownerId || "",
      lastHash: "",
      label: "Hueco/Calado"
    };

    const visualHole = newHoleItem.data.clipGroup ? getContentItem(newHoleItem) : newHoleItem;
    if (visualHole) {
      visualHole.strokeColor = '#009dec';
      visualHole.strokeWidth = 1.5 / paper.view.zoom;
      visualHole.dashArray = [4, 4];
      visualHole.fillColor = new paper.Color(0, 157, 236, 0.15);
    }

    if (owner) {
      owner.data.holeIds.push(newHoleItem.id);
    }
    newItems.push(newHoleItem);
  });

  if (owner) {
    if (owner.data.holeIds.length === 0) {
      delete owner.data.isOuterWithHoles;
      window.ekkoOuters.delete(owner.id);
    } else {
      updateOuterPathGeometry(owner);
    }
  }

  item.remove();
  return newItems;
}


export function separateContoursIntoIndependentShapes(itemToProcess) {
  const item = itemToProcess || window.selectedItem;
  if (typeof window !== 'undefined') {
    console.log("%c[EKKO HIERARCHICAL DECOMPOSE] Iniciando descomposición jerárquica para:", "color: #0f766e; font-weight: bold;", item ? { id: item.id, type: item.constructor.name } : "Ninguno");
  }
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return [];
  const isClipped = !!item.data?.clipGroup;
  let target = isClipped ? getContentItem(item) : item;
  if (target instanceof paper.Group) {
    target = getActiveGroupTarget(target);
  }
  if (!target || !(target instanceof paper.CompoundPath)) return [];
  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }
  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const newItems = [];

  // Filtrar fondos de mesa de trabajo (Artboards) de forma súper segura
  const subPaths = [...target.children].filter(p => {
    if (isArtboardBackground(p, target)) {
      p.remove();
      return false;
    }
    return true;
  });

  const pathRelMatrix = getMatrixRelativeTo(target, isClipped ? item : null);
  const pathAbsMatrix = getGlobalMatrix(target);
  const originalFillColor = target.fillColor;
  const originalStrokeColor = target.strokeColor;
  const originalStrokeWidth = target.strokeWidth;

  if (subPaths.length === 0) return [];

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
          // Comprobación geométrica precisa
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

  if (typeof window !== 'undefined') {
    console.log("[EKKO DIAGNOSTIC] Jerarquía de anidamiento detectada por árbol de paridad:");
    subPaths.forEach(p => {
      const pNode = parentMap.get(p);
      console.log(` - Subtrazado ${p.id} (Área: ${Math.round(p.area)}): Profundidad = ${depthMap.get(p)}, Padre = ${pNode ? pNode.id : 'Ninguno'}`);
    });
  }

  // Lógica de descomposición inteligente de afuera hacia adentro (Jerárquica):
  let partsToCreate = []; // Array de { outer: Path, holes: [Path], isPeeledRoot: boolean }

  if (roots.length === 1 && subPaths.length > 1) {
    // CASO A: Hay una sola raíz principal (ej: el escudo contenedor, o una letra que contiene huecos).
    // Pelamos la raíz exterior como un elemento simple, y desagrupamos su nivel inmediato inferior (depth = 1).
    const singleRoot = roots[0];
    
    // La raíz exterior se convierte en una forma independiente simple
    partsToCreate.push({ outer: singleRoot, holes: [], isPeeledRoot: true });

    // Los elementos de profundidad 1 se convierten en las nuevas raíces independientes de sus respectivos sub-árboles
    const level1Items = subPaths.filter(p => depthMap.get(p) === 1);
    level1Items.forEach(lvl1 => {
      // Recolectar todos los descendientes de este elemento de nivel 1
      const descendants = subPaths.filter(p => {
        let curr = parentMap.get(p);
        while (curr) {
          if (curr === lvl1) return true;
          curr = parentMap.get(curr);
        }
        return false;
      });
      // Los descendientes directos (depth=2 en el árbol original) actúan como huecos lógicos de lvl1
      const immediateHoles = descendants.filter(p => parentMap.get(p) === lvl1);
      partsToCreate.push({ outer: lvl1, holes: immediateHoles, isPeeledRoot: false });
    });
  } else {
    // CASO B: Hay múltiples raíces independientes (Laureles, Escudo, Estrellas) o solo queda un elemento.
    // Separamos en el nivel de las raíces de forma limpia, manteniendo sus respectivos descendientes/huecos.
    roots.forEach(root => {
      const descendants = subPaths.filter(p => {
        let curr = parentMap.get(p);
        while (curr) {
          if (curr === root) return true;
          curr = parentMap.get(curr);
        }
        return false;
      });
      // Los descendientes directos (depth=1 en el árbol original) actúan como huecos lógicos de root
      const immediateHoles = descendants.filter(p => parentMap.get(p) === root);
      partsToCreate.push({ outer: root, holes: immediateHoles, isPeeledRoot: false });
    });
  }

  // 4. Construir y colorear los elementos resultantes en el canvas
  const newlyCreatedItems = [];
  const createdOuters = [];

  partsToCreate.forEach(part => {
    const outerPath = part.outer;
    const associatedHoles = part.holes;
    let shapeToInsert;

    // Determinar color de relleno con lógica inteligente de contraste y transparencia
    let finalFillColor = originalFillColor;
    
    if (part.isPeeledRoot) {
      // Si es una raíz pelada (como el fondo del escudo exterior o de una letra), mantiene el color original de la forma
      finalFillColor = originalFillColor || '#000000';
    } else {
      // Si es un nivel interno que se independizó (como las letras de AFA):
      // Si estaba metido adentro de un contenedor oscuro, le damos contraste (blanco) para que no desaparezca.
      // Si el original ya era blanco, lo mantenemos blanco.
      if (originalFillColor) {
        const isDark = originalFillColor.gray !== undefined 
          ? originalFillColor.gray < 0.5 
          : (originalFillColor.red * 0.299 + originalFillColor.green * 0.587 + originalFillColor.blue * 0.114) < 0.5;
        finalFillColor = isDark ? new paper.Color('#ffffff') : new paper.Color('#000000');
      } else {
        finalFillColor = new paper.Color('#ffffff');
      }
    }

    if (associatedHoles.length > 0) {
      // Si tiene huecos lógicos de profundidad par (como la letra "A" con su triángulo interno):
      // Se construye un CompoundPath local independiente para que la perforación siga siendo transparente en sí misma.
      const childrenClones = [];
      const outerClone = outerPath.clone({ insert: false });
      outerClone.fillColor = null;
      outerClone.strokeColor = null;
      childrenClones.push(outerClone);

      associatedHoles.forEach(h => {
        const hClone = h.clone({ insert: false });
        hClone.fillColor = null;
        hClone.strokeColor = null;
        childrenClones.push(hClone);
      });

      const compound = new paper.CompoundPath({
        children: childrenClones,
        insert: false
      });
      compound.fillRule = 'evenodd';
      compound.fillColor = finalFillColor;
      compound.strokeColor = originalStrokeColor || '#000000';
      compound.strokeWidth = originalStrokeWidth || 1;
      shapeToInsert = compound;
    } else {
      // Si es un elemento simple sin huecos (laureles, estrellas, letra "F"), o si es un hueco final (como el triángulo interior):
      // En este caso, si la forma era una raíz pelada (isPeeledRoot), se crea un Path simple sólido estándar.
      // Pero si era un hueco suelto final y no tiene hijos, lo creamos como un Calado Reactivo (Hole Controller) transparente!
      if (!part.isPeeledRoot && depthMap.get(outerPath) % 2 !== 0) {
        // ¡Es un hueco final! Lo creamos como Calado Reactivo interactivo para que actúe como transparencia pura
        const pathClone = outerPath.clone({ insert: false });
        pathClone.fillColor = new paper.Color(255, 255, 255, 0.01);
        pathClone.strokeColor = originalStrokeColor || '#000000';
        pathClone.strokeWidth = originalStrokeWidth || 1;
        shapeToInsert = pathClone;
      } else {
        // Es un elemento sólido (como una hoja de laurel o una estrella)
        const pathClone = outerPath.clone({ insert: false });
        pathClone.fillColor = finalFillColor;
        pathClone.strokeColor = originalStrokeColor || '#000000';
        pathClone.strokeWidth = originalStrokeWidth || 1;
        shapeToInsert = pathClone;
      }
    }

    let newItem;
    if (isClipped) {
      newItem = window.clipItem(shapeToInsert);
      if (newItem === shapeToInsert) {
        newItem.matrix = pathAbsMatrix.clone().chain(shapeToInsert.matrix);
      } else {
        newItem.matrix = item.matrix.clone();
        shapeToInsert.matrix = pathRelMatrix.clone().chain(shapeToInsert.matrix);
      }
    } else {
      newItem = shapeToInsert;
      newItem.matrix = pathAbsMatrix.clone().chain(shapeToInsert.matrix);
      parent.addChild(newItem);
    }

    // Configurar metadatos del objeto
    newItem.data = {
      ...(newItem.data || {}),
      label: item.data?.label || "Objeto"
    };

    // Si es un Calado Reactivo suelto (un hueco desprendido)
    if (!part.isPeeledRoot && depthMap.get(outerPath) % 2 !== 0 && associatedHoles.length === 0) {
      newItem.data.isHoleController = true;
      newItem.data.outerItemId = ""; // Se asigna dinámicamente si hay colisión
      newItem.data.lastHash = "";
      newItem.data.label = "Hueco";
      
      const visualHole = newItem.data.clipGroup ? getContentItem(newItem) : newItem;
      if (visualHole) {
        visualHole.strokeColor = '#009dec';
        visualHole.strokeWidth = 1.5 / paper.view.zoom;
        visualHole.dashArray = [4, 4];
        visualHole.fillColor = new paper.Color(0, 157, 236, 0.15); // Transparente azulado interactivo
      }
    } else if (depthMap.get(outerPath) % 2 === 0) {
      createdOuters.push(newItem);
    }

    newlyCreatedItems.push(newItem);
  });

  // Vincular los nuevos controladores de hueco a sus objetos exteriores correspondientes
  newlyCreatedItems.forEach(it => {
    if (it.data?.isHoleController) {
      // Buscar cuál de las nuevas raíces contiene el centro de este hueco
      const holeCenter = it.bounds.center;
      let bestOuter = null;
      let minArea = Infinity;
      createdOuters.forEach(outItem => {
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
        bestOuter.data.holeIds = bestOuter.data.holeIds || [];
        bestOuter.data.holeIds.push(it.id);
        
        // Registrar en el mapa global de outers de EKKO
        if (typeof window.ekkoOuters !== 'undefined') {
          window.ekkoOuters.set(bestOuter.id, bestOuter);
        }
        
        // Regenerar la geometría recortada en tiempo real
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

  if (typeof window !== 'undefined') {
    console.log(`%c[EKKO DECOMPOSE PROCESS] separateContoursIntoIndependentShapes finalizado. Creados ${newlyCreatedItems.length} objetos independientes jerárquicos.`, "color: #0f766e; font-weight: bold;");
  }

  return newlyCreatedItems;
}

export function separateContours(itemToProcess, skipSelection = false) {
  const item = itemToProcess || window.selectedItem;
  console.log("%c[EKKO DIAGNOSTIC] Iniciando separateContours() para:", "color: #6d28d9; font-weight: bold;", item ? { id: item.id, type: item.constructor.name } : "Ninguno");
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return [];
  const isClipped = !!item.data?.clipGroup;
  let target = isClipped ? getContentItem(item) : item;
  if (target instanceof paper.Group) {
    target = getActiveGroupTarget(target);
  }
  if (!target || !(target instanceof paper.CompoundPath)) return [];
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

export function updateOuterPathGeometry(outerItem) {
  if (!outerItem || !outerItem.data?.originalPath) return outerItem;
  const targetOuter = outerItem.data.clipGroup ? getContentItem(outerItem) : outerItem;
  if (!targetOuter) return outerItem;
  let resultOuter = outerItem;
  const solidGlobal = outerItem.data.originalPath.clone({ insert: false });
  const outerGlobalMatrix = getGlobalMatrix(targetOuter);
  solidGlobal.matrix = outerGlobalMatrix;
  solidGlobal.applyMatrix = true;
  const holeIds = outerItem.data.holeIds || [];

  let combined = solidGlobal;
  holeIds.forEach(id => {
    const hole = paper.project.getItem({ id });
    if (hole && hole.parent) {
      const targetHole = hole.data.clipGroup ? getContentItem(hole) : hole;
      if (targetHole) {
        const holeGlobalMatrix = getGlobalMatrix(targetHole);
        const holeGlobal = targetHole.clone({ insert: false });
        holeGlobal.matrix = holeGlobalMatrix;
        holeGlobal.applyMatrix = true;
        let temp = null;
        try {
          temp = combined.subtract(holeGlobal);
        } catch (e) {
          console.error("Fallo substraction en updateOuterPathGeometry:", e);
        }
        if (temp) {
          combined.remove();
          combined = temp;
        }
        holeGlobal.remove();
      }
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
  if (item instanceof paper.Raster) return item;
  if (item.children) {
    const rasterChild = item.children.find(c => c instanceof paper.Raster);
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
  const draggedItem = window.selectedItem;
  if (!draggedItem) return;

  if (draggedItem.data?.isHoleController) {
    let newOwner = null;
    const holeCenter = draggedItem.bounds.center;
    const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
    const candidates = designLayer.children.filter(c => {
      if (c === draggedItem) return false;
      if (c.data && (c.data.mockup || c.data.isMask || c.data.isSelectionBox || c.data.isHandle || c.data.isSmartGuide || c.data.isMeasurement || c.data.isTracePreview)) return false;
      return c instanceof paper.Path || c instanceof paper.CompoundPath || c.data?.clipGroup;
    });

    for (let outer of candidates) {
      if (outer.id === draggedItem.data.outerItemId) continue;
      const targetOuter = outer.data.clipGroup ? getContentItem(outer) : outer;
      if (targetOuter && (typeof targetOuter.contains === 'function' ? targetOuter.contains(holeCenter) : targetOuter.bounds.contains(holeCenter))) {
        newOwner = outer;
        break;
      }
    }

    if (newOwner) {
      if (typeof window.saveHistory === 'function') window.saveHistory();
      const oldOwnerId = draggedItem.data.outerItemId;
      const oldOwner = oldOwnerId ? paper.project.getItem({ id: oldOwnerId }) : null;
      if (oldOwner) {
        oldOwner.data.holeIds = (oldOwner.data.holeIds || []).filter(hid => hid !== draggedItem.id);
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
      if (!newOwner.data.holeIds.includes(draggedItem.id)) {
        newOwner.data.holeIds.push(draggedItem.id);
      }
      draggedItem.data.outerItemId = newOwner.id;
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
          return actual instanceof paper.Raster;
        }
      });

      if (hitRaster) {
        const rasterItem = window.getSelectableItem ? window.getSelectableItem(hitRaster.item) : hitRaster.item;
        if (rasterItem) {
          if (typeof window.saveHistory === 'function') window.saveHistory();
          const oldOwnerId = draggedItem.data.outerItemId;
          const oldOwner = oldOwnerId ? paper.project.getItem({ id: oldOwnerId }) : null;
          if (oldOwner) {
            oldOwner.data.holeIds = (oldOwner.data.holeIds || []).filter(hid => hid !== draggedItem.id);
            if (oldOwner.data.holeIds.length === 0) {
              delete oldOwner.data.isOuterWithHoles;
              window.ekkoOuters.delete(oldOwner.id);
            } else {
              updateOuterPathGeometry(oldOwner);
            }
          }
          clipImageWithVector(draggedItem, rasterItem);
          paper.view.update();
        }
      }
    }
  } else if (draggedItem instanceof paper.Path || draggedItem instanceof paper.CompoundPath) {
    const hitRaster = paper.project.hitTest(event.point, {
      fill: true,
      stroke: true,
      tolerance: 5 / paper.view.zoom,
      match: (hit) => {
        const item = hit.item;
        const actual = item.data?.clipGroup ? getContentItem(item) : item;
        return actual instanceof paper.Raster;
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
  // Telemetría en tiempo real para selección de elementos
  if (typeof window !== 'undefined' && item) {
    console.log("%c[EKKO CLICK / SELECTION] Objeto seleccionado en pantalla:", "color: #3b82f6; font-weight: bold; background: #eff6ff; padding: 2px 6px; border-radius: 4px;");
    console.log(" - ID del elemento:", item.id);
    console.log(" - Tipo del objeto:", item.constructor.name);
    console.log(" - Datos asociados (item.data):", JSON.stringify(item.data || {}));
    const actualTarget = item.data?.clipGroup ? getContentItem(item) : item;
    if (actualTarget) {
      console.log(" - Tipo de contenido real:", actualTarget.constructor.name);
      if (actualTarget instanceof paper.CompoundPath) {
        console.log(" - Sub-trazados (children):", actualTarget.children.length);
        actualTarget.children.forEach((child, index) => {
          console.log(`   └─ Subpath [${index}]: ID ${child.id}, Tipo: ${child.constructor.name}, Área: ${Math.round(child.area)}, Cerrado: ${child.closed}`);
        });
      } else if (actualTarget instanceof paper.Group) {
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
      return tgt && (tgt instanceof paper.Path || tgt instanceof paper.CompoundPath || tgt instanceof paper.Group || tgt instanceof paper.PointText || tgt instanceof paper.SymbolItem || tgt instanceof paper.PlacedSymbol || tgt instanceof paper.Shape);
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
            return t && (t instanceof paper.Group || t instanceof paper.CompoundPath || t instanceof paper.SymbolItem || (paper.PlacedSymbol && t instanceof paper.PlacedSymbol));
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

  if (target instanceof paper.PointText || target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
    const txtCtrl = document.getElementById('ctxTextControls');
    if (txtCtrl) txtCtrl.classList.remove('hidden');
    const fontTrigger = document.querySelector('.selected-font-trigger span');
    if (fontTrigger) {
      const currentFamily = getSelectedFontFamily();
      const found = fontsCache.find(f => f.family === currentFamily);
      fontTrigger.textContent = found ? found.name : currentFamily;
    }
  } else if (target instanceof paper.Raster) {
    const imgCtrl = document.getElementById('ctxImageControls');
    if (imgCtrl) imgCtrl.classList.remove('hidden');
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath || target instanceof paper.Group || target instanceof paper.SymbolItem || (paper.PlacedSymbol && target instanceof paper.PlacedSymbol)) {
    const vecCtrl = document.getElementById('ctxVectorControls');
    if (vecCtrl) {
      vecCtrl.classList.remove('hidden');
      const btnEditNodes = document.getElementById('btnCtxEditNodes') || document.getElementById('btnCtxNodeEdit');
      if (btnEditNodes) {
        const canEdit = !(target instanceof paper.Group) && !(target instanceof paper.SymbolItem) && !(paper.PlacedSymbol && target instanceof paper.PlacedSymbol);
        btnEditNodes.style.display = canEdit ? 'inline-block' : 'none';
      }
      const btnGroup = document.getElementById('btnCtxGroup') || document.getElementById('btnCtxAgrupar');
      if (btnGroup) {
        btnGroup.classList.add('hidden');
        btnGroup.style.display = 'none';
      }
      const btnUngroup = document.getElementById('btnCtxUngroup') || document.getElementById('btnCtxDesagrupar');
      if (btnUngroup) {
        const canUngroup = (target instanceof paper.Group) || (target instanceof paper.CompoundPath) || (target instanceof paper.SymbolItem) || (paper.PlacedSymbol && target instanceof paper.PlacedSymbol);
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

/* =========================================================================
Modulo: ASSETS/js/modules/canvas-pro/contextualMenu.js (DOM-Safe WYSIWYG Edition - v16 PRO)
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/contextualMenu.js
Descripcion: Barra de herramientas flotante de contexto. Soporta barra arrastrable,
desplegable de fuentes personalizado basado en div con previsualizacion del texto dinamico
en tiempo real, e inyeccion dinamica de familias de fuentes.
SOPORTE DE DESAGRUPACION JERARQUICA SECUENCIAL CON CALADOS REACTIVOS RECURSIVOS (MATE, AFA, MINNIE).
========================================================================= */

import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, applyBrightnessContrast } from "./imageToolbar.js";
import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";

// Variable global de previsualizacion en window
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

// Estructuras de memoria directas para el listado reactivo de huecos vectoriales
window.ekkoOuters = window.ekkoOuters || new Map();
window.ekkoHolesMap = window.ekkoHolesMap || new Map();

// --- INYECCION DE ESTILOS CSS PARA EL MENU PERSONALIZADO ---\nconst dropdownStylesId = 'ekko-custom-dropdown-styles';
if (typeof document !== 'undefined' && !document.getElementById(dropdownStylesId)) {
  const styleEl = document.createElement('style');
  styleEl.id = dropdownStylesId;
  styleEl.textContent = `
    .custom-font-dropdown { position: relative; min-width: 180px; height: 34px; background: white; border: 1px solid #ccc; border-radius: 6px; user-select: none; display: inline-block; vertical-align: middle; }
    .selected-font-trigger { display: flex; align-items: center; justify-content: space-between; padding: 0 10px; height: 100%; cursor: pointer; font-size: 13px; color: #334155; font-weight: 500; }
    .font-dropdown-list { position: absolute; top: calc(100% + 4px); left: 0; right: 0; max-height: 280px; overflow-y: auto; background: white; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); z-index: 10008; }
    .font-dropdown-list.hidden { display: none; }
    .custom-font-item { padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f1f5f9; transition: background 0.15s; }
    .custom-font-item:last-child { border-bottom: none; }\n    .custom-font-item:hover, .custom-font-item.active { background: #f1f5f9; }
    .custom-font-preview { font-size: 18px; color: #0f172a; margin-bottom: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .custom-font-name { font-size: 11px; color: #777; }
  `;
  document.head.appendChild(styleEl);
}

// --- REMOVE OVERLAP TAB (EVITAR SUPERPOSICION) ---\nfunction removeOverlapTab() {
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
 * Inyecta dinamicamente las reglas de @font-face en el encabezado (head) para cada fuente devuelta,
 * asegurando la creacion de familias para los alias.
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
 * Obtiene el texto actualmente seleccionado para la previsualizacion interactiva del dropdown
 */
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

/**
 * Obtiene la familia de fuente del elemento seleccionado
 */
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

/**
 * Aplica de forma directa o curva la tipografia seleccionada conservando la estructura y el Canvas de Paper.js
 */
function applyFontFamily(item, family) {
  if (!item) return;
  const target = item.data?.clipGroup ? getContentItem(item) : item;
  if (!target) return;
  if (target instanceof paper.PointText) {
    target.fontFamily = family;
  } else if (target.data?.isCurvedGroup) {
    target.data.fontFamily = family;
    applyTextCurve(target, target.data.curvature);
  } else if (target.data?.isSpacedGroup) {
    target.data.fontFamily = family;
    applyTextSpacing(target, target.data.hspace);
  }
  paper.view.update();
}

/**
 * Genera los items de fuentes con previsualizacion dinamica dentro del dropdown personalizado
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
 * Carga las fuentes dinamicas de la API, inyecta sus @font-face y puebla el dropdown personalizado
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

/**
 * Hace que el menu contextual flotante sea arrastrable por el lienzo de edicion
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
}

/**
 * Obtiene de forma recursiva todos los elementos vectoriales finales de la escena (hijos finales),
 * disolviendo los grupos intermedios anidados y aplicando la matriz global de transformacion
 * para evitar saltos o saltos visuales indeseados.
 */
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

/**
 * Agrupa multiples elementos en un CompoundPath unico (si son vectores) o en un Grupo tradicional de Paper.js.
 */
export function groupSelectedItems() {
  const selected = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);

  if (selected.length < 2) {
    alert("Selecciona al menos 2 elementos para poder agruparlos.");
    return;
  }

  for (let item of selected) {
    if (item.data?.locked || item.data?.mockup || item.data?.isMask) {
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
    matrix = current.matrix.chain(matrix);
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

/**
 * Desagrupa un grupo tradicional o de mockup EXACTAMENTE UN NIVEL (estilo Illustrator)
 * e integra la autodeteccion y separacion automatica de CompoundPaths para que no se requieran clics extra.
 */
function ungroupGroupOneLevel(group, parent, index, isClipped, oldClipGroup) {
  const children = [...group.children];
  group.remove();

  const addedItems = [];
  children.forEach(child => {
    // Evitar procesar o desagrupar máscaras o mockups de fondo
    if (child.clipMask || child.data?.mockup || child.data?.isMask) return;

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

    // Si el elemento desagrupado es un CompoundPath, ejecutamos inmediatamente la separación jerárquica de contornos
    // para cumplir de manera instantánea el Paso de "separar contorno de huecos con el primer clic".
    if (newItem instanceof paper.CompoundPath) {
      const separated = separateContours(newItem, true);
      if (separated && separated.length > 0) {
        addedItems.push(...separated);
      } else {
        addedItems.push(newItem);
      }
    } else {
      addedItems.push(newItem);
    }
  });
  return addedItems;
}

export function ungroupSelectedItem() {
  const selected = (window.selectedItems && window.selectedItems.length > 0)
    ? [...window.selectedItems]
    : (window.selectedItem ? [window.selectedItem] : []);

  if (selected.length === 0) return;

  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }

  const finalNewItems = [];

  selected.forEach(item => {
    if (item.data?.locked || item.data?.mockup || item.data?.isMask) return;
    const isClipped = !!item.data?.clipGroup;
    const target = isClipped ? getContentItem(item) : item;
    if (!target) return;

    const activeTarget = target instanceof paper.Group ? getActiveGroupTarget(target) : target;
    const parent = item.parent || paper.project.activeLayer;
    const index = parent.children.indexOf(item);
    const newItems = [];

    // A. SI ES UN GRUPO (Mockup o SVG): Desagrupamos secuencialmente un solo nivel
    if (activeTarget instanceof paper.Group) {
      const levelItems = ungroupGroupOneLevel(activeTarget, parent, index, isClipped, isClipped ? item : null);
      newItems.push(...levelItems);
      if (isClipped && item) {
        item.clipped = false;
      }
      item.remove();
    }
    // B. SI ES TEXTO: Dividimos en PointText independientes por letras
    else if (activeTarget instanceof paper.PointText && activeTarget.content.length > 1) {
      const letters = splitPointTextIntoLetters(activeTarget);
      const textAbsMatrix = getGlobalMatrix(activeTarget);
      activeTarget.remove();

      letters.forEach(letter => {
        let newItem;
        if (isClipped) {
          newItem = window.clipItem(letter);
          newItem.matrix = item.matrix.clone();
          letter.matrix = textAbsMatrix.clone().chain(letter.matrix);
        } else {
          newItem = letter;
          newItem.matrix = textAbsMatrix.clone().chain(letter.matrix);
          parent.addChild(newItem);
        }
        newItems.push(newItem);
      });
      if (isClipped && item) {
        item.clipped = false;
      }
      item.remove();
    }
    // C. SI ES COMPOUNDPATH: Desagrupamos en contornos sólidos y huecos (Release Compound Path)
    else if (activeTarget instanceof paper.CompoundPath) {
      if (item.data?.isOuterWithHoles || activeTarget.data?.isOuterWithHoles) {
        const dissolved = dissolveOuterWithHoles(item);
        if (dissolved && dissolved.length > 0) {
          newItems.push(...dissolved);
        }
      } else {
        const separated = separateContours(item, true);
        if (separated && separated.length > 0) {
          newItems.push(...separated);
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
      // Filtrar para no auto-seleccionar los controladores de huecos invisibles (Paso 1.1)
      const outersToSelect = finalNewItems.filter(it => !it.data?.isHoleController);
      const selectList = outersToSelect.length > 0 ? outersToSelect : finalNewItems;
      
      window.selectedItems = [...selectList];
      window.selectedItem = selectList[selectList.length - 1];
      selectList.forEach(it => { if (it) it.selected = true; });
      
      if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
      if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
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
    accumX += singleLetterText.bounds.width + 2; // Margen entre letras
    letters.push(singleLetterText);
  }
  return letters;
}

/**
 * Deshace la jerarquia interactiva liberando los huecos independientes como trazados normales rellenos.
 */
export function dissolveOuterWithHoles(item) {
  if (!item || !item.data?.isOuterWithHoles) return [];
  const parent = item.parent || paper.project.activeLayer;
  const newItems = [];
  const isClipped = !!item.data?.clipGroup;

  if (typeof window.ekkoOuters !== 'undefined') {
    window.ekkoOuters.delete(item.id);
  }

  if (item.data.originalPath) {
    const targetOuter = isClipped ? getContentItem(item) : item;
    const restoredOuter = item.data.originalPath.clone({ insert: false });
    restoredOuter.fillColor = targetOuter.fillColor;
    restoredOuter.strokeColor = targetOuter.strokeColor;
    restoredOuter.strokeWidth = targetOuter.strokeWidth;

    let newOuterItem;
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
        delete newHoleItem.data.isHoleController;
        delete newHoleItem.data.outerItemId;
        delete newHoleItem.data.lastHash;
        newHoleItem.data.label = "Trazado";
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

/**
 * Motor de analisis geometrico y despiece vectorial recursivo por niveles (Arbol de Anidamiento).
 * Separa de forma interactiva el contorno principal y sus calados en controladores transparentes,
 * preservando los rellenos interiores anidados en capas mas profundas para clics sucesivos.
 */
export function separateContours(itemToProcess, skipSelection = false) {
  const item = itemToProcess || window.selectedItem;
  if (!item || item.data?.locked || item.data?.mockup || item.data?.isMask) return [];
  const isClipped = !!item.data?.clipGroup;
  const target = isClipped ? getContentItem(item) : item;
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

  // Construccion del arbol geometrico de anidamiento
  const nodes = subPaths.map(p => ({
    path: p,
    area: Math.abs(p.area) || p.bounds.area,
    center: p.bounds.center,
    parent: null,
    children: []
  }));

  // Ordenar por tamaño descendente (padres primero)
  nodes.sort((a, b) => b.area - a.area);

  // Enlace dinamico padre-hijo (el menor contenedor es el padre directo)
  for (let i = 0; i < nodes.length; i++) {
    const child = nodes[i];
    let bestParent = null;
    for (let j = 0; j < i; j++) {
      const parentCandidate = nodes[j];
      if (parentCandidate.path.bounds.contains(child.center)) {
        if (!bestParent || parentCandidate.area < bestParent.area) {
          bestParent = parentCandidate;
        }
      }
    }
    if (bestParent) {
      child.parent = bestParent;
      bestParent.children.push(child);
    }
  }

  const roots = nodes.filter(n => !n.parent);
  const outersToSelect = [];

  // Compilador recursivo para nodos HUECO (isHole = true)
  function compileHoleNode(holeNode, parentOuterItem) {
    const holeClone = holeNode.path.clone({ insert: false });
    holeClone.fillColor = new paper.Color(255, 255, 255, 0.01); // 100% transparente pero interactivo
    holeClone.strokeColor = new paper.Color(0, 0, 0, 0);

    let finalHoleItem;
    if (isClipped) {
      finalHoleItem = window.clipItem(holeClone);
      finalHoleItem.matrix = item.matrix.clone();
      holeClone.matrix = pathRelMatrix.clone().chain(holeClone.matrix);
    } else {
      finalHoleItem = holeClone;
      finalHoleItem.matrix = pathAbsMatrix.clone().chain(holeClone.matrix);
    }

    finalHoleItem.data = {
      ...(finalHoleItem.data || {}),
      isHoleController: true,
      outerItemId: parentOuterItem.id,
      lastHash: "",
      label: "Hueco"
    };

    // Si el hueco no tiene hijos solidos (ej: la "F" de AFA), se genera como calado directo
    if (holeNode.children.length === 0) {
      parent.addChild(finalHoleItem);
      parentOuterItem.data.holeIds.push(finalHoleItem.id);
      newItems.push(finalHoleItem);
      return finalHoleItem;
    }

    // Si contiene hijos (Nivel 2 Outers), compilamos un grupo interactivo (Calado Compuesto)
    const holeGroup = new paper.Group();
    holeGroup.addChild(finalHoleItem);

    holeNode.children.forEach(childOuterNode => {
      const childOuter = compileOuterNode(childOuterNode);
      if (childOuter) {
        holeGroup.addChild(childOuter);
      }
    });

    holeGroup.data = {
      isHoleGroup: true,
      isHoleController: true, // Permitir arrastre conjunto de la transparencia y lo que lleva dentro
      outerItemId: parentOuterItem.id,
      label: "Calado Compuesto"
    };

    // Sincronizacion directa del ID del path transparente para las operaciones booleanas de su padre
    parentOuterItem.data.holeIds.push(finalHoleItem.id);

    parent.addChild(holeGroup);
    newItems.push(holeGroup);
    return holeGroup;
  }

  // Compilador recursivo para nodos SOLIDOS (isHole = false)
  function compileOuterNode(outerNode) {
    const outerClone = outerNode.path.clone({ insert: false });
    outerClone.fillColor = originalFillColor || new paper.Color(255, 255, 255, 0.01);
    outerClone.strokeColor = originalStrokeColor || '#000000';
    outerClone.strokeWidth = originalStrokeWidth || 1;

    let finalOuterItem;
    if (isClipped) {
      finalOuterItem = window.clipItem(outerClone);
      finalOuterItem.matrix = item.matrix.clone();
      outerClone.matrix = pathRelMatrix.clone().chain(outerClone.matrix);
    } else {
      finalOuterItem = outerClone;
      finalOuterItem.matrix = pathAbsMatrix.clone().chain(outerClone.matrix);
    }

    finalOuterItem.data = {
      ...(finalOuterItem.data || {}),
      isOuterWithHoles: true,
      originalPath: outerNode.path.clone({ insert: false }),
      holeIds: [],
      label: item.data?.label || "Objeto"
    };

    outerClone.data = {
      ...(outerClone.data || {}),
      isOuterWithHoles: true
    };

    parent.addChild(finalOuterItem);
    newItems.push(finalOuterItem);

    // Compilar sus huecos directos (Nivel 1)
    outerNode.children.forEach(childHoleNode => {
      compileHoleNode(childHoleNode, finalOuterItem);
    });

    window.ekkoOuters.set(finalOuterItem.id, finalOuterItem);

    const updatedOuter = updateOuterPathGeometry(finalOuterItem);
    if (updatedOuter && updatedOuter !== finalOuterItem) {
      const outIdx = newItems.indexOf(finalOuterItem);
      if (outIdx !== -1) {
        newItems[outIdx] = updatedOuter;
      }
      finalOuterItem = updatedOuter;
    }

    return finalOuterItem;
  }

  // Compilar todas las raíces del arbol (Level 0 Outers)
  roots.forEach(rootNode => {
    const outerItem = compileOuterNode(rootNode);
    if (outerItem) {
      outersToSelect.push(outerItem);
    }
  });

  if (isClipped && item) {
    item.clipped = false;
  }
  item.remove();

  if (skipSelection) {
    return newItems;
  }

  if (!isClipped) {
    newItems.reverse().forEach(newItem => {
      parent.insertChild(index, newItem);
    });
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

/**
 * Recalcula en caliente la geometria final calada aplicando sustracciones booleanas
 * de todos los huecos registrados. Blindado contra caídas o rellenos accidentales mediante extracción de paths.
 */
export function updateOuterPathGeometry(outerItem) {
  if (!outerItem || !outerItem.data?.originalPath) return outerItem;
  const targetOuter = outerItem.data.clipGroup ? getContentItem(outerItem) : outerItem;
  if (!targetOuter) return outerItem;

  let resultOuter = outerItem;
  const solidGlobal = outerItem.data.originalPath.clone({ insert: false });
  const outerGlobalMatrix = getGlobalMatrix(targetOuter);
  solidGlobal.matrix = outerGlobalMatrix;
  solidGlobal.applyMatrix = true; // Bakes global coordinates

  const holeIds = outerItem.data.holeIds || [];
  let combined = solidGlobal;

  holeIds.forEach(id => {
    const hole = paper.project.getItem({ id });
    if (hole && hole.parent) {
      const targetHole = hole.data.clipGroup ? getContentItem(hole) : hole;
      if (targetHole) {
        // CORRECCION DE FUGA DE GEOMETRIA EN GRUPOS: Si el hueco es un grupo (Calado Compuesto),
        // extraemos especificamente el trazado interactivo interno transparente para evitar un fallo booleano.
        let pathToSubtract = targetHole;
        if (targetHole instanceof paper.Group) {
          const found = targetHole.children.find(c => {
            const inner = c.data?.clipGroup ? getContentItem(c) : c;
            return inner && (inner instanceof paper.Path || inner instanceof paper.CompoundPath) && inner.data?.isHoleController;
          });
          if (found) {
            pathToSubtract = found.data?.clipGroup ? getContentItem(found) : found;
          } else {
            pathToSubtract = targetHole.children.find(c => {
              const inner = c.data?.clipGroup ? getContentItem(c) : c;
              return inner && (inner instanceof paper.Path || inner instanceof paper.CompoundPath);
            });
          }
        }

        if (pathToSubtract) {
          const holeGlobalMatrix = getGlobalMatrix(pathToSubtract);
          const holeGlobal = pathToSubtract.clone({ insert: false });
          holeGlobal.matrix = holeGlobalMatrix;
          holeGlobal.applyMatrix = true;
          let temp = null;
          try {
            temp = combined.subtract(holeGlobal);
          } catch (e) {
            console.error("Fallo booleano al restar un hueco en updateOuterPathGeometry:", e);
          }
          if (temp) {
            combined.remove();
            combined = temp;
          }
          holeGlobal.remove();
        }
      }
    }
  });

  const localCombined = combined.clone({ insert: false });
  if (!outerGlobalMatrix.isIdentity()) {
    try {
      localCombined.matrix = outerGlobalMatrix.inverted();
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

  if (combined) combined.remove();
  if (localCombined) localCombined.remove();
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
          
          let pathToInspect = targetHole;
          if (targetHole instanceof paper.Group) {
            const found = targetHole.children.find(c => {
              const inner = c.data?.clipGroup ? getContentItem(c) : c;
              return inner && inner.data?.isHoleController;
            });
            if (found) pathToInspect = found.data?.clipGroup ? getContentItem(found) : found;
          }

          if (pathToInspect) {
            const currentHash = `${pathToInspect.position.x.toFixed(1)},${pathToInspect.position.y.toFixed(1)},${pathToInspect.rotation}`;
            if (hole.data.lastHash !== currentHash) {
              hole.data.lastHash = currentHash;
              needsUpdate = true;
            }
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

// Monkey-patch dynamically the selection tool of selection.js to prevent product selection box and mockup click bugs!
if (typeof window !== 'undefined' && typeof paper !== 'undefined') {
  const patchSelectionTool = () => {
    if (!paper.project || !paper.tools || paper.tools.length === 0) {
      setTimeout(patchSelectionTool, 150);
      return;
    }
    const selectTool = paper.tools.find(t => t.onMouseDrag && t.onMouseDown && !t.data?.ekkoSelectionPatched);
    if (!selectTool) {
      setTimeout(patchSelectionTool, 150);
      return;
    }

    const originalOnMouseDown = selectTool.onMouseDown;
    const originalOnMouseMove = selectTool.onMouseMove;

    selectTool.onMouseDown = function(event) {
      // Intercept mousedown to check if we are clicking on empty bounds of a clipGroup (mockup area)
      const hitResult = paper.project.hitTest(event.point, {
        fill: true,
        stroke: true,
        segments: true,
        bounds: true,
        tolerance: 8 / paper.view.zoom,
        match: function(hit) {
          if (hit.item.clipMask) return false;
          if (hit.item.data && (hit.item.data.isSelectionBox || hit.item.data.isHandle || hit.item.data.isNodeHandle)) return false;
          
          let curr = hit.item;
          while (curr) {
            if (curr.data && (curr.data.mockup || curr.data.isMask)) return false;
            if (curr === window.currentMockup) return false;
            curr = curr.parent;
          }
          return true;
        }
      });

      if (hitResult && hitResult.type === 'bounds') {
        const selectable = window.getSelectableItem ? window.getSelectableItem(hitResult.item) : hitResult.item;
        if (selectable && selectable.data?.clipGroup) {
          const content = getContentItem(selectable);
          if (content) {
            const contentHit = content.hitTest(event.point, {
              fill: true,
              stroke: true,
              segments: true,
              tolerance: 8 / paper.view.zoom
            });
            if (!contentHit) {
              window.deselectItem();
              return; // Ignore completely! No product box will appear.
            }
          }
        }
      }

      originalOnMouseDown.call(this, event);
    };

    selectTool.onMouseMove = function(event) {
      const hitResult = paper.project.hitTest(event.point, {
        fill: true,
        stroke: true,
        segments: true,
        bounds: true,
        tolerance: 8 / paper.view.zoom,
        match: function(hit) {
          if (hit.item.clipMask) return false;
          if (hit.item.data && (hit.item.data.isSelectionBox || hit.item.data.isHandle || hit.item.data.isNodeHandle)) return false;
          
          let curr = hit.item;
          while (curr) {
            if (curr.data && (curr.data.mockup || curr.data.isMask)) return false;
            if (curr === window.currentMockup) return false;
            curr = curr.parent;
          }
          return true;
        }
      });

      if (hitResult && hitResult.type === 'bounds') {
        const selectable = window.getSelectableItem ? window.getSelectableItem(hitResult.item) : hitResult.item;
        if (selectable && selectable.data?.clipGroup) {
          const content = getContentItem(selectable);
          if (content) {
            const contentHit = content.hitTest(event.point, {
              fill: true,
              stroke: true,
              segments: true,
              tolerance: 8 / paper.view.zoom
            });
            if (!contentHit) {
              const canvas = document.getElementById("editorCanvas");
              if (canvas) canvas.style.cursor = 'default';
              return; // Ignore and leave cursor as default
            }
          }
        }
      }

      originalOnMouseMove.call(this, event);
    };

    selectTool.data = selectTool.data || {};
    selectTool.data.ekkoSelectionPatched = true;
    console.log("🚀 Parche de seguridad para selección de clipGroups acoplado con éxito.");
  };

  // Run automatically
  setTimeout(patchSelectionTool, 1000);
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
      const displayItem = (it.data && it.data.clipGroup)
        ? getContentItem(it)
        : it;
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
        const displayItem = (it.data && it.data.clipGroup)
          ? getContentItem(it)
          : it;
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
    if (typeof window.bindRotationInputEvents === "function") {
      window.bindRotationInputEvents();
    }
    if (typeof window.syncContextualRotationInput === "function") {
      window.syncContextualRotationInput(primaryItem);
    }
  };

  try {
    Object.defineProperty(window, 'updateSelectionBox', {
      get: function() { return customUpdateSelectionBox; },
      set: function() {},\n      configurable: true,
      enumerable: true
    });
  } catch(e) {
    window.updateSelectionBox = customUpdateSelectionBox;
  }
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
  window.dissolveOuterWithHoles = dissolveOuterWithHoles;
}

export function updateContextualMenu(item) {
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
  const btnGroup = document.getElementById('btnCtxGroup') || document.getElementById('btnCtxAgrupar');
  const btnUngroup = document.getElementById('btnCtxUngroup') || document.getElementById('btnCtxDesagrupar');
  const btnEditNodes = document.getElementById('btnCtxEditNodes') || document.getElementById('btnCtxNodeEdit');

  if (btnGroup) btnGroup.classList.add('hidden');
  if (btnUngroup) btnUngroup.classList.add('hidden');
  if (btnEditNodes) btnEditNodes.classList.add('hidden');

  if (selectedCount > 1) {
    if (btnGroup) btnGroup.classList.remove('hidden');
    const canUngroupAll = window.selectedItems.every(it => {
      const targetObj = it.data?.clipGroup ? getContentItem(it) : it;
      return targetObj && (targetObj instanceof paper.Group || targetObj instanceof paper.CompoundPath);
    });
    if (canUngroupAll && btnUngroup) btnUngroup.classList.remove('hidden');
    return;
  }

  const target = item.data?.clipGroup ? getContentItem(item) : item;
  if (!target) return;

  if (btnUngroup) {
    const canUngroup = (
      target instanceof paper.Group ||
      target instanceof paper.CompoundPath ||
      (target instanceof paper.PointText && target.content.length > 1)
    );
    if (canUngroup) btnUngroup.classList.remove('hidden');
  }

  if (target instanceof paper.PointText) {
    const textControls = document.getElementById('ctxTextControls');
    if (textControls) textControls.classList.remove('hidden');
    
    const currentFamily = getSelectedFontFamily();
    const matchingFont = fontsCache.find(f => f.family === currentFamily);
    const fontDisplayName = matchingFont ? matchingFont.name : currentFamily;
    const triggerText = document.querySelector('.selected-font-trigger span');
    if (triggerText) {
      triggerText.textContent = fontDisplayName;
    }
  } else if (target instanceof paper.Raster) {
    const imageControls = document.getElementById('ctxImageControls');
    if (imageControls) imageControls.classList.remove('hidden');
    if (btnTrace) btnTrace.style.display = 'inline-block';
  } else if (target instanceof paper.Path || target instanceof paper.CompoundPath) {
    const vectorControls = document.getElementById('ctxVectorControls');
    if (vectorControls) vectorControls.classList.remove('hidden');
    if (btnEditNodes) btnEditNodes.classList.remove('hidden');
  }

  if (toolbarDragged && window.customToolbarLeft && window.customToolbarTop) {
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

      const displayItem = item.data?.clipGroup ? getContentItem(item) : item;
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
      const y = rect.top + window.scrollY + viewPos.y - toolbarHeight - 25;
      
      if (!toolbarDragged) {
        toolbar.style.left = Math.max(10, Math.min(x, window.innerWidth - toolbarWidth - 10)) + "px";
        toolbar.style.top = Math.max(10, y) + "px";
      }
    }
    toolbar.style.zIndex = "2147483646";
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
    }
  }
};

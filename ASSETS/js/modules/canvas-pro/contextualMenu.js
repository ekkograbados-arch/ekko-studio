/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js (2-Level Ungroup & Node Editor Integration)
Ruta de reemplazo: ASSETS/js/modules/canvas-pro/contextualMenu.js
========================================================================= */

import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, applyBrightnessContrast } from "./imageToolbar.js";
import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";

window.originalFontBackup = null;
let fontsCache = [];
let toolbarDragged = false;
let lastSelectedItem = null;

// Registro global de outers activos para la resta geométrica reactiva en arrastre
window.ekkoOuters = new Map();

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
  const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
  if (!target) return "EKKO Studio";
  if (target instanceof paper.PointText) {
    return target.content || "EKKO Studio";
  }
  return "EKKO Studio";
}

function getSelectedFontFamily() {
  if (!window.selectedItem) return "Arial";
  const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
  if (!target) return "Arial";
  if (target instanceof paper.PointText) {
    return target.fontFamily || "Arial";
  }
  return "Arial";
}

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
    console.error("Error al cargar las tipografías dinámicas:", err);
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
}

function makeToolbarDraggable() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;
  toolbar.addEventListener('mouseover', (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.custom-font-dropdown')) {
      toolbar.style.cursor = 'default';
    } else {
      toolbar.style.cursor = 'move';
    }
  });
  let isDraggingToolbar = false;
  let startX = 0, startY = 0;
  toolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('button') || e.target.closest('input') || e.target.closest('.custom-font-dropdown')) {
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
 * disolviendo los grupos intermedios anidados y eliminando el "Efecto Cebolla" de un solo golpe.
 */
function getLeafItemsRecursive(item) {
  const leaves = [];
  const recurse = (node) => {
    if (node instanceof paper.Group && !node.data?.clipGroup) {
      // Es un contenedor de grupo normal, buceamos en sus hijos
      node.children.forEach(recurse);
    } else {
      leaves.push(node);
    }
  };
  recurse(item);
  return leaves;
}

/**
 * Agrupa múltiples elementos en un CompoundPath único (si son vectores) o en un Grupo tradicional de Paper.js.
 * Si se incluye un controlador de hueco y su Outer, los refunde nativamente para corte láser.
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
    const originalPath = outerItem.data.originalPath;
    const holeIds = outerItem.data.holeIds || [];
    
    // Obtener controladores de hueco asociados que también están seleccionados
    const associatedHoles = holeIds
      .map(id => paper.project.getItem({ id }))
      .filter(h => h && selected.includes(h) && h.parent);

    // Destruir los controladores y eliminarlos de la selección
    associatedHoles.forEach(h => {
      const idx = selected.indexOf(h);
      if (idx > -1) selected.splice(idx, 1);
      h.remove();
    });

    const idxOuter = selected.indexOf(outerItem);
    if (idxOuter > -1) selected.splice(idxOuter, 1);

    // Reconstruir como CompoundPath nativo refundido para LightBurn
    const targetOuter = outerItem.data.clipGroup ? outerItem.children.find(c => !c.clipMask) : outerItem;
    const rebuiltPath = targetOuter.clone({ insert: false });
    
    outerItem.remove();
    window.ekkoOuters.delete(outerItem.id);
    contents.push(rebuiltPath);
  });

  // Extraer los contenidos del resto de elementos seleccionados
  selected.forEach(item => {
    let content;
    if (item.data?.clipGroup) {
      content = item.children.find(c => !c.clipMask);
      if (content) content.remove();
    } else {
      content = item;
      content.remove();
    }
    if (content) contents.push(content);
    item.remove();
  });

  // Crear el nuevo grupo limpio
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
 * Desagrupa el elemento seleccionado de forma profunda y limpia (0% Onion Effect),
 * separando caracteres de texto o grupos vectoriales en un solo clic.
 */
export function ungroupSelectedItem() {
  const item = window.selectedItem;
  if (!item || item.data?.locked || item.data?.mockup) return;

  const isClipped = !!item.data?.clipGroup;
  const target = isClipped ? item.children.find(c => !c.clipMask) : item;
  if (!target) return;

  if (typeof window.saveHistory === 'function') {
    window.saveHistory();
  }

  const parent = item.parent || paper.project.activeLayer;
  const index = parent.children.indexOf(item);
  const newItems = [];

  // 1. SI ES UN GRUPO: Desagrupamos de forma recursiva y profunda al instante (0% Onion Effect)
  if (target instanceof paper.Group) {
    const leaves = getLeafItemsRecursive(target);
    
    leaves.forEach(leaf => {
      leaf.remove();
      
      // Si un elemento de texto nativo se desagrupa, lo dividimos en letras independientes PointText
      if (leaf instanceof paper.PointText && leaf.content.length > 1) {
        const letters = splitPointTextIntoLetters(leaf);
        letters.forEach(letter => {
          let clippedLetter = isClipped ? window.clipItem(letter) : letter;
          if (!isClipped) parent.addChild(clippedLetter);
          newItems.push(clippedLetter);
        });
      } else {
        let newItem = isClipped ? window.clipItem(leaf) : leaf;
        if (!isClipped) parent.addChild(newItem);
        newItems.push(newItem);
      }
    });

    item.remove();
  }
  // 2. SI ES UN TRAZADO COMPUESTO (CompoundPath con letras o múltiples formas):
  // Lo dividimos en contornos exteriores y sus correspondientes huecos interactivos y transparentes
  else if (target instanceof paper.CompoundPath) {
    const subPaths = [...target.children];
    if (subPaths.length === 0) return;

    const outers = [];
    const holesMap = new Map();

    subPaths.forEach(p => {
      let container = null;
      subPaths.forEach(other => {
        if (other !== p && other.bounds.contains(p.bounds)) {
          if (!container || Math.abs(other.area) < Math.abs(container.area)) {
            container = other;
          }
        }
      });

      if (container) {
        if (!holesMap.has(container)) holesMap.set(container, []);
        holesMap.get(container).push(p);
      } else {
        outers.push(p);
        if (!holesMap.has(p)) holesMap.set(p, []);
      }
    });

    const originalFillColor = target.fillColor;

    // A. Si tiene un único Outer, significa que ya está al nivel más básico de letra/corazón con hueco.
    // Lo desagrupamos separando sus huecos/contornos interactivos independientes (Opción B).
    if (outers.length === 1) {
      outers.forEach(outerPath => {
        // 1. Creamos el elemento contenedor exterior sólido principal
        const outerClone = outerPath.clone();
        outerClone.fillColor = originalFillColor;

        let newOuterItem = isClipped ? window.clipItem(outerClone) : outerClone;
        if (!isClipped) parent.addChild(newOuterItem);
        
        newOuterItem.data = {
          ...(newOuterItem.data || {}),
          isOuterWithHoles: true,
          originalPath: outerPath.clone({ insert: false }),
          holeIds: [],
          label: item.data?.label || "Objeto"
        };
        newItems.push(newOuterItem);

        // 2. Creamos cada hueco como un objeto independiente interactivo y 100% transparente en reposo
        const associatedHoles = holesMap.get(outerPath) || [];
        associatedHoles.forEach(holePath => {
          const holeClone = holePath.clone();
          
          // Estilo Invisible en Reposo pero interactivo al 1% de opacidad de relleno
          holeClone.fillColor = new paper.Color(255, 255, 255, 0.01);
          holeClone.strokeColor = new paper.Color(0,0,0,0); // Sin línea visible de bordes de colores molestos

          let newHoleItem = isClipped ? window.clipItem(holeClone) : holeClone;
          if (!isClipped) parent.addChild(newHoleItem);

          newHoleItem.data = {
            ...(newHoleItem.data || {}),
            isHoleController: true,
            outerItemId: newOuterItem.id,
            lastHash: "",
            label: "Hueco"
          };

          newOuterItem.data.holeIds.push(newHoleItem.id);
          newItems.push(newHoleItem);
        });

        // Registrar en el listado reactivo
        window.ekkoOuters.set(newOuterItem.id, newOuterItem);
        updateOuterPathGeometry(newOuterItem);
      });

      item.remove();
    }
    // B. Si tiene múltiples Outers (ej: las letras curves "T", "E", "A", "M", "O" en un solo trazado compuesto), las separamos.
    else {
      outers.forEach(outerPath => {
        const outerClone = outerPath.clone({ insert: false });
        const associatedHoles = holesMap.get(outerPath) || [];
        
        let resultingItem;
        if (associatedHoles.length > 0) {
          // Creamos un CompoundPath para esta letra específica conservando sus huecos
          const childrenList = [outerClone, ...associatedHoles.map(h => h.clone({ insert: false }))];
          const letterCompound = new paper.CompoundPath({ children: childrenList, fillColor: originalFillColor });
          resultingItem = isClipped ? window.clipItem(letterCompound) : letterCompound;
        } else {
          // Letra sólida sin hueco
          outerClone.fillColor = originalFillColor;
          resultingItem = isClipped ? window.clipItem(outerClone) : outerClone;
        }

        if (!isClipped) parent.addChild(resultingItem);
        newItems.push(resultingItem);
      });

      item.remove();
    }
  }

  // Reinsertar ordenadamente en la escena y aplicar selección múltiple
  newItems.reverse().forEach(newItem => {
    if (newItem.parent) {
      newItem.parent.insertChild(index, newItem);
    } else {
      parent.insertChild(index, newItem);
    }
  });

  window.deselectItem();

  // Retardo controlado de 50ms para evitar carreras en la destrucción de los botones del menú flotante
  setTimeout(() => {
    if (newItems.length > 0) {
      window.selectedItems = [...newItems];
      window.selectedItem = newItems[newItems.length - 1];
      newItems.forEach(it => { if (it) it.selected = true; });
      
      if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
      if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
    }
    paper.view.update();
  }, 50);
}

/**
 * Divide una palabra de un PointText nativo en letras independientes que siguen siendo editables por teclado
 */
function splitPointTextIntoLetters(pointText) {
  const letters = [];
  const text = pointText.content;
  const startPoint = pointText.point;
  
  // Calcular anchos aproximados de caracteres para posicionar las nuevas letras
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
 * Separa los contornos y huecos de un trazado compuesto de forma independiente (Nivel 2 - Opción B).
 * Los huecos se vuelven 100% transparentes e invisibles, pero interactivos y arrastrables.
 */


/**
 * Realiza la resta booleana únicamente cuando el cliente arrastra o deforma activamente el hueco fucsia (Optimizacion 0% CPU)
 */
export function updateOuterPathGeometry(outerItem) {
  if (!outerItem || !outerItem.data?.originalPath) return;

  const targetOuter = outerItem.data.clipGroup ? outerItem.children.find(c => !c.clipMask) : outerItem;
  if (!targetOuter) return;

  let combined = outerItem.data.originalPath.clone({ insert: false });
  const holeIds = outerItem.data.holeIds || [];

  holeIds.forEach(id => {
    const hole = paper.project.getItem({ id });
    if (hole && hole.parent) {
      const targetHole = hole.data.clipGroup ? hole.children.find(c => !c.clipMask) : hole;
      if (targetHole) {
        const temp = combined.subtract(targetHole);
        combined.remove();
        combined = temp;
      }
    }
  });

  // Reemplazo limpio de geometría
  const parent = targetOuter.parent;
  if (parent && combined) {
    const idx = parent.children.indexOf(targetOuter);
    if (idx !== -1) {
      const newPath = combined.clone({ insert: false });
      newPath.fillColor = targetOuter.fillColor;
      newPath.data = { ...(targetOuter.data || {}) };

      parent.insertChild(idx, newPath);

      if (targetOuter === outerItem) {
        if (window.selectedItem === outerItem) window.selectedItem = newPath;
        if (window.selectedItems) {
          const sIdx = window.selectedItems.indexOf(outerItem);
          if (sIdx !== -1) window.selectedItems[sIdx] = newPath;
        }
      }
      targetOuter.remove();
    }
  }
  if (combined) combined.remove();
  paper.view.update();
}

// 🚀 ESCUCHADOR INTELIGENTE DE MOVIMIENTO EN LIENZO (0% CPU en reposo / zoom)
if (typeof document !== 'undefined') {
  document.addEventListener('mousemove', () => {
    if (window.ekkoOuters && window.ekkoOuters.size > 0) {
      window.ekkoOuters.forEach(outerItem => {
        let needsUpdate = false;
        const validHoleIds = [];
        const holeIds = outerItem.data?.holeIds || [];

        holeIds.forEach(id => {
          const hole = paper.project.getItem({ id });
          if (hole && hole.parent) {
            validHoleIds.push(id);
            const currentHash = `${hole.position.x.toFixed(1)},${hole.position.y.toFixed(1)},${hole.bounds.width.toFixed(1)},${hole.rotation}`;
            if (hole.data.lastHash !== currentHash) {
              hole.data.lastHash = currentHash;
              needsUpdate = true; // Solo ejecuta la resta si la posición del hueco cambia
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
    }
  });
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
    if (window.selectedItem) duplicateImage(window.selectedItem);
  });
  setClick('btnCtxForward', () => {
    if (window.selectedItem) bringImageForward(window.selectedItem);
  });
  setClick('btnCtxBackward', () => {
    if (window.selectedItem) sendImageBackward(window.selectedItem);
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

  // --- 3. ACCIONES DE ORGANIZACIÓN (VECTORES / SVGS) ---
  setClick('btnCtxGroup', () => groupSelectedItems());
  setClick('btnCtxAgrupar', () => groupSelectedItems());
  setClick('btnCtxUngroup', () => ungroupSelectedItem());
  setClick('btnCtxDesagrupar', () => ungroupSelectedItem());
  
  // Botones especiales de la segunda capa
  setClick('btnCtxEditNodes', () => {
    if (window.selectedItem) enterNodeEditMode(window.selectedItem);
  });

  // --- 4. SHORTCUTS DE TECLADO ---
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
  window.separateContours = ungroupSelectedItem;
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

  const selectedCount = window.selectedItems ? window.selectedItems.length : 0;

  if (selectedCount > 1) {
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
    const target = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (!target) return;

    if (target instanceof paper.PointText) {
      const textControls = document.getElementById('ctxTextControls');
      if (textControls) textControls.classList.remove('hidden');
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
          btnUngroup.classList.remove('hidden');
          btnUngroup.style.display = '';
          
          // Cambiar dinámicamente la etiqueta si es un trazado compuesto para que el cliente entienda que puede separar contornos
          btnUngroup.textContent = "Desagrupar";
          btnUngroup.title = "Desagrupar grupo de objetos o separar contornos";
        }
      }
    }
  }

  // Reposicionador
  if (window.customToolbarLeft !== undefined && window.customToolbarTop !== undefined) {
    toolbar.style.left = window.customToolbarLeft + 'px';
    toolbar.style.top = window.customToolbarTop + 'px';
  } else {
    const bounds = item.bounds;
    if (!bounds) return;
    const canvasEl = document.getElementById('editorCanvas');
    if (canvasEl && window.paper && paper.view) {
      const canvasRect = canvasEl.getBoundingClientRect();
      const viewPos = paper.view.projectToView(bounds.topCenter);
      const x = canvasRect.left + window.scrollX + viewPos.x - (toolbar.offsetWidth / 2);
      const y = canvasRect.top + window.scrollY + viewPos.y - toolbar.offsetHeight - 25;
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

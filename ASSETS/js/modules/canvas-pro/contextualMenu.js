/* =========================================================================
   Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js (DOM-Safe WYSIWYG Edition)
   Ruta de reemplazo: ASSETS/js/modules/canvas-pro/contextualMenu.js
   Descripción: Barra de herramientas flotante de contexto. Soporta barra arrastrable,
   desplegable de fuentes personalizado basado en div con previsualización del texto dinámico
   en tiempo real, e inyección dinámica de familias de fuentes.
   SOPORTE COMPLETO DE AGRUPACIÓN Y DESAGRUPACIÓN EN LÍNEA PARA CLIENTES Y SVGS CARGADOS.
   ========================================================================= */

import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, applyBrightnessContrast } from "./imageToolbar.js";
import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";

// Variable global de previsualización en window
window.originalFontBackup = null;
let fontsCache = [];
let toolbarDragged = false;
let lastSelectedItem = null;

// Estructuras de memoria directas para el listado reactivo de huecos vectoriales
window.ekkoOuters = window.ekkoOuters || new Map();
window.ekkoHolesMap = window.ekkoHolesMap || new Map();

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
}

/**
 * Obtiene de forma recursiva todos los elementos vectoriales finales de la escena (hijos finales),
 * disolviendo los grupos intermedios anizados y aplicando la matriz global de transformación
 * para evitar saltos o saltos visuales indeseados (Cero Onion Effect).
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
 * Desagrupa el elemento seleccionado de forma jerárquica, limpia y progresiva (de más a menos),
 * separando caracteres de texto, contornos o grupos de forma ordenada.
 */

/**
 * Desagrupa el elemento seleccionado de forma jerárquica, limpia y progresiva (de más a menos),
 * separando caracteres de texto, contornos o grupos de forma ordenada.
 */

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

export function ungroupSelectedItem() {
    const item = window.selectedItem;
    if (!item || item.data?.locked || item.data?.mockup) return;
    const isClipped = !!item.data?.clipGroup;
    const target = isClipped ? item.children.find(c => !c.clipMask) : item;
    if (!target) return;
    
    // Si es un grupo con envolturas de un solo hijo, lo resolvemos al grupo real con contenido
    const activeTarget = target instanceof paper.Group ? getActiveGroupTarget(target) : target;
    
    if (typeof window.saveHistory === 'function') {
        window.saveHistory();
    }
    const parent = item.parent || paper.project.activeLayer;
    const index = parent.children.indexOf(item);
    const newItems = [];
    const targetMatrix = item.matrix ? item.matrix.clone() : null;

    // A. SI ES UN GRUPO: Desagrupamos de forma jerárquica (UN nivel a la vez, de más a menos)
    if (activeTarget instanceof paper.Group) {
        const children = [...activeTarget.children];
        children.forEach(child => {
            child.remove();
            
            let newItem;
            if (isClipped) {
                // Crear el clipGroup con el hijo en su estado local original
                newItem = window.clipItem(child);
                // Aplicar la matriz de transformación heredada del padre directamente al clipGroup
                if (targetMatrix) {
                    newItem.matrix = targetMatrix.clone().chain(newItem.matrix);
                }
            } else {
                newItem = child;
                if (targetMatrix) {
                    newItem.matrix = targetMatrix.clone().chain(newItem.matrix);
                }
                parent.addChild(newItem);
            }
            newItems.push(newItem);
        });
        item.remove();
    }

    // B. SI ES UN TEXTO: Lo dividimos en letras independientes PointText
    else if (activeTarget instanceof paper.PointText && activeTarget.content.length > 1) {
        const letters = splitPointTextIntoLetters(activeTarget);
        letters.forEach(letter => {
            let newItem;
            if (isClipped) {
                newItem = window.clipItem(letter);
                if (targetMatrix) {
                    newItem.matrix = targetMatrix.clone().chain(newItem.matrix);
                }
            } else {
                newItem = letter;
                if (targetMatrix) {
                    newItem.matrix = targetMatrix.clone().chain(newItem.matrix);
                }
                parent.addChild(newItem);
            }
            newItems.push(newItem);
        });
        item.remove();
    }

    // C. SI ES UN TRAZADO COMPUESTO (CompoundPath con letras o múltiples formas):
    // Lo dividimos en sus letras/islas independientes de forma progresiva sin rellenarlas de negro.
    else if (activeTarget instanceof paper.CompoundPath) {
        const subPaths = [...activeTarget.children];
        if (subPaths.length === 0) return;
        const outers = [];
        const holesMap = new Map();
        subPaths.forEach(p => {
            let container = null;
            subPaths.forEach(other => {
                if (other !== p) {
                    const otherArea = Math.abs(other.area) || other.bounds.area;
                    const pArea = Math.abs(p.area) || p.bounds.area;
                    if (otherArea > pArea && other.bounds.contains(p.bounds.center)) {
                        if (!container || otherArea < (Math.abs(container.area) || container.bounds.area)) {
                            container = other;
                        }
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
        const originalFill = activeTarget.fillColor;

        // Si tiene un único Outer (ej: la silueta de un bebé o una sola letra con hueco),
        // al presionar desagrupar de nuevo, ejecutamos la separación de huecos y contornos de forma transparente.
        if (outers.length === 1) {
            separateContours();
            return;
        }

        // Si tiene múltiples Outers (ej: las letras "SOFIA" en un trazado compuesto), las separamos como CompoundPaths individuales
        outers.forEach(outerPath => {
            const outerClone = outerPath.clone({ insert: false });
            const associatedHoles = holesMap.get(outerPath) || [];
            let letterItem;
            if (associatedHoles.length > 0) {
                // Conservamos la letra con su hueco perfectamente calado y transparente
                const childrenList = [outerClone, ...associatedHoles.map(h => h.clone({ insert: false }))];
                letterItem = new paper.CompoundPath({ children: childrenList, fillColor: originalFill });
            } else {
                // Letra sólida
                outerClone.fillColor = originalFill;
                letterItem = outerClone;
            }

            let newItem;
            if (isClipped) {
                newItem = window.clipItem(letterItem);
                if (targetMatrix) {
                    newItem.matrix = targetMatrix.clone().chain(newItem.matrix);
                }
            } else {
                newItem = letterItem;
                if (targetMatrix) {
                    newItem.matrix = targetMatrix.clone().chain(newItem.matrix);
                }
                parent.addChild(newItem);
            }
            newItems.push(newItem);
        });
        item.remove();
    }

    // Reinsertar de forma atómica en el parent original respetando la capa y el índice exacto
    newItems.reverse().forEach(newItem => {
        parent.insertChild(index, newItem);
    });
    window.deselectItem();

    // Retardo controlado de 50ms para evitar carreras de renderizado en el menú flotante
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
export function separateContours() {
    const item = window.selectedItem;
    if (!item || item.data?.locked || item.data?.mockup) return;
    const isClipped = !!item.data?.clipGroup;
    const target = isClipped ? item.children.find(c => !c.clipMask) : item;
    if (!target || !(target instanceof paper.CompoundPath)) return;
    if (typeof window.saveHistory === 'function') {
        window.saveHistory();
    }
    const parent = item.parent || paper.project.activeLayer;
    const index = parent.children.indexOf(item);
    const newItems = [];
    const subPaths = [...target.children];
    const outers = [];
    const holesMap = new Map();
    subPaths.forEach(p => {
        let container = null;
        subPaths.forEach(other => {
            if (other !== p) {
                const otherArea = Math.abs(other.area) || other.bounds.area;
                const pArea = Math.abs(p.area) || p.bounds.area;
                if (otherArea > pArea && other.bounds.contains(p.bounds.center)) {
                    if (!container || otherArea < (Math.abs(container.area) || container.bounds.area)) {
                        container = other;
                    }
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
    const targetMatrix = item.matrix ? item.matrix.clone() : null;

    outers.forEach(outerPath => {
        // 1. Creamos el elemento contenedor exterior sólido principal
        const outerClone = outerPath.clone({ insert: false });
        outerClone.fillColor = originalFillColor;

        let newOuterItem;
        if (isClipped) {
            newOuterItem = window.clipItem(outerClone);
            if (targetMatrix) {
                newOuterItem.matrix = targetMatrix.clone().chain(newOuterItem.matrix);
            }
        } else {
            newOuterItem = outerClone;
            if (targetMatrix) {
                newOuterItem.matrix = targetMatrix.clone().chain(newOuterItem.matrix);
            }
            parent.addChild(newOuterItem);
        }

        newOuterItem.data = {
            ...(newOuterItem.data || {}),
            isOuterWithHoles: true,
            originalPath: outerPath.clone({ insert: false }), // Guardar trazado original en coordenadas locales del CompoundPath
            holeIds: [],
            label: item.data?.label || "Objeto"
        };
        newItems.push(newOuterItem);

        // 2. Creamos cada hueco como un objeto independiente interactivo y 100% transparente en reposo
        const associatedHoles = holesMap.get(outerPath) || [];
        associatedHoles.forEach(holePath => {
            const holeClone = holePath.clone({ insert: false });
            // Estilo Invisible en Reposo pero interactivo al 1% de opacidad de relleno
            holeClone.fillColor = new paper.Color(255, 255, 255, 0.01);
            holeClone.strokeColor = new paper.Color(0,0,0,0); // Sin línea visible de bordes de colores molestos

            let newHoleItem;
            if (isClipped) {
                newHoleItem = window.clipItem(holeClone);
                if (targetMatrix) {
                    newHoleItem.matrix = targetMatrix.clone().chain(newHoleItem.matrix);
                }
            } else {
                newHoleItem = holeClone;
                if (targetMatrix) {
                    newHoleItem.matrix = targetMatrix.clone().chain(newHoleItem.matrix);
                }
                parent.addChild(newHoleItem);
            }

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

    newItems.reverse().forEach(newItem => {
        parent.insertChild(index, newItem);
    });
    window.deselectItem();

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

export function updateOuterPathGeometry(outerItem) {
    if (!outerItem || !outerItem.data?.originalPath) return;
    const targetOuter = outerItem.data.clipGroup ? outerItem.children.find(c => !c.clipMask) : outerItem;
    if (!targetOuter) return;

    // 1. Obtener la geometría exterior sólida limpia en coordenadas globales con transformaciones horneadas físicamente
    const solidGlobal = outerItem.data.originalPath.clone({ insert: false });
    if (outerItem.matrix) {
        solidGlobal.transform(outerItem.matrix);
    }

    const holeIds = outerItem.data.holeIds || [];
    let combined = solidGlobal;

    // 2. Restar cada hueco interactivo en coordenadas globales alineadas horneadas
    holeIds.forEach(id => {
        const hole = paper.project.getItem({ id });
        if (hole && hole.parent) {
            const targetHole = hole.data.clipGroup ? hole.children.find(c => !c.clipMask) : hole;
            if (targetHole) {
                const holeGlobal = targetHole.clone({ insert: false });
                if (hole.matrix) {
                    holeGlobal.transform(hole.matrix);
                }

                const temp = combined.subtract(holeGlobal);
                combined.remove();
                holeGlobal.remove();
                combined = temp;
            }
        }
    });

    // 3. Transformar el resultado de vuelta al espacio de coordenadas local de targetOuter para conservar la editabilidad
    const localCombined = combined.clone({ insert: false });
    if (outerItem.matrix && !outerItem.matrix.isIdentity()) {
        try {
            localCombined.transform(outerItem.matrix.inverted());
        } catch (err) {
            console.warn("Fallo no crítico al invertir la matriz en updateOuterPathGeometry:", err);
        }
    }

    // 4. Reemplazar de forma atómica y limpia el trazado en el lienzo
    const parent = targetOuter.parent;
    if (parent && localCombined) {
        const idx = parent.children.indexOf(targetOuter);
        if (idx !== -1) {
            const newPath = localCombined.clone({ insert: false });
            newPath.fillColor = targetOuter.fillColor;
            newPath.strokeColor = targetOuter.strokeColor;
            newPath.strokeWidth = targetOuter.strokeWidth;
            newPath.matrix = targetOuter.matrix.clone(); // Heredar matriz (generalmente identidad)
            newPath.data = { ...(targetOuter.data || {}) };

            parent.insertChild(idx, newPath);

            if (targetOuter === outerItem) {
                if (window.selectedItem === outerItem) {
                    window.selectedItem = newPath;
                }
                if (window.selectedItems) {
                    const sIdx = window.selectedItems.indexOf(outerItem);
                    if (sIdx !== -1) window.selectedItems[sIdx] = newPath;
                }

                // Sincronizar listados de referencia
                window.ekkoOuters.delete(outerItem.id);
                window.ekkoOuters.set(newPath.id, newPath);
                holeIds.forEach(id => {
                    const hole = paper.project.getItem({ id });
                    if (hole && hole.data) hole.data.outerItemId = newPath.id;
                });
            }
            targetOuter.remove();
        }
    }

    if (combined) combined.remove();
    if (localCombined) localCombined.remove();
    paper.view.update();
}

// 🚀 RECEPTOR DE MARCO DE PAPER.JS PARA EVENTO TICK (Reactivo al arrastre, 0% CPU en reposo)
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
                    const currentHash = `${hole.position.x.toFixed(1)},${hole.position.y.toFixed(1)},${hole.bounds.height.toFixed(1)},${hole.rotation}`;
                    if (hole.data.lastHash !== currentHash) {
                        hole.data.lastHash = currentHash;
                        needsUpdate = true;
                    }
                } else {
                    needsUpdate = true; // El hueco fue eliminado, requiere rellenar la silueta
                }
            });
            if (needsUpdate) {
                outerItem.data.holeIds = validHoleIds;
                updateOuterPathGeometry(outerItem);
            }
        });
    });
}

// --- RENDEREADOR DE CAJA DE SELECCIÓN MULTIPLE CON CONTORNOS CELESTES INDEPENDIENTES (ESTILO FIGMA/CANVA/ILLUSTRATOR) ---
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
                ? it.children.find(function(c) { return !c.clipMask; })
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
        
        // 1. Dibujar contornos celestes discontinuos independientes alrededor de cada pieza individual (Para ver los 4 cuadrados de los 4 elementos)
        if (selected.length > 1) {
            selected.forEach(function(it) {
                const displayItem = (it.data && it.data.clipGroup)
                    ? it.children.find(function(c) { return !c.clipMask; })
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
        
        // 2. Dibujar la caja de selección global de color azul celeste alrededor de todo el conjunto
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
        arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius - 1.5/paper.view.zoom, 1.5/paper.view.zoom)));
        arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius, 0)));
        arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius + 1.5/paper.view.zoom, 1.5/paper.view.zoom)));
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

    // Sobreescribir el State Guard de selection.js de manera blindada
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

// --- 3. ACCIONES DE ORGANIZACIÓN (VECTORES / SVGS) ---
setClick('btnCtxGroup', () => groupSelectedItems());
setClick('btnCtxAgrupar', () => groupSelectedItems());
setClick('btnCtxUngroup', () => ungroupSelectedItem());
setClick('btnCtxDesagrupar', () => ungroupSelectedItem());
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
window.separateContours = separateContours;
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
} else if (target instanceof paper.Raster) {
const imageControls = document.getElementById('ctxImageControls');
if (imageControls) {
imageControls.classList.remove('hidden');
}
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
btnUngroup.textContent = "Desagrupar";
btnUngroup.title = "Desagrupar elemento vectorial";
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

// 1. Corregir Barra Contextual Flotante
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
const targetTop = rect.top + window.scrollY + viewPos.y - toolbarHeight - 25;
toolbar.style.position = "absolute";
toolbar.style.left = Math.max(10, Math.min(window.innerWidth - toolbarWidth - 10, targetLeft)) + "px";
toolbar.style.top = Math.max(10, Math.min(window.innerHeight - toolbarHeight - 10, targetTop)) + "px";
}
toolbar.style.zIndex = "2147483646";
}
}

// 2. Corregir Editor de Texto
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

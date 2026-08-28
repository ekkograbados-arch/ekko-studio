/* =========================================================================
   Modulo: ASSETS/js/modules/canvas-pro/contextualMenu.js (PRO Edition - v24.2 - Consolidated Shortcuts)
   Ruta de implementacion: ASSETS/js/modules/canvas-pro/contextualMenu.js
   Descripción: Gestor unificado del menú contextual y de las acciones de grabado/
                edición de vectores y textos en caliente. Sincronizado 100% con
                geometricUngroup.js.
                - Los calados permanecen como ausencias físicas reales de material.
                - No se crean ni se simulan calados celestes ni parches visuales.
                - Soporta agrupamiento y desagrupamiento libre e inverso.
                - SANEADO DE ATAJOS (Rule 12): Los escuchadores de Ctrl+G y Ctrl+U
                  fueron removidos para delegarse 100% a zoomYShortcuts.js,
                  evitando el molesto bug de "doble ejecución" en cascada.
   ========================================================================= */

import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, applyBrightnessContrast } from "./imageToolbar.js";
import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";
import { geometricUngroupCompound, geometricUngroupOneLevel } from "./geometricUngroup.js";

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

window.originalFontBackup = null;
let fontsCache = [];
let toolbarDragged = false;
let lastSelectedItem = null;

window.ekkoOuters = window.ekkoOuters || new Map();
window.ekkoHolesMap = window.ekkoHolesMap || new Map();

// --- INYECCIÓN DE ESTILOS CSS PARA EL MENÚ PERSONALIZADO ---
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
    let target = item;
    if (item.data?.clipGroup) {
        target = getContentItem(item);
    }
    if (!target) return;
    if (isPointText(target)) {
        target.fontFamily = family;
    } else if (target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
        target.data.fontFamily = family;
        target.children.forEach(child => {
            if (isPointText(child)) child.fontFamily = family;
        });
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
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const parent = selected[0].parent || paper.project.activeLayer;
    const index = parent.children.indexOf(selected[0]);
    const newGroup = new paper.Group();

    // Marcamos jerarquía compuesta
    newGroup.data = {
        locked: false,
        label: "Grupo Compuesto",
        geometricHierarchy: "compound"
    };

    selected.forEach(item => {
        if (item.data && item.data.locked) return;
        newGroup.addChild(item);
    });

    let finalItem;
    const hasMockup = !!window.currentMockup;
    if (hasMockup) {
        finalItem = window.clipItem(newGroup);
        if (finalItem === newGroup) {
            parent.addChild(finalItem);
        } else {
            parent.addChild(finalItem);
        }
    } else {
        finalItem = newGroup;
        parent.addChild(finalItem);
    }

    if (finalItem.parent && index !== -1) {
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

function isArtboardBackground(child, current) {
    if (!child || !current || !child.bounds || !current.bounds) return false;
    if (child.bounds.width >= current.bounds.width * 0.99 && child.bounds.height >= current.bounds.height * 0.99) {
        const hasNoFillOrWhite = !child.fillColor || child.fillColor.equals('#ffffff') || child.fillColor.alpha === 0;
        return hasNoFillOrWhite;
    }
    return false;
}

export function ungroupSelectedItem() {
    if (typeof window !== 'undefined') {
        console.log("%c[EKKO UNGROUP ACTION] 1. Clic detectado en Desagrupar 🔓", "color: #ffffff; font-weight: bold; background: #ea580c; padding: 4px 10px; border-radius: 6px; font-size: 13px;");
    }

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
    if (typeof window.saveHistory === 'function') window.saveHistory();

    rawSelected.forEach(item => {
        if (!item || (item.data && item.data.locked)) return;

        // B. SI ES UN COMPOUND PATH (DESENSAMBLADO GEOMÉTRICO NATURALLY)
        const isComp = isCompoundPath(item) || (item.data?.clipGroup && isCompoundPath(getContentItem(item)));
        if (isComp) {
            const actualItem = item.data?.clipGroup ? getContentItem(item) : item;
            geometricUngroupCompound(actualItem);
            return;
        }

        const isClipped = !!item.data?.clipGroup;
        const target = isClipped ? getContentItem(item) : item;
        if (!target) return;

        const activeTarget = isGroup(target) ? getActiveGroupTarget(target) : target;
        const parent = item.parent || paper.project.activeLayer;
        const index = parent.children.indexOf(item);
        const newItems = [];

        // A. SI ES GRUPO TRADICIONAL / COMPUESTO
        if (isGroup(activeTarget) && !activeTarget.data?.clipGroup) {
            if (activeTarget.data?.geometricHierarchy === 'compound') {
                const res = geometricUngroupOneLevel(activeTarget, isClipped, item);
                if (res && res.items) {
                    newItems.push(...res.items);
                }
            } else {
                // Desagrupamiento clásico plano
                const leaves = getLeafItemsRecursive(activeTarget);
                leaves.forEach(leaf => {
                    let newItem;
                    const leafGlobalMatrix = getGlobalMatrix(leaf);
                    leaf.remove();

                    if (isClipped) {
                        newItem = window.clipItem(leaf);
                        if (newItem === leaf) {
                            newItem.matrix = leafGlobalMatrix;
                        } else {
                            newItem.matrix = item.matrix.clone();
                            leaf.matrix = getMatrixRelativeTo(leaf, activeTarget).clone();
                        }
                    } else {
                        newItem = leaf;
                        newItem.matrix = leafGlobalMatrix;
                        parent.addChild(newItem);
                    }

                    if (newItem.data) {
                        delete newItem.data.globalMatrix;
                    }
                    newItems.push(newItem);
                });
                item.remove();
            }
        }

        // C. SI ES UN TEXTO CON DIFERENTES CARACTERES (SPLIT TEXT IN LINE)
        if (isPointText(activeTarget)) {
            const textAbsMatrix = getGlobalMatrix(activeTarget);
            const letters = splitPointTextIntoLetters(activeTarget);
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
            item.remove();
        }

        // Reubicar elementos jerárquicamente de manera ordenada
        if (newItems.length > 0) {
            if (index !== -1 && parent.insertChild) {
                newItems.forEach((newItem, i) => parent.insertChild(index + i, newItem));
            }
        }
    });

    if (typeof window.recalculateDynamicSubtractions === 'function') {
        window.recalculateDynamicSubtractions();
    }

    // Selección inteligente del primer elemento resultante
    if (window.selectedItems && window.selectedItems.length > 0) {
        const primaryItem = window.selectedItems[0];
        window.deselectItem();
        setTimeout(() => {
            window.selectedItems = [primaryItem];
            window.selectedItem = primaryItem;
            primaryItem.selected = true;
            if (typeof window.updateSelectionBox === 'function') window.updateSelectionBox(window.selectedItem);
            if (typeof window.updateContextualMenu === 'function') window.updateContextualMenu(window.selectedItem);
            console.log("%c[EKKO UNGROUP ACTION] Desagrupación finalizada con éxito.", "color: #10b981; font-weight: bold; background: #ecfdf5; padding: 2px 6px; border-radius: 4px;");
            paper.view.update();
        }, 50);
    }
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

export function initContextualMenu() {
    const canvasEl = document.getElementById("editorCanvas");
    if (canvasEl) {
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
    }

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
                if (canvasEl) canvasEl.style.cursor = "default";
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
        if (typeof window.recalculateDynamicSubtractions === 'function') {
            window.recalculateDynamicSubtractions();
        }
    });

    setClick('btnCtxBackward', () => {
        if (window.selectedItem) {
            sendImageBackward(window.selectedItem);
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

    /* =========================================================================
       SANEADO DE EVENTOS DUPLICADOS (Ctrl+G, Ctrl+U):
       Los listeners de teclado de atajo grupal locales han sido completamente
       desactivados de este archivo contextualMenu.js. Ahora son orquestados de manera
       unificada por initGlobalKeyboardShortcuts() en modules/canvas-pro/zoomYShortcuts.js.
       ========================================================================= */

    window.groupSelectedItems = groupSelectedItems;
    window.ungroupSelectedItem = ungroupSelectedItem;
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
        const viewPos = paper.view.projectToView(targetBounds.topCenter);
        const canvas = document.getElementById("editorCanvas");
        if (canvas) {
            const rect = canvas.getBoundingClientRect();
            const x = rect.left + window.scrollX + viewPos.x - (toolbar.offsetWidth / 2);
            const y = rect.top + window.scrollY + viewPos.y - toolbar.offsetHeight - 25;
            toolbar.style.position = "absolute";
            toolbar.style.left = Math.max(10, x) + 'px';
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
    }
    const list = document.querySelector('.font-dropdown-list');
    if (list) {
        list.classList.add('hidden');
    }
    toolbarDragged = false;
    lastSelectedItem = null;
}

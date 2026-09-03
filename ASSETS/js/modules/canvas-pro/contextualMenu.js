/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js (PRO Contextual Engine v44.0 - Active Node Edit Button Connectivity & Multi-Level Ungroup)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/contextualMenu.js
Descripción:
    Gestor unificado del menú contextual, tipografías dinámicas, transformaciones
    y barra de acciones para EKKO Studio.

    CORRECCIÓN MATEMÁTICA DE DUPLICADO CON OFFSET UNIFICADO EN NODO RAÍZ.

AUTORIDAD: REPOSITORIO CANÓNICO V8 / CO-DISEÑO DE PRECISIÓN
========================================================================= */

import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, bringImageForward, sendImageBackward, bringImageToFront, sendImageToBack } from "./imageToolbar.js";
import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";

// Importación de funciones CSG
function safeRecalculateSubtractions() {
    if (typeof window !== 'undefined' && typeof window.recalculateDynamicSubtractions === 'function') {
        window.recalculateDynamicSubtractions();
    }
}

// Helper universal de resolución de contenido dentro o fuera de clipGroup
function getContentItem(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup) {
        if (!item.children) return item;
        var childrenArr = Array.from(item.children);
        var content = childrenArr.find(function(c) {
            return !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask));
        });
        if (content) return content;
        var fallback = childrenArr.find(function(c) {
            return !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup));
        });
        if (fallback) return fallback;
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

// --- DETECTORES DE CLASE NATIVOS DE PAPER.JS ---
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
            const childrenArr = Array.from(target.children);
            childrenArr.forEach(c => {
                if (!c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask))) recurse(c);
            });
        }
        if (target.className === 'Group' && target.children) {
            const childrenArr = Array.from(target.children);
            childrenArr.forEach(recurse);
        }
    }
    recurse(item);
}

// =========================================================================
// MOTOR INDUSTRIAL DE DUPLICACIÓN CON DESFASE VISUAL (LIGHTBURN STYLE)
// =========================================================================

/**
 * Duplica un único objeto vectorial o raster, preservando independencias geométricas.
 * @param {paper.Item} targetItem El elemento original a duplicar
 * @param {paper.Point} offset Vector de desfase acumulativo (LightBurn Style)
 * @returns {paper.Item|null} El nuevo objeto duplicado e independiente
 */
export function duplicateSingleItem(targetItem, offset = new paper.Point(20, 20)) {
    if (!targetItem || isMockupOrProductElement(targetItem)) return null;
    if (targetItem.data && targetItem.data.locked) return null;

    const isClipped = !!(targetItem.data && targetItem.data.clipGroup);
    
    // Clonación del objeto completo para mantener congruencia geométrica absoluta y concéntrica de máscaras
    const duplicatedObject = targetItem.clone();
    
    // Desvincular de raíz las referencias del objeto .data en clones
    duplicatedObject.data = { ...(duplicatedObject.data || {}), locked: false };
    
    // Desplazar físicamente el objeto clonado completo (Una única vez en nodo raíz)
    duplicatedObject.position = duplicatedObject.position.add(offset);

    // Propagar desplazamiento exacto a toda la jerarquía de geometrías base internas de forma simultánea
    syncGeomBaseDeep(duplicatedObject, offset);

    const designLayer = (paper.project.layers && paper.project.layers.find(l => l.name === 'designLayer')) || paper.project.activeLayer;
    if (designLayer) designLayer.addChild(duplicatedObject);

    if (duplicatedObject) {
        if (targetItem.nextSibling) {
            duplicatedObject.insertAbove(targetItem);
        } else if (window.currentMockup) {
            duplicatedObject.insertBelow(window.currentMockup);
        } else {
            duplicatedObject.bringToFront();
        }
    }

    return duplicatedObject;
}

/**
 * Duplica la selección activa de Studio (simple o múltiple) unificando atajos y DOM.
 */
export function duplicateSelectedItem() {
    const selectedList = (window.selectedItems && window.selectedItems.length > 0)
        ? [...window.selectedItems]
        : (window.selectedItem ? [window.selectedItem] : []);

    if (selectedList.length === 0) return null;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const duplicatedList = [];
    const offset = new paper.Point(20, 20);

    selectedList.forEach(item => {
        const cl = duplicateSingleItem(item, offset);
        if (cl) duplicatedList.push(cl);
    });

    if (duplicatedList.length > 0) {
        if (typeof window.deselectItem === 'function') window.deselectItem();
        window.selectedItems = [...duplicatedList];
        window.selectedItem = duplicatedList[duplicatedList.length - 1];
        duplicatedList.forEach(cl => { cl.selected = true; });
        safeRecalculateSubtractions();

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

export function duplicateImage(item) {
    return duplicateSelectedItem();
}

export function deleteImage(item) {
    if (window.nodeEditMode && typeof window.exitNodeEditMode === 'function') {
        const targetObj = window.nodeEditTarget || item || window.selectedItem;
        window.exitNodeEditMode(true);
        item = targetObj;
    }

    const itemsToDelete = (window.selectedItems && window.selectedItems.length > 0)
        ? [...window.selectedItems]
        : (item ? [item] : (window.selectedItem ? [window.selectedItem] : []));

    if (itemsToDelete.length === 0) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    itemsToDelete.forEach(it => {
        if (it && !it.data?.locked) {
            it.remove();
        }
    });

    if (typeof window.deselectItem === 'function') {
        window.deselectItem();
    }

    safeRecalculateSubtractions();
    paper.view.update();
}

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
        #contextual-toolbar { position: absolute; z-index: 10100 !important; }
        .custom-font-dropdown { position: relative; min-width: 180px; height: 34px; background: white; border: 1px solid #ccc; border-radius: 6px; user-select: none; display: inline-block; vertical-align: middle; }
        .selected-font-trigger { display: flex; align-items: center; justify-content: space-between; padding: 0 10px; height: 100%; cursor: pointer; font-size: 13px; color: #333; }
        .selected-font-trigger:hover { background: #f9f9f9; }
        .font-dropdown-list { position: absolute; bottom: 100%; left: 0; right: 0; max-height: 240px; overflow-y: auto; background: white; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 -4px 10px rgba(0,0,0,0.15); z-index: 10105 !important; margin-bottom: 4px; }
        .font-dropdown-item { padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; border-bottom: 1px solid #f1f5f9; }
        .font-dropdown-item:hover { background: #f0f9ff; }
        .font-name-label { font-size: 11px; color: #64748b; font-weight: 600; }
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

function getSelectedFontFamily() {
    if (!window.selectedItem) return "Arial";
    const target = window.selectedItem.data?.clipGroup ? getContentItem(window.selectedItem) : window.selectedItem;
    if (!target) return "Arial";
    return target.fontFamily || "Arial";
}

function renderFontList(fonts, listContainer) {
    if (!listContainer) return;
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

function applyFontFamily(item, family) {
    const target = item.data?.clipGroup ? getContentItem(item) : item;
    if (target && isPointText(target)) {
        target.fontFamily = family;
        paper.view.update();
        if (typeof window.updateSelectionBox === 'function') {
            window.updateSelectionBox(item);
        }
    }
}

function getSelectedTextString() {
    if (!window.selectedItem) return "EKKO Studio";
    const target = window.selectedItem.data?.clipGroup ? getContentItem(window.selectedItem) : window.selectedItem;
    if (!target) return "EKKO Studio";
    if (isPointText(target)) {
        return target.content || "EKKO Studio";
    }
    return "EKKO Studio";
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

export function groupSelectedItems() {
    const selected = (window.selectedItems && window.selectedItems.length > 0)
        ? [...window.selectedItems]
        : (window.selectedItem ? [window.selectedItem] : []);

    if (selected.length < 2) return;
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const parent = selected[0].parent || paper.project.activeLayer;
    let lowestIndex = parent.children.length;
    let anyClipped = false;

    selected.forEach(it => {
        const idx = parent.children.indexOf(it);
        if (idx > -1 && idx < lowestIndex) lowestIndex = idx;
        if (it.data && it.data.clipGroup) anyClipped = true;
    });

    const rawItems = selected.map(it => {
        it.selected = false;
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
    safeRecalculateSubtractions();
    paper.view.update();
}

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

        const cName = actualItem.className;
        if (cName === 'Group' || cName === 'CompoundPath' || cName === 'SymbolItem' || cName === 'PlacedSymbol') {
            const decomp = typeof window.decomposeByContainmentHierarchy === 'function'
                ? window.decomposeByContainmentHierarchy(item, isClipped)
                : null;
            if (decomp && decomp.items) {
                allCreatedItems.push(...decomp.items);
            } else {
                allCreatedItems.push(item);
            }
        } else {
            allCreatedItems.push(item);
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

    safeRecalculateSubtractions();
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
        const textEditor = document.getElementById("ekko-text-editor");
        if (e.key === "Escape") {
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

    setClick('btnCtxDelete', () => {
        const target = window.nodeEditTarget || window.selectedItem;
        if (target) {
            deleteImage(target);
            hideContextualMenu();
        }
    });

    setClick('btnCtxDuplicate', () => {
        duplicateSelectedItem();
    });

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
            } else if (typeof enterNodeEditMode === 'function') {
                enterNodeEditMode(window.selectedItem);
            }
        }
    });

    setClick('btnCtxNodeEdit', () => {
        if (window.selectedItem) {
            if (typeof window.enterNodeEditMode === 'function') {
                window.enterNodeEditMode(window.selectedItem);
            } else if (typeof enterNodeEditMode === 'function') {
                enterNodeEditMode(window.selectedItem);
            }
        }
    });

    // --- CONECTIVIDAD DE BOTONES DE CONTROL DE NODOS (EXIT & DELETE SEGMENT) ---
    setClick('btnCtxExitNodeEdit', () => {
        if (typeof window.exitNodeEditMode === 'function') {
            window.exitNodeEditMode();
        }
    });

    setClick('btnCtxDeleteNode', () => {
        if (typeof window.deleteSelectedNodes === 'function') {
            window.deleteSelectedNodes();
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
                combinedBounds = !combinedBounds ? tgt.bounds.clone() : combinedBounds.unite(tgt.bounds);
            }
        });
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
    toolbar.style.zIndex = "10100";

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
            return tgt && (isPath(tgt) || isCompoundPath(tgt) || isGroup(tgt) || isPointText(tgt) || isSymbolItem(tgt) || (typeof isShape === 'function' && isShape(tgt)));
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
                    btnGroup.style.display = 'inline-block';
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
        } else if (isPath(target) || isCompoundPath(target) || isGroup(target) || isSymbolItem(target) || (typeof isShape === 'function' && isShape(target))) {
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

if (typeof window !== 'undefined') {
    window.duplicateImage = duplicateImage;
    window.deleteImage = deleteImage;
    window.duplicateSingleItem = duplicateSingleItem;
    window.duplicateSelectedItem = duplicateSelectedItem;
    window.groupSelectedItems = groupSelectedItems;
    window.ungroupSelectedItem = ungroupSelectedItem;
}

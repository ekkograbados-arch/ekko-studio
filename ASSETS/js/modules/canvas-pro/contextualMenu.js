import { isMockupOrMask, isContainmentWrapper, getPublicOwner, getPublicOwners } from "./designGeometry.js";
/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js (PRO Contextual Engine v10.3 - Saneado y Unificado)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/contextualMenu.js
Descripción:
Gestor unificado del menú contextual, tipografías dinámicas, transformaciones
y barra de acciones para EKKO Studio.
Asegura la preservación absoluta de las funciones de apilamiento Z (LightBurn style),
alineación Canva-style, conversión de texto a curvas, soldadura y despiece.
Saneado conforme a la Ley del Efecto Rebote para desactivar dobles bindings en español
y unificar IDs interactivos en inglés Figma/Canva Style.
========================================================================= */

import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, bringImageForward, sendImageBackward, bringImageToFront, sendImageToBack } from "./imageToolbar.js";
import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";
import { dispatchUngroup, dispatchVectorDecomposition, canDecomposeVector } from "./ungroupRoutes.js";

// Helper de recálculo dinámico de sustracciones booleanas CSG
function safeRecalculateSubtractions() {
    if (typeof window !== 'undefined' && typeof window.recalculateDynamicSubtractions === 'function') {
        window.recalculateDynamicSubtractions();
    }
}

// Helper universal de resolución de contenido dentro o fuera de clipGroup


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

function isShape(item) {
    if (!item) return false;
    return item.className === 'Shape' || (typeof paper !== 'undefined' && paper.Shape && item instanceof paper.Shape);
}

function isMockupOrProductElement(item) {
    const owner = getPublicOwner(item);
    return !owner || isMockupOrMask(owner) || isContainmentWrapper(owner) ||
        owner === window.currentMockup || owner === window.clipMask;
}

// Sincronización recursiva profunda de geomBase ante desplazamientos
function syncGeomBaseDeep(item, delta) {
    if (!item || !delta || (delta.x === 0 && delta.y === 0)) return;
    if (typeof window.syncGeomBaseDeep === 'function') {
        window.syncGeomBaseDeep(item, delta);
        return;
    }
    const visited = new Set();
    const recurse = (it) => {
        if (!it || visited.has(it.id)) return;
        visited.add(it.id);
        if (it.data && it.data.geomBase) {
            it.data.geomBase.position = it.data.geomBase.position.add(delta);
        }
        if (it.children) {
            it.children.forEach(recurse);
        }
    };
    recurse(item);
}

/**
 * Duplica un solo objeto de diseño de manera independiente (coherencia de matrices)
 * @param {paper.Item} targetItem El elemento original a duplicar
 * @param {paper.Point} offset Vector de desfase acumulativo (LightBurn Style)
 * @returns {paper.Item|null} El nuevo objeto duplicado e independiente
 */
export function duplicateSingleItem(targetItem, offset = new paper.Point(20, 20)) {
    if (!targetItem || isMockupOrProductElement(targetItem)) return null;
    if (targetItem.data && targetItem.data.locked) return null;

    // Clonación del objeto completo en el nodo raíz para conservar máscaras y transformaciones concéntricas
    let duplicatedObject = null;
    if (targetItem.data && targetItem.data.clipGroup) {
        const content = getPublicOwner(targetItem);
        if (!content) return null;
        const contentClone = content.clone();
        contentClone.position = contentClone.position.add(offset);
        contentClone.data = { ...(contentClone.data || {}), locked: false };
        duplicatedObject = window.clipItem(contentClone);
    } else {
        const clone = targetItem.clone();
        clone.position = clone.position.add(offset);
        clone.data = { ...(clone.data || {}), locked: false };
        duplicatedObject = clone;
    }

    const designLayer = (paper.project.layers && paper.project.layers.find(l => l.name === "designLayer")) || paper.project.activeLayer;
    if (designLayer) designLayer.addChild(duplicatedObject);

    // Ajustar Orden Z: Insertar ordenadamente justo encima del original pero debajo del mockup
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
 * @returns {paper.Item[]} Lista de nuevos clones creados
 */
export function duplicateSelectedItem() {
    if (window.nodeEditMode && typeof window.exitNodeEditMode === 'function') {
        const activeTarget = window.nodeEditTarget || window.selectedItem;
        window.exitNodeEditMode(true); // Salir forzadamente antes de duplicar el objeto completo
        window.commitSelection?.(activeTarget, window.selectedItems);
    }
    const itemsToDuplicate = (window.selectedItems && window.selectedItems.length > 0)
        ? [...window.selectedItems]
        : (window.selectedItem ? [window.selectedItem] : []);

    if (itemsToDuplicate.length === 0) return [];
    if (typeof window.saveHistory === 'function') window.saveHistory();

    const duplicatedList = [];
    const offset = new paper.Point(20, 20);
    itemsToDuplicate.forEach(item => {
        const clone = duplicateSingleItem(item, offset);
        if (clone && typeof window.EKKO_FUSION_CONTROLLER?.rekeyFusionClone === 'function') {
            window.EKKO_FUSION_CONTROLLER.rekeyFusionClone(clone);
        }
        if (clone) duplicatedList.push(clone);
    });

    if (duplicatedList.length > 0) {
        if (typeof window.deselectItem === 'function') window.deselectItem();
        window.commitSelection?.(duplicatedList[duplicatedList.length - 1], duplicatedList);
        duplicatedList.forEach(cl => { cl.selected = true; });

        // Sincronizar recálculo CSG dinámico sobre las nuevas capas
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
            if (typeof window.EKKO_FUSION_CONTROLLER?.removeFusionForItem === 'function') {
                window.EKKO_FUSION_CONTROLLER.removeFusionForItem(it);
            }
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
    styleEl.textContent = `\n#contextual-toolbar { position: absolute; z-index: 10100 !important; }\n.font-dropdown-item { padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column; gap: 2px; border-bottom: 1px solid #f1f5f9; }\n.font-dropdown-item:hover { background: #f0f9ff; }\n.font-name-label { font-size: 11px; color: #64748b; font-weight: 600; }\n.hidden { display: none !important; }\n`;
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
        const fontPath = `/ASSETS/fonts/${encodeURIComponent(font.file)}`;
        const extension = String(font.file || "").split(".").pop().toLowerCase();
        const format = extension === "ttf"
            ? "truetype"
            : extension === "otf"
                ? "opentype"
                : extension === "woff"
                    ? "woff"
                    : extension === "woff2"
                        ? "woff2"
                        : "opentype";
        css += `@font-face { font-family: "${font.family}"; src: url("${fontPath}") format("${format}"); font-display: swap; }\n`;
    });
    styleEl.textContent = css;
}

function getSelectedTextString() {
    if (!window.selectedItem) return "EKKO Studio";
    const target = window.selectedItem.data?.clipGroup ? getPublicOwner(window.selectedItem) : window.selectedItem;
    if (!target) return "EKKO Studio";
    if (isPointText(target)) {
        return target.content || "EKKO Studio";
    }
    return "EKKO Studio";
}

function getSelectedFontFamily() {
    if (!window.selectedItem) return "Arial";
    const target = window.selectedItem.data?.clipGroup ? getPublicOwner(window.selectedItem) : window.selectedItem;
    if (!target) return "Arial";
    return target.fontFamily || "Arial";
}

function renderFontList(fonts, container) {
    if (!container) return;
    container.innerHTML = "";
    const sampleText = getSelectedTextString();
    fonts.forEach(font => {
        const item = document.createElement('div');
        item.className = 'font-dropdown-item';
        item.innerHTML = `\n<span class="font-name-label">${font.name}</span>\n<span style="font-family: '${font.family}', sans-serif; font-size: 16px; color: #111;">${sampleText}</span>\n`;
        
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
            container.classList.add('hidden');
            const triggerText = document.querySelector('.selected-font-trigger span');
            if (triggerText) triggerText.textContent = font.name;
        };
        container.appendChild(item);
    });
}

function applyFontFamily(item, family) {
    const target = item.data?.clipGroup ? getPublicOwner(item) : item;
    if (target && isPointText(target)) {
        target.fontFamily = family;
        try {
            const ready = document.fonts?.load?.(`16px "${family}"`);
            if (ready?.then) ready.then(() => paper.view.update()).catch(() => {});
        } catch (e) {}
        paper.view.update();
    }
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
    let startX = 0, startY = 0;

    toolbar.addEventListener('mouseover', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('.custom-font-dropdown')) {
            toolbar.style.cursor = 'default';
        } else {
            toolbar.style.cursor = 'move';
        }
    });

    toolbar.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON' || e.target.tagName === 'INPUT' || e.target.closest('.custom-font-dropdown')) return;
        isDraggingToolbar = true;
        startX = e.clientX - toolbar.offsetLeft;
        startY = e.clientY - toolbar.offsetTop;
    });

    document.addEventListener('mousemove', (e) => {
        if (!isDraggingToolbar) return;
        const nextLeft = Math.max(8, Math.min(window.innerWidth - toolbar.offsetWidth - 8, e.clientX - startX));
        const nextTop = Math.max(8, Math.min(window.innerHeight - toolbar.offsetHeight - 8, e.clientY - startY));
        toolbar.style.left = nextLeft + 'px';
        toolbar.style.top = nextTop + 'px';

        // Persistir la posición elegida por el usuario durante la sesión.
        // updateContextualMenu() reutiliza estos valores al seleccionar
        // nuevamente cualquier objeto.
        window.customToolbarLeft = nextLeft;
        window.customToolbarTop = nextTop;
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
    if (selected.length < 2) return;

    if (typeof window.saveHistory === 'function') window.saveHistory();
    const finalGroup = new paper.Group(selected);
    finalGroup.data = {
        locked: false,
        label: "Grupo",
        isUserGroup: true,
        source: "user-group",
        role: "user-group"
    };

    const designLayer = (paper.project.layers && paper.project.layers.find(l => l.name === 'designLayer')) || paper.project.activeLayer;
    if (designLayer) {
        designLayer.addChild(finalGroup);
        if (window.currentMockup) {
            finalGroup.insertBelow(window.currentMockup);
        }
    }

    if (typeof window.deselectItem === 'function') window.deselectItem();
    if (typeof window.selectItem === 'function') window.selectItem(finalGroup);
    safeRecalculateSubtractions();
    paper.view.update();
}

/**
 * DESAGRUPAR: canonical dispatcher. Route selection belongs exclusively to
 * ungroupRoutes.js; this compatibility export never performs topology work.
 */
export function ungroupSelectedItem() {
    if (window.nodeEditMode && typeof exitNodeEditMode === "function") {
        exitNodeEditMode(true);
    }
    return dispatchUngroup();
}

function dispatchTextCurve(options = {}) {
    const item = window.selectedItem || window.selectedItems?.[0];
    if (!item) return;
    const slider = document.querySelector('#ctxTextCurvature input[type=range]');
    const radiusInput = document.getElementById('ctxCurveRadius') || document.getElementById('objCurveRadius');
    const spacingInput = document.getElementById('ctxTextSpacing') || document.getElementById('objTextSpacing');
    const radius = Number(options.radius ?? radiusInput?.value ?? item.data?.radius ?? 0) || 0;
    const spacing = Number(options.hspace ?? spacingInput?.value ?? item.data?.hspace ?? 0) || 0;
    let curvature = Number(options.curvature ?? slider?.value ?? item.data?.curvature ?? 0) || 0;
    if (radius > 0) curvature = Math.max(0.1, Math.min(100, 10000 / radius)) * (curvature < 0 ? -1 : 1);
    Promise.resolve(applyTextCurve(item, curvature, { radius: radius || undefined, hspace: spacing })) .then(() => {
        window.updateSelectionBox?.(window.selectedItem || item);
        window.updateContextualMenu?.(window.selectedItem || item);
        if (typeof paper !== "undefined") paper.view?.update?.();
    });
}
function dispatchTextSpacing() {
    const item = window.selectedItem || window.selectedItems?.[0];
    if (!item) return;
    const value = Number(document.getElementById('ctxTextSpacing')?.value ?? document.getElementById('objTextSpacing')?.value ?? item.data?.hspace ?? 0) || 0;
    Promise.resolve(applyTextSpacing(item, value)).then(() => {
        window.updateSelectionBox?.(window.selectedItem || item);
        window.updateContextualMenu?.(window.selectedItem || item);
    });
}
window.dispatchTextCurve = dispatchTextCurve;
window.dispatchTextSpacing = dispatchTextSpacing;

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

    setClick('btnCtxTextCurve', dispatchTextCurve);
    setClick('btnTopTextCurve', dispatchTextCurve);
    setClick('btnCtxTextSpacing', dispatchTextSpacing);
    setClick('btnTopTextSpacing', dispatchTextSpacing);
    ['ctxCurveRadius', 'objCurveRadius'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', () => dispatchTextCurve({ radius: el.value }));
    });
    ['ctxTextSpacing', 'objTextSpacing'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', dispatchTextSpacing);
    });

    setClick('btnCtxScaleDown', () => {
        if (window.selectedItem) scaleImage(window.selectedItem, 0.9);
    });

    setClick('btnCtxScaleUp', () => {
        if (window.selectedItem) scaleImage(window.selectedItem, 1.1);
    });

    // UNIFICACIÓN CANÓNICA 10.3: Se descartan los clicks hacia IDs alternativos obsoletos en español.
    setClick('btnCtxGroup', () => {
        if (typeof window.groupSelectedItems === 'function') window.groupSelectedItems();
    });
    setClick('btnCtxUngroup', () => {
        if (typeof window.ungroupSelectedItem === 'function') window.ungroupSelectedItem();
    });
    setClick('btnCtxDecomposeVector', () => {
        if (typeof window.decomposeVectorSelectedItem === 'function') window.decomposeVectorSelectedItem();
        else dispatchVectorDecomposition();
    });

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

    // Establish the empty-selection state even before the first click.
    setTextCurveVisibility(false);
}

function getUnifiedScreenBounds(item) {
    const canvasEl = document.getElementById("editorCanvas");
    if (!canvasEl || typeof paper === 'undefined' || !paper.view) return null;
    const canvasRect = canvasEl.getBoundingClientRect();
    let combinedBounds = null;

    if (window.selectedItems && window.selectedItems.length > 0) {
        window.selectedItems.forEach(it => {
            const tgt = it.data?.clipGroup ? getPublicOwner(it) : it;
            if (tgt && tgt.bounds && tgt.visible !== false) {
                if (!combinedBounds) combinedBounds = tgt.bounds.clone();
                else combinedBounds = combinedBounds.unite(tgt.bounds);
            }
        });
    }

    const bounds = combinedBounds || (item ? item.bounds : null);
    if (!bounds) return null;

    const centerGlobal = paper.view.projectToView(bounds.center);
    return {
        x: centerGlobal.x + canvasRect.left,
        y: paper.view.projectToView(bounds.topLeft).y + canvasRect.top
    };
}

function setTextCurveVisibility(visible) {
    // Both surfaces are one command: never leave a stale top button or popup control.
    const ids = ['btnTopTextCurve', 'btnCtxTextCurve'];
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.style.display = visible ? 'inline-flex' : 'none';
        el.classList.toggle('hidden', !visible);
        el.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });
}

function isCurveTextTarget(target) {
    if (!target || target.data?.mockup || target.data?.isMask || target.data?.isFusion ||
        target.data?.fusionId || target.data?.clipGroup || isRaster(target)) return false;
    return isPointText(target) || target.data?.isCurvedGroup === true || target.data?.isSpacedGroup === true;
}

export function updateContextualMenu(item) {
    const toolbar = document.getElementById("contextual-toolbar");
    if (!toolbar) return;
    removeOverlapTab();

    if (!item || (item.data && (item.data.mockup || item.data.isMask))) {
        setTextCurveVisibility(false);
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
    setTextCurveVisibility(false);

    const btnTrace = document.getElementById('btnCtxTrace');
    if (btnTrace) btnTrace.style.display = 'none';
    const btnDecompose = document.getElementById('btnCtxDecomposeVector');
    if (btnDecompose) btnDecompose.style.display = 'none';

    const selectedCount = window.selectedItems ? window.selectedItems.length : 0;
    if (selectedCount > 1) {
        const allVectors = window.selectedItems.every(it => {
            const tgt = it.data?.clipGroup ? getPublicOwner(it) : it;
            return tgt && (isPath(tgt) || isCompoundPath(tgt) || isGroup(tgt) || isPointText(tgt) || isSymbolItem(tgt) || isShape(tgt));
        });

        if (allVectors) {
            const btnEditNodes = toolbar.querySelector('[data-fusion-btn="editNodes"]');
            if (btnEditNodes) btnEditNodes.style.display = 'none';

            // UNIFICACIÓN CANÓNICA 10.3: Se usa estrictamente el ID unificado en inglés, sin alias obsoletos en español.
            const btnGroup = document.getElementById('btnCtxGroup');
            if (btnGroup) {
                btnGroup.classList.remove('hidden');
                btnGroup.style.display = 'inline-block';
            }

            const btnUngroup = document.getElementById('btnCtxUngroup');
            if (btnUngroup) {
                btnUngroup.style.display = 'none';
            }
        }
    } else {
        const target = item.data?.clipGroup ? getPublicOwner(item) : item;
        if (!target) return;

        if (isCurveTextTarget(target)) {
            const txtCtrl = document.getElementById('ctxTextControls');
            if (txtCtrl) txtCtrl.classList.remove('hidden');
            setTextCurveVisibility(true);
            const fontTrigger = document.querySelector('.selected-font-trigger span');
            if (fontTrigger) fontTrigger.textContent = getSelectedFontFamily();
            window.EKKO_ROTATION_CONTROLLER?.syncFontSizeInputs?.(target.fontSize || 42);
        } else if (isRaster(target)) {
            const imgCtrl = document.getElementById('ctxImageControls');
            if (imgCtrl) imgCtrl.classList.remove('hidden');
            if (btnTrace) {
                btnTrace.classList.remove('hidden');
                btnTrace.style.display = 'inline-flex';
            }
        } else if (isPath(target) || isCompoundPath(target) || isGroup(target) || isSymbolItem(target) || isShape(target)) {
            const btnEditNodes = toolbar.querySelector('[data-fusion-btn="editNodes"]');
            if (btnEditNodes) {
                const canEdit = !isGroup(target) && !isSymbolItem(target);
                btnEditNodes.style.display = canEdit ? 'inline-block' : 'none';
            }

            // UNIFICACIÓN CANÓNICA 10.3: Se usan estrictamente los IDs unificados en inglés, sin alias obsoletos en español.
            const btnGroup = document.getElementById('btnCtxGroup');
            if (btnGroup) {
                btnGroup.classList.add('hidden');
                btnGroup.style.display = 'none';
            }

            const btnUngroup = document.getElementById('btnCtxUngroup');
            if (btnUngroup) {
                const canUngroup = isGroup(target) || isSymbolItem(target);
                btnUngroup.style.display = canUngroup ? 'inline-block' : 'none';
            }
            if (btnDecompose) {
                btnDecompose.style.display = canDecomposeVector(target) ? 'inline-block' : 'none';
            }
        }
    }

    if (window.customToolbarLeft !== undefined && window.customToolbarTop !== undefined) {
        const savedLeft = Math.max(8, Math.min(window.innerWidth - toolbar.offsetWidth - 8, window.customToolbarLeft));
        const savedTop = Math.max(8, Math.min(window.innerHeight - toolbar.offsetHeight - 8, window.customToolbarTop));
        toolbar.style.left = savedLeft + 'px';
        toolbar.style.top = savedTop + 'px';
        window.customToolbarLeft = savedLeft;
        window.customToolbarTop = savedTop;
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
    // Agrupar mantiene su API histórica; Desagrupar solo publica el
    // dispatcher canónico de ungroupRoutes.js.
    window.groupSelectedItems = groupSelectedItems;
    window.ekkoGroupNormal = groupSelectedItems;
    window.ekkoUngroupNormal = dispatchUngroup;
}




// Text-size ownership is canonical in rotationController; this module only owns curvature.
(function bindTextCurveInput(){
  let bound = false;
  const iv = setInterval(() => {
    if (bound) { clearInterval(iv); return; }
    const curveSlider = document.querySelector('#ctxTextCurvature input[type=range]');
    if (!curveSlider) return;
    bound = true;
    curveSlider.addEventListener('input', () => {
      try { const sel = window.selectedItem || window.selectedItems?.[0]; if (sel) window.dispatchTextCurve?.(); } catch (e) {}
    });
    clearInterval(iv);
  }, 200);
  setTimeout(() => clearInterval(iv), 8000);
})();

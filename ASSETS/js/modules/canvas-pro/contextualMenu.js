/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js (PRO Edition v33.2 - Symmetrical Group & Layer Safety - Full Unified Multi-Selection)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/contextualMenu.js
Descripción:
Gestor unificado del menú contextual, tipografías dinámicas, transformaciones
y barra de acciones para EKKO Studio.
Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt & EKKO_DIAG v6.2):
  * Desagrupación completa en 1 clic con SELECCIÓN UNIFICADA LIMPIA DE TODAS LAS CAPAS LIBERADAS.
  * Eliminada la selección arbitraria obligatoria del objeto más profundo (layerDepth máximo).
  * Posicionamiento preciso del menú contextual en selecciones simples y múltiples sobre bounding box unificado (getUnifiedScreenBounds).
  * Agrupación simétrica y 100% reversible preservando masas, calados (isHole), geomBase y orden Z.
  * Salida limpia del modo edición de nodos antes de descomponer.
========================================================================= */

import { toggleBold, toggleItalic, toggleUnderline, weldText, applyTextCurve, applyTextSpacing, loadDynamicFonts } from "./textToolbar.js";
import { scaleImage, duplicateImage, deleteImage, bringImageForward, sendImageBackward, applyBrightnessContrast } from "./imageToolbar.js";
import { enterNodeEditMode, exitNodeEditMode } from "./nodeEditor.js";
import { decomposeByContainmentHierarchy, recalculateDynamicSubtractions } from "./geometricUngroup.js";

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

// Estilos CSS para el menú de fuentes
const dropdownStylesId = 'ekko-custom-dropdown-styles';
if (typeof document !== 'undefined' && !document.getElementById(dropdownStylesId)) {
    const styleEl = document.createElement('style');
    styleEl.id = dropdownStylesId;
    styleEl.textContent = `
        .custom-font-dropdown { position: relative; min-width: 180px; height: 34px; background: white; border: 1px solid #ccc; border-radius: 6px; user-select: none; display: inline-block; vertical-align: middle; }
        .selected-font-trigger { display: flex; align-items: center; justify-content: space-between; padding: 0 10px; height: 100%; cursor: pointer; font-size: 13px; color: #333; }
        .selected-font-trigger:hover { border-color: #999; }
        .font-dropdown-list { position: absolute; top: 100%; left: 0; right: 0; max-height: 250px; overflow-y: auto; background: white; border: 1px solid #ccc; border-radius: 6px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); z-index: 10000; margin-top: 4px; }
        .font-item-preview { padding: 8px 12px; cursor: pointer; border-bottom: 1px solid #f0f0f0; display: flex; flex-direction: column; gap: 2px; }
        .font-item-preview:hover { background-color: #e6f7ff; }
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
    if (!item) return;
    const target = item.data?.clipGroup ? getContentItem(item) : item;
    if (!target) return;
    if (isPointText(target)) {
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
                const isHidden = list.classList.contains('hidden');
                if (isHidden) {
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
 * Sincronizado para 100% de reversibilidad simétrica (Rule 7).
 */
export function groupSelectedItems() {
    const selected = (window.selectedItems && window.selectedItems.length > 0)
        ? [...window.selectedItems]
        : (window.selectedItem ? [window.selectedItem] : []);

    if (selected.length <= 1) return;

    if (typeof window.saveHistory === 'function') window.saveHistory();

    const shouldClip = selected.some(it => it.data && it.data.clipGroup);
    const parentLayer = selected[0].layer || (paper.project ? paper.project.activeLayer : null);

    // Ordenar elementos en orden de apilamiento Z real
    selected.sort((a, b) => a.index - b.index);

    const newGroup = new paper.Group();
    newGroup.data = {
        locked: false,
        label: "Grupo",
        isGroupedLayer: true
    };

    selected.forEach(it => {
        if (it.data && it.data.clipGroup) {
            const content = getContentItem(it);
            if (content) {
                newGroup.addChild(content);
            }
            it.remove();
        } else {
            newGroup.addChild(it);
        }
    });

    let finalGroup = newGroup;
    if (shouldClip && typeof window !== 'undefined' && typeof window.clipItem === 'function') {
        finalGroup = window.clipItem(newGroup);
        if (window.currentMockup) {
            finalGroup.insertBelow(window.currentMockup);
        }
    } else if (parentLayer) {
        parentLayer.addChild(finalGroup);
    }

    if (typeof window.deselectItem === 'function') window.deselectItem();
    window.selectedItem = finalGroup;
    window.selectedItems = [finalGroup];
    finalGroup.selected = true;

    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(finalGroup);
    }
    if (typeof updateContextualMenu === 'function') {
        updateContextualMenu(finalGroup);
    }

    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }
    paper.view.update();
}

/**
 * DESAGRUPAR: Descomposición atómica completa en 1 solo clic.
 * Cumple rigurosamente con:
 * - Descomposición atómica de todos los niveles en un único clic.
 * - Reversibilidad simétrica: disuelve grupos de capas conservando identidad, geomBase, isHole y orden Z.
 * - Selección unificada en bloque de todas las capas liberadas.
 * - Posicionamiento de la barra contextual y cotas envolviendo la multiselección completa.
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
        const target = isClipped ? getContentItem(item) : item;
        if (!target) return;

        // Si es un grupo previamente formado por groupSelectedItems (simetría inversa)
        if (target instanceof paper.Group && target.data?.isGroupedLayer) {
            const children = [...target.children];
            children.forEach(child => {
                let finalItem = child;
                if (isClipped && typeof window.clipItem === 'function') {
                    finalItem = window.clipItem(child);
                } else if (item.layer) {
                    item.layer.addChild(finalItem);
                }
                allCreatedItems.push(finalItem);
            });
            item.remove();
        } else {
            // Descomposición atómica estándar por Jerarquía de Contención
            const result = decomposeByContainmentHierarchy(item, isClipped);
            if (result && result.handled && result.items) {
                result.items.forEach(it => allCreatedItems.push(it));
            }
        }
    });

    if (allCreatedItems.length > 0) {
        if (typeof window.deselectItem === 'function') window.deselectItem();
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

/**
 * Calcula los límites unificados (bounding box de pantalla) para ubicar la barra contextual.
 */
function getUnifiedScreenBounds(item) {
    const canvasEl = document.getElementById("editorCanvas");
    if (!canvasEl || typeof paper === 'undefined' || !paper.view) return null;

    const canvasRect = canvasEl.getBoundingClientRect();
    let combinedBounds = null;

    if (window.selectedItems && window.selectedItems.length > 0) {
        window.selectedItems.forEach(it => {
            const tgt = it.data?.clipGroup ? getContentItem(it) : it;
            if (tgt && tgt.bounds && tgt.visible !== false) {
                combinedBounds = combinedBounds ? combinedBounds.unite(tgt.bounds) : tgt.bounds.clone();
            }
        });
    }

    if (!combinedBounds && item) {
        const tgt = item.data?.clipGroup ? getContentItem(item) : item;
        if (tgt && tgt.bounds) {
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

    setClick('btnCtxDelete', () => {
        if (window.selectedItem) {
            deleteImage(window.selectedItem);
            hideContextualMenu();
            if (typeof window.recalculateDynamicSubtractions === 'function') {
                window.recalculateDynamicSubtractions();
            }
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
        if (window.selectedItem && typeof enterNodeEditMode === 'function') {
            enterNodeEditMode(window.selectedItem);
        }
    });
    setClick('btnCtxNodeEdit', () => {
        if (window.selectedItem && typeof enterNodeEditMode === 'function') {
            enterNodeEditMode(window.selectedItem);
        }
    });

    window.groupSelectedItems = groupSelectedItems;
    window.ungroupSelectedItem = ungroupSelectedItem;
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
                    const canUngroup = window.selectedItems.some(it => {
                        const t = it.data?.clipGroup ? getContentItem(it) : it;
                        return t && (isGroup(t) || isSymbolItem(t) || (isCompoundPath(t) && !t.data?.decomposedLayer));
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
    } else {
        const target = item.data?.clipGroup ? getContentItem(item) : item;
        if (!target) return;

        if (isPointText(target) || target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
            const txtCtrl = document.getElementById('ctxTextControls');
            if (txtCtrl) txtCtrl.classList.remove('hidden');
            const fontTrigger = document.querySelector('.selected-font-trigger span');
            if (fontTrigger) fontTrigger.textContent = target.fontFamily || "Arial";
        } else if (isRaster(target)) {
            const imgCtrl = document.getElementById('ctxImageControls');
            if (imgCtrl) imgCtrl.classList.remove('hidden');
            if (btnTrace) btnTrace.style.display = 'inline-block';
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
                    const canUngroup = isGroup(target) || isSymbolItem(target) || (isCompoundPath(target) && !target.data?.decomposedLayer);
                    btnUngroup.style.display = canUngroup ? 'inline-block' : 'none';
                }
            }
        }
    }

    // Posicionamiento de pantalla sobre el Bounding Box unificado
    if (!toolbarDragged) {
        const screenPos = getUnifiedScreenBounds(item);
        if (screenPos) {
            const toolbarW = toolbar.offsetWidth || 320;
            const toolbarH = toolbar.offsetHeight || 44;
            const x = screenPos.x - (toolbarW / 2);
            const y = screenPos.y - toolbarH - 14;

            toolbar.style.left = Math.max(10, Math.min(window.innerWidth - toolbarW - 10, x)) + 'px';
            toolbar.style.top = Math.max(10, y) + 'px';
            toolbar.style.zIndex = "2147483647";
        }
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

if (typeof window !== 'undefined') {
    window.updateContextualMenu = updateContextualMenu;
    window.hideContextualMenu = hideContextualMenu;
    window.initContextualMenu = initContextualMenu;
}

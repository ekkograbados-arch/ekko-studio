/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/contextualMenu.js (PRO Edition v33 - Symmetrical Group & Layer Safety - Full Unified Multi-Selection)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/contextualMenu.js
Descripción:
Gestor unificado del menú contextual, tipografías dinámicas, transformaciones
y barra de acciones para EKKO Studio.
Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt):
  * Desagrupación completa en 1 clic con SELECCIÓN UNIFICADA LIMPIA DE TODAS LAS CAPAS LIBERADAS.
  * Eliminada la selección arbitraria obligatoria del objeto más profundo (layerDepth máximo).
  * Posicionamiento preciso del menú contextual en selecciones simples y múltiples sobre bounding box unificado.
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
        .font-dropdown-list { position: absolute; top: 100%; left: 0; right: 0; max-height: 240px; overflow-y: auto; background: white; border: 1px solid #ccc; border-top: none; border-radius: 0 0 6px 6px; z-index: 1000; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
        .font-dropdown-item { padding: 8px 12px; cursor: pointer; display: flex; flex-direction: column; border-bottom: 1px solid #f0f0f0; }
        .font-dropdown-item:hover { background: #f5f5f5; }
        .font-dropdown-item:last-child { border-bottom: none; }
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
    } else if (target.data?.isCurvedGroup || target.data?.isSpacedGroup) {
        target.data.fontFamily = family;
        target.children.forEach(c => {
            if (isPointText(c)) c.fontFamily = family;
        });
    }
    paper.view.update();
}

function renderCustomFontItems(listContainer, fonts) {
    listContainer.innerHTML = '';
    const sampleText = getSelectedTextString();
    fonts.forEach(font => {
        const item = document.createElement('div');
        item.className = 'font-dropdown-item';
        item.innerHTML = `
            <span style="font-size: 11px; color: #888;">${font.name}</span>
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

    if (selected.length < 2) {
        alert("Selecciona al menos 2 elementos para poder agruparlos.");
        return;
    }

    if (typeof window.saveHistory === 'function') window.saveHistory();

    const parent = selected[0].parent || paper.project.activeLayer;
    const lowestIndex = Math.min(...selected.map(it => parent.children.indexOf(it)));

    // Determinar si alguna de las capas seleccionadas está recortada en producto
    const shouldClip = selected.some(it => !!(it.data && it.data.clipGroup)) ||
        (typeof window !== 'undefined' && typeof window.clipItem === 'function' && !window.infiniteCanvasMode && !!window.clipMask);

    const newGroup = new paper.Group();
    newGroup.data = {
        locked: false,
        isCompoundGroup: true,
        geometricHierarchy: "compoundGroup",
        label: "Grupo de Capas (" + selected.length + ")"
    };

    // Ordenar preservando la secuencia de apilamiento Z
    selected.sort((a, b) => parent.children.indexOf(a) - parent.children.indexOf(b));

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
    }

    parent.insertChild(lowestIndex, finalGroup);

    if (typeof window.deselectItem === 'function') window.deselectItem();
    if (typeof window.selectItem === 'function') window.selectItem(finalGroup);

    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }

    paper.view.update();
}

/**
 * DESAGRUPAR: Descomposición completa en 1 clic con selección unificada limpia.
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
        const actualItem = isClipped ? getContentItem(item) : item;
        if (!actualItem) return;

        // Verificación de simetría Reversible:
        // Si el elemento es un Grupo que contiene capas ya descompuestas (agrupadas previamente con Agrupar / Ctrl+G),
        // disolvemos el grupo directamente conservando intacta la identidad de cada capa, su geomBase, isHole y orden Z.
        const isLayerGroup = isGroup(actualItem) && (
            actualItem.data?.geometricHierarchy === "compoundGroup" ||
            actualItem.data?.isCompoundGroup === true
        );

        if (isLayerGroup) {
            const groupParent = (isClipped && item.parent) ? item.parent : (actualItem.parent || paper.project.activeLayer);
            const groupChildren = [...actualItem.children];
            
            groupChildren.forEach(child => {
                let releasedItem = child;
                if (isClipped && typeof window !== 'undefined' && typeof window.clipItem === 'function') {
                    releasedItem = window.clipItem(child);
                    if (window.currentMockup) {
                        releasedItem.insertBelow(window.currentMockup);
                    }
                }
                if (groupParent) groupParent.addChild(releasedItem);
                allCreatedItems.push(releasedItem);
            });

            if (isClipped) {
                item.remove();
            } else {
                actualItem.remove();
            }
        } else {
            // Descomposición por Jerarquía de Contención en 1 Clic (para SVGs importados o nuevos compuestos)
            const canDecompose = isGroup(actualItem) || isSymbolItem(actualItem) || (isCompoundPath(actualItem) && !actualItem.data?.decomposedLayer);
            if (canDecompose) {
                const result = decomposeByContainmentHierarchy(actualItem, isClipped);
                if (result && result.items && result.items.length > 0) {
                    if (isClipped && item.parent) item.remove();
                    allCreatedItems.push(...result.items);
                }
            } else if (actualItem.data?.decomposedLayer) {
                // Es una capa atómica independiente ya descompuesta: permanece intacta
                allCreatedItems.push(actualItem);
            }
        }
    });

    // SELECCIÓN UNIFICADA LIMPIA DE TODAS LAS CAPAS LIBERADAS
    if (allCreatedItems.length > 0) {
        if (typeof window.deselectItem === 'function') {
            window.deselectItem();
        }

        window.selectedItems = [...allCreatedItems];
        // Asignar el elemento primario como ancla, pero marcando a todos como seleccionados
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

    // POSICIONAMIENTO UNIFICADO DEL TOOLBAR (Para selección simple y multiselección)
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
            toolbar.style.zIndex = "2147483647";
        }
    }

    lastSelectedItem = item;
}

export function hideContextualMenu() {
    const toolbar = document.getElementById("contextual-toolbar");
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

if (typeof window !== 'undefined') {
    window.groupSelectedItems = groupSelectedItems;
    window.ungroupSelectedItem = ungroupSelectedItem;
    window.updateContextualMenu = updateContextualMenu;
    window.hideContextualMenu = hideContextualMenu;
    window.initContextualMenu = initContextualMenu;
}


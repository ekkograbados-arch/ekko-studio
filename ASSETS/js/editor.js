/* =========================================================================
Módulo: ASSETS/js/editor.js (v12 PRO - COMPLETO CON SELECCIÓN UNIFICADA CANVA-STYLE)
Ruta de reemplazo: ASSETS/js/editor.js
Descripción: Núcleo de la aplicación EKKO Studio basado en Paper.js.
Controla la inicialización de la escena, carga de mockups, alineaciones,
transformaciones, operaciones de zoom y sincronización asíncrona de
tipografías globales del backend.

ESTADO: ESTABLE, OPTIMIZADO Y ADAPTADO PARA CAJA DE SELECCIÓN GRUPAL UNIFICADA.
========================================================================= */

import "./modules/selection.js"; // REQUERIDO: Cargar manipuladores de selección globales
import { loadDynamicFonts } from "./modules/canvas-pro/textToolbar.js";
import { loadDynamicProducts } from "./modules/productsLoader.js";
import { restoreMockupReferences, loadMockup } from "./modules/mockupLoader.js";
import { updateContextualMenu, hideContextualMenu, initContextualMenu } from "./modules/canvas-pro/contextualMenu.js";
import { startTextEditing } from "./modules/textEditor.js";
// 🚀 INTEGRACIÓN: Importar controlador PRO para reglas, guías inteligentes, acotaciones y alineaciones
import { initProControls } from "./modules/canvas-pro/canvasControlsIntegration.js";

// --- CONFIGURACIÓN DE DEPURACIÓN DE EKKO STUDIO ---
const DEBUG_MODE = true; // Cambia a true para ver la consola F12 con archivos y líneas reales al programar
if (!DEBUG_MODE) {
    // Apagamos logs y mensajes comunes para que en F12 salgan únicamente los errores y advertencias de código reales
    console.log = () => {};
    console.info = () => {};
    console.debug = () => {};
}

window.addEventListener("DOMContentLoaded", () => {
    // --- INYECCIÓN DINÁMICA DE INTERFAZ: DROP DOWN DE FUENTES PERSONALIZADO (Garantía WYSIWYG) ---
    const nativeSelect = document.getElementById('ctxFontSelector');
    if (nativeSelect) {
        let customDropdown = document.querySelector('.custom-font-dropdown');
        if (!customDropdown) {
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
    }

    // --- INYECCIÓN DINÁMICA DE ESTILOS DE LIENZO INFINITO (ESTILO FIGMA/CANVA) ---
    const infiniteCanvasStylesId = 'ekko-infinite-canvas-styles';
    if (!document.getElementById(infiniteCanvasStylesId)) {
        const styleEl = document.createElement('style');
        styleEl.id = infiniteCanvasStylesId;
        styleEl.textContent = `
            #editorCanvas {
                width: 100% !important;
                height: 100% !important;
                background-color: #e2e8f0 !important; /* Gris de espacio de trabajo Canva/Figma */
                border: none !important;
                box-shadow: none !important;
            }
            #canvasContainer {
                padding: 0 !important;
                overflow: hidden !important;
                display: flex;
                align-items: stretch;
                justify-content: stretch;
            }
        `;
        document.head.appendChild(styleEl);
    }

    // 1. Inicializar Paper.js de forma segura en el lienzo
    const canvasEl = document.getElementById("editorCanvas");
    const containerEl = document.getElementById("canvasContainer");
    if (canvasEl && containerEl) {
        // Forzar modo de lienzo infinito globalmente
        window.infiniteCanvasMode = true;

        // ESPERA TÉCNICA (50ms): Esperar a que el motor de renderizado CSS del navegador pinte el layout 100%
        // Esto previene de raíz el flicker (efecto parpadeo de la hoja A4) y sincroniza exactamente las coordenadas
        setTimeout(() => {
            try {
                const initialWidth = containerEl.clientWidth || window.innerWidth;
                const initialHeight = containerEl.clientHeight || window.innerHeight;
                canvasEl.width = initialWidth;
                canvasEl.height = initialHeight;
                paper.setup("editorCanvas");
                paper.view.viewSize = new paper.Size(initialWidth, initialHeight);

                // Asegurar que tenemos un layer de diseño y un layer de fondo
                let backLayer = paper.project.layers.find(l => l.name === 'backgroundLayer');
                if (!backLayer) {
                    backLayer = new paper.Layer();
                    backLayer.name = 'backgroundLayer';
                    paper.project.insertLayer(0, backLayer);
                }

                let designLayer = paper.project.layers.find(l => l.name === 'designLayer');
                if (!designLayer) {
                    designLayer = new paper.Layer();
                    designLayer.name = 'designLayer';
                }
                designLayer.activate();

                paper.view.center = new paper.Point(0, 0); // Centrar cámara en el origen (0, 0)

                // Inicializar herramienta de selección después de paper.setup
                if (typeof window.initSelectionTool === "function") {
                    window.initSelectionTool();
                }

                // Inicializar Menú Contextual Arrastrable y Custom Dropdowns
                if (typeof initContextualMenu === "function") {
                    initContextualMenu();
                }

                // Inicializar Zoom y Panorámica Interactiva de Alto Rendimiento en el Lienzo
                if (typeof initCanvasZoomAndPan === "function") {
                    initCanvasZoomAndPan();
                }

                // Inyectar el control de rotación en la barra emergente de forma dinámica
                if (typeof injectRotationControlToToolbar === "function") {
                    injectRotationControlToToolbar();
                }

                // Inicializar Barra de Alineación, Distribución, Zoom en tiempo real, Reglas y Cotas
                if (typeof initProControls === "function") {
                    initProControls();
                }

                console.log("🚀 EKKO Studio inicializado con dimensiones estables de viewport:", initialWidth, "x", initialHeight);
            } catch (err) {
                console.error("❌ Error crítico durante la inicialización del lienzo de Paper.js:", err);
                alert("Atención: Ocurrió un error al cargar el lienzo. Revisa la consola F12 para más detalles.");
            }
        }, 50);
    }
});

// --- Variables de Estado Global del Editor ---
const toolState = {
    currentCategory: 0,
    currentProduct: null,
    currentSurface: 0,
    zoom: 1
};
const sceneStates = {};
const undoStack = [];
const redoStack = [];
window.loadToken = 0;
window.selectedItem = null;

window.getRealProductDimensions = function(product) {
    if (!product) return { width: 50, height: 50 };
    const id = (product.id || "").toLowerCase();
    const nombre = (product.nombre || "").toLowerCase();
    const regexX = /(\d+)\s*x\s*(\d+)/;
    const matchX = id.match(regexX) || nombre.match(regexX);
    if (matchX) {
        let w = parseFloat(matchX[2]);
        let h = parseFloat(matchX[1]);
        return { width: w, height: h, parsed: true };
    }
    const regexMm = /(\d+)\s*mm/;
    const matchMm = id.match(regexMm) || nombre.match(regexMm);
    if (matchMm) {
        const val = parseFloat(matchMm[1]);
        return { width: val, height: val, parsed: true };
    }
    if (id.includes("huesito")) {
        if (id.includes("16")) return { width: 32, height: 16 };
        if (id.includes("21")) return { width: 40, height: 21 };
        return { width: 32, height: 16 };
    }
    if (id.includes("militar")) {
        if (id.includes("25")) return { width: 25, height: 45 };
        if (id.includes("29")) return { width: 29, height: 50 };
        return { width: 25, height: 45 };
    }
    if (id.includes("redonda")) {
        return { width: 25, height: 25 };
    }
    if (id.includes("pulsera")) {
        if (id.includes("chica") || id.includes("30")) return { width: 30, height: 5 };
        if (id.includes("grande") || id.includes("35")) return { width: 35, height: 6 };
        return { width: 30, height: 5 };
    }
    if (id.includes("mate-acero") || id.includes("mate_acero")) {
        return { width: 80, height: 80 };
    }
    if (id.includes("algarrobo")) {
        return { width: 70, height: 70 };
    }
    return { width: 50, height: 50 };
};

window.updateGlobalScaleFactor = function() {
    if (!window.currentMockup || !window.paper) {
        window.paperUnitsPerMm = 1.0;
        window.mmPerPaperUnit = 1.0;
        return;
    }
    let product = null;
    if (typeof toolState !== "undefined" && toolState.currentProduct) {
        product = toolState.currentProduct;
    }
    const realDims = window.getRealProductDimensions(product);
    const mockupBounds = window.currentMockup.bounds;
    let realW = realDims.width;
    let realH = realDims.height;
    const ratioReal = realW / realH;
    const ratioMockup = mockupBounds.width / mockupBounds.height;
    if ((ratioReal > 1 && ratioMockup < 1) || (ratioReal < 1 && ratioMockup > 1)) {
        const temp = realW;
        realW = realH;
        realH = temp;
    }
    window.paperUnitsPerMm = mockupBounds.width / realW;
    window.mmPerPaperUnit = 1 / window.paperUnitsPerMm;
};

window.selectedItems = []; // NUEVO: Soporte para selección múltiple
window.dragOffset = null;
window.dragging = false;
let lastSizeField = "width";
let clipboardItem = null;

const ui = {
    categoryTabs: document.getElementById("categoryTabs"),
    productTabs: document.getElementById("productTabs"),
    surfaceTabs: document.getElementById("surfaceTabs"),
    selectionInfo: document.getElementById("selectionInfo"),
    imagePicker: document.getElementById("imagePicker"),
    svgPicker: document.getElementById("svgPicker"),
    objWidth: document.getElementById("objWidth"),
    objHeight: document.getElementById("objHeight"),
    lockRatio: document.getElementById("lockRatio"),
    btnApplySize: document.getElementById("btnApplySize"),
    btnToggleLock: document.getElementById("btnToggleLock"),
    btnAlignLeft: document.getElementById("btnAlignLeft"),
    btnAlignCenterH: document.getElementById("btnAlignCenterH"),
    btnAlignRight: document.getElementById("btnAlignRight"),
    btnAlignTop: document.getElementById("btnAlignTop"),
    btnAlignCenterV: document.getElementById("btnAlignCenterV"),
    btnAlignBottom: document.getElementById("btnAlignBottom"),
    btnRotateLeft: document.getElementById("btnRotateLeft"),
    btnRotateRight: document.getElementById("btnRotateRight"),
    btnRotate180: document.getElementById("btnRotate180"),
    btnCenterH: document.getElementById("btnCenterH"),
    btnCenterV: document.getElementById("btnCenterV"),
    btnCenterBoth: document.getElementById("btnCenterBoth"),
    btnForward: document.getElementById("btnForward"),
    btnBackward: document.getElementById("btnBackward")
};

function getSceneKey(product, surface) {
    if (!product || !surface) return "default_scene";
    return `${product.id}__${surface.nombre}`;
}

function saveHistory() {
    undoStack.push(paper.project.exportJSON({ asString: true }));
    if (undoStack.length > 50) {
        undoStack.shift();
    }
    redoStack.length = 0;
}
window.saveHistory = saveHistory;

// Función de limpieza de elementos fantasma importados (barrera de seguridad)
function cleanGhostInterfaceItems() {
    if (typeof paper !== "undefined" && paper.project) {
        paper.project.getItems({
            match: function(item) {
                return item.data && (
                    item.data.isSelectionBox ||
                    item.data.isNodeEditOverlay ||
                    item.data.isHandle ||
                    item.data.isNodeHandle ||
                    item.data.isCurveHandle
                );
            }
        }).forEach(function(item) {
            item.remove();
        });
    }
}

function undo() {
    if (undoStack.length === 0) return;
    redoStack.push(paper.project.exportJSON({ asString: true }));
    const state = undoStack.pop();
    paper.project.clear();
    paper.project.importJSON(state);
    cleanGhostInterfaceItems();
    window.deselectItem();
    if (typeof restoreMockupReferences === "function") {
        restoreMockupReferences();
    }
    paper.view.update();
}

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(paper.project.exportJSON({ asString: true }));
    const state = redoStack.pop();
    paper.project.clear();
    paper.project.importJSON(state);
    cleanGhostInterfaceItems();
    window.deselectItem();
    if (typeof restoreMockupReferences === "function") {
        restoreMockupReferences();
    }
    paper.view.update();
}

function isLockedItem(item) {
    return item && item.data && item.data.locked === true;
}

function updateSelectionInfo() {
    if (!window.selectedItem) {
        if (ui.selectionInfo) ui.selectionInfo.textContent = "Nada seleccionado";
        if (ui.objWidth) ui.objWidth.value = "";
        if (ui.objHeight) ui.objHeight.value = "";
        return;
    }
    const displayItem = (window.selectedItem.data && window.selectedItem.data.clipGroup)
        ? window.selectedItem.children.find(c => !c.clipMask)
        : window.selectedItem;
    if (displayItem && ui.selectionInfo) {
        ui.selectionInfo.textContent = displayItem.data?.label || "Objeto";
        if (ui.objWidth) ui.objWidth.value = (displayItem.bounds.width * (window.mmPerPaperUnit || 1.0)).toFixed(1);
        if (ui.objHeight) ui.objHeight.value = (displayItem.bounds.height * (window.mmPerPaperUnit || 1.0)).toFixed(1);
    }
}

function updateLockButton() {
    if (!ui.btnToggleLock) return;
    if (!window.selectedItem) {
        ui.btnToggleLock.textContent = "Bloquear / Desbloquear";
        return;
    }
    ui.btnToggleLock.textContent = isLockedItem(window.selectedItem) ? "Desbloquear" : "Bloquear";
}

function toggleLockSelected() {
    if (!window.selectedItem) return;
    window.selectedItem.data = window.selectedItem.data || {};
    window.selectedItem.data.locked = !window.selectedItem.data.locked;
    updateSelectionInfo();
    updateLockButton();
    paper.view.update();
}

window.selectItem = function(item, isMulti = false) {
    if (window.nodeEditMode) {
        window.exitNodeEditMode();
    }
    if (!item || (item.data && item.data.mockup)) {
        window.deselectItem();
        return;
    }
    if (!window.selectedItems) window.selectedItems = [];
    if (isMulti) {
        const idx = window.selectedItems.indexOf(item);
        if (idx > -1) {
            window.selectedItems.splice(idx, 1);
        } else {
            window.selectedItems.push(item);
        }
        window.selectedItem = window.selectedItems[window.selectedItems.length - 1] || null;
    } else {
        window.selectedItems = [item];
        window.selectedItem = item;
    }
    if (window.selectedItems.length === 0) {
        window.deselectItem();
        return;
    }
    window.updateSelectionBox(window.selectedItem);
    updateSelectionInfo();
    updateLockButton();

    const rotationNum = document.getElementById('ctxRotationNum');
    if (rotationNum) {
        const displayItem = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        const rot = Math.round(displayItem?.data?.rotation || 0);
        rotationNum.value = rot + '°';
    }
    if (typeof updateContextualMenu === "function") {
        updateContextualMenu(window.selectedItem);
    }
    paper.view.update();
};

window.deselectItem = function() {
    if (window.nodeEditMode) {
        window.exitNodeEditMode();
    }
    if (window.selectedItems && window.selectedItems.length > 0) {
        window.selectedItems.forEach(it => { if (it) it.selected = false; });
    }
    if (window.selectedItem) {
        window.selectedItem.selected = false;
    }
    window.selectedItem = null;
    window.selectedItems = [];
    window.updateSelectionBox(null);
    if (ui.selectionInfo) ui.selectionInfo.textContent = "Nada seleccionado";
    if (ui.objWidth) ui.objWidth.value = "";
    if (ui.objHeight) ui.objHeight.value = "";
    updateLockButton();

    const rotationNum = document.getElementById('ctxRotationNum');
    if (rotationNum) {
        rotationNum.value = "0°";
    }
    if (typeof hideContextualMenu === "function") {
        hideContextualMenu();
    }
    paper.view.update();
};

function saveCurrentScene() {
    if (!toolState.currentProduct || !toolState.currentProduct.superficies) return;
    const idx = toolState.currentSurface || 0;
    const surface = toolState.currentProduct.superficies[idx];
    if (!surface) return;
    const key = getSceneKey(toolState.currentProduct, surface);
    const prevSelected = window.selectedItem;
    window.deselectItem();
    sceneStates[key] = paper.project.exportJSON({ asString: true });
    if (prevSelected) {
        window.selectItem(prevSelected);
    }
}

function loadSurfaceScene(product, surface) {
    if (!product || !surface) return;
    const key = getSceneKey(product, surface);
    window.deselectItem();
    paper.view.zoom = 1.0;
    paper.view.center = new paper.Point(0, 0);
    if (sceneStates[key]) {
        paper.project.clear();
        paper.project.importJSON(sceneStates[key]);
        cleanGhostInterfaceItems();
        window.deselectItem();
        if (typeof restoreMockupReferences === "function") {
            restoreMockupReferences();
            if (typeof window.updateGlobalScaleFactor === "function") window.updateGlobalScaleFactor();
        }
        paper.view.update();
        return;
    }
    loadMockup(surface.svg);
    setTimeout(() => { if (typeof window.updateGlobalScaleFactor === "function") window.updateGlobalScaleFactor(); }, 600);
}

function copySelected() {
    if (!window.selectedItem) return;
    if (isLockedItem(window.selectedItem)) return;
    clipboardItem = window.selectedItem.clone();
}

function pasteSelected() {
    if (!clipboardItem) return;
    saveHistory();
    const clone = clipboardItem.clone();
    clone.position = clone.position.add(new paper.Point(20, 20));
    clone.data = { ...(clone.data || {}), locked: false };
    paper.project.activeLayer.addChild(clone);
    window.selectItem(clone);
    paper.view.update();
}

function bringFront() {
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
    window.selectedItem.bringToFront();
    if (window.currentMockup) {
        window.currentMockup.bringToFront();
    }
    window.updateSelectionBox(window.selectedItem);
    paper.view.update();
}

function sendBack() {
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
    window.selectedItem.sendToBack();
    if (window.currentMockup) {
        window.selectedItem.insertBelow(window.currentMockup);
    }
    window.updateSelectionBox(window.selectedItem);
    paper.view.update();
}

function bringForward() {
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
    window.selectedItem.insertAbove(window.selectedItem.nextSibling);
    if (window.currentMockup) {
        window.currentMockup.bringToFront();
    }
    window.updateSelectionBox(window.selectedItem);
    paper.view.update();
}

function sendBackward() {
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
    window.selectedItem.insertBelow(window.selectedItem.previousSibling);
    window.updateSelectionBox(window.selectedItem);
    paper.view.update();
}

function addImageFromFile(file) {
    if (!file) return;
    saveHistory();
    const reader = new FileReader();
    reader.onload = (e) => {
        const raster = new paper.Raster({ source: e.target.result });
        raster.onLoad = () => {
            if (window.paper && paper.project) {
                const designLayer = paper.project.layers.find(l => l.name === 'designLayer');
                if (designLayer) designLayer.activate();
            }
            raster.data = { locked: false, label: "Imagen" };
            const area = paper.view.bounds;
            const maxWidth = area.width * 0.60;
            const maxHeight = area.height * 0.60;
            const scale = Math.min(maxWidth / raster.width, maxHeight / raster.height);
            raster.scale(scale);
            raster.position = area.center;
            const objeto = window.clipItem(raster);
            if (window.currentMockup) {
                objeto.insertBelow(window.currentMockup);
            }
            window.selectItem(objeto);
            paper.view.update();
        };
    };
    reader.readAsDataURL(file);
}

function addSVGFromFile(file) {
    if (!file) return;
    saveHistory();
    const reader = new FileReader();
    reader.onload = (e) => {
        paper.project.importSVG(e.target.result, (item) => {
            if (window.paper && paper.project) {
                const designLayer = paper.project.layers.find(l => l.name === 'designLayer');
                if (designLayer) designLayer.activate();
            }
            if (!item) return;
            item.data = { locked: false, label: file.name.replace(".svg", "") };
            const bounds = item.bounds;
            const canvasBounds = paper.view.bounds;
            const scaleX = (canvasBounds.width * 0.45) / bounds.width;
            const scaleY = (canvasBounds.height * 0.45) / bounds.height;
            const scale = Math.min(scaleX, scaleY);
            item.scale(scale);
            item.position = canvasBounds.center;
            paper.project.activeLayer.addChild(item);
            const objeto = window.clipItem(item);
            if (window.currentMockup) {
                objeto.insertBelow(window.currentMockup);
            }
            window.selectItem(objeto);
            paper.view.update();
        });
    };
    reader.readAsText(file);
}

function renderCategories() {
    if (!ui.categoryTabs) return;
    ui.categoryTabs.innerHTML = "";
    window.EKKO_STUDIO_PRODUCTS.forEach((group, index) => {
        const btn = document.createElement("button");
        btn.className = "tab-btn" + (toolState.currentCategory === index ? " active" : "");
        btn.textContent = group.categoria;
        btn.onclick = () => {
            saveCurrentScene();
            toolState.currentCategory = index;
            toolState.currentProduct = null;
            toolState.currentSurface = 0;
            renderCategories();
            renderProducts(index);
        };
        ui.categoryTabs.appendChild(btn);
    });
}

function renderProducts(categoryIndex, activeProduct = null) {
    if (ui.productTabs) ui.productTabs.innerHTML = "";
    if (ui.surfaceTabs) ui.surfaceTabs.innerHTML = "";
    const group = window.EKKO_STUDIO_PRODUCTS[categoryIndex];
    if (!group || !group.productos || group.productos.length === 0) return;
    if (!activeProduct) {
        const current = toolState.currentProduct;
        const belongsToCategory = group.productos.some(p => current && p.id === current.id);
        if (belongsToCategory) {
            activeProduct = current;
        } else {
            activeProduct = group.productos[0];
        }
    }
    toolState.currentProduct = activeProduct;
    group.productos.forEach((prod) => {
        if (ui.productTabs) {
            const btn = document.createElement("button");
            const isSel = (activeProduct && prod.id === activeProduct.id);
            btn.className = "tab-btn" + (isSel ? " active" : "");
            btn.textContent = prod.nombre;
            btn.onclick = () => {
                saveCurrentScene();
                toolState.currentProduct = prod;
                toolState.currentSurface = 0;
                renderProducts(categoryIndex, prod);
            };
            ui.productTabs.appendChild(btn);
        }
    });
    if (activeProduct) {
        renderSurfaces(activeProduct);
        const surfaces = activeProduct.superficies || [];
        const activeSurf = surfaces[toolState.currentSurface] || surfaces[0];
        if (activeSurf) {
            const currentMockupPath = window.currentMockup?.data?.svgPath;
            if (currentMockupPath !== activeSurf.svg) {
                loadSurfaceScene(activeProduct, activeSurf);
            }
        }
    }
}

function renderSurfacesOnly(product) {
    if (!ui.surfaceTabs) return;
    ui.surfaceTabs.innerHTML = "";
    const surfaces = product.superficies || [];
    surfaces.forEach((surf, index) => {
        const btn = document.createElement("button");
        btn.className = "tab-btn" + (toolState.currentSurface === index ? " active" : "");
        btn.textContent = surf.nombre;
        btn.onclick = () => {
            saveCurrentScene();
            toolState.currentSurface = index;
            renderSurfaces(product);
            loadSurfaceScene(product, surf);
        };
        ui.surfaceTabs.appendChild(btn);
    });
}

const safeAddListener = (id, event, fn) => {
    const el = typeof id === "string" ? document.getElementById(id) : id;
    if (el) el.addEventListener(event, fn);
};

function renderSurfaces(product) {
    renderSurfacesOnly(product);
}

function activateTextMode() {
    window.insertTextMode = true;
    paper.view.element.style.cursor = "text";
}

function createEditableText(point) {
    saveHistory();
    let targetPoint = point.clone();
    if (window.currentMockup) {
        const mockupBounds = window.currentMockup.bounds;
        if (!mockupBounds.contains(point)) {
            targetPoint = mockupBounds.center.clone();
        }
    }
    const txt = new paper.PointText({
        point: targetPoint,
        content: "Texto",
        fontSize: 42,
        fillColor: new paper.Color(0),
        justification: "center",
        fontFamily: "Arial"
    });
    txt.data = { locked: false, label: "Texto" };
    paper.project.activeLayer.addChild(txt);
    const clipped = window.clipItem(txt);
    if (window.currentMockup) {
        clipped.insertBelow(window.currentMockup);
    }
    window.selectItem(clipped);
    startTextEditing(txt);
}

// Botones e inicializaciones
safeAddListener("btnAddText", "click", () => {
    let targetPoint = new paper.Point(0, 0);
    if (window.currentMockup) {
        targetPoint = window.currentMockup.bounds.center.clone();
    } else if (paper.view) {
        targetPoint = paper.view.center.clone();
    }
    createEditableText(targetPoint);
});

const obsoleteGallery = document.getElementById("fontGallery");
if (obsoleteGallery) {
    obsoleteGallery.classList.add("hidden");
    obsoleteGallery.style.display = "none";
}

if (paper.view) {
    paper.view.on("mousedown", (event) => {
        if (window.insertTextMode) {
            createEditableText(event.point);
            window.insertTextMode = false;
            paper.view.element.style.cursor = "default";
        }
    });
}

window.addEventListener("resize", () => {
    const canvasEl = document.getElementById("editorCanvas");
    const containerEl = document.getElementById("canvasContainer");
    if (canvasEl && containerEl && paper.view) {
        const w = containerEl.clientWidth || 800;
        const h = containerEl.clientHeight || 600;
        canvasEl.width = w;
        canvasEl.height = h;
        paper.view.viewSize = new paper.Size(w, h);
        paper.view.update();
    }
});

loadDynamicFonts().then(loadedFonts => {
    console.log("🔄 Tipografías del backend sincronizadas en el editor.");
}).catch(err => {
    console.warn("Fallo no crítico al sincronizar fuentes en editor.js:", err);
});

if (typeof loadDynamicProducts === "function") {
    loadDynamicProducts().then(() => {
        console.log("🔄 Actualizando interfaz con el catálogo dinámico...");
        renderCategories();
    }).catch((err) => {
        console.error("❌ Fallo crítico al resolver catálogo dinámico:", err);
        renderCategories();
    });
} else {
    renderCategories();
}

safeAddListener("btnAddImage", "click", () => {
    const imagePicker = document.getElementById("imagePicker");
    if (imagePicker) imagePicker.click();
});
safeAddListener("imagePicker", "change", (e) => {
    const file = e.target.files[0];
    if (file) {
        addImageFromFile(file);
        e.target.value = ""; // Resetear
    }
});

safeAddListener("btnAddSVG", "click", () => {
    const svgPicker = document.getElementById("svgPicker");
    if (svgPicker) svgPicker.click();
});
safeAddListener("svgPicker", "change", (e) => {
    const file = e.target.files[0];
    if (file) {
        addSVGFromFile(file);
        e.target.value = ""; // Resetear
    }
});

const loadQRCodeLibrary = () => {
    return new Promise((resolve) => {
        if (window.QRCode) return resolve();
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
        script.onload = () => resolve();
        document.head.appendChild(script);
    });
};

async function addQRToCanvas(text) {
    await loadQRCodeLibrary();
    saveHistory();
    const tempDiv = document.createElement("div");
    new QRCode(tempDiv, {
        text: text,
        width: 256,
        height: 256,
        correctLevel: QRCode.CorrectLevel.H
    });

    setTimeout(() => {
        const qrCanvas = tempDiv.querySelector("canvas") || tempDiv.querySelector("img");
        if (qrCanvas) {
            const src = qrCanvas.toDataURL ? qrCanvas.toDataURL() : qrCanvas.src;
            const raster = new paper.Raster({ source: src });
            raster.onLoad = () => {
                if (window.paper && paper.project) {
                    const designLayer = paper.project.layers.find(l => l.name === 'designLayer');
                    if (designLayer) designLayer.activate();
                }
                raster.data = { locked: false, label: "Código QR" };
                const area = paper.view.bounds;
                const size = Math.min(area.width, area.height) * 0.3; // Escalar al 30% del lienzo
                raster.scale(size / raster.width);
                raster.position = area.center;
                const objeto = window.clipItem(raster);
                if (window.currentMockup) {
                    objeto.insertBelow(window.currentMockup);
                }
                window.selectItem(objeto);
                paper.view.update();
            };
        }
        tempDiv.remove();
    }, 100);
}

safeAddListener("btnAddQR", "click", () => {
    const text = prompt("Ingrese el texto o enlace (Instagram, WhatsApp, WiFi) para el código QR:", "https://www.instagram.com/grabados_ekko/");
    if (text && text.trim() !== "") {
        addQRToCanvas(text.trim());
    }
});

function initCanvasZoomAndPan() {
    const canvasEl = document.getElementById("editorCanvas");
    if (!canvasEl || !paper.view) {
        console.warn("initCanvasZoomAndPan: Elemento del lienzo o paper.view no disponibles.");
        return;
    }
    window.isPanning = false;
    let panStartPoint = null;
    window.spacePressed = false;

    canvasEl.addEventListener("wheel", (e) => {
        e.preventDefault();
        const oldZoom = paper.view.zoom;
        const factor = 1.12;
        let newZoom = oldZoom;
        if (e.deltaY < 0) {
            newZoom = oldZoom * factor;
        } else {
            newZoom = oldZoom / factor;
        }
        newZoom = Math.max(0.15, Math.min(20.0, newZoom));

        const rect = canvasEl.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        const mouseProjBefore = paper.view.viewToProject(new paper.Point(x, y));
        paper.view.zoom = newZoom;
        const mouseProjAfter = paper.view.viewToProject(new paper.Point(x, y));

        const diff = mouseProjBefore.subtract(mouseProjAfter);
        paper.view.center = paper.view.center.add(diff);
        paper.view.update();

        if (window.selectedItem && typeof window.updateSelectionBox === "function") {
            window.updateSelectionBox(window.selectedItem);
        }
    }, { passive: false });

    window.addEventListener("keydown", (e) => {
        if (e.code === "Space") {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.id === "ekko-text-editor")) {
                return;
            }
            e.preventDefault();
            if (!window.spacePressed) {
                window.spacePressed = true;
                canvasEl.style.cursor = "grab";
            }
        }
    });

    window.addEventListener("keyup", (e) => {
        if (e.code === "Space") {
            window.spacePressed = false;
            canvasEl.style.cursor = "default";
            if (window.isPanning) {
                window.isPanning = false;
            }
        }
    });

    canvasEl.addEventListener("mousedown", (e) => {
        const isLeftButton = e.button === 0;
        const isMiddleButton = e.button === 1;
        if (isMiddleButton || (isLeftButton && window.spacePressed)) {
            window.isPanning = true;
            panStartPoint = new paper.Point(e.clientX, e.clientY);
            canvasEl.style.cursor = "grabbing";
            e.preventDefault();
            e.stopPropagation();
        }
    });

    window.addEventListener("mousemove", (e) => {
        if (!window.isPanning || !panStartPoint) return;
        const currentPoint = new paper.Point(e.clientX, e.clientY);
        const delta = currentPoint.subtract(panStartPoint);
        const paperDelta = delta.divide(paper.view.zoom);
        paper.view.center = paper.view.center.subtract(paperDelta);
        panStartPoint = currentPoint;
        paper.view.update();

        if (window.selectedItem && typeof window.updateSelectionBox === "function") {
            window.updateSelectionBox(window.selectedItem);
        }
    });

    window.addEventListener("mouseup", () => {
        if (window.isPanning) {
            window.isPanning = false;
            canvasEl.style.cursor = window.spacePressed ? "grab" : "default";
        }
    });

    window.addEventListener("keydown", (e) => {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.id === "ekko-text-editor")) {
            return;
        }
        if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) {
            e.preventDefault();
            zoomCanvas(1.15);
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "-") {
            e.preventDefault();
            zoomCanvas(1 / 1.15);
        }
        if ((e.ctrlKey || e.metaKey) && e.key === "0") {
            e.preventDefault();
            resetCanvasView();
        }
    });

    const btnZoomIn = document.getElementById("btnZoomIn");
    const btnZoomOut = document.getElementById("btnZoomOut");
    const btnFit = document.getElementById("btnFit");

    if (btnZoomIn) {
        btnZoomIn.onclick = (e) => { e.preventDefault(); zoomCanvas(1.20); };
    }
    if (btnZoomOut) {
        btnZoomOut.onclick = (e) => { e.preventDefault(); zoomCanvas(1 / 1.20); };
    }
    if (btnFit) {
        btnFit.onclick = (e) => { e.preventDefault(); resetCanvasView(); };
    }

    function zoomCanvas(factor) {
        const oldZoom = paper.view.zoom;
        let newZoom = oldZoom * factor;
        newZoom = Math.max(0.15, Math.min(20.0, newZoom));
        paper.view.zoom = newZoom;
        paper.view.update();
        if (window.selectedItem && typeof window.updateSelectionBox === "function") {
            window.updateSelectionBox(window.selectedItem);
        }
    }

    function resetCanvasView() {
        paper.view.zoom = 1.0;
        if (typeof toolState !== 'undefined') {
            toolState.zoom = 1.0;
        }
        if (window.currentMockup) {
            paper.view.center = window.currentMockup.bounds.center;
        } else {
            paper.view.center = new paper.Point(0, 0);
        }
        paper.view.update();
        if (window.selectedItem && typeof window.updateSelectionBox === "function") {
            window.updateSelectionBox(window.selectedItem);
        }
    }
}

function injectRotationControlToToolbar() {
    const toolbar = document.getElementById('contextual-toolbar');
    if (!toolbar) return;
    if (document.getElementById('ctxRotationGroup')) return;

    const rotationGroup = document.createElement('div');
    rotationGroup.className = 'toolbar-group';
    rotationGroup.id = 'ctxRotationGroup';
    rotationGroup.innerHTML = `
        <div class="toolbar-divider"></div>
        <span style="font-size: 13px; color: #334155; font-weight: 500; display: inline-flex; align-items: center; gap: 4px;">
            <i class="fas fa-sync-alt" style="color: #007bff;"></i> Rotar:
        </span>
        <input id="ctxRotationNum" type="text" class="toolbar-input-number" style="width: 55px; font-weight: bold; background: #ffffff; border: 1px solid #cbd5e1; border-radius: 6px; padding: 4px 6px; text-align: center;" value="0°">
    `;

    const textCtrl = document.getElementById('ctxTextControls');
    if (textCtrl) {
        toolbar.insertBefore(rotationGroup, textCtrl);
    } else {
        toolbar.appendChild(rotationGroup);
    }

    const rotationNum = document.getElementById('ctxRotationNum');
    if (rotationNum) {
        const applyRotation = (val) => {
            if (!window.selectedItem || window.selectedItem.data?.locked) return;
            let angle = parseInt(val);
            if (isNaN(angle)) angle = 0;
            angle = (angle % 360 + 360) % 360;
            const displayItem = window.selectedItem.data?.clipGroup
                ? window.selectedItem.children.find(c => !c.clipMask)
                : window.selectedItem;
            if (displayItem) {
                const center = displayItem.bounds.center.clone();
                const oldRotation = displayItem.data?.rotation || 0;
                let delta = angle - oldRotation;
                if (delta > 180) delta -= 360;
                if (delta < -180) delta += 360;
                displayItem.rotate(delta, center);
                displayItem.data = displayItem.data || {};
                displayItem.data.rotation = angle;
                window.updateSelectionBox(window.selectedItem);
                paper.view.update();
            }
        };

        rotationNum.onchange = () => {
            applyRotation(rotationNum.value);
            rotationNum.value = (parseInt(rotationNum.value) || 0) + '°';
            if (typeof window.saveHistory === 'function') window.saveHistory();
        };

        rotationNum.onkeydown = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                applyRotation(rotationNum.value);
                rotationNum.value = (parseInt(rotationNum.value) || 0) + '°';
                rotationNum.blur();
            }
        };

        rotationNum.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (!window.selectedItem || window.selectedItem.data?.locked) return;
            const currentVal = parseInt(rotationNum.value) || 0;
            const direction = e.deltaY < 0 ? 1 : -1;
            const step = e.shiftKey ? 5 : 1;
            let newVal = currentVal + direction * step;
            newVal = (newVal % 360 + 360) % 360;
            rotationNum.value = newVal + '°';
            applyRotation(newVal);
            if (typeof window.saveHistory === 'function') window.saveHistory();
        }, { passive: false });
    }
}

// CAJA DE SELECCIÓN UNIFICADA MULTI-OBJETO CANVA-STYLE
window.updateSelectionBox = function(item) {
    if (window.paper && paper.project) {
        const designLayer = paper.project.layers.find(l => l.name === 'designLayer');
        if (designLayer) designLayer.activate();
    }

    if (window.selectionBoxGroup) {
        window.selectionBoxGroup.remove();
        window.selectionBoxGroup = null;
    }

    if (window.nodeEditMode) return;

    const primaryItem = item || window.selectedItem;
    if (!primaryItem || (primaryItem.data && primaryItem.data.mockup)) return;

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

    const border = new paper.Path.Rectangle(bounds);
    border.strokeColor = '#007bff';
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
            strokeColor: '#007bff',
            fillColor: '#ffffff',
            strokeWidth: 1.5 / paper.view.zoom
        });
        rect.data = { isHandle: true, handleType: info.type };
        window.selectionBoxGroup.addChild(rect);
    });

    const rotHandleDistance = 25 / paper.view.zoom;
    const rotHandleCenter = bounds.topCenter.add(new paper.Point(0, -rotHandleDistance));
    
    const connector = new paper.Path.Line(bounds.topCenter, rotHandleCenter);
    connector.strokeColor = '#007bff';
    connector.strokeWidth = 1.2 / paper.view.zoom;
    window.selectionBoxGroup.addChild(connector);

    const rotHandleCircle = new paper.Path.Circle({
        center: rotHandleCenter,
        radius: 7.5 / paper.view.zoom,
        strokeColor: '#007bff',
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
    arrowIcon.strokeColor = '#007bff';
    arrowIcon.strokeWidth = 1.2 / paper.view.zoom;
    window.selectionBoxGroup.addChild(arrowIcon);

    const arrowTip = new paper.Path();
    arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius - 1.5/paper.view.zoom, 1.5/paper.view.zoom)));
    arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius, 0)));
    arrowTip.add(rotHandleCenter.add(new paper.Point(iconRadius + 1.5/paper.view.zoom, 1.5/paper.view.zoom)));
    arrowTip.strokeColor = '#007bff';
    arrowTip.strokeWidth = 1.2 / paper.view.zoom;
    window.selectionBoxGroup.addChild(arrowTip);

    window.selectionBoxGroup.bringToFront();
    if (typeof window.applyPositionCorrections === "function") {
        window.applyPositionCorrections();
    }
};

window.getOppositePoint = function(bounds, handleType) {
    switch (handleType) {
        case "tl": return bounds.bottomRight;
        case "tr": return bounds.bottomLeft;
        case "bl": return bounds.topRight;
        case "br": return bounds.topLeft;
        case "t":  return bounds.bottomCenter;
        case "b":  return bounds.topCenter;
        case "l":  return bounds.rightCenter;
        case "r":  return bounds.leftCenter;
        default:   return bounds.center;
    }
};

window.getHandlePoint = function(bounds, handleType) {
    switch (handleType) {
        case "tl": return bounds.topLeft;
        case "tr": return bounds.topRight;
        case "bl": return bounds.bottomLeft;
        case "br": return bounds.bottomRight;
        case "t":  return bounds.topCenter;
        case "b":  return bounds.bottomCenter;
        case "l":  return bounds.leftCenter;
        case "r":  return bounds.rightCenter;
        default:   return bounds.center;
    }
};

window.initSelectionTool = function() {
    if (!paper.view) {
        console.warn("initSelectionTool: paper.view no está definido todavía.");
        return;
    }
    const selectTool = new paper.Tool();
    let lastClickTime = 0;

    selectTool.onMouseDown = function(event) {
        if (window.insertTextMode) {
            if (typeof createEditableText === "function") {
                createEditableText(event.point);
            }
            window.insertTextMode = false;
            paper.view.element.style.cursor = "default";
            return;
        }

        const currentTime = Date.now();
        if (currentTime - lastClickTime < 300) {
            lastClickTime = 0;
            if (window.selectedItem) {
                const target = window.selectedItem.data?.clipGroup
                    ? window.selectedItem.children.find(function(c) { return !c.clipMask; })
                    : window.selectedItem;
                if (target instanceof paper.PointText) {
                    if (typeof window.startTextEditing === 'function') {
                        window.startTextEditing(target);
                    }
                    return;
                }
            }
        }
        lastClickTime = currentTime;

        let hitResult = null;
        if (window.selectionBoxGroup) {
            hitResult = window.selectionBoxGroup.hitTest(event.point, {
                fill: true,
                stroke: true,
                segments: true,
                tolerance: 12 / paper.view.zoom,
                match: function(hit) {
                    return hit.item.data && hit.item.data.isHandle;
                }
            });
        }

        if (hitResult) {
            const hType = hitResult.item.data.handleType;
            if (hType === 'rot') {
                if (!window.selectedItem) return;
                window.rotationActive = true;
                window.rotationTarget = window.selectedItem;
                const displayItem = (window.rotationTarget.data && window.rotationTarget.data.clipGroup)
                    ? window.rotationTarget.children.find(function(c) { return !c.clipMask; })
                    : window.rotationTarget;
                window.rotationCenter = displayItem.bounds.center.clone();
                const vector = event.point.subtract(window.rotationCenter);
                window.rotationStartAngle = vector.angle;
                window.rotationInitialAngle = displayItem.data?.rotation || 0;
                return;
            }

            if (!window.selectedItem) return;
            window.resizeActive = true;
            window.resizeHandleType = hType;
            window.resizeTargets = [...(window.selectedItems || [])];

            let unifiedBounds = null;
            window.resizeTargets.forEach(function(it) {
                const displayItem = (it.data && it.data.clipGroup)
                    ? it.children.find(function(c) { return !c.clipMask; })
                    : it;
                if (!displayItem) return;
                if (!unifiedBounds) {
                    unifiedBounds = displayItem.bounds.clone();
                } else {
                    unifiedBounds = unifiedBounds.unite(displayItem.bounds);
                }
            });

            window.resizeInitialBounds = unifiedBounds;
            window.resizeInitialPoint = event.point.clone();
            window.resizeAnchor = window.getOppositePoint(window.resizeInitialBounds, window.resizeHandleType);
            window.resizeLastScaleX = 1.0;
            window.resizeLastScaleY = 1.0;
            return;
        }

        const generalHit = paper.project.hitTest(event.point, {
            fill: true,
            stroke: true,
            segments: true,
            bounds: true,
            tolerance: 8 / paper.view.zoom,
            match: function(hit) {
                if (hit.item.data && (hit.item.data.isSelectionBox || hit.item.data.isHandle)) return false;
                if (hit.item.data && hit.item.data.mockup) return false;
                return true;
            }
        });

        if (generalHit) {
            const selectableItem = window.getSelectableItem(generalHit.item);
            if (selectableItem) {
                const isShiftPressed = event.modifiers && event.modifiers.shift;
                if (!window.selectedItems) {
                    window.selectedItems = [];
                }
                if (isShiftPressed) {
                    const index = window.selectedItems.indexOf(selectableItem);
                    if (index > -1) {
                        selectableItem.selected = false;
                        window.selectedItems.splice(index, 1);
                    } else {
                        selectableItem.selected = true;
                        window.selectedItems.push(selectableItem);
                    }
                    window.selectedItem = window.selectedItems.length > 0 ? window.selectedItems[window.selectedItems.length - 1] : null;
                } else {
                    if (window.selectedItems.includes(selectableItem)) {
                        // Continuar arrastre sin resetear multi-selección
                    } else {
                        window.selectedItems.forEach(function(it) {
                            it.selected = false;
                        });
                        selectableItem.selected = true;
                        window.selectedItem = selectableItem;
                        window.selectedItems = [selectableItem];
                    }
                }
                window.dragging = true;
                window.dragTargets = [];
                window.selectedItems.forEach(function(item) {
                    const dragTarget = (item.data && item.data.clipGroup)
                        ? item.children.find(function(c) { return !c.clipMask; })
                        : item;
                    if (dragTarget) {
                        window.dragTargets.push({
                            item: item,
                            target: dragTarget,
                            dragOffset: event.point.subtract(dragTarget.position)
                        });
                    }
                });
                window.updateSelectionBox(window.selectedItem);
                if (typeof window.updateContextualMenu === 'function') {
                    window.updateContextualMenu(window.selectedItem);
                }
                paper.view.update();
                return;
            }
        }
        window.deselectItem();
    };

    selectTool.onMouseDrag = function(event) {
        if (window.selectedItem && window.selectedItem.data && window.selectedItem.data.locked) {
            return;
        }

        if (window.rotationActive && window.rotationTarget) {
            const displayItem = (window.rotationTarget.data && window.rotationTarget.data.clipGroup)
                ? window.rotationTarget.children.find(function(c) { return !c.clipMask; })
                : window.rotationTarget;
            const currentPoint = event.point;
            const vector = currentPoint.subtract(window.rotationCenter);
            const currentAngle = vector.angle;
            let angleDiff = currentAngle - window.rotationStartAngle;
            let targetAngle = window.rotationInitialAngle + angleDiff;

            const oldRotation = displayItem.data?.rotation || 0;
            let deltaRotate = targetAngle - oldRotation;
            if (deltaRotate > 180) deltaRotate -= 360;
            if (deltaRotate < -180) deltaRotate += 360;

            displayItem.rotate(deltaRotate, window.rotationCenter);
            displayItem.data = displayItem.data || {};
            displayItem.data.rotation = targetAngle;

            const rotationNum = document.getElementById('ctxRotationNum');
            if (rotationNum) {
                rotationNum.value = Math.round(targetAngle) + '°';
            }
            window.updateSelectionBox(window.selectedItem);
            paper.view.update();
            return;
        }

        if (window.resizeActive && window.resizeTargets && window.resizeTargets.length > 0) {
            const anchor = window.resizeAnchor;
            const initialHandlePoint = window.getHandlePoint(window.resizeInitialBounds, window.resizeHandleType);
            const currentHandlePoint = event.point;
            let factorX = 1.0;
            let factorY = 1.0;

            const initialXDiff = initialHandlePoint.x - anchor.x;
            const currentXDiff = currentHandlePoint.x - anchor.x;
            if (Math.abs(initialXDiff) > 0.001) factorX = currentXDiff / initialXDiff;

            const initialYDiff = initialHandlePoint.y - anchor.y;
            const currentYDiff = currentHandlePoint.y - anchor.y;
            if (Math.abs(initialYDiff) > 0.001) factorY = currentYDiff / initialYDiff;

            if (['tl', 'tr', 'bl', 'br'].includes(window.resizeHandleType)) {
                const factor = (Math.abs(factorX) + Math.abs(factorY)) / 2 * (factorX < 0 ? -1 : 1);
                factorX = factor;
                factorY = factor;
            }

            const scaleFactorX = factorX / window.resizeLastScaleX;
            const scaleFactorY = factorY / window.resizeLastScaleY;

            window.resizeTargets.forEach(function(item) {
                if (item.data && item.data.locked) return;
                const targetToScale = (item.data && item.data.clipGroup)
                    ? item.children.find(function(c) { return !c.clipMask; })
                    : item;
                if (targetToScale) {
                    targetToScale.scale(scaleFactorX, scaleFactorY, anchor);
                }
            });

            window.resizeLastScaleX = factorX;
            window.resizeLastScaleY = factorY;
            window.updateSelectionBox(null);
            paper.view.update();
            return;
        }

        if (window.dragging && window.dragTargets && window.dragTargets.length > 0) {
            window.dragTargets.forEach(function(dragInfo) {
                if (dragInfo.item.data && dragInfo.item.data.locked) return;
                dragInfo.target.position = event.point.subtract(dragInfo.dragOffset);
            });

            if (typeof calculateSmartGuides === "function") {
                calculateSmartGuides(window.selectedItem, event);
            } else if (window.calculateSmartGuides) {
                window.calculateSmartGuides(window.selectedItem, event);
            }
            window.updateSelectionBox(window.selectedItem);
            paper.view.update();
            return;
        }
    };

    selectTool.onMouseUp = function(event) {
        if (window.resizeActive || window.dragging) {
            if (typeof window.saveHistory === 'function') window.saveHistory();
        }
        window.dragging = false;
        window.resizeActive = false;
        const canvas = document.getElementById("editorCanvas");
        if (canvas) canvas.style.cursor = 'default';
        if (typeof clearSmartGuides === "function") clearSmartGuides();
        paper.view.update();
    };

    selectTool.onMouseMove = function(event) {
        const canvas = document.getElementById("editorCanvas");
        if (!canvas) return;

        if (window.resizeActive) {
            return;
        }

        let hitResult = null;
        if (window.selectionBoxGroup) {
            hitResult = window.selectionBoxGroup.hitTest(event.point, {
                fill: true,
                stroke: true,
                segments: true,
                tolerance: 12 / paper.view.zoom,
                match: function(hit) {
                    return hit.item.data && hit.item.data.isHandle;
                }
            });
        }

        if (hitResult) {
            const type = hitResult.item.data.handleType;
            let cursorStyle = 'pointer';
            if (type === 'tl' || type === 'br') cursorStyle = 'nwse-resize';
            else if (type === 'tr' || type === 'bl') cursorStyle = 'nesw-resize';
            else if (type === 't' || type === 'b') cursorStyle = 'ns-resize';
            else if (type === 'l' || type === 'r') cursorStyle = 'ew-resize';
            canvas.style.cursor = cursorStyle;
        } else {
            const generalHit = paper.project.hitTest(event.point, {
                fill: true,
                stroke: true,
                segments: true,
                bounds: true,
                tolerance: 8 / paper.view.zoom,
                match: function(hit) {
                    if (hit.item.data && (hit.item.data.isSelectionBox || hit.item.data.isHandle)) return false;
                    if (hit.item.data && hit.item.data.mockup) return false;
                    return true;
                }
            });

            if (generalHit && window.selectedItems && window.selectedItems.length > 0) {
                const hitItem = window.getSelectableItem(generalHit.item);
                if (window.selectedItems.includes(hitItem)) {
                    canvas.style.cursor = 'move';
                    return;
                }
            }
            canvas.style.cursor = 'default';
        }
    };

    selectTool.activate();
    console.log("🎯 Eventos de selección y redimensionamiento de Paper.js registrados con éxito.");
};

if (typeof paper !== "undefined" && paper.view) {
    window.initSelectionTool();
}

function applyPositionCorrections() {
    const toolbar = document.getElementById("contextual-toolbar");
    const textEditor = document.getElementById("ekko-text-editor");
    if (!window.paper || !paper.view || !window.selectedItem) return;

    const item = window.selectedItem;
    const displayItem = item.data?.clipGroup ? item.children.find(c => !c.clipMask) : item;
    if (!displayItem) return;

    const bounds = displayItem.bounds;
    const viewPos = paper.view.projectToView(bounds.topCenter);
    const centerPos = paper.view.projectToView(bounds.center);

    // 1. Corregir Barra Contextual Flotante (Evita que quede oculta o desfasada)
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
                const targetTop = rect.top + window.scrollY + viewPos.y - toolbarHeight - 25; // 25px de margen superior
                toolbar.style.position = "absolute";
                toolbar.style.left = Math.max(10, Math.min(window.innerWidth - toolbarWidth - 10, targetLeft)) + "px";
                toolbar.style.top = Math.max(10, Math.min(window.innerHeight - toolbarHeight - 10, targetTop)) + "px";
            }
            toolbar.style.zIndex = "2147483646";
        }
    }

    // 2. Corregir Editor de Texto (Evita que el recuadro de escritura aparezca en la esquina superior izquierda)
    if (textEditor && textEditor.style.display !== "none") {
        const editorWidth = textEditor.offsetWidth || 220;
        const editorHeight = textEditor.offsetHeight || 50;
        const canvasEl = document.getElementById("editorCanvas");
        if (canvasEl) {
            const rect = canvasEl.getBoundingClientRect();
            const targetLeft = rect.left + window.scrollX + centerPos.x - (editorWidth / 2);
            const targetTop = rect.top + window.scrollY + centerPos.y - (editorHeight / 2);
            textEditor.style.left = targetLeft + "px";
            textEditor.style.top = targetTop + "px";
        }
        textEditor.style.position = "absolute";
        textEditor.style.zIndex = "2147483647"; // Stay above toolbar and rulers
    }
}
window.applyPositionCorrections = applyPositionCorrections;

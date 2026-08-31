/* =========================================================================
Modulo: ASSETS/js/editor.js (v25.2 PRO - Stacking CSG & Reactive Z-Order Engine)
Ruta de reemplazo: ASSETS/js/editor.js
Descripcion: Nucleo de la aplicacion EKKO Studio basado en Paper.js.
- Soluciona las condiciones de carrera (race conditions) asincronas
  gracias a un protocolo secuencial asincrono de arranque (Bootstrap).
- Previene fugas y duplicacion de listeners mediante centinelas globales.
- Compatible de forma nativa con los modulos ES6 blindados de calado:
  selection.js, nodeEditor.js, exportSVG.js, geometricUngroup.js y contextualMenu.js.
- Integra sincronizacion reactiva no destructiva de capas (recalculateDynamicSubtractions)
  en reordenamiento Z (bringFront, sendBack, bringForward, sendBackward),
  duplicacion/pegado y restauracion de historial (undo/redo).
- Integra el sistema de diagnostico y auditoria vectorial en tiempo real (ekkoDiagnostics.js).
========================================================================= */

import "./modules/selection.js";
import "./modules/canvas-pro/ekkoDiagnostics.js";
import { loadDynamicFonts } from "./modules/canvas-pro/textToolbar.js";
import { loadDynamicProducts } from "./modules/productsLoader.js";
import { restoreMockupReferences, loadMockup } from "./modules/mockupLoader.js";
import { updateContextualMenu, hideContextualMenu, initContextualMenu } from "./modules/canvas-pro/contextualMenu.js";
import { startTextEditing } from "./modules/textEditor.js";
import { initProControls } from "./modules/canvas-pro/canvasControlsIntegration.js";
import { initZoomControls, initGlobalKeyboardShortcuts } from "./modules/canvas-pro/zoomYShortcuts.js";
import { recalculateDynamicSubtractions } from "./modules/canvas-pro/geometricUngroup.js";

// Exposicion segura de API al contexto global del navegador (WYSIWYG-Sync)
window.updateContextualMenu = updateContextualMenu;
window.hideContextualMenu = hideContextualMenu;
window.initContextualMenu = initContextualMenu;
window.startTextEditing = startTextEditing;

// Saneamiento de variables y namespaces globales
window.EKKO_STUDIO_PRODUCTS = window.EKKO_STUDIO_PRODUCTS || [];
window.paperUnitsPerMm = window.paperUnitsPerMm || 1.0;
window.mmPerPaperUnit = window.mmPerPaperUnit || 1.0;
window.currentMockup = window.currentMockup || null;
window.grabArea = window.grabArea || null;
window.clipMask = window.clipMask || null;
window.infiniteCanvasMode = typeof window.infiniteCanvasMode !== 'undefined' ? window.infiniteCanvasMode : true;
window.selectedItems = window.selectedItems || [];
window.selectedItem = window.selectedItem || null;

// Saneador local de elementos de contencion
function getContentItem(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup) {
        if (!item.children) return item;
        const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
        if (content) return content;
        const fallback = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup)));
        if (fallback) return fallback;
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

// Inyeccion e inicializacion de estilos del Lienzo Infinito
const infiniteCanvasStylesId = 'infinite-canvas-styles';
if (typeof document !== 'undefined' && !document.getElementById(infiniteCanvasStylesId)) {
    const styleEl = document.createElement('style');
    styleEl.id = infiniteCanvasStylesId;
    styleEl.textContent = `
        #editorCanvas {
            width: 100% !important;
            height: 100% !important;
            background-color: #e2e8f0 !important;
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

// Constantes de Estado de la Sesion
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

// Metodo de Trazabilidad y Preservacion del Taller
function saveHistory() {
    if (typeof paper !== "undefined" && paper.project) {
        undoStack.push(paper.project.exportJSON({ asString: true }));
        if (undoStack.length > 50) undoStack.shift();
        redoStack.length = 0;
    }
}
window.saveHistory = saveHistory;

// Limpieza de artefactos de interfaz fantasma tras undo/redo
function cleanGhostInterfaceItems() {
    if (typeof paper !== "undefined" && paper.project && paper.project.activeLayer) {
        paper.project.activeLayer.getItems({
            match: function(item) {
                return !!(item.data && (
                    item.data.isSelectionBox ||
                    item.data.isHandle ||
                    item.data.isNodeHandle ||
                    item.data.isCurveHandle
                ));
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
    if (typeof restoreMockupReferences === "function") restoreMockupReferences();
    if (typeof recalculateDynamicSubtractions === "function") {
        recalculateDynamicSubtractions();
    } else if (typeof window.recalculateDynamicSubtractions === "function") {
        window.recalculateDynamicSubtractions();
    }
    paper.view.update();
}
window.undo = undo;

function redo() {
    if (redoStack.length === 0) return;
    undoStack.push(paper.project.exportJSON({ asString: true }));
    const state = redoStack.pop();
    paper.project.clear();
    paper.project.importJSON(state);
    cleanGhostInterfaceItems();
    window.deselectItem();
    if (typeof restoreMockupReferences === "function") restoreMockupReferences();
    if (typeof recalculateDynamicSubtractions === "function") {
        recalculateDynamicSubtractions();
    } else if (typeof window.recalculateDynamicSubtractions === "function") {
        window.recalculateDynamicSubtractions();
    }
    paper.view.update();
}
window.redo = redo;

function isLockedItem(item) {
    return item && item.data && item.data.locked === true;
}

// Sincronizador en mm para UI y cotas
function updateSelectionInfo() {
    if (!window.selectedItem) {
        const selInfo = document.getElementById("selectionInfo");
        const objW = document.getElementById("objWidth");
        const objH = document.getElementById("objHeight");
        if (selInfo) selInfo.textContent = "Nada seleccionado";
        if (objW) objW.value = "";
        if (objH) objH.value = "";
        return;
    }
    const displayItem = getContentItem(window.selectedItem);
    const selInfo = document.getElementById("selectionInfo");
    const objW = document.getElementById("objWidth");
    const objH = document.getElementById("objHeight");
    if (displayItem && selInfo) {
        selInfo.textContent = displayItem.data?.label || "Objeto";
        if (objW) objW.value = (displayItem.bounds.width * (window.mmPerPaperUnit || 1.0)).toFixed(1);
        if (objH) objH.value = (displayItem.bounds.height * (window.mmPerPaperUnit || 1.0)).toFixed(1);
    }
}

function updateLockButton() {
    const btnLock = document.getElementById("btnToggleLock");
    if (btnLock) {
        if (window.selectedItem && isLockedItem(window.selectedItem)) {
            btnLock.classList.add("active");
        } else {
            btnLock.classList.remove("active");
        }
    }
}

// Metodos de seleccion unificada con tiradores
window.selectItem = function(item, isMulti = false) {
    if (window.nodeEditMode) {
        window.exitNodeEditMode();
    }
    let isMockup = false;
    let curr = item;
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

    if (isMulti) {
        if (!window.selectedItems) window.selectedItems = [];
        const idx = window.selectedItems.indexOf(item);
        if (idx > -1) {
            item.selected = false;
            window.selectedItems.splice(idx, 1);
        } else {
            item.selected = true;
            window.selectedItems.push(item);
        }
        window.selectedItem = window.selectedItems.length > 0 ? window.selectedItems[window.selectedItems.length - 1] : null;
    } else {
        if (window.selectedItems) {
            window.selectedItems.forEach(it => { if (it) it.selected = false; });
        }
        item.selected = true;
        window.selectedItem = item;
        window.selectedItems = [item];
    }

    if (typeof window.updateSelectionBox === 'function') {
        window.updateSelectionBox(window.selectedItem);
    }
    if (typeof window.updateContextualMenu === 'function') {
        window.updateContextualMenu(window.selectedItem);
    }
    updateSelectionInfo();
    updateLockButton();
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
    if (typeof window.hideContextualMenu === 'function') {
        window.hideContextualMenu();
    }
    updateSelectionInfo();
    updateLockButton();
    paper.view.update();
};

// Sincronizacion espacial del mockup y cotas reales
window.getRealProductDimensions = function(product) {
    if (!product || !product.nombre) return { width: 50, height: 50 };
    const str = product.nombre;
    const matchTwo = str.match(/(\d+)\s*[xX*]\s*(\d+)/);
    if (matchTwo) {
        return { width: parseFloat(matchTwo[1]), height: parseFloat(matchTwo[2]), parsed: true };
    }
    const matchMm = str.match(/(\d+)\s*mm/i);
    if (matchMm) {
        const val = parseFloat(matchMm[1]);
        return { width: val, height: val, parsed: true };
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
    const bounds = window.currentMockup.bounds;
    if (bounds.width > 0 && realDims.width > 0) {
        window.paperUnitsPerMm = bounds.width / realDims.width;
        window.mmPerPaperUnit = realDims.width / bounds.width;
    }
};

// Guardado de escenas del lienzo de Paper.js
function getSceneKey(product, surface) {
    if (!product || !surface) return "default_scene";
    return `${product.id}__${surface.nombre}`;
}

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
        if (typeof recalculateDynamicSubtractions === "function") {
            recalculateDynamicSubtractions();
        }
        paper.view.update();
        return;
    }

    loadMockup(surface.svg);
    setTimeout(() => {
        if (typeof window.updateGlobalScaleFactor === "function") window.updateGlobalScaleFactor();
    }, 600);
}

// Clipboard de Trabajo
let clipboardItem = null;

function copySelected() {
    if (!window.selectedItem) return;
    if (isLockedItem(window.selectedItem)) return;
    clipboardItem = window.selectedItem.clone({ insert: false });
}
window.copySelected = copySelected;

function pasteSelected() {
    if (!clipboardItem) return;
    saveHistory();
    const clone = clipboardItem.clone();
    clone.position = clone.position.add(new paper.Point(20, 20));
    clone.data = { ...(clone.data || {}), locked: false };
    paper.project.activeLayer.addChild(clone);
    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }
    window.selectItem(clone);
    paper.view.update();
}
window.pasteSelected = pasteSelected;

// Gestion e Insercion de Z-Index con Recalculo Dinamico CSG
function bringFront() {
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
    if (typeof saveHistory === 'function') saveHistory();
    window.selectedItem.bringToFront();
    if (window.currentMockup) {
        window.currentMockup.bringToFront();
    }
    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }
    window.updateSelectionBox(window.selectedItem);
    paper.view.update();
}
window.bringFront = bringFront;

function sendBack() {
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
    if (typeof saveHistory === 'function') saveHistory();
    window.selectedItem.sendToBack();
    if (window.currentMockup) {
        window.selectedItem.insertBelow(window.currentMockup);
    }
    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }
    window.updateSelectionBox(window.selectedItem);
    paper.view.update();
}
window.sendBack = sendBack;

function bringForward() {
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
    if (typeof saveHistory === 'function') saveHistory();
    const next = window.selectedItem.nextSibling;
    if (next && (!next.data || !next.data.mockup)) {
        window.selectedItem.insertAbove(next);
    } else if (window.currentMockup) {
        window.selectedItem.insertBelow(window.currentMockup);
    } else {
        window.selectedItem.bringToFront();
    }
    if (window.currentMockup) {
        window.currentMockup.bringToFront();
    }
    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }
    window.updateSelectionBox(window.selectedItem);
    paper.view.update();
}
window.bringForward = bringForward;

function sendBackward() {
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
    if (typeof saveHistory === 'function') saveHistory();
    const prev = window.selectedItem.previousSibling;
    if (prev) {
        window.selectedItem.insertBelow(prev);
    } else {
        window.selectedItem.sendToBack();
    }
    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }
    window.updateSelectionBox(window.selectedItem);
    paper.view.update();
}
window.sendBackward = sendBackward;

// Inyeccion y Carga de Medios
function addImageFromFile(file) {
    if (!file) return;
    saveHistory();
    const reader = new FileReader();
    reader.onload = (e) => {
        const raster = new paper.Raster({ source: e.target.result });
        raster.onLoad = () => {
            if (window.paper && paper.project) {
                const dLayer = paper.project.layers.find(l => l.name === 'designLayer');
                if (dLayer) dLayer.activate();
            }
            raster.data = { locked: false, label: file.name };
            const area = paper.view.bounds;
            const size = Math.min(area.width, area.height) * 0.5;
            raster.scale(size / raster.width);
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
        let svgText = e.target.result;
        try {
            const parser = new DOMParser();
            parser.parseFromString(svgText, "image/svg+xml");
        } catch (err) {
            console.error("Error al sanear XML de SVG:", err);
        }
        paper.project.importSVG(svgText, (item) => {
            if (window.paper && paper.project) {
                const designLayer = paper.project.layers.find(l => l.name === 'designLayer');
                if (designLayer) designLayer.activate();
            }
            if (!item) return;
            item.data = { locked: false, label: file.name.replace(".svg", "") };
            const bounds = item.bounds;
            const area = paper.view.bounds;
            const size = Math.min(area.width, area.height) * 0.5;
            if (bounds.width > 0) {
                item.scale(size / bounds.width);
            }
            item.position = area.center;

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

// Inicializacion de la Modal de QR Dinamico
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
    tempDiv.style.display = "none";
    document.body.appendChild(tempDiv);
    new QRCode(tempDiv, {
        text: text,
        width: 512,
        height: 512,
        correctLevel: QRCode.CorrectLevel.H
    });
    setTimeout(() => {
        const qrCanvas = tempDiv.querySelector("canvas");
        const qrImg = tempDiv.querySelector("img");
        const src = qrCanvas ? qrCanvas.toDataURL() : qrImg ? qrImg.src : null;
        if (src) {
            const raster = new paper.Raster({ source: src });
            raster.onLoad = () => {
                if (window.paper && paper.project) {
                    const dLayer = paper.project.layers.find(l => l.name === 'designLayer');
                    if (dLayer) dLayer.activate();
                }
                raster.data = { locked: false, label: "Código QR" };
                const area = paper.view.bounds;
                const size = Math.min(area.width, area.height) * 0.4;
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

// Renderizadores de los Tabs Laterales del Catalogo
function renderCategories() {
    const catTabs = document.getElementById("categoryTabs");
    if (!catTabs) return;
    catTabs.innerHTML = "";

    window.EKKO_STUDIO_PRODUCTS.forEach((group, index) => {
        const btn = document.createElement("button");
        btn.className = "tab-btn" + (toolState.currentCategory === index ? " active" : "");
        btn.textContent = group.categoria;
        btn.onclick = () => {
            saveCurrentScene();
            toolState.currentCategory = index;
            renderCategories();
            renderProducts(group);
        };
        catTabs.appendChild(btn);
    });

    if (window.EKKO_STUDIO_PRODUCTS.length > 0) {
        renderProducts(window.EKKO_STUDIO_PRODUCTS[toolState.currentCategory]);
    }
}

function renderProducts(group) {
    if (!group || !group.productos) return;
    const prodTabs = document.getElementById("productTabs");
    if (!prodTabs) return;
    prodTabs.innerHTML = "";

    group.productos.forEach(product => {
        const btn = document.createElement("button");
        btn.className = "tab-btn" + (toolState.currentProduct && toolState.currentProduct.id === product.id ? " active" : "");
        btn.textContent = product.nombre;
        btn.onclick = () => {
            saveCurrentScene();
            toolState.currentProduct = product;
            toolState.currentSurface = 0;
            renderProductsOnly(group.productos, product);
            renderSurfaces(product);
            if (product.superficies && product.superficies.length > 0) {
                loadSurfaceScene(product, product.superficies[0]);
            }
        };
        prodTabs.appendChild(btn);
    });

    const selectedProd = group.productos[0];
    toolState.currentProduct = selectedProd;
    renderSurfaces(selectedProd);
    if (selectedProd && selectedProd.superficies && selectedProd.superficies.length > 0) {
        loadSurfaceScene(selectedProd, selectedProd.superficies[0]);
    }
}

function renderProductsOnly(productos, activeProduct) {
    const prodTabs = document.getElementById("productTabs");
    if (!prodTabs) return;
    prodTabs.innerHTML = "";
    productos.forEach(product => {
        const btn = document.createElement("button");
        btn.className = "tab-btn" + (activeProduct && activeProduct.id === product.id ? " active" : "");
        btn.textContent = product.nombre;
        btn.onclick = () => {
            saveCurrentScene();
            toolState.currentProduct = product;
            toolState.currentSurface = 0;
            renderProductsOnly(productos, product);
            renderSurfaces(product);
            if (product.superficies && product.superficies.length > 0) {
                loadSurfaceScene(product, product.superficies[0]);
            }
        };
        prodTabs.appendChild(btn);
    });
}

function renderSurfacesOnly(product) {
    const surfTabs = document.getElementById("surfaceTabs");
    if (!surfTabs) return;
    surfTabs.innerHTML = "";
    if (!product || !product.superficies) return;

    product.superficies.forEach((surf, index) => {
        const btn = document.createElement("button");
        btn.className = "tab-btn" + (toolState.currentSurface === index ? " active" : "");
        btn.textContent = surf.nombre;
        btn.onclick = () => {
            saveCurrentScene();
            toolState.currentSurface = index;
            renderSurfaces(product);
            loadSurfaceScene(product, surf);
        };
        surfTabs.appendChild(btn);
    });
}

function renderSurfaces(product) {
    renderSurfacesOnly(product);
}

// Insercion de textos vectoriales
function activateTextMode() {
    window.insertTextMode = true;
    if (paper.view && paper.view.element) {
        paper.view.element.style.cursor = "text";
    }
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
        fontFamily: "Arial",
        fillColor: new paper.Color(0),
        justification: "center"
    });

    txt.data = {
        locked: false,
        label: "Texto",
        fontSize: 42,
        fontFamily: "Arial"
    };

    const objeto = window.clipItem(txt);
    if (window.currentMockup) {
        objeto.insertBelow(window.currentMockup);
    }
    window.selectItem(objeto);
    paper.view.update();

    if (typeof window.startTextEditing === "function") {
        window.startTextEditing(txt);
    }
}

const safeAddListener = (id, event, fn) => {
    const el = typeof id === "string" ? document.getElementById(id) : id;
    if (el) el.addEventListener(event, fn);
};

// Zoom and Pan unificado
function zoomCanvas(factor) {
    const oldZoom = paper.view.zoom;
    let newZoom = oldZoom * factor;
    newZoom = Math.max(0.15, Math.min(100.0, newZoom));
    paper.view.zoom = newZoom;
    if (typeof window.updateSelectionBox === "function") {
        window.updateSelectionBox(window.selectedItem);
    }
    if (typeof window.updateNodeHandlesScale === 'function') {
        window.updateNodeHandlesScale();
    }
    paper.view.update();
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

/* =========================================================================
SISTEMA DE ARRANQUE SECUENCIAL DEFENSIVO (BOOTSTRAP)
Evita carreras asincronas de DOMContentLoaded en el flujo de Paper.js.
========================================================================= */
async function bootstrapEKKO() {
    if (window.ekkoEditorInitialized) {
        console.log("%c[EKKO BOOTSTRAP] Editor ya inicializado previamente. Abortando duplicacion.", "color: #94a3b8;");
        return;
    }
    window.ekkoEditorInitialized = true;
    console.log("%c[EKKO BOOTSTRAP] Iniciando secuencia de arranque unificada de EKKO Studio...", "color: #007bff; font-weight: bold;");

    const canvasEl = document.getElementById("editorCanvas");
    const containerEl = document.getElementById("canvasContainer");

    if (!canvasEl || !containerEl) {
        console.error("[EKKO BOOTSTRAP] Elementos esenciales del canvas no hallados en el DOM.");
        return;
    }

    try {
        // 1. Inicializar Paper.js sobre el elemento canvas físico
        paper.setup(canvasEl);

        // 2. Establecer dimensiones reactivas
        const initialWidth = containerEl.clientWidth || 800;
        const initialHeight = containerEl.clientHeight || 600;
        canvasEl.width = initialWidth;
        canvasEl.height = initialHeight;
        paper.view.viewSize = new paper.Size(initialWidth, initialHeight);

        // 3. Crear capa de diseno util independiente de interfaces
        let designLayer = paper.project.layers.find(l => l.name === 'designLayer');
        if (!designLayer) {
            designLayer = new paper.Layer();
            designLayer.name = 'designLayer';
        }
        designLayer.activate();

        // 4. Inicializar herramientas interactivas
        if (typeof window.initSelectionTool === "function") {
            try {
                window.initSelectionTool();
            } catch (err) {
                console.error("[EKKO BOOTSTRAP] Error al inicializar herramienta de seleccion:", err);
            }
        }

        // 5. Inicializar menu contextual flotante
        if (typeof initContextualMenu === "function") {
            try {
                initContextualMenu();
            } catch (err) {
                console.error("[EKKO BOOTSTRAP] Error al inicializar menu contextual:", err);
            }
        }

        // 6. Activar Zoom de raton y Atajos de Teclado con proteccion de doble binding
        try {
            if (!window.ekkoShortcutsBound) {
                initZoomControls(canvasEl);
                initGlobalKeyboardShortcuts();
                window.ekkoShortcutsBound = true;
            }
        } catch (err) {
            console.error("[EKKO BOOTSTRAP] Error al acoplar controles de zoom y atajos de teclado:", err);
        }

        // 7. Cargar la barra de herramientas avanzada (Canva-style)
        if (typeof initProControls === "function") {
            try {
                if (!window.ekkoProControlsInitialized) {
                    initProControls();
                    window.ekkoProControlsInitialized = true;
                }
            } catch (err) {
                console.error("[EKKO BOOTSTRAP] Error al inyectar controles avanzados de alineacion:", err);
            }
        }

        // 8. Enlazar eventos de click interactivos en la barra de herramientas superior
        safeAddListener("btnAddText", "click", () => {
            let targetPoint = new paper.Point(0, 0);
            if (window.currentMockup) {
                targetPoint = window.currentMockup.bounds.center.clone();
            } else if (paper.view) {
                targetPoint = paper.view.center.clone();
            }
            createEditableText(targetPoint);
        });

        safeAddListener("btnAddImage", "click", () => {
            const picker = document.getElementById("imagePicker");
            if (picker) picker.click();
        });

        safeAddListener("imagePicker", "change", (e) => {
            const file = e.target.files[0];
            if (file) {
                addImageFromFile(file);
                e.target.value = "";
            }
        });

        safeAddListener("btnAddSVG", "click", () => {
            const picker = document.getElementById("svgPicker");
            if (picker) picker.click();
        });

        safeAddListener("svgPicker", "change", (e) => {
            const file = e.target.files[0];
            if (file) {
                addSVGFromFile(file);
                e.target.value = "";
            }
        });

        safeAddListener("btnAddQR", "click", () => {
            const text = prompt("Ingrese el texto o enlace (Instagram, WhatsApp, WiFi) para el codigo QR:", "https://www.instagram.com/grabados_ekko/");
            if (text && text.trim() !== "") {
                addQRToCanvas(text.trim());
            }
        });

        // Responsive resize listener
        window.addEventListener("resize", () => {
            if (containerEl && canvasEl && paper.view) {
                const w = containerEl.clientWidth || 800;
                const h = containerEl.clientHeight || 600;
                canvasEl.width = w;
                canvasEl.height = h;
                paper.view.viewSize = new paper.Size(w, h);
                paper.view.update();
                if (window.selectedItem && typeof window.updateSelectionBox === "function") {
                    window.updateSelectionBox(window.selectedItem);
                }
            }
        });

        // 9. CARGA SECUENCIAL ASINCRONA DE ENDPOINTS (FUENTES Y PRODUCTOS)
        console.log("%c[EKKO BOOTSTRAP] Resolviendo catalogos de recursos y tipografias en segundo plano...", "color: #0369a1;");
        const fontsPromise = loadDynamicFonts()
            .then(loadedFonts => {
                console.log("%c[EKKO BOOTSTRAP] Tipografias del backend sincronizadas en el editor.", "color: #10b981;");
                return loadedFonts;
            })
            .catch(err => {
                console.warn("[EKKO BOOTSTRAP] Fallo no critico al sincronizar fuentes:", err);
            });

        const productsPromise = (async () => {
            if (typeof loadDynamicProducts === "function") {
                await loadDynamicProducts();
            }
            console.log("%c[EKKO BOOTSTRAP] Catalogo de productos dinamizado con exito.", "color: #10b981;");
            renderCategories();
        })().catch(err => {
            console.error("[EKKO BOOTSTRAP] Fallo critico al resolver el catalogo dinamico:", err);
            renderCategories();
        });

        await Promise.all([fontsPromise, productsPromise]);

        if (window.EKKO_STUDIO_PRODUCTS && window.EKKO_STUDIO_PRODUCTS.length > 0) {
            const initialCat = window.EKKO_STUDIO_PRODUCTS[0];
            if (initialCat && initialCat.productos && initialCat.productos.length > 0) {
                const initialProd = initialCat.productos[0];
                toolState.currentProduct = initialProd;
                if (initialProd && initialProd.superficies && initialProd.superficies.length > 0) {
                    const initialSurf = initialProd.superficies[0];
                    loadSurfaceScene(initialProd, initialSurf);
                }
            }
        }

        console.log(`%c[EKKO BOOTSTRAP] Editor inicializado con éxito. Dimensiones estables: ${initialWidth}x${initialHeight} px.`, "color: #10b981; font-weight: bold;");

    } catch (err) {
        console.error("[EKKO BOOTSTRAP] Error critico de inicializacion asincrona de Paper.js:", err);
        alert("Ocurrio un error al cargar el lienzo interactivo. Revisa la consola F12.");
    }
}

if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", bootstrapEKKO);
} else {
    bootstrapEKKO();
}

/* =========================================================================
   Modulo: ASSETS/js/editor.js (v14.1 PRO - Sequential Boot & Event Sentry Edition)
   Ruta de reemplazo: ASSETS/js/editor.js
   Descripcion: Nucleo de la aplicacion EKKO Studio basado en Paper.js.
                - Soluciona las condiciones de carrera (race conditions) asíncronas
                  gracias a un protocolo secuencial asíncrono de arranque (Bootstrap).
                - Previene fugas y duplicación de listeners mediante centinelas globales.
                - Compatible de forma nativa con los módulos ES6 blindados de calado:
                  selection.js, nodeEditor.js, exportSVG.js y geometricUngroup.js.
   ========================================================================= */

import "./modules/selection.js";
import { loadDynamicFonts } from "./modules/canvas-pro/textToolbar.js";
import { loadDynamicProducts } from "./modules/productsLoader.js";
import { restoreMockupReferences, loadMockup } from "./modules/mockupLoader.js";
import { updateContextualMenu, hideContextualMenu, initContextualMenu } from "./modules/canvas-pro/contextualMenu.js";
import { startTextEditing } from "./modules/textEditor.js";
import { initProControls } from "./modules/canvas-pro/canvasControlsIntegration.js";
import { initZoomControls, initGlobalKeyboardShortcuts } from "./modules/canvas-pro/zoomYShortcuts.js";

// Exposición segura de API al contexto global del navegador (WYSIWYG-Sync)
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

// Saneador local de elementos de contención
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

// Inyección e inicialización de estilos del Lienzo Infinito
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

// Constantes de Estado de la Sesión
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

// Método de Trazabilidad y Preservación del Taller
function saveHistory() {
    if (typeof paper !== "undefined" && paper.project) {
        undoStack.push(paper.project.exportJSON({ asString: true }));
        if (undoStack.length > 50) {
            undoStack.shift();
        }
        redoStack.length = 0;
    }
}
window.saveHistory = saveHistory;

// Limpiador defensivo de overlays e interfaz tras operaciones de Undo/Redo
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
window.undo = undo;

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
    if (!btnLock) return;
    if (!window.selectedItem) {
        btnLock.textContent = "Bloquear / Desbloquear";
        return;
    }
    btnLock.textContent = isLockedItem(window.selectedItem) ? "Desbloquear" : "Bloquear";
}

function toggleLockSelected() {
    if (!window.selectedItem) return;
    window.selectedItem.data = window.selectedItem.data || {};
    window.selectedItem.data.locked = !window.selectedItem.data.locked;
    updateSelectionInfo();
    updateLockButton();
    paper.view.update();
}

// Métodos de selección unificada con tiradores
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
    if (!item || isMockup) {
        window.deselectItem();
        return;
    }
    if (!window.selectedItems) window.selectedItems = [];
    if (isMulti) {
        const idx = window.selectedItems.indexOf(item);
        if (idx > -1) {
            item.selected = false;
            window.selectedItems.splice(idx, 1);
        } else {
            item.selected = true;
            window.selectedItems.push(item);
        }
        window.selectedItem = window.selectedItems[window.selectedItems.length - 1] || null;
    } else {
        window.selectedItems.forEach(function(it) {
            if (it) it.selected = false;
        });
        item.selected = true;
        window.selectedItems = [item];
        window.selectedItem = item;
    }
    if (window.selectedItems.length === 0) {
        window.deselectItem();
        return;
    }
    window.updateSelectionBox(window.selectedItem);
    if (typeof window.updateContextualMenu === 'function') {
        window.updateContextualMenu(window.selectedItem);
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
    if (typeof window.hideContextualMenu === 'function') {
        window.hideContextualMenu();
    }
    paper.view.update();
};

// Sincronización espacial del mockup y cotas reales
window.getRealProductDimensions = function(product) {
    if (!product) return { width: 50, height: 50 };
    const id = (product.id || "").toLowerCase();
    const nombre = (product.nombre || "").toLowerCase();
    const regexX = /(\\d+)\\s*x\\s*(\\d+)/;
    const matchX = id.match(regexX) || nombre.match(regexX);
    if (matchX) {
        let w = parseFloat(matchX[2]);
        let h = parseFloat(matchX[1]);
        return { width: w, height: h, parsed: true };
    }
    const regexMm = /(\\d+)\\s*mm/;
    const matchMm = id.match(regexMm) || nombre.match(regexMm);
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
        paper.view.update();
        return;
    }
    loadMockup(surface.svg);
    setTimeout(() => { if (typeof window.updateGlobalScaleFactor === "function") window.updateGlobalScaleFactor(); }, 600);
}

// Clipboard de Trabajo
let clipboardItem = null;
function copySelected() {
    if (!window.selectedItem) return;
    if (isLockedItem(window.selectedItem)) return;
    clipboardItem = window.selectedItem.clone();
}
window.copySelected = copySelected;

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
window.pasteSelected = pasteSelected;

// Gestión e Inserción de Z-Index
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

// Inyección y Carga de Medios
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
            raster.data = { locked: false, label: file.name.replace(/\.[^/.]+$/, "") };
            const bounds = raster.bounds;
            const canvasBounds = paper.view.bounds;
            const scaleX = (canvasBounds.width * 0.45) / bounds.width;
            const scaleY = (canvasBounds.height * 0.45) / bounds.height;
            const scale = Math.min(scaleX, scaleY);
            raster.scale(scale);
            raster.position = canvasBounds.center;
            paper.project.activeLayer.addChild(raster);
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
            const doc = parser.parseFromString(svgText, "image/svg+xml");
            const uses = doc.getElementsByTagName("use");
            const defs = doc.getElementById("defs1") || doc.createElementNS("http://www.w3.org/2000/svg", "defs");
            if (!defs.parentNode && doc.documentElement) {
                defs.id = "defs1";
                doc.documentElement.insertBefore(defs, doc.documentElement.firstChild);
            }
            for (let i = 0; i < uses.length; i++) {
                const href = uses[i].getAttribute("xlink:href") || uses[i].getAttribute("href");
                if (href && href.startsWith("#")) {
                    const id = href.substring(1);
                    const targetEl = doc.getElementById(id);
                    if (targetEl && targetEl.parentNode && targetEl.parentNode.tagName !== "defs") {
                        targetEl.parentNode.removeChild(targetEl);
                        defs.appendChild(targetEl);
                    }
                }
            }
            svgText = new XMLSerializer().serializeToString(doc);
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

// Inicialización de la Modal de QR Dinámico
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
                    const dLayer = paper.project.layers.find(l => l.name === 'designLayer');
                    if (dLayer) dLayer.activate();
                }
                raster.data = { locked: false, label: "Codigo QR" };
                const area = paper.view.bounds;
                const size = Math.min(area.width, area.height) * 0.3;
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

// Renderizadores de los Tabs Laterales del Catálogo
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
            toolState.currentProduct = null;
            toolState.currentSurface = 0;
            renderCategories();
            renderProducts(index);
        };
        catTabs.appendChild(btn);
    });
}

function renderProducts(categoryIndex, activeProduct = null) {
    const prodTabs = document.getElementById("productTabs");
    const surfTabs = document.getElementById("surfaceTabs");
    if (prodTabs) prodTabs.innerHTML = "";
    if (surfTabs) surfTabs.innerHTML = "";
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
        if (prodTabs) {
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
            prodTabs.appendChild(btn);
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
    const surfTabs = document.getElementById("surfaceTabs");
    if (!surfTabs) return;
    surfTabs.innerHTML = "";
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
        surfTabs.appendChild(btn);
    });
}

function renderSurfaces(product) {
    renderSurfacesOnly(product);
}

// Inserción de textos vectoriales
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

// Guardas para eventos y listeners del taller
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
    if (typeof window.updateNodeHandlesScale === 'function') {
        window.updateNodeHandlesScale();
    }
}

/* =========================================================================
   SISTEMA DE ARRANQUE SECUENCIAL DEFENSIVO (BOOTSTRAP)
   Evita carreras asíncronas de DOMContentLoaded en el flujo de Paper.js.
   ========================================================================= */

async function bootstrapEKKO() {
    if (window.ekkoEditorInitialized) {
        console.log("%c[EKKO BOOTSTRAP] Editor ya inicializado previamente. Abortando duplicación.", "color: #94a3b8;");
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
        // 1. Resolver medidas físicas iniciales del visor
        const initialWidth = containerEl.clientWidth || window.innerWidth;
        const initialHeight = containerEl.clientHeight || window.innerHeight;
        canvasEl.width = initialWidth;
        canvasEl.height = initialHeight;

        // 2. Inicializar Paper.js sobre el canvas físico
        paper.setup("editorCanvas");
        paper.view.viewSize = new paper.Size(initialWidth, initialHeight);

        // 3. Crear Estructura de Capas Limpia (Background & Design)
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

        // 4. Observar cambios de tamaño del lienzo estilo Canva/Figma (ResizeObserver)
        if (typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver(entries => {
                for (let entry of entries) {
                    const w = Math.round(entry.contentRect.width || containerEl.clientWidth);
                    const h = Math.round(entry.contentRect.height || containerEl.clientHeight);
                    if (w > 0 && h > 0 && paper.view) {
                        canvasEl.width = w;
                        canvasEl.height = h;
                        paper.view.viewSize = new paper.Size(w, h);
                        paper.view.update();
                        if (window.selectedItem && typeof window.updateSelectionBox === "function") {
                            window.updateSelectionBox(window.selectedItem);
                        }
                    }
                }
            });
            observer.observe(containerEl);
        }

        // 5. Instanciar herramienta de selección principal e inicializar contextualMenu
        if (typeof window.initSelectionTool === "function") {
            try {
                window.initSelectionTool();
            } catch (err) {
                console.error("[EKKO BOOTSTRAP] Error al inicializar herramienta de selección:", err);
            }
        }
        if (typeof initContextualMenu === "function") {
            try {
                initContextualMenu();
            } catch (err) {
                console.error("[EKKO BOOTSTRAP] Error al inicializar menú contextual:", err);
            }
        }

        // 6. Activar Zoom de ratón y Atajos de Teclado con protección de doble binding
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
                console.error("[EKKO BOOTSTRAP] Error al inyectar controles avanzados de alineación:", err);
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

        // Evento mouse click nativo para activar modo texto inline
        if (paper.view) {
            paper.view.on("mousedown", (event) => {
                if (window.insertTextMode) {
                    createEditableText(event.point);
                    window.insertTextMode = false;
                    if (paper.view.element) paper.view.element.style.cursor = "default";
                }
            });
        }

        // Listener nativo del navegador como fallback de redibujado de la caja celeste
        window.addEventListener("resize", () => {
            if (canvasEl && containerEl && paper.view) {
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

        // 9. CARGA SECUENCIAL ASÍNCRONA DE ENDPOINTS (FUENTES Y PRODUCTOS)
        console.log("%c[EKKO BOOTSTRAP] Resolviendo catálogos de recursos y tipografías en segundo plano...", "color: #0369a1;");
        
        const fontsPromise = loadDynamicFonts()
            .then(loadedFonts => {
                console.log("%c[EKKO BOOTSTRAP] Tipografías del backend sincronizadas en el editor.", "color: #10b981;");
                return loadedFonts;
            })
            .catch(err => {
                console.warn("[EKKO BOOTSTRAP] Fallo no crítico al sincronizar fuentes:", err);
                return [];
            });

        const productsPromise = (async () => {
            if (typeof loadDynamicProducts === "function") {
                await loadDynamicProducts();
            }
            console.log("%c[EKKO BOOTSTRAP] Catálogo de productos dinamizado con éxito.", "color: #10b981;");
            renderCategories();
        })().catch(err => {
            console.error("[EKKO BOOTSTRAP] Fallo crítico al resolver el catálogo dinámico:", err);
            renderCategories();
        });

        // Esperar resolución de promesas asíncronas para renderizar la primera escena limpia
        await Promise.all([fontsPromise, productsPromise]);

        // Cargar el primer producto y superficie de resguardo si el catálogo tiene ítems
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
        console.error("[EKKO BOOTSTRAP] Error crítico de inicialización asíncrona de Paper.js:", err);
        alert("Ocurrió un error al cargar el lienzo interactivo. Revisa la consola F12.");
    }
}

// Iniciar bootstrap unificado respetando el ciclo de carga del DOM
if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", bootstrapEKKO);
} else {
    bootstrapEKKO();
}

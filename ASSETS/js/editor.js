// Función auxiliar para desvincular de raíz las referencias del objeto .data en clones
function sanitizeClonedData(item) {
    if (!item) return;
    if (item.data) {
        item.data = { ...item.data }; // Copia superficial pura de propiedades primitivas
    } else {
        item.data = {};
    }
    if (item.children) {
        item.children.forEach(sanitizeClonedData); // Se ejecuta recursivamente en hijos de Grupos
    }
}
/**
 * ASSETS/js/editor.js (PRO Edition v4)
 * Controlador central interactivo para el canvas, historial, redimensionamiento,
 * rotación libre (Estilo Canva) e integración con LightBurn.
 */

import "./modules/selection.js"; // Importamos la selección con tirador de rotación
import { startTextEditing } from "./modules/textEditor.js";
import { loadMockup, restoreMockupReferences } from "./modules/mockupLoader.js";
import { initContextualMenu, updateContextualMenu, hideContextualMenu } from "./modules/canvas-pro/contextualMenu.js";

window.addEventListener("DOMContentLoaded", () => {
    // 1. Inicializar Paper.js de forma segura en el lienzo
    const canvasEl = document.getElementById("editorCanvas");
    if (canvasEl) {
        paper.setup("editorCanvas");
        paper.view.viewSize = new paper.Size(canvasEl.clientWidth, canvasEl.clientHeight);
    }

    // --- Variables de Estado Global del Editor ---
    const toolState = { currentCategory: 0, currentProduct: null, currentSurface: 0, zoom: 1 };
    const sceneStates = {};
    const undoStack = [];
    const redoStack = [];
    window.loadToken = 0;
    window.selectedItem = null;
    window.dragOffset = null;
    window.dragging = false;
    let lastSizeField = "width";
    let clipboardItem = null;

    const FONTS = [
        { name: "Billie James", family: "ekko_billie" },
        { name: "Romantic Sunrise", family: "ekko_romantic" },
        { name: "Farmhouse", family: "ekko_farmhouse" },
        { name: "Chocolate", family: "ekko_chocolate" },
        { name: "Disney", family: "ekko_disney" },
        { name: "Simpson", family: "ekko_simpson" },
        { name: "Milk Water", family: "ekko_milk" }
    ];

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
        btnBackward: document.getElementById("btnBackward"),
        fontSelector: document.getElementById("fontSelector"),
        btnApplyFont: document.getElementById("btnApplyFont")
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

    function undo() {
        if (undoStack.length === 0) return;
        redoStack.push(paper.project.exportJSON({ asString: true }));
        const state = undoStack.pop();
        paper.project.clear();
        paper.project.importJSON(state);
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
        const displayItem = (window.selectedItem.data && window.selectedItem.data.clipGroup) ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        if (displayItem && displayItem.bounds) {
            if (ui.objWidth) ui.objWidth.value = displayItem.bounds.width.toFixed(1);
            if (ui.objHeight) ui.objHeight.value = displayItem.bounds.height.toFixed(1);
            const currentRot = displayItem.data?.rotationAngle || 0;
            const rotSuffix = currentRot !== 0 ? ` (${Math.round(((currentRot % 360) + 360) % 360)}°)` : "";
            if (ui.selectionInfo) ui.selectionInfo.textContent = (window.selectedItem.data?.label || "Objeto") + rotSuffix;
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

    window.selectItem = function(item) {
        if (window.nodeEditMode) {
            window.exitNodeEditMode();
        }
        if (window.selectedItem) {
            window.selectedItem.selected = false;
        }
        if (!item || (item.data && item.data.mockup)) {
            window.deselectItem();
            return;
        }
        window.selectedItem = item;
        window.updateSelectionBox(item);
        updateSelectionInfo();
        updateLockButton();
        if (typeof updateContextualMenu === "function") {
            updateContextualMenu(item);
        }
        paper.view.update();
    };

    window.deselectItem = function() {
        if (window.nodeEditMode) {
            window.exitNodeEditMode();
        }
        if (window.selectedItem) {
            window.selectedItem.selected = false;
        }
        window.selectedItem = null;
        window.updateSelectionBox(null);
        if (ui.selectionInfo) ui.selectionInfo.textContent = "Nada seleccionado";
        if (ui.objWidth) ui.objWidth.value = "";
        if (ui.objHeight) ui.objHeight.value = "";
        updateLockButton();
        if (typeof hideContextualMenu === "function") {
            hideContextualMenu();
        }
        paper.view.update();
    };

    // --- ALINEACIONES Y TRANSFORMACIONES ---
    function alignSelected(mode) {
        if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
        saveHistory();
        if (window.selectedItem.data && window.selectedItem.data.clipGroup) {
            const mask = window.selectedItem.children.find(c => c.clipMask);
            const content = window.selectedItem.children.find(c => !c.clipMask);
            if (mask && content) {
                const maskBounds = mask.bounds;
                const contentBounds = content.bounds.clone();
                let newX = content.position.x;
                let newY = content.position.y;
                if (mode === "left") newX = maskBounds.left + contentBounds.width / 2;
                if (mode === "centerH") newX = maskBounds.center.x;
                if (mode === "right") newX = maskBounds.right - contentBounds.width / 2;
                if (mode === "top") newY = maskBounds.top + contentBounds.height / 2;
                if (mode === "centerV") newY = maskBounds.center.y;
                if (mode === "bottom") newY = maskBounds.bottom - contentBounds.height / 2;
                content.position = new paper.Point(newX, newY);
            }
        } else {
            const canvasBounds = paper.view.bounds;
            const itemBounds = window.selectedItem.bounds.clone();
            const center = window.selectedItem.position.clone();
            let newX = center.x;
            let newY = center.y;
            if (mode === "left") newX = canvasBounds.left + itemBounds.width / 2;
            if (mode === "centerH") newX = canvasBounds.center.x;
            if (mode === "right") newX = canvasBounds.right - itemBounds.width / 2;
            if (mode === "top") newY = canvasBounds.top + itemBounds.height / 2;
            if (mode === "centerV") newY = canvasBounds.center.y;
            if (mode === "bottom") newY = canvasBounds.bottom - itemBounds.height / 2;
            window.selectedItem.position = new paper.Point(newX, newY);
        }
        window.updateSelectionBox(window.selectedItem);
        updateSelectionInfo();
        if (typeof updateContextualMenu === "function") {
            updateContextualMenu(window.selectedItem);
        }
        paper.view.update();
    }

    function centerSelected(mode) {
        if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
        saveHistory();
        if (window.selectedItem.data && window.selectedItem.data.clipGroup) {
            const mask = window.selectedItem.children.find(c => c.clipMask);
            const content = window.selectedItem.children.find(c => !c.clipMask);
            if (mask && content) {
                if (mode === "horizontal") content.position.x = mask.position.x;
                if (mode === "vertical") content.position.y = mask.position.y;
                if (mode === "both") content.position = mask.position.clone();
            }
        } else {
            const center = paper.view.bounds.center;
            if (mode === "horizontal") window.selectedItem.position.x = center.x;
            if (mode === "vertical") window.selectedItem.position.y = center.y;
            if (mode === "both") window.selectedItem.position = center.clone();
        }
        window.updateSelectionBox(window.selectedItem);
        updateSelectionInfo();
        if (typeof updateContextualMenu === "function") {
            updateContextualMenu(window.selectedItem);
        }
        paper.view.update();
    }

    function rotateSelected(angle) {
        if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
        saveHistory();
        const targetItem = (window.selectedItem.data && window.selectedItem.data.clipGroup) ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        if (targetItem) {
            targetItem.rotate(angle);
            targetItem.data = targetItem.data || {};
            targetItem.data.rotationAngle = (targetItem.data.rotationAngle || 0) + angle;
        }
        window.updateSelectionBox(window.selectedItem);
        updateSelectionInfo();
        if (typeof updateContextualMenu === "function") {
            updateContextualMenu(window.selectedItem);
        }
        paper.view.update();
    }

    function applySelectedSize() {
        if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
        const targetItem = (window.selectedItem.data && window.selectedItem.data.clipGroup) ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        if (!targetItem) return;
        const currentW = targetItem.bounds.width;
        const currentH = targetItem.bounds.height;
        if (currentW === 0 || currentH === 0) return;
        let newW = ui.objWidth ? parseFloat(ui.objWidth.value) : NaN;
        let newH = ui.objHeight ? parseFloat(ui.objHeight.value) : NaN;
        if (isNaN(newW) && isNaN(newH)) return;
        const keepRatio = ui.lockRatio ? ui.lockRatio.checked : false;
        const center = targetItem.position.clone();
        const originalRatio = currentW / currentH;
        if (keepRatio) {
            if (lastSizeField === "width" && !isNaN(newW) && newW > 0) {
                newH = newW / originalRatio;
                if (ui.objHeight) ui.objHeight.value = newH.toFixed(1);
            } else if (lastSizeField === "height" && !isNaN(newH) && newH > 0) {
                newW = newH * originalRatio;
                if (ui.objWidth) ui.objWidth.value = newW.toFixed(1);
            } else {
                return;
            }
        } else {
            if (isNaN(newW) || isNaN(newH) || newW <= 0 || newH <= 0) return;
        }
        const scaleX = newW / currentW;
        const scaleY = newH / currentH;
        saveHistory();
        targetItem.scale(scaleX, scaleY);
        targetItem.position = center;
        window.updateSelectionBox(window.selectedItem);
        updateSelectionInfo();
        if (typeof updateContextualMenu === "function") {
            updateContextualMenu(window.selectedItem);
        }
        paper.view.update();
    }

    // --- HISTORIAL DE ESCENAS POR PRODUCTO/SUPERFICIE ---
    function saveCurrentScene() {
        if (!toolState.currentProduct || !toolState.currentProduct.superficies) return;
        const idx = toolState.currentSurface || 0;
        const surface = toolState.currentProduct.superficies[idx];
        if (!surface) return;
        const key = getSceneKey(toolState.currentProduct, surface);
        sceneStates[key] = paper.project.exportJSON({ asString: true });
    }

    function loadSurfaceScene(product, surface) {
        if (!product || !surface) return;
        const key = getSceneKey(product, surface);
        window.deselectItem();
        if (sceneStates[key]) {
            paper.project.clear();
            paper.project.importJSON(sceneStates[key]);
            window.deselectItem();
            if (typeof restoreMockupReferences === "function") {
                restoreMockupReferences();
            }
            paper.view.update();
            return;
        }
        loadMockup(surface.svg);
    }

    // --- ACCIONES GENERALES ---
    function zoomBy(factor) {
        paper.view.zoom = Math.max(0.2, Math.min(10, paper.view.zoom * factor));
        if (window.selectedItem) {
            window.updateSelectionBox(window.selectedItem);
        }
        paper.view.update();
    }

    function fitView() {
        paper.view.zoom = 1;
        paper.view.center = paper.view.bounds.center;
        if (window.selectedItem) {
            window.updateSelectionBox(window.selectedItem);
        }
        paper.view.update();
    }

    function deleteSelected() {
        if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
        saveHistory();
        window.selectedItem.remove();
        window.selectedItem = null;
        window.deselectItem();
        paper.view.update();
    }

function duplicateSelected() {
    if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
    saveHistory();
    let duplicatedObject;
    if (window.selectedItem.data && window.selectedItem.data.clipGroup) {
        const content = window.selectedItem.children.find(c => !c.clipMask);
        if (!content) return;
        const contentClone = content.clone();
        contentClone.position = contentClone.position.add(new paper.Point(20, 20));
        
        sanitizeClonedData(contentClone); // <--- Desconecta referencias del hijo text/raster
        contentClone.data.locked = false;
        contentClone.data.label = `${window.selectedItem.data?.label || "Objeto"} copia`;
        
        duplicatedObject = window.clipItem(contentClone);
    } else {
        const clone = window.selectedItem.clone();
        clone.position = clone.position.add(new paper.Point(20, 20));
        
        sanitizeClonedData(clone); // <--- Desconecta referencias del objeto plano
        clone.data.locked = false;
        clone.data.label = `${window.selectedItem.data?.label || "Objeto"} copia`;
        
        duplicatedObject = clone;
    }
    if (duplicatedObject) {
        paper.project.activeLayer.addChild(duplicatedObject);
        if (window.currentMockup) {
            duplicatedObject.insertBelow(window.currentMockup);
        }
        window.selectItem(duplicatedObject);
    }
    paper.view.update();
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
    
    sanitizeClonedData(clone); // <--- Desconecta referencias de todo el árbol clonado
    clone.data.locked = false;
    
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

    // --- CARGADORES DE ARCHIVOS ---
    function addImageFromFile(file) {
        if (!file) return;
        saveHistory();
        const reader = new FileReader();
        reader.onload = (e) => {
            const raster = new paper.Raster({ source: e.target.result });
            raster.onLoad = () => {
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

    // --- QR EN CONDICIONES COMPATIBLES ---
    function addQRCode(text) {
        if (!text) return;
        saveHistory();
        const generateRealQR = () => {
            if (typeof QRCode !== "undefined") {
                try {
                    const tempDiv = document.createElement("div");
                    const qr = new QRCode(tempDiv, { text: text, width: 512, height: 512, colorDark: "#000000", colorLight: "#ffffff", correctLevel: QRCode.CorrectLevel.L });
                    setTimeout(() => {
                        const qrCanvas = tempDiv.querySelector("canvas");
                        if (qrCanvas) {
                            const raster = new paper.Raster(qrCanvas);
                            raster.onLoad = () => {
                                raster.data = { locked: false, label: "QR: " + text };
                                setupAndClipQR(raster);
                            };
                        } else {
                            fallbackToGoogleChart(text);
                        }
                    }, 50);
                } catch (e) {
                    console.warn("Error con QRCode JS, usando fallback de red:", e);
                    fallbackToGoogleChart(text);
                }
            } else {
                const script = document.createElement("script");
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
                script.onload = () => {
                    generateRealQR();
                };
                script.onerror = () => {
                    fallbackToGoogleChart(text);
                };
                document.head.appendChild(script);
            }
        };
        generateRealQR();
    }

    function fallbackToGoogleChart(text) {
        const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=512x512&chld=L|0&chl=${encodeURIComponent(text)}`;
        const raster = new paper.Raster({ source: qrUrl });
        raster.onLoad = () => {
            raster.data = { locked: false, label: "QR: " + text };
            setupAndClipQR(raster);
        };
        raster.onError = () => {
            alert("No se pudo generar el código QR. Verifique su conexión a Internet.");
        };
    }

    function setupAndClipQR(qrItem) {
        const bounds = qrItem.bounds;
        const canvasBounds = paper.view.bounds;
        const scale = Math.min((canvasBounds.width * 0.35) / bounds.width, (canvasBounds.height * 0.35) / bounds.height);
        qrItem.scale(scale);
        qrItem.position = canvasBounds.center;
        const objeto = window.clipItem(qrItem);
        if (window.currentMockup) {
            objeto.insertBelow(window.currentMockup);
        }
        window.selectItem(objeto);
        paper.view.update();
    }

    // --- ENLACE DE FUENTES ---
    function applySelectedFont() {
        if (!window.selectedItem) return;
        const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        if (!target) return;
        const font = ui.fontSelector ? ui.fontSelector.value : "Arial";
        saveHistory();
        if (target instanceof paper.PointText) {
            target.fontFamily = font;
        } else if (target instanceof paper.Group) {
            target.children.forEach(child => {
                if (child instanceof paper.PointText) child.fontFamily = font;
            });
        }
        window.updateSelectionBox(window.selectedItem);
        if (typeof updateContextualMenu === "function") {
            updateContextualMenu(window.selectedItem);
        }
        paper.view.update();
    }

    function renderFontGallery() {
        // Obsoleto: Reemplazado por selector tipográfico popover en contextualMenu.js
    }

    // --- INTERFAZ DINÁMICA DE PRODUCTOS ---
    function renderCategories() {
        if (!ui.categoryTabs) return;
        ui.categoryTabs.innerHTML = "";
        if (!window.EKKO_STUDIO_PRODUCTS) {
            console.warn("Base de datos de productos no cargada todavía en window.");
            return;
        }
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
        if (ui.surfaceTabs) ui.surfaceTabs.innerHTML = "";
        if (!product || !product.superficies || product.superficies.length === 0) return;
        product.superficies.forEach((surf, index) => {
            if (ui.surfaceTabs) {
                const btn = document.createElement("button");
                const isSel = (toolState.currentSurface === index);
                btn.className = "tab-btn" + (isSel ? " active" : "");
                btn.textContent = surf.nombre;
                btn.onclick = () => {
                    saveCurrentScene();
                    toolState.currentSurface = index;
                    renderSurfacesOnly(product);
                    loadSurfaceScene(product, surf);
                };
                ui.surfaceTabs.appendChild(btn);
            }
        });
    }

    function renderSurfaces(product) {
        renderSurfacesOnly(product);
    }

    function activateTextMode() {
        insertTextMode = true;
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

    // ========================================================
    // --- MANEJO DE HERRAMIENTA DE RATÓN Y TECLADO ---
    // ========================================================
    let insertTextMode = false;
    let lastClickTime = 0;
    window.draggingCurveHandle = false;
    window.curveTarget = null;
    window.curveInitialPoint = null;
    window.curveInitialCurvature = 0;

    const tool = new paper.Tool();
tool.onMouseDown = function(event) {
    const currentTime = Date.now();
    const isDoubleClick = (currentTime - lastClickTime) < 300;
    lastClickTime = currentTime;

    // 1. Detectar si el usuario hace clic sobre el tirador azul de doblado (Curvatura)
    if (window.selectedItem) {
        const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
        if (target && target instanceof paper.Group) {
            const hitHandle = target.hitTest(event.point, { fill: true, stroke: true, tolerance: 8 });
            if (hitHandle && hitHandle.item && hitHandle.item.data && hitHandle.item.data.isCurveHandle) {
                window.draggingCurveHandle = true;
                window.curveTarget = target;
                window.curveInitialPoint = event.point.clone();
                window.curveInitialCurvature = target.data.curvature || 0;
                if (typeof hideContextualMenu === "function") hideContextualMenu();
                return;
            }
        }
    }

    // 2. Detectar clics en los 8 tiradores de redimensionamiento de Canva
    if (window.selectionBoxGroup) {
        const hitHandle = window.selectionBoxGroup.hitTest(event.point, { fill: true, stroke: true, tolerance: 8 / paper.view.zoom });
        if (hitHandle && hitHandle.item && hitHandle.item.data && hitHandle.item.data.isHandle) {
            window.resizeActive = true;
            window.resizeTarget = window.selectedItem;
            window.resizeHandleType = hitHandle.item.data.handleType;
            window.resizeInitialBounds = ((window.selectedItem.data && window.selectedItem.data.clipGroup) ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem).bounds.clone();
            window.resizeAnchor = window.getOppositePoint(window.resizeInitialBounds, window.resizeHandleType);
            window.resizeInitialPoint = window.getHandlePoint(window.resizeInitialBounds, window.resizeHandleType);
            window.resizeLastScaleX = 1.0;
            window.resizeLastScaleY = 1.0;
            window.dragging = false;
            if (typeof hideContextualMenu === "function") {
                hideContextualMenu();
            }
            return;
        }
    }

    if (insertTextMode) {
        createEditableText(event.point);
        insertTextMode = false;
        paper.view.element.style.cursor = "default";
        return;
    }

    // --- INTERCEPCIÓN PROACTIVA DE LÍMITES (SOLUCIONA EL ARRASTRE FUERA DE SVG) ---
    let selectable = null;
    
    // Si ya hay un elemento seleccionado, y hacemos clic dentro de sus límites reales (incluso si está oculto/enmascarado)
    if (window.selectedItem && !isLockedItem(window.selectedItem)) {
        const displayItem = (window.selectedItem.data && window.selectedItem.data.clipGroup)
            ? window.selectedItem.children.find(c => !c.clipMask)
            : window.selectedItem;
        if (displayItem && displayItem.bounds && displayItem.bounds.contains(event.point)) {
            selectable = window.selectedItem;
        }
    }

    // Si no se hizo clic en el seleccionado actual, buscar normalmente en el canvas
    if (!selectable) {
        const hit = paper.project.hitTest(event.point, {
            fill: true,
            stroke: true,
            segments: true,
            tolerance: 8,
            match: function(hitResult) {
                return !hitResult.item.data || !hitResult.item.data.mockup;
            }
        });
        if (hit && hit.item) {
            selectable = window.getSelectableItem(hit.item);
        }
    }
    // ------------------------------------------------------------------------------

    if (selectable) {
        if (isLockedItem(selectable)) {
            window.selectItem(selectable);
            window.dragging = false;
            return;
        }

        // DOBLE CLIC PARA EDITAR TEXTOS (Estilo LightBurn)
        if (isDoubleClick) {
            const textItem = selectable.data?.clipGroup ? selectable.children.find(c => !c.clipMask) : selectable;
            if (textItem instanceof paper.PointText) {
                window.dragging = false;
                startTextEditing(textItem);
                return;
            }
        }

        window.selectItem(selectable);
        window.dragging = true;
        if (selectable.data && selectable.data.clipGroup) {
            const content = selectable.children.find(c => !c.clipMask);
            window.dragOffset = event.point.subtract(content ? content.position : selectable.position);
        } else {
            window.dragOffset = event.point.subtract(selectable.position);
        }
        if (typeof hideContextualMenu === "function") {
            hideContextualMenu();
        }
    } else {
        window.deselectItem();
    }
};

    tool.onMouseDrag = function(event) {
        // 1. Rotación interactiva por arrastre de tirador circular
        if (window.rotateActive && window.rotateTarget) {
            const targetItem = (window.rotateTarget.data && window.rotateTarget.data.clipGroup) ? window.rotateTarget.children.find(c => !c.clipMask) : window.rotateTarget;
            if (targetItem) {
                const currentVector = event.point.subtract(window.rotateCenter);
                let angle = currentVector.angle - window.rotateStartVector.angle;
                if (event.modifiers.shift) {
                    angle = Math.round(angle / 15) * 15;
                }
                targetItem.rotate(angle, window.rotateCenter);
                window.rotateStartVector = currentVector;
                targetItem.data = targetItem.data || {};
                targetItem.data.rotationAngle = (targetItem.data.rotationAngle || 0) + angle;
                window.updateSelectionBox(window.rotateTarget);
                updateSelectionInfo();
                paper.view.update();
            }
            return;
        }

        // 2. Tirador de doblado de LightBurn
        if (window.draggingCurveHandle && window.curveTarget) {
            const deltaY = event.point.y - window.curveInitialPoint.y;
            let newCurvature = window.curveInitialCurvature + (deltaY * 0.5);
            newCurvature = Math.max(-100, Math.min(100, newCurvature));
            const curveSlider = document.getElementById('ctxTextCurve');
            if (curveSlider) {
                curveSlider.value = newCurvature.toFixed(1);
            }
            const parentItem = window.curveTarget.parent && window.curveTarget.parent.data?.clipGroup ? window.curveTarget.parent : window.curveTarget;
            import("./modules/canvas-pro/textToolbar.js").then(module => {
                module.applyTextCurve(parentItem, newCurvature);
            });
            return;
        }

        // 3. Escalado interactivo (Resizing)
        if (window.resizeActive && window.resizeTarget) {
            const targetItem = (window.resizeTarget.data && window.resizeTarget.data.clipGroup) ? window.resizeTarget.children.find(c => !c.clipMask) : window.resizeTarget;
            if (!targetItem) return;
            let anchor = window.resizeAnchor;
            if (event.modifiers.control) {
                anchor = window.resizeInitialBounds.center;
            }
            const initHandlePoint = window.getHandlePoint(window.resizeInitialBounds, window.resizeHandleType);
            const initW = Math.abs(initHandlePoint.x - anchor.x);
            const initH = Math.abs(initHandlePoint.y - anchor.y);
            let currW = Math.abs(event.point.x - anchor.x);
            let currH = Math.abs(event.point.y - anchor.y);
            if (currW < 1) currW = 1;
            if (currH < 1) currH = 1;
            let scaleX = 1.0;
            let scaleY = 1.0;
            const isCorner = ['tl', 'tr', 'bl', 'br'].includes(window.resizeHandleType);
            const hasWidth = ['l', 'r', 'tl', 'tr', 'bl', 'br'].includes(window.resizeHandleType);
            const hasHeight = ['t', 'b', 'tl', 'tr', 'bl', 'br'].includes(window.resizeHandleType);
            if (hasWidth && initW > 0) scaleX = currW / initW;
            if (hasHeight && initH > 0) scaleY = currH / initH;
            if (isCorner && !event.modifiers.shift) {
                const aspectScale = (scaleX + scaleY) / 2;
                scaleX = aspectScale;
                scaleY = aspectScale;
            }
            targetItem.scale(1 / window.resizeLastScaleX, 1 / window.resizeLastScaleY, anchor);
            targetItem.scale(scaleX, scaleY, anchor);
            window.resizeLastScaleX = scaleX;
            window.resizeLastScaleY = scaleY;
            window.updateSelectionBox(window.resizeTarget);
            paper.view.update();
            return;
        }

        // 4. Arrastre normal de objetos (Translación)
        if (window.dragging && window.selectedItem) {
            if (isLockedItem(window.selectedItem)) return;
            if (window.selectedItem.data && window.selectedItem.data.clipGroup) {
                const content = window.selectedItem.children.find(c => !c.clipMask);
                if (content) {
                    content.position = event.point.subtract(window.dragOffset);
                }
            } else {
                window.selectedItem.position = event.point.subtract(window.dragOffset);
            }
            window.updateSelectionBox(window.selectedItem);
            paper.view.update();
        }
    };

    tool.onMouseUp = function(event) {
        if (window.rotateActive) {
            saveHistory();
            window.rotateActive = false;
            window.rotateTarget = null;
            window.rotateCenter = null;
            window.rotateStartVector = null;
            updateSelectionInfo();
            if (typeof updateContextualMenu === "function" && window.selectedItem) {
                updateContextualMenu(window.selectedItem);
            }
            paper.view.update();
            return;
        }
        if (window.draggingCurveHandle) {
            window.draggingCurveHandle = false;
            window.curveTarget = null;
            saveHistory();
            paper.view.update();
            return;
        }
        if (window.resizeActive) {
            saveHistory();
            window.resizeActive = false;
            window.resizeHandleType = null;
            window.resizeTarget = null;
            window.resizeInitialBounds = null;
            window.resizeAnchor = null;
            window.resizeLastScaleX = 1.0;
            window.resizeLastScaleY = 1.0;
            updateSelectionInfo();
            if (typeof updateContextualMenu === "function" && window.selectedItem) {
                updateContextualMenu(window.selectedItem);
            }
            paper.view.update();
            return;
        }
        if (window.dragging) {
            saveHistory();
            updateSelectionInfo();
            if (typeof updateContextualMenu === "function" && window.selectedItem) {
                updateContextualMenu(window.selectedItem);
            }
        }
        window.dragging = false;
        paper.view.update();
    };

    tool.onKeyDown = function(event) {
        const active = document.activeElement;
        const isTyping = active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.tagName === "SELECT" || active.isContentEditable);
        if (isTyping) return;
        if (event.modifiers.control && event.key === "z") {
            undo();
            return;
        }
        if (event.modifiers.control && event.key === "c") {
            copySelected();
            return;
        }
        if (event.modifiers.control && event.key === "v") {
            pasteSelected();
            return;
        }
        if (event.modifiers.control && (event.key === "y" || (event.modifiers.shift && event.key === "z"))) {
            redo();
            return;
        }
        if (event.key === "delete") {
            deleteSelected();
        }
        if (window.selectedItem && !isLockedItem(window.selectedItem)) {
            const step = event.modifiers.shift ? 10 : 1;
            const targetMove = (window.selectedItem.data && window.selectedItem.data.clipGroup) ? window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
            if (targetMove) {
                if (event.key === "left") {
                    targetMove.position.x -= step;
                    event.preventDefault();
                }
                if (event.key === "right") {
                    targetMove.position.x += step;
                    event.preventDefault();
                }
                if (event.key === "up") {
                    targetMove.position.y -= step;
                    event.preventDefault();
                }
                if (event.key === "down") {
                    targetMove.position.y += step;
                    event.preventDefault();
                }
            }
            window.updateSelectionBox(window.selectedItem);
            updateSelectionInfo();
            if (typeof updateContextualMenu === "function") {
                updateContextualMenu(window.selectedItem);
            }
            paper.view.update();
        }
    };

    // --- ENLAZAR EVENTOS DEL DOM ---
    const safeAddListener = (elOrId, event, callback) => {
        const el = typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
        if (el) {
            el.addEventListener(event, callback);
        }
    };

    safeAddListener("btnAddText", "click", activateTextMode);
    safeAddListener("btnDelete", "click", deleteSelected);
    safeAddListener("btnDuplicate", "click", duplicateSelected);
    safeAddListener("btnBringFront", "click", bringFront);
    safeAddListener("btnSendBack", "click", sendBack);
    safeAddListener(ui.btnForward, "click", bringForward);
    safeAddListener(ui.btnBackward, "click", sendBackward);
    safeAddListener("btnZoomIn", "click", () => zoomBy(1.15));
    safeAddListener("btnZoomOut", "click", () => zoomBy(1 / 1.15));
    safeAddListener("btnFit", "click", fitView);

    safeAddListener("btnAddImage", "click", () => {
        if (ui.imagePicker) {
            ui.imagePicker.value = "";
            ui.imagePicker.click();
        }
    });

    safeAddListener("btnAddSVG", "click", () => {
        if (ui.svgPicker) {
            ui.svgPicker.value = "";
            ui.svgPicker.click();
        }
    });

    if (ui.imagePicker) {
        ui.imagePicker.addEventListener("change", (e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                const file = files.item(0);
                addImageFromFile(file);
            }
        });
    }

    if (ui.svgPicker) {
        ui.svgPicker.addEventListener("change", (e) => {
            const files = e.target.files;
            if (files && files.length > 0) {
                const file = files.item(0);
                addSVGFromFile(file);
            }
        });
    }

    const onQRClick = () => {
        const text = prompt("Ingrese el texto o enlace (URL) para generar el código QR:");
        if (text) {
            addQRCode(text);
        }
    };

    safeAddListener("btnQR", "click", onQRClick);
    safeAddListener("btnAddQR", "click", onQRClick);
    safeAddListener("btnCreateQR", "click", onQRClick);
    safeAddListener("btnCreateQr", "click", onQRClick);

    safeAddListener(ui.btnApplySize, "click", applySelectedSize);
    safeAddListener(ui.btnToggleLock, "click", toggleLockSelected);
    safeAddListener(ui.btnAlignLeft, "click", () => alignSelected("left"));
    safeAddListener(ui.btnAlignCenterH, "click", () => alignSelected("centerH"));
    safeAddListener(ui.btnAlignRight, "click", () => alignSelected("right"));
    safeAddListener(ui.btnAlignTop, "click", () => alignSelected("top"));
    safeAddListener(ui.btnAlignCenterV, "click", () => alignSelected("centerV"));
    safeAddListener(ui.btnAlignBottom, "click", () => alignSelected("bottom"));

    safeAddListener(ui.btnRotateLeft, "click", () => { rotateSelected(-90); });
    safeAddListener(ui.btnRotateRight, "click", () => { rotateSelected(90); });
    safeAddListener(ui.btnRotate180, "click", () => { rotateSelected(180); });

    safeAddListener(ui.btnCenterH, "click", () => { centerSelected("horizontal"); });
    safeAddListener(ui.btnCenterV, "click", () => { centerSelected("vertical"); });
    safeAddListener(ui.btnCenterBoth, "click", () => { centerSelected("both"); });

    safeAddListener(ui.objWidth, "input", () => { lastSizeField = "width"; });
    safeAddListener(ui.objHeight, "input", () => { lastSizeField = "height"; });

    window.addEventListener("resize", () => {
        const canvasEl = document.getElementById("editorCanvas");
        if (canvasEl) {
            paper.view.viewSize = new paper.Size(canvasEl.clientWidth, canvasEl.clientHeight);
        }
    });

    safeAddListener(ui.btnApplyFont, "click", applySelectedFont);

    if (typeof initContextualMenu === 'function') {
        initContextualMenu();
    }

    renderCategories();
});


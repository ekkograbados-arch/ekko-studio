import "./modules/selection.js";
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
        const displayItem = (window.selectedItem.data && window.selectedItem.data.clipGroup)
            ? window.selectedItem.children.find(c => !c.clipMask)
            : window.selectedItem;

        if (displayItem && displayItem.bounds) {
            if (ui.objWidth) ui.objWidth.value = displayItem.bounds.width.toFixed(1);
            if (ui.objHeight) ui.objHeight.value = displayItem.bounds.height.toFixed(1);
            if (ui.selectionInfo) ui.selectionInfo.textContent = window.selectedItem.data?.label || "Objeto";
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
        if (window.selectedItem.data && window.selectedItem.data.clipGroup) {
            const content = window.selectedItem.children.find(c => !c.clipMask);
            if (content) content.rotate(angle);
        } else {
            window.selectedItem.rotate(angle);
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
        const targetItem = (window.selectedItem.data && window.selectedItem.data.clipGroup)
            ? window.selectedItem.children.find(c => !c.clipMask)
            : window.selectedItem;

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
        const clone = window.selectedItem.clone();
        clone.position = clone.position.add(new paper.Point(20, 20));
        clone.data = clone.data || {};
        clone.data.locked = false;
        clone.data.label = `${window.selectedItem.data?.label || "Objeto"} copia`;
        paper.project.activeLayer.addChild(clone);
        window.selectItem(clone);
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

    // --- CARGADORES DE ARCHIVOS CON ENMASCARAMIENTO COMPATIBLE ---

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

                // RECORTAR AUTOMÁTICAMENTE LA IMAGEN AL CONTORNO DEL SVG
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

                // RECORTAR EL SVG AL CONTORNO DE FORMA SEGURA Y ASIGNAR GRUPO DE CLIP
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

    // --- GENERADOR UNIFICADO DE CÓDIGOS QR DE ALTA RESOLUCIÓN Y BAJA DENSIDAD (ESPECÍFICO DE 4MM) ---
    function addQRCode(text) {
        if (!text) return;
        saveHistory();

        // Para grabado láser en superficies mínimas (como pulseras de 4mm), 
        // es fundamental usar el nivel de corrección de errores más bajo (L - 7%) 
        // y margen cero. Esto genera un diseño con módulos (cuadrados) grandes 
        // y de muy baja densidad, facilitando la lectura por cualquier cámara. [5, 6]
        
        const generateRealQR = () => {
            if (typeof QRCode !== "undefined") {
                // Si la librería QRCode está cargada en el window, la usamos con Nivel L
                try {
                    const tempDiv = document.createElement("div");
                    const qr = new QRCode(tempDiv, {
                        text: text,
                        width: 512,
                        height: 512,
                        colorDark: "#000000",
                        colorLight: "#ffffff",
                        correctLevel: QRCode.CorrectLevel.L // Forzar Nivel L (Baja densidad) [5, 6]
                    });
                    
                    // Esperar un instante a que el canvas del QR se dibuje
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
                // Intentar cargar dinámicamente la librería QRCode para tener generación offline real
                const script = document.createElement("script");
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
                script.onload = () => {
                    generateRealQR();
                };
                script.onerror = () => {
                    // Si no hay red para el CDN, usar el fallback de Google Charts
                    fallbackToGoogleChart(text);
                };
                document.head.appendChild(script);
            }
        };

        generateRealQR();
    }

    function fallbackToGoogleChart(text) {
        // Google Charts QR API optimizado para grabado de 4mm:
        // - chld=L|0 -> Corrección de Errores L (baja densidad) y Margen 0 (módulos más grandes) [6]
        // - chs=512x512 -> Alta resolución para evitar píxeles borrosos al redimensionar [3, 7]
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

        // RECORTAR EL QR AL CONTORNO EXACTO DEL PRODUCTO
        const objeto = window.clipItem(qrItem);
        if (window.currentMockup) {
            objeto.insertBelow(window.currentMockup);
        }
        window.selectItem(objeto);
        paper.view.update();
    }

    // --- ENLACE SEGURO DE FUENTES ---
    function applySelectedFont() {
        if (!window.selectedItem) return;
        if (!(window.selectedItem instanceof paper.PointText)) {
            alert("Seleccione un texto");
            return;
        }
        const font = ui.fontSelector ? ui.fontSelector.value : "Arial";
        saveHistory();
        window.selectedItem.fontFamily = font;
        window.updateSelectionBox(window.selectedItem);
        if (typeof updateContextualMenu === "function") {
            updateContextualMenu(window.selectedItem);
        }
        paper.view.update();
    }

    function renderFontGallery() {
        const list = document.getElementById("fontList");
        if (!list) return;
        list.innerHTML = "";
        FONTS.forEach(font => {
            const item = document.createElement("div");
            item.className = "font-item";
            item.innerHTML = `<div class="font-preview" style="font-family: ${font.family}">Feliz Día Papá</div><div class="font-name">${font.name}</div>`;
            item.onclick = () => {
                if (window.selectedItem) {
                    const target = window.selectedItem.data?.clipGroup 
                        ? window.selectedItem.children.find(c => !c.clipMask) 
                        : window.selectedItem;

                    if (target && target instanceof paper.PointText) {
                        saveHistory();
                        target.fontFamily = font.family;
                        window.updateSelectionBox(window.selectedItem);
                        if (typeof updateContextualMenu === "function") {
                            updateContextualMenu(window.selectedItem);
                        }
                        paper.view.update();
                    }
                }
            };
            list.appendChild(item);
        });
    }

    // --- INTERFAZ DINÁMICA DE CATEGORÍAS Y PRODUCTOS (INMUNIZADA Y DEFENSIVA) ---
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

        // 1. Si no hay un producto activo especificado, tomamos el actual, o por defecto el primero
        if (!activeProduct) {
            const current = toolState.currentProduct;
            const belongsToCategory = group.productos.some(p => current && p.id === current.id);
            if (belongsToCategory) {
                activeProduct = current;
            } else {
                activeProduct = group.productos; // ¡CORREGIDO: ASIGNACIÓN DE OBJETO FIJA!
            }
        }

        toolState.currentProduct = activeProduct;

        // 2. Renderizar los botones de las pestañas de productos
        group.productos.forEach((prod) => {
            if (ui.productTabs) {
                const btn = document.createElement("button");
                const isSel = (activeProduct && prod.id === activeProduct.id);
                btn.className = "tab-btn" + (isSel ? " active" : "");
                btn.textContent = prod.nombre;
                btn.onclick = () => {
                    saveCurrentScene();
                    toolState.currentProduct = prod;
                    toolState.currentSurface = 0; // Al cambiar de producto, siempre vamos a la cara 0 (Frente)
                    renderProducts(categoryIndex, prod);
                };
                ui.productTabs.appendChild(btn);
            }
        });

        // 3. Renderizar caras del producto activo y cargar la escena en el canvas
        if (activeProduct) {
            renderSurfaces(activeProduct);
            const surfaces = activeProduct.superficies || [];
            const activeSurf = surfaces[toolState.currentSurface] || surfaces;
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
                btn.className = "tab-btn" + (toolState.currentSurface === index ? " active" : "");
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
        const txt = new paper.PointText({
            point: point,
            content: "Texto", // Texto inicial por defecto para dimensiones > 0 y selección visible
            fontSize: 42,
            fillColor: new paper.Color(0),
            justification: "center",
            fontFamily: "Arial"
        });
        txt.data = { locked: false, label: "Texto" };
        paper.project.activeLayer.addChild(txt);
        
        // ENMASCARAR AUTOMÁTICAMENTE EL NUEVO TEXTO
        const clipped = window.clipItem(txt);
        if (window.currentMockup) {
            clipped.insertBelow(window.currentMockup);
        }
        window.selectItem(clipped); // Selecciona el Clip Group
        startTextEditing(txt);
    }

    // ========================================================
    // --- MANEJO DE HERRAMIENTA DE RATÓN Y TECLADO (TIRADORES CANVA/LIGHTBURN) ---
    // ========================================================
    if (typeof window.getOppositePoint !== 'function') {
        window.getOppositePoint = function(bounds, handleType) {
            switch (handleType) {
                case 'tl': return bounds.bottomRight;
                case 'tr': return bounds.bottomLeft;
                case 'bl': return bounds.topRight;
                case 'br': return bounds.topLeft;
                case 't':  return bounds.bottomCenter;
                case 'b':  return bounds.topCenter;
                case 'l':  return bounds.rightCenter;
                case 'r':  return bounds.leftCenter;
                default:   return bounds.center;
            }
        };
    }

    if (typeof window.getHandlePoint !== 'function') {
        window.getHandlePoint = function(bounds, handleType) {
            switch (handleType) {
                case 'tl': return bounds.topLeft;
                case 'tr': return bounds.topRight;
                case 'bl': return bounds.bottomLeft;
                case 'br': return bounds.bottomRight;
                case 't':  return bounds.topCenter;
                case 'b':  return bounds.bottomCenter;
                case 'l':  return bounds.leftCenter;
                case 'r':  return bounds.rightCenter;
                default:   return bounds.center;
            }
        };
    }

    let insertTextMode = false;
    const tool = new paper.Tool();

    tool.onMouseDown = function(event) {
        if (window.selectionBoxGroup) {
            const hitHandle = window.selectionBoxGroup.hitTest(event.point, {
                fill: true,
                stroke: true,
                tolerance: 8 / paper.view.zoom
            });

            if (hitHandle && hitHandle.item && hitHandle.item.data && hitHandle.item.data.isHandle) {
                window.resizeActive = true;
                window.resizeHandleType = hitHandle.item.data.handleType;
                window.resizeTarget = window.selectedItem;

                const targetItem = (window.resizeTarget.data && window.resizeTarget.data.clipGroup)
                    ? window.resizeTarget.children.find(c => !c.clipMask)
                    : window.resizeTarget;

                window.resizeInitialBounds = targetItem.bounds.clone();
                window.resizeInitialPoint = event.point.clone();
                window.resizeAnchor = window.getOppositePoint(window.resizeInitialBounds, window.resizeHandleType);
                
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
            const selectable = window.getSelectableItem(hit.item);
            if (selectable) {
                if (isLockedItem(selectable)) {
                    window.selectItem(selectable);
                    window.dragging = false;
                    return;
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
            }
        } else {
            window.deselectItem();
        }
    };

    tool.onMouseDrag = function(event) {
        if (window.resizeActive && window.resizeTarget) {
            const targetItem = (window.resizeTarget.data && window.resizeTarget.data.clipGroup)
                ? window.resizeTarget.children.find(c => !c.clipMask)
                : window.resizeTarget;

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

    tool.onKeyDown = function (event) {
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
            
            const targetMove = (window.selectedItem.data && window.selectedItem.data.clipGroup)
                ? window.selectedItem.children.find(c => !c.clipMask)
                : window.selectedItem;

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

    // --- ENLAZAR EVENTOS DEL DOM DE FORMA TOTALMENTE DEFENSIVA ---
    const safeAddListener = (elOrId, event, callback) => {
        const el = typeof elOrId === "string" ? document.getElementById(elOrId) : elOrId;
        if (el) {
            el.addEventListener(event, callback);
        }
    };

    safeAddListener("btnAddText", "click", activateTextMode);
    
    const fontGalleryEl = document.getElementById("fontGallery");
    if (fontGalleryEl) {
        fontGalleryEl.classList.remove("hidden");
    }
    renderFontGallery();

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

    // ENLAZAR GENERADOR DE CÓDIGO QR EN TODOS LOS IDs POSIBLES DE LA BARRA SUPERIOR
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

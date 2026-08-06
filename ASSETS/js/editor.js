import "./modules/selection.js";
import { startTextEditing } from "./modules/textEditor.js";
import { loadMockup, restoreMockupReferences } from "./modules/mockupLoader.js";
import { initContextualMenu, updateContextualMenu, hideContextualMenu } from "./modules/canvas-pro/contextualMenu.js";

window.addEventListener("DOMContentLoaded", () => {
    paper.setup("editorCanvas");
    const canvasEl = document.getElementById("editorCanvas");
    paper.view.viewSize = new paper.Size(canvasEl.clientWidth, canvasEl.clientHeight);

    const toolState = {
        currentCategory: 0,
        currentProduct: null,
        currentSurface: 0,
        zoom: 1
    };

    const sceneStates = {};
    function getSceneKey(product, surface) {
        return `${product.id}__${surface.nombre}`;
    }

    const undoStack = [];
    const redoStack = [];
    window.loadToken = 0;
    window.selectedItem = null;
    window.dragOffset = null;
    window.dragging = false;

    const ui = {
        categoryTabs: document.getElementById("categoryTabs"),
        productTabs: document.getElementById("productTabs"),
        surfaceTabs: document.getElementById("surfaceTabs"),
        selectionInfo: document.getElementById("selectionInfo"),
        imagePicker: document.getElementById("imagePicker"),
        svgPicker: document.getElementById("svgPicker")
    };

    initContextualMenu();

    // Carga de tipografías dinámica
    async function loadDynamicFonts() {
        try {
            const response = await fetch('/api/fonts');
            if (!response.ok) throw new Error("No se pudo obtener el listado de fuentes");
            const fonts = await response.json();
            
            if (fonts && fonts.length > 0) {
                const styleEl = document.createElement('style');
                let styleContent = '';
                fonts.forEach(font => {
                    styleContent += `
                        @font-face {
                            font-family: '${font.family}';
                            src: url('/ASSETS/fonts/${font.file}') format('truetype');
                            font-display: swap;
                        }
                    `;
                });
                styleEl.textContent = styleContent;
                document.head.appendChild(styleEl);

                const selectEl = document.getElementById('ctxFontSelector');
                if (selectEl) {
                    selectEl.innerHTML = '';
                    fonts.forEach(font => {
                        const opt = document.createElement('option');
                        opt.value = font.family;
                        opt.textContent = font.name;
                        selectEl.appendChild(opt);
                    });
                }
                
                window.DYNAMIC_FONTS = fonts;
            }
        } catch (err) {
            console.warn("La API /api/fonts no está activa. Cargando las 16 fuentes de la marca desde styles.css.");
            
            const officialFonts = [
                { name: "Au Bord de la Seine", family: "ekko_seine" },
                { name: "Billie James", family: "ekko_billie" },
                { name: "Breathing", family: "ekko_breathing" },
                { name: "Chocolate", family: "ekko_chocolate" },
                { name: "Farmhouse", family: "ekko_farmhouse" },
                { name: "High Spirited", family: "ekko_high" },
                { name: "Beyond Infinity", family: "ekko_beyond" },
                { name: "Milk Water", family: "ekko_milk" },
                { name: "Nostalgic Letter", family: "ekko_nostalgic" },
                { name: "Please write me a song", family: "ekko_song" },
                { name: "Romantic Sunrise", family: "ekko_romantic" },
                { name: "Simple Handmade", family: "ekko_simple" },
                { name: "Simpson", family: "ekko_simpson" },
                { name: "Study Night", family: "ekko_studynight" },
                { name: "Study Person", family: "ekko_studyperson" },
                { name: "Disney", family: "ekko_disney" }
            ];
            
            const selectEl = document.getElementById('ctxFontSelector');
            if (selectEl) {
                selectEl.innerHTML = '';
                officialFonts.forEach(font => {
                    const opt = document.createElement('option');
                    opt.value = font.family;
                    opt.textContent = font.name;
                    selectEl.appendChild(opt);
                });
            }
        }
    }

    loadDynamicFonts();

    const originalDeselect = window.deselectItem;
    window.deselectItem = function() {
        if (typeof originalDeselect === "function") originalDeselect();
        hideContextualMenu();
    };

    const originalSelect = window.selectItem;
    window.selectItem = function(item) {
        if (item && item.data && item.data.mockup) {
            window.deselectItem();
            return;
        }
        if (typeof originalSelect === "function") originalSelect(item);
        updateContextualMenu(item);
    };

    function saveHistory() {
        undoStack.push(paper.project.exportJSON({ asString: true }));
        if (undoStack.length > 50) {
            undoStack.shift();
        }
        redoStack.length = 0;
    }

    function isLockedItem(item) {
        return item && item.data && item.data.locked === true;
    }

    function saveCurrentScene() {
        if (!toolState.currentProduct || !toolState.currentProduct.superficies) return;
        const idx = toolState.currentSurface || 0;
        const surface = toolState.currentProduct.superficies.slice(idx, idx + 1).shift();
        if (!surface) return;
        const key = getSceneKey(toolState.currentProduct, surface);
        sceneStates[key] = paper.project.exportJSON({ asString: true });
    }

    function loadSurfaceScene(product, surface) {
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

    function zoomBy(factor) {
        paper.view.zoom = Math.max(0.2, Math.min(10, paper.view.zoom * factor));
        if (window.selectedItem) {
            window.updateSelectionBox(window.selectedItem);
            updateContextualMenu(window.selectedItem);
        }
        paper.view.update();
    }

    function fitView() {
        paper.view.zoom = 1;
        paper.view.center = paper.view.bounds.center;
        if (window.selectedItem) {
            window.updateSelectionBox(window.selectedItem);
            updateContextualMenu(window.selectedItem);
        }
        paper.view.update();
    }

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
                
                const selectable = window.getSelectableItem(item) || item;
                window.selectItem(selectable);
                
                if (window.currentMockup) {
                    item.insertBelow(window.currentMockup);
                }
                paper.view.update();
                item.bringToFront();
            });
        };
        reader.readAsText(file);
    }

    function createEditableText(point) {
        saveHistory();
        const txt = new paper.PointText({
            point,
            content: "Haz clic para editar",
            fontSize: 24,
            fillColor: new paper.Color(0),
            justification: "center",
            fontFamily: "Arial"
        });
        txt.data = { locked: false, label: "Texto" };
        paper.project.activeLayer.addChild(txt);
        if (window.currentMockup) {
            txt.insertBelow(window.currentMockup);
        }
        window.selectItem(txt);
        startTextEditing(txt);
    }

    // --- RENDERIZADO DE TABS DEL PANEL IZQUIERDO ---
    function renderCategories() {
        if (!ui.categoryTabs) return;
        ui.categoryTabs.innerHTML = "";
        if (!window.EKKO_STUDIO_PRODUCTS) return;
        
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
        if (!ui.productTabs || !ui.surfaceTabs) return;
        ui.productTabs.innerHTML = "";
        ui.surfaceTabs.innerHTML = "";
        
        const group = window.EKKO_STUDIO_PRODUCTS.slice(categoryIndex, categoryIndex + 1).shift();
        if (!group) return;
        
        const selectedProduct = activeProduct || toolState.currentProduct || group.productos.slice(0, 1).shift();
        
        group.productos.forEach((product) => {
            const btn = document.createElement("button");
            btn.className = "tab-btn" + (selectedProduct === product ? " active" : "");
            btn.textContent = product.nombre;
            btn.onclick = () => {
                saveCurrentScene();
                toolState.currentProduct = product;
                toolState.currentSurface = 0;
                renderProducts(categoryIndex, product);
            };
            ui.productTabs.appendChild(btn);
        });
        
        toolState.currentProduct = selectedProduct;
        renderSurfaces(selectedProduct);
    }

    function renderSurfacesOnly(product) {
        if (!ui.surfaceTabs) return;
        ui.surfaceTabs.innerHTML = "";
        if (!product || !product.superficies) return;
        
        product.superficies.forEach((surface, index) => {
            const btn = document.createElement("button");
            btn.className = "tab-btn" + (toolState.currentSurface === index ? " active" : "");
            btn.textContent = surface.nombre;
            btn.onclick = () => {
                saveCurrentScene();
                toolState.currentSurface = index;
                renderSurfacesOnly(product);
                loadSurfaceScene(product, surface);
                ui.selectionInfo.textContent = "Seleccionado: " + product.nombre + " / " + surface.nombre;
            };
            ui.surfaceTabs.appendChild(btn);
        });
    }

    // --- MANEJO DEL MOUSE Y EVENTOS DE SELECCIÓN/ARRUSTRE ---
    function renderSurfaces(product) {
        renderSurfacesOnly(product);
        if (!product || !product.superficies) return;
        
        const idx = toolState.currentSurface || 0;
        const firstSurface = product.superficies.slice(idx, idx + 1).shift() || product.superficies.slice(0, 1).shift();
        if (firstSurface) {
            loadSurfaceScene(product, firstSurface);
            ui.selectionInfo.textContent = "Seleccionado: " + product.nombre + " / " + firstSurface.nombre;
        }
    }

    let insertTextMode = false;
    const tool = new paper.Tool();

    tool.onMouseDown = function(event) {
        if (insertTextMode) {
            createEditableText(event.point);
            insertTextMode = false;
            canvasEl.style.cursor = "default";
            return;
        }

        // 1. Verificar si hizo clic en un nodo de redimensionamiento
        const handleHit = paper.project.hitTest(event.point, {
            fill: true,
            stroke: true,
            tolerance: 8,
            match: function(hitResult) {
                return hitResult.item.data && hitResult.item.data.isHandle;
            }
        });

        if (handleHit && window.selectedItem) {
            window.resizeActive = true;
            window.resizeHandleType = handleHit.item.data.handleType;
            window.resizeTarget = window.selectedItem;
            
            const bounds = window.selectedItem.bounds;
            window.resizeInitialBounds = bounds.clone();
            window.resizeInitialPoint = event.point.clone();
            window.resizeLastScaleX = 1.0;
            window.resizeLastScaleY = 1.0;
            
            let anchor;
            switch (window.resizeHandleType) {
                case 'tl': anchor = bounds.bottomRight; break;
                case 't':  anchor = bounds.bottomCenter; break;
                case 'tr': anchor = bounds.bottomLeft; break;
                case 'r':  anchor = bounds.leftCenter; break;
                case 'br': anchor = bounds.topLeft; break;
                case 'b':  anchor = bounds.topCenter; break;
                case 'bl': anchor = bounds.topRight; break;
                case 'l':  anchor = bounds.rightCenter; break;
            }
            window.resizeAnchor = anchor.clone();
            return; 
        }

        // 2. Si no es un nodo, procedemos con hitTest para mover o seleccionar
        const hit = paper.project.hitTest(event.point, {
            fill: true,
            stroke: true,
            segments: true,
            tolerance: 8,
            match: function(hitResult) {
                let current = hitResult.item;
                while (current) {
                    if (current.data && current.data.mockup) {
                        return false; 
                    }
                    current = current.parent;
                }
                return true; 
            }
        });

        if (!hit) {
            window.deselectItem();
            return;
        }

        const item = window.getSelectableItem(hit.item || hit);
        if (!item || (item.data && item.data.mockup)) return;

        window.selectItem(item);

        if (item.data && item.data.clipGroup) {
            const contentItem = item.children.find(c => !c.clipMask);
            if (contentItem) {
                window.dragOffset = event.point.subtract(contentItem.position);
            } else {
                window.dragOffset = event.point.subtract(item.position);
            }
        } else {
            window.dragOffset = event.point.subtract(item.position);
        }
        window.dragging = true;
    };

    tool.onMouseDrag = function(event) {
        // A. Operación de Redimensionamiento (Resize)
        if (window.resizeActive && window.resizeTarget) {
            const currentPoint = event.point;
            const initialBounds = window.resizeInitialBounds;
            const anchor = window.resizeAnchor;
            const handleType = window.resizeHandleType;

            let scaleX = 1.0;
            let scaleY = 1.0;

            const initialWidth = initialBounds.width;
            if (initialWidth > 0) {
                const initDistX = Math.abs(window.resizeInitialPoint.x - anchor.x);
                const currDistX = Math.abs(currentPoint.x - anchor.x);
                scaleX = initDistX > 0 ? currDistX / initDistX : 1.0;
            }

            const initialHeight = initialBounds.height;
            if (initialHeight > 0) {
                const initDistY = Math.abs(window.resizeInitialPoint.y - anchor.y);
                const currDistY = Math.abs(currentPoint.y - anchor.y);
                scaleY = initDistY > 0 ? currDistY / initDistY : 1.0;
            }

            // Aplicar restricciones según el nodo arrastrado
            if (handleType === 'tl' || handleType === 'tr' || handleType === 'bl' || handleType === 'br') {
                // Symmetrical corner resizing (keeps aspect ratio)
                scaleY = scaleX;
            } else if (handleType === 'l' || handleType === 'r') {
                // Horizontal only
                scaleY = 1.0;
            } else if (handleType === 't' || handleType === 'b') {
                // Vertical only
                scaleX = 1.0;
            }

            if (scaleX < 0.05) scaleX = 0.05;
            if (scaleY < 0.05) scaleY = 0.05;

            const relScaleX = scaleX / window.resizeLastScaleX;
            const relScaleY = scaleY / window.resizeLastScaleY;

            window.resizeTarget.scale(relScaleX, relScaleY, anchor);

            window.resizeLastScaleX = scaleX;
            window.resizeLastScaleY = scaleY;

            window.updateSelectionBox(window.resizeTarget);
            updateContextualMenu(window.resizeTarget);
            paper.view.update();
            return;
        }

        // B. Operación de Movimiento (Arrastrar)
        if (!window.dragging || !window.selectedItem || (window.selectedItem.data && window.selectedItem.data.mockup)) return;

        if (window.selectedItem.data && window.selectedItem.data.clipGroup) {
            const contentItem = window.selectedItem.children.find(c => !c.clipMask);
            if (contentItem) {
                contentItem.position = event.point.subtract(window.dragOffset);
            }
        } else {
            window.selectedItem.position = event.point.subtract(window.dragOffset);
        }
        
        window.updateSelectionBox(window.selectedItem);
        updateContextualMenu(window.selectedItem);
        paper.view.update();
    };

    tool.onMouseUp = function() {
        if (window.resizeActive) {
            saveHistory();
            window.resizeActive = false;
            window.resizeTarget = null;
        }
        if (window.dragging) {
            saveHistory();
        }
        window.dragging = false;
    };

    document.getElementById("btnAddText").onclick = () => {
        insertTextMode = true;
        canvasEl.style.cursor = "text";
    };

    document.getElementById("btnAddImage").onclick = () => {
        const imagePicker = document.getElementById("imagePicker");
        imagePicker.value = "";
        imagePicker.click();
    };

    document.getElementById("btnAddSVG").onclick = () => {
        const svgPicker = document.getElementById("svgPicker");
        svgPicker.value = "";
        svgPicker.click();
    };

    document.getElementById("imagePicker").onchange = (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const [firstFile] = files;
            addImageFromFile(firstFile);
        }
    };

    document.getElementById("svgPicker").onchange = (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const [firstFile] = files;
            addSVGFromFile(firstFile);
        }
    };

    // --- PROCESADO EXPORTAR PARA LÁSER (LightBurn Style - VALIDADO) ---
    const exportBtn = document.getElementById("btnExportLaser");
    if (exportBtn) {
        exportBtn.onclick = () => {
            window.deselectItem();
            
            let mockupHidden = false;
            if (window.currentMockup) {
                window.currentMockup.visible = false;
                mockupHidden = true;
            }

            const activeItems = paper.project.activeLayer.children.filter(item => {
                return item.visible && (!item.data || !item.data.mockup);
            });

            for (let i = 0; i < activeItems.length; i++) {
                const itemAbove = activeItems[i];
                if (!(itemAbove instanceof paper.Path) && !(itemAbove instanceof paper.CompoundPath)) continue;

                for (let j = i + 1; j < activeItems.length; j++) {
                    const itemBelow = activeItems[j];
                    if (!(itemBelow instanceof paper.Path) && !(itemBelow instanceof paper.CompoundPath)) continue;

                    if (itemAbove.bounds.intersects(itemBelow.bounds)) {
                        const cutResult = itemBelow.subtract(itemAbove);
                        if (cutResult) {
                            itemBelow.replaceWith(cutResult);
                        }
                    }
                }
            }

            paper.view.update();

            const svgString = paper.project.exportSVG({ asString: true, bounds: 'content' });

            if (mockupHidden && window.currentMockup) {
                window.currentMockup.visible = true;
                paper.view.update();
            }

            const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const downloadLink = document.createElement("a");
            downloadLink.href = url;
            downloadLink.download = "ekko-laser-ready.svg";
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            URL.revokeObjectURL(url);
        };
    }

    document.getElementById("btnZoomIn").onclick = () => zoomBy(1.15);
    document.getElementById("btnZoomOut").onclick = () => zoomBy(1 / 1.15);
    document.getElementById("btnFit").onclick = fitView;

    window.addEventListener("resize", () => {
        paper.view.viewSize = new paper.Size(canvasEl.clientWidth, canvasEl.clientHeight);
    });

    renderCategories();
});

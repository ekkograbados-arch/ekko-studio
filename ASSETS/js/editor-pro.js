
import "./modules/selection.js";
import { startTextEditing } from "./modules/textEditor.js";
import { loadMockup, restoreMockupReferences } from "./modules/mockupLoader.js";
import { initContextualMenu, updateContextualMenu, hideContextualMenu } from "./modules/canvas-pro/contextualMenu.js";

window.addEventListener("DOMContentLoaded", () => {
    // Inicializar Paper.js en el Canvas
    paper.setup("editorCanvas");
    const canvasEl = document.getElementById("editorCanvas");
    if (canvasEl) { paper.view.viewSize = new paper.Size(canvasEl.clientWidth, canvasEl.clientHeight); }

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

    // Inicializar UI flotante del menú contextual (Canva style)
    initContextualMenu();

    // Carga de tipografías dinámica desde la API de Vercel (100% automático al soltar en ASSETS/fonts/)
    async function loadDynamicFonts() {
        try {
            const response = await fetch('/api/fonts');
            if (!response.ok) throw new Error("No se pudo obtener el listado de fuentes");
            const fonts = await response.json();
            
            if (fonts && fonts.length > 0) {
                // Inyectar reglas @font-face dinámicas en el CSS de la página
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

                // Llenar el select selector del menú flotante
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
                
                // Guardar las fuentes dinámicas globalmente para otros usos de renderizado
                window.DYNAMIC_FONTS = fonts;
            }
        } catch (err) {
            console.warn("La API /api/fonts no está disponible o falló. Usando fuentes locales por defecto.", err);
            // Cargar fuentes por defecto si falla el backend o estamos localmente
            const defaultFonts = [
                { name: "Billie James", family: "ekko_billie" },
                { name: "Romantic Sunrise", family: "ekko_romantic" },
                { name: "Farmhouse", family: "ekko_farmhouse" }
            ];
            const selectEl = document.getElementById('ctxFontSelector');
            if (selectEl) {
                selectEl.innerHTML = '';
                defaultFonts.forEach(font => {
                    const opt = document.createElement('option');
                    opt.value = font.family;
                    opt.textContent = font.name;
                    selectEl.appendChild(opt);
                });
            }
        }
    }

    // Ejecutar la carga automática de fuentes
    loadDynamicFonts();

    // Sobrescribir deselección y selección para coordinar con el menú flotante de Canva
    const originalDeselect = window.deselectItem;
    window.deselectItem = function() {
        if (typeof originalDeselect === "function") originalDeselect();
        hideContextualMenu();
    };

    const originalSelect = window.selectItem;
    window.selectItem = function(item) {
        if (typeof originalSelect === "function") originalSelect(item);
        updateContextualMenu(item);
    };

    function clearCanvas() {
        paper.project.activeLayer.removeChildren();
        paper.view.update();
        hideContextualMenu();
    }

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
        updateContextualMenu(window.selectedItem);
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
        updateContextualMenu(window.selectedItem);
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
        updateContextualMenu(window.selectedItem);
        paper.view.update();
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
            updateContextualMenu(window.selectedItem);
        }
        paper.view.update();
    }

    function fitView() {
        paper.view.zoom = 1;
        paper.view.center = paper.view.bounds.center;
        if (window.selectedItem) {
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

    // Implementación de agregar texto en el Canva style
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

    // --- MANEJO DEL MOUSE Y EVENTOS DE SELECCIÓN/ARRUSTRE ---
    let insertTextMode = false;
    const tool = new paper.Tool();

    tool.onMouseDown = function(event) {
        if (insertTextMode) {
            createEditableText(event.point);
            insertTextMode = false;
            canvasEl.style.cursor = "default";
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

        if (!hit) {
            window.deselectItem();
            return;
        }

        const item = window.getSelectableItem(hit.item || hit);
        if (!item) return;

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
        if (!window.dragging || !window.selectedItem) return;

        if (window.selectedItem.data && window.selectedItem.data.clipGroup) {
            const contentItem = window.selectedItem.children.find(c => !c.clipMask);
            if (contentItem) {
                contentItem.position = event.point.subtract(window.dragOffset);
            }
        } else {
            window.selectedItem.position = event.point.subtract(window.dragOffset);
        }
        
        // Mantener posicionado el menú contextual flotante en tiempo real mientras arrastramos
        updateContextualMenu(window.selectedItem);
        paper.view.update();
    };

    tool.onMouseUp = function() {
        if (window.dragging) {
            saveHistory();
        }
        window.dragging = false;
    };

    // --- EVENT HELPER FUNCTIONS FOR ROBUST ASSIGNMENTS (Canva/LightBurn Style) ---
    const setClick = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onclick = fn;
    };
    const setChange = (id, fn) => {
        const el = document.getElementById(id);
        if (el) el.onchange = fn;
    };

    // --- ACCIONES DE CARGA ASOCIADAS AL TOP BAR DE CANVA ---
    setClick("btnAddText", () => {
        insertTextMode = true;
        if (canvasEl) canvasEl.style.cursor = "text";
    });

    setClick("btnAddImage", () => {
        const imagePicker = document.getElementById("imagePicker");
        if (imagePicker) {
            imagePicker.value = "";
            imagePicker.click();
        }
    });

    setClick("btnAddSVG", () => {
        const svgPicker = document.getElementById("svgPicker");
        if (svgPicker) {
            svgPicker.value = "";
            svgPicker.click();
        }
    });

    setChange("imagePicker", (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const [firstFile] = files;
            addImageFromFile(firstFile);
        }
    });

    setChange("svgPicker", (e) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const [firstFile] = files;
            addSVGFromFile(firstFile);
        }
    });

    // Controles de zoom generales
    setClick("btnZoomIn", () => zoomBy(1.15));
    setClick("btnZoomOut", () => zoomBy(1 / 1.15));
    setClick("btnFit", fitView);

    // Adaptar tamaño de canvas al redimensionar ventana
    window.addEventListener("resize", () => {
        if (canvasEl) {
            paper.view.viewSize = new paper.Size(canvasEl.clientWidth, canvasEl.clientHeight);
        }
    });
});

});

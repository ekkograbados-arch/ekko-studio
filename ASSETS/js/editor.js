/* =========================================================================
   Módulo: ASSETS/js/editor.js
   Ruta de reemplazo: ASSETS/js/editor.js
   Descripción: Núcleo de la aplicación EKKO Studio basado en Paper.js.
   Controla la inicialización de la escena, carga de mockups, alineaciones,
   transformaciones, operaciones de zoom y sincronización asíncrona de
   tipografías globales del backend.
   ========================================================================= */

import "./modules/selection.js"; // REQUERIDO: Cargar manipuladores de selección globales
import { loadDynamicFonts } from "./modules/canvas-pro/textToolbar.js";
import { loadDynamicProducts } from "./modules/productsLoader.js";
import { restoreMockupReferences, loadMockup } from "./modules/mockupLoader.js";
import { updateContextualMenu, hideContextualMenu, initContextualMenu } from "./modules/canvas-pro/contextualMenu.js";
import { startTextEditing } from "./modules/textEditor.js";

window.addEventListener("DOMContentLoaded", () => {
  // 1. Inicializar Paper.js de forma segura en el lienzo
  const canvasEl = document.getElementById("editorCanvas");
  if (canvasEl) {
    paper.setup("editorCanvas");
    paper.view.viewSize = new paper.Size(canvasEl.clientWidth, canvasEl.clientHeight);
  }

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
    const displayItem = (window.selectedItem.data && window.selectedItem.data.clipGroup) ?
      window.selectedItem.children.find(c => !c.clipMask) : window.selectedItem;
    if (displayItem && ui.selectionInfo) {
      ui.selectionInfo.textContent = displayItem.data?.label || "Objeto";
      if (ui.objWidth) ui.objWidth.value = Math.round(displayItem.bounds.width);
      if (ui.objHeight) ui.objHeight.value = Math.round(displayItem.bounds.height);
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

  // --- REGISTRO DE EVENTOS SEGUROS ---
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

  // Botón Agregar Texto
  safeAddListener("btnAddText", "click", activateTextMode);

  // Ocultar galería obsoleta si el elemento existe en el HTML
  const obsoleteGallery = document.getElementById("fontGallery");
  if (obsoleteGallery) {
    obsoleteGallery.classList.add("hidden");
    obsoleteGallery.style.display = "none";
  }

  // --- REGISTRO DE EVENTO DE CLIC EN EL LIENZO PARA INSERTAR TEXTO ---
  // Se usa paper.view.on("mousedown") para no crear un nuevo paper.Tool y conservar el de selection.js
  if (paper.view) {
    paper.view.on("mousedown", (event) => {
      if (window.insertTextMode) {
        createEditableText(event.point);
        window.insertTextMode = false;
        paper.view.element.style.cursor = "default";
      }
    });
  }

  // Inicializar Menú Contextual Arrastrable y Custom Dropdowns
  initContextualMenu();

  // --- CORRECCIÓN APLICADA: Carga de tipografías dinámicas globales para sincronización de head ---
  loadDynamicFonts().then(loadedFonts => {
    console.log("🔄 Tipografías del backend sincronizadas en el editor.");
  }).catch(err => {
    console.warn("Fallo no crítico al sincronizar fuentes en editor.js:", err);
  });

  // --- CARGA DINÁMICA ASÍNCRONA DE PRODUCTOS ---
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
   // =========================================================================
// INTEGRACIÓN DE DISPARADORES DE LA BARRA SUPERIOR (Cargar Imagen, SVG y QR)
// =========================================================================

// 1. Enlace para Cargar Imagen
safeAddListener("btnAddImage", "click", () => {
    if (ui.imagePicker) ui.imagePicker.click();
});

safeAddListener("imagePicker", "change", (e) => {
    const file = e.target.files;
    if (file) {
        addImageFromFile(file);
        e.target.value = ""; // Resetear para permitir recargar el mismo archivo
    }
});

// 2. Enlace para Cargar SVG
safeAddListener("btnAddSVG", "click", () => {
    if (ui.svgPicker) ui.svgPicker.click();
});

safeAddListener("svgPicker", "change", (e) => {
    const file = e.target.files;
    if (file) {
        addSVGFromFile(file);
        e.target.value = ""; // Resetear para permitir recargar el mismo archivo
    }
});

// 3. Generación Dinámica de Código QR (Offline y Vectorizable en Paper.js)
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

    // Esperar un breve instante para que la librería dibuje el QR
    setTimeout(() => {
        const qrCanvas = tempDiv.querySelector("canvas") || tempDiv.querySelector("img");
        if (qrCanvas) {
            const src = qrCanvas.toDataURL ? qrCanvas.toDataURL() : qrCanvas.src;
            const raster = new paper.Raster({ source: src });
            raster.onLoad = () => {
                raster.data = { locked: false, label: "Código QR" };
                const area = paper.view.bounds;
                const size = Math.min(area.width, area.height) * 0.3; // Escalar al 30% del lienzo
                raster.scale(size / raster.width);
                raster.position = area.center;
                
                // Enmascarar bajo el área segura del producto
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

// 4. Enlace para Generar QR
safeAddListener("btnAddQR", "click", () => {
    const text = prompt("Ingrese el texto o enlace (Instagram, WhatsApp, WiFi) para el código QR:", "https://www.instagram.com/grabados_ekko/");
    if (text && text.trim() !== "") {
        addQRToCanvas(text.trim());
    }
});
});


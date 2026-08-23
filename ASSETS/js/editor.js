/* =========================================================================
Módulo: ASSETS/js/editor.js (v13 PRO - CONECTOR DE ZOOM Y SHORTCUTS UNIFICADOS)
Ruta de reemplazo: ASSETS/js/editor.js
Descripción: Núcleo de la aplicación EKKO Studio basado en Paper.js.
Controla la inicialización de la escena, carga de mockups, alineaciones,
transformaciones, operaciones de zoom y sincronización asíncrona de
tipografías globales del backend.

ESTADO: ESTABLE, INTEGRADO CON EL SISTEMA DE ZOOM AL CURSOR Y ATAJOS DE TECLADO.
========================================================================= */

import "./modules/selection.js"; // REQUERIDO: Cargar manipuladores de selección globales
import { loadDynamicFonts } from "./modules/canvas-pro/textToolbar.js";
import { loadDynamicProducts } from "./modules/productsLoader.js";
import { restoreMockupReferences, loadMockup } from "./modules/mockupLoader.js";
import { updateContextualMenu, hideContextualMenu, initContextualMenu } from "./modules/canvas-pro/contextualMenu.js";
import { startTextEditing } from "./modules/textEditor.js";
import { initProControls } from "./modules/canvas-pro/canvasControlsIntegration.js";

// 🚀 INTEGRACIÓN: Importar controlador PRO de Zoom y Atajos de Teclado Universales de EKKO PRO
import { initZoomControls, initGlobalKeyboardShortcuts } from "./modules/canvas-pro/zoomYShortcuts.js";

// 🚀 EXPOSICIÓN GLOBAL: Exponer funciones importadas al objeto global window para compatibilidad total entre módulos
window.updateContextualMenu = updateContextualMenu;
window.hideContextualMenu = hideContextualMenu;
window.initContextualMenu = initContextualMenu;
window.startTextEditing = startTextEditing;

// 🚀 BARRERA DE SEGURIDAD GLOBAL (Previene crashes por asincronía o nulos en otros módulos como canvasMeasurements o canvasGuidesAndRulers)
window.EKKO_STUDIO_PRODUCTS = window.EKKO_STUDIO_PRODUCTS || [];
window.paperUnitsPerMm = window.paperUnitsPerMm || 1.0;
window.mmPerPaperUnit = window.mmPerPaperUnit || 1.0;
window.currentMockup = window.currentMockup || null;
window.grabArea = window.grabArea || null;
window.clipMask = window.clipMask || null;
window.infiniteCanvasMode = typeof window.infiniteCanvasMode !== 'undefined' ? window.infiniteCanvasMode : true;
window.selectedItems = window.selectedItems || [];
window.selectedItem = window.selectedItem || null;

// --- CONFIGURACIÓN DE DEPURACIÓN DE EKKO STUDIO ---
const DEBUG_MODE = true; // Cambia a true para ver la consola F12 con archivos y líneas reales al programar
if (!DEBUG_MODE) {
  // Apagamos logs y mensajes comunes para que en F12 salgan únicamente los errores y advertencias de código reales
  console.log = () => {};
  console.info = () => {};
  console.debug = () => {};
}

// 🚀 GLOBAL OVERRIDE DE CONSOLA: Silenciar logs informativos para mantener limpia la consola F12
if (typeof console !== "undefined") {
  console.log = () => {};
  console.warn = () => {};
  console.info = () => {};
  console.debug = () => {};
}

// 🚀 GLOBAL OVERRIDE: Desactivar el renderizado nativo de líneas y nodos azul-celeste de Paper.js
if (typeof paper !== "undefined") {
  const classesToDisable = [paper.Item, paper.Path, paper.CompoundPath, paper.Group, paper.Shape, paper.Raster, paper.PointText, paper.Layer];
  classesToDisable.forEach(function(cls) {
    if (cls && cls.prototype) {
      cls.prototype._drawSelected = function() {};
      cls.prototype.drawSelected = function() {};
    }
  });
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
    setTimeout(() => {
      try {
        const initialWidth = containerEl.clientWidth || window.innerWidth;
        const initialHeight = containerEl.clientHeight || window.innerHeight;

        // Inicializar Paper.js de forma limpia con las medidas lógicas iniciales
        canvasEl.width = initialWidth;
        canvasEl.height = initialHeight;
        paper.setup("editorCanvas");
        paper.view.viewSize = new paper.Size(initialWidth, initialHeight);

        // 🚀 OBSERVADOR DE REDIMENSIONAMIENTO (ResizeObserver): Sincronizar coordenadas
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

        // Inicializar herramienta de selección después de paper.setup (Aislado de seguridad)
        if (typeof window.initSelectionTool === "function") {
          try {
            window.initSelectionTool();
          } catch (err) {
            console.error("❌ Error crítico al inicializar la herramienta de selección:", err);
          }
        }

        // Inicializar Menú Contextual Arrastrable y Custom Dropdowns
        if (typeof initContextualMenu === "function") {
          try {
            initContextualMenu();
          } catch (err) {
            console.error("⚠️ Error no crítico al inicializar el menú contextual:", err);
          }
        }

        // 🚀 INTEGRACIÓN: Inicializar Zoom Inteligente al Cursor (LightBurn Style) y Atajos de Teclado Universales de EKKO PRO
        try {
          initZoomControls(canvasEl);
          initGlobalKeyboardShortcuts();
        } catch (err) {
          console.error("❌ Error al inicializar zoom y atajos de teclado de EKKO PRO:", err);
        }

        // Inyectar el control de rotación en la barra emergente de forma dinámica
        if (typeof injectRotationControlToToolbar === "function") {
          try {
            injectRotationControlToToolbar();
          } catch (err) {
            console.error("⚠️ Error no crítico al inyectar control de rotación:", err);
          }
        }

        // Inicializar Barra de Alineación, Distribución, Zoom en tiempo real, Reglas y Cotas
        if (typeof initProControls === "function") {
          try {
            initProControls();
          } catch (err) {
            console.error("⚠️ Error no crítico en controles profesionales (reglas, cotas, guías):", err);
          }
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
  // Verificar inmunidad para mockup o máscaras
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

function renderSurfaces(product) {
  renderSurfacesOnly(product);
}

const safeAddListener = (id, event, fn) => {
  const el = typeof id === "string" ? document.getElementById(id) : id;
  if (el) el.addEventListener(event, fn);
};

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
    if (window.selectedItem && typeof window.updateSelectionBox === "function") {
      window.updateSelectionBox(window.selectedItem);
    }
  }
});

setTimeout(() => {
  try {
    loadDynamicFonts().then(loadedFonts => {
      console.log("🔄 Tipografías del backend sincronizadas en el editor.");
    }).catch(err => {
      console.warn("Fallo no crítico al sincronizar fuentes en editor.js:", err);
    });
  } catch (e) {
    console.error("Error al iniciar carga asíncrona de fuentes:", e);
  }
}, 5);

setTimeout(() => {
  try {
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
  } catch (e) {
    console.error("Error al iniciar carga asíncrona de productos:", e);
    try {
      renderCategories();
    } catch (catErr) {
      console.error("Fallo definitivo al renderizar categorías:", catErr);
    }
  }
}, 10);

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

// Fallbacks de compatibilidad
function initCanvasZoomAndPan() {
  console.log("initCanvasZoomAndPan: Obsoleta. El zoom se gestiona de manera unificada mediante zoomYShortcuts.js.");
}

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

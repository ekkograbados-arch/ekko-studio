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

// 🚀 INTEGRACIÓN: Importar controlador PRO para reglas, guías inteligentes, acotaciones y alineaciones
import { initProControls } from "./modules/canvas-pro/canvasControlsIntegration.js";

// --- CONFIGURACIÓN DE DEPURACIÓN DE EKKO STUDIO ---
const DEBUG_MODE = false; // Cambia a true para ver la consola F12 con archivos y líneas reales al programar

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

    // Asignar tamaño físico real del contenedor para evitar límites de 800x600 o recortes
    const initialWidth = containerEl.clientWidth || 800;
    const initialHeight = containerEl.clientHeight || 600;
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

    // 🚀 NUEVO: Inicializar herramienta de selección después de paper.setup
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

    // 🚀 NUEVO: Inicializar Barra de Alineación, Distribución, Zoom en tiempo real, Reglas y Cotas
    if (typeof initProControls === "function") {
      initProControls();
    }
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
  // Limpieza de doble barrera en undo
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
  // Limpieza de doble barrera en redo
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

window.selectItem = function(item, isMulti = false) {
  if (window.nodeEditMode) {
    window.exitNodeEditMode();
  }

  if (!item || (item.data && item.data.mockup)) {
    window.deselectItem();
    return;
  }

  // Inicializar si no está definido
  if (!window.selectedItems) window.selectedItems = [];

  if (isMulti) {
    // Si ya está seleccionado, lo deseleccionamos (toggle)
    const idx = window.selectedItems.indexOf(item);
    if (idx > -1) {
      item.selected = false;
      window.selectedItems.splice(idx, 1);
    } else {
      item.selected = true;
      window.selectedItems.push(item);
    }
    // El "selectedItem" primario será el último añadido
    window.selectedItem = window.selectedItems[window.selectedItems.length - 1] || null;
  } else {
    // Selección simple: limpiar previas
    if (window.selectedItems && window.selectedItems.length > 0) {
      window.selectedItems.forEach(it => { if (it) it.selected = false; });
    }
    window.selectedItems = [item];
    window.selectedItem = item;
    item.selected = true;
  }

  // Si no queda nada seleccionado
  if (window.selectedItems.length === 0) {
    window.deselectItem();
    return;
  }

  window.updateSelectionBox(window.selectedItem);
  updateSelectionInfo();
  updateLockButton();

  // Sincronizar valor de rotación en el input de la barra flotante
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
  if (window.selectedItem) {
    window.selectedItem.selected = false;
  }
  window.selectedItem = null;
window.selectedItems = []; // NUEVO: Soporte para selección múltiple
  window.updateSelectionBox(null);
  if (ui.selectionInfo) ui.selectionInfo.textContent = "Nada seleccionado";
  if (ui.objWidth) ui.objWidth.value = "";
  if (ui.objHeight) ui.objHeight.value = "";
  updateLockButton();
  // Limpiar valor de rotación en el input de la barra flotante
  const rotationNum = document.getElementById('ctxRotationNum');
  if (rotationNum) {
    rotationNum.value = "0°";
  }
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
  // Forzar deselección limpia para que NO se guarden cajas de selección ni nodos en el JSON
  const prevSelected = window.selectedItem;
  window.deselectItem();
  sceneStates[key] = paper.project.exportJSON({ asString: true });
  // Si había un elemento seleccionado, lo restauramos para no romper el flujo visual
  if (prevSelected) {
    window.selectItem(prevSelected);
  }
}

function loadSurfaceScene(product, surface) {
  if (!product || !surface) return;
  const key = getSceneKey(product, surface);
  window.deselectItem();
  // Resetear zoom y centrar cámara en el origen antes de cargar para alineación exacta
  paper.view.zoom = 1.0;
  paper.view.center = new paper.Point(0, 0);
  if (sceneStates[key]) {
    paper.project.clear();
    paper.project.importJSON(sceneStates[key]);
    // Doble barrera de seguridad: eliminar físicamente cualquier elemento fantasma de interfaz
    cleanGhostInterfaceItems();
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
if (paper.view) {
  paper.view.on("mousedown", (event) => {
    if (window.insertTextMode) {
      createEditableText(event.point);
      window.insertTextMode = false;
      paper.view.element.style.cursor = "default";
    }
  });
}

// Escuchar evento de cambio de tamaño de pantalla para actualizar las dimensiones lógicas de Paper.js
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

// --- NOTA: Inicializaciones movidas dentro del evento DOMContentLoaded para sincronización correcta de paper.view ---

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

// 2. Enlace para Cargar SVG
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

/**
* Inicializa el sistema de Zoom, Panorámica y Atajos de Teclado del Lienzo de Paper.js
*/
function initCanvasZoomAndPan() {
  const canvasEl = document.getElementById("editorCanvas");
  if (!canvasEl || !paper.view) {
    console.warn("initCanvasZoomAndPan: Elemento del lienzo o paper.view no disponibles.");
    return;
  }

  // --- VARIABLES DE ESTADO ---
  let isPanning = false;
  let panStartPoint = null;
  let spacePressed = false;

  // --- 1. ZOOM INTERACTIVO POR RUEDA DE MOUSE (Centrado en el cursor, estilo LightBurn) ---
  canvasEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const oldZoom = paper.view.zoom;
    const factor = 1.12; // Transición fluida
    let newZoom = oldZoom;
    if (e.deltaY < 0) {
      newZoom = oldZoom * factor;
    } else {
      newZoom = oldZoom / factor;
    }
    // Límites profesionales de zoom (0.15x para visión de conjunto a 20x para detalles microscópicos)
    newZoom = Math.max(0.15, Math.min(20.0, newZoom));

    // Obtener la posición del mouse física respecto al canvas
    const rect = canvasEl.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Obtener la coordenada proyectada del Paper antes de aplicar el nuevo zoom
    const mouseProjBefore = paper.view.viewToProject(new paper.Point(x, y));

    // Aplicar el nuevo zoom de Paper.js
    paper.view.zoom = newZoom;

    // Obtener la coordenada proyectada del Paper con el nuevo zoom
    const mouseProjAfter = paper.view.viewToProject(new paper.Point(x, y));

    // Desplazar la cámara para que el punto que estaba bajo el cursor permanezca en su sitio físico
    const diff = mouseProjBefore.subtract(mouseProjAfter);
    paper.view.center = paper.view.center.add(diff);
    paper.view.update();

    // Actualizar caja de selección del objeto activo
    if (window.selectedItem && typeof window.updateSelectionBox === "function") {
      window.updateSelectionBox(window.selectedItem);
    }
  }, { passive: false });

  // --- 2. CONTROL DE PANORÁMICA (Ver arrastre del lienzo) ---
  window.addEventListener("keydown", (e) => {
    if (e.code === "Space") {
      const activeEl = document.activeElement;
      // Evitar arrastre si el usuario está escribiendo o editando textos
      if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.id === "ekko-text-editor")) {
        return;
      }
      e.preventDefault();
      if (!spacePressed) {
        spacePressed = true;
        canvasEl.style.cursor = "grab";
      }
    }
  });

  window.addEventListener("keyup", (e) => {
    if (e.code === "Space") {
      spacePressed = false;
      canvasEl.style.cursor = "default";
      if (isPanning) {
        isPanning = false;
      }
    }
  });

  // Eventos de ratón sobre el lienzo para paneo
  canvasEl.addEventListener("mousedown", (e) => {
    const isLeftButton = e.button === 0;
    const isMiddleButton = e.button === 1; // Rueda de mouse presionada
    if (isMiddleButton || (isLeftButton && spacePressed)) {
      isPanning = true;
      panStartPoint = new paper.Point(e.clientX, e.clientY);
      canvasEl.style.cursor = "grabbing";
      e.preventDefault();
      e.stopPropagation();
    }
  });

  window.addEventListener("mousemove", (e) => {
    if (!isPanning || !panStartPoint) return;
    const currentPoint = new paper.Point(e.clientX, e.clientY);
    const delta = currentPoint.subtract(panStartPoint);
    // Escalar el desplazamiento lógicamente en base al zoom actual
    const paperDelta = delta.divide(paper.view.zoom);
    // Desplazar el centro de la escena
    paper.view.center = paper.view.center.subtract(paperDelta);
    panStartPoint = currentPoint;
    paper.view.update();

    // Mantener la caja de selección del objeto activo perfectamente alineada
    if (window.selectedItem && typeof window.updateSelectionBox === "function") {
      window.updateSelectionBox(window.selectedItem);
    }
  });

  window.addEventListener("mouseup", () => {
    if (isPanning) {
      isPanning = false;
      canvasEl.style.cursor = spacePressed ? "grab" : "default";
    }
  });

  // --- 3. ATAJOS DE TECLADO CLÁSICOS DE DISEÑO (Ctrl +, Ctrl -, Ctrl 0) ---
  window.addEventListener("keydown", (e) => {
    const activeEl = document.activeElement;
    if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.id === "ekko-text-editor")) {
      return;
    }
    // Ctrl/Cmd + "+" o "="
    if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) {
      e.preventDefault();
      zoomCanvas(1.15);
    }
    // Ctrl/Cmd + "-"
    if ((e.ctrlKey || e.metaKey) && e.key === "-") {
      e.preventDefault();
      zoomCanvas(1 / 1.15);
    }
    // Ctrl/Cmd + "0" (Ajustar vista y centrar mockup)
    if ((e.ctrlKey || e.metaKey) && e.key === "0") {
      e.preventDefault();
      resetCanvasView();
    }
  });

  // --- 4. INTEGRACIÓN DE LOS BOTONES DE LA BARRA SUPERIOR ---
  const btnZoomIn = document.getElementById("btnZoomIn");
  const btnZoomOut = document.getElementById("btnZoomOut");
  const btnFit = document.getElementById("btnFit");

  if (btnZoomIn) {
    btnZoomIn.onclick = (e) => {
      e.preventDefault();
      zoomCanvas(1.20);
    };
  }
  if (btnZoomOut) {
    btnZoomOut.onclick = (e) => {
      e.preventDefault();
      zoomCanvas(1 / 1.20);
    };
  }
  if (btnFit) {
    btnFit.onclick = (e) => {
      e.preventDefault();
      resetCanvasView();
    };
  }

  // --- FUNCIONES AUXILIARES DE CAMBIO DE ESCALA ---
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
    // Centrar sobre el mockup del producto si existe, de lo contrario en el origen del lienzo infinito
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

// =========================================================================
// SISTEMA PROFESIONAL DE ROTACIÓN EN EL CENTRO CON SNAPPING Y ENLACE BARRA
// =========================================================================

/**
* Inyecta dinámicamente el control numérico de rotación dentro de la barra contextual flotante
*/
function injectRotationControlToToolbar() {
  const toolbar = document.getElementById('contextual-toolbar');
  if (!toolbar) return;

  // Evitar duplicados
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

  // Insertarlo antes de los controles de texto específicos si existen, de lo contrario al final
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

    // Sincronizar desde input directo al cambiar valor
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

    // Soporte para rueda de mouse (Scroll wheel) sobre el input de rotación
    rotationNum.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!window.selectedItem || window.selectedItem.data?.locked) return;
      const currentVal = parseInt(rotationNum.value) || 0;
      const direction = e.deltaY < 0 ? 1 : -1;
      const step = e.shiftKey ? 5 : 1; // De a 5 grados con Shift presionado, de a 1 sin Shift
      let newVal = currentVal + direction * step;
      newVal = (newVal % 360 + 360) % 360;
      rotationNum.value = newVal + '°';
      applyRotation(newVal);
      if (typeof window.saveHistory === 'function') window.saveHistory();
    }, { passive: false });
  }
}

/**
* SOBREESCRITURA DE LA CAJA DE SELECCIÓN (updateSelectionBox)
* Añade el tirador con ícono de rotación encima del nodo superior medio (Estilo Figma/Canva)
*/
window.updateSelectionBox = function(item) {
  if (window.selectionBoxGroup) {
    window.selectionBoxGroup.remove();
    window.selectionBoxGroup = null;
  }
  if (window.nodeEditMode) return;

  // Si no se pasa un item, usar el seleccionado primario
  const primaryItem = item || window.selectedItem;
  if (!primaryItem || (primaryItem.data && primaryItem.data.mockup)) return;

  window.selectionBoxGroup = new paper.Group();
  window.selectionBoxGroup.data = { isSelectionBox: true };

  // Obtener todos los elementos seleccionados para dibujar sus contornos
  const itemsToDraw = (window.selectedItems && window.selectedItems.length > 0)
    ? window.selectedItems
    : [primaryItem];

  itemsToDraw.forEach(it => {
    const displayItem = (it.data && it.data.clipGroup)
      ? it.children.find(function(c) { return !c.clipMask; })
      : it;

    if (!displayItem) return;
    const bounds = displayItem.bounds;
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;

    // 1. Dibujar el rectángulo azul de contorno dashed
    const border = new paper.Path.Rectangle(bounds);
    border.strokeColor = '#007bff';
    border.strokeWidth = 1.5 / paper.view.zoom;
    border.dashArray = [4 / paper.view.zoom, 4 / paper.view.zoom];
    window.selectionBoxGroup.addChild(border);

    // Solo dibujar los tiradores (handles) de redimensionamiento y rotación para el elemento activo principal
    if (it === primaryItem) {
      // 2. Dibujar los 8 Nodos tradicionales
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

      // 3. TIRADOR DE ROTACIÓN EXCLUSIVO
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
    }
  });

  window.selectionBoxGroup.bringToFront();
};

/**
* SOBREESCRITURA DE LA HERRAMIENTA DE SELECCIÓN (initSelectionTool)
* Implementa el arrastre de rotación, cálculo de ángulos relativos y sensibilidad (snap) a 45°/90°
*/

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
    // --- NUEVO: INTERCEPTAR MODO DE INSERCIÓN DE TEXTO ---
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
      lastClickTime = 0; // Evitar disparar múltiples doble clics
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

    // 1. Hit test para verificar si se presionó un handle de redimensionamiento o de rotación
    const hitResult = paper.project.hitTest(event.point, {
      fill: true,
      stroke: true,
      segments: true,
      tolerance: 8 / paper.view.zoom,
      match: function(hit) {
        return hit.item.data && hit.item.data.isHandle;
      }
    });

    if (hitResult) {
      const hType = hitResult.item.data.handleType;
      // CASO ESPECIAL: Tirador de Rotación ('rot')
      if (hType === 'rot') {
        if (!window.selectedItem) return; // Guard de seguridad contra selección nula
        window.rotationActive = true;
        window.rotationTarget = window.selectedItem;
        const displayItem = (window.rotationTarget.data && window.rotationTarget.data.clipGroup)
          ? window.rotationTarget.children.find(function(c) { return !c.clipMask; })
          : window.rotationTarget;

        window.rotationCenter = displayItem.bounds.center.clone();

        // Obtener el ángulo inicial basado en la posición actual del cursor
        const vector = event.point.subtract(window.rotationCenter);
        window.rotationStartAngle = vector.angle;
        window.rotationInitialAngle = displayItem.data?.rotation || 0;
        return;
      }

      // Redimensionamiento normal (tl, t, tr, r, br, b, bl, l)
      if (!window.selectedItem) return; // Guard de seguridad contra selección nula
      window.resizeActive = true;
      window.resizeHandleType = hType;
      window.resizeTarget = window.selectedItem;

      const displayItem = (window.resizeTarget.data && window.resizeTarget.data.clipGroup)
        ? window.resizeTarget.children.find(function(c) { return !c.clipMask; })
        : window.resizeTarget;

      window.resizeInitialBounds = displayItem.bounds.clone();
      window.resizeInitialPoint = event.point.clone();
      window.resizeAnchor = window.getOppositePoint(window.resizeInitialBounds, window.resizeHandleType);
      window.resizeLastScaleX = 1.0;
      window.resizeLastScaleY = 1.0;
      return;
    }

    // 2. Hit test para elementos seleccionables normales
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
        // NUEVO: Verificar si se mantiene presionada una tecla de multi-selección (Shift o Ctrl/Cmd)
        const isMulti = event.modifiers.shift || event.modifiers.control || event.modifiers.command;
        window.selectItem(selectableItem, isMulti);
        
        window.dragging = true;
        // El offset para mover objetos se calculará en base al delta de movimiento relativo
        window.dragOffset = event.point;
        return;
      }
    }

    // Clic en vacío -> Deseleccionar
    window.deselectItem();
  };

  selectTool.onMouseDrag = function(event) {
    if (window.selectedItem && window.selectedItem.data && window.selectedItem.data.locked) {
      return;
    }

    // --- MANEJO DE ROTACIÓN INTERACTIVA ---
    if (window.rotationActive && window.rotationTarget) {
      const displayItem = (window.rotationTarget.data && window.rotationTarget.data.clipGroup)
        ? window.rotationTarget.children.find(function(c) { return !c.clipMask; })
        : window.rotationTarget;

      const currentPoint = event.point;
      const vector = currentPoint.subtract(window.rotationCenter);
      const currentAngle = vector.angle;

      // Calcular la diferencia angular
      let angleDiff = currentAngle - window.rotationStartAngle;
      let targetAngle = window.rotationInitialAngle + angleDiff;

      // Mantener ángulo dentro del rango de 0° a 360°
      targetAngle = (targetAngle % 360 + 360) % 360;

      // SENSIBILIDAD (ALIGNMENT SNAP) A 45° Y 90°:
      const snapAngle = 45;
      const tolerance = 4.0; // Tolerancia de 4 grados para ajustar
      const nearestSnap = Math.round(targetAngle / snapAngle) * snapAngle;
      let isSnapped = false;
      if (Math.abs(targetAngle - nearestSnap) < tolerance) {
        targetAngle = nearestSnap % 360;
        isSnapped = true;
      }

      // Calcular delta relativo a rotación actual para no acumular deformaciones
      const oldRotation = displayItem.data?.rotation || 0;
      let deltaRotate = targetAngle - oldRotation;

      // Optimizar camino de rotación corto
      if (deltaRotate > 180) deltaRotate -= 360;
      if (deltaRotate < -180) deltaRotate += 360;

      displayItem.rotate(deltaRotate, window.rotationCenter);
      displayItem.data = displayItem.data || {};
      displayItem.data.rotation = targetAngle;

      // Sincronizar el input de la barra emergente flotante
      const rotationNum = document.getElementById('ctxRotationNum');
      if (rotationNum) {
        rotationNum.value = Math.round(targetAngle) + '°';
      }

      // Re-dibujar la caja de selección del lienzo
      window.updateSelectionBox(window.selectedItem);

      // Mostrar retroalimentación visual del ángulo en tiempo real sobre el lienzo
      if (window.selectionBoxGroup) {
        const rotHandleDistance = 25 / paper.view.zoom;
        const rotHandleCenter = displayItem.bounds.topCenter.add(new paper.Point(0, -rotHandleDistance));
        const angleText = new paper.PointText({
          point: rotHandleCenter.add(new paper.Point(12 / paper.view.zoom, -4 / paper.view.zoom)),
          content: Math.round(targetAngle) + '°',
          fillColor: isSnapped ? '#28a745' : '#007bff', // Verde esmeralda si está alineado/snapped, azul normal si es libre
          fontSize: 12 / paper.view.zoom,
          fontWeight: 'bold',
          fontFamily: 'Arial'
        });
        window.selectionBoxGroup.addChild(angleText);
      }

      paper.view.update();
      return;
    }

    // --- MANEJO DE REDIMENSIONAMIENTO ---
    if (window.resizeActive && window.resizeTarget) {
      const displayItem = (window.resizeTarget.data && window.resizeTarget.data.clipGroup)
        ? window.resizeTarget.children.find(function(c) { return !c.clipMask; })
        : window.resizeTarget;

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

      // Mantener proporciones en esquinas
      if (['tl', 'tr', 'bl', 'br'].includes(window.resizeHandleType)) {
        const factor = (Math.abs(factorX) + Math.abs(factorY)) / 2 * (factorX < 0 ? -1 : 1);
        factorX = factor;
        factorY = factor;
      }

      const scaleFactorX = factorX / window.resizeLastScaleX;
      const scaleFactorY = factorY / window.resizeLastScaleY;

      const targetToScale = (window.resizeTarget.data && window.resizeTarget.data.clipGroup)
        ? window.resizeTarget.children.find(function(c) { return !c.clipMask; })
        : window.resizeTarget;

      if (targetToScale) {
        targetToScale.scale(scaleFactorX, scaleFactorY, anchor);
      }

      window.resizeLastScaleX = factorX;
      window.resizeLastScaleY = factorY;
      window.updateSelectionBox(window.resizeTarget);
      paper.view.update();
      return;
    }

    // --- MANEJO DE ARRASTRE DE OBJETO ---
    if (window.dragging && window.selectedItems && window.selectedItems.length > 0) {
      const delta = event.delta;
      window.selectedItems.forEach(item => {
        if (item.data && item.data.locked) return;
        const dragTarget = (item.data && item.data.clipGroup)
          ? item.children.find(function(c) { return !c.clipMask; })
          : item;
        dragTarget.position = dragTarget.position.add(delta);
      });
      window.updateSelectionBox(window.selectedItem);
      paper.view.update();
      return;
    }
  };

  selectTool.onMouseUp = function(event) {
    if (window.resizeActive || window.dragging || window.rotationActive) {
      if (typeof window.saveHistory === 'function') window.saveHistory();
    }
    window.dragging = false;
    window.resizeActive = false;
    window.rotationActive = false;
    paper.view.update();
  };

  selectTool.onMouseMove = function(event) {
    // Si hay una acción activa, respetamos el cursor de esa acción
    if (window.dragging) {
      paper.view.element.style.cursor = "move";
      return;
    }
    if (window.resizeActive) {
      return; // Mantener el cursor actual de redimensionamiento
    }
    if (window.rotationActive) {
      paper.view.element.style.cursor = "grabbing";
      return;
    }
    if (window.insertTextMode) {
      paper.view.element.style.cursor = "text";
      return;
    }

    // Evitar pisar los cursores de paneo (grab/grabbing) de la barra espaciadora o botón medio
    const currentCursor = paper.view.element.style.cursor;
    if (currentCursor === "grab" || currentCursor === "grabbing") {
      return;
    }

    if (window.selectedItem) {
      // 1. Hit test para verificar si el mouse está sobre un tirador (handle)
      const hitResult = paper.project.hitTest(event.point, {
        fill: true,
        stroke: true,
        segments: true,
        tolerance: 8 / paper.view.zoom,
        match: function(hit) {
          return hit.item.data && hit.item.data.isHandle;
        }
      });

      if (hitResult) {
        const hType = hitResult.item.data.handleType;
        if (hType === 'rot') {
          paper.view.element.style.cursor = "grab";
        } else if (hType === 'tl' || hType === 'br') {
          paper.view.element.style.cursor = "nwse-resize";
        } else if (hType === 'tr' || hType === 'bl') {
          paper.view.element.style.cursor = "nesw-resize";
        } else if (hType === 't' || hType === 'b') {
          paper.view.element.style.cursor = "ns-resize";
        } else if (hType === 'l' || hType === 'r') {
          paper.view.element.style.cursor = "ew-resize";
        }
        return;
      }

      // 2. Hit test para verificar si el mouse está sobre el elemento seleccionado en sí
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
        if (selectableItem && selectableItem === window.selectedItem) {
          paper.view.element.style.cursor = "move";
          return;
        }
      }
    }

    // Por defecto, cursor normal
    paper.view.element.style.cursor = "default";
  };

  selectTool.activate();
  console.log("🎯 Eventos de selección y redimensionamiento de Paper.js registrados con éxito.");
};

// Autoejecutar inmediatamente si Paper.js ya está activo
if (typeof paper !== "undefined" && paper.view) {
  window.initSelectionTool();
}

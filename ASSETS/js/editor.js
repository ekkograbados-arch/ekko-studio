/* =========================================================================
   Modulo: ASSETS/js/editor.js (v27.0 PRO - Universal Stable Stacking, CSG & Safe Import Engine)
   Ruta en repositorio: ASSETS/js/editor.js
   
   Descripcion:
   Nucleo de la aplicacion EKKO Studio basado en Paper.js.
   
   Mejoras y Correcciones Arquitectonicas v27.0 PRO:
   1. Apertura Robusta del Selector de Archivos (#svgPicker) con prevencion de clics fantasma.
   2. Ingesta, auto-escalado proporcional y renderizado visible garantizado de SVG.
   3. Desacoplamiento defensivo de recalculo CSG dinámico (elimina SyntaxError por dependencias circulares).
   4. Preservacion estricta de geomBase horneada para impedir deformaciones al desagrupar.
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

// Desacoplamiento defensivo para evitar SyntaxError por importaciones cruzadas en ES Modules
function triggerDynamicSubtractions() {
  if (typeof window !== 'undefined' && typeof window.recalculateDynamicSubtractions === 'function') {
    window.recalculateDynamicSubtractions();
  }
}

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
window.getContentItem = getContentItem;

// Estilos CSS para el lienzo infinito
const infiniteCanvasStylesId = 'ekko-infinite-canvas-styles';
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

function cleanGhostInterfaceItems() {
  if (typeof paper !== "undefined" && paper.project) {
    paper.project.getItems({
      match: function(item) {
        return item.data && (
          item.data.isSelectionBox ||
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
  if (window.selectedItem || (window.selectedItems && window.selectedItems.length > 0)) {
    window.deselectItem();
  }
  if (typeof restoreMockupReferences === "function") {
    restoreMockupReferences();
  }
  triggerDynamicSubtractions();
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
  if (window.selectedItem || (window.selectedItems && window.selectedItems.length > 0)) {
    window.deselectItem();
  }
  if (typeof restoreMockupReferences === "function") {
    restoreMockupReferences();
  }
  triggerDynamicSubtractions();
  paper.view.update();
}
window.redo = redo;

function isLockedItem(item) {
  return item && item.data && item.data.locked === true;
}
window.isLockedItem = isLockedItem;

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
window.updateSelectionInfo = updateSelectionInfo;

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
window.updateLockButton = updateLockButton;

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
    if (window.selectedItems && window.selectedItems.length > 0) {
      window.selectedItems.forEach(it => { if (it) it.selected = false; });
    }
    window.selectedItems = [item];
    window.selectedItem = item;
    item.selected = true;
  }

  updateSelectionInfo();
  updateLockButton();
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(window.selectedItem);
  }
  if (typeof window.updateContextualMenu === 'function') {
    window.updateContextualMenu(window.selectedItem);
  }
  paper.view.update();
};

window.deselectItem = function() {
  if (window.nodeEditMode) {
    window.exitNodeEditMode();
  }
  if (!window.selectedItem && (!window.selectedItems || window.selectedItems.length === 0)) {
    return;
  }
  if (window.selectedItems && window.selectedItems.length > 0) {
    window.selectedItems.forEach(it => { if (it) it.selected = false; });
  }
  if (window.selectedItem) {
    window.selectedItem.selected = false;
  }
  window.selectedItem = null;
  window.selectedItems = [];
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(null);
  }
  if (typeof window.hideContextualMenu === 'function') {
    window.hideContextualMenu();
  }
  updateSelectionInfo();
  updateLockButton();
  if (window.paper && paper.view) {
    paper.view.update();
  }
};

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
  if (prevSelected) {
    window.deselectItem();
  }
  sceneStates[key] = paper.project.exportJSON({ asString: true });
  if (prevSelected) {
    window.selectItem(prevSelected);
  }
}

function loadSurfaceScene(product, surface) {
  if (!product || !surface) return;
  const key = getSceneKey(product, surface);
  if (window.selectedItem || (window.selectedItems && window.selectedItems.length > 0)) {
    window.deselectItem();
  }
  paper.view.zoom = 1.0;
  paper.view.center = new paper.Point(0, 0);
  if (sceneStates[key]) {
    paper.project.clear();
    paper.project.importJSON(sceneStates[key]);
    cleanGhostInterfaceItems();
    if (window.selectedItem || (window.selectedItems && window.selectedItems.length > 0)) {
      window.deselectItem();
    }
    if (typeof restoreMockupReferences === "function") {
      restoreMockupReferences();
      if (typeof window.updateGlobalScaleFactor === "function") window.updateGlobalScaleFactor();
    }
    triggerDynamicSubtractions();
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
  triggerDynamicSubtractions();
  window.selectItem(clone);
  paper.view.update();
}
window.pasteSelected = pasteSelected;

function isMockupOrUIItem(item) {
  let curr = item;
  while (curr) {
    const d = curr.data || {};
    if (d.mockup || d.isMask || d.wasClipMask || d.isSelectionBox || d.isHandle ||
        d.isNodeHandle || d.isCurveHandle || d.isNodeEditOverlay || d.isSmartGuide ||
        d.isMeasurement || d.isTracePreview) {
      return true;
    }
    curr = curr.parent;
  }
  return false;
}

function itemsOverlapSpatial(itemA, itemB) {
  if (!itemA || !itemB || itemA === itemB) return false;
  const contentA = getContentItem(itemA);
  const contentB = getContentItem(itemB);
  if (!contentA || !contentB) return false;
  if (!contentA.bounds || !contentB.bounds) return false;
  if (!contentA.bounds.intersects(contentB.bounds)) {
    return false;
  }
  try {
    if (typeof contentA.intersects === 'function' && contentA.intersects(contentB)) {
      return true;
    }
    if (typeof contentA.contains === 'function' && contentA.contains(contentB.bounds.center)) {
      return true;
    }
    if (typeof contentB.contains === 'function' && contentB.contains(contentA.bounds.center)) {
      return true;
    }
    return true;
  } catch (e) {
    return contentA.bounds.intersects(contentB.bounds);
  }
}

function bringFront() {
  if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
  if (typeof saveHistory === 'function') saveHistory();
  if (window.currentMockup) {
    window.selectedItem.insertBelow(window.currentMockup);
  } else {
    window.selectedItem.bringToFront();
  }
  if (window.currentMockup) {
    window.currentMockup.bringToFront();
  }
  triggerDynamicSubtractions();
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(window.selectedItem);
  }
  paper.view.update();
}
window.bringFront = bringFront;

function sendBack() {
  if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
  if (typeof saveHistory === 'function') saveHistory();
  const parent = window.selectedItem.parent || (paper.project && paper.project.activeLayer);
  if (parent) {
    parent.insertChild(0, window.selectedItem);
  } else {
    window.selectedItem.sendToBack();
  }
  if (window.currentMockup) {
    window.currentMockup.bringToFront();
  }
  triggerDynamicSubtractions();
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(window.selectedItem);
  }
  paper.view.update();
}
window.sendBack = sendBack;

function bringForward() {
  if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
  if (typeof saveHistory === 'function') saveHistory();
  const item = window.selectedItem;
  const parent = item.parent || (paper.project && paper.project.activeLayer);
  if (!parent || !parent.children) return;
  const siblings = parent.children;
  const myIndex = siblings.indexOf(item);
  if (myIndex === -1) return;

  let targetSibling = null;
  for (let i = myIndex + 1; i < siblings.length; i++) {
    const candidate = siblings[i];
    if (candidate.data && (candidate.data.mockup || candidate.data.isMask)) break;
    if (isMockupOrUIItem(candidate)) continue;
    if (itemsOverlapSpatial(item, candidate)) {
      targetSibling = candidate;
      break;
    }
  }

  if (targetSibling) {
    item.insertAbove(targetSibling);
  } else {
    const next = item.nextSibling;
    if (next && (!next.data || !next.data.mockup)) {
      item.insertAbove(next);
    } else if (window.currentMockup) {
      item.insertBelow(window.currentMockup);
    } else {
      item.bringToFront();
    }
  }

  if (window.currentMockup) {
    window.currentMockup.bringToFront();
  }
  triggerDynamicSubtractions();
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(item);
  }
  paper.view.update();
}
window.bringForward = bringForward;

function sendBackward() {
  if (!window.selectedItem || isLockedItem(window.selectedItem)) return;
  if (typeof saveHistory === 'function') saveHistory();
  const item = window.selectedItem;
  const parent = item.parent || (paper.project && paper.project.activeLayer);
  if (!parent || !parent.children) return;
  const siblings = parent.children;
  const myIndex = siblings.indexOf(item);
  if (myIndex === -1) return;

  let targetSibling = null;
  for (let i = myIndex - 1; i >= 0; i--) {
    const candidate = siblings[i];
    if (isMockupOrUIItem(candidate)) continue;
    if (itemsOverlapSpatial(item, candidate)) {
      targetSibling = candidate;
      break;
    }
  }

  if (targetSibling) {
    item.insertBelow(targetSibling);
  } else {
    const prev = item.previousSibling;
    if (prev && !isMockupOrUIItem(prev)) {
      item.insertBelow(prev);
    } else {
      item.sendToBack();
    }
  }

  if (window.currentMockup) {
    window.currentMockup.bringToFront();
  }
  triggerDynamicSubtractions();
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(item);
  }
  paper.view.update();
}
window.sendBackward = sendBackward;

function initGeomBaseRecursive(item) {
  if (!item) return;
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
    if (!item.data) item.data = {};
    if (!item.data.geomBase) {
      const baseClone = item.clone({ insert: false });
      baseClone.matrix = new paper.Matrix();
      item.data.geomBase = baseClone;
    }
  }
  if (item instanceof paper.Group && item.children) {
    item.children.forEach(initGeomBaseRecursive);
  }
}

export function addImageFromFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const raster = new paper.Raster({ source: e.target.result });
    raster.onLoad = () => {
      if (window.paper && paper.project) {
        const dLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
        if (dLayer) dLayer.activate();
      }
      raster.data = { locked: false, label: file.name };
      const area = (window.currentMockup && window.currentMockup.bounds) ? window.currentMockup.bounds : paper.view.bounds;
      const size = Math.min(area.width, area.height) * 0.5;
      if (raster.width > 0) {
        raster.scale(size / raster.width);
      }
      raster.position = area.center.clone();
      const objeto = window.clipItem ? window.clipItem(raster) : raster;
      if (window.currentMockup) {
        objeto.insertBelow(window.currentMockup);
      }
      saveHistory();
      window.selectItem(objeto);
      paper.view.update();
    };
  };
  reader.readAsDataURL(file);
}
window.addImageFromFile = addImageFromFile;

export function addSVGFromFile(file) {
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    const svgText = e.target.result;
    if (!svgText || typeof svgText !== 'string' || svgText.trim() === '') {
      console.error("[EKKO SVG IMPORT] Archivo SVG vacio o corrupto.");
      return;
    }

    try {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(svgText, "image/svg+xml");
      const parserError = xmlDoc.querySelector("parsererror");
      if (parserError) {
        console.warn("[EKKO SVG IMPORT WARNING] Advertencia en XML de SVG:", parserError.textContent);
      }
    } catch (err) {
      console.error("[EKKO SVG IMPORT ERROR] Fallo al sanear XML:", err);
    }

    if (window.paper && paper.project) {
      const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
      if (designLayer) designLayer.activate();
    }

    paper.project.importSVG(svgText, (item) => {
      if (!item) {
        console.error("[EKKO SVG IMPORT] Paper.js no pudo generar el objeto vectorial a partir del SVG.");
        return;
      }

      const cleanLabel = file.name ? file.name.replace(/\.svg$/i, "") : "SVG Importado";
      item.data = { ...(item.data || {}), locked: false, label: cleanLabel };

      const targetArea = (window.currentMockup && window.currentMockup.bounds && window.currentMockup.bounds.width > 0)
        ? window.currentMockup.bounds
        : paper.view.bounds;

      const itemBounds = item.bounds;
      if (itemBounds && itemBounds.width > 0 && itemBounds.height > 0) {
        const maxSpan = Math.min(targetArea.width, targetArea.height) * 0.5;
        const currentSpan = Math.max(itemBounds.width, itemBounds.height);
        if (currentSpan > 0 && maxSpan > 0) {
          const scaleRatio = maxSpan / currentSpan;
          item.scale(scaleRatio);
        }
      }

      item.position = targetArea.center.clone();

      const sanitizeAndBakeVectors = (root) => {
        if (!root) return;
        if (root instanceof paper.Path || root instanceof paper.CompoundPath) {
          root.strokeScaling = false;
          const hasStroke = root.strokeColor && root.strokeWidth > 0;
          const hasFill = !!root.fillColor;
          if (!hasStroke && !hasFill) {
            root.fillColor = new paper.Color('#111827');
          } else if (hasStroke && (!root.strokeWidth || root.strokeWidth < 1.0)) {
            root.strokeWidth = 1.2;
          }
        }
        if (root.children && Array.isArray(root.children)) {
          root.children.forEach(sanitizeAndBakeVectors);
        }
      };
      sanitizeAndBakeVectors(item);

      item.applyMatrix = true;
      initGeomBaseRecursive(item);

      let finalItem = item;
      if (typeof window.clipItem === 'function' && !window.infiniteCanvasMode && window.clipMask) {
        finalItem = window.clipItem(item);
      } else {
        if (paper.project && paper.project.activeLayer) {
          paper.project.activeLayer.addChild(item);
        }
      }

      if (window.currentMockup && finalItem) {
        finalItem.insertBelow(window.currentMockup);
      }

      triggerDynamicSubtractions();
      saveHistory();
      window.selectItem(finalItem);
      paper.view.update();

      console.log(`%c[EKKO SVG IMPORT] SVG '${cleanLabel}' importado, escalado y dinamizado con exito.`, 'color: #10b981; font-weight: bold;');
    });
  };

  reader.onerror = (err) => {
    console.error("[EKKO SVG IMPORT] Error de lectura en FileReader:", err);
  };

  reader.readAsText(file);
}
window.addSVGFromFile = addSVGFromFile;

export function openSVGFileDialog() {
  let picker = document.getElementById("svgPicker");
  if (!picker) {
    picker = document.createElement("input");
    picker.type = "file";
    picker.id = "svgPicker";
    picker.accept = ".svg";
    picker.style.display = "none";
    document.body.appendChild(picker);
    picker.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (file) {
        addSVGFromFile(file);
        e.target.value = "";
      }
    });
  }
  if (typeof window !== 'undefined') {
    window.__EKKO_FILE_PICKER_TRIGGERED__ = true;
    setTimeout(() => { window.__EKKO_FILE_PICKER_TRIGGERED__ = false; }, 1200);
  }
  picker.click();
  return true;
}
window.openSVGFileDialog = openSVGFileDialog;

export function openImageFileDialog() {
  const picker = document.getElementById("imagePicker");
  if (picker) {
    if (typeof window !== 'undefined') {
      window.__EKKO_FILE_PICKER_TRIGGERED__ = true;
      setTimeout(() => { window.__EKKO_FILE_PICKER_TRIGGERED__ = false; }, 1200);
    }
    picker.click();
    return true;
  }
  return false;
}
window.openImageFileDialog = openImageFileDialog;

const loadQRCodeLibrary = () => {
  return new Promise((resolve) => {
    if (window.QRCode) return resolve();
    const script = document.createElement("script");
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    script.onload = () => resolve();
    document.head.appendChild(script);
  });
};

export async function addQRToCanvas(text) {
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
        raster.data = { locked: false, label: "Codigo QR" };
        const area = paper.view.bounds;
        const size = Math.min(area.width, area.height) * 0.3;
        raster.scale(size / raster.width);
        raster.position = area.center;
        const objeto = window.clipItem ? window.clipItem(raster) : raster;
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
window.addQRToCanvas = addQRToCanvas;

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

function activateTextMode() {
  window.insertTextMode = true;
  if (paper.view && paper.view.element) {
    paper.view.element.style.cursor = "text";
  }
}
window.activateTextMode = activateTextMode;

export function createEditableText(point) {
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
  const clipped = window.clipItem ? window.clipItem(txt) : txt;
  if (window.currentMockup) {
    clipped.insertBelow(window.currentMockup);
  }
  window.selectItem(clipped);
  startTextEditing(txt);
}
window.createEditableText = createEditableText;

const safeAddListener = (id, event, fn) => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener(event, fn);
  }
};

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
window.resetCanvasView = resetCanvasView;

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
    const initialWidth = containerEl.clientWidth || window.innerWidth;
    const initialHeight = containerEl.clientHeight || window.innerHeight;
    canvasEl.width = initialWidth;
    canvasEl.height = initialHeight;

    paper.setup("editorCanvas");
    paper.view.viewSize = new paper.Size(initialWidth, initialHeight);

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

    if (typeof window.initSelectionTool === "function") {
      try {
        window.initSelectionTool();
      } catch (err) {
        console.error("[EKKO BOOTSTRAP] Error al inicializar herramienta de seleccion:", err);
      }
    }

    if (typeof initContextualMenu === "function") {
      try {
        initContextualMenu();
      } catch (err) {
        console.error("[EKKO BOOTSTRAP] Error al inicializar menu contextual:", err);
      }
    }

    try {
      if (!window.ekkoShortcutsBound) {
        initZoomControls(canvasEl);
        initGlobalKeyboardShortcuts();
        window.ekkoShortcutsBound = true;
      }
    } catch (err) {
      console.error("[EKKO BOOTSTRAP] Error al acoplar controles de zoom y atajos de teclado:", err);
    }

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
      openImageFileDialog();
    });

    safeAddListener("imagePicker", "change", (e) => {
      const file = e.target.files[0];
      if (file) {
        addImageFromFile(file);
        e.target.value = "";
      }
    });

    safeAddListener("btnAddSVG", "click", () => {
      openSVGFileDialog();
    });

    safeAddListener("svgPicker", "change", (e) => {
      const file = e.target.files[0];
      if (file) {
        addSVGFromFile(file);
        e.target.value = "";
      }
    });

    safeAddListener("btnAddQR", "click", () => {
      const text = prompt("Ingresa el texto o URL para generar el Código QR:", "https://ekkograbados.mitiendanube.com/");
      if (text && text.trim() !== "") {
        addQRToCanvas(text.trim());
      }
    });

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

    console.log("%c[EKKO BOOTSTRAP] Resolviendo catalogos de recursos y tipografias en segundo plano...", "color: #0369a1;");
    const fontsPromise = loadDynamicFonts()
      .then(loadedFonts => {
        console.log("%c[EKKO BOOTSTRAP] Tipografias del backend sincronizadas en el editor.", "color: #10b981;");
        return loadedFonts;
      })
      .catch(err => {
        console.warn("[EKKO BOOTSTRAP] Fallo no critico al sincronizar fuentes:", err);
        return [];
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

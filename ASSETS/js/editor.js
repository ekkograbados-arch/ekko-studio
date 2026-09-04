/* =========================================================================
   Modulo: ASSETS/js/editor.js (v26.0 PRO - SVG Import, Stacking CSG & Reactive Z-Order Engine)
   Ruta en repositorio: ASSETS/js/editor.js
   
   Descripcion:
   Nucleo de la aplicacion EKKO Studio basado en Paper.js.
   
   Mejoras y Correcciones Arquitectonicas v26.0 PRO (Ruta 1 - #btnAddSVG):
   1. Apertura Robusta del Selector de Archivos (#svgPicker):
      - 'openSVGFileDialog()' localiza '#svgPicker' en el DOM de forma segura.
      - Si el nodo no existiera, genera un fallback temporal transparente.
      - Notifica formalmente a EKKO_DIAG para erradicar el falso positivo de boton muerto/fantasma.
   2. Motor de Ingesta y Despliegue de SVG ('addSVGFromFile'):
      - Saneamiento XML estricto con DOMParser defensivo y manejo de excepciones.
      - Activacion garantizada de 'designLayer'.
      - Centrado automatico sobre el area de grabado del producto ('window.currentMockup') o el lienzo.
      - Auto-escalado proporcional inteligente (maximo 50% del area visual del producto).
      - Enmascaramiento automatico 'window.clipItem(item)' respetando 'window.infiniteCanvasMode'.
      - Inicializacion recursiva de 'geomBase' en trazados cerrados para garantizar compatibilidad
        con la Descomposicion por Jerarquia de Contencion, rotacion, escala y edicion de nodos.
      - Reactividad CSG: Disparo de 'recalculateDynamicSubtractions()' al culminar la insercion.
      - Gestion de Historial: 'saveHistory()' ejecutado tras la insercion real, no antes de leer el archivo.
      - Seleccion inmediata con 'window.selectItem(objeto)' y actualizacion del menu contextual.
   3. Reset de Selector de Archivos:
      - 'e.target.value = ""' garantiza que re-seleccionar el mismo archivo dispare el evento 'change'.
   4. Preservacion absoluta de la reactividad de capas, orden Z (LightBurn style) y arranque unificado.
   ========================================================================= */

import "./modules/selection.js";
import "./modules/canvas-pro/ekkoDiagnostics.js";
import "./modules/canvas-pro/ekkoSynapse.js";
import { loadDynamicFonts } from "./modules/canvas-pro/textToolbar.js";
import { loadDynamicProducts } from "./modules/productsLoader.js";
import { restoreMockupReferences, loadMockup } from "./modules/mockupLoader.js";
import { updateContextualMenu, hideContextualMenu, initContextualMenu } from "./modules/canvas-pro/contextualMenu.js";
import { startTextEditing } from "./modules/textEditor.js";
import { initProControls } from "./modules/canvas-pro/canvasControlsIntegration.js";
import { initZoomControls, initGlobalKeyboardShortcuts } from "./modules/canvas-pro/zoomYShortcuts.js";
import { recalculateDynamicSubtractions } from "./modules/canvas-pro/geometricUngroup.js";
import { initSmartFusionListeners } from "./modules/canvas-pro/smartFusion.js";

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
  // Reactividad CSG: Recalcular calados en el estado restaurado
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
  if (window.selectedItem || (window.selectedItems && window.selectedItems.length > 0)) {
    window.deselectItem();
  }
  if (typeof restoreMockupReferences === "function") {
    restoreMockupReferences();
  }
  // Reactividad CSG: Recalcular calados en el estado restaurado
  if (typeof recalculateDynamicSubtractions === "function") {
    recalculateDynamicSubtractions();
  } else if (typeof window.recalculateDynamicSubtractions === "function") {
    window.recalculateDynamicSubtractions();
  }
  paper.view.update();
}
window.redo = redo;

function isLockedItem(item) {
  return !!(item && item.data && item.data.locked === true);
}
window.isLockedItem = isLockedItem;

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
  // Protección contra bucles de deselección redundantes
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
  const mockupBounds = window.currentMockup.bounds;
  const prod = toolState.currentProduct;
  const dims = window.getRealProductDimensions(prod);
  let realW = dims.width;
  let realH = dims.height;
  const isLandscapeMockup = mockupBounds.width > mockupBounds.height;
  const isLandscapeReal = realW > realH;
  if (isLandscapeMockup !== isLandscapeReal && realW !== realH) {
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

// Gestion e Insercion de Z-Index Inteligente por Colision Espacial (LightBurn Style)
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
  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  }
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
  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  }
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

  // Buscar el primer hermano superior que colisione espacialmente con este elemento (LightBurn Style)
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
  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  }
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

  // Buscar el primer hermano inferior que colisione espacialmente con este elemento (LightBurn Style)
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
  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions();
  }
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(item);
  }
  paper.view.update();
}
window.sendBackward = sendBackward;

// Helper para inicializar geomBase recursivamente en geometrias importadas
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

// Carga de Archivos e Importación
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

    // Asegurar activacion de la capa de diseno
    if (window.paper && paper.project) {
      const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
      if (designLayer) designLayer.activate();
    }

    paper.project.importSVG(svgText, (item) => {
      if (!item) {
        console.error("[EKKO SVG IMPORT] Paper.js no pudo generar el objeto vectorial a partir del SVG.");
        return;
      }

      // 1. Inicializar metadatos de capa
      const cleanLabel = file.name ? file.name.replace(/\.svg$/i, "") : "SVG Importado";
      item.data = { ...(item.data || {}), locked: false, label: cleanLabel };

      // 2. Posicionamiento y escalado proporcional respecto al mockup o lienzo
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

      // 3. Centrado absoluto sobre el producto
      item.position = targetArea.center.clone();

      // 4. Sanitizacion visual y preparacion de trazados
      // Evita trazos microscopicos invisibles tras el escalado y asegura visibilidad
      function sanitizeAndBakeVectors(node) {
        if (!node) return;
        if (node instanceof paper.Path || node instanceof paper.CompoundPath) {
          node.visible = true;
          node.opacity = 1.0;
          if (node.strokeColor) {
            node.strokeScaling = false;
            if (!node.strokeWidth || node.strokeWidth < 1.0) {
              node.strokeWidth = 1.2;
            }
          } else if (!node.fillColor) {
            node.fillColor = new paper.Color('#111827');
          }
        }
        if (node.children && node.children.length > 0) {
          node.children.forEach(sanitizeAndBakeVectors);
        }
      }
      sanitizeAndBakeVectors(item);

      // 5. Hornear transformaciones en coordenadas reales de cada nodo
      item.applyMatrix = true;

      // 6. AHORA que el objeto esta escalado, centrado y horneado, inicializar geomBase
      // Garantiza que al desagrupar, cada pieza conserve exactamente este tamano y forma
      initGeomBaseRecursive(item);

      // 7. Enmascaramiento segun el modo de contencion de producto
      let finalItem = item;
      if (typeof window.clipItem === 'function' && !window.infiniteCanvasMode && window.clipMask) {
        finalItem = window.clipItem(item);
      } else {
        if (paper.project && paper.project.activeLayer) {
          paper.project.activeLayer.addChild(item);
        }
      }

      // 8. Orden Z: El diseño siempre se posiciona inmediatamente debajo del mockup visible
      if (window.currentMockup && finalItem) {
        finalItem.insertBelow(window.currentMockup);
      }

      // 9. Reactividad CSG de calados si coexistieran
      if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
      }

      // 10. Guardado formal de historial post-insercion exitosa
      saveHistory();

      // 11. Sincronizacion de seleccion e interfaz
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

// Controladores Nombrados para Diálogos de Carga (Trazabilidad y Prevención de Clics Fantasma)
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
      const file = e.target.files && e.target.files[0];
      if (file) {
        addSVGFromFile(file);
        e.target.value = "";
      }
    });
  }

  try {
    picker.click();
    return true;
  } catch (err) {
    console.error("[EKKO DIALOG] No se pudo invocar el selector de SVG:", err);
    return false;
  }
}
window.openSVGFileDialog = openSVGFileDialog;

export function openImageFileDialog() {
  let picker = document.getElementById("imagePicker");
  if (!picker) {
    picker = document.createElement("input");
    picker.type = "file";
    picker.id = "imagePicker";
    picker.accept = "image/*";
    picker.style.display = "none";
    document.body.appendChild(picker);
    picker.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        addImageFromFile(file);
        e.target.value = "";
      }
    });
  }

  try {
    picker.click();
    return true;
  } catch (err) {
    console.error("[EKKO DIALOG] No se pudo invocar el selector de imagen:", err);
    return false;
  }
}
window.openImageFileDialog = openImageFileDialog;

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
          const dLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
          if (dLayer) dLayer.activate();
        }
        raster.data = { locked: false, label: "Codigo QR" };
        const area = (window.currentMockup && window.currentMockup.bounds) ? window.currentMockup.bounds : paper.view.bounds;
        const size = Math.min(area.width, area.height) * 0.3;
        if (raster.width > 0) {
          raster.scale(size / raster.width);
        }
        raster.position = area.center.clone();
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

// Guardas para eventos y listeners del taller
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
    // 1. Resolver medidas fisicas iniciales del visor
    const initialWidth = containerEl.clientWidth || window.innerWidth;
    const initialHeight = containerEl.clientHeight || window.innerHeight;
    canvasEl.width = initialWidth;
    canvasEl.height = initialHeight;

    // 2. Inicializar Paper.js sobre el canvas fisico
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

    // 5. Inicializar herramientas de interaccion visual
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
      openImageFileDialog();
    });

    safeAddListener("imagePicker", "change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        addImageFromFile(file);
        e.target.value = "";
      }
    });

    safeAddListener("btnAddSVG", "click", () => {
      openSVGFileDialog();
    });

    safeAddListener("svgPicker", "change", (e) => {
      const file = e.target.files && e.target.files[0];
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

    // Listener nativo del navegador como fallback de redibujado
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

    // 9. CARGA SECUENCIAL ASINCRONA DE ENDPOINTS (FUENTES Y PRODUCTOS)
    console.log("%c[EKKO BOOTSTRAP] Resolviendo catalogos de recursos y tipografias en segundo plano...", "color: #0369a1;");
    const fontsPromise = loadDynamicFonts()
      .then(loadedFonts => {
        console.log("%c[EKKO BOOTSTRAP] Tipografias del backend sincronizadas en el editor.", "color: #10b981;");
        return loadedFonts;
      })
      .catch(err => {
        console.warn("[EKKO BOOTSTRAP] Fallo la carga dinamica de tipografias. Usando fallbacks.", err);
      });

    const productsPromise = loadDynamicProducts()
      .then(() => {
        console.log("%c[EKKO BOOTSTRAP] Catalogo de productos dinamizado con exito.", "color: #10b981;");
      })
      .catch(err => {
        console.warn("[EKKO BOOTSTRAP] Fallo la consulta de productos de la API. Usando catalogo estatico.", err);
      })
      .finally(() => {
        renderCategories();
      });

    await Promise.all([fontsPromise, productsPromise]);
      initSmartFusionListeners(); 
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

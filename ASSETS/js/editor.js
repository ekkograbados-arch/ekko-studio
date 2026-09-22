import { isMockupOrMask, isContainmentWrapper, getPublicOwner, getPublicOwners, getOwnerLocalGeometry, getOwnerLocalBounds, getPublicWorldBounds } from "./modules/canvas-pro/designGeometry.js";
import { getCanonicalDesignLayer, getStackingUnit } from "./modules/canvas-pro/vectorSemantics.js";

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
      - Gestion de Historial: snapshot tomado antes de iniciar la insercion para que Undo restaure el estado previo.
      - Seleccion inmediata con 'window.selectItem(objeto)' y actualizacion del menu contextual.
   3. Reset de Selector de Archivos:
      - 'e.target.value = ""' garantiza que re-seleccionar el mismo archivo dispare el evento 'change'.
   4. Preservacion absoluta de la reactividad de capas, orden Z (LightBurn style) y arranque unificado.
   ========================================================================= */

import "./modules/selection.js";
import "./modules/canvas-pro/ekkoDiagnostics.js";
import "./modules/canvas-pro/runtimeProbe.js";
import "./modules/canvas-pro/runtimeTransformTrace.js";
import "./modules/canvas-pro/exportSVG.js";
import "./modules/canvas-pro/ekkoSynapse.js";
import { loadDynamicFonts, convertTextToVector, applyTextCurve } from "./modules/canvas-pro/textToolbar.js";
import { loadDynamicProducts } from "./modules/productsLoader.js";
import { restoreMockupReferences, loadMockup } from "./modules/mockupLoader.js";
import { updateContextualMenu, hideContextualMenu, initContextualMenu } from "./modules/canvas-pro/contextualMenu.js";
import { startTextEditing } from "./modules/textEditor.js";
import { initProControls } from "./modules/canvas-pro/canvasControlsIntegration.js";
import { initZoomControls, initGlobalKeyboardShortcuts } from "./modules/canvas-pro/zoomYShortcuts.js";
import { recalculateDynamicSubtractions, getGlobalUnsubtractedPath } from "./modules/canvas-pro/geometricUngroup.js";
import { stampClientSvgSourceSemantics } from "./modules/canvas-pro/sourceSemantics.js";
import { initSmartFusionListeners } from "./modules/canvas-pro/smartFusion.js";
import {
  initFusionEditMode,
  enterFusionEditMode,
  exitFusionEditMode,
  handleFusionEditKeyDown
} from "./modules/canvas-pro/fusionEditMode.js";
import "./modules/canvas-pro/interactionOwner.js"; // Árbitro único de interacción (Fase 0)
import "./modules/canvas-pro/ownerGraph.js"; // Cadena única de owners públicos
import "./modules/canvas-pro/fusionCore.js";
import { enterNodeEditMode, exitNodeEditMode } from "./modules/canvas-pro/nodeEditor.js";
import { openImageTraceModal } from "./modules/canvas-pro/imageTracer.js";
import { convertSelectionToCalado, canConvertSelectionToCalado, convertSelectionToSolid } from "./modules/canvas-pro/calado.js";
// backgroundRemover.js permanece desactivado hasta que la IA local esté habilitada.
// import './modules/canvas-pro/backgroundRemover.js';
// ⏸️ [DESACTIVADO TEMPORALMENTE] — Módulo Quitar Fondo IA
// PARA REACTIVAR: Quitar las dos barras "//" de arriba

// Exposicion segura de API al contexto global del navegador (WYSIWYG-Sync)
window.updateContextualMenu = updateContextualMenu;
window.hideContextualMenu = hideContextualMenu;
window.initContextualMenu = initContextualMenu;
window.startTextEditing = startTextEditing;
window.enterNodeEditMode = enterNodeEditMode;
window.exitNodeEditMode = exitNodeEditMode;
window.convertSelectionToCalado = convertSelectionToCalado;
window.canConvertSelectionToCalado = canConvertSelectionToCalado;
window.convertSelectionToSolid = convertSelectionToSolid;
window.convertTextToVector = convertTextToVector;
window.applyTextCurve = applyTextCurve;
window.enterFusionEditMode = enterFusionEditMode;
window.exitFusionEditMode = exitFusionEditMode;
window.handleFusionEditKeyDown = handleFusionEditKeyDown;

// ================================================================
// API COMPATIBLE CON LA CINTA HTML
// ================================================================
window.toggleNodeEditMode = function() {
  if (window.nodeEditMode) {
    return exitNodeEditMode();
  }
  const selected = window.selectedItem ||
    (Array.isArray(window.selectedItems) ? window.selectedItems[window.selectedItems.length - 1] : null);
  if (!selected) {
    alert("Seleccioná primero un vector para editar sus nodos.");
    return null;
  }
  return enterNodeEditMode(selected);
};

window.traceRaster = function(item = null) {
  const selected = item || window.selectedItem ||
    (Array.isArray(window.selectedItems) ? window.selectedItems[window.selectedItems.length - 1] : null);
  const target = getPublicOwner(selected);
  if (!target || !(target instanceof paper.Raster)) {
    alert("Seleccioná primero una imagen para trazarla.");
    return null;
  }
  return openImageTraceModal(target);
};

window.removeBackground = function() {
  const api = window.EKKO?.BackgroundRemover;
  const selected = window.selectedItem ||
    (Array.isArray(window.selectedItems) ? window.selectedItems[window.selectedItems.length - 1] : null);
  const target = getPublicOwner(selected);
  if (api?.eliminarFondoInteligente && target instanceof paper.Raster) {
    return api.eliminarFondoInteligente(target);
  }
  // El módulo IA se mantiene desactivado; el botón no debe generar ReferenceError.
  alert("Quitar Fondo IA todavía no está habilitado en esta versión.");
  return null;
};

window.zoomToFit = function() {
  if (!window.paper?.project || !paper.view) return null;
  const layer = paper.project.layers.find(l => l.name === "designLayer") || paper.project.activeLayer;
  const candidates = (layer?.children || []).filter(item => {
    const d = item.data || {};
    return item.visible !== false && !d.mockup && !d.isSelectionBox && !d.isSmartGuide &&
      !d.isHandle && !d.isNodeEditOverlay && !d.isFusionPreview;
  });
  const target = candidates.length ? candidates.reduce((acc, item) => acc ? acc.unite(item.bounds) : item.bounds.clone(), null) :
    (window.currentMockup?.bounds?.clone?.() || null);
  if (!target || !target.width || !target.height) return null;
  const padding = 0.86;
  const zx = paper.view.viewSize.width / target.width * padding;
  const zy = paper.view.viewSize.height / target.height * padding;
  paper.view.zoom = Math.max(0.05, Math.min(zx, zy));
  paper.view.center = target.center;
  paper.view.update();
  return { zoom: paper.view.zoom, center: target.center.clone() };
};

window.toggleOutline = function() {
  const selected = Array.isArray(window.selectedItems) && window.selectedItems.length
    ? window.selectedItems : (window.selectedItem ? [window.selectedItem] : []);
  if (!selected.length) return null;
  selected.forEach(item => {
    const target = getPublicOwner(item);
    if (!target) return;
    if (target.__ekkoOutlineSnapshot) {
      const snap = target.__ekkoOutlineSnapshot;
      target.fillColor = snap.fillColor;
      target.strokeColor = snap.strokeColor;
      target.strokeWidth = snap.strokeWidth;
      delete target.__ekkoOutlineSnapshot;
    } else {
      target.__ekkoOutlineSnapshot = {
        fillColor: target.fillColor?.clone?.() || target.fillColor,
        strokeColor: target.strokeColor?.clone?.() || target.strokeColor,
        strokeWidth: target.strokeWidth
      };
      target.fillColor = null;
      target.strokeColor = new paper.Color("#334155");
      target.strokeWidth = Math.max(1 / (paper.view.zoom || 1), 0.5);
    }
  });
  paper.view.update();
};

// Saneamiento de variables y namespaces globales
window.EKKO_STUDIO_PRODUCTS = window.EKKO_STUDIO_PRODUCTS || [];
window.paperUnitsPerMm = window.paperUnitsPerMm || 1.0;
window.mmPerPaperUnit = window.mmPerPaperUnit || 1.0;
window.currentMockup = window.currentMockup || null;
window.grabArea = window.grabArea || null;
window.clipMask = window.clipMask || null;
// Legacy callers receive only the canonical public owner.
window.getContentItem = getPublicOwner;
window.infiniteCanvasMode = typeof window.infiniteCanvasMode !== 'undefined' ? window.infiniteCanvasMode : true;
window.selectedItems = window.selectedItems || [];
window.selectedItem = window.selectedItem || null;


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
    #editorCanvas.ekko-drop-active {
      outline: 2px solid rgba(56, 189, 248, 0.68) !important;
      outline-offset: -4px;
      filter: brightness(1.025);
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
// History is transaction-aware: nested Fusion/edit routes mark the current
// transaction dirty and only the owner commits one snapshot.
let historyTransaction = null;
function historyMatrixSnapshot(matrix) {
  if (!matrix) return null;
  return { a: Number(matrix.a) || 0, b: Number(matrix.b) || 0,
    c: Number(matrix.c) || 0, d: Number(matrix.d) || 0,
    tx: Number(matrix.tx) || 0, ty: Number(matrix.ty) || 0 };
}

function historyMatricesEqual(actual, expected, epsilon = 1e-7) {
  if (!actual || !expected) return false;
  return ["a", "b", "c", "d", "tx", "ty"].every(key =>
    Number.isFinite(Number(actual[key])) && Number.isFinite(Number(expected[key])) &&
    Math.abs(Number(actual[key]) - Number(expected[key])) <= epsilon);
}

function historyOwnerPath(owner) {
  const path = [];
  let current = owner;
  while (current && current !== (typeof paper !== "undefined" ? paper.project : null)) {
    path.unshift(Number.isFinite(current.index) ? current.index : null);
    current = current.parent;
  }
  return path;
}

function captureHistoryTransforms() {
  if (typeof paper === "undefined" || !paper.project) return [];
  const seen = new Set();
  const result = [];
  let items = [];
  try { items = paper.project.getItems({ match: () => true }) || []; } catch (_) {}
  items.forEach(item => {
    const owner = getHistorySelectionOwner(item);
    if (!owner || seen.has(owner) || !owner.project || !owner.parent) return;
    const data = owner.data || {};
    if (data.mockup || data.isMask || data.isSelectionBox || data.isMeasurement || owner.clipMask) return;
    seen.add(owner);
    const matrix = owner.globalMatrix || owner.matrix;
    if (!matrix) return;
    result.push({
      id: Number.isFinite(owner.id) ? owner.id : null,
      path: historyOwnerPath(owner),
      label: data.label || null,
      fusionId: data.fusionId || null,
      source: data.source || null,
      className: owner.className || null,
      isRaster: owner.className === "Raster",
      matrix: historyMatrixSnapshot(matrix),
      rotation: Number.isFinite(data.rotation) ? data.rotation : null
    });
  });
  return result;
}

function makeHistoryEntry(state = null, transforms = null) {
  if (typeof paper === "undefined" || !paper.project) return null;
  return {
    state: state || paper.project.exportJSON({ asString: true }),
    transforms: Array.isArray(transforms) ? transforms : captureHistoryTransforms(),
    selected: captureHistorySelection(),
    at: Date.now()
  };
}

function historyEntryState(entry) {
  return typeof entry === "string" ? entry : entry?.state || null;
}

function historyTransformScore(owner, descriptor) {
  if (!owner || !descriptor) return -1;
  const data = owner.data || {};
  let score = 0;
  if (descriptor.id != null && owner.id === descriptor.id) score += 1000;
  if (descriptor.fusionId && data.fusionId === descriptor.fusionId) score += 500;
  if (descriptor.label && data.label === descriptor.label) score += 100;
  if (descriptor.source && data.source === descriptor.source) score += 40;
  if (descriptor.className && owner.className === descriptor.className) score += 20;
  if (descriptor.isRaster && owner.className === "Raster") score += 10;
  const path = historyOwnerPath(owner);
  if (descriptor.path?.length && path.join("/") === descriptor.path.join("/")) score += 80;
  return score;
}

function findHistoryTransformOwner(descriptor) {
  if (!descriptor || typeof paper === "undefined" || !paper.project) return null;
  let items = [];
  try { items = paper.project.getItems({ match: () => true }) || []; } catch (_) {}
  const candidates = [];
  const seen = new Set();
  items.forEach(item => {
    const owner = getHistorySelectionOwner(item);
    if (!owner || seen.has(owner) || !owner.project || !owner.parent) return;
    seen.add(owner);
    const data = owner.data || {};
    if (data.mockup || data.isMask || data.isSelectionBox || data.isMeasurement || owner.clipMask) return;
    const score = historyTransformScore(owner, descriptor);
    if (score > 0) candidates.push({ owner, score });
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.owner || null;
}

function restoreHistoryTransforms(transforms) {
  if (!Array.isArray(transforms) || !transforms.length) return { restored: 0, requested: 0, exact: true };
  let restored = 0;
  let exact = true;
  transforms.forEach(descriptor => {
    const owner = findHistoryTransformOwner(descriptor);
    const raw = descriptor?.matrix;
    if (!owner || !raw) { exact = false; return; }
    try {
      const desired = new paper.Matrix(raw.a, raw.b, raw.c, raw.d, raw.tx, raw.ty);
      owner.applyMatrix = false;
      const parentMatrix = owner.parent?.globalMatrix || new paper.Matrix();
      owner.matrix = parentMatrix.inverted().concatenate(desired);
      const actual = owner.globalMatrix || owner.matrix;
      const matched = historyMatricesEqual(actual, raw);
      if (!matched) { exact = false; return; }
      if (Number.isFinite(descriptor.rotation)) {
        owner.data = { ...(owner.data || {}), rotation: descriptor.rotation };
      }
      restored++;
    } catch (_) { exact = false; }
  });
  window._ekkoHistoryTransformRestore = { restored, requested: transforms.length, exact, at: Date.now() };
  return { restored, requested: transforms.length, exact };
}

// Transform transactions are matrix-authoritative. Importing JSON for a pure
// rotate/translate/scale operation rehydrates the document and can leave
// rendered child geometry at the post-transform angle while the new public
// owner reports the pre-transform metadata. Restore the matrices on the live
// owners instead; this keeps Paper identities, raster pixels, fusion records,
// selection, and measurement overlays in one scene.
function restoreTransformHistoryInPlace(entry, selectionDescriptors, phase) {
  if (!entry?.transformOnly || !Array.isArray(entry.transforms) || !entry.transforms.length) {
    return false;
  }
  const result = restoreHistoryTransforms(entry.transforms);
  if (!result.exact || result.restored !== result.requested) return false;
  if (typeof recalculateDynamicSubtractions === "function") recalculateDynamicSubtractions();
  const restored = restoreHistorySelection(selectionDescriptors);
  if (!restored) {
    window.EKKO_ROTATION_CONTROLLER?.syncSelection?.(null);
    window.updateSelectionInfo?.();
    window.clearMeasurements?.();
  }
  if (typeof window.EKKO_FUSION_CONTROLLER?.assertFusionRegistryState === "function") {
    window.EKKO_FUSION_CONTROLLER.assertFusionRegistryState(phase);
  }
  paper.view.update();
  window._ekkoHistoryRestoreMode = { phase, mode: "in-place-transform", exact: true, at: Date.now() };
  window.EKKO_TRANSFORM_TRACE?.boundary("after-restore", {
    phase, mode: "in-place-transform", restore: result, historyEntry: entry
  });
  return true;
}

function writeHistorySnapshot() {
  if (typeof paper !== "undefined" && paper.project) {
    const entry = makeHistoryEntry();
    if (entry) undoStack.push(entry);
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
  }
}
function saveHistory() {
  if (historyTransaction?.active) {
    historyTransaction.dirty = true;
    historyTransaction.lastMutationAt = Date.now();
    window._ekkoHistoryTransaction = { ...historyTransaction, status: "dirty" };
    return false;
  }
  writeHistorySnapshot();
  window._ekkoHistoryTransaction = { active: false, status: "committed", label: "direct-save", at: Date.now() };
  return true;
}
function beginHistoryTransaction(label = "operation") {
  if (!historyTransaction?.active) {
    historyTransaction = { active: true, label, dirty: false, startedAt: Date.now(),
      beforeState: (typeof paper !== "undefined" && paper.project)
        ? paper.project.exportJSON({ asString: true }) : null,
      beforeTransforms: captureHistoryTransforms(),
      beforeSelection: captureHistorySelection() };
    window._ekkoHistoryTransaction = { ...historyTransaction, beforeState: undefined, status: "open" };
  }
  return historyTransaction;
}
function commitHistoryTransaction(label = null) {
  if (!historyTransaction?.active) return false;
  const tx = historyTransaction;
  if (tx.dirty && tx.beforeState) {
    const transformOnly = /^transform(?::|$)/.test(String(tx.label || ""));
    undoStack.push({ state: tx.beforeState, transforms: tx.beforeTransforms || [],
      selected: tx.beforeSelection || [],
      transformOnly, label: tx.label || label || null, at: Date.now() });
    if (undoStack.length > 50) undoStack.shift();
    redoStack.length = 0;
  }
  historyTransaction = null;
  window._ekkoHistoryTransaction = { active: false, status: tx.dirty ? "committed" : "empty", label: label || tx.label, at: Date.now() };
  return tx.dirty;
}
function cancelHistoryTransaction(reason = "cancelled") {
  const tx = historyTransaction;
  historyTransaction = null;
  window._ekkoHistoryTransaction = { active: false, status: "cancelled", label: tx?.label || null, reason, at: Date.now() };
  return tx;
}
window.saveHistory = saveHistory;
window.beginHistoryTransaction = beginHistoryTransaction;
window.commitHistoryTransaction = commitHistoryTransaction;
window.cancelHistoryTransaction = cancelHistoryTransaction;

function cleanGhostInterfaceItems() {
  if (typeof paper !== "undefined" && paper.project) {
    paper.project.getItems({
      match: function(item) {
        return item.data && (
          item.data.isSelectionBox ||
          item.data.isHandle ||
          item.data.isNodeHandle ||
          item.data.isCurveHandle ||
          item.data.isMeasurement
        );
      }
    }).forEach(function(item) {
      item.remove();
    });
  }
}

function getHistorySelectionOwner(item) {
  if (!item) return null;
  try {
    return window.EKKO_ROTATION_CONTROLLER?.resolveOwner?.(item)
      || window.EKKO_FUSION_CONTROLLER?.resolvePublicTransformOwner?.(item)
      || item;
  } catch (e) {
    return item;
  }
}

// exportJSON/importJSON rehydrates Paper items with new runtime identities. Keep
// the semantic identity of the public selection so Redo can restore the same
// owner instead of leaving the controls bound to a removed pre-import object.
function captureHistorySelection() {
  const entries = (Array.isArray(window.selectedItems) && window.selectedItems.length)
    ? window.selectedItems
    : (window.selectedItem ? [window.selectedItem] : []);
  const seen = new Set();
  return entries.map(getHistorySelectionOwner).filter(owner => {
    if (!owner || seen.has(owner)) return false;
    seen.add(owner);
    return true;
  }).map(owner => {
    const data = owner.data || {};
    return {
      label: data.label || null,
      fusionId: data.fusionId || null,
      semanticId: data.semanticId || null,
      containmentKey: data.containmentKey || null,
      containmentScope: data.containmentScope || null,
      ownerContainmentKey: data.ownerContainmentKey || null,
      sourceContourIndex: data.sourceContourIndex ?? null,
      semanticKind: data.semanticKind || null,
      isHole: data.isHole === true,
      originalIsHole: data.originalIsHole === true,
      source: data.source || null,
      className: owner.className || null,
      isRaster: owner.className === "Raster"
    };
  });
}

function historySelectionScore(owner, descriptor) {
  if (!owner || !descriptor) return -1;
  const data = owner.data || {};
  let score = 0;
  if (descriptor.fusionId && data.fusionId === descriptor.fusionId) score += 100;
  if (descriptor.semanticId && data.semanticId === descriptor.semanticId) score += 95;
  if (descriptor.containmentKey && data.containmentKey === descriptor.containmentKey) score += 90;
  if (descriptor.ownerContainmentKey && data.ownerContainmentKey === descriptor.ownerContainmentKey) score += 80;
  if (descriptor.sourceContourIndex != null && data.sourceContourIndex === descriptor.sourceContourIndex) score += 70;
  if (descriptor.semanticKind && data.semanticKind === descriptor.semanticKind) score += 35;
  if (descriptor.isHole === (data.isHole === true)) score += 25;
  if (descriptor.originalIsHole === (data.originalIsHole === true)) score += 20;
  if (descriptor.label && data.label === descriptor.label) score += 50;
  if (descriptor.source && data.source === descriptor.source) score += 20;
  if (descriptor.className && owner.className === descriptor.className) score += 10;
  if (descriptor.isRaster && owner.className === "Raster") score += 5;
  return score;
}

function findHistorySelectionOwner(descriptor) {
  if (!descriptor || typeof paper === "undefined" || !paper.project) return null;
  let items = [];
  try {
    items = paper.project.getItems({ match: () => true }) || [];
  } catch (e) {
    items = [];
  }
  const candidates = [];
  const seen = new Set();
  items.forEach(item => {
    const owner = getHistorySelectionOwner(item);
    if (!owner || !owner.project || !owner.parent || seen.has(owner)) return;
    seen.add(owner);
    const data = owner.data || {};
    if (data.mockup || data.isMask || data.isSelectionBox || data.isMeasurement || owner.clipMask) return;
    const score = historySelectionScore(owner, descriptor);
    if (score > 0) candidates.push({ owner, score });
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0]?.owner || null;
}

function restoreHistorySelection(descriptors) {
  const list = Array.isArray(descriptors) ? descriptors : [];
  if (!list.length) return false;
  const owners = list.map(findHistorySelectionOwner).filter(Boolean);
  if (!owners.length) return false;
  window.deselectItem?.();
  owners.forEach((owner, index) => window.selectItem?.(owner, index > 0));
  const primary = owners[owners.length - 1];
  window.EKKO_ROTATION_CONTROLLER?.syncSelection?.(primary);
  window.updateSelectionInfo?.();
  window.drawMeasurements?.();
  window._ekkoHistorySelectionRestore = {
    restored: owners.length,
    requested: list.length,
    owners: owners.map(owner => ({
      label: owner.data?.label || null,
      fusionId: owner.data?.fusionId || null,
      className: owner.className || null
    })),
    at: Date.now()
  };
  return true;
}

function importHistoryEntry(entry) {
  const state = historyEntryState(entry);
  if (!state || typeof paper === "undefined" || !paper.project) return false;
  resetSceneRuntimeState();
  paper.project.clear();
  paper.project.importJSON(state);
  cleanGhostInterfaceItems();
  rehydrateSceneRuntime();
  // Paper.js re-creates item identities on import and may restore a Raster
  // with its serialized geometry but without the runtime owner contract.
  // Restore the canonical world matrix only after mockup/fusion rehydration so
  // the public owner, its raster and every measurement use the same geometry.
  restoreHistoryTransforms(entry?.transforms || []);
  if (typeof recalculateDynamicSubtractions === "function") {
    const designLayer = paper.project?.layers?.find(layer => layer?.name === 'designLayer') || null;
    recalculateDynamicSubtractions(designLayer);
  }
  return true;
}

function finishHistoryImport(selectionDescriptors, phase, historyEntry = null) {
  const restored = restoreHistorySelection(selectionDescriptors);
  if (!restored) {
    window.EKKO_ROTATION_CONTROLLER?.syncSelection?.(null);
    window.updateSelectionInfo?.();
    window.clearMeasurements?.();
  }
  if (typeof window.EKKO_FUSION_CONTROLLER?.assertFusionRegistryState === "function") {
    window.EKKO_FUSION_CONTROLLER.assertFusionRegistryState(phase);
  }
  paper.view.update();
  window.EKKO_TRANSFORM_TRACE?.boundary("after-restore", {
    phase, mode: "json-rehydrate", restored, historyEntry
  });
  return restored;
}

function undo() {
  window.EKKO_TRANSFORM_TRACE?.boundary("undo-entry", {
    phase: "undo", undoDepth: undoStack.length, redoDepth: redoStack.length,
    selected: captureHistorySelection()
  });
  cancelHistoryTransaction("undo");
  if (undoStack.length === 0) {
    window.EKKO_TRANSFORM_TRACE?.boundary("undo-exit", { phase: "undo", status: "empty" });
    return;
  }
  const selectionBeforeUndo = captureHistorySelection();
  window._ekkoHistorySelection = selectionBeforeUndo;
  // The opposite history entry must retain the transaction kind. A plain
  // makeHistoryEntry() has no transformOnly flag, so Redo would otherwise
  // fall through to JSON rehydration even when Undo used the live-owner path.
  const entry = undoStack.pop();
  const current = makeHistoryEntry();
  if (current) {
    current.transformOnly = entry?.transformOnly === true;
    current.label = entry?.label || null;
    redoStack.push(current);
  }
  window.EKKO_TRANSFORM_TRACE?.boundary("undo-target", {
    phase: "undo", historyEntry: entry, currentEntry: current,
    undoDepth: undoStack.length, redoDepth: redoStack.length
  });
  const targetSelection = Array.isArray(entry?.selected) ? entry.selected : selectionBeforeUndo;
  if (restoreTransformHistoryInPlace(entry, targetSelection, "undo")) {
    window.EKKO_TRANSFORM_TRACE?.boundary("undo-exit", { phase: "undo", status: "restored-in-place", historyEntry: entry });
    return;
  }
  if (!importHistoryEntry(entry)) {
    window.EKKO_TRANSFORM_TRACE?.boundary("undo-exit", { phase: "undo", status: "restore-failed", historyEntry: entry });
    return;
  }
  // Non-transform edits still use the JSON document snapshot. Transform
  // transactions use the live-owner path above so matrix and rendered geometry
  // cannot diverge after rehydration.
  finishHistoryImport(targetSelection, "undo", entry);
  window.EKKO_TRANSFORM_TRACE?.boundary("undo-exit", { phase: "undo", status: "json-rehydrate", historyEntry: entry });
}
window.undo = undo;

function redo() {
  window.EKKO_TRANSFORM_TRACE?.boundary("redo-entry", {
    phase: "redo", undoDepth: undoStack.length, redoDepth: redoStack.length,
    selected: captureHistorySelection()
  });
  cancelHistoryTransaction("redo");
  if (redoStack.length === 0) {
    window.EKKO_TRANSFORM_TRACE?.boundary("redo-exit", { phase: "redo", status: "empty" });
    return;
  }
  const currentSelection = captureHistorySelection();
  const selectionBeforeRedo = currentSelection.length
    ? currentSelection
    : (Array.isArray(window._ekkoHistorySelection) ? window._ekkoHistorySelection : []);
  // Mirror the target metadata when moving the current state to Undo. This
  // keeps repeated Undo/Redo cycles on the same in-place transform route.
  const entry = redoStack.pop();
  const current = makeHistoryEntry();
  if (current) {
    current.transformOnly = entry?.transformOnly === true;
    current.label = entry?.label || null;
    undoStack.push(current);
  }
  window.EKKO_TRANSFORM_TRACE?.boundary("redo-target", {
    phase: "redo", historyEntry: entry, currentEntry: current,
    undoDepth: undoStack.length, redoDepth: redoStack.length
  });
  const targetSelection = Array.isArray(entry?.selected) ? entry.selected : selectionBeforeRedo;
  if (restoreTransformHistoryInPlace(entry, targetSelection, "redo")) {
    window.EKKO_TRANSFORM_TRACE?.boundary("redo-exit", { phase: "redo", status: "restored-in-place", historyEntry: entry });
    return;
  }
  if (!importHistoryEntry(entry)) {
    window.EKKO_TRANSFORM_TRACE?.boundary("redo-exit", { phase: "redo", status: "restore-failed", historyEntry: entry });
    return;
  }
  // The redo entry carries the public owner matrix. Re-selecting after import
  // remains the fallback for non-transform document edits.
  finishHistoryImport(targetSelection, "redo", entry);
  window.EKKO_TRANSFORM_TRACE?.boundary("redo-exit", { phase: "redo", status: "json-rehydrate", historyEntry: entry });
}
window.redo = redo;

function isLockedItem(item) {
  return !!(item && item.data && item.data.locked === true);
}
window.isLockedItem = isLockedItem;

// Limpia referencias de runtime que no forman parte de exportJSON/importJSON.
function resetSceneRuntimeState() {
  // Measurement groups are transient Paper items and must not survive a
  // history import as document content or be mistaken for a public owner.
  window.clearMeasurements?.();
  if (window.fusionEditActive && typeof window.exitFusionEditMode === 'function') {
    try { window.exitFusionEditMode(false); } catch (e) {}
  }
  if (window.selectionBoxGroup) { try { window.selectionBoxGroup.remove(); } catch (e) {} }
  if (window.marqueePath) { try { window.marqueePath.remove(); } catch (e) {} }
  if (window.nodeHandlesGroup) { try { window.nodeHandlesGroup.remove(); } catch (e) {} }
  if (window.distributionGuidesGroup) { try { window.distributionGuidesGroup.remove(); } catch (e) {} }
  window.selectionBoxGroup = null;
  window.marqueePath = null;
  window.nodeHandlesGroup = null;
  window.distributionGuidesGroup = null;
  window.marqueeActive = false;
  window.dragging = false;
  window.resizeActive = false;
  if (window.EKKO_ROTATION_CONTROLLER?.cancelPointer) window.EKKO_ROTATION_CONTROLLER.cancelPointer();
  window.rotationActive = false;
  window.fusionEditActive = false;
  window._fusionEditState = null;
  window.EKKO_INTERACTION?.release();
  window.selectedItem = null;
  window.selectedItems = [];
  try { paper?.project?.deselectAll?.(); } catch (e) {}
  if (typeof window.EKKO_FUSION_CONTROLLER?.clearFusionRuntime === 'function') {
    window.EKKO_FUSION_CONTROLLER.clearFusionRuntime();
  }
}

function rehydrateSceneRuntime() {
  if (typeof restoreMockupReferences === 'function') restoreMockupReferences();
  if (typeof window.EKKO_FUSION_CONTROLLER?.rebuildFusionRegistry === 'function') {
    window.EKKO_FUSION_CONTROLLER.rebuildFusionRegistry();
  }
  const designLayer = paper.project?.layers?.find(layer => layer?.name === 'designLayer') || null;
  designLayer?.children?.forEach(initGeomBaseRecursive);
  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions(designLayer);
  }
  if (typeof window.EKKO_FUSION_CONTROLLER?.assertFusionRegistryState === "function") {
    window.EKKO_FUSION_CONTROLLER.assertFusionRegistryState("rehydrate");
  }
}
window.resetSceneRuntimeState = resetSceneRuntimeState;
window.rehydrateSceneRuntime = rehydrateSceneRuntime;

// Sincronizador en mm para UI y cotas
function updateSelectionInfo() {
  if (!window.selectedItem) {
    const selInfo = document.getElementById("selectionInfo");
    const objW = document.getElementById("objWidth");
    const objH = document.getElementById("objHeight");
    if (selInfo) {
      const active = window.EKKO_ACTIVE_PRODUCT;
      selInfo.textContent = active
        ? `${active.name} — ${active.surface}`
        : "Nada seleccionado";
    }
    if (objW) objW.value = "";
    if (objH) objH.value = "";
    return;
  }
  const displayItem = getPublicOwner(window.selectedItem);
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

// La selección pública pertenece exclusivamente a selection.js.
// editor.js no redefine window.selectItem ni window.deselectItem: todos los
// comandos del editor delegan en la API central instalada por selection.js.

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
  const prevSelectedItems = Array.isArray(window.selectedItems) ? [...window.selectedItems] : [];
  if (prevSelected || prevSelectedItems.length) {
    window.deselectItem();
  }
  sceneStates[key] = paper.project.exportJSON({ asString: true });
  if (prevSelectedItems.length && typeof window.selectItem === 'function') {
    prevSelectedItems.forEach((item, index) => window.selectItem(item, index > 0));
  } else if (prevSelected && typeof window.selectItem === 'function') {
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
  window.EKKO_ACTIVE_PRODUCT = {
    name: product.nombre || product.id || "Producto",
    surface: surface.nombre || "Superficie"
  };
  if (sceneStates[key]) {
    resetSceneRuntimeState();
    paper.project.clear();
    paper.project.importJSON(sceneStates[key]);
    cleanGhostInterfaceItems();
    if (window.selectedItem || (window.selectedItems && window.selectedItems.length > 0)) {
      window.deselectItem();
    }
    rehydrateSceneRuntime();
    if (typeof window.updateGlobalScaleFactor === "function") window.updateGlobalScaleFactor();
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
  if (clone.data?.isSmartFusion || clone.getItems?.({ match: item => item.data?.isSmartFusion }).length) {
    if (typeof window.EKKO_FUSION_CONTROLLER?.rekeyFusionClone === 'function') {
      window.EKKO_FUSION_CONTROLLER.rekeyFusionClone(clone);
    }
  }
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
  const contentA = getPublicOwner(itemA);
  const contentB = getPublicOwner(itemB);
  if (!contentA || !contentB) return false;
  let geomA = null;
  let geomB = null;
  let overlap = null;
  try {
    geomA = getGlobalUnsubtractedPath(contentA);
    geomB = getGlobalUnsubtractedPath(contentB);
    if (!geomA?.bounds || !geomB?.bounds || !geomA.bounds.intersects(geomB.bounds)) return false;
    overlap = geomA.intersect(geomB, { insert: false });
    if (Math.abs(overlap?.area || 0) > 1e-7) return true;
    if (geomA.contains?.(geomB.bounds.center) || geomB.contains?.(geomA.bounds.center)) return true;
    return false;
  } catch (e) {
    return false;
  } finally {
    try { overlap?.remove?.(); } catch (_) {}
    try { geomA?.remove?.(); } catch (_) {}
    try { geomB?.remove?.(); } catch (_) {}
  }
}

function getSelectedStackingUnits() {
  const selected = Array.isArray(window.selectedItems) && window.selectedItems.length
    ? window.selectedItems
    : (window.selectedItem ? [window.selectedItem] : []);
  const result = [];
  const seen = new Set();
  selected.forEach(item => {
    const unit = getStackingUnit(item) || item;
    if (!unit || seen.has(unit) || isLockedItem(unit)) return;
    seen.add(unit);
    result.push(unit);
  });
  return result;
}

/**
 * Reorders the complete current selection as a block.  Decomposition leaves
 * every public solid/hole selected at once; moving only selectedItem would
 * split a stacking unit and change the relative order of a physical hole and
 * its solid.  Rebuilding the sibling list keeps all selected units together
 * and preserves their order for front/back and one-step forward/back moves.
 */
function reorderSelectedStackingUnits(direction) {
  const units = getSelectedStackingUnits();
  if (!units.length) return null;
  const byParent = new Map();
  units.forEach(unit => {
    const parent = unit.parent || (paper.project && paper.project.activeLayer);
    if (!parent?.children) return;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(unit);
  });
  byParent.forEach((selectedUnits, parent) => {
    const children = Array.from(parent.children);
    const selectedSet = new Set(selectedUnits);
    const ordered = children.filter(child => selectedSet.has(child));
    if (!ordered.length) return;
    const eligible = child => child && !selectedSet.has(child) && !isMockupOrUIItem(child);
    let insertionIndex = null;
    if (direction === 'front') {
      const remaining = children.filter(child => !selectedSet.has(child));
      insertionIndex = remaining.length;
      const rebuilt = remaining.slice(0, insertionIndex).concat(ordered);
      rebuilt.forEach((child, index) => parent.insertChild(index, child));
      return;
    }
    if (direction === 'back') {
      const remaining = children.filter(child => !selectedSet.has(child));
      const rebuilt = ordered.concat(remaining);
      rebuilt.forEach((child, index) => parent.insertChild(index, child));
      return;
    }
    if (direction === 'forward') {
      const lastIndex = Math.max(...children.map((child, index) => selectedSet.has(child) ? index : -1));
      const target = children.slice(lastIndex + 1).find(eligible);
      if (!target) return;
      const remaining = children.filter(child => !selectedSet.has(child));
      insertionIndex = remaining.indexOf(target) + 1;
      remaining.splice(insertionIndex, 0, ...ordered);
      remaining.forEach((child, index) => parent.insertChild(index, child));
      return;
    }
    if (direction === 'backward') {
      const firstIndex = Math.min(...children.map((child, index) => selectedSet.has(child) ? index : Number.MAX_SAFE_INTEGER));
      const target = children.slice(0, firstIndex).reverse().find(eligible);
      if (!target) return;
      const remaining = children.filter(child => !selectedSet.has(child));
      insertionIndex = remaining.indexOf(target);
      remaining.splice(insertionIndex, 0, ...ordered);
      remaining.forEach((child, index) => parent.insertChild(index, child));
    }
  });
  return units[units.length - 1] || units[0];
}

function finishZOrderChange(item) {
  if (window.currentMockup) {
    window.currentMockup.bringToFront();
  }
  if (typeof recalculateDynamicSubtractions === 'function') {
    recalculateDynamicSubtractions(item?.layer || null);
  }
  if (typeof window.updateSelectionBox === 'function') {
    window.updateSelectionBox(item || window.selectedItem);
  }
  paper.view.update();
}

function bringFront() {
  const item = getSelectedStackingUnits()[0];
  if (!item) return;
  if (typeof saveHistory === 'function') saveHistory();
  reorderSelectedStackingUnits('front');
  finishZOrderChange(item);
}
window.bringFront = bringFront;

function sendBack() {
  const item = getSelectedStackingUnits()[0];
  if (!item) return;
  if (typeof saveHistory === 'function') saveHistory();
  reorderSelectedStackingUnits('back');
  finishZOrderChange(item);
}
window.sendBack = sendBack;

function bringForward() {
  const item = getSelectedStackingUnits()[0];
  if (!item) return;
  if (typeof saveHistory === 'function') saveHistory();
  reorderSelectedStackingUnits('forward');
  finishZOrderChange(item);
}
window.bringForward = bringForward;

function sendBackward() {
  const item = getSelectedStackingUnits()[0];
  if (!item) return;
  if (typeof saveHistory === 'function') saveHistory();
  reorderSelectedStackingUnits('backward');
  finishZOrderChange(item);
}
window.sendBackward = sendBackward;

// Helper para inicializar geomBase recursivamente en geometrias importadas
function initGeomBaseRecursive(item) {
  if (!item || isMockupOrMask(item) || isContainmentWrapper(item)) {
    // A wrapper can contain a public child; normalize that child explicitly.
    item?.children?.forEach(initGeomBaseRecursive);
    return;
  }
  const owner = getPublicOwner(item);
  if (owner === item && (item instanceof paper.Path || item instanceof paper.CompoundPath)) {
    item.data = item.data || {};
    let old = item.data.geomBase;
    // Paper JSON can restore data.geomBase as a plain object. Revive only from
    // the canonical detached path data; never promote already-subtracted
    // visible children into a new base.
    if (old && typeof old.clone !== 'function' && item.data.geomBasePathData) {
      try {
        old = new paper.CompoundPath({ insert: false, pathData: item.data.geomBasePathData });
        item.data.geomBase = old;
      } catch (_) {
        item.data.geomBase = null;
      }
    }
    if (!old) item.data.geomBase = getOwnerLocalGeometry(item);
    else if (typeof old.clone === 'function') {
      const normalized = old.clone({ insert: false });
      const matrix = normalized.matrix?.clone?.();
      normalized.applyMatrix = false; normalized.matrix = new paper.Matrix();
      if (matrix && !matrix.isIdentity()) normalized.transform(matrix);
      normalized.applyMatrix = false; normalized.matrix = new paper.Matrix();
      item.data.geomBase = normalized;
    }
    if (item.data.geomBase) {
      item.data.geomBase.applyMatrix = false;
      item.data.geomBase.matrix = new paper.Matrix();
      if (!item.data.geomBasePathData && item.data.geomBase.pathData) {
        item.data.geomBasePathData = item.data.geomBase.pathData;
      }
    }
  }
  item.children?.forEach(initGeomBaseRecursive);
}

// Carga de Archivos e Importación
//
// The second argument is intentionally optional. Existing picker callers can
// continue passing only File; drag/drop may pass a Paper.js Point or the
// richer { point, history } options object.
function normalizeImportOptions(pointOrOptions) {
  const options = pointOrOptions && typeof pointOrOptions === "object" &&
    Object.prototype.hasOwnProperty.call(pointOrOptions, "point")
    ? pointOrOptions : { point: pointOrOptions };
  const point = options.point;
  const validPoint = point && typeof point.x === "number" && typeof point.y === "number"
    ? new paper.Point(point.x, point.y) : null;
  return { point: validPoint, history: options.history !== false, diagnostic: options.diagnostic === true };
}

function importTargetPoint(point, area) {
  return point ? point.clone() : area.center.clone();
}

function reportImportError(kind, file, error, options = {}) {
  const label = file?.name || "(sin nombre)";
  const details = { source: "asset-import", kind, file: label, error: String(error?.message || error || "unknown") };
  console.error(`[EKKO ${kind.toUpperCase()} IMPORT] Error al importar '${label}'.`, error || "unknown");
  if (options.diagnostic !== false) emitAssetDropDiagnostic("error", details);
}

export function addImageFromFile(file, pointOrOptions = null) {
  if (!file) return Promise.resolve(null);
  const options = normalizeImportOptions(pointOrOptions);
  // Picker imports retain their original one-snapshot behavior. Drop imports
  // disable this local snapshot and commit one transaction in drop order.
  if (options.history) saveHistory();

  return new Promise((resolve) => {
    const reader = new FileReader();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value || null);
    };
    reader.onload = (e) => {
      try {
        const raster = new paper.Raster({ source: e.target.result });
        raster.onLoad = () => {
          try {
            if (window.paper && paper.project) {
              const dLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
              if (dLayer) dLayer.activate();
            }
            raster.data = { locked: false, label: file.name };
            const area = (window.currentMockup && window.currentMockup.bounds)
              ? window.currentMockup.bounds : paper.view.bounds;
            const size = Math.min(area.width, area.height) * 0.5;
            if (raster.width > 0) raster.scale(size / raster.width);
            raster.position = importTargetPoint(options.point, area);
            const objeto = window.clipItem ? window.clipItem(raster) : raster;
            if (window.currentMockup) objeto.insertBelow(window.currentMockup);
            window.selectItem(objeto);
            paper.view.update();
            finish(objeto);
          } catch (error) {
            reportImportError("image", file, error, options);
            finish(null);
          }
        };
      } catch (error) {
        reportImportError("image", file, error, options);
        finish(null);
      }
    };
    reader.onerror = (error) => {
      reportImportError("image", file, error, options);
      finish(null);
    };
    try {
      reader.readAsDataURL(file);
    } catch (error) {
      reportImportError("image", file, error, options);
      finish(null);
    }
  });
}
window.addImageFromFile = addImageFromFile;

export function addSVGFromFile(file, pointOrOptions = null) {
  if (!file) return Promise.resolve(null);
  const options = normalizeImportOptions(pointOrOptions);
  if (options.history) saveHistory();

  return new Promise((resolve) => {
    const reader = new FileReader();
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value || null);
    };
    reader.onload = (e) => {
      const svgText = e.target.result;
      if (!svgText || typeof svgText !== 'string' || svgText.trim() === '') {
        reportImportError("svg", file, "empty-or-corrupt-file", options);
        finish(null);
        return;
      }

      try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(svgText, "image/svg+xml");
        const parserError = xmlDoc.querySelector("parsererror");
        if (parserError) {
          reportImportError("svg", file, "malformed-svg-xml", options, parserError.textContent || "parsererror");
          finish(null);
          return;
        }
      } catch (error) {
        console.error("[EKKO SVG IMPORT ERROR] Fallo al sanear XML:", error);
      }

      try {
        if (window.paper && paper.project) {
          const designLayer = getCanonicalDesignLayer();
          if (!designLayer) {
            reportImportError("svg", file, "missing-design-layer", options);
            finish(null);
            return;
          }
          designLayer.activate();
        }

        paper.project.importSVG(svgText, (item) => {
          try {
            if (!item) {
              reportImportError("svg", file, "paper-import-returned-empty-item", options);
              finish(null);
              return;
            }

          const cleanLabel = file.name ? file.name.replace(/\.svg$/i, "") : "SVG Importado";
          // Capture source fill semantics before clipping or decomposition.  In
          // particular, 008.svg is one nonzero path with 502 closed contours;
          // depth parity alone misclassifies its same-winding islands.
          const sourceSemantics = stampClientSvgSourceSemantics(item, svgText);
          item.data = {
            ...(item.data || {}),
            locked: false,
            label: cleanLabel,
            source: "client-svg",
            userImported: true,
            originalFillRule: sourceSemantics.sourceFillRule,
            sourceFillRuleExplicit: sourceSemantics.sourceFillRuleExplicit
          };
          const targetArea = (window.currentMockup && window.currentMockup.bounds && window.currentMockup.bounds.width > 0)
            ? window.currentMockup.bounds : paper.view.bounds;
          const itemBounds = item.bounds;
          if (itemBounds && itemBounds.width > 0 && itemBounds.height > 0) {
            const maxSpan = Math.min(targetArea.width, targetArea.height) * 0.5;
            const currentSpan = Math.max(itemBounds.width, itemBounds.height);
            if (currentSpan > 0 && maxSpan > 0) item.scale(maxSpan / currentSpan);
          }

          // Picker imports remain centered; drops use the actual project point.
          item.position = importTargetPoint(options.point, targetArea);

          function sanitizeAndBakeVectors(node) {
            if (!node) return;
            if (node instanceof paper.Path || node instanceof paper.CompoundPath) {
              node.visible = true;
              node.opacity = 1.0;
              if (node.strokeColor) {
                node.strokeScaling = false;
                if (!node.strokeWidth || node.strokeWidth < 1.0) node.strokeWidth = 1.2;
              } else if (!node.fillColor) {
                node.fillColor = new paper.Color('#111827');
              }
            }
            if (node.children && node.children.length > 0) node.children.forEach(sanitizeAndBakeVectors);
          }
          sanitizeAndBakeVectors(item);
          item.applyMatrix = false;
          initGeomBaseRecursive(item);

          let finalItem = item;
          if (typeof window.clipItem === 'function' && !window.infiniteCanvasMode && window.clipMask) {
            finalItem = window.clipItem(item);
          } else if (paper.project && paper.project.activeLayer) {
            paper.project.activeLayer.addChild(item);
          }
          if (window.currentMockup && finalItem) finalItem.insertBelow(window.currentMockup);
          if (typeof recalculateDynamicSubtractions === 'function') recalculateDynamicSubtractions();
          window.selectItem(finalItem);
          paper.view.update();
            console.log(`%c[EKKO SVG IMPORT] SVG '${cleanLabel}' importado, escalado y dinamizado con exito.`, 'color: #10b981; font-weight: bold;');
            finish(finalItem);
          } catch (error) {
            reportImportError("svg", file, error, options);
            finish(null);
          }
        });
      } catch (error) {
        reportImportError("svg", file, error, options);
        finish(null);
      }
    };
    reader.onerror = (error) => {
      reportImportError("svg", file, error, options);
      finish(null);
    };
    try {
      reader.readAsText(file);
    } catch (error) {
      reportImportError("svg", file, error, options);
      finish(null);
    }
  });
}
window.addSVGFromFile = addSVGFromFile;

// ============================================================================
// DEV/TEST-ONLY RUNTIME FIXTURES
// Explicit opt-in: ?runtimeFixture=afa|image|all. Nothing is fetched or
// imported in normal sessions. Add &runtimeFixtureAuto=1 only when an
// automated controlled-browser cycle is desired; otherwise call
// window.EKKO_RUNTIME_FIXTURE.run("afa"|"image"|"all") manually.
// This deliberately calls the canonical import functions above and never
// synthesizes a DataTransfer or installs picker/drag/drop listeners.
// ============================================================================
const runtimeFixtureParams = typeof window !== "undefined" && window.location
  ? new URLSearchParams(window.location.search)
  : new URLSearchParams();
const runtimeFixtureRequested = String(runtimeFixtureParams.get("runtimeFixture") || "")
  .trim().toLowerCase();
const runtimeFixtureModeEnabled = ["afa", "image", "all"].includes(runtimeFixtureRequested);
const runtimeFixtureState = {
  version: 1,
  enabled: runtimeFixtureModeEnabled,
  requested: runtimeFixtureModeEnabled ? runtimeFixtureRequested : null,
  auto: runtimeFixtureModeEnabled && runtimeFixtureParams.get("runtimeFixtureAuto") === "1",
  ready: false,
  running: false,
  source: "runtime-fixture",
  runs: [],
  last: null
};
let runtimeFixtureReadyResolve;
const runtimeFixtureReady = new Promise(resolve => { runtimeFixtureReadyResolve = resolve; });

function runtimeFixtureEvent(type, details = {}) {
  const payload = { source: "runtime-fixture", fixture: true, ...details };
  try { window.EKKO_DIAG?.logEvent?.(`runtime.fixture.${type}`, payload); } catch (_) {}
  try { window.EKKO_RUNTIME_PROBE?.record?.(`runtime.fixture.${type}`, payload); } catch (_) {}
  return payload;
}

function markRuntimeFixtureReady() {
  if (runtimeFixtureState.ready) return;
  runtimeFixtureState.ready = true;
  runtimeFixtureEvent("ready", { requested: runtimeFixtureState.requested, auto: runtimeFixtureState.auto });
  runtimeFixtureReadyResolve(true);
}

async function fetchRuntimeFixtureFile(spec) {
  const attempts = [];
  for (const path of spec.paths) {
    const url = new URL(path, window.location.origin).href;
    try {
      const response = await fetch(url, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store"
      });
      attempts.push({ path, status: response.status, ok: response.ok });
      if (!response.ok) continue;
      const blob = await response.blob();
      const type = spec.type || blob.type || "application/octet-stream";
      const file = typeof File === "function"
        ? new File([blob], spec.name, { type, lastModified: 0 })
        : (() => {
            const fallback = new Blob([blob], { type });
            Object.defineProperty(fallback, "name", { value: spec.name });
            return fallback;
          })();
      runtimeFixtureEvent("fetch", {
        kind: spec.kind,
        path,
        file: spec.name,
        bytes: blob.size,
        status: response.status
      });
      return { file, path, bytes: blob.size, attempts };
    } catch (error) {
      attempts.push({ path, error: String(error?.message || error) });
    }
  }
  const error = new Error(`fixture-not-found:${spec.kind}`);
  error.attempts = attempts;
  throw error;
}

function runtimeFixturePoint(kind, index = 0, total = 1) {
  const center = paper.view.bounds.center.clone();
  const span = Math.max(72, Math.min(paper.view.bounds.width, paper.view.bounds.height) * 0.18);
  if (total < 2) return center;
  return center.add(new paper.Point(kind === "svg" ? -span : span, 0));
}

async function runRuntimeFixture(mode = runtimeFixtureState.requested) {
  const selectedMode = String(mode || "").trim().toLowerCase();
  if (!["afa", "image", "all"].includes(selectedMode)) {
    return { ok: false, source: "runtime-fixture", reason: "query-required", requested: selectedMode || null };
  }
  if (!runtimeFixtureState.enabled || runtimeFixtureState.requested !== selectedMode) {
    return { ok: false, source: "runtime-fixture", reason: "explicit-query-required", requested: selectedMode };
  }
  if (runtimeFixtureState.running) {
    return { ok: false, source: "runtime-fixture", reason: "already-running" };
  }

  await runtimeFixtureReady;
  if (!window.paper?.project || !paper.view) {
    return { ok: false, source: "runtime-fixture", reason: "bootstrap-not-ready" };
  }

  const specs = selectedMode === "afa"
    ? [{
        kind: "svg",
        name: "runtime-fixture-AFA_007_from_url.svg",
        type: "image/svg+xml",
        paths: ["/ASSETS/templates/007.svg"]
      }]
    : selectedMode === "image"
      ? [{
          kind: "image",
          name: "runtime-fixture-image_1.png",
          type: "image/png",
          paths: ["/ASSETS/social/DRIVE.png"]
        }]
      : [
          {
            kind: "svg",
            name: "runtime-fixture-AFA_007_from_url.svg",
            type: "image/svg+xml",
            paths: ["/ASSETS/templates/007.svg"]
          },
          {
            kind: "image",
            name: "runtime-fixture-image_1.png",
            type: "image/png",
            paths: ["/ASSETS/social/DRIVE.png"]
          }
        ];

  const run = {
    id: `FIXTURE-${String(runtimeFixtureState.runs.length + 1).padStart(3, "0")}`,
    mode: selectedMode,
    source: "runtime-fixture",
    startedAt: new Date().toISOString(),
    imports: [],
    errors: []
  };
  runtimeFixtureState.running = true;
  runtimeFixtureState.runs.push(run);
  runtimeFixtureState.last = run;
  runtimeFixtureEvent("start", { runId: run.id, mode: selectedMode, count: specs.length });

  // A fixture run is one import transaction, like a multi-file native drop.
  // The canonical importers stay unchanged; this opt-in route disables their
  // individual snapshots and commits once after all async imports settle.
  const ownsHistoryTransaction = !window._ekkoHistoryTransaction?.active;
  if (ownsHistoryTransaction) beginHistoryTransaction("runtime-fixture-import");

  try {
    for (let index = 0; index < specs.length; index += 1) {
      const spec = specs[index];
      try {
        const artifact = await fetchRuntimeFixtureFile(spec);
        const point = runtimeFixturePoint(spec.kind, index, specs.length);
        // These are the canonical application import APIs. Do not replace this
        // with a drop event: the harness is specifically for real import code.
        const item = spec.kind === "svg"
          ? await addSVGFromFile(artifact.file, { point, history: false, diagnostic: true })
          : await addImageFromFile(artifact.file, { point, history: false, diagnostic: true });
        const imported = !!item;
        // Dirty the shared snapshot only after a real public owner exists.
        if (imported) saveHistory();
        const result = {
          kind: spec.kind,
          file: spec.name,
          path: artifact.path,
          bytes: artifact.bytes,
          point: { x: point.x, y: point.y },
          imported
        };
        run.imports.push(result);
        runtimeFixtureEvent("import", { runId: run.id, ...result });
        if (!imported) throw new Error(`canonical-import-returned-empty:${spec.kind}`);
      } catch (error) {
        const failure = { kind: spec.kind, file: spec.name, error: String(error?.stack || error) };
        run.errors.push(failure);
        runtimeFixtureEvent("error", { runId: run.id, ...failure });
      }
    }
    run.ok = run.errors.length === 0 && run.imports.length === specs.length;
    run.finishedAt = new Date().toISOString();
    runtimeFixtureEvent("complete", {
      runId: run.id,
      mode: selectedMode,
      ok: run.ok,
      imported: run.imports.length,
      errors: run.errors.length
    });
    return run;
  } finally {
    if (ownsHistoryTransaction) commitHistoryTransaction("runtime-fixture-import");
    runtimeFixtureState.running = false;
    runtimeFixtureState.last = run;
  }
}

window.EKKO_RUNTIME_FIXTURE = {
  state: runtimeFixtureState,
  run: runRuntimeFixture,
  ready: () => runtimeFixtureState.ready,
  enabled: () => runtimeFixtureState.enabled,
  paths: {
    afa: "/ASSETS/templates/007.svg",
    image: "/ASSETS/social/DRIVE.png"
  }
};

// Compact, optional instrumentation. The canonical diagnostics modules expose
// logEvent/record; no wrappers or replacement globals are installed here.
function emitAssetDropDiagnostic(eventName, details = {}) {
  const payload = { source: "asset-drop", ...details };
  try { window.EKKO_DIAG?.logEvent?.(`asset.${eventName}`, payload); } catch (_) {}
  try { window.EKKO_RUNTIME_PROBE?.record?.(`asset.${eventName}`, payload); } catch (_) {}
}

function classifyDroppedAsset(file) {
  const name = String(file?.name || "").toLowerCase();
  const type = String(file?.type || "").toLowerCase();
  if (type === "image/svg+xml" || name.endsWith(".svg")) return "svg";
  const imageExtensions = /\.(?:avif|bmp|gif|ico|jpe?g|png|tiff?|webp)$/i;
  if (type.startsWith("image/") || imageExtensions.test(name)) return "image";
  return null;
}

function projectPointFromDropEvent(event, canvasEl) {
  if (!event || !canvasEl || !window.paper?.view) return null;
  const rect = canvasEl.getBoundingClientRect();
  if (!rect.width || !rect.height || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return null;
  const scaleX = (canvasEl.width || rect.width) / rect.width;
  const scaleY = (canvasEl.height || rect.height) / rect.height;
  const viewPoint = new paper.Point((event.clientX - rect.left) * scaleX, (event.clientY - rect.top) * scaleY);
  try {
    return typeof paper.view.viewToProject === "function" ? paper.view.viewToProject(viewPoint) : viewPoint;
  } catch (_) {
    return null;
  }
}

function hasFilePayload(event) {
  const types = Array.from(event?.dataTransfer?.types || []);
  return types.includes("Files") || !!event?.dataTransfer?.files?.length;
}

function initCanvasAssetDrop(canvasEl) {
  if (!canvasEl || canvasEl.__ekkoAssetDropBound) return false;
  canvasEl.__ekkoAssetDropBound = true;
  let dragDepth = 0;
  const clearDropState = () => {
    dragDepth = 0;
    canvasEl.classList.remove("ekko-drop-active");
  };
  const onDragEnter = (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    dragDepth += 1;
    canvasEl.classList.add("ekko-drop-active");
    emitAssetDropDiagnostic("dragenter", { files: Number(event.dataTransfer?.files?.length || 0) });
  };
  const onDragOver = (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    canvasEl.classList.add("ekko-drop-active");
  };
  const onDragLeave = (event) => {
    if (!hasFilePayload(event)) return;
    event.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth || !event.relatedTarget || !canvasEl.contains(event.relatedTarget)) clearDropState();
  };
  const onDrop = async (event) => {
    if (!hasFilePayload(event)) { clearDropState(); return; }
    event.preventDefault();
    event.stopPropagation();
    clearDropState();
    const files = Array.from(event.dataTransfer?.files || []);
    const point = projectPointFromDropEvent(event, canvasEl);
    emitAssetDropDiagnostic("drop", { files: files.length, point: point ? { x: point.x, y: point.y } : null });

    const accepted = [];
    files.forEach((file, index) => {
      const kind = classifyDroppedAsset(file);
      if (!kind) {
        emitAssetDropDiagnostic("ignored", { file: file?.name || "(sin nombre)", index, reason: "unsupported-type" });
        return;
      }
      accepted.push({ file, kind, index });
      emitAssetDropDiagnostic("accepted", { file: file?.name || "(sin nombre)", kind, index });
    });
    if (!accepted.length) return;

    // One transaction, sequential input order. The first file is exactly under
    // the pointer; following files use a deterministic 24-unit diagonal offset.
    beginHistoryTransaction("drag-drop-import");
    try {
      for (let order = 0; order < accepted.length; order += 1) {
        const { file, kind, index } = accepted[order];
        const placement = point ? point.add(new paper.Point(order * 24, order * 24)) : null;
        const options = { point: placement, history: false, diagnostic: false };
        const result = kind === "svg"
          ? await addSVGFromFile(file, options)
          : await addImageFromFile(file, options);
        if (result) {
          // Mark the transaction dirty only after a real imported owner exists.
          saveHistory();
          emitAssetDropDiagnostic("success", { file: file.name || "(sin nombre)", kind, index, order });
        } else {
          emitAssetDropDiagnostic("error", { file: file.name || "(sin nombre)", kind, index, order, reason: "import-returned-empty" });
        }
      }
    } catch (error) {
      emitAssetDropDiagnostic("error", { reason: "drop-sequence", error: String(error?.message || error) });
    } finally {
      commitHistoryTransaction("drag-drop-import");
      clearDropState();
    }
  };

  canvasEl.addEventListener("dragenter", onDragEnter, false);
  canvasEl.addEventListener("dragover", onDragOver, false);
  canvasEl.addEventListener("dragleave", onDragLeave, false);
  canvasEl.addEventListener("drop", onDrop, false);
  // A file dropped outside the canvas must not navigate away from the editor.
  if (!window.__ekkoAssetDropGlobalGuard) {
    window.__ekkoAssetDropGlobalGuard = true;
    document.addEventListener("dragover", (event) => {
      if (hasFilePayload(event)) event.preventDefault();
    }, true);
    document.addEventListener("drop", (event) => {
      if (hasFilePayload(event)) event.preventDefault();
    }, true);
  }
  return true;
}
// Controladores persistentes de carga: el mismo input se reutiliza y cada
// archivo se entrega directamente al cargador canónico (sin una ruta temporal de archivos).
function getPersistentPicker(id, accept, handler, multiple = true) {
  let picker = document.getElementById(id);
  if (!picker) {
    picker = document.createElement("input");
    picker.type = "file";
    picker.id = id;
    picker.accept = accept;
    picker.multiple = multiple;
    picker.className = "hidden-picker";
    document.body.appendChild(picker);
  }
  if (!picker._ekkoDirectHandler) {
    picker._ekkoDirectHandler = true;
    picker.addEventListener("change", async (event) => {
      const files = Array.from(event.target.files || []);
      event.target.value = "";
      for (const file of files) await handler(file);
    });
  }
  return picker;
}

export function openImageFileDialog() {
  const picker = getPersistentPicker("imagePicker", "image/*", addImageFromFile);
  try { picker.click(); return true; } catch (e) { return false; }
}
window.openImageFileDialog = openImageFileDialog;

// Controladores Nombrados para Diálogos de Carga (Trazabilidad y Prevención de Clics Fantasma)
export function openSVGFileDialog() {
  const picker = getPersistentPicker("svgPicker", ".svg,image/svg+xml", addSVGFromFile);
  try { picker.click(); return true; } catch (err) { return false; }
}
window.openSVGFileDialog = openSVGFileDialog;


// ==============================================================
// CARGA UNIFICADA — selector persistente y dispatch directo
// ==============================================================
async function openAssetLoader() {
  const picker = getPersistentPicker("ekkoAssetPicker", ".svg,image/*", async (file) => {
    if (/\.svg$/i.test(file.name) || file.type === "image/svg+xml") return addSVGFromFile(file);
    return addImageFromFile(file);
  }, true);
  try { picker.click(); return true; } catch (e) { return false; }
}

async function cargarArchivoPorTipo(file, tipo) {
  if (!file) return null;
  return tipo === "svg" ? addSVGFromFile(file) : addImageFromFile(file);
}

async function cargarUnArchivo(file, tipo) {
  return cargarArchivoPorTipo(file, tipo);
}

window.openAssetLoader = openAssetLoader;
window.openImageLoader = openAssetLoader;
window.openSVGLoader = openAssetLoader;
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
  window.EKKO_INTERACTION?.claim("text-insert", { owner: "selection" });
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
    fontFamily: "ekko_malvinassans_regular"
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

  initCanvasAssetDrop(canvasEl);

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


    safeAddListener("btnAddSVG", "click", () => {
      openSVGFileDialog();
    });

// Curvar Texto se enlaza en contextualMenu.js mediante un dispatcher único.

    
    safeAddListener("btnAddQR", "click", () => {
      const text = prompt("Ingrese el texto o enlace (Instagram, WhatsApp, WiFi) para el codigo QR:", "https://www.instagram.com/grabados_ekko/");
      if (text && text.trim() !== "") {
        addQRToCanvas(text.trim());
      }
    });

    // La inserción de texto se procesa exclusivamente en selection.js, que
    // posee la sesión de puntero. No se registra un segundo mousedown de Paper.

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
      if (window.EKKO_DIAG && typeof window.EKKO_DIAG.emitReady === "function" && !window.__EKKO_STUDIO_READY_EMITTED) {
        window.__EKKO_STUDIO_READY_EMITTED = true;
        window.EKKO_DIAG.emitReady();
         window.EKKO_RUNTIME_PROBE?.ready({ source: "editor.bootstrap" });
      }
      markRuntimeFixtureReady();
      if (runtimeFixtureState.auto) {
        // Auto-run is available only behind the explicit query opt-in.
        runRuntimeFixture(runtimeFixtureState.requested).catch(error => {
          runtimeFixtureEvent("error", { runId: null, error: String(error?.stack || error) });
        });
      }
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


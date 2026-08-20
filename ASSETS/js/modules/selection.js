/* =========================================================================
Módulo: ASSETS/js/modules/selection.js
Descripción: Gestión de selección, redimensionamiento, arrastre y caja de selección
en Paper.js para EKKO Studio.
CORRECCIÓN DE ARRASTRE Y ESCALA: Al arrastrar o redimensionar un objeto recortado
(clipGroup), se opera únicamente sobre el contenido interno (imagen, texto, svg, qr),
manteniendo la máscara (silueta del mockup) fija en su lugar para que el diseño
se desplace o escale "dentro" del contorno original del producto sin deformarlo.
========================================================================= */

window.selectedItem = null;
window.dragOffset = null;
window.selectionBoxGroup = null;

// Sizing/Resize state variables
window.resizeActive = false;
window.resizeHandleType = null;
window.resizeTarget = null;
window.resizeInitialBounds = null;
window.resizeInitialPoint = null;
window.resizeLastScaleX = 1.0;
window.resizeLastScaleY = 1.0;
window.resizeAnchor = null;

// --- NODE EDITING STATE (LIGHTBURN STYLE) ---
window.nodeEditMode = false;
window.nodeEditTarget = null;
window.nodeHandlesGroup = null;
window.selectedNodeIndex = -1;
window.draggingNode = false;
window.dragNodeIndex = -1;

/* ========================= SELECCIÓN DE OBJETO ========================= */
window.getSelectableItem = function(item){
if(!item) return null;
if (item.data && (item.data.isHandle || item.data.isSelectionBox || item.data.isNodeHandle)) return null;
if (item.parent && item.parent.data && (item.parent.data.isSelectionBox || item.parent.data.isNodeEditOverlay)) return null;
if (item.data && item.data.mockup) return null;
let current = item;
while (current) {
if (current.data) {
if (current.data.mockup) return null;
if (current.data.clipGroup) {
return current;
}
}
if (current.parent instanceof paper.Layer || current.parent === paper.project.activeLayer) {
return current;
}
if (current.parent) {
current = current.parent;
} else {
break;
}
}
return current;
};

/* ========================= UPDATE SELECTION BOX OVERLAY ========================= */
window.updateSelectionBox = function(item) {
if (window.selectionBoxGroup) {
window.selectionBoxGroup.remove();
window.selectionBoxGroup = null;
}
if (window.nodeEditMode) {
return;
}
if (!item || (item.data && item.data.mockup)) {
return;
}
const displayItem = (item.data && item.data.clipGroup)
? item.children.find(function(c) { return !c.clipMask; })
: item;
if (!displayItem) return;
const bounds = displayItem.bounds;
if (!bounds || bounds.width <= 0 || bounds.height <= 0) return;
window.selectionBoxGroup = new paper.Group();
window.selectionBoxGroup.data = { isSelectionBox: true };
// 1. Dibujar el rectángulo azul de contorno dashed
const border = new paper.Path.Rectangle(bounds);
border.strokeColor = '#007bff';
border.strokeWidth = 1.5 / paper.view.zoom;
border.dashArray = [4 / paper.view.zoom, 4 / paper.view.zoom];
window.selectionBoxGroup.addChild(border);

// 2. Dibujar los 8 nodos de control (cuadrados blancos con borde azul)
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
window.selectionBoxGroup.bringToFront();
};

/* ========================= NODE EDITING OVERLAY SYSTEM ========================= */
window.drawNodeEditHandles = function(path) {
if (window.nodeHandlesGroup) {
window.nodeHandlesGroup.remove();
window.nodeHandlesGroup = null;
}
if (!path || !path.segments) return;
window.nodeHandlesGroup = new paper.Group();
window.nodeHandlesGroup.data = { isNodeEditOverlay: true };
const handleSize = 5 / paper.view.zoom;
path.segments.forEach(function(segment, index) {
const isSelected = (index === window.selectedNodeIndex);
const handleCircle = new paper.Path.Circle({
center: segment.point,
radius: handleSize,
strokeColor: '#dc3545',
fillColor: isSelected ? '#dc3545' : '#ffffff',
strokeWidth: 1.5 / paper.view.zoom
});
handleCircle.data = { isNodeHandle: true, segmentIndex: index };
window.nodeHandlesGroup.addChild(handleCircle);
});
window.nodeHandlesGroup.bringToFront();
};

window.enterNodeEditMode = function(path) {
if (!path || !path.segments) return;
window.exitNodeEditMode();
if (window.selectedItem) {
window.selectedItem.selected = false;
}
window.nodeEditMode = true;
window.nodeEditTarget = path;
window.selectedNodeIndex = -1;
window.updateSelectionBox(null);
window.drawNodeEditHandles(path);
const nodeCtrl = document.getElementById('ctxNodeEditControls');
if (nodeCtrl) nodeCtrl.classList.remove('hidden');
const vecCtrl = document.getElementById('ctxVectorControls');
if (vecCtrl) vecCtrl.classList.add('hidden');
const imgCtrl = document.getElementById('ctxImageControls');
if (imgCtrl) imgCtrl.classList.add('hidden');
const txtCtrl = document.getElementById('ctxTextControls');
if (txtCtrl) txtCtrl.classList.add('hidden');
paper.view.update();
};

window.exitNodeEditMode = function() {
if (window.nodeHandlesGroup) {
window.nodeHandlesGroup.remove();
window.nodeHandlesGroup = null;
}
window.nodeEditMode = false;
const path = window.nodeEditTarget;
window.nodeEditTarget = null;
window.selectedNodeIndex = -1;
const nodeEl = document.getElementById('ctxNodeEditControls');
if (nodeEl) nodeEl.classList.add('hidden');
if (path) {
window.selectItem(path);
}
paper.view.update();
};

/* ========================= SELECT ========================= */
window.selectItem = function(item){
if (window.nodeEditMode) {
window.exitNodeEditMode();
}
if(window.selectedItem){
window.selectedItem.selected = false;
}
window.selectedItem = item;
if(!item){
window.updateSelectionBox(null);
paper.view.update();
return;
}
if(item.data && item.data.mockup){
item.selected = false;
window.updateSelectionBox(null);
paper.view.update();
return;
}
window.updateSelectionBox(item);
if (typeof window.updateContextualMenu === 'function') {
window.updateContextualMenu(item);
}
paper.view.update();
};

/* ========================= DESELECT ========================= */
window.deselectItem = function(){
if (window.nodeEditMode) {
window.exitNodeEditMode();
}
if(window.selectedItem){
window.selectedItem.selected = false;
}
window.selectedItem = null;
window.updateSelectionBox(null);
if (typeof window.hideContextualMenu === 'function') {
window.hideContextualMenu();
}
paper.view.update();
};

/* ========================= FUNCIONES AUXILIARES DE ESCALADO ========================= */
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

// --- FUNCIÓN DE INICIALIZACIÓN DE EVENTOS DE MOUSE ---
window.initSelectionTool = function() {
if (!paper.view) {
console.warn("initSelectionTool: paper.view no está definido todavía.");
return;
}

const selectTool = new paper.Tool();
let lastClickTime = 0;

selectTool.onMouseDown = function(event) {
// Manejar doble clic para edición de texto inline
const currentTime = Date.now();
if (currentTime - lastClickTime < 300) {
lastClickTime = 0; // Evitar disparar múltiples doble clics
if (window.selectedItem) {
const target = window.selectedItem.data?.clipGroup ? window.selectedItem.children.find(function(c) { return !c.clipMask; }) : window.selectedItem;
if (target instanceof paper.PointText) {
if (typeof window.startTextEditing === 'function') {
window.startTextEditing(target);
}
return;
}
}
}
lastClickTime = currentTime;

// 1. Hit test para verificar si se presionó un handle de redimensionamiento
const hitResult = paper.project.hitTest(event.point, {
fill: true,
stroke: true,
segments: true,
tolerance: 8 / paper.view.zoom,
match: function(hit) {
// Solo nos interesan los handles de la caja de selección activa
return hit.item.data && hit.item.data.isHandle;
}
});
if (hitResult) {
// El usuario seleccionó un nodo de control para redimensionar
window.resizeActive = true;
window.resizeHandleType = hitResult.item.data.handleType;
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
bounds: true, // 🚀 CORRECCIÓN CLAVE: Permite seleccionar imágenes, textos y códigos QR cómodamente
tolerance: 8 / paper.view.zoom,
match: function(hit) {
// No interactuar con la caja de selección en sí, ni con mockups protegidos
if (hit.item.data && (hit.item.data.isSelectionBox || hit.item.data.isHandle)) return false;
if (hit.item.data && hit.item.data.mockup) return false;
return true;
}
});
if (generalHit) {
const selectableItem = window.getSelectableItem(generalHit.item);
if (selectableItem) {
window.selectItem(selectableItem);
window.dragging = true;

// 🚀 MEJORA DE ARRASTRE PARA GRUPOS DE RECORTE (ClipGroup)
// Si es un clipGroup, calculamos el dragOffset en base al hijo interno real (la imagen/texto/vector),
// y NO del grupo entero, para poder reposicionarlo de manera independiente.
const dragTarget = (selectableItem.data && selectableItem.data.clipGroup)
? selectableItem.children.find(function(c) { return !c.clipMask; })
: selectableItem;

window.dragOffset = event.point.subtract(dragTarget.position);
return;
}
}

// Si hizo clic en el vacío, deseleccionar
window.deselectItem();
};

selectTool.onMouseDrag = function(event) {
// Bloqueo preventivo: No interactuar si el objeto seleccionado está bloqueado
if (window.selectedItem && window.selectedItem.data && window.selectedItem.data.locked) {
return;
}
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

// Si es un redimensionamiento de esquina, mantener aspecto proporcional por defecto
if (['tl', 'tr', 'bl', 'br'].includes(window.resizeHandleType)) {
const factor = (Math.abs(factorX) + Math.abs(factorY)) / 2 * (factorX < 0 ? -1 : 1);
factorX = factor;
factorY = factor;
}
// Aplicar escala incremental relativa
const scaleFactorX = factorX / window.resizeLastScaleX;
const scaleFactorY = factorY / window.resizeLastScaleY;

// 🚀 ESCALADO SEGURO INTERNO (MÁSCARA FIJA):
// Escalamos únicamente el contenido real interno y NO el grupo entero.
// Esto garantiza que la máscara mantenga su escala fija alineada al mockup del producto
// mientras el usuario modifica interactivamente el tamaño de su diseño.
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

if (window.dragging && window.selectedItem) {
// 🚀 ARRASTRE SEGURO DENTRO DEL CONTORNO (MÁSCARA)
// Si el elemento es un grupo de recorte (clipGroup), movemos únicamente el hijo interno
// real (dragTarget) que contiene la imagen, texto o vector. La máscara (clipMask) queda fija en
// su posición original (alineada con el mockup), logrando el efecto WYSIWYG de "desplazamiento interno".
const dragTarget = (window.selectedItem.data && window.selectedItem.data.clipGroup)
? window.selectedItem.children.find(function(c) { return !c.clipMask; })
: window.selectedItem;

dragTarget.position = event.point.subtract(window.dragOffset);
window.updateSelectionBox(window.selectedItem);
paper.view.update();
return;
}
};

selectTool.onMouseUp = function(event) {
if (window.resizeActive || window.dragging) {
if (typeof window.saveHistory === 'function') window.saveHistory();
}
window.dragging = false;
window.resizeActive = false;
paper.view.update();
};

selectTool.activate();
console.log("🎯 Eventos de selección y redimensionamiento de Paper.js registrados con éxito.");
};

// Autoejecutar de inmediato si ya se inicializó paper.js
if (typeof paper !== "undefined" && paper.view) {
window.initSelectionTool();
}

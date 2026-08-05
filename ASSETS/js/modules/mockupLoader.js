// Función auxiliar para convertir círculos/rectángulos a trazados reales antes de recortar
function convertShapesToPaths(item) {
  if (!item) return;
  if (item instanceof paper.Shape) {
    const path = item.toPath();
    path.data = item.data || {};
    path.name = item.name;
    path.fillColor = item.fillColor;
    path.strokeColor = item.strokeColor;
    path.strokeWidth = item.strokeWidth;
    path.dashArray = item.dashArray;
    if (item.parent) {
      item.parent.insertChild(item.index, path);
      item.remove();
    }
    return path;
  }
  if (item.children) {
    const children = Array.from(item.children);
    children.forEach(convertShapesToPaths);
  }
  return item;
}

function findLargestPath(item){
  let biggest = null;
  function walk(obj){
    if( obj instanceof paper.Path || obj instanceof paper.CompoundPath ){
      if( !biggest || Math.abs(obj.area) > Math.abs(biggest.area) ){
        biggest = obj;
      }
    }
    if(obj.children){
      obj.children.forEach(walk);
    }
  }
  walk(item);
  return biggest;
}

function collectPaths(item, paths = []){
  if( item instanceof paper.Path || item instanceof paper.CompoundPath ){
    paths.push(item);
  }
  if(item.children){
    item.children.forEach(function(child){
      collectPaths(child, paths);
    });
  }
  return paths;
}

function buildCompoundMask(item){
  const paths = collectPaths(item)
    .filter(function(path) { return path && Math.abs(path.area) > 0; })
    .sort(function(a, b) { return Math.abs(b.area) - Math.abs(a.area); });
  if (!paths.length) return null;
  
  const firstPath = paths.slice(0, 1).shift();
  let mask = firstPath.clone();
  mask.applyMatrix = true;
  
  const remainingPaths = paths.slice(1);
  remainingPaths.forEach(function(path) {
    const hole = path.clone();
    hole.applyMatrix = true;
    if (mask.contains(hole.bounds.center)) {
      const result = mask.subtract(hole);
      mask.remove();
      hole.remove();
      if (result) {
        mask = result;
      }
    } else {
      hole.remove();
    }
  });
  mask.fillColor = "black";
  mask.strokeColor = null;
  mask.visible = false;
  return mask;
}

function lockMockup(item){
  item.data = item.data || {};
  item.data.mockup = true;
  item.data.locked = true;
  if(item.children){
    item.children.forEach(lockMockup);
  }
}

export function loadMockup(svgPath) {
  const token = ++window.loadToken;
  paper.project.activeLayer.removeChildren();
  paper.project.importSVG(svgPath, function (item) {
    if (token !== window.loadToken) {
      if (item) item.remove();
      return;
    }
    if (!item) return;

    // Convertimos cualquier círculo o rectángulo básico a trazado vectorial Path
    convertShapesToPaths(item);

    const bounds = item.bounds;
    const canvasBounds = paper.view.bounds;
    const scaleX = (canvasBounds.width * 0.75) / bounds.width;
    const scaleY = (canvasBounds.height * 0.75) / bounds.height;
    const scale = Math.min(scaleX, scaleY);
    item.scale(scale);
    item.position = canvasBounds.center;
    
    // Encontrás el área más grande para la máscara de recorte
    window.grabArea = findLargestPath(item);
    window.clipMask = window.grabArea ? window.grabArea.clone() : null;
    if (window.clipMask) {
      window.clipMask.visible = false;
    }

    // Volvemos transparente el fondo del producto para ver la foto detrás
    const biggestPath = findLargestPath(item);
    if (biggestPath) {
      biggestPath.fillColor = null;
      if (!biggestPath.strokeColor) {
        biggestPath.strokeColor = new paper.Color('#cccccc');
        biggestPath.strokeWidth = 1.5;
        biggestPath.dashArray = new Array(6, 4);
      }
    }

    lockMockup(item);
    window.currentMockup = item;
    item.data = { locked: true, mockup: true, label: "Mockup" };
    item.bringToFront();
    paper.view.update();
  });
}

window.clipItem = function(item){
  if(!window.clipMask){
    return item;
  }
  const mask = window.clipMask.clone();
  mask.clipMask = true;
  mask.visible = true;
  const group = new paper.Group();
  group.addChild(mask);
  group.addChild(item);
  group.clipped = true;
  // Activamos clipGroup: true para que editor.js lo reconozca
  group.data = { locked: false, clipGroup: true, label: item.data?.label || "Objeto" };
  return group;
}
2️⃣ Reemplaza por completo estas funciones de interacción en tu archivo: ASSETS/js/editor.js
Este código de interacción está diseñado con alta precisión para permitir seleccionar y arrastrar la foto libremente por debajo de la chapita en coordenadas relativas perfectas:
// UBICACIÓN: ekko-studio/ASSETS/js/editor.js

// 1. Detección de clics inteligente (Omitir marco del producto)
tool.onMouseDown = function(event){
    const hit = paper.project.hitTest(event.point, { 
        fill: true, 
        stroke: true, 
        segments: true, 
        tolerance: 8,
        match: function(hitResult) {
            return !hitResult.item.data || !hitResult.item.data.mockup;
        }
    });

    if(!hit){
        window.deselectItem();
        return;
    }
    
    const item = window.getSelectableItem(hit.item || hit);
    if(!item) return;
    window.selectItem(item);
    
    // Si es un grupo de recorte, calculamos el arrastre sobre la imagen de adentro
    if (item.data && item.data.clipGroup) {
        const contentItem = item.children.find(function(c) { return !c.clipMask; });
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

// 2. Arrastre fluido de la imagen interna (La máscara se queda quieta en su lugar)
tool.onMouseDrag = function(event){
    if( !window.dragging || !window.selectedItem ){
        return;
    }
    
    if (window.selectedItem.data && window.selectedItem.data.clipGroup) {
        const contentItem = window.selectedItem.children.find(function(c) { return !c.clipMask; });
        if (contentItem) {
            contentItem.position = event.point.subtract(window.dragOffset);
        }
    } else {
        window.selectedItem.position = event.point.subtract(window.dragOffset);
    }
    paper.view.update();
};

// 3. Centrar contenido de imagen respecto a su máscara física
function centerSelected(mode) {
    if (!selectedItem) return;
    if (isLockedItem(selectedItem)) return;
    saveHistory();
    
    if (selectedItem.data && selectedItem.data.clipGroup) {
        const mask = selectedItem.children.find(function(c) { return c.clipMask; });
        const content = selectedItem.children.find(function(c) { return !c.clipMask; });
        if (mask && content) {
            if (mode === "horizontal") content.position.x = mask.position.x;
            if (mode === "vertical") content.position.y = mask.position.y;
            if (mode === "both") content.position = mask.position.clone();
        }
    } else {
        const center = paper.view.bounds.center;
        if (mode === "horizontal") selectedItem.position.x = center.x;
        if (mode === "vertical") selectedItem.position.y = center.y;
        if (mode === "both") selectedItem.position = center.clone();
    }
    updateSelectionInfo();
    paper.view.update();
}

// 4. Mostrar información de tamaño real de la imagen
function updateSelectionInfo() {
    if (!selectedItem) {
        ui.selectionInfo.textContent = "Nada seleccionado";
        ui.objWidth.value = "";
        ui.objHeight.value = "";
        return;
    }
    
    const displayItem = (selectedItem.data && selectedItem.data.clipGroup)
        ? selectedItem.children.find(function(c) { return !c.clipMask; })
        : selectedItem;
        
    if (!displayItem) return;

    const w = displayItem.bounds.width.toFixed(1);
    const h = displayItem.bounds.height.toFixed(1);
    ui.selectionInfo.textContent = "Seleccionado: " + (displayItem.data && displayItem.data.label ? displayItem.data.label : "Objeto") + " | " + w + " x " + h;
    ui.objWidth.value = w;
    ui.objHeight.value = h;
}

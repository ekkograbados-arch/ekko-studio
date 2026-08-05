function convertAllShapesToPaths(item) {
  if (!item) return;
  if (item instanceof paper.Shape) {
    const path = item.toPath();
    path.data = item.data;
    path.name = item.name;
    if (item.parent) {
      item.parent.insertChild(item.index, path);
      item.remove();
    }
    return path;
  }
  if (item.children) {
    const children = item.children.slice();
    children.forEach(convertAllShapesToPaths);
  }
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

function lockMockup(item){
  item.data = item.data || {};
  item.data.mockup = true;
  item.data.locked = true;
  if(item.children){
    item.children.forEach(lockMockup);
  }
}

function buildMask() {
  if (!window.grabArea) return null;
  const mask = window.grabArea.clone();
  mask.visible = false;
  return mask;
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

    // Convertimos todas las figuras geométricas básicas en trazados reales
    convertAllShapesToPaths(item);

    const bounds = item.bounds;
    const canvasBounds = paper.view.bounds;
    const scaleX = (canvasBounds.width * 0.75) / bounds.width;
    const scaleY = (canvasBounds.height * 0.75) / bounds.height;
    const scale = Math.min(scaleX, scaleY);
    item.scale(scale);
    item.position = canvasBounds.center;

    window.grabArea = findLargestPath(item);
    window.clipMask = buildMask();
    window.currentMockup = item;

    // Volvemos transparente el fondo del producto para ver la foto detrás
    if (window.grabArea) {
      window.grabArea.fillColor = null;
      if (!window.grabArea.strokeColor) {
        window.grabArea.strokeColor = new paper.Color('#cccccc');
        window.grabArea.strokeWidth = 1.5;
        window.grabArea.dashArray = new Array(6, 4);
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
  group.data = { locked: false, clipGroup: true, label: (item.data && item.data.label) ? item.data.label : "Objeto" };
  return group;
}

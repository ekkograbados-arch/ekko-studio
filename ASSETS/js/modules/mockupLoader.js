export function findLargestPath(item) {
  let biggest = null;
  function walk(obj) {
    let checkObj = obj;
    // Si es una figura nativa (círculo o rectángulo), la medimos como Path
    if (obj instanceof paper.Shape) {
      checkObj = obj.toPath();
    }
    if ( checkObj instanceof paper.Path || checkObj instanceof paper.CompoundPath ) {
      if ( !biggest || Math.abs(checkObj.area) > Math.abs(biggest.area) ) {
        biggest = obj; 
      }
    }
    // Eliminamos la conversión temporal si no fue la figura más grande
    if (checkObj !== obj && biggest !== obj) {
      checkObj.remove();
    }
    if (obj.children) {
      obj.children.forEach(walk);
    }
  }
  walk(item);
  return biggest;
}

function collectPaths(item, paths = []) {
  if ( item instanceof paper.Path || item instanceof paper.CompoundPath ) {
    paths.push(item);
  }
  if (item.children) {
    item.children.forEach(child => collectPaths(child, paths));
  }
  return paths;
}

// CORREGIDO: Reemplaza círculos y rectángulos nativos del SVG por trazados vectoriales reales en su misma posición jerárquica
function convertShapesToPaths(item) {
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
    const children = Array.from(item.children);
    children.forEach(convertShapesToPaths);
  }
  return item;
}

function buildCompoundMask(item) {
  const paths = collectPaths(item)
    .filter(path => path && Math.abs(path.area) > 0)
    .sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  if (!paths.length) return null;
  
  // Extraemos el trazado base de forma segura sin corchetes
  const firstPath = paths.slice(0, 1).shift();
  let mask = firstPath.clone(); 
  mask.applyMatrix = true;
  
  // Procesamos los huecos e intersecciones de forma limpia e inmune a índices
  const remainingPaths = paths.slice(1);
  remainingPaths.forEach(path => {
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

function lockMockup(item) {
  item.data = item.data || {};
  item.data.locked = true;
  item.data.mockup = true;
  item.locked = true;
  item.selected = false;
  if (item.children) {
    item.children.forEach(lockMockup);
  }
}

window.clipItem = function (item) {
  if (!window.clipMask) {
    return item;
  }
  const mask = window.clipMask.clone();
  mask.clipMask = true;
  const group = new paper.Group([ mask, item ]);
  group.clipped = true;
  group.data = { locked: false, clipGroup: true, label: item.data?.label || "Objeto" };
  item.data = item.data || {};
  item.data.parentClip = true;
  return group;
};

export function loadMockup(svgPath) {
  const token = ++window.loadToken;
  paper.project.activeLayer.removeChildren();
  paper.project.importSVG(svgPath, function (item) {
    if (token !== window.loadToken) {
      if (item) item.remove();
      return;
    }
    if (!item) return;

    // 1. Convertimos las figuras básicas en trazados compatibles en caliente
    convertShapesToPaths(item);

    const canvas = paper.view.bounds;
    const bounds = item.bounds;
    const scale = Math.min(
      (canvas.width * 0.75) / bounds.width,
      (canvas.height * 0.75) / bounds.height
    );
    item.scale(scale);
    item.position = canvas.center;

    // 2. Creamos la máscara de recorte para las fotos
    window.grabArea = buildCompoundMask(item);
    window.clipMask = window.grabArea ? window.grabArea.clone() : null;
    if (window.clipMask) {
      window.clipMask.visible = false;
    }

    // 3. Volvemos transparente la silueta para revelar la imagen
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

    item.bringToFront();
    paper.view.update();
  });
}

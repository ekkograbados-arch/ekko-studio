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

function collectPaths(item, paths = []) {
  if ( item instanceof paper.Path || item instanceof paper.CompoundPath ) {
    paths.push(item);
  }
  if (item.children) {
    const children = item.children.slice();
    children.forEach(function(child) {
      collectPaths(child, paths);
    });
  }
  return paths;
}

// Genera una máscara booleana restando todos los agujeros internos de la silueta principal
function buildCompoundMask(item) {
  // Convertimos círculos/rectángulos a paths reales
  convertAllShapesToPaths(item);

  // Recolectamos todos los trazados y los ordenamos por área de mayor a menor
  const paths = collectPaths(item)
    .filter(function(path) { 
      return path && Math.abs(path.area) > 0; 
    })
    .sort(function(a, b) { 
      return Math.abs(b.area) - Math.abs(a.area); 
    });

  if (!paths.length) return null;
  
  // El trazado más grande es nuestra silueta exterior base
  const firstPath = paths.slice(0, 1).shift();
  let mask = firstPath.clone();
  mask.applyMatrix = true;
  
  // Todos los trazados más pequeños que estén dentro de la silueta base se restan (creando los agujeros)
  const remainingPaths = paths.slice(1);
  remainingPaths.forEach(function(path) {
    const hole = path.clone();
    hole.applyMatrix = true;
    
    // Si el trazado está contenido dentro del límite de la silueta base, lo sustraemos
    if (mask.bounds.contains(hole.bounds.center)) {
      const subtractedResult = mask.subtract(hole);
      if (subtractedResult) {
        mask.remove(); // Limpiamos la máscara anterior
        mask = subtractedResult;
      }
      hole.remove();
    } else {
      hole.remove();
    }
  });

  mask.fillColor = "black";
  mask.strokeColor = null;
  mask.visible = false;
  return mask;
}

function makeMockupTransparent(item) {
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
    // Volvemos transparente el fondo para que se pueda ver la foto recortada por debajo
    item.fillColor = null;
    
    // Si las líneas del contorno original de LightBurn no tienen color, les ponemos un gris de guía
    if (!item.strokeColor) {
      item.strokeColor = new paper.Color('#cccccc');
      item.strokeWidth = 1.5;
      item.dashArray = new Array(6, 4);
    }
  }
  if (item.children) {
    const children = item.children.slice();
    children.forEach(makeMockupTransparent);
  }
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

export function loadMockup(svgPath) {
  const token = ++window.loadToken;
  paper.project.activeLayer.removeChildren();
  paper.project.importSVG(svgPath, function (item) {
    if (token !== window.loadToken) {
      if (item) item.remove();
      return;
    }
    if (!item) return;

    // 1. Escalamos y centramos el mockup importado en la pantalla
    const bounds = item.bounds;
    const canvasBounds = paper.view.bounds;
    const scaleX = (canvasBounds.width * 0.75) / bounds.width;
    const scaleY = (canvasBounds.height * 0.75) / bounds.height;
    const scale = Math.min(scaleX, scaleY);
    item.scale(scale);
    item.position = canvasBounds.center;

    // 2. Calculamos la máscara compuesta (Silueta base MENOS todos los agujeros/detalles)
    window.grabArea = buildCompoundMask(item);
    window.clipMask = window.grabArea ? window.grabArea.clone() : null;
    if (window.clipMask) {
      window.clipMask.visible = false;
    }

    // 3. Volvemos transparente el relleno de las líneas originales para ver la foto detrás
    makeMockupTransparent(item);

    // 4. Bloqueamos la plantilla de fondo para que actúe de guía fija
    lockMockup(item);
    window.currentMockup = item;
    item.data = { locked: true, mockup: true, label: "Mockup" };
    
    // Mandamos el mockup al frente para que las líneas negras de LightBurn queden perfectas ARRIBA de la foto
    item.bringToFront();
    paper.view.update();
  });
}

window.clipItem = function(item) {
  if (!window.clipMask) {
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


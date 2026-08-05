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

// Determina si el trazado más grande es un marco de LightBurn o el producto real
function shouldIgnoreLargestPath(paths) {
  if (paths.length < 2) return false;
  
  const firstPath = paths.slice(0, 1).shift();
  const secondPath = paths.slice(1, 2).shift();
  
  if (!firstPath || !secondPath) return false;
  
  // Verificamos si el primer trazado es un rectángulo
  const bounds = firstPath.bounds;
  const rectArea = bounds.width * bounds.height;
  const areaDiff = Math.abs(Math.abs(firstPath.area) - rectArea);
  const isRect = areaDiff < (rectArea * 0.03); // Tolerancia de área rectangular del 3%
  
  if (!isRect) return false;
  
  // Comparamos las áreas relativas del primer y segundo trazado
  const firstArea = Math.abs(firstPath.area);
  const secondArea = Math.abs(secondPath.area);
  const areaRatio = secondArea / firstArea;
  
  // Si el segundo trazado representa entre el 5% y el 90% del área del rectángulo mayor,
  // significa que el primero es un marco contenedor y el segundo es el producto real.
  if (areaRatio > 0.05 && areaRatio < 0.90) {
    return true;
  }
  
  return false;
}

// Genera una máscara booleana restando todos los agujeros internos de la silueta principal
function buildCompoundMask(item, ignoredPath) {
  // Convertimos círculos/rectángulos a paths reales primero
  convertAllShapesToPaths(item);

  // Recolectamos todos los trazados
  const allPaths = collectPaths(item);

  // Filtramos los trazados ignorando el marco de LightBurn si existiera
  const paths = allPaths.filter(function(path) {
    if (!path || Math.abs(path.area) <= 0) return false;
    if (ignoredPath && path === ignoredPath) return false;
    return true;
  });

  // Ordenamos de mayor a menor área para identificar la silueta base
  paths.sort(function(a, b) { 
    return Math.abs(b.area) - Math.abs(a.area); 
  });

  if (!paths.length) return null;
  
  // El trazado más grande (sin contar el marco de LightBurn) es nuestra silueta exterior base
  const firstPath = paths.slice(0, 1).shift();
  let mask = firstPath.clone();
  mask.applyMatrix = true;
  
  // Todos los trazados más pequeños que estén contenidos en la silueta base se restan (agujeros)
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

function makeMockupTransparent(item, ignoredPath) {
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
    // Si es el marco exterior de LightBurn, lo ocultamos por completo
    if (ignoredPath && item === ignoredPath) {
      item.visible = false;
      return;
    }

    // Volvemos transparente el fondo para que se pueda ver la foto recortada por debajo
    item.fillColor = null;
    
    // Líneas de contorno sólidas, oscuras y bien visibles
    if (!item.strokeColor) {
      item.strokeColor = new paper.Color('#222222'); // Gris oscuro / Negro nítido para guiar el grabado
      item.strokeWidth = 1.5;
    } else {
      // Si ya tiene color (como las líneas negras de LightBurn), las reforzamos para que se vean perfectas
      item.strokeColor = new paper.Color('#111111');
      item.strokeWidth = Math.max(item.strokeWidth, 1.2);
    }
  }
  if (item.children) {
    const children = item.children.slice();
    children.forEach(function(child) {
      makeMockupTransparent(child, ignoredPath);
    });
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

    // Convertimos cualquier círculo o rectángulo básico a trazado vectorial Path en caliente
    convertAllShapesToPaths(item);

    // Escalamos y centramos el mockup importado en la pantalla
    const bounds = item.bounds;
    const canvasBounds = paper.view.bounds;
    const scaleX = (canvasBounds.width * 0.75) / bounds.width;
    const scaleY = (canvasBounds.height * 0.75) / bounds.height;
    const scale = Math.min(scaleX, scaleY);
    item.scale(scale);
    item.position = canvasBounds.center;

    // Detectamos si el SVG contiene un marco contenedor gigante que debamos ignorar
    const allPaths = collectPaths(item).filter(function(p) { return p && Math.abs(p.area) > 0; });
    allPaths.sort(function(a, b) { return Math.abs(b.area) - Math.abs(a.area); });
    
    let ignoredPath = null;
    if (shouldIgnoreLargestPath(allPaths)) {
      ignoredPath = allPaths.slice(0, 1).shift();
    }

    // Calculamos la máscara compuesta (Silueta base MENOS todos los agujeros/detalles)
    window.grabArea = buildCompoundMask(item, ignoredPath);
    window.clipMask = window.grabArea ? window.grabArea.clone() : null;
    if (window.clipMask) {
      window.clipMask.visible = false;
    }

    // Volvemos transparente el relleno de las líneas originales para ver la foto detrás
    makeMockupTransparent(item, ignoredPath);

    // Bloqueamos la plantilla de fondo para que actúe de guía fija
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

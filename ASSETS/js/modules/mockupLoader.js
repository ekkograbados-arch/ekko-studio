function collectPaths(item, paths = []) {
  if ( item instanceof paper.Path || item instanceof paper.CompoundPath ) {
    paths.push(item);
  } else if ( item instanceof paper.Shape ) {
    const converted = item.toPath();
    converted.visible = false;
    paths.push(converted);
  }
  if (item.children) {
    const children = item.children.slice();
    children.forEach(function(child) {
      collectPaths(child, paths);
    });
  }
  return paths;
}

function shouldIgnoreLargestPath(paths, rootItem) {
  if (paths.length < 2) return false;
  
  const firstPath = paths.slice(0, 1).shift();
  const secondPath = paths.slice(1, 2).shift();
  
  if (!firstPath || !secondPath) return false;
  
  const fBounds = firstPath.bounds;
  const rBounds = rootItem.bounds;
  
  const wRatio = fBounds.width / rBounds.width;
  const hRatio = fBounds.height / rBounds.height;
  
  // Si el trazado más grande ocupa más del 95% del lienzo total importado
  if (wRatio > 0.95 && hRatio > 0.95) {
    const firstArea = Math.abs(firstPath.area);
    const secondArea = Math.abs(secondPath.area);
    const areaRatio = secondArea / firstArea;
    
    // CORREGIDO: Bajamos el límite a 0.50. Si el segundo trazado (el producto)
    // representa menos de la mitad del área del rectángulo mayor, el primero es un marco.
    // Si representa más (como el borde decorativo de una medalla militar), el primero es el contorno real.
    if (areaRatio < 0.50) {
      return true;
    }
  }
  
  return false;
}

function buildCompoundMask(item, ignoredPath, svgPath) {
  const allPaths = collectPaths(item);

  const paths = allPaths.filter(function(path) {
    if (!path || Math.abs(path.area) <= 0) return false;
    if (ignoredPath && path === ignoredPath) return false;
    return true;
  });

  paths.sort(function(a, b) { 
    return Math.abs(b.area) - Math.abs(a.area); 
  });

  if (!paths.length) return null;
  
  const firstPath = paths.slice(0, 1).shift();
  
  // CORREGIDO: Clonamos y aplicamos la matriz global del mockup para posicionar la máscara con precisión absoluta
  let mask = firstPath.clone();
  mask.transform(firstPath.globalMatrix);
  mask.applyMatrix = true;
  
  // Detectamos si el producto es una virola (anillo) mediante el nombre del SVG
  const isVirola = svgPath && svgPath.toLowerCase().indexOf('virola') !== -1;
  const baseArea = Math.abs(mask.area);
  
  const remainingPaths = paths.slice(1);
  remainingPaths.forEach(function(path) {
    const hole = path.clone();
    // Aplicamos la matriz global al agujero también para que coincida exactamente con la máscara
    hole.transform(path.globalMatrix);
    hole.applyMatrix = true;
    
    if (mask.bounds.contains(hole.bounds.center)) {
      const holeArea = Math.abs(hole.area);
      const areaRatio = holeArea / baseArea;
      
      // REGLA INTELIGENTE:
      // 1. Si es una virola, siempre restamos el círculo central (agujero grande) para formar el anillo.
      // 2. Para otros productos, solo restamos si es un agujero real (área menor al 15% de la silueta base).
      if (isVirola || areaRatio < 0.15) {
        const subtractedResult = mask.subtract(hole);
        if (subtractedResult) {
          mask.remove();
          mask = subtractedResult;
        }
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
  if (!item) return;

  if (ignoredPath && item === ignoredPath) {
    item.visible = false;
    return;
  }

  // Quitamos de forma absoluta cualquier color de relleno para ver la foto detrás
  item.fillColor = null;
  if (item.style) {
    item.style.fillColor = null;
  }

  if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
    // Definimos contornos negros oscuros y muy visibles para guiar el grabado láser
    if (!item.strokeColor) {
      item.strokeColor = new paper.Color('#111111'); 
      item.strokeWidth = 1.5;
    } else {
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

    // Convertimos cualquier círculo o rectángulo básico a trazado vectorial Path
    convertAllShapesToPaths(item);

    const bounds = item.bounds;
    const canvasBounds = paper.view.bounds;
    const scaleX = (canvasBounds.width * 0.75) / bounds.width;
    const scaleY = (canvasBounds.height * 0.75) / bounds.height;
    const scale = Math.min(scaleX, scaleY);
    item.scale(scale);
    item.position = canvasBounds.center;

    const allPaths = collectPaths(item).filter(function(p) { return p && Math.abs(p.area) > 0; });
    allPaths.sort(function(a, b) { return Math.abs(b.area) - Math.abs(a.area); });
    
    let ignoredPath = null;
    if (shouldIgnoreLargestPath(allPaths, item)) {
      ignoredPath = allPaths.slice(0, 1).shift();
    }

    // Pasamos el svgPath para que buildCompoundMask pueda tomar decisiones inteligentes de recorte
    window.grabArea = buildCompoundMask(item, ignoredPath, svgPath);
    window.clipMask = window.grabArea ? window.grabArea.clone() : null;
    if (window.clipMask) {
      window.clipMask.visible = false;
    }

    makeMockupTransparent(item, ignoredPath);

    lockMockup(item);
    window.currentMockup = item;
    item.data = { locked: true, mockup: true, label: "Mockup" };
    
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

// Función de conversión auxiliar de apoyo
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

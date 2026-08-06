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
  if (!paths || paths.length < 2) return false; 
  
  // Extraemos el primer elemento usando desestructuración segura de ES6
  const [firstPath] = paths; 
  if (!firstPath) return false; 
  
  const fBounds = firstPath.bounds; 
  const rBounds = rootItem.bounds; 
  if (!fBounds || !rBounds || rBounds.width <= 0 || rBounds.height <= 0) return false;
  
  const wRatio = fBounds.width / rBounds.width; 
  const hRatio = fBounds.height / rBounds.height; 
  
  // Si el camino más grande es un rectángulo y cubre casi todo el SVG,
  // es definitivamente el marco rectangular externo de referencia y debe ignorarse.
  if (wRatio > 0.95 && hRatio > 0.95) { 
    if (isPathRect(firstPath)) { 
      return true; 
    } 
  } 
  return false; 
}

function isPathRect(path) { 
  if (!path) return false; 
  const bounds = path.bounds; 
  if (bounds.width <= 0 || bounds.height <= 0) return false; 
  const rectArea = bounds.width * bounds.height; 
  const pathArea = Math.abs(path.area); 
  const areaDiff = Math.abs(pathArea - rectArea); 
  let hasHandles = false; 
  if (path.curves) { 
    hasHandles = path.curves.some(function(c) { 
      return !c.isStraight(); 
    }); 
  } 
  return areaDiff < (rectArea * 0.02) && !hasHandles; 
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
  
  const [firstPath] = paths; 
  let mask = firstPath.clone(); 
  mask.applyMatrix = true; 
  const isVirola = svgPath && ( 
    svgPath.toLowerCase().indexOf("virola-") !== -1 || 
    svgPath.toLowerCase().split("/").pop().indexOf("virola") === 0 
  ); 
  const baseArea = Math.abs(mask.area); 
  const remainingPaths = paths.slice(1); 
  remainingPaths.forEach(function(path) { 
    const hole = path.clone(); 
    hole.applyMatrix = true; 
    if (mask.bounds.contains(hole.bounds.center)) { 
      const holeArea = Math.abs(hole.area); 
      const areaRatio = holeArea / baseArea; 
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
  item.fillColor = null; 
  if (item.style) { 
    item.style.fillColor = null; 
  } 
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) { 
    if (!item.strokeColor) { 
      item.strokeColor = new paper.Color("#111111"); 
      item.strokeWidth = 1.5; 
    } else { 
      item.strokeColor = new paper.Color("#111111"); 
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

function convertAllShapesToPaths(item) { 
  if (!item) return null; 
  if (item instanceof paper.Shape) { 
    const path = item.toPath(); 
    path.data = item.data; 
    path.name = item.name; 
    path.applyMatrix = true; 
    if (item.parent) { 
      item.parent.insertChild(item.index, path); 
      item.remove(); 
    } 
    return path; 
  } 
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) { 
    item.applyMatrix = true; 
  } 
  if (item.children) { 
    const children = item.children.slice(); 
    children.forEach(convertAllShapesToPaths); 
  } 
  return item; 
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
    item = convertAllShapesToPaths(item); 
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
      const [firstPath] = allPaths; 
      ignoredPath = firstPath; 
    } 
    
    window.grabArea = buildCompoundMask(item, ignoredPath, svgPath); 
    window.clipMask = window.grabArea ? window.grabArea.clone() : null; 
    if (window.clipMask) { 
      window.clipMask.visible = false; 
    } 
    makeMockupTransparent(item, ignoredPath); 
    lockMockup(item); 
    window.currentMockup = item; 
    
    item.data = { 
      locked: true, 
      mockup: true, 
      label: "Mockup", 
      svgPath: svgPath 
    }; 
    
    item.bringToFront(); 
    paper.view.update(); 
  }); 
}

export function restoreMockupReferences() { 
  const mockupItem = paper.project.activeLayer.children.find(function(c) { 
    return c.data && c.data.mockup; 
  }); 
  if (mockupItem) { 
    window.currentMockup = mockupItem; 
    
    const allPaths = collectPaths(mockupItem).filter(function(p) { return p && Math.abs(p.area) > 0; }); 
    allPaths.sort(function(a, b) { return Math.abs(b.area) - Math.abs(a.area); }); 
    
    let ignoredPath = null; 
    if (shouldIgnoreLargestPath(allPaths, mockupItem)) { 
      const [firstPath] = allPaths; 
      ignoredPath = firstPath; 
    } 
    
    const svgPath = mockupItem.data ? mockupItem.data.svgPath : null; 
    
    window.grabArea = buildCompoundMask(mockupItem, ignoredPath, svgPath); 
    window.clipMask = window.grabArea ? window.grabArea.clone() : null; 
    if (window.clipMask) { 
      window.clipMask.visible = false; 
    } 
  } else { 
    window.currentMockup = null; 
    window.grabArea = null; 
    window.clipMask = null; 
  } 
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
  group.data = { 
    locked: false, 
    clipGroup: true, 
    label: (item.data && item.data.label) ? item.data.label : "Objeto" 
  }; 
  return group; 
}


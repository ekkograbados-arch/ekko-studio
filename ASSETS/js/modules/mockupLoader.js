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

// Verifica si un trazado es el marco rectangular de la mesa de trabajo de LightBurn
function isWorkspaceFrame(path, rootItem) {
  if (!path) return false;
  const pBounds = path.bounds;
  const rBounds = rootItem.bounds;
  
  // Debe cubrir casi el 100% de los límites del SVG importado
  const wRatio = pBounds.width / rBounds.width;
  const hRatio = pBounds.height / rBounds.height;
  if (wRatio < 0.95 || hRatio < 0.95) return false;
  
  // Un marco de LightBurn siempre es un rectángulo perfecto.
  // En un rectángulo, el área geométrica es igual a la multiplicación de su ancho por su alto.
  const rectArea = pBounds.width * pBounds.height;
  const areaDifference = Math.abs(Math.abs(path.area) - rectArea);
  
  // Si la diferencia de área es menor al 2%, es un rectángulo de enmarque
  if (areaDifference > (rectArea * 0.02)) return false;
  
  return true;
}

// Genera una máscara booleana restando todos los agujeros internos de la silueta principal
function buildCompoundMask(item) {
  // Convertimos círculos/rectángulos a paths reales primero
  convertAllShapesToPaths(item);

  // Recolectamos todos los trazados
  const allPaths = collectPaths(item);

  // Filtramos los trazados ignorando el rectángulo de enmarque de LightBurn
  const paths = allPaths.filter(function(path) {
    if (!path || Math.abs(path.area) <= 0) return false;
    return !isWorkspaceFrame(path, item);
  });

  // Ordenamos de mayor a menor área para identificar la silueta base del producto
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

function makeMockupTransparent(item, rootItem) {
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
    // Si es un rectángulo de enmarque exterior del espacio de trabajo, lo ocultamos para que no confunda
    if (isWorkspaceFrame(item, rootItem)) {
      item.visible = false;
      return;
    }

    // Volvemos transparente el fondo para que se pueda ver la foto recortada por debajo
    item.fillColor = null;
    
    // CORREGIDO: Líneas de contorno sólidas, oscuras y bien visibles en lugar de gris punteado claro
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
      makeMockupTransparent(child, rootItem);
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
    makeMockupTransparent(item, item);

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


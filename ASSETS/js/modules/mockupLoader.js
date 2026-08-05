export function findLargestPath(item) {
  let biggest = null;
  function walk(obj) {
    let checkObj = obj;
    // Si es una figura geométrica básica de SVG, la convertimos a trazado para medir su área real
    if (obj instanceof paper.Shape) {
      checkObj = obj.toPath();
    }
    if ( checkObj instanceof paper.Path || checkObj instanceof paper.CompoundPath ) {
      if ( !biggest || Math.abs(checkObj.area) > Math.abs(biggest.area) ) {
        biggest = obj; 
      }
    }
    // Limpiamos la figura temporal si se creó una copia convertido a Path
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
  } else if ( item instanceof paper.Shape ) {
    // Convertimos círculos, rectángulos, elipses, etc. a trazados de Paper.js para poder recortar sobre ellos
    const converted = item.toPath();
    converted.visible = false; // Lo mantenemos oculto para que no interfiera en la vista original
    paths.push(converted);
  }
  if (item.children) {
    item.children.forEach(child => collectPaths(child, paths));
  }
  return paths;
}

function buildCompoundMask(item) {
  const paths = collectPaths(item)
    .filter(path => path && Math.abs(path.area) > 0)
    .sort((a, b) => Math.abs(b.area) - Math.abs(a.area));
  if (!paths.length) return null;
  let mask = paths.clone();
  mask.applyMatrix = true;
  for (let i = 1; i < paths.length; i++) {
    const hole = paths[i].clone();
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
  }
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
    const canvas = paper.view.bounds;
    const bounds = item.bounds;
    const scale = Math.min(
      (canvas.width * 0.75) / bounds.width,
      (canvas.height * 0.75) / bounds.height
    );
    item.scale(scale);
    item.position = canvas.center;

    // 1. Creamos la máscara de recorte para las fotos/SVGs que suba el usuario
    window.grabArea = buildCompoundMask(item);
    window.clipMask = window.grabArea ? window.grabArea.clone() : null;
    if (window.clipMask) {
      window.clipMask.visible = false;
    }

    // 2. Buscamos la silueta de fondo del mockup y la volvemos transparente
    // para que no tape la imagen cargada que se inserta por debajo.
    const biggestPath = findLargestPath(item);
    if (biggestPath) {
      biggestPath.fillColor = null; // Quita el fondo sólido de la chapita
      
      // Si el diseño de la chapita no viene con un contorno, le creamos uno punteado de guía
      if (!biggestPath.strokeColor) {
        biggestPath.strokeColor = new paper.Color('#cccccc');
        biggestPath.strokeWidth = 1.5;
        biggestPath.dashArray = ;
      }
    }

    lockMockup(item);
    window.currentMockup = item;

    item.bringToFront();
    paper.view.update();
  });
}

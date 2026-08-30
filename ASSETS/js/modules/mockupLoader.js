// 🚀 GLOBAL OVERRIDE DE CONSOLA: Silenciar logs informativos para mantener limpia la consola F12
// Esto elimina por completo el spam de pre-cargas y cargas exitosas en F12.
// Solo se mostrarán errores reales de programación (console.error) para depuración.


/* =========================================================================
Módulo: ASSETS/js/modules/mockupLoader.js (Soporte de Lienzo Infinito con Memoria Independiente - v6)
Ruta de reemplazo: ASSETS/js/modules/mockupLoader.js
Descripción: Módulo para la carga y renderizado de mockups SVG con soporte para
Lienzo Infinito interactivo para Paper.js (estilo Canva y LightBurn).

⚡ CORRECCIÓN DE ESTADO INDEPENDIENTE: Evita que el diseño de un producto (imágenes, textos, QRs)
se filtre o copie automáticamente sobre otro producto al cambiar de categoría.
========================================================================= */

window.infiniteCanvasMode = false;

function collectPaths(item, paths) {
  if (!paths) paths = [];
  if (item instanceof paper.Path || item instanceof paper.CompoundPath) {
    paths.push(item);
  } else if (item instanceof paper.Shape) {
    var converted = item.toPath();
    converted.visible = false;
    paths.push(converted);
  }
  if (item.children) {
    var children = item.children.slice();
    children.forEach(function(child) {
      collectPaths(child, paths);
    });
  }
  return paths;
}

/**
* Determina si el trazado más grande es una caja rectangular externa transparente
* (típica de exportaciones de Illustrator) que deba ser ignorada.
*/
function shouldIgnoreLargestPath(paths, rootItem, svgPath) {
  if (!paths || paths.length < 2) return false;
  var firstPath = paths[0];
  if (!firstPath) return false;
  var fBounds = firstPath.bounds;
  var rBounds = rootItem.bounds;
  if (!fBounds || !rBounds || rBounds.width <= 0 || rBounds.height <= 0) return false;

  var rectArea = fBounds.width * fBounds.height;
  var pathArea = Math.abs(firstPath.area);
  var areaDiff = Math.abs(pathArea - rectArea);

  // Un trazado es probablemente el recuadro exterior de Illustrator si su área es casi idéntica a su bounding box
  if (areaDiff < (rectArea * 0.01)) {
    var pathLower = svgPath ? svgPath.toLowerCase() : "";
    var filename = pathLower.split("/").pop() || "";
    var esProductoRectangular = false;

    if (pathLower !== "") {
      var esMate = pathLower.indexOf("mate") !== -1;
      var esVirolaSola = filename.startsWith("virola-") || filename.endsWith("-virola.svg");
      var esPulsera = pathLower.indexOf("pulsera") !== -1;

      // El cuerpo del mate es rectangular, así como las pulseras. La virola es un anillo circular.
      esProductoRectangular = (esMate && !esVirolaSola) || esPulsera;
    }

    if (esProductoRectangular) {
      return false; // No ignorar, es el área de trabajo rectangular legítima del producto (Mates, Pulseras)
    }
    return true; // Es la caja externa transparente de Illustrator, ignorarla para usar la silueta real del producto
  }
  return false;
}

function isPathRect(path) {
  if (!path) return false;
  var bounds = path.bounds;
  if (bounds.width <= 0 || bounds.height <= 0) return false;
  var rectArea = bounds.width * bounds.height;
  var pathArea = Math.abs(path.area);
  var areaDiff = Math.abs(pathArea - rectArea);
  var hasHandles = false;
  if (path.curves) {
    hasHandles = path.curves.some(function(c) {
      return !c.isStraight();
    });
  }
  return areaDiff < (rectArea * 0.02) && !hasHandles;
}

function buildCompoundMask(item, ignoredPath, svgPath) {
  var allPaths = collectPaths(item);
  var paths = allPaths.filter(function(path) {
    if (!path || Math.abs(path.area) <= 0) return false;
    if (ignoredPath && path === ignoredPath) return false;
    return true;
  });
  paths.sort(function(a, b) {
    return Math.abs(b.area) - Math.abs(a.area);
  });

  if (!paths.length) return null;
  var firstPath = paths[0];
  var mask = firstPath.clone();
  mask.applyMatrix = true;

  // CORRECCIÓN CLAVE: Identificar si es una virola de forma estricta (no un mate con virola)
  var isVirola = false;
  if (typeof svgPath === 'string' && svgPath !== "") {
    var pathLower = svgPath.toLowerCase();
    var filename = pathLower.split("/").pop();
    isVirola = filename.startsWith("virola-") || filename.endsWith("-virola.svg");
  }

  var baseArea = Math.abs(mask.area);
  var remainingPaths = paths.slice(1);
  remainingPaths.forEach(function(path) {
    var hole = path.clone();
    hole.applyMatrix = true;
    if (mask.bounds.contains(hole.bounds.center)) {
      var holeArea = Math.abs(hole.area);
      var areaRatio = holeArea / baseArea;
      if (isVirola || areaRatio < 0.15) {
        var subtractedResult = mask.subtract(hole);
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
  mask.data = { mockup: true, isMask: true };
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
    var children = item.children.slice();
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

function findLargestPath(item) {
  var biggest = null;
  function walk(obj) {
    if (obj instanceof paper.Path || obj instanceof paper.CompoundPath) {
      if (!biggest || Math.abs(obj.area) > Math.abs(biggest.area)) {
        biggest = obj;
      }
    }
    if (obj.children) {
      obj.children.forEach(walk);
    }
  }
  walk(item);
  return biggest;
}

function convertAllShapesToPaths(item) {
  if (!item) return null;
  if (item instanceof paper.Shape) {
    var path = item.toPath();
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
    var children = item.children.slice();
    children.forEach(convertAllShapesToPaths);
  }
  return item;
}

export function loadMockup(svgPath) {
  var token = ++window.loadToken;

  // 🚀 PRESERVACIÓN DE ELEMENTOS DEL USUARIO DURANTE LA CARGA ASÍNCRONA
  // ⚡ CORRECCIÓN CRÍTICA: Solo preservamos elementos si se trata exactamente del mismo producto/superficie (recarga o refresh).
  // Si estamos cambiando a otro producto o superficie diferente (currentPath !== svgPath), NO preservamos los elementos,
  // permitiendo que el lienzo cargue limpio como corresponde de forma totalmente independiente.
  var userItems = [];
  if (typeof paper !== "undefined" && paper.project && paper.project.activeLayer) {
    var currentPath = window.currentMockup && window.currentMockup.data ? window.currentMockup.data.svgPath : null;
    if (currentPath === svgPath) {
      paper.project.activeLayer.children.forEach(function(c) {
        if (c && c.data && (c.data.mockup || c.data.isMask || c.data.isSelectionBox || c.data.isHandle || c.data.isSmartGuide || c.data.isMeasurement || c.data.isTracePreview)) {
          // No guardar elementos de mockup o de interfaz
        } else if (c) {
          userItems.push(c);
        }
      });
    }
  }

  // Remover temporalmente del lienzo para que no los borre removeChildren()
  userItems.forEach(function(c) {
    c.remove();
  });

  paper.project.activeLayer.removeChildren();

  paper.project.importSVG(svgPath, function (item) {
    if (token !== window.loadToken) {
      if (item) item.remove();
      return;
    }
    if (!item) return;

    item = convertAllShapesToPaths(item);
    var bounds = item.bounds;
    var canvasBounds = paper.view.bounds;
    var scaleX = (canvasBounds.width * 0.75) / bounds.width;
    var scaleY = (canvasBounds.height * 0.75) / bounds.height;
    var scale = Math.min(scaleX, scaleY);
    item.scale(scale);
    item.position = canvasBounds.center;

    var allPaths = collectPaths(item).filter(function(p) {
      return p && Math.abs(p.area) > 0;
    });
    allPaths.sort(function(a, b) {
      return Math.abs(b.area) - Math.abs(a.area);
    });

    var ignoredPath = null;
    if (shouldIgnoreLargestPath(allPaths, item, svgPath)) {
      ignoredPath = allPaths[0];
    }

    window.grabArea = buildCompoundMask(item, ignoredPath, svgPath);
    if (window.grabArea) {
      window.grabArea.data = { mockup: true, isMask: true };
    }
    window.clipMask = window.grabArea ? window.grabArea.clone() : null;
    if (window.clipMask) {
      window.clipMask.data = { mockup: true, isMask: true };
      window.clipMask.visible = false;
    }

    makeMockupTransparent(item, ignoredPath);
    lockMockup(item);
    window.currentMockup = item;
    item.data = { locked: true, mockup: true, label: "Mockup", svgPath: svgPath };
    item.bringToFront();

    // Activar modo infinito inteligente: si es una plantilla de hoja A4 o mesa, desactivamos el clipping mask
    var isA4 = svgPath && (svgPath.toLowerCase().indexOf("a4") !== -1 || svgPath.toLowerCase().indexOf("lienzo") !== -1 || svgPath.toLowerCase().indexOf("placa") !== -1 || svgPath.toLowerCase().indexOf("mesa") !== -1 || svgPath.toLowerCase().indexOf("horizontal") !== -1);
    window.infiniteCanvasMode = isA4;

    // Recoger ítems que se hayan creado en paralelo durante la carga asíncrona de este SVG
    var itemsCreatedDuringLoad = [];
    paper.project.activeLayer.children.forEach(function(c) {
      if (c && c !== item) {
        var isUI = c.data && (c.data.mockup || c.data.isMask || c.data.isSelectionBox || c.data.isHandle || c.data.isSmartGuide || c.data.isMeasurement || c.data.isTracePreview);
        if (!isUI) {
          itemsCreatedDuringLoad.push(c);
        }
      }
    });

    // Remover temporalmente para asegurar el orden de apilado correcto por debajo
    itemsCreatedDuringLoad.forEach(function(c) {
      c.remove();
    });

    // Combinar todos los elementos de usuario
    var allUserItems = userItems.concat(itemsCreatedDuringLoad);

    // 🚀 RESTAURAR Y ENMASCARAR RETROACTIVAMENTE LOS ELEMENTOS PREVIOS Y PARALELOS DEL USUARIO
    allUserItems.forEach(function(uItem) {
      let restored;
      if (uItem.data && uItem.data.clipGroup) {
        paper.project.activeLayer.addChild(uItem);
        restored = uItem;
      } else if (!window.infiniteCanvasMode && window.clipMask) {
        restored = window.clipItem(uItem);
      } else {
        paper.project.activeLayer.addChild(uItem);
        restored = uItem;
      }
      // Insertar por debajo del mockup
      if (window.currentMockup && restored) {
        restored.insertBelow(window.currentMockup);
      }
    });

    paper.view.update();
  });
}

export function restoreMockupReferences() {
  var mockupItem = paper.project.activeLayer.children.find(function(c) {
    return c.data && c.data.mockup;
  });
  if (mockupItem) {
    window.currentMockup = mockupItem;
    var allPaths = collectPaths(mockupItem).filter(function(p) {
      return p && Math.abs(p.area) > 0;
    });
    allPaths.sort(function(a, b) {
      return Math.abs(b.area) - Math.abs(a.area);
    });
    var ignoredPath = null;
    var svgPath = (mockupItem.data && mockupItem.data.svgPath) ? mockupItem.data.svgPath : "";

    // Sincronizar el modo de lienzo infinito inteligente al restaurar referencias
    var isA4 = svgPath && (svgPath.toLowerCase().indexOf("a4") !== -1 || svgPath.toLowerCase().indexOf("lienzo") !== -1 || svgPath.toLowerCase().indexOf("placa") !== -1 || svgPath.toLowerCase().indexOf("mesa") !== -1 || svgPath.toLowerCase().indexOf("horizontal") !== -1);
    window.infiniteCanvasMode = isA4;

    if (shouldIgnoreLargestPath(allPaths, mockupItem, svgPath)) {
      ignoredPath = allPaths[0];
    }
    window.grabArea = buildCompoundMask(mockupItem, ignoredPath, svgPath);
    if (window.grabArea) {
      window.grabArea.data = { mockup: true, isMask: true };
    }
    window.clipMask = window.grabArea ? window.grabArea.clone() : null;
    if (window.clipMask) {
      window.clipMask.data = { mockup: true, isMask: true };
      window.clipMask.visible = false;
    }
  } else {
    window.currentMockup = null;
    window.grabArea = null;
    window.clipMask = null;
  }
}

window.clipItem = function(item) {
  if (window.infiniteCanvasMode || !window.clipMask) {
    return item;
  }
  var mask = window.clipMask.clone();
  mask.clipMask = true;
  mask.visible = true;
  mask.data = { mockup: true, isMask: true };
  var group = new paper.Group();
  group.addChild(mask);
  group.addChild(item);
  group.clipped = true;
  group.data = {
    locked: false,
    clipGroup: true,
    label: (item.data && item.data.label) ? item.data.label : "Objeto"
  };
  return group;
};

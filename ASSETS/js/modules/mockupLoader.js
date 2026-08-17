/**
 * ASSETS/js/modules/mockupLoader.js (Corrected v2)
 * 
 * Carga, centrado y persistencia de mockups de productos y sus máscaras de recorte.
 * Corrige el error por el cual los productos con áreas rectangulares legítimas 
 * (como los Mates, Medallas Militares y Pulseras) eran ocultados y descartados de la máscara de recorte.
 */

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
 * 
 * CORRECCIÓN ROBUSTA: Sin parámetros por defecto conflictivos para evitar errores sintácticos.
 * Se remueve la palabra "militar" de los productos legítimamente rectangulares para que las
 * Medallas Militares se procesen por silueta con curvas y sustracción de orificios.
 */
function shouldIgnoreLargestPath(paths, rootItem, svgPath) {
    if (!paths || paths.length < 2) return false;
    
    var firstPath = paths[0];
    if (!firstPath) return false;
    
    var fBounds = firstPath.bounds;
    var rBounds = rootItem.bounds;
    if (!fBounds || !rBounds || rBounds.width <= 0 || rBounds.height <= 0) return false;
    
    var wRatio = fBounds.width / rBounds.width;
    var hRatio = fBounds.height / rBounds.height;
    
    if (wRatio > 0.95 && hRatio > 0.95) {
        if (isPathRect(firstPath)) {
            var esProductoRectangular = false;
            if (typeof svgPath === 'string' && svgPath !== "") {
                var pathLower = svgPath.toLowerCase();
                esProductoRectangular = (
                    pathLower.indexOf("mate") !== -1 ||
                    pathLower.indexOf("pulsera") !== -1
                ) && pathLower.indexOf("virola") === -1;
            }
            
            if (esProductoRectangular) {
                return false; // No ignorar, es el área de trabajo legítima del producto (Mates, Pulseras)
            }
            return true; // Es la caja externa transparente de Illustrator, ignorarla para usar la silueta real
        }
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
    
    var isVirola = false;
    if (typeof svgPath === 'string' && svgPath !== "") {
        var pathLower = svgPath.toLowerCase();
        isVirola = pathLower.indexOf("virola-") !== -1 || 
                   pathLower.split("/").pop().indexOf("virola") === 0;
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
        window.clipMask = window.grabArea ? window.grabArea.clone() : null;
        if (window.clipMask) {
            window.clipMask.visible = false;
        }
        makeMockupTransparent(item, ignoredPath);
        lockMockup(item);
        window.currentMockup = item;
        item.data = { locked: true, mockup: true, label: "Mockup", svgPath: svgPath };
        item.bringToFront();
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
        if (shouldIgnoreLargestPath(allPaths, mockupItem, svgPath)) {
            ignoredPath = allPaths[0];
        }
        
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
    var mask = window.clipMask.clone();
    mask.clipMask = true;
    mask.visible = true;
    var group = new paper.Group();
    group.addChild(mask);
    group.addChild(item);
    group.clipped = true;
    group.data = { locked: false, clipGroup: true, label: (item.data && item.data.label) ? item.data.label : "Objeto" };
    return group;
}

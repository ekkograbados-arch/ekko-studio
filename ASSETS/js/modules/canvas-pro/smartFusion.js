/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/smartFusion.js
ACCIÓN: REEMPLAZAR COMPLETAMENTE
ESTADO: ENTREGADO Y VALIDADO EN SUIZA v10.2 (VERSION v45.11 ANTI CACHE DESYNC)
DEPENDENCIAS DIRECTAS: ASSETS/js/modules/canvas-pro/geometricUngroup.js
======================================================================== */

import { recalculateDynamicSubtractions } from "./geometricUngroup.js";

// Grupo global para almacenar halos de snapping temporales
let snappingHalosGroup = null;
let activeSnappedVector = null;

/**
 * Obtiene el elemento de contenido real si el item está encapsulado en un grupo de recorte
 */
function getContentItem(item) {
    if (!item) return null;
    if (item.data && item.data.clipGroup) {
        if (!item.children) return item;
        const content = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
        if (content) return content;
        const fallback = item.children.find(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask || c.data.mockup)));
        if (fallback) return fallback;
        return item.children[1] || item.children[0] || item;
    }
    return item;
}

/**
 * Limpia y remueve un grupo de recorte (clipGroup) si ha quedado vacío (sin hijos de diseño útiles).
 */
function cleanEmptyClipGroup(parent) {
    if (parent && parent.data && parent.data.clipGroup) {
        const designChildren = parent.children.filter(c => !c.clipMask && !(c.data && (c.data.wasClipMask || c.data.isMask)));
        if (designChildren.length === 0) {
            parent.remove();
        }
    }
}

/**
 * Detecta si un elemento es parte del mockup del producto base o una de sus guías.
 */
function isMockupOrProductElement(item) {
    let curr = item;
    while (curr) {
        if (curr.clipMask || (curr.data && (curr.data.mockup || curr.data.isMask || curr.data.wasClipMask))) {
            return true;
        }
        if (curr === window.currentMockup) {
            return true;
        }
        curr = curr.parent;
    }
    return false;
}

/**
 * Aplica y hornea una matriz de transformación de forma recursiva y ultra-precisa
 * en los segmentos y curvas de un trazado (Path o CompoundPath), evitando fallos de Paper.js.
 */
function bakeMatrixIntoPath(path, matrix) {
    if (!path || !matrix || matrix.isIdentity()) return;
    if (path.segments && path.segments.length > 0) {
        path.segments.forEach(seg => {
            seg.point = matrix.transform(seg.point);
            if (seg.handleIn) seg.handleIn = matrix.transform(seg.handleIn).subtract(matrix.transform(new paper.Point(0, 0)));
            if (seg.handleOut) seg.handleOut = matrix.transform(seg.handleOut).subtract(matrix.transform(new paper.Point(0, 0)));
        });
    }
    if (path.children && path.children.length > 0) {
        const childrenArr = Array.from(path.children);
        childrenArr.forEach(child => bakeMatrixIntoPath(child, matrix));
    }
}

/**
 * Obtiene un clon de un elemento con su sistema de coordenadas aplanado en absoluto (coordenadas de mundo).
 */
function getAbsoluteClone(item) {
    if (!item) return null;
    const clone = item.clone({ insert: false });
    const globalMat = item.globalMatrix.clone();
    
    // Insertamos temporalmente en la capa activa para asegurar contexto
    paper.project.activeLayer.addChild(clone);
    if (clone.className === 'Path' || clone.className === 'CompoundPath') {
        bakeMatrixIntoPath(clone, globalMat);
        clone.matrix = new paper.Matrix(); // Reseteamos a identidad
    } else {
        clone.matrix = globalMat;
    }
    return clone;
}

/**
 * Aplica la Fusión Inteligente entre un vector de corte y una imagen (Raster).
 */
export function applySmartFusion(vector, raster, mode = 'calar') {
    if (!vector || !raster || !paper) return null;

    // BLINDAJE DE CONTENCIÓN (MOCKUP LOCK)
    if (isMockupOrProductElement(vector) || vector.clipMask) {
        console.error("❌ [MOCKUP_LOCK]: Intento de usar la plantilla o máscara de producto como vector de corte. Operación cancelada.");
        return null;
    }
    if (isMockupOrProductElement(raster) || raster.clipMask) {
        console.error("❌ [MOCKUP_LOCK]: Intento de usar la plantilla o máscara de producto como imagen. Operación cancelada.");
        return null;
    }

    if (typeof window.saveHistory === 'function') window.saveHistory();

    // 1. Obtener copias con geometría aplanada en espacio absoluto de coordenadas (Lienzo General)
    const absoluteVector = getAbsoluteClone(vector);
    const absoluteRaster = getAbsoluteClone(raster);

    // 2. Crear respaldos inmaculados para disolución (release) y edición de nodos
    const originalVectorGeom = absoluteVector.clone({ insert: false });
    const originalRasterGeom = absoluteRaster.clone({ insert: false });

    let maskItem = null;
    let fusionGroup = new paper.Group();

    if (mode === 'intersecar') {
        // MODO INTERSECCIÓN: La imagen vive únicamente dentro de la letra (Canva-Style)
        maskItem = absoluteVector.clone();
        maskItem.clipMask = true;
        fusionGroup.addChild(maskItem);
        fusionGroup.addChild(absoluteRaster.clone());
    } else {
        // MODO CALAR: El vector corta y perfora la imagen dejando ver el fondo (Troquelado Inverso)
        const outerRect = new paper.Path.Rectangle(absoluteRaster.bounds);
        const inverseMask = new paper.CompoundPath({ insert: false });
        inverseMask.fillRule = 'evenodd';
        inverseMask.addChild(outerRect);
        inverseMask.addChild(absoluteVector.clone());
        
        inverseMask.clipMask = true;
        maskItem = inverseMask;
        
        fusionGroup.addChild(maskItem);
        fusionGroup.addChild(absoluteRaster.clone());
    }

    // Configurar propiedades de Contenedor Inteligente de Fusión
    fusionGroup.clipped = true;
    fusionGroup.data = {
        isSmartFusion: true,
        fusionMode: mode,
        originalVectorData: originalVectorGeom,
        originalRasterData: originalRasterGeom,
        vectorId: vector.id,
        rasterId: raster.id,
        label: "Fusión Inteligente"
    };

    if (mode === 'calar') {
        fusionGroup.data.isHole = true;
        fusionGroup.data.geomBase = originalVectorGeom.clone({ insert: false });
    } else {
        fusionGroup.data.isHole = false;
        fusionGroup.data.geomBase = null;
    }

    maskItem.data = {
        ...(maskItem.data || {}),
        isHole: false,
        geomBase: null
    };

    overrideChildrenSelection(fusionGroup);

    // 💥 SOBREESCRITURA DE SELECCIÓN EN EL CONTENEDOR (v45.9):
    Object.defineProperty(fusionGroup, 'selected', {
        get: function() {
            return this._selected;
        },
        set: function(val) {
            this._selected = val;
        },
        configurable: true,
        enumerable: true
    });

    // 💥 MONKEY PATCH DE BOUNDS: Sobreescribe bounds para alineación de tiradores celestes y cotas en mm
    Object.defineProperty(fusionGroup, 'bounds', {
        get: function() {
            return this.children[0] ? this.children[0].bounds : new paper.Rectangle();
        },
        configurable: true,
        enumerable: true
    });

    // 3. Remover los elementos originales y limpiar sus grupos contenedores vacíos
    const vectorParent = vector.parent;
    const rasterParent = raster.parent;
    vector.remove();
    raster.remove();
    cleanEmptyClipGroup(vectorParent);
    cleanEmptyClipGroup(rasterParent);

    absoluteVector.remove();
    absoluteRaster.remove();

    // 4. Enmascarar la Fusión resultante al producto mockup usando la función nativa clipItem
    let finalItem = fusionGroup;
    if (typeof window.clipItem === 'function' && !window.infiniteCanvasMode && window.clipMask) {
        finalItem = window.clipItem(fusionGroup);
    }

    if (finalItem !== fusionGroup) {
        Object.defineProperty(finalItem, 'selected', {
            get: function() {
                return this._selected;
            },
            set: function(val) {
                this._selected = val;
                if (fusionGroup) {
                    fusionGroup.selected = val;
                }
            },
            configurable: true,
            enumerable: true
        });
    }

    const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
    designLayer.addChild(finalItem);
    if (window.currentMockup) {
        finalItem.insertBelow(window.currentMockup);
    }

    if (typeof window.syncGeometryToGeomBase === 'function') {
        window.syncGeometryToGeomBase(finalItem);
    }

    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }

    if (typeof window.deselectItem === 'function') window.deselectItem();
    if (typeof window.selectItem === 'function') {
        window.selectItem(finalItem);
    }

    paper.view.update();
    return finalItem;
}

/**
 * Busca el contenedor inteligente de fusión (isSmartFusion) explorando el elemento mismo,
 * sus padres (hacia arriba) o sus hijos (hacia abajo).
 */
function findSmartFusionContainer(item) {
    if (!item) return null;
    if (item.data && item.data.isSmartFusion) {
        return item;
    }
    if (item.children && item.children.length > 0) {
        let found = null;
        function traverse(node) {
            if (node.data && node.data.isSmartFusion) {
                found = node;
                return;
            }
            if (node.children) {
                for (let i = 0; i < node.children.length; i++) {
                    traverse(node.children[i]);
                    if (found) return;
                }
            }
        }
        traverse(item);
        if (found) return found;
    }
    let curr = item.parent;
    while (curr && curr !== paper.project) {
        if (curr.data && curr.data.isSmartFusion) {
            return curr;
        }
        curr = curr.parent;
    }
    return null;
}

/**
 * Sobreescribe recursivamente el getter y setter de 'selected' en todos los hijos
 */
function overrideChildrenSelection(group) {
    if (!group || !group.children) return;
    group.children.forEach(child => {
        try {
            Object.defineProperty(child, 'selected', {
                get: function() { return false; },
                set: function(val) { /* ignorar */ },
                configurable: true,
                enumerable: true
            });
        } catch (e) {
            console.warn("No se pudo sobreescribir 'selected' para el hijo:", child.id, e);
        }
        if (child.children && child.children.length > 0) {
            overrideChildrenSelection(child);
        }
    });
}

/**
 * Monitorea el arrastre de imágenes y calcula el Snapping Magnético contra calados isHole cercanos.
 */
export function checkMagneticSnapping(rasterItem) {
    if (!rasterItem || !paper.project) return;
    const zoom = paper.view.zoom || 1.0;
    const snapDistance = 35 / zoom; // Umbral de imán reactivo
    
    // Obtener los vectores con calado activo (isHole = true) en el lienzo
    const targets = paper.project.activeLayer.children.filter(item => {
        const displayItem = getContentItem(item);
        return displayItem && displayItem.data && displayItem.data.isHole === true;
    });

    let foundNext = null;
    let minDistance = snapDistance;

    targets.forEach(vector => {
        const vBounds = vector.bounds;
        const rBounds = rasterItem.bounds;
        if (vBounds && rBounds) {
            const dist = rBounds.center.getDistance(vBounds.center);
            if (dist < minDistance) {
                minDistance = dist;
                foundNext = vector;
            }
        }
    });

    if (foundNext) {
        activeSnappedVector = foundNext;
        if (!snappingHalosGroup) {
            snappingHalosGroup = new paper.Group();
            snappingHalosGroup.data = { isSelectionBox: true, isSmartGuide: true };
        }
        snappingHalosGroup.removeChildren();

        // Dibujar el contorno cian sobre el receptor
        const displayItem = getContentItem(foundNext);
        if (displayItem && displayItem.bounds) {
            const halo = new paper.Path.Rectangle(displayItem.bounds);
            halo.strokeColor = '#00d2ff'; // Cian reactivo
            halo.strokeWidth = 2.0 / zoom;
            halo.dashArray = [4 / zoom, 4 / zoom];
            snappingHalosGroup.addChild(halo);
        }

        // Adherir la posición al centro del vector de forma líquida
        const delta = displayItem.bounds.center.subtract(rasterItem.bounds.center);
        rasterItem.position = rasterItem.position.add(delta);
        if (rasterItem.parent && rasterItem.parent.data && rasterItem.parent.data.clipGroup) {
            rasterItem.parent.position = rasterItem.parent.position.add(delta);
        }

        if (paper.view && paper.view.element) {
            paper.view.element.style.cursor = 'copy';
        }
    } else {
        activeSnappedVector = null;
        if (snappingHalosGroup) {
            snappingHalosGroup.remove();
            snappingHalosGroup = null;
        }
        if (paper.view && paper.view.element) {
            paper.view.element.style.cursor = 'default';
        }
    }
    paper.view.update();
}

/**
 * Consolida la fusión asíncrona si la imagen es soltada sobre un receptor magnético activo.
 */
export function handleMagneticDrop(rasterItem) {
    if (activeSnappedVector && rasterItem) {
        const snapped = activeSnappedVector;
        activeSnappedVector = null;
        if (snappingHalosGroup) {
            snappingHalosGroup.remove();
            snappingHalosGroup = null;
        }
        applySmartFusion(snapped, rasterItem, 'intersecar');
    }
}

/**
 * Recalcula la sustracción de la fusión inteligente ante deformaciones en caliente de Editar Nodos (v45.0).
 */
export function recalculateSmartFusion(fusionGroup) {
    if (!fusionGroup || !fusionGroup.data || !fusionGroup.data.isSmartFusion) return;
    const mode = fusionGroup.data.fusionMode;
    const maskItem = fusionGroup.children[0]; // La máscara es el primer hijo
    const rasterItem = fusionGroup.children[1]; // La imagen es el segundo hijo
    
    if (mode === 'calar' && maskItem && rasterItem) {
        const currentVector = fusionGroup.data.originalVectorData;
        if (currentVector) {
            const outerRect = new paper.Path.Rectangle(rasterItem.bounds);
            const newInverseMask = new paper.CompoundPath({ insert: false });
            newInverseMask.fillRule = 'evenodd';
            newInverseMask.addChild(outerRect);
            newInverseMask.addChild(currentVector.clone());

            newInverseMask.fillColor = null;
            newInverseMask.strokeColor = null;
            newInverseMask.strokeWidth = 0;
            newInverseMask.data = {
                ...(newInverseMask.data || {}),
                isHole: false,
                geomBase: null
            };

            try {
                Object.defineProperty(newInverseMask, 'selected', {
                    get: function() { return false; },
                    set: function(val) { /* ignorar */ },
                    configurable: true,
                    enumerable: true
                });
            } catch(e) {}

            newInverseMask.clipMask = true;
            maskItem.replaceWith(newInverseMask);
        }
    }
}

/**
 * Disuelve la Fusión Inteligente reconstituyendo los vectores y fotos intactas.
 */
export function releaseSmartFusion(item) {
    if (!item) return;

    let targetItem = item;
    if (Array.isArray(item)) {
        for (let i = 0; i < item.length; i++) {
            const found = findSmartFusionContainer(item[i]);
            if (found) {
                targetItem = found;
                break;
            }
        }
    }

    const fusionGroup = findSmartFusionContainer(targetItem);
    if (!fusionGroup || !fusionGroup.data || !fusionGroup.data.isSmartFusion) {
        console.error("❌ [RELEASE_LOCK]: El elemento seleccionado no es parte de una Fusión Inteligente activa.");
        return;
    }

    if (typeof window.saveHistory === 'function') window.saveHistory();

    const restoredVector = fusionGroup.data.originalVectorData.clone();
    const restoredRaster = fusionGroup.data.originalRasterData.clone();

    restoredVector.position = fusionGroup.position.clone();
    restoredRaster.position = fusionGroup.position.clone();
    restoredVector.data = { isHole: true, label: "Trazado Calado" };
    restoredRaster.data = { label: "Imagen" };

    let finalVector = restoredVector;
    let finalRaster = restoredRaster;

    if (typeof window.clipItem === 'function' && !window.infiniteCanvasMode && window.clipMask) {
        finalVector = window.clipItem(restoredVector);
        finalRaster = window.clipItem(restoredRaster);
    } else {
        paper.project.activeLayer.addChild(finalVector);
        paper.project.activeLayer.addChild(finalRaster);
    }

    if (window.currentMockup) {
        finalVector.insertBelow(window.currentMockup);
        finalRaster.insertBelow(window.currentMockup);
    }

    if (typeof window.syncGeometryToGeomBase === 'function') {
        window.syncGeometryToGeomBase(finalVector);
        window.syncGeometryToGeomBase(finalRaster);
    }

    const parentGroup = fusionGroup.parent;
    fusionGroup.remove();
    cleanEmptyClipGroup(parentGroup);

    if (typeof window.deselectItem === 'function') window.deselectItem();
    if (typeof window.selectItem === 'function') {
        window.selectItem(finalRaster);
    }

    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }

    paper.view.update();
    console.log("🔓 [RELEASE_SUCCESS]: Fusión Inteligente disuelta con éxito. Elementos vectoriales y fotos restituidos a su cuna original.");
}

/**
 * Inicializa los disparadores globales de escucha para el lienzo de diseño.
 */
export function initSmartFusionListeners() {
    if (typeof window !== 'undefined') {
        window.applySmartFusion = applySmartFusion;
        window.checkMagneticSnapping = checkMagneticSnapping;
        window.handleMagneticDrop = handleMagneticDrop;
        window.recalculateSmartFusion = recalculateSmartFusion;
        window.releaseSmartFusion = releaseSmartFusion;
        window.initSmartFusionListeners = initSmartFusionListeners;
    }
    console.log("%c[EKKO SMART FUSION] Escuchadores asíncronos de Fusión y Snapping cargados con éxito (v45.11).", "color: #0284c7; font-weight: bold;");
}

/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/smartFusion.js
ACCIÓN: REEMPLAZAR COMPLETAMENTE
ESTADO: PENDIENTE DE VALIDACIÓN CONTRA CONTRATO
DEPENDENCIAS DIRECTAS: ASSETS/js/modules/canvas-pro/geometricUngroup.js
======================================================================== */

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/smartFusion.js (Smart Fusion & Magnetic Snapping Engine v45.9 - Absolute Coordinate Snapping & Selection Lock)
Descripción:
    Núcleo matemático de la Fusión Inteligente y Anclaje Magnético para EKKO Studio.
    Soluciona de forma definitiva las derivas de arrastre, las cotas desfasadas,
    la duplicidad de cajas de selección y el bloqueo de desvinculación (release).
    Inmune a desfaces de Paper.js mediante anulación de jerarquías locales, bakeo absoluto
    y sobreescritura dinámica del getter de 'bounds'.
========================================================================= */

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
        if (curr.clipMask || (curr.data && (
            curr.data.mockup ||
            curr.data.isMask ||
            curr.data.locked ||
            curr.data.isSelectionBox ||
            curr.data.isSmartGuide ||
            curr.data.isMeasurement
        ))) {
            return true;
        }
        const label = (curr.data?.label || '').toLowerCase();
        if (label.includes('chapita') || label.includes('huesito') || label.includes('termo') || label.includes('mate') || label.includes('llavero') || label.includes('producto') || label.includes('plantilla')) {
            return true;
        }
        curr = curr.parent;
    }
    return false;
}

/**
 * Obtiene un clon de un elemento con su sistema de coordenadas aplanado en absoluto (coordenadas de mundo).
 */
/**
 * Aplica y hornea una matriz de transformación de forma recursiva y ultra-precisa
 * en los segmentos y curvas de un trazado (Path o CompoundPath), evitando fallos de Paper.js.
 */
function bakeMatrixIntoPath(path, matrix) {
    if (!path || !matrix || matrix.isIdentity()) return;
    if (path.segments && path.segments.length > 0) {
        path.segments.forEach(seg => {
            seg.point = matrix.transform(seg.point);
            if (seg.handleIn) {
                const hInGlobal = matrix.transform(seg.point.add(seg.handleIn));
                seg.handleIn = hInGlobal.subtract(seg.point);
            }
            if (seg.handleOut) {
                const hOutGlobal = matrix.transform(seg.point.add(seg.handleOut));
                seg.handleOut = hOutGlobal.subtract(seg.point);
            }
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
        // Horneamos físicamente la matriz global usando nuestro motor ultra-preciso
        bakeMatrixIntoPath(clone, globalMat);
        clone.matrix = new paper.Matrix(); // Reseteamos a identidad
    } else {
        clone.matrix = globalMat;
    }
    return clone;
}

/**
 * Aplica la Fusión Inteligente entre un vector de corte y una imagen (Raster).
 * @param {paper.Item} vector - El trazado vectorial que actúa como troquel o molde.
 * @param {paper.Raster} raster - La imagen de mapa de bits a enmascarar o calar.
 * @param {string} mode - 'intersecar' (Messi dentro del vector) o 'calar' (vector perfora a Messi).
 * @returns {paper.Group} El contenedor inteligente resultante.
 */
/**
 * Busca el contenedor inteligente de fusión (isSmartFusion) explorando el elemento mismo,
 * sus padres (hacia arriba) o sus hijos (hacia abajo, para wrappers de clipGroup).
 */
function findSmartFusionContainer(item) {
    if (!item) return null;

    // 1. Buscar en el elemento mismo
    if (item.data && item.data.isSmartFusion) {
        return item;
    }

    // 2. Buscar hacia abajo en los hijos de forma recursiva y segura
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

    // 3. Buscar hacia arriba en los padres
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
 * de un grupo de fusión para evitar que Paper.js o selection.js dibujen cajas
 * de selección o contornos punteados desfasados para la imagen de fondo o la máscara.
 */
function overrideChildrenSelection(group) {
    if (!group || !group.children) return;
    group.children.forEach(child => {
        try {
            Object.defineProperty(child, 'selected', {
                get: function() { return false; },
                set: function(val) { /* ignorar silenciosamente */ },
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
        
        // Purgar de forma estricta los estilos visuales de la máscara interna
        maskItem.fillColor = null;
        maskItem.strokeColor = null;
        maskItem.strokeWidth = 0;
        
        maskItem.clipMask = true;
        
        // Agregar al grupo: Primero la máscara de corte, luego la foto
        fusionGroup.addChild(maskItem);
        fusionGroup.addChild(absoluteRaster.clone());
    } else {
        // MODO CALAR: La letra actúa como sacabocados (HUECO REAL) que perfora la foto (Even-Odd rule)
        const outerRect = new paper.Path.Rectangle(absoluteRaster.bounds);
        
        const inverseMask = new paper.CompoundPath({ insert: false });
        inverseMask.fillRule = 'evenodd';
        inverseMask.addChild(outerRect);
        inverseMask.addChild(absoluteVector.clone());

        // Limpiar estilos para que no herede rellenos negros
        inverseMask.fillColor = null;
        inverseMask.strokeColor = null;
        inverseMask.strokeWidth = 0;

        inverseMask.clipMask = true;
        maskItem = inverseMask;

        // Agregar al grupo: Primero la máscara inversa, luego la foto
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

    // Configurar de forma limpia las marcas de calado e integridad de selección
    if (mode === 'calar') {
        fusionGroup.data.isHole = true;
        fusionGroup.data.geomBase = originalVectorGeom.clone({ insert: false });
    } else {
        fusionGroup.data.isHole = false;
        fusionGroup.data.geomBase = null;
    }

    // Sanitizar el maskItem hijo de marcas de calado redundantes para evitar la doble caja de selección o desfaces
    maskItem.data = {
        ...(maskItem.data || {}),
        isHole: false,
        geomBase: null
    };

    // Forzar deselección absoluta en los sub-elementos para que no haya cajas desalineadas en pantalla
    overrideChildrenSelection(fusionGroup);

    // 💥 SOBREESCRITURA DE SELECCIÓN EN EL CONTENEDOR (v45.9):
    // Evita que Paper.js propague recursivamente la selección a los hijos (la máscara y la foto)
    // lo cual generaba el error de doble caja de selección desfasada y tirones de arrastre.
    Object.defineProperty(fusionGroup, 'selected', {
        get: function() {
            return this._selected;
        },
        set: function(val) {
            this._selected = val;
            // No propagamos a los hijos! Esto mantiene a la máscara y a la foto con selected = false,
            // garantizando que paper.project.selectedItems solo contenga al grupo de fusión.
        },
        configurable: true,
        enumerable: true
    });

    // 💥 MONKEY PATCH DE BOUNDS: Sobreescribe dinámicamente el getter de bounds para que el bounding box
    // de Paper.js y selection.js represente con precisión milimétrica el contorno del molde (la letra)
    // y no la gran foto de Messi detrás, alineando así las cotas en mm y manijas celestes de arrastre.
    Object.defineProperty(fusionGroup, 'bounds', {
        get: function() {
            // El primer hijo (children[0]) es siempre maskItem (nuestro troquel / vector "F")
            return this.children[0] ? this.children[0].bounds : new paper.Rectangle();
        },
        configurable: true,
        enumerable: true
    });

    // 3. Remover los elementos originales y limpiar sus grupos contenedores vacíos (Evita ID Corrupto)
    const vectorParent = vector.parent;
    const rasterParent = raster.parent;

    vector.remove();
    raster.remove();

    cleanEmptyClipGroup(vectorParent);
    cleanEmptyClipGroup(rasterParent);

    // Liberar clones temporales absolutos
    absoluteVector.remove();
    absoluteRaster.remove();

    // 4. Enmascarar la Fusión resultante al producto mockup usando la función nativa clipItem
    let finalItem = fusionGroup;
    if (typeof window.clipItem === 'function' && !window.infiniteCanvasMode && window.clipMask) {
        finalItem = window.clipItem(fusionGroup);
    }

    // 💥 SOBREESCRITURA DE SELECCIÓN EN EL PADRE WRAPPER (clipGroup):
    // Si se creó un grupo de recorte para el mockup base, bloqueamos la propagación a la máscara de producto.
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

    // Insertar en la capa de diseño principal
    const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
    designLayer.addChild(finalItem);
    if (window.currentMockup) {
        finalItem.insertBelow(window.currentMockup);
    }

    // Sincronizar geomBase para reactividad CSG en la marquesina de Paper.js
    if (typeof window.syncGeometryToGeomBase === 'function') {
        window.syncGeometryToGeomBase(finalItem);
    }

    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }

    // Actualizar selección y controles celestes
    if (typeof window.deselectItem === 'function') window.deselectItem();
    if (typeof window.selectItem === 'function') {
        window.selectItem(finalItem);
    }

    paper.view.update();
    return finalItem;
}

/**
 * Monitorea el arrastre de imágenes y calcula el Snapping Magnético contra calados isHole cercanos.
 * @param {paper.Raster} rasterItem - La imagen que está siendo arrastrada.
 */
export function checkMagneticSnapping(rasterItem) {
    if (!rasterItem || !paper.project) return;

    const zoom = paper.view.zoom || 1.0;
    const snapDistance = 35 / zoom; // Umbral de imán reactivo a la escala física del lienzo

    // Inicializar contenedor de halos si no existe
    if (!snappingHalosGroup) {
        snappingHalosGroup = new paper.Group();
        snappingHalosGroup.data = { isSnappingOverlay: true, isSelectionBox: true };
    } else {
        snappingHalosGroup.removeChildren();
    }

    let nearestVector = null;
    let minDistance = snapDistance;

    // Buscar vectores de calado activo (isHole) en la capa de diseño
    const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
    
    designLayer.accept({
        visit: function(item) {
            const actualItem = getContentItem(item);
            if (actualItem && actualItem.data && actualItem.data.isHole && (actualItem.className === 'Path' || actualItem.className === 'CompoundPath') && !isMockupOrProductElement(actualItem)) {
                const itemCenter = actualItem.bounds.center;
                const rasterCenter = rasterItem.bounds.center;
                const dist = rasterCenter.getDistance(itemCenter);
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestVector = actualItem;
                }
            }
        }
    });

    if (nearestVector) {
        activeSnappedVector = nearestVector;

        // Proyectar un HALO CIAN BRILLANTE sobre el vector receptor
        const snapHalo = nearestVector.clone();
        snapHalo.strokeColor = '#00f0ff';
        snapHalo.strokeWidth = 3 / zoom;
        snapHalo.fillColor = new paper.Color(0, 240, 255, 0.1);
        snapHalo.data = { isSelectionBox: true };
        snappingHalosGroup.addChild(snapHalo);

        // Generar atracción magnética: alinear el centro del raster al del vector
        const delta = nearestVector.bounds.center.subtract(rasterItem.bounds.center);
        rasterItem.position = rasterItem.position.add(delta);
        
        // Si el rasterItem tiene un clipGroup padre, mover el padre también para mantener sincronización
        if (rasterItem.parent && rasterItem.parent.data && rasterItem.parent.data.clipGroup) {
            rasterItem.parent.position = rasterItem.parent.position.add(delta);
        }
        
        if (paper.view && paper.view.element) {
            paper.view.element.style.cursor = 'copy'; // Cursor visual de adhesión
        }
    } else {
        activeSnappedVector = null;
        if (paper.view && paper.view.element) {
            paper.view.element.style.cursor = 'default';
        }
    }

    paper.view.update();
}

/**
 * Consolida la fusión asíncrona si la imagen es soltada sobre un receptor magnético activo.
 * @param {paper.Raster} rasterItem
 */
export function handleMagneticDrop(rasterItem) {
    if (activeSnappedVector && rasterItem) {
        const snapped = activeSnappedVector;
        activeSnappedVector = null;
        if (snappingHalosGroup) {
            snappingHalosGroup.remove();
            snappingHalosGroup = null;
        }
        // Fusionar en caliente en modo INTERSECAR (Canva-style)
        applySmartFusion(snapped, rasterItem, 'intersecar');
    }
}

/**
 * Recalcula la sustracción de la fusión inteligente ante deformaciones en caliente de Editar Nodos (v45.0).
 * @param {paper.Group} fusionGroup - El grupo fusionado isSmartFusion.
 */
export function recalculateSmartFusion(fusionGroup) {
    if (!fusionGroup || !fusionGroup.data || !fusionGroup.data.isSmartFusion) return;

    const mode = fusionGroup.data.fusionMode;
    const maskItem = fusionGroup.children[0]; // La máscara es el primer hijo
    const rasterItem = fusionGroup.children[1]; // La imagen es el segundo hijo

    if (mode === 'calar' && maskItem && rasterItem) {
        // Si el vector que cala se deforma, regeneramos la máscara inversa en tiempo real (Even-Odd method)
        const currentVector = fusionGroup.data.originalVectorData; 
        if (currentVector) {
            const outerRect = new paper.Path.Rectangle(rasterItem.bounds);
            
            const newInverseMask = new paper.CompoundPath({ insert: false });
            newInverseMask.fillRule = 'evenodd';
            newInverseMask.addChild(outerRect);
            newInverseMask.addChild(currentVector.clone());

            // Purgar de forma estricta los estilos visuales de la máscara interna
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

            // Reemplazar la máscara vieja por la nueva sin perder el clipping
            newInverseMask.clipMask = true;
            maskItem.replaceWith(newInverseMask);
        }
    }
}

/**
 * Disuelve la Fusión Inteligente reconstituyendo los vectores y fotos intactas.
 * @param {paper.Group} item - El elemento a disolver o cualquiera de sus hijos.
 */
export function releaseSmartFusion(item) {
    if (!item) return;

    // 💥 SOPORTE PARA ENTRADAS MÚLTIPLES O ARREGLOS DE SELECCIÓN (v45.9):
    // Si se pasa paper.project.selectedItems como un arreglo, extraemos el contenedor de fusión real.
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

    // Recuperar respaldos de memoria originales (que ya están en coordenadas absolutas)
    const restoredVector = fusionGroup.data.originalVectorData.clone();
    const restoredRaster = fusionGroup.data.originalRasterData.clone();

    // Restituyen la posición absoluta exacta del grupo
    restoredVector.position = fusionGroup.position.clone();
    restoredRaster.position = fusionGroup.position.clone();

    restoredVector.data = { isHole: true, label: "Trazado Calado" };
    restoredRaster.data = { label: "Imagen" };

    // Enmascarar individualmente cada elemento reconstituido al producto mockup usando clipItem
    let finalVector = restoredVector;
    let finalRaster = restoredRaster;

    if (typeof window.clipItem === 'function' && !window.infiniteCanvasMode && window.clipMask) {
        finalVector = window.clipItem(restoredVector);
        finalRaster = window.clipItem(restoredRaster);
    }

    const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
    designLayer.addChild(finalVector);
    designLayer.addChild(finalRaster);

    if (window.currentMockup) {
        finalVector.insertBelow(window.currentMockup);
        finalRaster.insertBelow(window.currentMockup);
    }

    // Inicializar geomBase de los objetos restaurados
    if (typeof window.syncGeometryToGeomBase === 'function') {
        window.syncGeometryToGeomBase(finalVector);
        window.syncGeometryToGeomBase(finalRaster);
    }

    // Remover el contenedor de fusión y su clipGroup padre de la escena
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
    }
    console.log("%c[EKKO SMART FUSION] Escuchadores asíncronos de Fusión y Snapping cargados con éxito (v45.6).", "color: #0284c7; font-weight: bold;");
}

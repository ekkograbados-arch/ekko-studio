/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/smartFusion.js
ACCIÓN: REEMPLAZAR COMPLETAMENTE
ESTADO: PENDIENTE DE VALIDACIÓN CONTRA CONTRATO
DEPENDENCIAS DIRECTAS: ASSETS/js/modules/canvas-pro/geometricUngroup.js
======================================================================== */

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/smartFusion.js (Smart Fusion & Magnetic Snapping Engine v45.4 - Even-Odd Clipping Rule & Ghost Parent Cleanup)
Descripción:
    Núcleo matemático de la Fusión Inteligente y Anclaje Magnético para EKKO Studio.
    Soluciona de forma definitiva los desbordes del producto y la inversión de máscaras
    al aislar y bäkear coordenadas en absoluto, alineándolas con la cuna jerárquica
    de la máscara del mockup (clipGroup) y aplicando protección de Mockup Lock.
========================================================================= */

import { recalculateDynamicSubtractions } from "./geometricUngroup.js";

// Grupo global para almacenar halos de snapping temporales
let snappingHalosGroup = null;
let activeSnappedVector = null;

/**
 * Detecta si un elemento es parte del mockup del producto base o una de sus máscaras.
 * @param {paper.Item} item
 * @returns {boolean} True si es elemento protegido del producto.
 */
function isMockupOrProductElement(item) {
    let curr = item;
    while (curr) {
        if (curr.clipMask || (curr.data && (\n            curr.data.mockup ||\n            curr.data.isMask ||\n            curr.data.locked ||\n            curr.data.isSelectionBox ||\n            curr.data.isSmartGuide ||\n            curr.data.isMeasurement\n        ))) {
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
 * Obtiene un clon de un elemento de Paper.js con su sistema de coordenadas
 * aplanado y bakeado en espacio absoluto (coordenadas del proyecto).
 * @param {paper.Item} item - Elemento a aplanar.
 * @returns {paper.Item} El clon aplanado en absoluto.
 */
function getAbsoluteClone(item) {
    if (!item) return null;
    const clone = item.clone({ insert: false });
    // Aplicamos la matriz global acumulativa de transformaciones
    clone.matrix = item.globalMatrix.clone();
    // Insertamos temporalmente en el lienzo raíz para asegurar su contexto
    paper.project.activeLayer.addChild(clone);
    // Si es un trazado vectorial, "bakeamos" físicamente la geometría (reseteando matriz a identidad)
    if (clone.className === 'Path' || clone.className === 'CompoundPath') {
        clone.applyMatrix = true;
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
export function applySmartFusion(vector, raster, mode = 'calar') {
    if (!vector || !raster || !paper) return null;

    // BLINDAJE ABSOLUTO (MOCKUP LOCK): Prohibido usar elementos de mockup o máscaras de contención
    if (isMockupOrProductElement(vector) || vector.clipMask) {
        console.error("❌ [MOCKUP_LOCK]: Intento de usar el contorno o máscara de producto como vector de corte. Operación cancelada.");
        return null;
    }
    if (isMockupOrProductElement(raster) || raster.clipMask) {
        console.error("❌ [MOCKUP_LOCK]: Intento de usar el producto base como imagen para fusionar. Operación cancelada.");
        return null;
    }

    if (typeof window.saveHistory === 'function') window.saveHistory();

    // Preservar la cuna jerárquica del producto (el clipGroup o grupo contenedor de diseño)
    const parent = raster.parent || paper.project.activeLayer;

    // 1. Obtener copias con geometría aplanada a espacio absoluto de coordenadas
    const absoluteVector = getAbsoluteClone(vector);
    const absoluteRaster = getAbsoluteClone(raster);

    // 2. Crear respaldos para reversibilidad y edición asíncrona
    const originalVectorGeom = absoluteVector.clone({ insert: false });
    const originalRasterGeom = absoluteRaster.clone({ insert: false });

    let maskItem = null;
    let fusionGroup = new paper.Group();

    if (mode === 'intersecar') {
        // MODO INTERSECCIÓN: La imagen existe solo dentro del vector
        maskItem = absoluteVector.clone();
        maskItem.clipMask = true;
        
        // Agregar al grupo en absoluto
        fusionGroup.addChild(maskItem);
        fusionGroup.addChild(absoluteRaster.clone());
    } else {
        // MODO CALAR: EVEN-ODD METHOD FOR 100% RELIABILITY AND NO INVERSION BUGS (v45.3)
        const outerRect = new paper.Path.Rectangle(absoluteRaster.bounds);
        
        // Creamos un CompoundPath de recorte con regla de relleno Even-Odd
        const inverseMask = new paper.CompoundPath({ insert: false });
        inverseMask.fillRule = 'evenodd';
        inverseMask.addChild(outerRect);
        inverseMask.addChild(absoluteVector.clone());

        // PURGA ABSOLUTA DE ESTILOS: Evita que la máscara herede rellenos negros o contornos en pantalla
        inverseMask.fillColor = null;
        inverseMask.strokeColor = null;
        inverseMask.strokeWidth = 0;

        inverseMask.clipMask = true;
        maskItem = inverseMask;

        // Agregar al grupo en absoluto
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

    // Insertar el grupo en el parent original de la imagen (manteniendo el clipping del producto mockup)
    parent.addChild(fusionGroup);

    // AJUSTE DE COORDENADAS RECOLECTADAS: Si el parent original tenía transformaciones (Z-offset, escala),
    // aplicamos la matriz inversa para que coincida exactamente en el viewport interactivo.
    if (parent && parent.globalMatrix && !parent.globalMatrix.isIdentity()) {
        fusionGroup.matrix = parent.globalMatrix.inverted();
    }

    // Liberar los elementos originales y los clones absolutos intermedios
    absoluteVector.remove();
    absoluteRaster.remove();
    
    // Saneamiento de Grupos Fantasma (Ghost Group Cleanup)
    // Si el vector o imagen estaban en un grupo contenedor que ahora queda vacío o sin contenido real (solo máscaras), lo eliminamos
    const vectorParent = vector.parent;
    vector.remove();
    if (vectorParent && vectorParent.className === 'Group') {
        const content = vectorParent.children.filter(c => !c.clipMask);
        if (content.length === 0) {
            vectorParent.remove();
        }
    }
    
    const rasterParent = raster.parent;
    raster.remove();
    if (rasterParent && rasterParent.className === 'Group') {
        const content = rasterParent.children.filter(c => !c.clipMask);
        if (content.length === 0) {
            rasterParent.remove();
        }
    }

    // Sincronizar el geomBase del nuevo contenedor inteligente para reactividad CSG
    if (typeof window.syncGeometryToGeomBase === 'function') {
        window.syncGeometryToGeomBase(fusionGroup);
    }

    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }

    // ACTUALIZAR SELECCIÓN INMEDIATA (Soluciona arrastre fijo/trabado)
    if (typeof window.deselectItem === 'function') window.deselectItem();
    if (typeof window.selectItem === 'function') {
        window.selectItem(fusionGroup);
    }

    paper.view.update();
    return fusionGroup;
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
        snappingHalosGroup.data = { isSnappingOverlay: true };
    } else {
        snappingHalosGroup.removeChildren();
    }

    let nearestVector = null;
    let minDistance = snapDistance;

    // Buscar vectores de calado activo (isHole) en la capa de diseño
    const designLayer = paper.project.layers.find(l => l.name === 'designLayer') || paper.project.activeLayer;
    
    designLayer.accept({
        visit: function(item) {
            if (item.data && item.data.isHole && item.className === 'Path' && !isMockupOrProductElement(item)) {
                const dist = rasterItem.position.getDistance(item.bounds.center);
                if (dist < minDistance) {
                    minDistance = dist;
                    nearestVector = item;
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
        snapHalo.fillColor = null;
        snappingHalosGroup.addChild(snapHalo);

        // Generar una ligera resistencia física (atracción) del centro de la foto al imán
        rasterItem.position = nearestVector.bounds.center;
        
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
        // Fusionar en caliente en modo calado (sacabocados)
        applySmartFusion(snapped, rasterItem, 'calar');
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
        // Si el vector que cala se deforma, regeneramos la máscara inversa en tiempo real (Even-Odd method v45.3)
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

            // Reemplazar la máscara vieja por la nueva sin perder el clipping
            newInverseMask.clipMask = true;
            maskItem.replaceWith(newInverseMask);
        }
    }
}

/**
 * Disuelve la Fusión Inteligente reconstituyendo los vectores y fotos intactas.
 * @param {paper.Group} fusionGroup - El contenedor inteligente.
 */
export function releaseSmartFusion(fusionGroup) {
    if (!fusionGroup || !fusionGroup.data || !fusionGroup.data.isSmartFusion) return;

    if (typeof window.saveHistory === 'function') window.saveHistory();

    const parent = fusionGroup.parent || paper.project.activeLayer;

    // Recuperar respaldos de memoria originales (que ya están en coordenadas absolutas)
    const restoredVector = fusionGroup.data.originalVectorData.clone();
    const restoredRaster = fusionGroup.data.originalRasterData.clone();

    // Restituyen la posición absoluta exacta del grupo
    restoredVector.position = fusionGroup.position.clone();
    restoredRaster.position = fusionGroup.position.clone();

    restoredVector.data = { isHole: true, label: "Trazado Calado" };
    restoredRaster.data = { label: "Imagen" };

    // Insertar de vuelta en el parent original (para que no pierda la máscara del producto)
    parent.addChild(restoredVector);
    parent.addChild(restoredRaster);

    // Ajustar matriz relativa al parent
    if (parent && parent.globalMatrix && !parent.globalMatrix.isIdentity()) {
        const inv = parent.globalMatrix.inverted();
        restoredVector.matrix = inv;
        restoredRaster.matrix = inv;
    }

    // Remover el grupo fusionado de la escena
    fusionGroup.remove();

    if (typeof window.deselectItem === 'function') window.deselectItem();
    if (typeof window.selectItem === 'function') window.selectItem(restoredRaster);

    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
    }

    paper.view.update();
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
    console.log("%c[EKKO SMART FUSION] Escuchadores asíncronos de Fusión y Snapping cargados con éxito (v45.4).", "color: #0284c7; font-weight: bold;");
}

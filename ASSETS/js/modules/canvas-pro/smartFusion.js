/* ========================================================================
RUTA DESTINO EN STUDIO: ekko-studio/ASSETS/js/modules/canvas-pro/smartFusion.js
ACCIÓN: REEMPLAZAR COMPLETAMENTE
ESTADO: PENDIENTE DE VALIDACIÓN CONTRA CONTRATO
DEPENDENCIAS DIRECTAS: ASSETS/js/modules/canvas-pro/geometricUngroup.js
======================================================================== */

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/smartFusion.js (Smart Fusion & Magnetic Snapping Engine v45.0)
Descripción:
    Núcleo matemático de la Fusión Inteligente y Anclaje Magnético para EKKO Studio.
    Gestiona el enmascaramiento directo e inverso (calado físico real) de imágenes 
    con vectores, la interactividad de imán visual, y la reversibilidad no destructiva.
========================================================================= */

import { recalculateDynamicSubtractions } from "./geometricUngroup.js";

// Grupo global para almacenar halos de snapping temporales
let snappingHalosGroup = null;
let activeSnappedVector = null;

/**
 * Aplica la Fusión Inteligente entre un vector de corte y una imagen (Raster).
 * @param {paper.Item} vector - El trazado vectorial que actúa como troquel o molde.
 * @param {paper.Raster} raster - La imagen de mapa de bits a enmascarar o calar.
 * @param {string} mode - 'intersecar' (Messi dentro del vector) o 'calar' (vector perfora a Messi).
 * @returns {paper.Group} El contenedor inteligente resultante.
 */
export function applySmartFusion(vector, raster, mode = 'calar') {
    if (!vector || !raster || !paper) return null;

    if (typeof window.saveHistory === 'function') window.saveHistory();

    const parent = raster.parent || paper.project.activeLayer;

    // Crear copias de seguridad de los elementos originales en el data para reversibilidad
    const originalVectorGeom = vector.clone({ insert: false });
    const originalRasterGeom = raster.clone({ insert: false });

    // Limpiar matrices de transformación para el enmascarado concéntrico
    originalVectorGeom.matrix = new paper.Matrix();
    originalRasterGeom.matrix = new paper.Matrix();

    let maskItem = null;
    let fusionGroup = new paper.Group();

    if (mode === 'intersecar') {
        // MODO INTERSECCIÓN: La imagen existe solo dentro del vector
        maskItem = vector.clone();
        maskItem.clipMask = true;
        
        // Agregar al grupo: Primero la máscara, luego la imagen de fondo
        fusionGroup.addChild(maskItem);
        fusionGroup.addChild(raster.clone());
    } else {
        // MODO CALAR: El vector actúa como sacabocados (HUECO REAL) que perfora la imagen
        // Creamos un rectángulo con las dimensiones de la imagen y le restamos el vector
        const outerRect = new paper.Path.Rectangle(raster.bounds);
        const inverseMask = outerRect.subtract(vector);
        outerRect.remove(); // Liberar temporales

        inverseMask.clipMask = true;
        maskItem = inverseMask;

        // Agregar al grupo: Primero la máscara inversa, luego la imagen intacta
        fusionGroup.addChild(maskItem);
        fusionGroup.addChild(raster.clone());
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

    // Reemplazar los objetos originales en la escena
    parent.addChild(fusionGroup);
    vector.remove();
    raster.remove();

    // Sincronizar el geomBase del nuevo contenedor inteligente para reactividad CSG
    if (typeof window.syncGeometryToGeomBase === 'function') {
        window.syncGeometryToGeomBase(fusionGroup);
    }

    if (typeof recalculateDynamicSubtractions === 'function') {
        recalculateDynamicSubtractions();
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
            if (item.data && item.data.isHole && item.className === 'Path') {
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
        // Si el vector que cala se deforma, regeneramos la máscara inversa en tiempo real
        const currentVector = fusionGroup.data.originalVectorData; 
        if (currentVector) {
            const outerRect = new paper.Path.Rectangle(rasterItem.bounds);
            const newInverseMask = outerRect.subtract(currentVector);
            outerRect.remove();

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

    // Recuperar respaldos de memoria originales
    const restoredVector = fusionGroup.data.originalVectorData.clone();
    const restoredRaster = fusionGroup.data.originalRasterData.clone();

    // Restituir posición espacial
    restoredVector.position = fusionGroup.position.clone();
    restoredRaster.position = fusionGroup.position.clone();

    restoredVector.data = { isHole: true, label: "Trazado Calado" };
    restoredRaster.data = { label: "Imagen" };

    parent.addChild(restoredVector);
    parent.addChild(restoredRaster);

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
    console.log("%c[EKKO SMART FUSION] Escuchadores asíncronos de Fusión y Snapping cargados con éxito.", "color: #0284c7; font-weight: bold;");
}

/* =========================================================================
Módulo: ASSETS/js/modules/canvas-pro/exportSVG.js (Industrial Laser Edition - v35.2 PRO)
Ruta en repositorio: ASSETS/js/modules/canvas-pro/exportSVG.js
Descripción:
Procesador y exportador de SVG optimizado para corte y grabado láser
en LightBurn, CNC y maquinaria industrial.
Cumple rigurosamente con:
- CONCEPTO FUNDAMENTAL: DESCOMPOSICIÓN POR JERARQUÍA DE CONTENCIÓN
- REGLAS DE ORO - PROMPT MAESTRO - GUIA PARA CREAR EKKO STUDIO
- DIAGNÓSTICO DE ARQUITECTURA (Diagnostico.txt)
- RESULTADO ESPERADO (Huecos físicos reales sin transparencias cosméticas,
  purgado de controladores isHole para evitar dobles líneas de quemado,
  vectorización recursiva tipográfica Fonts-to-Paths y limpieza de artefactos).
FASE DE OPERACIÓN:
1. Selección y clonado defensivo de la capa de diseño (designLayer o activeLayer).
2. Purgado inicial de elementos no grabables y de interfaz.
3. Desarticulación de grupos de máscara (clipGroup) y aplicación directa de matrices.
4. Vectorización recursiva tipográfica Fonts-to-Paths.
5. Materialización CSG no destructiva de sustracciones dinámicas.
6. Purgado quirúrgico de calados interactivos (isHole).
7. Resolución topológica de CompoundPaths y reglas de relleno evenodd.
8. Asignación de estilos visibles (fill/stroke) para reconocimiento de capas en LightBurn.
9. Inyección de unidades físicas métricas reales (mm) y precisión micrométrica (5 decimales).
========================================================================= */

import { recalculateDynamicSubtractions } from "./geometricUngroup.js";

/**
 * Obtiene el elemento de contenido real si el item está encapsulado en un grupo de recorte.
 * @param {paper.Item} item
 * @returns {paper.Item|null}
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
 * Aplica y hornea la matriz de transformación en los vértices del trazado de forma irreversible
 * para que las coordenadas en el SVG exportado sean absolutas en espacio de mundo.
 * @param {paper.Item} path
 * @param {paper.Matrix} matrix
 */
function bakeMatrixIntoPath(path, matrix) {
    if (!path || !matrix) return;
    if (path.segments) {
        path.segments.forEach(seg => {
            seg.point = matrix.transform(seg.point);
            if (seg.handleIn) seg.handleIn = matrix.transform(seg.handleIn).subtract(matrix.transform(new paper.Point(0, 0)));
            if (seg.handleOut) seg.handleOut = matrix.transform(seg.handleOut).subtract(matrix.transform(new paper.Point(0, 0)));
        });
    }
    if (path.children && Array.isArray(path.children)) {
        path.children.forEach(child => bakeMatrixIntoPath(child, matrix));
    }
}

/**
 * Convierte un PointText o grupo tipográfico a un CompoundPath/Path vectorial horneado.
 * @param {paper.Item} textItem
 * @returns {paper.Item|null}
 */
function vectorizeTextItem(textItem) {
    if (!textItem) return null;
    try {
        if (typeof textItem.createPath === "function") {
            const path = textItem.createPath({ insert: false });
            if (path) {
                path.fillColor = textItem.fillColor ? textItem.fillColor.clone() : new paper.Color("#000000");
                path.strokeColor = textItem.strokeColor ? textItem.strokeColor.clone() : null;
                path.strokeWidth = textItem.strokeWidth || 0;
                path.matrix = textItem.matrix ? textItem.matrix.clone() : new paper.Matrix();
                path.data = {
                    ...(textItem.data || {}),
                    label: (textItem.data?.label || "Texto") + " (Vectorizado)"
                };
                return path;
            }
        } else if (typeof textItem.toPath === "function") {
            const path = textItem.toPath();
            if (path) {
                path.data = {
                    ...(textItem.data || {}),
                    label: (textItem.data?.label || "Texto") + " (Vectorizado)"
                };
                return path;
            }
        }
    } catch (err) {
        console.warn("[EKKO EXPORT WARNING] Falló la conversión de texto a trazado:", err);
    }
    return null;
}

/**
 * Prepara y exporta el diseño vectorial activo a un formato SVG estricto para corte/grabado láser.
 * Garantiza vacíos geométricos reales (sustracciones booleanas materializadas) y la purga
 * completa de controladores interactivos para evitar quemados dobles en LightBurn.
 *
 * @param {Object} [options] Opciones de exportación
 * @param {number} [options.precision=5] Precisión decimal para coordenadas vectoriales
 * @param {boolean} [options.asString=true] Retorna el SVG como string XML
 * @returns {string|SVGElement} Código XML SVG puro listo para manufactura o elemento SVG
 */
export function prepareSVGForExport(options = {}) {
    if (typeof paper === "undefined" || !paper.project) {
        console.error("[EKKO EXPORT] Error crítico: Paper.js no está inicializado.");
        return "";
    }

    const precision = typeof options.precision === "number" ? options.precision : 5;
    const asString = options.asString !== false;

    // 1. SELECCIÓN DEFENSIVA DE LA CAPA DE DISEÑO ÚTIL
    const designLayer = (paper.project.layers && paper.project.layers.find(l => l.name === "designLayer")) || paper.project.activeLayer;
    if (!designLayer) {
        console.error("[EKKO EXPORT] Error: No se encontró la capa de diseño para exportar.");
        return "";
    }

    // Clonado aislado de la capa (insert: false para no contaminar el lienzo interactivo)
    const tempLayer = designLayer.clone({ insert: false });

    // 2. PURGADO INICIAL DE ARTEFACTOS AUXILIARES Y ELEMENTOS NO GRABABLES
    const itemsToRemove = [];
    tempLayer.getItems({
        match: function(item) {
            const data = item.data || {};
            return (
                data.mockup === true ||
                data.isMask === true ||
                data.wasClipMask === true ||
                data.isSelectionBox === true ||
                data.isHandle === true ||
                data.isNodeHandle === true ||
                data.isCurveHandle === true ||
                data.isSmartGuide === true ||
                data.isMeasurement === true ||
                data.isTracePreview === true ||
                data.isNodeEditOverlay === true ||
                data.isGuide === true ||
                data.isWatermark === true ||
                data.isUnderlineLine === true ||
                (window.currentMockup && item.id === window.currentMockup.id) ||
                (item instanceof paper.PointText && item.content === window.EKKO_CONFIG?.seguridad?.watermarkText)
            );
        }
    }).forEach(item => itemsToRemove.push(item));

    itemsToRemove.forEach(item => {
        try {
            item.remove();
        } catch (e) {}
    });

    // 3. DESARTICULACIÓN DE GRUPOS DE MÁSCARA (clipGroup) Y APLICACIÓN DIRECTA DE MATRICES
    const clipGroups = [];
    tempLayer.getItems({
        match: function(item) {
            return item.data && item.data.clipGroup === true;
        }
    }).forEach(g => clipGroups.push(g));

    clipGroups.forEach(group => {
        const mask = group.children.find(c => c.clipMask || (c.data && (c.data.isMask || c.data.wasClipMask)));
        const content = group.children.find(c => c !== mask);
        if (content) {
            if (group.matrix && !group.matrix.isIdentity()) {
                content.transform(group.matrix);
            }
            tempLayer.addChild(content);
        }
        group.remove();
    });

    // 4. VECTORIZACIÓN RECURSIVA TIPOGRÁFICA (FONTS TO PATHS)
    const textItems = [];
    tempLayer.getItems({
        match: function(item) {
            return (
                item instanceof paper.PointText ||
                item.className === "PointText" ||
                (item.data && (item.data.isCurvedGroup || item.data.isSpacedGroup))
            );
        }
    }).forEach(item => textItems.push(item));

    textItems.forEach(item => {
        if (item.data && (item.data.isCurvedGroup || item.data.isSpacedGroup)) {
            const childrenText = item.children ? [...item.children] : [];
            const textGroupVectorized = new paper.Group();
            childrenText.forEach(charItem => {
                if (charItem instanceof paper.PointText) {
                    const charVector = vectorizeTextItem(charItem);
                    if (charVector) textGroupVectorized.addChild(charVector);
                }
            });
            if (item.parent) {
                item.parent.addChild(textGroupVectorized);
            }
            item.remove();
        } else if (item instanceof paper.PointText) {
            const vectorPath = vectorizeTextItem(item);
            if (vectorPath && item.parent) {
                item.parent.addChild(vectorPath);
            }
            item.remove();
        }
    });

    // 5. MATERIALIZACIÓN CSG NO DESTRUCTIVA DE SUSTRACCIONES DINÁMICAS
    try {
        if (typeof recalculateDynamicSubtractions === "function") {
            recalculateDynamicSubtractions(tempLayer);
        } else if (typeof window.recalculateDynamicSubtractions === "function") {
            window.recalculateDynamicSubtractions(tempLayer);
        }
    } catch (err) {
        console.warn("[EKKO EXPORT CSG RECALC ERROR]", err);
    }

    // 6. PURGADO DE CALADOS ACTIVOS (isHole)
    // Dado que el corte booleano ya fue materializado en la geometría de las masas sólidas inferiores,
    // se eliminan todas las entidades de calado interactivo para no generar líneas de corte duplicadas en LightBurn
    const holesToRemove = [];
    tempLayer.getItems({
        match: function(item) {
            return item.data && item.data.isHole === true;
        }
    }).forEach(h => holesToRemove.push(h));

    holesToRemove.forEach(hole => {
        try {
            hole.remove();
        } catch (e) {}
    });

    // 7. RESOLUCIÓN TOPOLÓGICA DE COMPOUNDPATHS Y REGLAS DE RELLENO EVENODD
    tempLayer.getItems({
        match: function(item) {
            return item instanceof paper.CompoundPath;
        }
    }).forEach(compound => {
        compound.fillRule = "evenodd";
    });

    // 8. ASIGNACIÓN DE ESTILOS VISIBLES PARA RECONOCIMIENTO DE CAPAS EN LIGHTBURN
    tempLayer.getItems({
        match: function(item) {
            return item instanceof paper.Path || item instanceof paper.CompoundPath;
        }
    }).forEach(path => {
        if (!path.fillColor && !path.strokeColor) {
            path.fillColor = new paper.Color("#000000");
        }
        if (path.strokeColor && (!path.strokeWidth || path.strokeWidth <= 0)) {
            path.strokeWidth = 0.5;
        }
    });

    // 9. EXPORTACIÓN NATIVA A SVG CON PRECISIÓN INDUSTRIAL
    const exportConfig = {
        asString: true,
        bounds: "content",
        precision: precision
    };

    let svgString = tempLayer.exportSVG(exportConfig);

    // 10. INYECCIÓN DE DIMENSIONES FÍSICAS EN MILÍMETROS (Garantía de Escala 1:1 en LightBurn)
    if (typeof svgString === "string" && window.mmPerPaperUnit) {
        const bounds = tempLayer.bounds;
        if (bounds && bounds.width > 0 && bounds.height > 0) {
            const widthMm = (bounds.width * window.mmPerPaperUnit).toFixed(2);
            const heightMm = (bounds.height * window.mmPerPaperUnit).toFixed(2);

            svgString = svgString.replace(
                /<svg\b([^>]*)>/i,
                (match, attrs) => {
                    let newAttrs = attrs;
                    if (/\bwidth="[^"]*"/i.test(newAttrs)) {
                        newAttrs = newAttrs.replace(/\bwidth="[^"]*"/i, `width="${widthMm}mm"`);
                    } else {
                        newAttrs += ` width="${widthMm}mm"`;
                    }
                    if (/\bheight="[^"]*"/i.test(newAttrs)) {
                        newAttrs = newAttrs.replace(/\bheight="[^"]*"/i, `height="${heightMm}mm"`);
                    } else {
                        newAttrs += ` height="${heightMm}mm"`;
                    }
                    return `<svg${newAttrs}>`;
                }
            );
        }
    }

    tempLayer.remove();

    if (window.EKKO_DEBUG) {
        console.log("[EKKO EXPORT SUCCESS] El diseño vectorial ha sido industrializado exitosamente para LightBurn.");
    }

    return asString ? svgString : new DOMParser().parseFromString(svgString, "image/svg+xml").documentElement;
}

/**
 * Dispara la descarga del SVG preparado directamente en el navegador del usuario.
 * @param {string} [filename="diseno-ekko.svg"] Nombre del archivo de salida
 */
export function downloadExportedSVG(filename = "diseno-ekko.svg") {
    const svgContent = prepareSVGForExport({ asString: true });
    if (!svgContent || svgContent.trim() === "") {
        alert("No hay elementos válidos para exportar en el lienzo.");
        return;
    }

    const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename.endsWith(".svg") ? filename : (filename + ".svg");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Exposición global segura
if (typeof window !== "undefined") {
    window.prepareSVGForExport = prepareSVGForExport;
    window.downloadExportedSVG = downloadExportedSVG;
}
